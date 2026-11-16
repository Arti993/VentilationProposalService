/**
 * Миграция 0003: аккаунты, сессии, организации.
 *
 * Запуск: node --env-file=.env.local scripts/apply-migration-0003.ts
 *
 * ПОЧЕМУ НЕ drizzle-kit: пулер Neon рвёт соединение, а drizzle-kit не
 * умеет переподключаться. Операторы идемпотентны, повторный запуск при
 * обрыве безопасен.
 *
 * ПОРЯДОК ВАЖЕН: таблицы ссылаются друг на друга внешними ключами.
 * `user` → `session` → `account`, затем `organization` → `member` →
 * `invitation`. Создавать в другом порядке нельзя: внешний ключ на
 * несуществующую таблицу — ошибка.
 */
import { withRetry } from "../src/db/connection.ts";

type Sql = Parameters<Parameters<typeof withRetry>[0]>[0];

const STATEMENTS: Array<{ title: string; run: (sql: Sql) => Promise<unknown> }> = [
  {
    title: "таблица user",
    run: (sql) => sql`
      create table if not exists "user" (
        id text primary key,
        name text not null,
        email text not null,
        email_verified boolean not null default false,
        image text,
        is_anonymous boolean default false,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `,
  },
  {
    title: "уникальность email",
    run: (sql) => sql`create unique index if not exists user_email_uq on "user" (email)`,
  },
  {
    title: "таблица organization",
    // Создаётся до session: session.active_organization_id ссылается сюда
    run: (sql) => sql`
      create table if not exists organization (
        id text primary key,
        name text not null,
        slug text not null,
        logo text,
        metadata text,
        created_at timestamptz not null default now()
      )
    `,
  },
  {
    title: "уникальность slug организации",
    run: (sql) => sql`create unique index if not exists organization_slug_uq on organization (slug)`,
  },
  {
    title: "таблица session",
    run: (sql) => sql`
      create table if not exists session (
        id text primary key,
        expires_at timestamptz not null,
        token text not null,
        ip_address text,
        user_agent text,
        user_id text not null references "user"(id) on delete cascade,
        active_organization_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `,
  },
  {
    title: "уникальность токена сессии",
    run: (sql) => sql`create unique index if not exists session_token_uq on session (token)`,
  },
  {
    title: "индекс сессий по пользователю",
    run: (sql) => sql`create index if not exists session_user_idx on session (user_id)`,
  },
  {
    title: "таблица account",
    run: (sql) => sql`
      create table if not exists account (
        id text primary key,
        account_id text not null,
        provider_id text not null,
        user_id text not null references "user"(id) on delete cascade,
        access_token text,
        refresh_token text,
        id_token text,
        access_token_expires_at timestamptz,
        refresh_token_expires_at timestamptz,
        scope text,
        password text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `,
  },
  {
    title: "индекс способов входа по пользователю",
    run: (sql) => sql`create index if not exists account_user_idx on account (user_id)`,
  },
  {
    title: "индекс способов входа по провайдеру",
    run: (sql) => sql`create index if not exists account_provider_idx on account (provider_id, account_id)`,
  },
  {
    title: "таблица verification",
    run: (sql) => sql`
      create table if not exists verification (
        id text primary key,
        identifier text not null,
        value text not null,
        expires_at timestamptz not null,
        created_at timestamptz default now(),
        updated_at timestamptz default now()
      )
    `,
  },
  {
    title: "индекс кодов проверки",
    run: (sql) => sql`create index if not exists verification_identifier_idx on verification (identifier)`,
  },
  {
    title: "таблица member",
    run: (sql) => sql`
      create table if not exists member (
        id text primary key,
        organization_id text not null references organization(id) on delete cascade,
        user_id text not null references "user"(id) on delete cascade,
        role text not null default 'member',
        created_at timestamptz not null default now()
      )
    `,
  },
  {
    title: "индекс участников по организации",
    run: (sql) => sql`create index if not exists member_org_idx on member (organization_id)`,
  },
  {
    title: "индекс участников по пользователю",
    run: (sql) => sql`create index if not exists member_user_idx on member (user_id)`,
  },
  {
    title: "один участник — одна строка в организации",
    run: (sql) => sql`
      create unique index if not exists member_org_user_uq
        on member (organization_id, user_id)
    `,
  },
  {
    title: "таблица invitation",
    run: (sql) => sql`
      create table if not exists invitation (
        id text primary key,
        organization_id text not null references organization(id) on delete cascade,
        email text not null,
        role text,
        status text not null default 'pending',
        expires_at timestamptz not null,
        inviter_id text not null references "user"(id) on delete cascade
      )
    `,
  },
  {
    title: "индекс приглашений по организации",
    run: (sql) => sql`create index if not exists invitation_org_idx on invitation (organization_id)`,
  },
  {
    title: "индекс приглашений по адресу",
    run: (sql) => sql`create index if not exists invitation_email_idx on invitation (email)`,
  },
  {
    // Better Auth сверяет свою ожидаемую схему с фактической и падает с
    // SCHEMA_MISMATCH, если колонки не хватает. Это и обнаружилось на
    // первом же вызове регистрации — колонку забыли при первой версии.
    title: "колонка invitation.created_at",
    run: (sql) => sql`
      alter table invitation add column if not exists created_at timestamptz not null default now()
    `,
  },
];

async function main() {
  console.log("Миграция 0003: аккаунты и организации\n");

  let failed = 0;
  for (const s of STATEMENTS) {
    process.stdout.write(`  ${s.title}… `);
    try {
      await withRetry((sql) => s.run(sql) as Promise<unknown>, {
        label: s.title,
        retries: 5,
      });
      console.log("ок");
    } catch (e) {
      failed += 1;
      console.log(`ПРОВАЛ: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
  }

  console.log("\n=== Проверка ===");

  const tables = await withRetry(
    async (sql) =>
      sql<{ table_name: string }[]>`
        select table_name from information_schema.tables
         where table_schema = 'public'
           and table_name in ('user','session','account','verification',
                              'organization','member','invitation')
         order by table_name
      `,
    { label: "таблицы" },
  );
  console.log(`  созданы: ${tables.map((t) => t.table_name).join(", ") || "НЕТ"}`);

  const fks = await withRetry(
    async (sql) =>
      sql<{ count: number }[]>`
        select count(*)::int as count from information_schema.table_constraints
         where constraint_type = 'FOREIGN KEY'
           and table_name in ('session','account','member','invitation')
      `,
    { label: "внешние ключи" },
  );
  console.log(`  внешних ключей: ${fks[0]?.count ?? 0} (ожидается 6)`);

  if (failed > 0) {
    console.log(`\n  провалов: ${failed}`);
    process.exit(1);
  }
  console.log("\n  всё применено");
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
