/**
 * Применяет произвольный SQL-файл к базе.
 *
 * Запуск: node --env-file=.env.local scripts/run-sql.ts drizzle/0001_pgvector.sql
 *
 * Почему не drizzle-kit migrate: на этом пулере соединение живёт 4-5
 * запросов, и drizzle-kit успевал записать миграцию в свой журнал, но не
 * создать таблицы. Здесь каждое утверждение идёт со своим соединением.
 */
import fs from "node:fs";
import { connectOnce, closeQuietly, withRetry } from "../src/db/connection.ts";

const file = process.argv[2];
if (!file) {
  console.error("Укажите SQL-файл: node scripts/run-sql.ts путь/к/файлу.sql");
  process.exit(1);
}

/** Режем файл по точкам с запятой, пропуская комментарии и пустые куски. */
function splitStatements(sql: string): string[] {
  const noComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return noComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  const sql = fs.readFileSync(file, "utf8");
  const statements = splitStatements(sql);
  console.log(`Файл: ${file}`);
  console.log(`Утверждений: ${statements.length}\n`);

  for (const [i, stmt] of statements.entries()) {
    const preview = stmt.replace(/\s+/g, " ").slice(0, 70);
    try {
      await withRetry(
        async () => {
          const conn = await connectOnce();
          try {
            await conn.unsafe(stmt);
          } finally {
            await closeQuietly(conn);
          }
        },
        { label: `stmt ${i + 1}` },
      );
      console.log(`  ${i + 1}. OK  ${preview}…`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // «уже существует» — не ошибка, миграция идемпотентна
      if (/already exists|duplicate/i.test(msg)) {
        console.log(`  ${i + 1}. УЖЕ ЕСТЬ  ${preview}…`);
      } else {
        console.error(`  ${i + 1}. ОШИБКА  ${preview}…`);
        console.error(`     ${msg}`);
        process.exit(1);
      }
    }
  }

  console.log("\nГотово");
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
