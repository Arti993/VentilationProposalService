/**
 * Миграция 0004: привязка существующих данных к организации.
 *
 * Запуск: node --env-file=.env.local scripts/apply-migration-0004.ts
 *
 * ЧТО ДЕЛАЕТ
 *
 * Добавляет `org_id` в сметы, журнал КП и элементы прайса, а затем
 * переносит туда уже существующие строки — в «организацию по умолчанию».
 *
 * ПОЧЕМУ НЕ ОСТАВИТЬ NULL У СТАРЫХ СТРОК
 *
 * Демо-прайс на 215 позиций — то, что видит работодатель, открыв ссылку.
 * Если он окажется «ничей», анонимный пользователь не увидит ничего, и
 * первое впечатление будет «сервис не работает». Поэтому старые данные
 * получают владельца — организацию `demo`, к которой привязан
 * анонимный доступ.
 *
 * ПОЧЕМУ `org_id` НЕ NOT NULL СРАЗУ
 *
 * Между этой миграцией и первым реальным пользователем есть окно, когда
 * старый код ещё пишет строки без `org_id`. Ограничение NOT NULL
 * сломало бы его. Порядок безопасный: сначала добавляем колонку и
 * заполняем, потом (отдельной миграцией) ставим NOT NULL, когда весь
 * код уже пишет владельца.
 */
import { withRetry } from "../src/db/connection.ts";

type Sql = Parameters<Parameters<typeof withRetry>[0]>[0];

/** Идентификатор организации, которой принадлежат демо-данные. */
const DEMO_ORG_ID = "org_demo";
const DEMO_ORG_SLUG = "demo";
const DEMO_ORG_NAME = "Демо-прайс";

const STATEMENTS: Array<{ title: string; run: (sql: Sql) => Promise<unknown> }> = [
  {
    title: "демо-организация",
    run: (sql) => sql`
      insert into organization (id, name, slug, created_at)
      values (${DEMO_ORG_ID}, ${DEMO_ORG_NAME}, ${DEMO_ORG_SLUG}, now())
      on conflict (id) do nothing
    `,
  },
  {
    title: "колонка org_id в estimates",
    run: (sql) => sql`alter table estimates add column if not exists org_id text`,
  },
  {
    title: "колонка org_id в proposal_log",
    run: (sql) => sql`alter table proposal_log add column if not exists org_id text`,
  },
  {
    title: "колонка org_id в price_items",
    run: (sql) => sql`alter table price_items add column if not exists org_id text`,
  },
  {
    title: "колонка created_by в estimates",
    // Кто создал смету. NULL для анонимных и для старых строк.
    run: (sql) => sql`alter table estimates add column if not exists created_by text`,
  },
  {
    title: "старые сметы → демо-организация",
    run: (sql) => sql`update estimates set org_id = ${DEMO_ORG_ID} where org_id is null`,
  },
  {
    title: "старый журнал КП → демо-организация",
    run: (sql) => sql`update proposal_log set org_id = ${DEMO_ORG_ID} where org_id is null`,
  },
  {
    title: "существующий прайс → демо-организация",
    run: (sql) => sql`update price_items set org_id = ${DEMO_ORG_ID} where org_id is null`,
  },
  {
    // Индекс под главный запрос: «сметы этой организации, свежие первыми»
    title: "индекс estimates по организации",
    run: (sql) => sql`
      create index if not exists estimates_org_idx on estimates (org_id, created_at desc)
    `,
  },
  {
    title: "индекс журнала КП по организации",
    run: (sql) => sql`
      create index if not exists proposal_log_org_idx on proposal_log (org_id, created_at desc)
    `,
  },
  {
    title: "индекс прайса по организации",
    run: (sql) => sql`create index if not exists price_items_org_idx on price_items (org_id)`,
  },
];

async function main() {
  console.log("Миграция 0004: владелец данных\n");

  let failed = 0;
  for (const s of STATEMENTS) {
    process.stdout.write(`  ${s.title}… `);
    try {
      await withRetry((sql) => s.run(sql) as Promise<unknown>, {
        label: s.title,
        retries: 5,
      });
      console.log("ок");
    } catch (e) {
      failed += 1;
      console.log(`ПРОВАЛ: ${e instanceof Error ? e.message.slice(0, 90) : e}`);
    }
  }

  console.log("\n=== Проверка ===");

  const counts = await withRetry(
    async (sql) =>
      sql<{ estimates: number; without_org: number; log: number; items: number; orphan: number }[]>`
        select
          (select count(*)::int from estimates) as estimates,
          (select count(*)::int from estimates where org_id is null) as without_org,
          (select count(*)::int from proposal_log) as log,
          (select count(*)::int from price_items) as items,
          (select count(*)::int from price_items where org_id is null) as orphan
      `,
    { label: "проверка" },
  );

  const c = counts[0];
  console.log(`  смет: ${c?.estimates ?? 0}, без организации: ${c?.without_org ?? 0}`);
  console.log(`  журнал КП: ${c?.log ?? 0}`);
  console.log(`  прайс: ${c?.items ?? 0}, без организации: ${c?.orphan ?? 0}`);

  if ((c?.orphan ?? 0) > 0 || (c?.without_org ?? 0) > 0) {
    console.log("\n  ВНИМАНИЕ: остались строки без владельца");
    process.exit(1);
  }

  if (failed > 0) {
    console.log(`\n  провалов: ${failed}`);
    process.exit(1);
  }
  console.log("\n  всё применено");
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
