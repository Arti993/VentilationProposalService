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
 * соединением через withRetry, а не через общий пул Drizzle.
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

/**
 * Читает прайс организации из БД.
 *
 * Возвращает ту же структуру PriceItem, что и нормализатор — остальной код
 * (матчер, агент) не должен знать, откуда пришли данные.
 *
 * ВАЖНО: читаем постранично. Один SELECT на 215 строк кириллицей — это
 * ~29 КБ ответа, и пулер Neon рвёт соединение на таком объёме (замерено).
 *
 * Почему страница 30, а не 60. При 60 строках (~8 КБ) ответ проходит по
 * грани лимита: часть страниц рвётся, и каждый обрыв — это ретрай с паузой.
 * Замерено: загрузка всего прайса занимала 41 секунду при трёх обрывах
 * подряд. Страница в 30 строк (~4 КБ) идёт с запасом и не рвётся:
 * пусть запросов больше, зато ни одного ретрая.
 */
const PAGE_SIZE = 30;

export async function loadPrice(orgId: string): Promise<PriceItem[]> {
  const cache = cacheMap();
  const cached = cache.get(orgId);
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
           where org_id = ${orgId}
           order by code
           limit ${PAGE_SIZE} offset ${offset}
        `;
      },
      { label: `загрузка прайса (${offset})` },
    );

    for (const r of page) {
      /**
       * `jsonb` приходит СТРОКОЙ, а не массивом.
       *
       * Замерено: `pg_typeof(dims)` = jsonb, но `typeof` в JS даёт
       * `"string"`, `Array.isArray` — `false`, значение — `"[315]"`.
       * Раньше в комментарии здесь стояло «postgres.js возвращает jsonb
       * уже разобранным» — это неверно, и цена ошибки большая: молча
       * возвращался `[]`, матчер не находил размеров, и КП выходило без
       * цен. Демо-прайс проходил только потому, что читался другими
       * путями.
       *
       * Поэтому разбираем обе формы: строка JSON и готовый массив.
       */
      const dims = parseDims(r.dims);
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
 * Заменяет прайс организации целиком.
 *
 * Почему целиком, а не «добавить недостающие»: прайс — это снимок на дату.
 * Если поставщик убрал позицию, она должна исчезнуть, а не остаться с
 * прошлой ценой. Именно поэтому `delete` идёт первым.
 *
 * Почему не в транзакции: вторая запись внутри транзакции рвёт соединение
 * с Neon (docs/INCIDENT-SIGNUP.md). Поэтому удаление и вставка — отдельные
 * запросы. Плата: если вставка сорвётся, прайс останется пустым. Это
 * лечится повторной загрузкой, а «старые и новые цены вперемешку» —
 * нет: клиент увидел бы и устаревшие цены тоже.
 *
 * ЗАЧЕМ ЗДЕСЬ ОТДЕЛЬНЫЙ ПУТЬ ДЛЯ ВЕКТОРОВ
 *
 * Писать вектор в той же порции, что и прайс, заманчиво: одна операция
 * вместо двух. На этой базе так делать нельзя, и это проверено, а не
 * предположено.
 *
 * Измерения:
 *
 *  - `update price_items set embedding = …` — обрыв через 19-27 с
 *    (`write CONNECTION_CLOSED`), независимо от размера вектора: и на
 *    16 измерениях (312 байт), и на 1024 (21 КБ), и в пустой таблице без
 *    единого индекса.
 *  - `insert` с вектором в свежем соединении — обычно 570-900 мс, но
 *    воспроизводимо падает, если перед ним на том соединении был `delete`
 *    и затем пауза (вызов эмбеддингов идёт ~1-3 с по HTTP). Падение
 *    случается около половины прогонов, без видимой закономерности.
 *  - падение происходит уже ПОСЛЕ записи: строка в базе есть, вектор
 *    есть, а подтверждение не дошло.
 *
 * Цена ошибки слишком высока: при удалении и вставке в одной функции
 * сбой на вставке оставлял организацию БЕЗ прайса — было воспроизведено,
 * позиции p001…p003 удалялись и не возвращались. Ради ускорения поиска
 * по смыслу так рисковать нельзя.
 *
 * Поэтому:
 *
 *   1. Здесь — только надёжный путь: `delete` + `insert` без векторов.
 *      Он стабилен, занимает 1-3 секунды на 215 позиций.
 *   2. Векторы пишет `indexPriceInBackground` (см. priceIndex.ts),
 *      отдельно и после ответа клиенту. Если она упадёт, прайс останется
 *      целым, просто без векторов: точный матчинг (тип + размеры) от них
 *      не зависит, а сложные формулировки временно уйдут в «требует
 *      проверки» — безопасный отказ.
 */
export async function replacePrice(
  orgId: string,
  items: PriceItem[],
): Promise<{ inserted: number; removed: number }> {
  const removed = await withRetry(
    async (sql) => {
      const rows = await sql<{ code: string }[]>`
        delete from price_items where org_id = ${orgId} returning code
      `;
      return rows.length;
    },
    { label: "очистка прайса", heavy: true },
  );

  let inserted = 0;
  for (const item of items) {
    /**
     * `dims_key` — размеры через дробь, по нему идёт точный поиск
     * (`price_items_type_dims_idx`). Собираем здесь, а не в базе:
     * генерируемого столбца нет, и без значения вставка падает с
     * `violates not-null constraint`. Пустые размеры дают пустую строку —
     * это легально и означает «позиция без размеров».
     */
    const dimsKey = item.dims.join("/");

    /**
     * `?? null` обязателен: у только что нормализованной позиции `angle`,
     * `variant` и `unparsed` — `undefined`, а не `null`. `postgres.js`
     * трактует `undefined` как «значение не задано» и подставляет
     * `DEFAULT`, из-за чего запрос может прийти с несогласованным числом
     * параметров.
     */
    await withRetry(
      async (sql) => {
        await sql`
          insert into price_items
            (org_id, code, raw_name, price, type, dims_key, dims, angle, variant, unparsed)
          values (
            ${orgId}, ${item.id}, ${item.rawName}, ${item.price}, ${item.type},
            ${dimsKey}, ${JSON.stringify(item.dims)}::jsonb, ${item.angle ?? null},
            ${item.variant ?? null}, ${item.unparsed ?? null}
          )
          on conflict (org_id, code) do update
             set raw_name = excluded.raw_name,
                 price    = excluded.price,
                 type     = excluded.type,
                 dims     = excluded.dims,
                 dims_key = excluded.dims_key
        `;
      },
      { label: `вставка позиции ${item.id}` },
    );
    inserted += 1;
  }

  invalidatePriceCache(orgId);
  return { inserted, removed };
}
