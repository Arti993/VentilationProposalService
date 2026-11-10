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

/**
 * Скачивает КП в DOCX.
 *
 * Не используем <a href> напрямую: при ошибке сервера браузер показал бы
 * JSON вместо сообщения. Поэтому качаем через fetch, проверяем ответ и
 * сами создаём ссылку для сохранения.
 */
export async function downloadProposal(sessionId: string): Promise<void> {
  const res = await fetch(`/api/proposal/${sessionId}`);

  if (!res.ok) {
    let msg = `Не удалось скачать КП (HTTP ${res.status})`;
    try {
      const json = (await res.json()) as ApiError;
      if (json.error) msg = json.error;
    } catch {
      // Ответ не JSON — оставляем общий текст
    }
    throw new Error(msg);
  }

  // Имя файла берём из заголовка: сервер знает его лучше клиента
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/);
  const asciiMatch = disposition.match(/filename="([^"]+)"/);
  const fileName = utf8Match
    ? decodeURIComponent(utf8Match[1]!)
    : (asciiMatch?.[1] ?? "kp.docx");

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
