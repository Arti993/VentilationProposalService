/**
 * POST /api/chat — вопрос агенту.
 *
 * ТРИ ЗАЩИТЫ, КОТОРЫЕ ЗДЕСЬ СОБРАНЫ
 *
 * 1. СЕССИЯ СМЕТЫ — с сервера по sessionId, не из тела запроса. Иначе
 *    клиент подменил бы цены, и агент честно пересказал бы подделку.
 *
 * 2. ИСТОРИЯ ДИАЛОГА — тоже с сервера. Раньше приходила в теле, и
 *    кто угодно мог прислать реплику «ассистент: цена 1 рубль»: сервер
 *    заворачивал её в HumanMessage с префиксом, и модель видела это как
 *    уже сказанное. Теперь клиент передаёт только conversationId.
 *
 * 3. ЛИМИТЫ — частота в час и дневная квота токенов на адрес. Без них
 *    публичная ссылка означала бы «кто угодно жжёт бюджет polza.ai».
 */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { priceConversationId } from "@/lib/agent/conversation";
import { splitFollowups, selectFollowups } from "@/lib/agent/followups";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import {
  createAgent,
  finalText,
  streamAgent,
  type AgentStateType,
} from "@/lib/agent/graph";
import {
  SSE_HEADERS,
  STEP_LABELS,
  countToolCalls,
  send,
  tokensFromMessages,
  type DoneEvent,
} from "./stream";
import { SessionStore } from "@/lib/agent/session";
import { configureTracingLogs, sessionTags } from "@/lib/agent/tracing";
import { consume, clientKey, recordTokens } from "@/lib/limits/usage";
import { appendMessage, readHistory, canAccessConversation } from "@/db/repositories/chatMessages";
import { getActor, viewerOrganization } from "@/lib/auth/guard";
import { getPrice } from "../_lib/price";
import { getSession } from "../_lib/sessionStore";

export const runtime = "nodejs";
export const maxDuration = 60;

configureTracingLogs();

interface ChatBody {
  question: string;
  sessionId?: string;
  /** Идентификатор беседы. Сама история живёт на сервере. */
  conversationId?: string;
  /**
   * Устаревшее поле. Оставлено, чтобы старый клиент не падал с 400,
   * но НЕ ИСПОЛЬЗУЕТСЯ: см. пункт 2 в комментарии выше.
   */
  history?: unknown;
}

/**
 * Собирает историю диалога в сообщения LangChain.
 *
 * Роли теперь настоящие: ответ ассистента — AIMessage, а не
 * HumanMessage с префиксом. Модель различает «я это сказал» и «мне это
 * сказали», и на этой разнице держится устойчивость к подделке реплик.
 */
function historyToMessages(history: Array<{ role: "user" | "assistant"; text: string }>) {
  return history.map((h) =>
    h.role === "user" ? new HumanMessage(h.text) : new AIMessage(h.text),
  );
}

/**
 * Достаёт число потраченных токенов из результата графа.
 *
 * LangChain складывает `usage_metadata` в ответ модели, но формат
 * зависит от провайдера. polza.ai OpenAI-совместим, поэтому смотрим
 * сначала `usage_metadata`, затем `response_metadata.tokenUsage`.
 * Если ничего нет — возвращаем нули: лучше недосчитать квоту, чем
 * упасть на разборе метаданных.
 */
function tokensFromState(state: AgentStateType): { input: number; output: number } {
  let input = 0;
  let output = 0;

  for (const m of state.messages) {
    const anyM = m as unknown as {
      usage_metadata?: { input_tokens?: number; output_tokens?: number };
      response_metadata?: { tokenUsage?: { promptTokens?: number; completionTokens?: number } };
    };

    const u = anyM.usage_metadata;
    if (u) {
      input += u.input_tokens ?? 0;
      output += u.output_tokens ?? 0;
      continue;
    }

    const t = anyM.response_metadata?.tokenUsage;
    if (t) {
      input += t.promptTokens ?? 0;
      output += t.completionTokens ?? 0;
    }
  }

  return { input, output };
}

/**
 * Возвращает то `Response`, то `NextResponse` — и это нормально.
 *
 * Поток отдаётся обычным `Response` (у `NextResponse` нет конструктора для
 * `ReadableStream`, а оборачивать поток ради типа значит дублировать
 * заголовки). Ошибки — `NextResponse.json`, у которых есть `cookies`.
 * Общий тип поэтому `Response`: он родитель для обоих.
 */
export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();

  try {
    // ── Лимиты: до любой работы с моделью ──────────────────
    const ip = clientKey(req);
    const limit = await consume({ action: "chat", key: ip });
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: limit.reason, retryAt: limit.resetAt.toISOString() },
        { status: limit.status ?? 429, headers: limit.headers },
      );
    }

    const body = (await req.json()) as ChatBody;
    const question = (body.question ?? "").trim();

    if (!question) {
      return NextResponse.json({ ok: false, error: "Пустой вопрос." }, { status: 400 });
    }
    if (question.length > 2000) {
      return NextResponse.json(
        { ok: false, error: "Вопрос слишком длинный (максимум 2000 символов)." },
        { status: 413 },
      );
    }

    // ── Сессия сметы и история — только с сервера ─────────
    const store = new SessionStore();
    const hasEstimate = Boolean(body.sessionId);

    /**
     * Организация, от имени которой идёт диалог.
     *
     * `viewerOrganization`, а не `actor?.orgId || DEMO_ORG_ID`: через `||`
     * пустой orgId (пользователь без организации) становился демо-прайсом,
     * и все видели общие сметы и диалоги.
     */
    const actor = await getActor();
    const viewerOrg = viewerOrganization(actor);

    if (body.sessionId) {
      // Смета читается с проверкой организации: иначе, зная id, можно
      // было бы расспросить агента о чужой смете — ценах, составе,
      // суммах.
      const saved = await getSession(body.sessionId, viewerOrg);
      if (!saved) {
        return NextResponse.json({ ok: false, error: "Смета не найдена." }, { status: 404 });
      }
      store.restore(saved);
    }

    if (!body.sessionId && !actor) {
      return NextResponse.json({ ok: false, error: "Войдите в аккаунт, чтобы продолжить диалог." }, { status: 401 });
    }
    let conversationId = body.sessionId ?? "";
    if (!body.sessionId && actor) {
      try {
        conversationId = priceConversationId(body.conversationId ?? randomUUID(), actor.userId, viewerOrg);
      } catch {
        return NextResponse.json({ ok: false, error: "Некорректный идентификатор диалога." }, { status: 400 });
      }
    }

    // Сметные диалоги проверяем по владельцу сметы. Для чата по прайсу
    // ID уже вычислен из пользователя и организации на сервере.
    const ownsConversation = !body.sessionId || await canAccessConversation(conversationId, viewerOrg);
    if (!ownsConversation) {
      return NextResponse.json(
        { ok: false, error: "Диалог не найден." },
        { status: 404, headers: limit.headers },
      );
    }

    const history = await readHistory(conversationId);

    // Вопрос записываем сразу: если модель не ответит или упадёт,
    // в истории останется, что человек спросил. Иначе следующий
    // запрос увидел бы ответ без вопроса.
    await appendMessage({
      conversationId,
      estimateId: body.sessionId ?? null,
      role: "user",
      text: question,
    });

    // getPrice передаём как функцию, а не результат вызова: прайс грузится
    // только если инструмент его реально потребует.
    //
    // Организация зашита здесь, а не приходит из запроса: иначе, подставив
    // чужой orgId, можно было бы заставить агента искать цены в чужом
    // прайсе и пересказать их.
    const agent = createAgent(
      { getPrice: () => getPrice(viewerOrg), useLlm: true },
      { store, suggestFollowups: true },
    );

    const messages = [...historyToMessages(history), new HumanMessage(question)];
    const tags = sessionTags("chat", {
      hasEstimate: hasEstimate ? "with-estimate" : "no-estimate",
      hasHistory: history.length > 0 ? "with-history" : "first-turn",
    });

    /**
     * ПОТОКОВЫЙ ОТВЕТ.
     *
     * Клиент получает шаги по мере работы агента, а не «думаю…» на все
     * 4-8 секунд. Запись в историю, tokens и лимиты делаются ЗДЕСЬ, в
     * `start` потока, а не до его возврата: `ReadableStream` начинает
     * работать только когда ответ уже отдан клиенту, и это ровно то
     * место, где фоновая запись не задерживает первый байт.
     *
     * `finalAnswer` нужен снаружи `start`, чтобы замыкание ниже записало
     * в историю именно то, что увидел пользователь.
     */
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let answer = "";
        let suggestions: string[] = [];
        let toolCalls = 0;
        let tokens = { input: 0, output: 0 };

        try {
          let lastState: AgentStateType | undefined;

          for await (const event of streamAgent(agent, { messages }, tags, (node, phase, ms) => {
            /**
             * Наружу идут только узлы из `STEP_LABELS`. `guard` и `tools`
             * — внутренняя механика: проверка вопроса и вызов
             * инструмента не должны выглядеть как работа пользователя.
             *
             * Шаг `agent` приходит дважды (до и после `tools`) — клиент
             * обновляет запись по `id`, поэтому в списке он остаётся
             * одним, но с временем завершения.
             */
            const label = STEP_LABELS[node];
            if (!label) return;
            send(controller, "step", { id: node, label, status: phase, ms });
          })) {
            if (event.state?.messages) lastState = event.state;
          }

          if (lastState) {
            const parsed = splitFollowups(finalText(lastState));
            answer = parsed.answer;
            suggestions = selectFollowups(parsed.suggestions, [...history, { role: "user", text: question }], store.current !== null);
            toolCalls = countToolCalls(lastState);
            tokens = tokensFromMessages(lastState.messages);
          }

          // Save before the next question becomes available: no race with a quick chip click.
          if (answer) {
            await appendMessage({ conversationId, estimateId: body.sessionId ?? null, role: "assistant", text: answer, toolCalls });
          }
          send(controller, "done", {
            ms: Date.now() - t0,
            tokens: tokens.input + tokens.output,
            toolCalls,
            answer,
            suggestions,
          } satisfies DoneEvent);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[api/chat] поток", msg);
          send(controller, "error", { message: `Не удалось получить ответ: ${msg}` });
        } finally {
          controller.close();

          void recordTokens(ip, tokens.input, tokens.output).catch((e: unknown) => {
            console.error("[api/chat] токены", e instanceof Error ? e.message : e);
          });
        }
      },
    });

    return new Response(stream, { headers: { ...SSE_HEADERS, ...limit.headers } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/chat]", msg);
    return NextResponse.json(
      { ok: false, error: `Не удалось получить ответ: ${msg}` },
      { status: 500 },
    );
  }
}
