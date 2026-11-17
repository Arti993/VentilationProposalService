/**
 * Потоковая выдача ответа агента через Server-Sent Events.
 *
 * ЗАЧЕМ
 *
 * Раньше `/api/chat` ждала весь ответ и отдавала его одним куском. Модель
 * с инструментами отвечает 4-8 секунд, и всё это время пользователь видел
 * только «думаю…». Для диалога это плохо: непонятно, работает ли система
 * вообще и что она делает.
 *
 * Теперь ответ приходит шагами. Каждое событие — отдельная строка SSE:
 *
 *   event: step     {"id":"rag","label":"Смотрю прайс","status":"start"}
 *   event: step     {"id":"rag","label":"Смотрю прайс","status":"done","ms":240}
 *   event: token    {"text":"Воздуховод 315 стоит "}
 *   event: token    {"text":"846 ₽ за м.п."}
 *   event: done     {"ms":5120,"tokens":412,"toolCalls":1}
 *   event: error    {"message":"…"}
 *
 * ПОЧЕМУ НЕ `experimental_streamEvents`
 *
 * `agent.streamEvents()` даёт поток внутренностей LangGraph — узлов,
 * чекпоинтов, мелочей. Наружу это выдавать нельзя: там видны имена
 * инструментов, промежуточные состояния и служебные сообщения. Клиенту
 * нужен не граф, а понятные шаги и текст. Поэтому поток разбирается здесь
 * и превращается в узкий контракт из шести событий.
 *
 * ЧТО ВАЖНО ДЛЯ БЕЗОПАСНОСТИ
 *
 * В события не попадают ни вызовы инструментов с их аргументами, ни
 * содержимое прайса. Только человекочитаемая подпись шага. Даже если
 * кто-то смотрит поток в панели разработчика, он не увидит ничего, что не
 * показано на экране.
 */

import type { AgentStateType } from "@/lib/agent/graph";
import { AIMessageChunk, type BaseMessage } from "@langchain/core/messages";

/** Заголовки для SSE. `X-Accel-Buffering` — чтобы прокси не буферизовал. */
export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export interface StepEvent {
  id: string;
  label: string;
  status: "start" | "done";
  ms?: number;
}

export interface DoneEvent {
  ms: number;
  tokens: number;
  toolCalls: number;
  answer: string;
}

/**
 * Человекочитаемые подписи шагов.
 *
 * Ключи — ИМЕНА УЗЛОВ ГРАФА, а не инструментов. Граф собран так:
 * `guard → agent → tools → agent → END` (см. `lib/agent/graph.ts`), и
 * `stream()` отдаёт именно эти имена. Первая версия этого файла
 * сопоставляла шаги с именами инструментов (`rag`, `estimate`), и
 * пользователь не видел ни одного шага: ключи просто не совпадали.
 *
 * `guard` и `tools` намеренно без подписи: проверка вопроса и вызов
 * инструмента — это внутренняя механика, показывать её как отдельный шаг
 * бессмысленно. Видимое для человека — «смотрю прайс» (это `agent` с
 * инструментами) и «готовлю ответ».
 */
export const STEP_LABELS: Record<string, string> = {
  agent: "Смотрю прайс и считаю",
  rag: "Ищу по смыслу",
  estimate: "Проверяю смету",
};

/** Код ответа — короткая строка. Простая, без лишних аллокаций. */
function encode(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Одно событие — один `enqueue` в контроллер потока. */
export function send(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown,
): void {
  controller.enqueue(encode(event, data));
}

/**
 * Достаёт текст из порции ответа модели.
 *
 * Модели возвращают `chunk.content` в двух форматах: строкой и массивом
 * блоков (`[{type:"text",text:"…"}]`). Второй появился у OpenAI-совместимых
 * провайдеров для мультимодальных ответов, и наш свалился бы на нём с
 * `[object Object]`, если бы его просто склеили.
 */
export function chunkText(chunk: AIMessageChunk | BaseMessage): string {
  const content = chunk.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object" && "text" in b && typeof b.text === "string") {
          return b.text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * Считает токены по итоговому состоянию графа.
 *
 * Та же логика, что была в маршруте: `usage_metadata` у polza.ai есть не
 * всегда, а `response_metadata.tokenUsage` — почти всегда. Если нет ни
 * того, ни другого, возвращаем нули: недосчитать квоту лучше, чем упасть
 * на разборе метаданных.
 */
export function tokensFromMessages(messages: BaseMessage[]): {
  input: number;
  output: number;
} {
  let input = 0;
  let output = 0;

  for (const m of messages) {
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

/** Сколько вызовов инструментов было за диалог. */
export function countToolCalls(state: AgentStateType): number {
  return state.messages.filter(
    (m) =>
      Array.isArray((m as { tool_calls?: unknown[] }).tool_calls) &&
      ((m as { tool_calls?: unknown[] }).tool_calls?.length ?? 0) > 0,
  ).length;
}
