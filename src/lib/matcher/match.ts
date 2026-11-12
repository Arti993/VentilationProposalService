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
 *
 * ВАЖНО: в названиях размеры идут парами ("315/200", "315х160"), и простой
 * поиск последнего числа даёт ложное количество. Поэтому количество берём
 * ТОЛЬКО если после него стоит единица измерения, либо если число отделено
 * от наименования явным разделителем (запятая, тире, несколько пробелов).
 */
export function parseEstimateLine(raw: string): EstimateLine {
  const s = raw.trim();

  // 1. Явный вид: "<название>  12 м.п." / "<название>, 4 шт"
  const withUnit = s.match(
    /^(.*?)(?:[\s,;—–-]+)(\d+(?:[.,]\d+)?)\s*(м\.?п\.?|п\.?м\.?|м2|м²|кв\.?м\.?|шт\.?|компл\.?|уп\.?)\s*$/i,
  );
  if (withUnit) {
    const qty = Number(withUnit[2].replace(",", "."));
    if (Number.isFinite(qty) && qty > 0) {
      return {
        raw: raw.trim(),
        qty,
        unit: withUnit[3].toLowerCase().replace(/\./g, ""),
      };
    }
  }

  // 2. Число в конце, отделённое запятой/тире/двойным пробелом:
  //    "Тройник 315/200, 4" — но НЕ "Тройник 315/200"
  const separated = s.match(/^(.*[\d)\s])[,;—–]\s*(\d+(?:[.,]\d+)?)\s*$/);
  if (separated && !/[dф]\s*\d+$/i.test(s)) {
    const qty = Number(separated[2].replace(",", "."));
    if (Number.isFinite(qty) && qty > 0) {
      return { raw: raw.trim(), qty, unit: undefined };
    }
  }

  // 3. Количество не указано — это нормально для вопроса про цену.
  return { raw: raw.trim(), qty: 1, unit: undefined };
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
      candidates: seg.filter((p) => sameDims(p.dims, parsed.dims, p.type)),
      note: `Вид отвода не указан (сегментный или штампованный): "${line}"`,
    };
  }

  // Кандидаты: тот же тип, те же размеры
  let candidates = price.filter(
    (p) =>
      p.type === parsed.type &&
      sameDims(p.dims, parsed.dims, p.type) &&
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

/**
 * Сравнение размеров.
 *
 * ВАЖНО: в реальном прайсе врезки и тройники записаны только в ОДНОМ порядке
 * («Врезка седло 160/200»), а клиент может написать наоборот («200/160»).
 * 21 из 29 врезок и 20 из 28 тройников существуют лишь в одну сторону,
 * поэтому сравнение по порядку даёт ложное «нет в прайсе».
 *
 * Для симметричных типов сравниваем как множество размеров.
 * Для перехода порядок важен: 400/355 и 355/400 — разные изделия.
 */
function sameDims(a: number[], b: number[], type: ItemType): boolean {
  if (a.length !== b.length) return false;

  if (isOrderInsensitive(type)) {
    const sa = [...a].sort((x, y) => x - y);
    const sb = [...b].sort((x, y) => x - y);
    return sa.every((v, i) => v === sb[i]);
  }

  return a.every((v, i) => v === b[i]);
}

/** Типы, у которых порядок диаметров не меняет изделие. */
function isOrderInsensitive(t: ItemType): boolean {
  return t === "tee" || t === "saddle" || t === "cross";
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
