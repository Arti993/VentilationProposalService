/**
 * Адаптер базы для Better Auth без явных транзакций.
 *
 * ЗАМЕРЫ, КОТОРЫЕ ПРИВЕЛИ К ЭТОМУ ФАЙЛУ
 *
 * Полный разбор — docs/INCIDENT-SIGNUP.md. Коротко, всё на этой базе:
 *
 *   три `select` внутри транзакции              → ок, 396 мс
 *   `insert` в `user`, затем `select`           → ок, 401 мс
 *   `insert` в `user`, затем ЛЮБОЙ второй insert → обрыв через 20 с
 *   две записи БЕЗ транзакции, одно соединение  → ок, 425 мс
 *   две записи в РАЗНЫХ соединениях             → ок, 622 мс
 *
 * Вторая ЗАПИСЬ внутри явной транзакции стабильно рвёт канал. Это не наш
 * код: воспроизводится чистым `postgres.js`, без Better Auth и drizzle.
 * При обрыве первый `insert` уже прошёл — пользователь создан, пароля нет.
 *
 * РЕШЕНИЕ
 *
 * Не полагаться на транзакцию там, где можно без неё. Регистрация — две
 * записи (`user`, затем `account`). Выполняем их последовательно, без
 * `BEGIN`; замер подтверждает, что так обе проходят.
 *
 * ЧЕМ ПЛАТИМ
 *
 * Атомарностью. Если вторая запись не пройдёт, первая останется. Именно
 * поэтому `src/lib/auth/signup.ts` после неудачи смотрит факт и убирает
 * недописанного пользователя. Это честная компенсация: не «должно
 * сработать», а «проверим и уберём».
 *
 * Других операций, которым нужна транзакция, в проекте нет: каждая
 * запись в репозиториях — один атомарный запрос.
 */

import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { runIsolated, getDb } from "./client.ts";
import * as authSchema from "./auth-schema.ts";

/** Описание таблиц для адаптера. */
const AUTH_SCHEMA = {
  user: authSchema.user,
  session: authSchema.session,
  account: authSchema.account,
  verification: authSchema.verification,
  organization: authSchema.organization,
  member: authSchema.member,
  invitation: authSchema.invitation,
};

type AnyMethod = (...args: unknown[]) => Promise<unknown>;
type AdapterLike = Record<string, unknown>;

/** Создаёт адаптер поверх переданного клиента. */
function buildAdapter(db: Parameters<typeof drizzleAdapter>[0]): AdapterLike {
  const factory = drizzleAdapter(db, {
    provider: "pg",
    schema: AUTH_SCHEMA,
  }) as unknown as (options: unknown) => AdapterLike;
  return factory({});
}

/**
 * Создаёт адаптер для `betterAuth({ database })`.
 *
 * Возвращает фабрику: Better Auth принимает в `database` только функцию.
 */
export function isolatedDrizzleAdapter() {
  return () => {
    // Имена методов берём с настоящего экземпляра: `drizzleAdapter(...)`
    // возвращает функцию с пустым `Object.keys`, оборачивать надо
    // результат её вызова. Заглушка клиента не годится — с ней адаптер
    // теряет `transaction`.
    const base = buildAdapter(getDb());

    const wrapped: AdapterLike = {};

    for (const name of Object.keys(base)) {
      const value = base[name];

      // `options` и `id` — служебные поля, переносим как есть
      if (typeof value !== "function") {
        wrapped[name] = value;
        continue;
      }

      /**
       * `transaction` — прямой вызов обратного вызова, без `BEGIN`.
       *
       * Better Auth оборачивает регистрацию в `runWithTransaction`, и это
       * единственное место, где транзакция обязательна для него. Мы
       * выполняем тело последовательно: каждая запись внутри получает
       * своё соединение через обёрнутые методы ниже.
       *
       * Отката нет — это и есть осознанный размен. Последствия
       * разбираются проверкой факта в signup.ts.
       */
      if (name === "transaction") {
        wrapped[name] = async (cb: (adapter: unknown) => Promise<unknown>) => cb(wrapped);
        continue;
      }

      // Каждый метод — на своём соединении, с закрытием после ответа
      wrapped[name] = (...args: unknown[]) =>
        runIsolated(async (db) => {
          const fresh = buildAdapter(db);
          const fn = fresh[name] as AnyMethod | undefined;
          if (!fn) throw new Error(`метод адаптера ${name} недоступен`);
          return fn.apply(fresh, args);
        });
    }

    return wrapped;
  };
}
