/**
 * Применение SQL-миграций напрямую, без drizzle-kit.
 *
 * Зачем: drizzle-kit при работе через Neon-пулер записал миграцию в свой
 * журнал, но таблицы не создал — и повторный запуск считает её применённой.
 * Прямое выполнение SQL проверяемо: читаем файл, выполняем, проверяем
 * результат запросом.
 *
 * Запуск: node --env-file=.env.local scripts/migrate.ts
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL не задан");
  process.exit(1);
}

/**
 * Neon-пулер закрывает соединение после нескольких операторов DDL.
 * Поэтому держим не одно соединение на прогон, а переподключаемся
 * перед каждым оператором — DDL в Postgres транзакционен и идемпотентность
 * проверяется отдельно (см. обработку "already exists").
 */
function connect() {
  return postgres(url, { ssl: "require", prepare: false, max: 1, connect_timeout: 20 });
}

/** Разбивает файл миграции на отдельные операторы по маркеру drizzle. */
function splitStatements(content: string): string[] {
  return content
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
}

async function runStatement(stmt: string): Promise<void> {
  const sql = connect();
  try {
    await sql.unsafe(stmt);
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      /* пулер уже закрыл — нормально */
    }
  }
}

async function main() {
  const dir = path.join(process.cwd(), "drizzle");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (!files.length) {
    console.error("Нет .sql файлов в drizzle/");
    process.exit(1);
  }

  console.log(`Найдено миграций: ${files.length}\n`);

  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), "utf8");
    const statements = splitStatements(content);
    console.log(`${file}: ${statements.length} операторов`);

    for (const stmt of statements) {
      const preview = stmt.replace(/\s+/g, " ").slice(0, 70);
      try {
        await runStatement(stmt);
        console.log(`  ok  ${preview}…`);
      } catch (e) {
        const msg = (e as Error).message;
        // Повторный запуск на уже готовой базе — не ошибка
        if (msg.includes("already exists")) {
          console.log(`  --  уже существует: ${preview}…`);
          continue;
        }
        console.error(`  ОШИБКА: ${msg}`);
        console.error(`  SQL: ${stmt.slice(0, 300)}`);
        throw e;
      }
    }
  }

  // Проверяем результат фактически, а не по логу
  const sql = connect();
  try {
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name
    `;
    console.log(`\nТаблиц в public: ${tables.length}`);
    for (const t of tables) console.log(`  ${t.table_name}`);

    const expected = ["estimate_positions", "estimates", "price_items"];
    const actual = tables.map((t) => t.table_name);
    const missing = expected.filter((e) => !actual.includes(e));

    if (missing.length) {
      console.error(`\nНЕ СОЗДАНЫ: ${missing.join(", ")}`);
      process.exitCode = 1;
    } else {
      // Проверяем индексы отдельно: без них поиск по прайсу деградирует
      const idx = await sql<{ indexname: string }[]>`
        select indexname from pg_indexes where schemaname = 'public' order by indexname
      `;
      console.log(`\nИндексов: ${idx.length}`);
      for (const i of idx) console.log(`  ${i.indexname}`);
      console.log("\nOK: все таблицы на месте");
    }
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
