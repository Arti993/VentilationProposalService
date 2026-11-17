/**
 * Миграция 0007: время разбора сметы.
 *
 * ЗАЧЕМ
 *
 * Страница `/status` показывает медиану обработки сметы. Без отдельной
 * колонки её приходилось выводить из разницы `created_at` и `notified_at`
 * — то есть времени до того, как смету забрал n8n. На живой базе это
 * дало «4 017 377 мс» (67 минут) вместо реальных трёх секунд.
 *
 * Метрика, врущая в тысячу раз, хуже отсутствующей.
 *
 * ЧТО ДЕЛАЕТ
 *
 * Добавляет `parse_ms integer`. Идемпотентно: повторный запуск ничего не
 * меняет. У старых строк колонка останется `null` — медиана считается по
 * тем, у кого есть значение.
 */

import { withRetry } from "../src/db/connection.ts";

async function main() {
  console.log("Миграция 0007: время разбора сметы\n");

  const before = await withRetry(
    (sql) =>
      sql<{ exists: boolean }[]>`
        select exists (
          select 1 from information_schema.columns
           where table_schema = 'public'
             and table_name = 'estimates'
             and column_name = 'parse_ms'
        ) as exists
      `,
    { label: "проверка колонки" },
  );

  if (before[0]?.exists) {
    console.log("  колонка parse_ms уже есть");
  } else {
    console.log("  добавляю parse_ms…");
    await withRetry(
      async (sql) => {
        await sql`alter table estimates add column if not exists parse_ms integer`;
      },
      { label: "добавление колонки", heavy: true, retries: 2 },
    );
    console.log("  готово");
  }

  // ── Итог ─────────────────────────────────────────────────
  const cols = await withRetry(
    (sql) =>
      sql<{ column_name: string; data_type: string }[]>`
        select column_name, data_type
          from information_schema.columns
         where table_schema = 'public' and table_name = 'estimates'
         order by ordinal_position
      `,
    { label: "колонки estimates" },
  );

  console.log("\n  Колонки estimates:");
  for (const c of cols) console.log(`    ${c.column_name.padEnd(20)} ${c.data_type}`);

  const stats = await withRetry(
    (sql) =>
      sql<{ total: number; with_ms: number; median: number | null }[]>`
        select count(*)::int as total,
               count(parse_ms)::int as with_ms,
               percentile_cont(0.5) within group (order by parse_ms)::int as median
          from estimates
      `,
    { label: "сводка по времени" },
  );

  const s = stats[0];
  console.log(`\n  Смет всего: ${s?.total ?? 0}, с временем: ${s?.with_ms ?? 0}`);
  console.log(`  Медиана (там, где есть): ${s?.median ?? "—"} мс`);

  console.log("\nМиграция 0007 завершена.");
  process.exit(0);
}

main().catch((e) => {
  console.error("ошибка миграции:", e instanceof Error ? e.message : e);
  process.exit(1);
});
