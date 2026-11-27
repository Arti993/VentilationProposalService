/**
 * Регистрация и вход с проверкой результата после обрыва.
 *
 * ПРОБЛЕМА (подробно — docs/INCIDENT-SIGNUP.md)
 *
 * Регистрация в Better Auth идёт в транзакции: `insert` в `user`, затем
 * `insert` в `account` с паролем. Канал до Neon теряет ответ примерно у
 * каждой третьей-четвёртой транзакции: `COMMIT` доходит, данные
 * записаны, но клиент видит `CONNECTION_CLOSED` через ~19 секунд.
 *
 * Отсюда две беды:
 *
 *  1. Повторять нельзя — транзакция, «упавшая» с ошибкой, уже записала
 *     данные, и повтор создаст вторую строку.
 *  2. Молча возвращать ошибку тоже нельзя — пользователь может быть уже
 *     создан, и человек будет пробовать регистрацию заново, получая
 *     «адрес занят» на собственный аккаунт, войти в который не может,
 *     если пароль не записался.
 *
 * РЕШЕНИЕ
 *
 * После ошибки соединения не угадываем, а СМОТРИМ ФАКТ: есть ли
 * пользователь с таким адресом и есть ли у него пароль. Три исхода:
 *
 *  - пользователь есть, пароль есть  → регистрация прошла, предлагаем
 *    войти;
 *  - пользователь есть, пароля нет   → половина записи: чистим мусор и
 *    просим повторить;
 *  - пользователя нет                → честная ошибка, просим повторить.
 */

import type postgres from "postgres";
import { runIsolated } from "@/db/client.ts";

export type SignUpOutcome =
  | { kind: "ok" }
  | { kind: "created-but-needs-login" }
  | { kind: "retry"; reason: string };

/**
 * Что известно об адресе после неудачной регистрации.
 *
 * Читаем через `withRetry` из `connection.ts`: это отдельные лёгкие
 * запросы, они переживают обрыв.
 */
async function inspectUser(
  email: string,
): Promise<{ exists: boolean; hasPassword: boolean; userId: string | null }> {
  return runIsolated(async (_db, sql) => {
    const rows = await sql<{ id: string; password: string | null }[]>`
      select u.id, a.password
        from "user" u
        left join account a
          on a.user_id = u.id and a.provider_id = 'credential'
       where lower(u.email) = lower(${email})
       limit 1
    `;

    const row = rows[0];
    if (!row) return { exists: false, hasPassword: false, userId: null };
    return {
      exists: true,
      hasPassword: Boolean(row.password),
      userId: row.id,
    };
  });
}

/**
 * Убирает пользователя без пароля.
 *
 * Такая запись бесполезна: войти нельзя, а адрес занят. Оставлять её —
 * значит запереть человека снаружи собственного аккаунта.
 *
 * ВАЖНО ПРО ДОСТУП К БАЗЕ
 *
 * Здесь нет `withRetry` из `connection.ts`: его трёхсекундный таймаут
 * оказался слишком коротким для этой операции, и уборка сама падала с
 * `QUERY_TIMEOUT`. Каждый DELETE выполняется в своём соединении, которое
 * закрывается после ответа, — ровно тот приём, что и в замерах. Обрыв
 * одного DELETE не мешает остальным.
 */
async function removeBrokenUser(userId: string): Promise<void> {
  const steps: Array<[string, (sql: ReturnType<typeof postgres>) => Promise<unknown>]> = [
    ["member", (sql) => sql`delete from member where user_id = ${userId}`],
    ["session", (sql) => sql`delete from session where user_id = ${userId}`],
    ["account", (sql) => sql`delete from account where user_id = ${userId}`],
    ["user", (sql) => sql`delete from "user" where id = ${userId}`],
  ];

  for (const [label, statement] of steps) {
    try {
      await runIsolated(async (_db, sql) => {
        await statement(sql);
      });
    } catch (e) {
      // Не останавливаемся: даже если одна таблица не поддалась, надо
      // попробовать убрать остальные.
      console.warn(
        `  [auth] уборка ${label}: ${e instanceof Error ? e.message.slice(0, 60) : e}`,
      );
    }
  }
}

/**
 * Проверяет, остался ли пользователь без пароля.
 *
 * Нужна после уборки: если DELETE не прошёл из-за того же обрыва, надо
 * хотя бы сказать человеку правду, а не «попробуйте ещё раз».
 */
async function stillBroken(email: string): Promise<boolean> {
  try {
    return await runIsolated(async (_db, sql) => {
      const rows = await sql<{ password: string | null }[]>`
        select a.password from "user" u
          left join account a on a.user_id = u.id and a.provider_id = 'credential'
         where lower(u.email) = lower(${email})
         limit 1
      `;
      if (rows.length === 0) return false;
      return !rows[0]!.password;
    });
  } catch {
    return false;
  }
}

/**
 * Разбирает результат неудачной регистрации.
 *
 * Вызывается, когда `signUpEmail` бросил ошибку. Возвращает, что сказать
 * пользователю.
 */
export async function resolveSignUpFailure(email: string): Promise<SignUpOutcome> {
  try {
    const state = await inspectUser(email);

    if (!state.exists) {
      return {
        kind: "retry",
        reason: "Регистрация не завершилась. Попробуйте ещё раз.",
      };
    }

    if (state.hasPassword) {
      // Пользователь создан полностью: пароль записан, вход возможен
      return { kind: "created-but-needs-login" };
    }

    // Половина записи: пользователь есть, пароля нет
    if (state.userId) await removeBrokenUser(state.userId);

    // Проверяем, что уборка действительно прошла. Если нет — не врём:
    // «попробуйте ещё раз» приведёт к «адрес занят», и человек запутается.
    if (await stillBroken(email)) {
      return {
        kind: "retry",
        reason:
          "Не удалось завершить регистрацию. Попробуйте войти с указанным паролем или повторите регистрацию через минуту.",
      };
    }

    return {
      kind: "retry",
      reason: "Не удалось создать аккаунт. Повторите регистрацию.",
    };
  } catch (e) {
    console.error(
      "[auth] не удалось проверить результат регистрации:",
      e instanceof Error ? e.message : e,
    );
    return {
      kind: "retry",
      reason: "Соединение с сервером прервано. Обновите страницу и проверьте состояние входа.",
    };
  }
}
