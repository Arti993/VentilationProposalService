/**
 * Проверка доступа на сервере.
 *
 * ГЛАВНОЕ ПРАВИЛО
 *
 * Всё, что пришло от клиента — идентификатор организации, роль, id
 * пользователя — это КОНТЕКСТ, а не доказательство. Права проверяются
 * здесь, по данным из базы, при каждом запросе к защищённому ресурсу.
 *
 * Почему это важно именно в этом проекте: он весь построен на принципе
 * «данные берём с сервера, клиенту не верим». Сессия сметы приходит по
 * ID с сервера, история чата с сервера, цены из базы. Организация не
 * может быть исключением — иначе один из самых очевидных способов
 * утечки (подмена `org_id` в запросе) останется открытым.
 */

import { headers } from "next/headers";
import { auth } from "./auth";
import { DEMO_ORG_ID } from "./org";
import { withRetry } from "@/db/connection";

export interface Actor {
  /** Пользователь, от имени которого идёт запрос */
  userId: string;
  /** Организация — владелец данных */
  orgId: string;
  /** Роль в организации: owner | admin | member */
  role: OrganizationRole;
  /** Анонимный аккаунт — доступ урезан */
  isAnonymous: boolean;
  email: string | null;
  /**
   * Имя, которое человек ввёл сам.
   *
   * Нужно шапке: показывать «Василий», а не адрес почты. Почта — это
   * логин, её не выбирают, и в интерфейсе она читается как техническая
   * деталь. Имя человек писал сам, и оно делает экран «своим».
   */
  name: string;
  /**
   * Аватар — data URL (см. кабинет) или ссылка.
   *
   * `null` — картинки нет, интерфейс покажет инициалы. Отдельного поля
   * для «инициалов» не заводим: они выводятся из имени и не требуют
   * хранения.
   */
  image: string | null;
}

export type OrganizationRole = "owner" | "admin" | "member";

/** Роли, которым разрешено менять настройки и удалять данные. */
const ADMIN_ROLES: ReadonlySet<OrganizationRole> = new Set(["owner", "admin"]);

/**
 * Текущий пользователь и его организация — или null, если не вошёл.
 *
 * Возвращает null вместо исключения: вызывающий код сам решает, что
 * делать — отдать 401 или обслужить анонимно.
 */
export async function getActor(): Promise<Actor | null> {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;

  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (e) {
    // Недоступная база не должна выглядеть как «пользователь вошёл без
    // организации». Это разные состояния, и различать их важно.
    console.error(
      "[auth] не удалось прочитать сессию:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }

  if (!session?.user) return null;

  const isAnonymous =
    (session.user as { isAnonymous?: boolean }).isAnonymous === true ||
    (session.user.email ?? "").toLowerCase().endsWith("@anon.local");

  const orgId = await resolveOrganizationId(session.user.id, session.session.activeOrganizationId);

  /**
   * Гость живёт в демо-организации.
   *
   * Плагин anonymous создаёт пользователя без организации — так и
   * задумано. Ему нужен демо-прайс и демо-сметы, иначе кнопка «попробовать
   * без регистрации» показывает пустой экран, где ни одна позиция не
   * находит цены. Работодатель, открывший ссылку из резюме, видит
   * сервис без цен — то есть не видит сервиса.
   */
  if (!orgId && isAnonymous) {
    return {
      userId: session.user.id,
      orgId: DEMO_ORG_ID,
      role: "member",
      isAnonymous: true,
      email: session.user.email ?? null,
      name: session.user.name ?? "",
      image: (session.user as { image?: string | null }).image ?? null,
    };
  }

  /**
   * Пользователь с аккаунтом, но без организации.
   *
   * Такого быть не должно: при регистрации создаётся личная (см.
   * `lib/auth/organization.ts`). Но если это случится — возвращаем
   * АКТОРА С ПУСТЫМ `orgId`, а не отдаём null.
   *
   * Почему не null: `null` означает «гость», и вызывающий код подставит
   * демо-прайс. Тогда пользователь с аккаунтом попадает в общую
   * организацию и видит чужие сметы — ровно то, что выяснилось на
   * проверке изоляции.
   *
   * Пустой `orgId` код проверок трактует как «нет доступа»: смета не
   * найдена, данные не показаны. Сказать «у вас нет организации» —
   * честнее, чем молча отдать чужое.
   */
  if (!orgId) {
    return {
      userId: session.user.id,
      orgId: "",
      role: "member",
      isAnonymous,
      email: session.user.email ?? null,
      name: session.user.name ?? "",
      image: (session.user as { image?: string | null }).image ?? null,
    };
  }

  const role = await resolveRole(orgId, session.user.id);

  return {
    userId: session.user.id,
    orgId,
    role,
    isAnonymous,
    email: session.user.email ?? null,
    name: session.user.name ?? "",
    image: (session.user as { image?: string | null }).image ?? null,
  };
}

/**
 * Организация, от имени которой смотрит запрос.
 *
 * РАЗНИЦА МЕЖДУ `??` И `||` ЗДЕСЬ КРИТИЧНА
 *
 * `getActor` возвращает актора с ПУСТЫМ `orgId`, если у пользователя нет
 * организации. Через `||` пустая строка превращалась в демо-прайс — и
 * пользователь с аккаунтом видел общие сметы. Именно так на проверке
 * изоляции второй пользователь скачал КП первого.
 *
 * Через `??` пустая строка сохраняется, и `getSession(id, "")` ничего не
 * находит: доступа нет. Отказ вместо утечки.
 *
 * Гость (`getActor` вернул null) по-прежнему попадает в демо-прайс — там
 * и живут демо-сметы, которые можно показать без регистрации.
 */
export function viewerOrganization(actor: Actor | null): string {
  if (!actor) return DEMO_ORG_ID;
  return actor.orgId ?? "";
}

/**
 * Организация пользователя для проверки участия.
 *
 * В сессии лежит выбранная организация, но доверять ей как разрешению
 * нельзя: она проверяется участием в `member`. Если выбранная не
 * подтверждается — берём личную организацию пользователя (первую, где
 * он владелец). Так подмена `activeOrganizationId` в cookie не даёт
 * доступа к чужой.
 */
async function resolveOrganizationId(
  userId: string,
  selected: string | null | undefined,
): Promise<string | null> {
  try {
    return await withRetry(
      async (sql) => {
        if (selected) {
          const ok = await sql<{ organization_id: string }[]>`
            select organization_id from member
             where user_id = ${userId} and organization_id = ${selected}
             limit 1
          `;
          if (ok.length > 0) return ok[0]!.organization_id;
        }

        const own = await sql<{ organization_id: string }[]>`
          select organization_id from member
           where user_id = ${userId}
           order by (role = 'owner') desc, created_at asc
           limit 1
        `;
        return own[0]?.organization_id ?? null;
      },
      { label: "организация пользователя" },
    );
  } catch (e) {
    console.error(
      "[auth] не удалось определить организацию:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/** Роль пользователя в организации, проверенная по базе. */
async function resolveRole(orgId: string, userId: string): Promise<OrganizationRole> {
  try {
    const rows = await withRetry(
      async (sql) =>
        sql<{ role: string }[]>`
          select role from member
           where organization_id = ${orgId} and user_id = ${userId}
           limit 1
        `,
      { label: "роль участника" },
    );

    const role = rows[0]?.role;
    return role === "owner" || role === "admin" ? role : "member";
  } catch {
    // Не смогли прочитать роль — считаем минимальной. Ошибка в сторону
    // отказа, а не доступа.
    return "member";
  }
}

/** Может ли участник менять настройки организации. */
export function canAdminister(actor: Actor): boolean {
  return ADMIN_ROLES.has(actor.role);
}

/**
 * Ошибка доступа в формате, готовом для NextResponse.
 *
 * Возвращает объект, а не бросает исключение: маршруты уже оформлены
 * как «верни NextResponse при любой проблеме», и смешивать два стиля
 * в одном файле — значит однажды забыть catch.
 */
export function denied(
  actor: Actor | null,
): { status: number; body: { ok: false; error: string } } {
  if (!actor) {
    return {
      status: 401,
      body: { ok: false, error: "Нужен вход в аккаунт." },
    };
  }
  return {
    status: 403,
    body: {
      ok: false,
      error: "Недостаточно прав: действие доступно владельцу или администратору организации.",
    },
  };
}
