/**
 * Парсер файлов смет.
 *
 * Задача: превратить произвольный текст/CSV в список строк-позиций.
 * Всё, что не похоже на позицию, отбрасывается на входе, а не уходит
 * в LLM — иначе токены тратятся на заголовки и примечания.
 */

export interface EstimateRow {
  /** Наименование позиции */
  name: string;
  /** Количество (1, если не указано) */
  qty: number;
  /** Единица измерения из сметы (может быть не указана) */
  unit?: string;
  /** Исходная строка файла — для отладки и трассировки */
  raw: string;
  /** Номер строки в файле */
  lineNo: number;
}

/** Строки, которые заведомо не являются позициями. */
const SKIP_PATTERNS: RegExp[] = [
  /^\s*$/,
  /^(№|N\s*\|)/i,
  /^(наименование|название|позиция|товар)\b/i,
  /^(итого|всего|сумма)\b/i,
  /^(примечание|прим\.|комментарий|дата|проект|смета|заказчик|объект|раздел|лист)\b/i,
  /^[-=_*]{3,}\s*$/,
  // Строки без единого кириллического/латинского слова — мусор
  /^[^\p{L}]+$/u,
];

/**
 * Признаки строки с количеством в табличном виде: "48 м.п.", "12 шт".
 * Нужны, чтобы отличить "1 Воздуховод d=315   48   м.п." от обычного текста.
 */
const HAS_TABULAR_QTY = /(\d+(?:[.,]\d+)?)\s*(м\.?п\.?|п\.?м\.?|м2|м²|кв\.?м\.?|шт\.?|компл\.?|уп\.?)\b/i;

/** Единицы измерения, которые понимаем. */
const UNIT_RE = /^(м\.?п\.?|п\.?м\.?|м|м2|м²|кв\.?м\.?|шт\.?|компл\.?|уп\.?|кг|т|л\.?м\.?)$/i;

/** Приводит единицу к каноничному виду. */
export function normalizeUnit(unit?: string): string | undefined {
  if (!unit) return undefined;
  const u = unit.toLowerCase().replace(/\./g, "").trim();
  if (/^(мп|пм|м)$/.test(u)) return "м.п.";
  if (/^(м2|квм|м²)$/.test(u)) return "м²";
  if (/^(шт|компл|уп)$/.test(u)) return u === "шт" ? "шт" : u;
  if (/^(кг|т|лм)$/.test(u)) return u;
  return unit.trim();
}

/** Убирает BOM и нормализует пробелы. */
function clean(s: string): string {
  return s.replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
}

/**
 * Нормализует ТАБЫ в разделители с двойным пробелом (до склейки пробелов).
 * В табличных сметах колонки разделены табами или выравниванием.
 */
function preserveColumns(s: string): string {
  return s.replace(/^\uFEFF/, "").replace(/\t+/g, "   ").trimEnd();
}

/**
 * Разбирает одну строку "наименование [кол-во] [ед.]".
 *
 * Приоритет — хвост строки: в конце обычно количество и единица.
 * Если хвоста нет, считаем количество = 1.
 */
export function parseRow(line: string, lineNo: number): EstimateRow | null {
  const raw = line;
  // Сохраняем колонки (табы/выравнивание) до схлопывания пробелов
  let s = preserveColumns(line);

  // CSV с заголовком таблицы — пропускаем
  if (/^"?наименование"?\s*[,;]/i.test(s)) return null;

  // CSV: наименование может быть в кавычках
  const csvMatch = s.match(/^"(.*?)"\s*,\s*(.*)$/);
  if (csvMatch) {
    const name = clean(csvMatch[1]);
    const rest = clean(csvMatch[2]);
    const parts = rest.split(",").map((p) => clean(p)).filter(Boolean);
    const qty = Number(parts[0]?.replace(",", "."));
    const unit = parts.find((p) => UNIT_RE.test(p));
    if (!name) return null;
    return {
      name,
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      unit: normalizeUnit(unit),
      raw,
      lineNo,
    };
  }

  // Ищем "хвост количества" В КОНЦЕ строки: "...  48   м.п."
  // Разделитель — 2+ пробела/таба ИЛИ просто пробел, если дальше идёт единица.
  const tailWithUnit = s.match(
    /^(.*?)(?: {2,}|[|;])\s*(\d+(?:[.,]\d+)?)\s*(м\.?п\.?|п\.?м\.?|м2|м²|кв\.?м\.?|шт\.?|компл\.?|уп\.?)\s*$/i,
  );
  // Вариант через запятую/точку с запятой (CSV без кавычек): "название,48,шт"
  const tailCsv = !tailWithUnit
    ? s.match(
        /^(.+?)\s*[,;]\s*(\d+(?:[.,]\d+)?)\s*[,;]\s*(м\.?п\.?|п\.?м\.?|м2|м²|кв\.?м\.?|шт\.?|компл\.?|уп\.?)\s*$/i,
      )
    : null;

  let name = s;
  let qty = 1;
  let unit: string | undefined;

  const m = tailWithUnit ?? tailCsv;
  if (m && clean(m[1]).length > 2) {
    name = clean(m[1]);
    qty = Number(m[2].replace(",", "."));
    unit = normalizeUnit(m[3]);
  } else {
    // Нет единицы: ищем "название  число" в конце, но только если название
    // не кончается на артикул/размер ("3x2.5", "315/160", "d315").
    s = clean(s);
    const tail = s.match(/^(.*?)(?: {2,}|[,|])\s*(\d+(?:[.,]\d+)?)\s*$/);
    if (tail && clean(tail[1]).length > 2 && !/[0-9]$/.test(clean(tail[1]))) {
      name = clean(tail[1]);
      qty = Number(tail[2].replace(",", "."));
    }
  }

  // Снимаем ведущую нумерацию таблицы: "1.", "1)", "12 |", а также просто
  // "10 Муфта..." — колонка № часто отделена пробелами без точки.
  name = clean(
    name
      .replace(/^\d{1,3}\s*[.)|]\s+/, "")
      .replace(/^\d{1,3}\s+(?=[А-ЯЁA-Zа-яёa-z])/u, ""),
  );

  if (!name || name.length < 3) return null;
  if (!Number.isFinite(qty) || qty <= 0) qty = 1;

  return { name, qty, unit, raw, lineNo };
}

/** Полный разбор текста файла. */
export function parseEstimateText(text: string): EstimateRow[] {
  const rows: EstimateRow[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SKIP_PATTERNS.some((re) => re.test(line))) continue;

    const row = parseRow(line, i + 1);
    if (!row) continue;

    // Отсев "служебных" строк по началу наименования: заголовки шапки,
    // примечания и подписи. Отдельно от SKIP_PATTERNS, так как проверка
    // идёт по уже извлечённому наименованию.
    if (isServiceLine(row.name)) continue;

    rows.push(row);
  }

  return rows;
}

/**
 * Является ли наименование служебной строкой, а не позицией сметы.
 * Важно не отсечь реальные позиции — поэтому проверяем только начало строки
 * и явные служебные слова без размеров.
 */
function isServiceLine(name: string): boolean {
  const n = name.toLowerCase();

  // Явные служебные начала
  if (
    /^(проект|смета|дата|заказчик|объект|примечание|прим\.|итого|всего|подпись|составил|проверил|раздел|лист|адрес|телефон|контакт)\b/.test(
      n,
    )
  ) {
    return true;
  }

  // "Смета на поставку оборудования" и подобное — есть слово "смета"
  if (/\bсмета\b/.test(n) && !/\d{2,}/.test(n)) return true;

  const KNOWN_ITEM =
    /воздуховод|отвод|тройник|переход|ниппель|муфта|заглушка|крестовин|врезк|хомут|клапан|фильтр|вентилятор|монтаж|кабель/i;

  // Подпись "Ключ: значение", где значение не содержит изделия:
  // "Дата: 05.11.2026", "Объект: офис на Ленской"
  if (/^[^:]{2,40}:\s/.test(n) && !KNOWN_ITEM.test(n)) return true;

  // Совсем без цифр и без названия изделия — заголовок
  if (!KNOWN_ITEM.test(n) && !/\d/.test(n)) return true;

  return false;
}
