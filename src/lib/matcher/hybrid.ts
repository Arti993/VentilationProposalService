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

/**
 * Статус обработки позиции.
 *
 * ВАЖНО: набор значений должен совпадать с PositionStatus в entities,
 * иначе сервер отдаст клиенту статус, которого тот не знает.
 * «ambiguous» (несколько вариантов исполнения) — частный случай
 * needs_human, но показываем его отдельно: менеджеру полезно знать,
 * что дело в варианте, а не в отсутствии позиции.
 */
export type HybridStatus =
  | "priced" // цена есть, уверенность высокая
  | "not_found" // позиции нет в прайсе
  | "needs_human" // нужно решение человека
  | "ambiguous" // есть варианты исполнения (например, R и без R)
  | "off_topic" // не про вентиляцию
  | "error";

export interface HybridResult {
  line: string;
  qty: number;
  /** Единица измерения из сметы клиента */
  unit?: string;
  /** Номер строки в исходном файле */
  lineNo?: number;
  status: HybridStatus;
  /** Позиция прайса, если цену удалось поставить */
  item?: PriceItem;
  unitPrice?: number;
  total?: number;
  /** Отход от нормы, который стоит показать человеку (единица, угол) */
  warnings: string[];
  /** Откуда решение: детерминизм или LLM */
  source: "deterministic" | "llm" | "none";
  confidence: number;
  reason: string;
}

/** Единица, ожидаемая для типа позиции прайса. */
const EXPECTED_UNIT: Record<string, string> = {
  duct_spiral: "м.п.",
  duct_straight: "м.п.",
};

/**
 * Проверяет расхождения, которые не мешают поставить цену,
 * но должны быть видны человеку перед отправкой КП.
 */
function unitWarnings(item: PriceItem, unit?: string): string[] {
  if (!unit) return [];
  const expected = EXPECTED_UNIT[item.type] ?? "шт";
  const same =
    (unit === "м.п." && expected === "м.п.") ||
    (unit === "м²" && expected === "м²") ||
    (unit === "шт" && expected === "шт") ||
    (unit === "компл" && expected === "компл");
  if (same) return [];
  return [`Ед. изм. клиента «${unit}», в прайсе «${expected}» — проверить пересчёт`];
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
  opts: { useLlm?: boolean; model?: string; qty?: number; unit?: string; lineNo?: number } = {},
): Promise<HybridResult> {
  const parsed = parseEstimateLine(line);
  // Явно переданное количество из парсера сметы точнее, чем угаданное из строки
  const qty = opts.qty ?? parsed.qty;
  const unit = opts.unit ?? parsed.unit;
  const det: MatchResult = matchLine(line, price);
  const base = { line, qty, unit, lineNo: opts.lineNo };

  // 1. Однозначное детерминированное совпадение — LLM не нужен
  if (det.status === "matched" && det.item) {
    return {
      ...base,
      status: "priced",
      item: det.item,
      unitPrice: det.item.price,
      total: round(det.item.price * qty),
      warnings: unitWarnings(det.item, unit),
      source: "deterministic",
      confidence: 1,
      reason: det.note ?? "Точное совпадение типа и размеров",
    };
  }

  // 2. Точное отсутствие — LLM не поможет, цены нет
  if (det.status === "not_found") {
    return {
      ...base,
      status: "not_found",
      warnings: [],
      source: "deterministic",
      confidence: 0,
      reason: det.note ?? "Позиции нет в прайсе",
    };
  }

  // 3. Неоднозначно или не разобрано — спрашиваем LLM
  if (opts.useLlm === false) {
    return {
      ...base,
      status: "needs_human",
      warnings: [],
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

  // ВАЖНО: needsHuman проверяем РАНЬШЕ offTopic.
  // Если модель выставила оба флага, значит она сомневается и одновременно
  // считает строку посторонней. В такой ситуации отправить позицию человеку
  // безопаснее, чем молча вычеркнуть из КП: «нет в прайсе» исправимо,
  // «это не про вентиляцию» — нет, менеджер может не заметить пропажу.
  if (llm.needsHuman) {
    return {
      ...base,
      status: "needs_human",
      warnings: [],
      source: "llm",
      confidence: llm.confidence,
      reason: llm.reason || "Требуется уточнение у менеджера",
    };
  }

  if (llm.offTopic) {
    return {
      ...base,
      status: "off_topic",
      warnings: [],
      source: "llm",
      confidence: llm.confidence,
      reason: llm.reason,
    };
  }

  // Цену ставим только если LLM уверен И id существует в прайсе
  if (llm.priceId !== null && llm.confidence >= CONFIDENCE_THRESHOLD) {
    const item = price.find((p) => p.id === llm.priceId);
    if (item) {
      return {
        ...base,
        status: "priced",
        item,
        unitPrice: item.price,
        total: round(item.price * qty),
        warnings: unitWarnings(item, unit),
        source: "llm",
        confidence: llm.confidence,
        reason: llm.reason,
      };
    }
  }

  return {
    ...base,
    status: "needs_human",
    warnings: [],
    source: "llm",
    confidence: llm.confidence,
    reason: llm.reason,
  };
}

/** Обёртка для строк, пришедших из парсера файла сметы. */
export async function processRow(
  row: { name: string; qty: number; unit?: string; lineNo: number },
  price: PriceItem[],
  opts: { useLlm?: boolean; model?: string } = {},
): Promise<HybridResult> {
  const res = await processLine(row.name, price, {
    ...opts,
    qty: row.qty,
    unit: row.unit,
    lineNo: row.lineNo,
  });
  // Для отображения оставляем исходное наименование без служебного хвоста
  return { ...res, line: row.name };
}

/**
 * Обработать список РАЗОБРАННЫХ строк сметы (с количеством и единицей).
 * В отличие от processEstimate принимает EstimateRow, поэтому не теряет
 * количество из таблицы клиента.
 */
export async function processRows(
  rows: Array<{ name: string; qty: number; unit?: string; lineNo: number }>,
  price: PriceItem[],
  opts: { useLlm?: boolean; model?: string; concurrency?: number } = {},
): Promise<HybridResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const results: HybridResult[] = new Array(rows.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= rows.length) return;
      results[i] = await processRow(rows[i], price, opts);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return results;
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
