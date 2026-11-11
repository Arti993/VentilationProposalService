/**
 * Векторный поиск по прайсу.
 *
 * Задача: найти позиции, похожие по смыслу на строку из сметы клиента,
 * когда детерминированный матчер не справился — название нестандартное,
 * сокращённое, с опечаткой или на другом языке описания.
 *
 * Ключевое ограничение, определившее реализацию: пулер Neon рвёт
 * соединение на больших запросах. Вектор 1024 в полном виде — 11 776
 * байт, и одна только передача его в SQL уже обрыв. Отсюда:
 *  - округление до 4 знаков (7 594 байта, проверено, что не влияет
 *    на порядок результатов);
 *  - вектор передаётся в запрос ОДИН раз через CTE. Написать его и в
 *    SELECT, и в ORDER BY значит удвоить объём и снова упасть.
 */
import { withRetry } from "../../db/connection.ts";
import { embedText, toVectorLiteral } from "./embed.ts";

export interface SearchHit {
  /** Код позиции в прайсе: p106 */
  code: string;
  /** Название как в прайсе */
  rawName: string;
  /** Цена за единицу */
  price: number;
  /** Тип изделия */
  type: string;
  /** Размеры */
  dimsKey: string;
  /** Косинусное расстояние: 0 — идентично, 2 — противоположно */
  distance: number;
  /** Сходство: 1 - distance. Ближе к 1 — лучше. */
  similarity: number;
}

interface PriceRow {
  code: string;
  raw_name: string;
  price: string;
  type: string;
  dims_key: string;
  dist: number;
}

/**
 * Ищет похожие позиции прайса.
 *
 * @param query — строка клиента, свободный текст
 * @param limit — сколько кандидатов вернуть
 * @param minSimilarity — отсечка: ниже не берём совсем
 */
export async function searchPrice(
  query: string,
  { limit = 5, minSimilarity = 0 }: { limit?: number; minSimilarity?: number } = {},
): Promise<SearchHit[]> {
  const vec = await embedText(query);
  const literal = toVectorLiteral(vec);

  const rows = await withRetry(
    async (sql) => {
      // Вектор передаётся РОВНО ОДИН раз — в CTE.
      //
      // Здесь была ловушка: даже с CTE литерал уходил дважды, если
      // сослаться на подзапрос и в SELECT, и в ORDER BY — Postgres
      // планирует оба вхождения отдельно, и в сеть уходит 2×7.6 КБ.
      // Для пулера это за лимитом, и запрос «висит» 19 секунд.
      //
      // Поэтому расстояние считаем ОДИН раз в CTE, а наружу достаём
      // уже готовое число: LIMIT и ORDER BY работают по обычному float8.
      return sql<PriceRow[]>`
        WITH q AS (SELECT ${literal}::vector AS v),
        scored AS (
          SELECT
            p.code,
            p.raw_name,
            p.price::text AS price,
            p.type,
            p.dims_key,
            (p.embedding <=> q.v)::float8 AS dist
          FROM price_items p, q
          WHERE p.embedding IS NOT NULL
        )
        SELECT code, raw_name, price, type, dims_key, dist
        FROM scored
        ORDER BY dist
        LIMIT ${limit}
      `;
    },
    // heavy: запрос несёт вектор 7.6 КБ текстом. Такой запрос расходует
    // соединение целиком: второй подряд стабильно рвётся (замерено).
    { label: "searchPrice", retries: 3, heavy: true },
  );

  return rows
    .map((r) => ({
      code: r.code,
      rawName: r.raw_name,
      price: Number(r.price),
      type: r.type,
      dimsKey: r.dims_key,
      distance: r.dist,
      similarity: 1 - r.dist,
    }))
    .filter((h) => h.similarity >= minSimilarity);
}

/**
 * Порог, ниже которого совпадение считается случайным.
 *
 * Замерено на нашем прайсе: правильные совпадения дают сходство 0.75+,
 * а случайные пары разных типов изделий — 0.55-0.65. 0.7 — середина
 * между ними.
 *
 * ВАЖНО: это не порог принятия решения о цене. RAG только предлагает
 * кандидатов, а решение остаётся за детерминированным матчером или
 * человеком. Ошибка в цене опаснее её отсутствия — так что низкий порог
 * здесь не риск: он лишь расширяет список для проверки.
 */
export const SIMILARITY_FLOOR = 0.7;
