/**
 * Тонкий клиент к API. Не используем axios: fetch достаточно, а
 * лишняя зависимость на фронте — лишний вес в бандле.
 *
 * Типы ошибок едины: сеть, HTTP, парсинг — всё превращается в строку,
 * которую можно показать пользователю.
 */
import type { ApiError, UploadResponse } from "@entities/estimate/model/types";

export async function uploadEstimate(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/api/estimate", { method: "POST", body: form });
  const json = (await res.json()) as UploadResponse | ApiError;

  if (!res.ok || !("ok" in json) || json.ok !== true) {
    const msg = "error" in json ? json.error : `Ошибка загрузки (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return json;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ChatResponse {
  ok: true;
  answer: string;
  /** Сколько инструментов вызвал агент — для отладки и метрик */
  toolCalls: number;
  /** Время ответа в мс */
  ms: number;
}

export async function askAgent(
  question: string,
  history: ChatTurn[],
  sessionId?: string,
): Promise<ChatResponse> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history, sessionId }),
  });

  const json = (await res.json()) as ChatResponse | ApiError;
  if (!res.ok || !("ok" in json) || json.ok !== true) {
    const msg = "error" in json ? json.error : `Ошибка чата (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return json;
}
