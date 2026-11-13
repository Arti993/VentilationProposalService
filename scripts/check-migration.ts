/**
 * Проверяет, применилась ли миграция и работает ли эндпоинт.
 *
 * Запуск: node --env-file=.env.local scripts/check-migration.ts
 */
import { withRetry } from "../src/db/connection.ts";
import { loadPrice } from "../src/db/repositories/price.ts";

async function main() {
  console.log("=== Колонка notified_at ===");
  const cols = await withRetry(
    async (sql) =>
      sql<{ column_name: string; data_type: string }[]>`
        select column_name, data_type from information_schema.columns
         where table_name = 'estimates' order by ordinal_position
      `,
    { label: "колонки" },
  );
  for (const c of cols) {
    const mark = c.column_name === "notified_at" ? " <-- новая" : "";
    console.log(`  ${c.column_name} (${c.data_type})${mark}`);
  }

  console.log("\n=== Индексы estimates ===");
  const idx = await withRetry(
    async (sql) =>
      sql<{ indexname: string }[]>`
        select indexname from pg_indexes where tablename = 'estimates'
      `,
    { label: "индексы" },
  );
  for (const i of idx) console.log(`  ${i.indexname}`);

  console.log("\n=== Сметы в базе ===");
  const est = await withRetry(
    async (sql) =>
      sql<{ id: string; name: string; total_sum: string; priced_count: number; notified_at: Date | null }[]>`
        select id, name, total_sum, priced_count, notified_at
          from estimates order by created_at desc limit 5
      `,
    { label: "сметы" },
  );
  if (!est.length) console.log("  (пусто)");
  for (const e of est) {
    console.log(`  ${e.id.slice(0, 8)}… ${e.name} — ${e.total_sum} ₽, цен: ${e.priced_count}, notified: ${e.notified_at ?? "нет"}`);
  }

  console.log("\n=== Прайс ===");
  const p = await loadPrice();
  console.log(`  ${p.length} позиций`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
