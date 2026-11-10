/**
 * Репозиторий прайс-листа.
 *
 * Прайс переехал из JSON-файла в БД. Причины:
 *  - на Vercel файловая система read-only, читать JSON каждый раз — костыль;
 *  - цены меняются, а не лежат в репозитории навечно;
 *  - следующий шаг — pgvector и семантический поиск, для него нужна БД.
 *
 * ОСОБЕННОСТЬ NEON (замерено, см. scripts/diag-limit.ts): пулер закрывает
 * соединение после 4-5 запросов. Поэтому каждый запрос идёт со своим
 * соединением через withRetry, а не через общий пул Drizzle.
 *
 * Кэш в памяти остаётся: 215 строк читать на каждый запрос незачем,
 * а прайс меняется раз в месяц.
 */
import { withRetry } from "../connection.ts";
import type { PriceItem, ItemType } from "../../lib/price/normalize.ts";

const globalCache = globalThis as unknown as {
  __priceFromDb?: { items: PriceItem[]; loadedAt: number };
};

/** Кэш живёт 5 минут: правка прайса подхватится без перезапуска. */
const CACHE_TTL_MS = 5 * 60 * 1000;

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

/**
 * Читает прайс из БД.
 *
 * Возвращает ту же структуру PriceItem, что и нормализатор — остальной код
 * (матчер, агент) не должен знать, откуда пришли данные.
 *
 * ВАЖНО: читаем постранично. Один SELECT на 215 строк кириллицей — это
 * ~29 КБ ответа, и пулер Neon рвёт соединение на таком объёме (замерено).
 * Страница в 60 строк — ~8 КБ, проходит стабильно.
 */
const PAGE_SIZE = 60;

export async function loadPrice(): Promise<PriceItem[]> {
  const cached = globalCache.__priceFromDb;
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.items;
  }

  const items: PriceItem[] = [];
  let offset = 0;

  for (;;) {
    const page = await withRetry(
      async (sql) => {
        return sql<PriceRow[]>`
          select code, raw_name, price, type, dims, angle, variant, unparsed
            from price_items
           order by code
           limit ${PAGE_SIZE} offset ${offset}
        `;
      },
      { label: `загрузка прайса (${offset})` },
    );

    for (const r of page) {
      // postgres.js возвращает jsonb уже разобранным в массив
      const dims = Array.isArray(r.dims) ? (r.dims as number[]) : [];
      items.push({
        id: r.code,
        rawName: r.raw_name,
        price: Number(r.price),
        type: r.type as ItemType,
        dims,
        angle: r.angle ?? undefined,
        variant: r.variant ?? undefined,
        unparsed: r.unparsed ?? undefined,
      });
    }

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  globalCache.__priceFromDb = { items, loadedAt: Date.now() };
  return items;
}

/** Сбрасывает кэш — после заливки нового прайса. */
export function invalidatePriceCache(): void {
  globalCache.__priceFromDb = undefined;
}

/** Сколько позиций в прайсе (для проверки состояния БД). */
export async function countPrice(): Promise<number> {
  return withRetry(
    async (sql) => {
      const r = await sql<{ n: number }[]>`select count(*)::int as n from price_items`;
      return r[0]?.n ?? 0;
    },
    { label: "подсчёт прайса" },
  );
}
