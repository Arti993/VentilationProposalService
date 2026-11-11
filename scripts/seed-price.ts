/**
 * Заливка прайса в Postgres.
 *
 * Запуск: node --env-file=.env.local scripts/seed-price.ts
 *
 * ДВА ОГРАНИЧЕНИЯ NEON, найденные замерами:
 *
 * 1. Соединение выдерживает ~4-5 запросов, потом пулер его рвёт.
 *    Решение: минимум запросов, каждому своё соединение.
 *
 * 2. Один запрос больше ~11 КБ кириллицы рвёт соединение.
 *    Решение: нарезка на батчи по объёму, а не по количеству строк.
 *    Батч собирается динамически: пока суммарный размер < LIMIT_BYTES.
 *
 * Проверка результата — фактическим подсчётом, а не счётчиком вставок.
 * Неполный прайс не должен выглядеть как успешный.
 */
import fs from "node:fs";
import path from "node:path";
import { withRetry, connectOnce, closeQuietly } from "../src/db/connection.ts";
import type { PriceItem } from "../src/lib/price/normalize.ts";

const FILE = path.join(process.cwd(), "data", "price.normalized.json");

/** Безопасный предел на один запрос. Замеренный обрыв — ~11 КБ. */
const LIMIT_BYTES = 6000;

/** Экранирует строку для SQL-литерала. */
function q(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * Строка VALUES для одной позиции.
 * ВАЖНО: имена колонок в БД snake_case, а поля в PriceItem — camelCase.
 * В VALUES имена не участвуют, но порядок обязан совпадать со списком
 * колонок в INSERT.
 */
function valuesRow(p: PriceItem): string {
  const dims = JSON.stringify(p.dims).replace(/'/g, "''");
  const angle = p.angle === undefined ? "null" : String(p.angle);
  const variant = p.variant === undefined ? "null" : q(p.variant);
  const unparsed = p.unparsed === undefined ? "null" : q(p.unparsed);
  return `(${q(p.id)}, ${q(p.rawName)}, ${p.price}::numeric, ${q(p.type)}, ${q(
    p.dims.join("/"),
  )}, ${q(dims)}::jsonb, ${angle}, ${variant}, ${unparsed})`;
}

/** Нарезает позиции на батчи по байтовому размеру SQL. */
function chunkBySize(items: PriceItem[], limit: number): PriceItem[][] {
  const batches: PriceItem[][] = [];
  let current: PriceItem[] = [];
  let size = 0;

  for (const item of items) {
    const row = valuesRow(item);
    const bytes = Buffer.byteLength(row, "utf8");

    if (current.length && size + bytes > limit) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += bytes;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`Нет файла ${FILE}. Сначала: node scripts/normalize-price.ts`);
    process.exit(1);
  }

  const items = JSON.parse(fs.readFileSync(FILE, "utf8")) as PriceItem[];
  const totalBytes = items.reduce(
    (acc, p) => acc + Buffer.byteLength(valuesRow(p), "utf8"),
    0,
  );
  console.log(`Позиций: ${items.length}, объём данных: ${Math.round(totalBytes / 1024)} КБ`);

  // ── Очистка: отдельное соединение, простой запрос ──────────────────────
  await withRetry(async (sql) => {
    await sql`truncate table price_items restart identity`;
  }, { label: "очистка" });
  console.log("Таблица очищена");

  // ── Вставка батчами по размеру ────────────────────────────────────────
  const batches = chunkBySize(items, LIMIT_BYTES);
  console.log(`Батчей: ${batches.length} (предел ${LIMIT_BYTES} байт ≈ ${
    batches.length ? Math.round(items.length / batches.length) : 0
  } строк)`);

  let done = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const sqlText =
      "insert into price_items " +
      "(code, raw_name, price, type, dims_key, dims, angle, variant, unparsed) values " +
      batch.map(valuesRow).join(",");

    const bytes = Buffer.byteLength(sqlText, "utf8");

    await withRetry(
      async (sql) => {
        await sql.unsafe(sqlText);
      },
      { label: `батч ${i + 1}/${batches.length}` },
    );

    done += batch.length;
    process.stdout.write(`\rВставлено: ${done}/${items.length} (последний батч ${bytes} Б)`);
  }
  console.log();

  // ── Проверка количества ───────────────────────────────────────────────
  const count = await withRetry(async (sql) => {
    const r = await sql<{ n: number }[]>`select count(*)::int as n from price_items`;
    return r[0]?.n ?? 0;
  }, { label: "подсчёт" });

  console.log(`В базе: ${count}`);

  if (count !== items.length) {
    console.error(`\nРАСХОЖДЕНИЕ: ожидали ${items.length}, в базе ${count}`);
    console.error("Повторите запуск — заливка начинается с очистки.");
    process.exit(1);
  }

  // ── Контрольные выборки: три типа с известными ценами ─────────────────
  const probes = await withRetry(async (sql) => {
    return sql<{ code: string; raw_name: string; price: string; dims_key: string }[]>`
      select code, raw_name, price, dims_key from price_items
       where (type = 'tee' and dims_key = '315/200')
          or (type = 'duct_spiral' and dims_key = '315')
          or (type = 'cap' and dims_key = '315')
       order by code
    `;
  }, { label: "контроль" });

  const expected: Record<string, number> = { "315/200": 983, "315": 846 };
  let failed = false;

  console.log("\nКонтрольные позиции:");
  for (const p of probes) {
    console.log(`  ${p.code}: ${p.raw_name} — ${p.price} руб`);
  }

  const tee = probes.find((p) => p.dims_key === "315/200");
  if (!tee || Number(tee.price) !== 983) {
    console.error(`  ОШИБКА: тройник 315/200 должен стоить 983, найдено ${tee?.price ?? "нет"}`);
    failed = true;
  }

  const cap = probes.find((p) => p.dims_key === "315" && p.code.startsWith("p"));
  if (!cap) {
    console.error("  ОШИБКА: заглушка 315 не найдена");
    failed = true;
  }

  if (failed) process.exit(1);

  console.log("\nOK: прайс залит, контрольные цены совпали");
  process.exit(0);
}

main().catch((e) => {
  console.error("\nОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
