/**
 * Устойчивое подключение к Neon.
 *
 * ПРОБЛЕМА: Neon-пулер в transaction mode агрессивно переиспользует
 * бэкенды и закрывает долгие соединения. Замерено на нашем пулере:
 *  - соединение выдерживает 5 запросов, на шестом рвётся с
 *    CONNECTION_CLOSED, причём клиент ждёт ~19 секунд до таймаута;
 *  - установка нового соединения стоит ~5 секунд (TLS + рукопожатие),
 *    тогда как сам запрос — 0.6 секунды;
 *  - один запрос с текстом больше ~11 КБ тоже рвёт соединение;
 *  - ответ сервера на ~200 строк данных велик для пулера — его нужно
 *    читать постранично.
 *
 * РЕШЕНИЕ: переиспользуемое соединение до 4 запросов (запас на единицу),
 * после чего открываем новое. Ретрай при обрыве — с новым соединением,
 * потому что после CONNECTION_CLOSED старое непригодно.
 *
 * ВАЖНО для колбэка withRetry: соединение приходит готовым, закрывать его
 * нельзя — оно вернётся в пул. Если открыть внутри своё, оно не закроется,
 * и пулер упрётся в лимит подключений. На этих граблях потеряно время.
 */
import postgres from "postgres";

/** Ошибки, после которых имеет смысл повторить запрос. */
const RETRYABLE = [
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "ECONNRESET",
  "57P01",
  "CONNECT_TIMEOUT",
  "IDLE_TIMEOUT",
  // Наш собственный таймаут запроса — тоже повод повторить
  "QUERY_TIMEOUT",
];

/**
 * Предел ожидания одного запроса.
 *
 * Пулер может «повиснуть» вместо явного обрыва: клиент ждёт ~19 секунд,
 * потом получает CONNECTION_CLOSED. Эти 19 секунд в API недопустимы,
 * поэтому обрываем сами через 8 — ретрай на новом соединении быстрее.
 */
const QUERY_TIMEOUT_MS = 8_000;

/**
 * Сколько запросов можно выполнить в одном соединении.
 *
 * Замерено на этом пулере:
 *  - лёгкие запросы (SELECT счётчика) — 5 подряд, на шестом обрыв;
 *  - запрос с вектором 1024 (~7.6 КБ текстом) — ОДИН. Второй подряд
 *    стабильно рвёт соединение, причём клиент ждёт ~19 секунд до
 *    CONNECTION_CLOSED.
 *
 * Поэтому счётчик «сколько осталось» ненадёжен: бюджет зависит от веса
 * запроса. Решение — сообщать вес явно через options.weight, а для
 * тяжёлых соединение открывать заново.
 */
const MAX_OPS_PER_CONNECTION = 4;

/**
 * Сколько соединение может простаивать, прежде чем мы переоткроем его сами.
 *
 * Пулер закрывает простаивающие соединения. Поймать это до запроса нельзя,
 * а после — ждём ~19 секунд таймаута. Поэтому проще переоткрыть заранее.
 */
const IDLE_RECYCLE_MS = 30_000;

/**
 * Установка нового соединения стоит дорого: ~5 секунд на TLS и
 * рукопожатие с этого IP (против 0.6 секунды на сам запрос). Поэтому
 * соединение переиспользуется до MAX_OPS_PER_CONNECTION запросов.
 */
let shared: {
  sql: ReturnType<typeof postgres>;
  ops: number;
  lastUsed: number;
} | null = null;

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

/** Сбрасывает переиспользуемое соединение. Нужно тестам и скриптам. */
export async function resetConnection(): Promise<void> {
  if (shared) {
    const { sql } = shared;
    shared = null;
    await closeQuietly(sql);
  }
}

/**
 * Берёт переиспользуемое соединение, открывая новое при необходимости.
 *
 * Исчерпанное соединение закрываем сами: если дать пулеру сделать это
 * первым, следующий запрос провисит ~19 секунд до таймаута — дороже,
 * чем сразу открыть новое (~5 секунд).
 *
 * idleMs — сколько соединение простояло. Пулер закрывает простаивающие
 * быстрее, чем исчерпанные по счётчику, поэтому долгий простой тоже
 * повод переоткрыть: 19-секундное ожидание хуже 5-секундного коннекта.
 */
async function acquire(forceNew: boolean): Promise<ReturnType<typeof postgres>> {
  const now = Date.now();
  const exhausted = forceNew || (shared !== null && shared.ops >= MAX_OPS_PER_CONNECTION);
  const stale = shared !== null && now - shared.lastUsed > IDLE_RECYCLE_MS;

  if (!shared || exhausted || stale) {
    if (shared) {
      const old = shared.sql;
      shared = null;
      await closeQuietly(old);
    }
    shared = { sql: connectOnce(), ops: 0, lastUsed: now };
    if (process.env.DBG_CONN) console.log("  [db] новое соединение");
  }
  shared.ops++;
  shared.lastUsed = now;
  if (process.env.DBG_CONN) console.log(`  [db] операция #${shared.ops}${forceNew ? " (тяжёлая)" : ""}`);
  return shared.sql;
}

/**
 * Выполняет операцию с переиспользуемым соединением и повтором при обрыве.
 *
 * ВАЖНО: колбэк получает соединение, которое нельзя закрывать — оно
 * вернётся в пул. Если открыть внутри своё, оно не закроется, и пулер
 * упрётся в лимит подключений. Ровно на этих граблях потеряно время при
 * индексации прайса.
 *
 * heavy: true — запрос большого объёма (например, с вектором на 7.6 КБ).
 * Такой запрос «съедает» соединение целиком: второй подряд рвётся. Для
 * тяжёлых соединение открывается заново каждый раз.
 */
export async function withRetry<T>(
  fn: (sql: ReturnType<typeof postgres>) => Promise<T>,
  {
    retries = 3,
    label = "запрос",
    heavy = false,
  }: { retries?: number; label?: string; heavy?: boolean } = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const sql = await acquire(heavy);
    // Таймер создаётся ДО запроса и обязательно очищается в finally:
    // иначе он продолжает жить после успеха, держит event loop и через
    // 8 секунд «срабатывает» на уже завершённый запрос.
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        fn(sql),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`QUERY_TIMEOUT: ${label} не ответил за ${QUERY_TIMEOUT_MS}мс`)),
            QUERY_TIMEOUT_MS,
          );
        }),
      ]);

      // Тяжёлый запрос израсходовал соединение — следующий откроет новое
      if (heavy) await resetConnection();

      return result;
    } catch (e) {
      lastError = e;
      // Соединение после обрыва непригодно — выбрасываем его целиком.
      // Повтор на том же объекте бессмысленен, он уже мёртв.
      if (isRetryable(e)) await resetConnection();
      if (!isRetryable(e) || attempt === retries) throw e;
      const delay = 200 * 2 ** (attempt - 1);
      console.warn(`  ${label}: обрыв соединения, повтор ${attempt + 1}/${retries} через ${delay}мс`);
      await new Promise((r) => setTimeout(r, delay));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  throw lastError;
}
