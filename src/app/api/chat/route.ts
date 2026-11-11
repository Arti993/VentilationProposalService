/**
 * POST /api/chat — вопрос агенту.
 *
 * Агент получает сессию сметы ИЗ СЕРВЕРНОГО ХРАНИЛИЩА по sessionId,
 * а не из тела запроса. Это принципиально: если бы клиент присылал
 * данные сметы, он мог бы подменить цены в запросе, и агент честно
 * пересказал бы подделку.
 */
import { NextResponse } from "next/server";
import { HumanMessage } from "@langchain/core/messages";
import { createAgent, finalText, type AgentStateType } from "@/lib/agent/graph";
import { SessionStore } from "@/lib/agent/session";
import { configureTracingLogs } from "@/lib/agent/tracing";
import { getPrice } from "../_lib/price";
import { getSession } from "../_lib/sessionStore";

export const runtime = "nodejs";
export const maxDuration = 60;

configureTracingLogs();

interface ChatBody {
  question: string;
  sessionId?: string;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
}

/**
 * Собирает историю диалога в сообщения LangChain.
 *
 * Ограничиваем 10 последними репликами: длинная история раздувает промпт,
 * и модель начинает «тонуть» в собственном тексте.
 */
function historyToMessages(
  history: Array<{ role: "user" | "assistant"; text: string }> = [],
) {
  const tail = history.slice(-10);
  return tail.map((h) => new HumanMessage(h.role === "user" ? h.text : `Ассистент: ${h.text}`));
}

export async function POST(req: Request): Promise<NextResponse> {
  const t0 = Date.now();

  try {
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

    // Сессия берётся с сервера по ID — данные сметы от клиента не принимаются
    const store = new SessionStore();
    if (body.sessionId) {
      const saved = await getSession(body.sessionId);
      if (saved) store.restore(saved);
    }

    const agent = createAgent({ price: await getPrice(), useLlm: true }, { store });

    const state = (await agent.invoke({
      messages: [...historyToMessages(body.history), new HumanMessage(question)],
    })) as AgentStateType;

    const toolCalls = state.messages.filter(
      (m) =>
        Array.isArray((m as { tool_calls?: unknown[] }).tool_calls) &&
        ((m as { tool_calls?: unknown[] }).tool_calls?.length ?? 0) > 0,
    ).length;

    return NextResponse.json({
      ok: true,
      answer: finalText(state),
      toolCalls,
      ms: Date.now() - t0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/chat]", msg);
    return NextResponse.json(
      { ok: false, error: `Не удалось получить ответ: ${msg}` },
      { status: 500 },
    );
  }
}
