/**
 * Показывает состояние индексации.
 *
 * Запуск: node --env-file=.env.local scripts/index-status.ts
 */
import { connectOnce, closeQuietly } from "../src/db/connection.ts";

async function main() {
  const conn = await connectOnce();
  try {
    const r = await conn<{ total: string; indexed: string }[]>`
      SELECT count(*)::text AS total, count(embedding)::text AS indexed
      FROM price_items
    `;
    const total = Number(r[0]!.total);
    const indexed = Number(r[0]!.indexed);
    console.log(`Проиндексировано: ${indexed} из ${total}`);
    if (indexed < total) {
      console.log(`Осталось: ${total - indexed}`);

      const sample = await conn<{ code: string; raw_name: string }[]>`
        SELECT code, raw_name FROM price_items WHERE embedding IS NULL ORDER BY id LIMIT 3
      `;
      console.log("Первые неиндексированные:", sample.map((s) => `${s.code} ${s.raw_name}`).join("; "));
    }
  } finally {
    await closeQuietly(conn);
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
