/**
 * Личная организация пользователя.
 *
 * ЗАЧЕМ ОНА НУЖНА
 *
 * Все данные проекта — сметы, журнал КП, прайс — привязаны к `org_id`.
 * Проверка доступа сравнивает `org_id` сметы с организацией
 * пользователя. Если организации нет, `getActor` возвращает null, код
 * берёт демо-прайс — и все анонимы и «бездомные» пользователи видят
 * одни и те же сметы. На проверке это и вылезло: второй пользователь
 * скачал КП первого.
 *
 * ЗАЧЕМ ЗДЕСЬ ПРЯМОЙ SQL, А НЕ ПЛАГИН
 *
 * Хук `databaseHooks.user.create.after` срабатывает внутри регистрации,
 * где плагин organization ещё ничего не создал. Вызвать
 * `auth.api.createOrganization` оттуда нельзя: он требует сессии,
 * которой на этом шаге ещё нет. Поэтому пишем напрямую — две вставки,
 * каждая своим запросом (транзакции на этой базе ненадёжны, см.
 * docs/INCIDENT-SIGNUP.md).
 */

import { randomUUID } from "node:crypto";
import { runIsolated } from "@/db/client.ts";

/** Проверяет, что slug свободен, и добавляет суффикс, если занят. */
function makeSlug(name: string, userId: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .slice(0, 24)
      .replace(/^-+|-+$/g, "") || "org";

  // Короткий хвост от id: гарантирует уникальность без второго запроса
  return `${base}-${userId.slice(0, 6)}`.toLowerCase();
}

/**
 * Создаёт организацию и делает пользователя её владельцем.
 *
 * Возвращает id организации или null, если у пользователя она уже есть.
 */
export async function ensurePersonalOrganization(
  userId: string,
  userName: string,
): Promise<string | null> {
  // Уже есть — ничего не делаем. Проверка перед вставкой дешевле, чем
  // разбираться с уникальным индексом потом.
  const existing = await runIsolated(async (_db, sql) => {
    const rows = await sql<{ organization_id: string }[]>`
      select organization_id from member where user_id = ${userId} limit 1
    `;
    return rows[0]?.organization_id ?? null;
  });

  if (existing) return null;

  const orgId = randomUUID();
  const memberId = randomUUID();
  const slug = makeSlug(userName, userId);
  const orgName = userName.trim() ? `Организация ${userName.trim()}` : "Моя организация";

  // Две вставки последовательно, каждая своим соединением.
  // Порядок важен: организация должна существовать до участника.
  await runIsolated(async (_db, sql) => {
    await sql`
      insert into organization (id, name, slug, created_at)
      values (${orgId}, ${orgName}, ${slug}, now())
      on conflict (slug) do nothing
    `;
  });

  await runIsolated(async (_db, sql) => {
    await sql`
      insert into member (id, organization_id, user_id, role, created_at)
      values (${memberId}, ${orgId}, ${userId}, 'owner', now())
      on conflict do nothing
    `;
  });

  // Активную организацию ставим в сессию пользователя, чтобы следующий
  // запрос не искал её заново через min(created_at).
  await runIsolated(async (_db, sql) => {
    await sql`
      update session set active_organization_id = ${orgId}
       where user_id = ${userId} and active_organization_id is null
    `;
  });

  return orgId;
}
