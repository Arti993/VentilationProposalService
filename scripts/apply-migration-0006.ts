/**
 * Миграция 0006: таблица обратной связи менеджера.
 *
 * ЗАЧЕМ
 *
 * Система отказывается ставить цену, когда совпадение неоднозначное, и
 * такие строки разбирает человек. Каждый разбор — готовый обучающий
 * пример: «клиент написал так, а имел в виду вот эту позицию». Сейчас
 * этот опыт теряется: менеджер правит КП и уходит.
 *
 * ЧТО ДЕЛАЕТ СКРИПТ
 *
 * Идемпотентно создаёт таблицу `match_feedback` и три индекса. Повторный
 * запуск ничего не ломает — так же, как 0005.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫМ СКРИПТОМ
 *
 * `drizzle-kit migrate` зависает на пулере Neon, поэтому DDL идёт напрямую
 * через `withRetry` (см. INCIDENT-SIGNUP.md и 0005).
 */

import { withRetry } from "../src/db/connection.ts";

async function main() {
  console.log("Миграция 0006: обратная связь менеджера\n");

  // ── 1. Таблица ───────────────────────────────────────────
  const before = await withRetry(
    async (sql) =>
      sql<{ exists: boolean }[]>`
        select exists (
          select 1 from information_schema.tables
           where table_schema = 'public' and table_name = 'match_feedback'
        ) as exists
      `,
    { label: "проверка таблицы" },
  );

  if (before[0]?.exists) {
    console.log("  таблица match_feedback уже есть");
  } else {
    console.log("  создаю match_feedback…");
    await withRetry(
      async (sql) => {
        await sql`
          create table match_feedback (
            id serial primary key,
            org_id text not null,
            estimate_id text,
            pos_no integer,
            raw_text text not null,
            guess_code text,
            chosen_code text,
            note text,
            status text not null default 'new',
            created_at timestamptz not null default now()
          )
        `;
      },
      { label: "создание таблицы", heavy: true, retries: 2 },
    );
    console.log("  готово");
  }

  // ── 2. Индексы — по одному, отдельными запросами ─────────
  //
  // Один запрос с тремя `create index` внутри пулера надёжнее не стал:
  // при обрыве непонятно, что успело создаться. По отдельности каждый
  // шаг идемпотентен (`if not exists`) и повторяется независимо.
  const indexes: Array<{ name: string; sql: string }> = [
    {
      name: "match_feedback_org_idx",
      sql: "create index if not exists match_feedback_org_idx on match_feedback (org_id, created_at)",
    },
    {
      name: "match_feedback_status_idx",
      sql: "create index if not exists match_feedback_status_idx on match_feedback (status)",
    },
    {
      name: "match_feedback_org_estimate_pos_uq",
      sql: "create unique index if not exists match_feedback_org_estimate_pos_uq on match_feedback (org_id, estimate_id, pos_no)",
    },
  ];

  for (const idx of indexes) {
    const present = await withRetry(
      async (sql) =>
        sql<{ exists: boolean }[]>`
          select exists (
            select 1 from pg_indexes
             where tablename = 'match_feedback' and indexname = ${idx.name}
          ) as exists
        `,
      { label: `проверка ${idx.name}` },
    );

    if (present[0]?.exists) {
      console.log(`  ${idx.name} уже есть`);
      continue;
    }

    console.log(`  создаю ${idx.name}…`);
    await withRetry(
      async (sql) => {
        await sql.unsafe(idx.sql);
      },
      { label: `создание ${idx.name}`, heavy: true, retries: 2 },
    );
    console.log("  готово");
  }

  // ── 3. Итог ──────────────────────────────────────────────
  const columns = await withRetry(
    async (sql) =>
      sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
        select column_name, data_type, is_nullable
          from information_schema.columns
         where table_schema = 'public' and table_name = 'match_feedback'
         order by ordinal_position
      `,
    { label: "чтение колонок" },
  );

  console.log("\n  Колонки match_feedback:");
  for (const c of columns) {
    console.log(`    ${c.column_name.padEnd(14)} ${c.data_type.padEnd(26)} null=${c.is_nullable}`);
  }

  const idx = await withRetry(
    async (sql) =>
      sql<{ indexname: string }[]>`
        select indexname from pg_indexes where tablename = 'match_feedback' order by indexname
      `,
    { label: "чтение индексов" },
  );

  console.log("\n  Индексы:");
  for (const i of idx) console.log(`    ${i.indexname}`);

  const count = await withRetry(
    async (sql) => sql<{ n: number }[]>`select count(*)::int as n from match_feedback`,
    { label: "счёт строк" },
  );
  console.log(`\n  Записей: ${count[0]?.n ?? 0}`);

  console.log("\nМиграция 0006 завершена.");
  process.exit(0);
}

main().catch((e) => {
  console.error("ошибка миграции:", e instanceof Error ? e.message : e);
  process.exit(1);
});
