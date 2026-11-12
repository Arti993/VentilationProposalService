/**
 * Применяет миграцию 0001 напрямую, без drizzle-kit.
 *
 * Запуск: node --env-file=.env.local scripts/apply-migration.ts
 *
 * ПОЧЕМУ НАПРЯМУЮ. drizzle-kit применил первую миграцию, но вторую
 * не смог: пулер Neon рвёт соединение, а drizzle-kit не умеет
 * переподключаться — он крутил индикатор и упал. Наши операторы
 * (ALTER TABLE ADD COLUMN IF NOT EXISTS) безопасны для повторного
 * запуска, поэтому выполняем их сами через withRetry, который умеет
 * переподключаться.
 */
import { withRetry } from "../src/db/connection.ts";

const STATEMENTS: Array<{ title: string; run: (sql: Parameters<Parameters<typeof withRetry>[0]>[0]) => Promise<unknown> }> = [
  {
    title: "колонка notified_at",
    run: (sql) => sql`alter table estimates add column if not exists notified_at timestamp with time zone`,
  },
  {
    title: "колонка embedding",
    run: (sql) => sql`alter table price_items add column if not exists embedding vector(1024)`,
  },
  {
    title: "колонка embedded_at",
    run: (sql) => sql`alter table price_items add column if not exists embedded_at timestamp with time zone`,
  },
  {
    title: "частичный индекс estimates_pending_idx",
    run: (sql) => sql`create index if not exists estimates_pending_idx on estimates (created_at) where notified_at is null`,
  },
  {
    title: "таблица proposal_log",
    run: (sql) => sql`
      create table if not exists proposal_log (
        id serial primary key,
        estimate_id text not null,
        name text not null,
        total_sum numeric(14,2) not null,
        priced_count integer not null,
        total_count integer not null,
        stage text not null default 'sent',
        reminders_sent integer not null default 0,
        next_reminder_at timestamptz,
        closed_at timestamptz,
        note text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `,
  },
  {
    title: "индекс по сроку напоминания",
    run: (sql) => sql`create index if not exists proposal_log_reminder_idx on proposal_log (next_reminder_at)`,
  },
  {
    title: "уникальный индекс по estimate_id",
    run: (sql) => sql`create unique index if not exists proposal_log_estimate_idx on proposal_log (estimate_id)`,
  },
  {
    title: "индекс по стадии",
    run: (sql) => sql`create index if not exists proposal_log_stage_idx on proposal_log (stage, created_at)`,
  },
];

async function main() {
  for (const s of STATEMENTS) {
    process.stdout.write(`  ${s.title}… `);
    try {
      await withRetry((sql) => s.run(sql) as Promise<unknown>, { label: s.title, retries: 5 });
      console.log("ок");
    } catch (e) {
      console.log(`ПРОВАЛ: ${e instanceof Error ? e.message.slice(0, 70) : e}`);
    }
  }

  console.log("\n=== Проверка ===");
  const cols = await withRetry(
    async (sql) =>
      sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_name = 'estimates' order by ordinal_position
      `,
    { label: "колонки" },
  );
  console.log(`  колонки estimates: ${cols.map((c) => c.column_name).join(", ")}`);

  const idx = await withRetry(
    async (sql) => sql<{ indexname: string }[]>`select indexname from pg_indexes where tablename = 'estimates'`,
    { label: "индексы" },
  );
  console.log(`  индексы: ${idx.map((i) => i.indexname).join(", ")}`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
