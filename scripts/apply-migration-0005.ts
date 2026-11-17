/**
 * Миграция 0005: код позиции прайса уникален внутри организации.
 *
 * СИТУАЦИЯ
 *
 * Индекс `price_items_code_uq` был объявлен по одной колонке `code`.
 * Пока прайс был один (демо на 215 позиций), это никому не мешало. С
 * загрузкой своих прайсов второй клиент не мог сохранить файл: его
 * позиции тоже начинаются с `p001`, и вставка падала с
 * `duplicate key value violates unique constraint "price_items_code_uq"`.
 *
 * Причина — наш индекс, а не файл клиента. Поэтому меняем его на
 * составной: `(org_id, code)`. Внутри организации код по-прежнему
 * уникален, между организациями — нет.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫМ СКРИПТОМ
 *
 * `drizzle-kit migrate` зависает через пулер Neon (замерено ранее),
 * поэтому миграции применяются скриптами. Здесь важна ещё и очерёдность:
 * удалить старый индекс раньше, чем создать новый, иначе на время между
 * ними ограничение исчезнет и дубли успеют появиться.
 */

import { withRetry } from "../src/db/connection.ts";

async function main() {
  console.log("Миграция 0005: уникальность кода прайса в организации\n");

  // ── 1. Смотрим, что есть сейчас ──────────────────────────
  const existing = await withRetry(
    async (sql) =>
      sql<{ indexname: string; indexdef: string }[]>`
        select indexname, indexdef from pg_indexes
         where tablename = 'price_items'
           and (indexname = 'price_items_code_uq' or indexname = 'price_items_org_code_uq')
      `,
    { label: "чтение индексов" },
  );

  for (const idx of existing) {
    console.log(`  есть: ${idx.indexname}`);
    console.log(`        ${idx.indexdef}`);
  }

  const hasOld = existing.some((i) => i.indexname === "price_items_code_uq");
  const hasNew = existing.some((i) => i.indexname === "price_items_org_code_uq");

  // ── 2. Проверяем, что данные позволяют создать новый индекс ──
  const dupes = await withRetry(
    async (sql) =>
      sql<{ org_id: string; code: string; n: number }[]>`
        select org_id, code, count(*)::int as n
          from price_items
         group by org_id, code
        having count(*) > 1
         limit 5
      `,
    { label: "поиск дублей" },
  );

  if (dupes.length > 0) {
    console.error("\n  ОСТАНОВ: есть дубли внутри организации, индекс не создать:");
    for (const d of dupes) {
      console.error(`    ${d.org_id}: код ${d.code} — ${d.n} шт`);
    }
    console.error("  Уберите дубли вручную и запустите снова.");
    process.exit(1);
  }
  console.log("\n  дублей (org_id, code) нет — индекс создастся");

  // ── 3. Новый индекс: сначала создаём, потом удаляем старый ──
  if (!hasNew) {
    console.log("\n  создаю price_items_org_code_uq…");
    await withRetry(
      async (sql) => {
        await sql`
          create unique index if not exists price_items_org_code_uq
              on price_items (org_id, code)
        `;
      },
      { label: "создание индекса", heavy: true },
    );
    console.log("  готово");
  } else {
    console.log("\n  price_items_org_code_uq уже есть");
  }

  if (hasOld) {
    console.log("  удаляю старый price_items_code_uq…");
    await withRetry(
      async (sql) => {
        await sql`drop index if exists price_items_code_uq`;
      },
      { label: "удаление индекса", heavy: true },
    );
    console.log("  готово");
  }

  // ── 4. Проверка результата ───────────────────────────────
  const after = await withRetry(
    async (sql) =>
      sql<{ indexname: string }[]>`
        select indexname from pg_indexes
         where tablename = 'price_items' and indexname like 'price_items%uq%'
      `,
    { label: "проверка индексов" },
  );

  console.log("\n  Итог — уникальные индексы:");
  for (const idx of after) console.log(`    ${idx.indexname}`);

  const perOrg = await withRetry(
    async (sql) =>
      sql<{ org_id: string; n: number }[]>`
        select org_id, count(*)::int as n from price_items group by org_id order by org_id
      `,
    { label: "позиции по организациям" },
  );

  console.log("\n  Позиции по организациям:");
  for (const row of perOrg) console.log(`    ${row.org_id}: ${row.n}`);

  console.log("\nМиграция 0005 завершена.");
  process.exit(0);
}

main().catch((e) => {
  console.error("ошибка миграции:", e instanceof Error ? e.message : e);
  process.exit(1);
});
