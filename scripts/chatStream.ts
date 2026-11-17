/**
 * Разбор потока `/api/chat` в скриптах.
 *
 * Агент отдаёт ответ Server-Sent Events, а не JSON. Скриптам нужен
 * итоговый текст и статистика, поэтому здесь один общий разбор: иначе
 * каждый тест повторяет его по-своему и рано или поздно разойдётся.
 *
 * Формат кадра:
 *
 *   event: step
 *   data: {"id":"agent","label":"Смотрю прайс и считаю","status":"start"}
 *   <пустая строка>
 */

export interface ParsedChat {
  ok: boolean;
  answer?: string;
  toolCalls?: number;
  ms?: number;
  tokens?: number;
  error?: string;
  /** Шаги, которые успел отдать сервер — для диагностики */
  steps: string[];
  /** Сколько байт пришло всего: полезно, если ответ пустой */
  bytes: number;
}

/** Читает поток целиком и достаёт последний `done` или `error`. */
export async function readChatStream(res: Response): Promise<ParsedChat> {
  const body = await res.text();
  const frames = body.split("\n\n");

  const steps: string[] = [];
  let done: { answer: string; toolCalls: number; ms: number; tokens: number } | null = null;
  let error: string | undefined;

  for (const frame of frames) {
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    if (!event || !data) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }

    if (event === "step") {
      const s = parsed as { label: string; status: string };
      steps.push(`${s.label} (${s.status})`);
    } else if (event === "done") {
      done = parsed as typeof done;
    } else if (event === "error") {
      error = (parsed as { message?: string }).message;
    }
  }

  if (error) return { ok: false, error, steps, bytes: body.length };
  if (!done) {
    return {
      ok: false,
      error: `Поток завершился без ответа (HTTP ${res.status}): ${body.slice(0, 120) || "пусто"}`,
      steps,
      bytes: body.length,
    };
  }

  return {
    ok: true,
    answer: done.answer,
    toolCalls: done.toolCalls,
    ms: done.ms,
    tokens: done.tokens,
    steps,
    bytes: body.length,
  };
}

/** Заголовки для запроса к `/api/chat`. */
export const CHAT_HEADERS = {
  "Content-Type": "application/json",
  Accept: "text/event-stream",
} as const;
