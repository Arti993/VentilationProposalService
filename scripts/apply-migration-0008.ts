/**
 * Миграция 0008: сведения о загруженном прайсе.
 *
 * ЗАЧЕМ
 *
 * Кабинет должен показывать «прайс загружен: такой-то файл, столько-то
 * позиций», а главный экран — отличать «своего прайса ещё нет» от
 * «загружен, но пустой». Из таблицы `price_items` этого не узнать: она
 * знает только позиции, но не имя файла и не дату загрузки.
 *
 * ЧТО ДЕЛАЕТ
 *
 * Создаёт `price_meta` — одну строку на организацию. Идемпотентно:
 * повторный запуск ничего не меняет.
 */

import { withRetry } from "../src/db/connection.ts";

async function main() {
  console.log("Миграция 0008: сведения о прайсе\n");

  const before = await withRetry(
    (sql) =>
      sql<{ exists: boolean }[]>`
        select exists (
          select 1 from information_schema.tables
           where table_schema = 'public' and table_name = 'price_meta'
        ) as exists
      `,
    { label: "проверка таблицы" },
  );

  if (before[0]?.exists) {
    console.log("  таблица price_meta уже есть");
  } else {
    console.log("  создаю price_meta…");
    await withRetry(
      async (sql) => {
        await sql`
          create table if not exists price_meta (
            org_id      text primary key,
            file_name   text not null,
            item_count  integer not null,
            uploaded_at timestamptz not null default now()
          )
        `;
      },
      { label: "создание таблицы", heavy: true, retries: 2 },
    );
    console.log("  готово");
  }

  // ── Ссылка на организацию ───────────────────────────────
  /**
   * Сироты убираются ПЕРЕД добавлением ключа.
   *
   * Без этого шага `alter table` упал бы на первой же строке удалённой
   * организации — и миграция выглядела бы сломанной, хотя дело в мусоре,
   * который эта же миграция и должна предотвратить.
   */
  const orphans = await withRetry(
    async (sql) => {
      const removed = await sql<{ org_id: string }[]>`
        delete from price_meta pm
         where not exists (select 1 from organization o where o.id = pm.org_id)
        returning pm.org_id
      `;
      return removed;
    },
    { label: "уборка сирот", heavy: true, retries: 2 },
  );
  if (orphans.length > 0) {
    console.log(`  удалено строк без организации: ${orphans.length}`);
  }

  /**
   * Проверяем наличие ключа, прежде чем его добавлять.
   *
   * `drop constraint if exists` + `add constraint` в одном проходе
   * безопасны, но при повторном запуске дают ошибку в логе от первого
   * шага. Чистый повторный прогон важнее краткости: скрипт запускают
   * руками, и «красная строка» в нём означает «надо разбираться».
   */
  const hasFk = await withRetry(
    (sql) =>
      sql<{ ok: boolean }[]>`
        select exists (
          select 1 from pg_constraint
           where conname = 'price_meta_org_fk'
             and conrelid = 'price_meta'::regclass
        ) as ok
      `,
    { label: "проверка ключа" },
  );

  if (hasFk[0]?.ok) {
    console.log("  ключ price_meta → organization уже есть");
  } else {
    await withRetry(
      async (sql) => {
        await sql`
          alter table price_meta
            add constraint price_meta_org_fk
            foreign key (org_id) references organization(id) on delete cascade
        `;
      },
      { label: "внешний ключ", heavy: true, retries: 2 },
    );
    console.log("  ключ price_meta → organization (cascade) добавлен");
  }

  // ── Итог ─────────────────────────────────────────────────
  const cols = await withRetry(
    (sql) =>
      sql<{ column_name: string; data_type: string }[]>`
        select column_name, data_type
          from information_schema.columns
         where table_schema = 'public' and table_name = 'price_meta'
         order by ordinal_position
      `,
    { label: "колонки price_meta" },
  );

  console.log("\n  Колонки price_meta:");
  for (const c of cols) console.log(`    ${c.column_name.padEnd(14)} ${c.data_type}`);

  /**
   * Сколько организаций уже имеют прайс — но без записи в price_meta.
   *
   * Это нормально: они загружали прайс до появления таблицы. Кабинет
   * покажет «прайс загружен» без имени файла, а не «прайса нет».
   */
  const legacy = await withRetry(
    (sql) =>
      sql<{ n: number }[]>`
        select count(distinct pi.org_id)::int as n
          from price_items pi
          left join price_meta pm on pm.org_id = pi.org_id
         where pi.org_id is not null and pm.org_id is null
      `,
    { label: "организации без price_meta" },
  );

  console.log(
    `\n  Организаций с прайсом, но без записи в price_meta: ${legacy[0]?.n ?? 0}`,
  );
  console.log("  Для них имя файла неизвестно — это ожидаемо, не ошибка.");
  console.log("\n✓ Миграция 0008 применена");
}

main().catch((e) => {
  console.error("✗ Миграция не удалась:", e instanceof Error ? e.message : e);
  process.exit(1);
});