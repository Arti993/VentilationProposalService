/**
 * Проверка пакетной записи на ОТДЕЛЬНОЙ ветке Neon.
 * BENCH_DATABASE_URL=<URL тестовой ветки> node --env-file=.env.local scripts/benchmark-price-upload.ts
 * Создаёт только синтетические организации и удаляет их после проверки.
 */
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { replacePrice, loadPrice } from "../src/db/repositories/price.ts";
import { normalize } from "../src/lib/price/normalize.ts";

const benchmarkUrl = process.env.BENCH_DATABASE_URL;
if (!benchmarkUrl) throw new Error("Укажите BENCH_DATABASE_URL отдельной тестовой ветки Neon");
const original = process.env.DATABASE_URL;
const endpoint = (url: string) => new URL(url).hostname.replace("-pooler", "");
if (original && endpoint(original) === endpoint(benchmarkUrl)) {
  throw new Error("Тестовая база должна отличаться от DATABASE_URL приложения");
}
process.env.DATABASE_URL = benchmarkUrl;
const sql = neon(benchmarkUrl);
const org = "bench_" + randomUUID();
const other = "bench_" + randomUUID();
const items = (n: number, prefix = "p") => Array.from({ length: n }, (_, i) => ({
  ...normalize("Воздуховод спирально-навивной 315", 100 + i / 100, i), id: prefix + i,
}));

await sql`insert into organization (id, name, slug, created_at)
  values (${org}, 'Benchmark', ${org}, now()), (${other}, 'Benchmark isolation', ${other}, now())`;
try {
  await replacePrice(other, items(1), "other.xlsx");
  for (const count of [216, 1000, 5000]) {
    const started = performance.now();
    await replacePrice(org, items(count), "price.xlsx");
    const ms = Math.round(performance.now() - started);
    const [actual] = await sql`select count(*)::int as count, min(price)::text as minimum,
      max(price)::text as maximum from price_items where org_id = ${org}`;
    const [meta] = await sql`select item_count, file_name from price_meta where org_id = ${org}`;
    if (actual.count !== count || Number(actual.minimum) !== 100 ||
        Number(actual.maximum) !== 100 + (count - 1) / 100 || meta.item_count !== count) {
      throw new Error("Позиции, цены или метаданные не совпали");
    }
    const readStarted = performance.now();
    const loaded = await loadPrice(org);
    const readMs = Math.round(performance.now() - readStarted);
    if (loaded.length !== count || loaded[0].dims[0] !== 315) {
      throw new Error("Чтение прайса потеряло позиции или размеры");
    }
    console.log(JSON.stringify({ count, ms, readMs }));
    if (ms >= 60_000) throw new Error("Превышен целевой предел загрузки");
  }

  const broken = items(300);
  broken[299].price = 1e20;
  let rejected = false;
  try { await replacePrice(org, broken, "broken.xlsx"); } catch { rejected = true; }
  const [retained] = await sql`select count(*)::int as count from price_items where org_id = ${org}`;
  const [meta] = await sql`select file_name from price_meta where org_id = ${org}`;
  if (!rejected || retained.count !== 5000 || meta.file_name !== "price.xlsx") {
    throw new Error("При ошибке изменились старый прайс или метаданные");
  }
  console.log("Rollback: PASS");

  await Promise.all([replacePrice(org, items(512, "a"), "a.xlsx"),
    replacePrice(org, items(512, "b"), "b.xlsx")]);
  const [final] = await sql`select count(*)::int as count, count(distinct left(code, 1))::int as versions
    from price_items where org_id = ${org}`;
  const [untouched] = await sql`select count(*)::int as count from price_items where org_id = ${other}`;
  if (final.count !== 512 || final.versions !== 1 || untouched.count !== 1) {
    throw new Error("Нарушена изоляция организаций или одновременных загрузок");
  }
  console.log("Concurrency and organization isolation: PASS");
} finally {
  await sql.transaction([
    sql`delete from price_items where org_id in (${org}, ${other})`,
    sql`delete from organization where id in (${org}, ${other})`,
  ]);
}
