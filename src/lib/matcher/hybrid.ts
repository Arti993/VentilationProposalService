/**
 * Гибридный матчер: детерминизм -> LLM -> человек.
 *
 * Порядок сознательно жёсткий:
 *  1. Точное совпадение типа/размеров — цена ставится сразу, LLM не вызывается.
 *  2. Не разобрали строку или неоднозначно — спрашиваем LLM с узким списком кандидатов.
 *  3. LLM не уверен — статус needsHuman, цена НЕ ставится.
 *
 * Цена никогда не приходит из LLM. Только из прайса по id.
 */
import { normalize, type PriceItem } from "../price/normalize.ts";
import { matchLine, parseEstimateLine, type MatchResult } from "./match.ts";
import { resolveLine, CONFIDENCE_THRESHOLD, type ResolverOutput } from "../llm/resolver.ts";

export type HybridStatus =
  | "priced" // цена есть, уверенность высокая
  | "not_found" // позиции нет в прайсе
  | "needs_human" // нужно решение человека
  | "off_topic" // не про вентиляцию
  | "error";

export interface HybridResult {
  line: string;
  qty: number;
  status: HybridStatus;
  /** Позиция прайса, если цену удалось поставить */
  item?: PriceItem;
  unitPrice?: number;
  total?: number;
  /** Откуда решение: детерминизм или LLM */
  source: "deterministic" | "llm" | "none";
  confidence: number;
  reason: string;
}

/** Допустимый отрыв по размеру для подбора кандидатов LLM (мм). */
const SIZE_TOLERANCE = 0;

/**
 * Кандидаты для LLM: тот же тип и близкие размеры.
 * Не отправляем весь прайс — это дорого и снижает точность.
 */
function candidatesFor(line: string, price: PriceItem[], limit = 12): PriceItem[] {
  const parsed = normalize(line, 0, -1);
  if (parsed.type === "unknown" || !parsed.dims.length) {
    // Тип не определён — ищем по ЛЮБОМУ числу в строке (≥50 мм), так как
    // неизвестно, какое из них диаметр, а какое угол.
    const nums = (line.match(/\d+/g) ?? []).map(Number).filter((n) => n >= 50);
    if (!nums.length) return [];
    const hits = price.filter((p) => p.dims.some((d) => nums.includes(d)));
    return hits.slice(0, limit);
  }

  const sameType = price.filter((p) => p.type === parsed.type);
  const exactSizes = sameType.filter((p) =>
    parsed.dims.every((d) => p.dims.includes(d)),
  );
  const pool = exactSizes.length ? exactSizes : sameType;
  return pool.slice(0, limit);
}

/**
 * Обработать одну строку сметы.
 */
export async function processLine(
  line: string,
  price: PriceItem[],
  opts: { useLlm?: boolean; model?: string } = {},
): Promise<HybridResult> {
  const parsed = parseEstimateLine(line);
  const det: MatchResult = matchLine(line, price);

  // 1. Однозначное детерминированное совпадение — LLM не нужен
  if (det.status === "matched" && det.item) {
    return {
      line,
      qty: parsed.qty,
      status: "priced",
      item: det.item,
      unitPrice: det.item.price,
      total: round(det.item.price * parsed.qty),
      source: "deterministic",
      confidence: 1,
      reason: det.note ?? "Точное совпадение типа и размеров",
    };
  }

  // 2. Точное отсутствие — LLM не поможет, цены нет
  if (det.status === "not_found") {
    return {
      line,
      qty: parsed.qty,
      status: "not_found",
      source: "deterministic",
      confidence: 0,
      reason: det.note ?? "Позиции нет в прайсе",
    };
  }

  // 3. Неоднозначно или не разобрано — спрашиваем LLM
  if (opts.useLlm === false) {
    return {
      line,
      qty: parsed.qty,
      status: "needs_human",
      source: "none",
      confidence: 0,
      reason: det.note ?? "Требуется уточнение",
    };
  }

  const candidates = candidatesFor(line, price);
  const llm: ResolverOutput = await resolveLine(
    { line, candidates },
    { model: opts.model },
  );

  if (llm.offTopic) {
    return {
      line,
      qty: parsed.qty,
      status: "off_topic",
      source: "llm",
      confidence: llm.confidence,
      reason: llm.reason,
    };
  }

  // Цену ставим только если LLM уверен И id существует в прайсе
  if (llm.priceId !== null && !llm.needsHuman && llm.confidence >= CONFIDENCE_THRESHOLD) {
    const item = price.find((p) => p.id === llm.priceId);
    if (item) {
      return {
        line,
        qty: parsed.qty,
        status: "priced",
        item,
        unitPrice: item.price,
        total: round(item.price * parsed.qty),
        source: "llm",
        confidence: llm.confidence,
        reason: llm.reason,
      };
    }
  }

  return {
    line,
    qty: parsed.qty,
    status: "needs_human",
    source: "llm",
    confidence: llm.confidence,
    reason: llm.reason,
  };
}

/** Обработать смету целиком, последовательно (бережёт лимиты провайдера). */
export async function processEstimate(
  lines: string[],
  price: PriceItem[],
  opts: { useLlm?: boolean; model?: string; concurrency?: number } = {},
): Promise<HybridResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const results: HybridResult[] = new Array(lines.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= lines.length) return;
      results[i] = await processLine(lines[i], price, opts);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, lines.length) }, worker));
  return results;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
