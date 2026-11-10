/**
 * Устойчивое подключение к Neon.
 *
 * ПРОБЛЕМА, которую здесь решаем: Neon-пулер закрывает соединение после
 * нескольких запросов (в наших тестах — после 3-4). Транзакция с массовой
 * вставкой не выживает, падает с CONNECTION_CLOSED.
 *
 * Почему так: пулер работает в transaction mode и агрессивно переиспользует
 * бэкенды. Долгие соединения с накопленной сессией он закрывает.
 *
 * РЕШЕНИЕ: вместо одного долгого соединения — короткие операции, каждая
 * со своим соединением, и ретрай при обрыве. Для записи это означает:
 * отказ от больших транзакций, вставка батчами, идемпотентность через
 * предварительную очистку.
 */
import postgres from "postgres";

/** Ошибки, после которых имеет смысл повторить запрос. */
const RETRYABLE = ["CONNECTION_CLOSED", "CONNECTION_ENDED", "ECONNRESET", "57P01"];

function isRetryable(e: unknown): boolean {
  const err = e as Error & { code?: string };
  const text = `${err.code ?? ""} ${err.message ?? ""}`;
  return RETRYABLE.some((r) => text.includes(r));
}

/** Одноразовое соединение: открыли, сделали, закрыли. */
export function connectOnce(timeoutMs = 20_000): ReturnType<typeof postgres> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");

  return postgres(url, {
    ssl: "require",
    prepare: false,
    max: 1,
    connect_timeout: Math.ceil(timeoutMs / 1000),
    idle_timeout: 0,
  });
}

/** Закрывает соединение, гася ошибки пулера. */
export async function closeQuietly(
  sql: ReturnType<typeof postgres>,
): Promise<void> {
  try {
    await sql.end({ timeout: 5 });
  } catch {
    // Пулер уже закрыл соединение — это нормально, не ошибка
  }
}

/**
 * Выполняет операцию со свежим соединением и повтором при обрыве.
 *
 * retries: 3 — пулер рвёт нечасто, трёх попыток хватает с запасом.
 * Задержка растёт: 200мс, 400мс, 800мс.
 */
export async function withRetry<T>(
  fn: (sql: ReturnType<typeof postgres>) => Promise<T>,
  { retries = 3, label = "запрос" }: { retries?: number; label?: string } = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const sql = connectOnce();
    try {
      return await fn(sql);
    } catch (e) {
      lastError = e;
      if (!isRetryable(e) || attempt === retries) throw e;
      const delay = 200 * 2 ** (attempt - 1);
      console.warn(`  ${label}: обрыв соединения, повтор ${attempt + 1}/${retries} через ${delay}мс`);
      await new Promise((r) => setTimeout(r, delay));
    } finally {
      await closeQuietly(sql);
    }
  }

  throw lastError;
}
