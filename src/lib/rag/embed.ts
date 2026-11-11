/**
 * Клиент эмбеддингов через polza.ai.
 *
 * Модель bge-m3: 1024 измерения, векторы нормализованы (проверено).
 * Нормализация важна: косинусное расстояние тогда равно скалярному
 * произведению, и pgvector может использовать индекс HNSW.
 *
 * Почему отдельный модуль, а не LangChain Embeddings: у нас уже есть
 * бизнес-логика вне LangChain, и подключать ещё один слой абстракции
 * ради одного HTTP-запроса — лишняя сложность. LangChain остаётся там,
 * где действительно нужен: вызовы чат-модели.
 */

const BASE_URL = process.env.POLZA_BASE_URL ?? "https://polza.ai/api/v1";
const API_KEY = process.env.POLZA_API_KEY ?? "";
export const EMBED_MODEL = process.env.EMBED_MODEL ?? "baai/bge-m3";
export const EMBED_DIM = 1024;

/**
 * Сколько текстов отправлять за один запрос.
 *
 * Провайдер принимает массив, но большие пачки рвут соединение (та же
 * история, что с пулером Neon: лимит на объём запроса). 32 — компромисс:
 * достаточно, чтобы не делать 215 запросов, и достаточно мало, чтобы
 * пройти по размеру.
 */
const BATCH_SIZE = 32;

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage?: { total_tokens?: number };
}

async function embedBatch(input: string[]): Promise<number[][]> {
  if (!API_KEY) throw new Error("POLZA_API_KEY не задан");

  // Свой ретрай, а не withRetry из db/connection: тот открывает соединение
  // с базой на каждую попытку, а здесь база не нужна вообще. Лишние
  // подключения к пулеру — прямой путь к CONNECTION_CLOSED.
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: EMBED_MODEL, input }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        throw new Error(`Embeddings HTTP ${res.status}: ${body}`);
      }

      const json = (await res.json()) as EmbeddingResponse;
      if (!json.data?.length) throw new Error("Пустой ответ эмбеддингов");

      // Порядок в ответе не гарантирован — сортируем по index
      const sorted = [...json.data].sort((a, b) => a.index - b.index);

      for (const d of sorted) {
        if (d.embedding.length !== EMBED_DIM) {
          throw new Error(
            `Неверная размерность: ${d.embedding.length}, ожидалось ${EMBED_DIM}. ` +
              `Если модель изменена, нужна миграция колонки и переиндексация.`,
          );
        }
      }

      return sorted.map((d) => d.embedding);
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Повторяем только транспортные сбои и 5xx, не 4xx
      const retryable = /fetch failed|timeout|ECONNRESET|HTTP 5\d\d|HTTP 429/i.test(msg);
      if (!retryable || attempt === 3) throw e;
      const delay = 300 * 2 ** (attempt - 1);
      console.warn(`  embeddings: повтор ${attempt + 1}/3 через ${delay}мс (${msg.slice(0, 60)})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

/** Эмбеддинги для набора текстов. Разбивает на батчи сам. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE);
    const vectors = await embedBatch(chunk);
    out.push(...vectors);
  }

  if (out.length !== texts.length) {
    throw new Error(`Получено ${out.length} векторов на ${texts.length} текстов`);
  }
  return out;
}

/**
 * Кэш эмбеддингов в памяти процесса.
 *
 * Эмбеддинг одного текста занимает 1.4-2.3 секунды — это время самого
 * провайдера, не нашего кода. В чате пользователи часто спрашивают про
 * одни и те же позиции, поэтому повторный запрос за тот же текст платить
 * не должен.
 *
 * Кэш ограничен: без потолка он вырастет на длинной сессии. Вытесняем
 * самый старый — для нашей нагрузки (десятки уникальных строк) этого
 * достаточно, а LRU по счётчику обращений здесь избыточен.
 */
const CACHE_LIMIT = 200;
const cache = new Map<string, number[]>();

function cacheGet(key: string): number[] | undefined {
  const hit = cache.get(key);
  if (hit) {
    // Освежаем позицию, чтобы часто спрашиваемое не вытеснялось
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, vec: number[]): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, vec);
}

/** Очищает кэш. Нужно тестам и скриптам. */
export function clearEmbedCache(): void {
  cache.clear();
}

/** Эмбеддинг одного текста с кэшированием. */
export async function embedText(text: string): Promise<number[]> {
  const key = text.trim().toLowerCase();
  const hit = cacheGet(key);
  if (hit) return hit;

  const [v] = await embedTexts([text]);
  if (!v) throw new Error("Не удалось получить эмбеддинг");
  cacheSet(key, v);
  return v;
}

/**
 * Текст, который кодируем для позиции прайса.
 *
 * Не только название: тип и размеры помогают модели отличить тройник
 * 315/200 от тройника 400/315. Берём то, что человек увидит в счёте.
 */
export function itemEmbeddingText(item: {
  rawName: string;
  type: string;
  dimsKey: string;
  angle?: number | null;
}): string {
  const parts = [item.rawName];
  const extra: string[] = [];
  if (item.angle) extra.push(`угол ${item.angle} градусов`);
  if (item.dimsKey) extra.push(`размер ${item.dimsKey}`);
  if (extra.length) parts.push(`(${extra.join(", ")})`);
  return parts.join(" ");
}

/**
 * Сколько знаков после запятой оставлять в векторе.
 *
 * Не косметика, а производительность. Замерено на пулере Neon:
 *  4 знака — 7 579 байт — 5 619 мс (на грани обрыва)
 *  3 знака — 6 521 байт — 5 930 мс (на грани обрыва)
 *  2 знака — 5 138 байт —   821 мс
 *  1 знак  — 2 272 байта —  590 мс
 *
 * Разница в 7 раз — не сеть, а лимит пулера на объём запроса: у порога
 * соединение начинает «тормозить», и запрос висит секундами.
 *
 * Берём 2 знака: это 5.1 КБ с запасом от порога и достаточно точности,
 * чтобы порядок результатов не менялся (проверено тестом поиска).
 */
export const VECTOR_DIGITS = 2;

/** Вектор в формате pgvector с округлением до безопасного размера. */
export function toVectorLiteral(vec: number[]): string {
  const f = 10 ** VECTOR_DIGITS;
  return `[${vec.map((x) => Math.round(x * f) / f).join(",")}]`;
}
