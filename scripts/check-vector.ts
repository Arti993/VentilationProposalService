/**
 * Проверяет готовность базы к векторному поиску.
 *
 * Запуск: node --env-file=.env.local scripts/check-vector.ts
 */
import { connectOnce, closeQuietly } from "../src/db/connection.ts";

async function main() {
  const sql = await connectOnce();
  try {
    const ver = await sql<{ version: string }[]>`SELECT version()`;
    console.log("Postgres:", ver[0]!.version.split(",")[0]);

    const ext = await sql<{ name: string; default_version: string }[]>`
      SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector'
    `;
    console.log(
      "pgvector доступен:",
      ext.length ? `ДА, версия ${ext[0]!.default_version}` : "НЕТ",
    );

    const installed = await sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    console.log("pgvector установлен:", installed.length ? "ДА" : "НЕТ");

    // Размерность эмбеддингов bge-m3 — 1024
    if (installed.length) {
      const dim = await sql<{ atttypmod: number }[]>`
        SELECT atttypmod FROM pg_attribute
        WHERE attrelid = 'price_items'::regclass AND attname = 'embedding'
      `;
      console.log("колонка embedding:", dim.length ? `тип с модификатором ${dim[0]!.atttypmod}` : "нет");
    }
  } finally {
    await closeQuietly(sql);
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
