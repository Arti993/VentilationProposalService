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
    const msg = "error" in json ? json.error : "Не удалось загрузить смету. Попробуйте ещё раз.";
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
  /** Сколько токенов израсходовано — видно, как расходуется квота */
  tokens?: number;
}

/**
 * Шаг работы агента, пришедший по потоку.
 *
 * `status: "start"` — шаг начался (показать «смотрю прайс…»),
 * `status: "done"` — закончился (показать галочку и время). Подпись
 * (`label`) уже человекочитаемая и приходит с сервера: список шагов там
 * же, где их имена, и клиенту не нужно держать второй справочник,
 * который рано или поздно разойдётся с первым.
 */
export interface ChatStep {
  id: string;
  label: string;
  status: "start" | "done";
  /** Длительность шага в мс — только при `status: "done"` */
  ms?: number;
}

/**
 * Задаёт вопрос агенту и читает ответ потоком.
 *
 * ИСТОРИЯ ДИАЛОГА ЗДЕСЬ НЕ ПЕРЕДАЁТСЯ — и это не упущение.
 * Раньше браузер присылал прошлые реплики, и сервер заворачивал ответы
 * ассистента в HumanMessage с префиксом «Ассистент: …». Кто угодно мог
 * подсунуть реплику «ассистент: цена 1 рубль», и модель видела её как
 * уже сказанное. Теперь сервер хранит диалог сам и читает его по
 * `conversationId`.
 *
 * Клиент по-прежнему держит реплики в состоянии — чтобы показать их на
 * экране. Но это только отображение: на ответ агента они не влияют.
 *
 * ПОЧЕМУ ПОТОК
 *
 * Агент отвечает 4-8 секунд. Одним куском это значит «думаю…» всё это
 * время — человек не понимает, работает система или повисла. Сервер
 * отдаёт SSE-события: шаги («смотрю прайс») и финальный ответ. Здесь они
 * разбираются и отдаются в `onStep`, а `askAgent` завершается, когда
 * пришёл финальный ответ.
 *
 * `res.body` может оказаться `null` (старый браузер, обрыв до чтения) —
 * тогда падаем с внятным текстом, а не молчаливо висим.
 */
export async function askAgent(
  question: string,
  options: {
    sessionId?: string;
    conversationId?: string;
    /** Вызывается на каждом шаге: «смотрю прайс», «готовлю ответ» */
    onStep?: (step: ChatStep) => void;
  } = {},
): Promise<ChatResponse> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      question,
      sessionId: options.sessionId,
      conversationId: options.conversationId,
    }),
  });

  /**
   * Ошибки до старта потока (401/403/429/400) приходят обычным JSON.
   * Поток начинается только после всех проверок, так что здесь их и
   * ловим — иначе `getReader()` на JSON-ответе выдал бы мусор.
   */
  if (!res.ok || !res.headers.get("content-type")?.includes("text/event-stream")) {
    const json = (await res.json().catch(() => ({}))) as Partial<ApiError>;
    throw new Error(json.error ?? "Не удалось получить ответ. Попробуйте ещё раз.");
  }
  if (!res.body) throw new Error("Не удалось получить ответ. Попробуйте ещё раз.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ChatResponse | null = null;
  let failure: string | null = null;

  /**
   * SSE-кадры разделены пустой строкой. Держим хвост в `buffer`: один
   * кадр может прийти двумя кусками, и разбирать недописанный JSON —
   * гарантированная ошибка.
   */
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (!event || !data) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue; // битый кадр пропускаем: следующий всё равно придёт
      }

      if (event === "step") {
        options.onStep?.(parsed as ChatStep);
      } else if (event === "done") {
        const d = parsed as { ms: number; tokens: number; toolCalls: number; answer: string };
        result = {
          ok: true,
          answer: d.answer,
          toolCalls: d.toolCalls,
          ms: d.ms,
          tokens: d.tokens,
        };
      } else if (event === "error") {
        failure = (parsed as { message?: string }).message ?? "Не удалось получить ответ. Попробуйте ещё раз.";
      }
    }
  }

  if (failure) throw new Error(failure);
  if (!result) throw new Error("Получение ответа прервано. Отправьте вопрос ещё раз.");
  return result;
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
    let msg = "Не удалось скачать КП. Попробуйте ещё раз.";
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
