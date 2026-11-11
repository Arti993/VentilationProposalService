/**
 * LLM-клиент на LangChain.
 *
 * Провайдер polza.ai предоставляет OpenAI-совместимый API, поэтому
 * используем ChatOpenAI с подменённым baseURL — стандартный приём
 * для работы с любым OpenAI-совместимым шлюзом.
 *
 * Здесь только транспорт и настройки модели. Бизнес-логика (какая цена,
 * что считать совпадением) остаётся в обычном TypeScript — это осознанно:
 * LLM-фреймворк не должен владеть денежной логикой.
 */
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";

/** Ошибка уровня приложения, отделяющая сетевые сбои от логических. */
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

export const DEFAULT_AGENT_MODEL = "deepseek/deepseek-v4.1-flash-1017";
export const DEFAULT_RESOLVER_MODEL = "deepseek/deepseek-v4.1-flash-1017";

function baseUrl(): string {
  return (process.env.POLZA_BASE_URL ?? "https://polza.ai/api/v1").replace(/\/$/, "");
}

function requireKey(): string {
  const k = process.env.POLZA_API_KEY;
  if (!k) {
    throw new LlmError(
      "POLZA_API_KEY не задан. Добавь его в .env.local (файл не коммитится).",
    );
  }
  return k;
}

export interface ModelOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

/**
 * Создаёт экземпляр модели через LangChain.
 *
 * ВАЖНО: reasoning_effort намеренно НЕ передаётся — провайдер отдаёт 401
 * при некоторых сочетаниях параметров (проверено вживую).
 */
export function createChatModel(opts: ModelOptions = {}): ChatOpenAI {
  return new ChatOpenAI({
    model: opts.model ?? process.env.LLM_AGENT_MODEL ?? DEFAULT_AGENT_MODEL,
    temperature: opts.temperature ?? 0,
    maxTokens: opts.maxTokens ?? 1000,
    timeout: opts.timeoutMs ?? 45_000,
    maxRetries: 2,
    apiKey: requireKey(),
    configuration: {
      baseURL: baseUrl(),
    },
  });
}

/** Промпт-шаблон для разбора позиций. */
export function createResolverPrompt() {
  return ChatPromptTemplate.fromMessages([
    ["system", "{system}"],
    ["human", "{user}"],
  ]);
}

/** Проверка доступности провайдера и баланса. */
export async function fetchBalance(): Promise<{ amount: number; available: number }> {
  const res = await fetch(`${baseUrl()}/balance`, {
    headers: { Authorization: `Bearer ${requireKey()}` },
  });
  if (!res.ok) throw new LlmError(`balance ${res.status}`, res.status);
  const j = (await res.json()) as { amount?: string; available?: string };
  return { amount: Number(j.amount ?? 0), available: Number(j.available ?? 0) };
}
