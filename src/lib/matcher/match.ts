/**
 * Детерминированный матчер позиций сметы с прайсом.
 *
 * Принцип: сначала нормализуем строку сметы в ту же структуру, что и прайс.
 * Если тип и размеры совпали — совпадение однозначное, LLM не нужен.
 * LLM подключается ТОЛЬКО для неоднозначных случаев (см. needsLlmReason).
 */
import {
  normalize,
  type PriceItem,
  type ItemType,
} from "../price/normalize.ts";

export type MatchStatus =
  | "matched" // однозначное совпадение
  | "ambiguous" // есть варианты исполнения (например, R и без R)
  | "not_found" // размер/тип не найден в прайсе
  | "needs_llm" // не удалось разобрать строку — нужен LLM
  | "unit_mismatch"; // совпало, но единицы разные

export interface MatchResult {
  status: MatchStatus;
  item?: PriceItem;
  candidates: PriceItem[];
  /** Пояснение для UI и логов */
  note?: string;
}

/** Разбор строки сметы клиента. Отличается от прайсной наличием единиц/кол-ва. */
export interface EstimateLine {
  raw: string;
  qty: number;
  unit?: string;
}

/**
 * Разбор строки сметы вида:
 *   "Воздуховод гибкий d315 — 12 м.п."
 *   "Тройник 160/100, 4 шт"
 *   "Отвод 45° Ø250 2шт"
 */
export function parseEstimateLine(raw: string): EstimateLine {
  const qtyMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*(м\.?п\.?|м2|м²|шт\.?|компл\.?)?\s*$/i);
  const qty = qtyMatch ? Number(qtyMatch[1].replace(",", ".")) : 1;
  const unit = qtyMatch?.[2]?.toLowerCase().replace(/\./g, "") || undefined;
  return { raw: raw.trim(), qty, unit };
}

/**
 * Основной вход: сопоставить строку сметы с прайсом.
 */
export function matchLine(
  line: string,
  price: PriceItem[],
  opts: { preferredVariant?: string } = {},
): MatchResult {
  const parsed = normalize(line, 0, -1);

  // Не смогли разобрать тип — отдаём LLM
  if (parsed.type === "unknown") {
    return {
      status: "needs_llm",
      candidates: [],
      note: `Не удалось определить тип: "${line}"`,
    };
  }

  // Нет размеров — тоже повод для LLM
  if (!parsed.dims.length) {
    return {
      status: "needs_llm",
      candidates: [],
      note: `Не удалось извлечь размеры: "${line}"`,
    };
  }

  // "отвод" без вида (сегментный/штампованный) — это другой ТИП, но клиент
  // мог иметь в виду любой из них. Разрешать за него — значит угадывать цену.
  if (parsed.type === "elbow_segmented" && !hasKindWord(line)) {
    const seg = price.filter((p) => p.type === "elbow_segmented");
    return {
      status: "needs_llm",
      candidates: seg.filter((p) => sameDims(p.dims, parsed.dims)),
      note: `Вид отвода не указан (сегментный или штампованный): "${line}"`,
    };
  }

  // Кандидаты: тот же тип, те же размеры
  let candidates = price.filter(
    (p) =>
      p.type === parsed.type &&
      sameDims(p.dims, parsed.dims) &&
      (parsed.angle === undefined || p.angle === parsed.angle),
  );

  // Угол в смете опущен — неоднозначности нет, но для отводов это стоит
  // отметить в интерфейсе: клиент может имел в виду другой угол.
  const angleMissing =
    parsed.angle === undefined && candidates.length > 0 && hasAngles(parsed.type);

  if (candidates.length === 0) {
    return {
      status: "not_found",
      candidates: [],
      note: `В прайсе нет ${typeName(parsed.type)} ${parsed.dims.join("/")}${
        parsed.angle ? ` ${parsed.angle}°` : ""
      }`,
    };
  }

  // Несколько вариантов исполнения (R / без R) — выбор неоднозначен
  const variants = new Set(candidates.map((c) => c.variant ?? ""));
  if (variants.size > 1) {
    const preferred = opts.preferredVariant;
    if (preferred !== undefined) {
      const pick = candidates.find((c) => (c.variant ?? "") === preferred);
      if (pick) return { status: "matched", item: pick, candidates };
    }
    return {
      status: "ambiguous",
      candidates,
      note: `Несколько вариантов исполнения: ${[...variants].map((v) => v || "без пометки").join(", ")}`,
    };
  }

  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      candidates,
      note: `Найдено ${candidates.length} позиций с одинаковыми размерами`,
    };
  }

  return {
    status: "matched",
    item: candidates[0],
    candidates,
    note: angleMissing
      ? `Угол не указан в смете, принят ${candidates[0].angle ?? "—"}°`
      : undefined,
  };
}

function sameDims(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** Типы, у которых угол — значимая часть позиции. */
function hasAngles(t: ItemType): boolean {
  return t === "elbow_segmented" || t === "elbow_stamped";
}

/**
 * Есть ли в строке слово, задающее вид изделия.
 * "Отвод сегментный 90 315" — да. "Отвод 90 на 315" — нет.
 */
function hasKindWord(line: string): boolean {
  return /сегментн|штампованн/i.test(line);
}

function typeName(t: ItemType): string {
  return t;
}

/**
 * Решение о цене для КП.
 * Ключевое правило: цену ставим ТОЛЬКО при однозначном совпадении.
 */
export function priceFor(result: MatchResult, qty: number): { unit?: number; total?: number } {
  if (result.status !== "matched" || !result.item) return {};
  return { unit: result.item.price, total: Math.round(result.item.price * qty * 100) / 100 };
}
