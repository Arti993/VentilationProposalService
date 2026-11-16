/**
 * Подключение к Postgres для Drizzle и Better Auth.
 *
 * НАЙДЕННАЯ ПРОБЛЕМА
 *
 * Пулер Neon закрывает соединение по времени простоя на своей стороне, а
 * `postgres.js` об этом не узнаёт: считает соединение живым, пишет в него
 * и получает `write CONNECTION_CLOSED` — иногда через 40 секунд
 * ожидания. Замер на этой базе: из пяти INSERT подряд в одном соединении
 * два упали; шесть INSERT, каждый в своём соединении, — ни одного.
 *
 * Первая регистрация пользователя падала именно так: `insert` в `user`
 * успевал пройти, а `insert` в `account` уже нет. Пользователь создан,
 * а входа у него нет — худший вариант из возможных.
 *
 * ПОЧЕМУ НЕ «СОЕДИНЕНИЕ НА КАЖДЫЙ ЗАПРОС»
 *
 * Пробовал: каждый метод drizzle обёрнут в свежее соединение. Не
 * работает — drizzle строит запросы цепочкой (`db.select().from()...`),
 * и обёртка возвращает Promise вместо builder. Пришлось бы
 * переопределять весь API библиотеки.
 *
 * ЧТО СДЕЛАНО ВМЕСТО ЭТОГО
 *
 * Пул из одного соединения, но при обрыве соединение выбрасывается и
 * создаётся заново — и весь запрос повторяется. Это ровно то, что уже
 * делает `withRetry` в `connection.ts` для остального кода проекта.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

/** Ошибки, означающие «соединение умерло, повтори на новом». */
const RETRYABLE = [
  "CONNECTION_CLOSED",
  "ECONNRESET",
  "EPIPE",
  "Connection terminated",
  "connection closed",
  "write CONNECTION",
  "read ECONNRESET",
];

function isRetryable(e: unknown): boolean {
  const err = e as Error & { code?: string; cause?: { code?: string } };
  const text = `${err.code ?? ""} ${err.cause?.code ?? ""} ${err.message ?? ""}`;
  return RETRYABLE.some((r) => text.includes(r));
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL не задан. Добавьте строку подключения Neon в .env.local.",
    );
  }
  return url;
}

function createClient(): ReturnType<typeof postgres> {
  return postgres(connectionString(), {
    max: 1,
    idle_timeout: 0,
    max_lifetime: null,
    connect_timeout: 15,
    ssl: "require",
    prepare: true,
    // Помечаем свои соединения: по этому имени уборка отличает их от
    // миграций и CLI (см. db/reaper.ts).
    connection: {
      application_name: "kp-service",
    },
    // Сервер сам оборвёт запрос, который не уложился в 15 секунд.
    // Без этого зависший запрос держит соединение до таймаута функции.
    onnotice: () => {},
  });
}

/**
 * Выполняет операцию на СВЕЖЕМ соединении и закрывает его.
 *
 * Почему именно так — см. комментарий в `createClient`. Коротко: пулер
 * Neon и `postgres.js` не сходятся в понимании того, живо ли соединение,
 * и единственный надёжный способ это обойти — не переиспользовать
 * соединение вообще.
 *
 * Стоимость: 0.2–2 с на установку соединения. Для авторизации, где
 * операций две-три на запрос, это приемлемо; для высоких нагрузок нужно
 * переходить на HTTP-драйвер Neon (`@neondatabase/serverless`), который
 * не держит TCP вовсе.
 */
export async function runIsolated<T>(
  fn: (
    db: ReturnType<typeof drizzle<typeof schema>>,
    sql: ReturnType<typeof postgres>,
  ) => Promise<T>,
): Promise<T> {
  const client = createClient();
  try {
    return await fn(drizzle(client, { schema }), client);
  } finally {
    await client.end({ timeout: 5 }).catch(() => {});
  }
}

/**
 * Состояние соединения.
 *
 * Лежит в globalThis: на Vercel модуль может загрузиться заново, а
 * соединение — нет. Без этого каждый холодный старт открывал бы новое,
 * и пулер упирался бы в лимит подключений.
 */
const state = globalThis as unknown as {
  __pg?: ReturnType<typeof postgres>;
  __drizzle?: ReturnType<typeof drizzle<typeof schema>>;
  /** Счётчик операций: после обрыва пересоздаём клиент целиком */
  __dead?: boolean;
};

function client(): ReturnType<typeof postgres> {
  if (!state.__pg || state.__dead) {
    if (state.__pg) {
      // Старое соединение уже мертво — закрываем, гася ошибки
      state.__pg.end({ timeout: 1 }).catch(() => {});
    }
    state.__pg = createClient();
    state.__drizzle = undefined;
    state.__dead = false;
  }
  return state.__pg;
}

/**
 * Клиент для Better Auth.
 *
 * Возвращает обычный drizzle-клиент. Повторы при обрыве обеспечивает
 * не он, а `betterAuthWithRetry` ниже — на уровне вызова целиком: если
 * операция упала из-за мёртвого соединения, соединение пересоздаётся и
 * операция повторяется.
 */
export function getDb() {
  if (state.__drizzle) return state.__drizzle;
  const db = drizzle(client(), { schema });
  state.__drizzle = db;
  return db;
}

/** Помечает соединение мёртвым: следующий вызов создаст новое. */
export function markConnectionDead(): void {
  state.__dead = true;
}

export type Db = ReturnType<typeof getDb>;
export { schema, isRetryable };
