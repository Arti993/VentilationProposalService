/**
 * Подключение к Postgres.
 *
 * Драйвер `postgres` (postgres.js) — рекомендованный для Neon: он умеет
 * работать по HTTP и через pooler, а на serverless-платформе обычные
 * TCP-соединения быстро исчерпывают лимит.
 *
 * ВАЖНО про Vercel: на каждый холодный старт создаётся новое соединение.
 * Держим клиент в globalThis, чтобы при тёплых вызовах переиспользовать
 * его, а не открывать заново.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

const globalDb = globalThis as unknown as {
  __pgClient?: ReturnType<typeof postgres>;
  __drizzle?: ReturnType<typeof drizzle<typeof schema>>;
};

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL не задан. Добавьте строку подключения Neon в .env.local.",
    );
  }
  return url;
}

/**
 * Клиент БД.
 *
 * Настройки подобраны под Neon-пулер:
 *  - max: 1 — на serverless функции короткоживущие, pool из 10 соединений
 *    быстро упрётся в лимит Neon;
 *  - prepare: false — пулер работает в transaction mode и не поддерживает
 *    именованные prepared statements;
 *  - idle_timeout: 0 — ВАЖНО: ненулевой idle_timeout заставляет клиент
 *    закрывать соединение, пока пулер ещё держит транзакцию, и запрос
 *    падает с CONNECTION_CLOSED. Пусть закрывает сам пулер.
 */
export function getDb() {
  if (globalDb.__drizzle) return globalDb.__drizzle;

  const client = postgres(connectionString(), {
    max: 1,
    idle_timeout: 0,
    max_lifetime: null,
    connect_timeout: 15,
    ssl: "require",
    prepare: false,
    // Явно отключаем автоматическое закрытие: транзакции в Neon идут
    // через пулер, и локальные таймауты рвут их на середине.
    onnotice: () => {},
  });

  const db = drizzle(client, { schema });
  globalDb.__pgClient = client;
  globalDb.__drizzle = db;
  return db;
}

export type Db = ReturnType<typeof getDb>;
export { schema };
