/**
 * Показывает состояние счётчиков расхода в базе.
 *
 * Запуск: node --env-file=.env.local scripts/show-usage.ts
 *
 * Нужен, чтобы отличать «лимит работает» от «лимит молча пропускает
 * всё, потому что база недоступна»: fail-open не должен быть незаметным.
 * Если таблица пуста, а запросы шли — значит, счётчик падал.
 */
import { withRetry } from "../src/db/connection.ts";

interface Row {
  scope: string;
  bucket_key: string;
  window_start: Date;
  requests: number;
  tokens_in: number;
  tokens_out: number;
}

async function main() {
  console.log("Состояние счётчиков расхода\n");

  const rows = await withRetry(
    async (sql) =>
      sql<Row[]>`
        select scope, bucket_key, window_start, requests, tokens_in, tokens_out
          from usage_counters
         order by window_start desc, requests desc
         limit 20
      `,
    { label: "счётчики" },
  );

  if (rows.length === 0) {
    console.log("  таблица пуста");
  } else {
    console.log("  окно (UTC)         ключ                запросов   токены вх/исх");
    console.log("  " + "─".repeat(74));
    for (const r of rows) {
      const when = new Date(r.window_start).toISOString().slice(0, 16).replace("T", " ");
      const key = r.bucket_key.padEnd(18).slice(0, 18);
      const req = String(r.requests).padStart(8);
      const tok = `${r.tokens_in}/${r.tokens_out}`;
      console.log(`  ${when}  ${key}  ${req}   ${tok}`);
    }
  }

  const totals = await withRetry(
    async (sql) =>
      sql<{ requests: number; tokens_in: number; tokens_out: number }[]>`
        select coalesce(sum(requests),0)::int as requests,
               coalesce(sum(tokens_in),0)::int as tokens_in,
               coalesce(sum(tokens_out),0)::int as tokens_out
          from usage_counters
      `,
    { label: "итоги" },
  );

  const t = totals[0];
  console.log(
    `\n  всего: запросов ${t?.requests ?? 0}, токенов ${(t?.tokens_in ?? 0) + (t?.tokens_out ?? 0)}`,
  );

  // История диалога
  const chats = await withRetry(
    async (sql) =>
      sql<{ n: number; convs: number }[]>`
        select count(*)::int as n, count(distinct conversation_id)::int as convs
          from chat_messages
      `,
    { label: "история" },
  );
  console.log(
    `  реплик в истории: ${chats[0]?.n ?? 0} в ${chats[0]?.convs ?? 0} диалогах`,
  );
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
