/**
 * Состояние базы: таблицы, количество строк, срок жизни сессий.
 *
 * Запуск: node --env-file=.env.local scripts/db-status.ts
 *
 * Нужен, чтобы после деплоя отвечать на вопрос «а база точно подключена
 * и прайс на месте» за один запуск, а не гадать по логам.
 */
import { getDb } from "../src/db/client.ts";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();

  console.log("=== ПОДКЛЮЧЕНИЕ ===");
  const ver = await db.execute(sql`select version() as v`);
  const version = (ver as unknown as Array<{ v: string }>)[0]?.v ?? "?";
  console.log(version.split(",")[0]);

  const now = await db.execute(sql`select now() as t`);
  console.log("время сервера:", (now as unknown as Array<{ t: Date }>)[0]?.t);

  console.log("\n=== ТАБЛИЦЫ ===");
  const tables = await db.execute(sql`
    select table_name,
           (select count(*) from information_schema.columns c
             where c.table_name = t.table_name) as cols
      from information_schema.tables t
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name
  `);
  const rows = tables as unknown as Array<{ table_name: string; cols: string | number }>;
  if (!rows.length) {
    console.log("  таблиц нет — нужно применить миграцию: npm run db:migrate");
  }
  for (const r of rows) {
    console.log(`  ${r.table_name}: ${r.cols} колонок`);
  }

  console.log("\n=== ДАННЫЕ ===");
  const counts = await db.execute(sql`
    select
      (select count(*) from price_items) as price,
      (select count(*) from estimates) as estimates,
      (select count(*) from estimate_positions) as positions
  `);
  const c = (counts as unknown as Array<{ price: string; estimates: string; positions: string }>)[0];
  console.log(`  прайс: ${c?.price ?? 0} позиций`);
  console.log(`  смет: ${c?.estimates ?? 0}`);
  console.log(`  позиций смет: ${c?.positions ?? 0}`);

  if (Number(c?.price ?? 0) === 0) {
    console.log("\n  Прайс пуст. Залить: npm run db:seed");
  }

  console.log("\n=== ПРОБНЫЙ ЗАПРОС ===");
  const sample = await db.execute(sql`
    select code, raw_name, price from price_items
     where type = 'tee' and dims_key = '315/200' limit 1
  `);
  const s = (sample as unknown as Array<{ code: string; raw_name: string; price: string }>)[0];
  console.log(s ? `  ${s.code}: ${s.raw_name} — ${s.price} руб` : "  тройник 315/200 не найден");

  process.exit(0);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
