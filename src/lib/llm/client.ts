/**
 * Клиент провайдера LLM (polza.ai — OpenAI-совместимый API).
 *
 * Принципы, заложенные сознательно:
 *  - ключ берётся ТОЛЬКО из окружения, никогда не хардкодится;
 *  - retry с экспоненциальной задержкой: облачные провайдеры регулярно
 *    отдают 429/503, и падать на этом нельзя;
 *  - явный таймаут: иначе функция на Vercel «съест» весь лимит времени;
 *  - никакой бизнес-логики — только транспорт.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface JsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Принудительный JSON по схеме — основной режим для матчинга */
  jsonSchema?: JsonSchemaFormat;
  timeoutMs?: number;
  retries?: number;
}

export class LlmError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "LlmError";
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash-1017";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;

/** Ошибки, которые имеет смысл повторять (сеть, перегрузка, лимиты). */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function baseUrl(): string {
  return (process.env.POLZA_BASE_URL ?? "https://polza.ai/api/v1").replace(/\/$/, "");
}

function apiKey(): string {
  const k = process.env.POLZA_API_KEY;
  if (!k) {
    throw new LlmError(
      "POLZA_API_KEY не задан. Добавь его в .env.local (файл не коммитится).",
    );
  }
  return k;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Низкоуровневый вызов chat completions.
 * Возвращает сырой текст ответа модели.
 */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const {
    model = process.env.LLM_AGENT_MODEL ?? DEFAULT_MODEL,
    temperature = 0,
    maxTokens = 1000,
    jsonSchema,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
  } = opts;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  // ВАЖНО: не передаём reasoning_effort. Провайдер отдаёт 401 при "none"
  // в некоторых сочетаниях — проверено вживую.

  if (jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: jsonSchema.name,
        strict: jsonSchema.strict ?? true,
        schema: jsonSchema.schema,
      },
    };
  }

  let lastError: LlmError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${baseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();

      if (!res.ok) {
        let code: string | undefined;
        let msg = text.slice(0, 300);
        try {
          const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
          code = parsed.error?.code;
          msg = parsed.error?.message ?? msg;
        } catch {
          /* тело не JSON — оставляем как есть */
        }

        const err = new LlmError(`LLM ${res.status}: ${msg}`, res.status, code);

        if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
          lastError = err;
          await sleep(2 ** attempt * 500);
          continue;
        }
        throw err;
      }

      const data = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new LlmError("LLM вернул пустой ответ", 200);
      }
      return content;
    } catch (e) {
      const err =
        e instanceof LlmError
          ? e
          : new LlmError(
              e instanceof Error && e.name === "AbortError"
                ? `LLM таймаут ${timeoutMs} мс`
                : String(e),
            );

      // Таймаут и сетевые ошибки повторяем; логические — нет
      const retryable =
        err.status === undefined || RETRYABLE_STATUS.has(err.status ?? 0);

      if (retryable && attempt < retries) {
        lastError = err;
        await sleep(2 ** attempt * 500);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new LlmError("LLM: исчерпаны попытки");
}

/**
 * Вызов с гарантией валидного JSON по схеме.
 * Даже при strict-режиме парсим защищённо: провайдеры бывают непоследовательны.
 */
export async function chatJson<T>(messages: ChatMessage[], opts: ChatOptions): Promise<T> {
  const raw = await chat(messages, opts);
  return parseJsonLoose<T>(raw);
}

/** Убирает возможные ```json-обёртки и мусор вокруг JSON-объекта. */
export function parseJsonLoose<T>(raw: string): T {
  let s = raw.trim();

  // ```json ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // Иногда модель добавляет пояснение до/после объекта
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);

  try {
    return JSON.parse(s) as T;
  } catch (e) {
    throw new LlmError(
      `LLM вернул невалидный JSON: ${String(e)}. Ответ: ${raw.slice(0, 300)}`,
    );
  }
}

/** Проверка доступности провайдера и баланса — для health-check. */
export async function balance(): Promise<{ amount: number; available: number }> {
  const res = await fetch(`${baseUrl()}/balance`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) throw new LlmError(`balance ${res.status}`, res.status);
  const j = (await res.json()) as { amount?: string; available?: string };
  return { amount: Number(j.amount ?? 0), available: Number(j.available ?? 0) };
}
