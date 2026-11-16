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
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { createAgent, finalText, type AgentStateType } from "@/lib/agent/graph";
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

export async function POST(req: Request): Promise<NextResponse> {
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
      if (saved) store.restore(saved);
    }

    const conversationId = body.conversationId ?? body.sessionId ?? "anonymous";

    /**
     * Право на диалог.
     *
     * `conversationId` приходит от клиента и угадывается не хуже, чем id
     * сметы: он виден в запросе в панели разработчика. Читать по нему
     * чужую переписку — утечка того же класса, что и чужое КП.
     *
     * Проверка простая и достаточная: диалог принадлежит либо смете
     * этой организации, либо (если сметы нет) доступен только анониму
     * в демо-организации. Второе условие нужно, чтобы аноним не читал
     * диалоги вошедших пользователей, зная их идентификаторы.
     */
    const ownsConversation = await canAccessConversation(conversationId, viewerOrg);
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
    const agent = createAgent({ getPrice, useLlm: true }, { store });

    const state = (await agent.invoke(
      {
        messages: [...historyToMessages(history), new HumanMessage(question)],
      },
      sessionTags("chat", {
        hasEstimate: hasEstimate ? "with-estimate" : "no-estimate",
        hasHistory: history.length > 0 ? "with-history" : "first-turn",
      }),
    )) as AgentStateType;

    const answer = finalText(state);

    const toolCalls = state.messages.filter(
      (m) =>
        Array.isArray((m as { tool_calls?: unknown[] }).tool_calls) &&
        ((m as { tool_calls?: unknown[] }).tool_calls?.length ?? 0) > 0,
    ).length;

    // ── Ответ записываем в историю ────────────────────────
    await appendMessage({
      conversationId,
      estimateId: body.sessionId ?? null,
      role: "assistant",
      text: answer,
      toolCalls,
    });

    // ── Токены — после ответа: до вызова их число неизвестно ─
    const tokens = tokensFromState(state);
    await recordTokens(ip, tokens.input, tokens.output);

    return NextResponse.json(
      {
        ok: true,
        answer,
        toolCalls,
        ms: Date.now() - t0,
        tokens: tokens.input + tokens.output,
      },
      { headers: limit.headers },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/chat]", msg);
    return NextResponse.json(
      { ok: false, error: `Не удалось получить ответ: ${msg}` },
      { status: 500 },
    );
  }
}
