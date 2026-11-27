/**
 * Репозиторий прайс-листа.
 *
 * Прайс переехал из JSON-файла в БД. Причины:
 *  - на Vercel файловая система read-only, читать JSON каждый раз — костыль;
 *  - цены меняются, а не лежат в репозитории навсегда;
 *  - нужен pgvector и семантический поиск, для него нужна БД.
 *
 * ОСОБЕННОСТЬ NEON (замерено, см. scripts/diag-limit.ts): пулер закрывает
 * соединение после 4-5 запросов. Поэтому каждый запрос идёт со своим
 * соединением через withRetry. Массовое чтение и замена прайса используют HTTP-драйвер Neon.
 *
 * ПРАЙС ПРИНАДЛЕЖИТ ОРГАНИЗАЦИИ
 *
 * У каждой организации свой прайс: демо-прайс у `org_demo`, загруженный
 * клиентом — у него. Функции загрузки требуют `orgId` явно, без значения
 * по умолчанию: забыть его нельзя, иначе один клиент увидит цены другого.
 * Это важнее удобства, поэтому здесь нет перегрузки «без организации».
 *
 * Кэш — на организацию, а не общий. Ключ кэша содержит `orgId`, иначе
 * первый загрузивший прайс подставил бы его всем остальным.
 */
import { withRetry } from "../connection.ts";
import { neon } from "@neondatabase/serverless";
import type { PriceItem, ItemType } from "../../lib/price/normalize.ts";

interface CacheEntry {
  items: PriceItem[];
  loadedAt: number;
}

const globalCache = globalThis as unknown as {
  __priceCacheByOrg?: Map<string, CacheEntry>;
};

/** Кэш живёт 5 минут: правка прайса подхватится без перезапуска. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Сколько организаций держать в памяти.
 *
 * Прайс — это 215 строк на ~30 КБ. Двадцать организаций — 600 КБ, приемлемо
 * для функции Vercel. Ограничение нужно, чтобы ночной обход не раздувал
 * память до отказа: без него каждый уникальный `orgId` остаётся навсегда.
 */
const MAX_CACHED_ORGS = 20;

function cacheMap(): Map<string, CacheEntry> {
  if (!globalCache.__priceCacheByOrg) {
    globalCache.__priceCacheByOrg = new Map();
  }
  return globalCache.__priceCacheByOrg;
}

/**
 * Приводит `dims` из базы к массиву чисел.
 *
 * `jsonb` приходит по-разному: иногда строкой `"[315]"`, иногда уже
 * массивом. Функция принимает обе формы, чтобы не зависеть от драйвера и
 * его настроек. Мусор и пустое дают `[]` — позиция останется «без
 * размеров», и матчер не поставит по ней цену. Это безопасный отказ:
 * ошибочная цена опаснее отсутствующей.
 */
function parseDims(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (v): v is number => typeof v === "number" && Number.isFinite(v),
        );
      }
    } catch {
      return [];
    }
  }
  return [];
}

interface PriceRow {
  code: string;
  raw_name: string;
  price: string;
  type: string;
  dims: unknown;
  angle: number | null;
  variant: string | null;
  unparsed: string | null;
}

/** Чтение без векторов одним HTTP-запросом; кэш остаётся отдельным для каждой организации. */
export async function loadPrice(orgId: string): Promise<PriceItem[]> {
  const cache = cacheMap();
  const cached = cache.get(orgId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.items;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const sql = neon(url);
  const rows = await sql.query(`
    select code, raw_name, price, type, dims, angle, variant, unparsed
      from price_items where org_id = $1 order by code
  `, [orgId], { fetchOptions: { signal: AbortSignal.timeout(15_000) } }) as PriceRow[];
  const items: PriceItem[] = rows.map((r) => ({
    id: r.code,
    rawName: r.raw_name,
    price: Number(r.price),
    type: r.type as ItemType,
    dims: parseDims(r.dims),
    angle: r.angle ?? undefined,
    variant: r.variant ?? undefined,
    unparsed: r.unparsed ?? undefined,
  }));

  // Вытесняем самый старый, если перебрали лимит
  if (cache.size >= MAX_CACHED_ORGS && !cache.has(orgId)) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [key, value] of cache) {
      if (value.loadedAt < oldestAt) {
        oldestAt = value.loadedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }

  cache.set(orgId, { items, loadedAt: Date.now() });
  return items;
}

/**
 * Сбрасывает кэш прайса.
 *
 * Без `orgId` сбрасывает всё: используется, когда мы не знаем, чей прайс
 * изменился (например, после миграции).
 */
export function invalidatePriceCache(orgId?: string): void {
  if (orgId) {
    cacheMap().delete(orgId);
    return;
  }
  cacheMap().clear();
}

/** Сколько позиций в прайсе организации. */
export async function countPrice(orgId: string): Promise<number> {
  return withRetry(
    async (sql) => {
      const r = await sql<{ n: number }[]>`
        select count(*)::int as n from price_items where org_id = ${orgId}
      `;
      return r[0]?.n ?? 0;
    },
    { label: "подсчёт прайса" },
  );
}

/**
 * Сколько позиций загружено в каждой организации.
 *
 * Нужно странице `/status` и кабинету: видно, у кого прайс пустой, а у
 * кого — рабочий. Возвращает и организации без единой позиции: иначе
 * «нет строки» нельзя отличить от «ноль позиций».
 */
export async function priceStatsByOrg(): Promise<
  { orgId: string; total: number }[]
> {
  return withRetry(
    async (sql) => {
      const rows = await sql<{ org_id: string; n: number }[]>`
        select org_id, count(*)::int as n from price_items group by org_id order by org_id
      `;
      return rows.map((r) => ({ orgId: r.org_id, total: r.n }));
    },
    { label: "статистика прайса" },
  );
}

/**
 * Пакетная замена одним HTTP-запросом к Neon, без соединения на каждую строку.
 * Все SQL-команды выполняются в одной транзакции: ошибка любого пакета
 * откатывает удаление старого прайса и обновление сведений о файле.
 */
export async function replacePrice(
  orgId: string,
  items: PriceItem[],
  fileName?: string,
): Promise<{ inserted: number; removed: number }> {
  if (!orgId) throw new Error("Не указана организация прайса");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const sql = neon(url);
  const queries = [
    sql`select set_config('statement_timeout', '40s', true),
               set_config('lock_timeout', '5s', true),
               set_config('idle_in_transaction_session_timeout', '10s', true),
               set_config('transaction_timeout', '45s', true)`,
    // Одновременные загрузки одной организации не могут перемешать прайсы.
    sql`select pg_advisory_xact_lock(hashtextextended(${orgId}, 0))`,
    sql`with removed as (
          delete from price_items where org_id = ${orgId} returning 1
        ) select count(*)::int as n from removed`,
  ];
  for (let offset = 0; offset < items.length; offset += 250) {
    const batch = items.slice(offset, offset + 250).map((item) => ({
      code: item.id,
      raw_name: item.rawName,
      price: item.price,
      type: item.type,
      dims_key: item.dims.join("/"),
      dims: item.dims,
      angle: item.angle ?? null,
      variant: item.variant ?? null,
      unparsed: item.unparsed ?? null,
    }));
    queries.push(sql`
      insert into price_items (org_id, code, raw_name, price, type, dims_key, dims, angle, variant, unparsed)
      select ${orgId}, r.code, r.raw_name, r.price, r.type, r.dims_key, r.dims, r.angle, r.variant, r.unparsed
        from jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) as r(
          code text, raw_name text, price numeric(12,2), type text, dims_key text,
          dims jsonb, angle integer, variant text, unparsed text
        )
    `);
  }
  if (fileName !== undefined) {
    queries.push(sql`
      insert into price_meta (org_id, file_name, item_count, uploaded_at)
      values (${orgId}, ${fileName}, ${items.length}, now())
      on conflict (org_id) do update
        set file_name = excluded.file_name, item_count = excluded.item_count, uploaded_at = excluded.uploaded_at
    `);
  }
  const results = await sql.transaction(queries, {
    fetchOptions: { signal: AbortSignal.timeout(45_000) },
  });
  invalidatePriceCache(orgId);
  return { inserted: items.length, removed: Number(results[2]?.[0]?.n ?? 0) };
}
