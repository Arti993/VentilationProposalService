/**
 * Миграция 0002: учёт расхода и история диалога.
 *
 * Запуск: node --env-file=.env.local scripts/apply-migration-0002.ts
 *
 * ПОЧЕМУ НЕ drizzle-kit. Та же причина, что и в 0001: пулер Neon рвёт
 * соединение, а drizzle-kit не умеет переподключаться — он зависает и
 * падает. Операторы ниже идемпотентны (`if not exists`), поэтому их
 * безопасно запускать повторно при обрыве.
 *
 * ЧЕГО ЭТИ ТАБЛИЦЫ СТОЯТ ПРИЛОЖЕНИЮ
 *
 * Ни одной новой зависимости. `usage_counters` — счётчик на «ключ + окно»
 * для лимитов; `chat_messages` — история диалога, чтобы она не приезжала
 * из браузера. Обе с индексами под конкретные запросы, которые делает
 * приложение, а не «на всякий случай».
 */
import { withRetry } from "../src/db/connection.ts";

type Sql = Parameters<Parameters<typeof withRetry>[0]>[0];

const STATEMENTS: Array<{ title: string; run: (sql: Sql) => Promise<unknown> }> = [
  {
    title: "таблица usage_counters",
    run: (sql) => sql`
      create table if not exists usage_counters (
        id serial primary key,
        scope text not null,
        bucket_key text not null,
        window_start timestamptz not null,
        requests integer not null default 0,
        tokens_in integer not null default 0,
        tokens_out integer not null default 0,
        updated_at timestamptz not null default now()
      )
    `,
  },
  {
    // Без этого индекса on conflict не сработает, и каждый запрос
    // создавал бы новую строку вместо увеличения счётчика
    title: "уникальность ключа и окна",
    run: (sql) => sql`
      create unique index if not exists usage_counters_key_window_uq
        on usage_counters (scope, bucket_key, window_start)
    `,
  },
  {
    title: "индекс для уборки старых окон",
    run: (sql) => sql`
      create index if not exists usage_counters_window_idx
        on usage_counters (window_start)
    `,
  },
  {
    title: "таблица chat_messages",
    run: (sql) => sql`
      create table if not exists chat_messages (
        id serial primary key,
        estimate_id text,
        conversation_id text not null,
        role text not null,
        text text not null,
        tool_calls integer,
        created_at timestamptz not null default now()
      )
    `,
  },
  {
    // По этому индексу идёт единственный запрос к таблице:
    // «последние N реплик этого диалога»
    title: "индекс по диалогу и времени",
    run: (sql) => sql`
      create index if not exists chat_messages_conversation_idx
        on chat_messages (conversation_id, created_at)
    `,
  },
  {
    title: "индекс по смете",
    run: (sql) => sql`
      create index if not exists chat_messages_estimate_idx
        on chat_messages (estimate_id)
    `,
  },
];

async function main() {
  console.log("Миграция 0002: учёт расхода и история диалога\n");

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
           and table_name in ('usage_counters', 'chat_messages')
         order by table_name
      `,
    { label: "таблицы" },
  );
  console.log(`  созданы: ${tables.map((t) => t.table_name).join(", ") || "НЕТ"}`);

  const counters = await withRetry(
    async (sql) =>
      sql<{ column_name: string; data_type: string }[]>`
        select column_name, data_type from information_schema.columns
         where table_name = 'usage_counters' order by ordinal_position
      `,
    { label: "колонки счётчиков" },
  );
  console.log(`  usage_counters: ${counters.map((c) => `${c.column_name}:${c.data_type}`).join(", ")}`);

  const idx = await withRetry(
    async (sql) =>
      sql<{ indexname: string }[]>`
        select indexname from pg_indexes
         where tablename in ('usage_counters', 'chat_messages')
         order by indexname
      `,
    { label: "индексы" },
  );
  console.log(`  индексы: ${idx.map((i) => i.indexname).join(", ")}`);

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
