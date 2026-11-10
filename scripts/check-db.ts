/**
 * Проверка подключения к БД без ORM.
 *
 * Запуск: node --env-file=.env.local scripts/check-db.ts
 *
 * Смысл отдельного скрипта: если что-то не так, надо понять, где именно —
 * в сети, в сертификате, в строке подключения или в правах. ORM прячет
 * эти детали за своими ошибками.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL не задан");
  process.exit(1);
}

// Показываем только безопасную часть строки
try {
  const u = new URL(url);
  console.log("Хост:", u.hostname);
  console.log("База:", u.pathname.slice(1));
  console.log("Пользователь:", u.username);
  console.log("SSL:", u.searchParams.get("sslmode") ?? "не указан");
} catch {
  console.log("Строку подключения не удалось разобрать");
}

const sql = postgres(url, {
  max: 1,
  ssl: "require",
  prepare: false,
  connect_timeout: 15,
});

async function main() {
  try {
    const v = await sql<{ version: string }[]>`select version()`;
    console.log("\nПОДКЛЮЧЕНИЕ: OK");
    console.log(v[0]?.version.split(",")[0]);

    const info = await sql<{ db: string; u: string; now: Date }[]>`
      select current_database() as db, current_user as u, now() as now
    `;
    console.log("База:", info[0]?.db, "| пользователь:", info[0]?.u);
    console.log("Время сервера:", info[0]?.now);

    const ext = await sql<{ extname: string }[]>`
      select extname from pg_extension where extname in ('vector', 'pgcrypto')
    `;
    console.log(
      "Расширения:",
      ext.length ? ext.map((e) => e.extname).join(", ") : "нет (vector понадобится для RAG)",
    );

    // Можем ли создавать таблицы — от этого зависит миграция
    const priv = await sql<{ can: boolean }[]>`
      select has_schema_privilege('public', 'CREATE') as can
    `;
    console.log("Право создавать таблицы:", priv[0]?.can ? "есть" : "НЕТ");

    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name
    `;
    console.log(
      "Таблиц в public:",
      tables.length ? tables.map((t) => t.table_name).join(", ") : "нет — нужна миграция",
    );
  } catch (e) {
    const err = e as Error & { code?: string };
    console.error("\nОШИБКА ПОДКЛЮЧЕНИЯ:", err.message);
    if (err.code) console.error("Код:", err.code);
    process.exitCode = 1;
  } finally {
    // Neon-пулер закрывает простаивающее соединение сам, и sql.end()
    // может упасть с CONNECTION_CLOSED. Для проверки это не ошибка.
    try {
      await sql.end({ timeout: 5 });
    } catch {
      /* соединение уже закрыто пулером — нормально */
    }
  }
}

main();
