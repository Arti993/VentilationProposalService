/**
 * Разбор загруженного прайса.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ ПЕРЕИСПОЛЬЗОВАНИЕ РАЗБОРА СМЕТ
 *
 * Смета и прайс — разные таблицы, и путать их колонки опасно. В смете
 * бывает колонка «цена заказчика», в прайсе — «цена поставщика». Если
 * разбирать прайс тем же кодом, что смету, можно взять не ту колонку и
 * получить КП, где цены — из чужой колонки. Поэтому здесь свой разбор со
 * своим набором допустимых заголовков.
 *
 * ГЛАВНЫЙ ПРИНЦИП: ЛУЧШЕ ОТКАЗАТЬ, ЧЕМ УГАДАТЬ
 *
 * Если колонку с ценой или названием найти не удалось — возвращаем
 * ошибку с понятным текстом, а не пытаемся «взять первую колонку».
 * Клиент загружает свой прайс один раз; лучше он поправит заголовки, чем
 * получит КП с перепутанными ценами и не заметит.
 *
 * ЧТО ЗДЕСЬ НЕТ
 *
 * Нормализации. Разбор достаёт строки как есть, нормализатор
 * (`lib/price/normalize.ts`) превращает их в позиции с типом и размерами.
 * Разделение важно: разбор не знает про «воздуховоды», нормализация не
 * знает про Excel.
 */

import * as XLSX from "xlsx";
// Относительный путь, а не `@/`: этот модуль запускают и скрипты проверки
// через обычный `node`, который про алиасы из tsconfig не знает.
import { normalize, type PriceItem } from "./normalize.ts";

/** Сколько позиций принимаем за одну загрузку. */
export const MAX_PRICE_ITEMS = 5_000;

/** Заголовки колонки с названием позиции. */
const NAME_HEADERS = [
  "наименование",
  "название",
  "позиция",
  "номенклатура",
  "товар",
  "изделие",
  "продукция",
  "name",
  "title",
];

/** Заголовки колонки с ценой. */
const PRICE_HEADERS = [
  "цена",
  " цена",
  "цена руб",
  "цена, руб",
  "цена р",
  "стоимость",
  "price",
  "цена за единицу",
  "цена с ндс",
  "цена без ндс",
];

/** Заголовки колонки с кодом позиции. */
const CODE_HEADERS = ["код", "артикул", "code", "арт", "sku", "id"];

/** Заголовки колонки с единицей измерения. */
const UNIT_HEADERS = ["ед", "ед изм", "единица", "единица измерения", "unit", "ед измерения"];

export interface PriceParseOk {
  ok: true;
  items: PriceItem[];
  /** Колонки, которые распознаны — показываем в кабинете для проверки. */
  columns: { name: number; price: number; code: number | null; unit: number | null };
  /** Сколько строк пропущено: пустые, без цены, не разобрались. */
  skipped: number;
}

export interface PriceParseError {
  ok: false;
  /** Текст для человека, не код ошибки. */
  error: string;
  /** Что делать дальше. */
  hint: string;
}

export type PriceParseResult = PriceParseOk | PriceParseError;

/** Убирает пробелы и приводит к нижнему регистру; для сравнения заголовков. */
function headerKey(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Ищет колонку по списку допустимых заголовков. */
function findColumn(headers: unknown[], candidates: string[]): number | null {
  const keys = headers.map(headerKey);
  for (const candidate of candidates) {
    const key = headerKey(candidate);
    const exact = keys.indexOf(key);
    if (exact >= 0) return exact;
  }
  // Второй проход: частичное совпадение («цена, руб./шт.»)
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]!;
    if (!key) continue;
    for (const candidate of candidates) {
      const c = headerKey(candidate);
      if (c.length >= 3 && key.includes(c)) return i;
    }
  }
  return null;
}

/** Превращает ячейку цены в число. Возвращает null, если не получилось. */
function priceOf(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 0 ? raw : null;
  }
  const text = String(raw ?? "")
    .replace(/\u00a0/g, " ")
    // Пробелы как разделитель тысяч: «1 234,50»
    .replace(/[\s']/g, "")
    // Десятичная запятая
    .replace(",", ".")
    // Валюта и прочий мусор
    .replace(/[^\d.]/g, "");
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Разбирает таблицу прайса из XLSX/CSV.
 *
 * Принимает уже прочитанный буфер: чтение файла и разбор разделены, чтобы
 * разбор можно было проверить в тестах без файловой системы.
 *
 * ЛОВУШКА С КОДИРОВКОЙ CSV
 *
 * SheetJS читает байты CSV как `latin1`, а не как UTF-8. Кириллица при
 * этом превращается в мусор: «Наименование» становится «ÐÐ°Ð¸Ð¼ÐµÐ½Ð¾Ð²Ð°Ð½Ð¸Ðµ», и разбор
 * отвечает «не нашёл колонки». Симптом обманчив — кажется, что клиент
 * прислал файл не того формата, хотя формат верный.
 *
 * Поэтому CSV декодируем сами и отдаём строку с `type: "string"`. Только
 * так SheetJS получает уже правильный текст.
 *
 * Кодировку определяем по BOM:
 *   EF BB BF       — UTF-8 (его ставит Excel при «CSV UTF-8»)
 *   FF FE / FE FF  — UTF-16 LE/BE
 *   без BOM         — пробуем UTF-8: если текст валиден, берём его,
 *                     иначе падаем на Windows-1251 (её даёт «CSV (разделители
 *                     с запятой)» в русской Windows)
 *
 * Проверка «валиден ли UTF-8» делается через `TextDecoder` с
 * `fatal: true`: он бросает исключение на некорректных
 * последовательностях. Битые байты на выходе не «заменяются», как в
 * обычном режиме, а сигнализируют, что это не UTF-8.
 */
export function decodeCsv(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  // BOM → кодировка известна точно
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    /**
     * Не UTF-8 — почти наверняка Windows-1251, самая частая кодировка
     * русских CSV. `TextDecoder` понимает её как "windows-1251" в Node 18+
     * и в браузерах, так что дополнительных зависимостей не нужно.
     */
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

/** Похоже ли содержимое на CSV: расширение здесь не единственный признак. */
function looksLikeCsv(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);

  // ZIP-сигнатура: XLSX — это zip-архив
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return false;
  // Старый бинарный XLS
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return false;

  // Текстовый файл: BOM, либо в начале нет нулевых байтов
  if (bytes[0] === 0xef || bytes[0] === 0xff || bytes[0] === 0xfe) return true;
  return !bytes.subarray(0, 64).includes(0);
}

export function parsePriceWorkbook(buffer: ArrayBuffer): PriceParseResult {
  let sheet: XLSX.WorkSheet;
  try {
    /**
     * CSV читаем как текст, всё остальное — как массив байт.
     *
     * Проверяем содержимое, а не расширение: файл `price.csv` может
     * оказаться переименованным xlsx (частая история при пересылке через
     * мессенджеры), и наоборот. Расширение — подсказка, а не факт.
     */
    const book = looksLikeCsv(buffer)
      ? XLSX.read(decodeCsv(buffer), { type: "string" })
      : XLSX.read(buffer, { type: "array" });
    const first = book.SheetNames[0];
    if (!first) {
      return {
        ok: false,
        error: "В файле нет ни одного листа",
        hint: "Сохраните прайс в формате .xlsx или .csv.",
      };
    }
    sheet = book.Sheets[first]!;
  } catch {
    return {
      ok: false,
      error: "Не удалось прочитать файл как таблицу",
      hint: "Подойдёт .xlsx, .xls или .csv. Старый .xls попробуйте сохранить как .xlsx.",
    };
  }

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  });

  if (grid.length === 0) {
    return {
      ok: false,
      error: "Таблица пустая",
      hint: "Разместите позиции прайса на первом листе файла.",
    };
  }

  /**
   * Ищем строку заголовков среди первых десяти.
   *
   * Прайсы часто начинаются с названия компании и даты, поэтому заголовки
   * не всегда в первой строке. Десять — потому что дальше это уже не
   * шапка, а данные.
   */
  let headerRow = -1;
  let nameCol = -1;
  let priceCol = -1;
  let codeCol: number | null = null;
  let unitCol: number | null = null;

  for (let r = 0; r < Math.min(10, grid.length); r += 1) {
    const row = grid[r] ?? [];
    const n = findColumn(row, NAME_HEADERS);
    const p = findColumn(row, PRICE_HEADERS);
    if (n !== null && p !== null) {
      headerRow = r;
      nameCol = n;
      priceCol = p;
      codeCol = findColumn(row, CODE_HEADERS);
      unitCol = findColumn(row, UNIT_HEADERS);
      break;
    }
  }

  if (headerRow < 0) {
    return {
      ok: false,
      error: "Не найдены колонки «Наименование» и «Цена»",
      hint:
        "В первой строке прайса должны быть заголовки: «Наименование» и «Цена». " +
        "Переименуйте соответствующие колонки и повторите загрузку.",
    };
  }

  const items: PriceItem[] = [];
  const usedCodes = new Set<string>();
  let skipped = 0;

  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const rawName = String(row[nameCol] ?? "").replace(/\u00a0/g, " ").trim();
    if (!rawName) {
      skipped += 1;
      continue;
    }

    const price = priceOf(row[priceCol]);
    if (price === null) {
      // Без цены позиция бессмысленна: в прайсе она нужна ровно ради цены
      skipped += 1;
      continue;
    }

    /**
     * Единица измерения в названии.
     *
     * Прайс обычно содержит отдельную колонку «ед. изм.»: м2, м.п., шт.
     * Нормализатор ищет единицу в тексте названия, поэтому дописываем её
     * туда, иначе «Воздуховод 315» из прайса и «Воздуховод 315, м2» из
     * сметы получат разные единицы и не совпадут.
     */
    const unit = unitCol !== null ? String(row[unitCol] ?? "").trim() : "";
    const rawWithUnit =
      unit && !rawName.toLowerCase().includes(unit.toLowerCase())
        ? `${rawName}, ${unit}`
        : rawName;

    /**
     * Код позиции.
     *
     * Нормализатор выдаёт id вида `p001` по порядку. Это годится для
     * демо-прайса, но не для загруженного: если клиент загрузит прайс
     * повторно в другом порядке, старые id укажут на другие позиции, а
     * они уже лежат в сметах. Поэтому свой код из файла важнее — берём
     * его, если он есть, и следим за уникальностью. Иначе две разные
     * позиции получили бы один код, и цена одной применилась бы к другой.
     */
    const normalized = normalize(rawWithUnit, price, items.length);
    const ownCode = String(row[codeCol ?? -1] ?? "").trim();
    let code = ownCode || normalized.id;
    if (usedCodes.has(code)) {
      let n = 2;
      while (usedCodes.has(`${code}-${n}`)) n += 1;
      code = `${code}-${n}`;
    }
    usedCodes.add(code);
    normalized.id = code;

    items.push(normalized);

    if (items.length > MAX_PRICE_ITEMS) {
      return {
        ok: false,
        error: `В прайсе больше ${MAX_PRICE_ITEMS} позиций`,
        hint:
          "Загрузите часть прайса — например, только нужные разделы. " +
          "Оставьте в файле только необходимые разделы прайса.",
      };
    }
  }

  if (items.length === 0) {
    return {
      ok: false,
      error: "Не найдены позиции с ценой",
      hint:
        "Проверьте, что строки содержат наименования, а цены записаны " +
        "как числа (например 1250 или 1250,50), а не как «по запросу».",
    };
  }

  return {
    ok: true,
    items,
    columns: { name: nameCol, price: priceCol, code: codeCol, unit: unitCol },
    skipped,
  };
}

/**
 * Сколько позиций прайса разобрались по типу.
 *
 * Нужно для показа после загрузки: «из 215 позиций 198 разобраны
 * полностью, 17 — только по названию». Второе число честно говорит, что
 * часть позиций не будет находиться автоматически.
 */
export function describeQuality(items: PriceItem[]): {
  total: number;
  withDims: number;
  withoutDims: number;
  byType: Record<string, number>;
} {
  const byType: Record<string, number> = {};
  let withDims = 0;
  for (const item of items) {
    byType[item.type] = (byType[item.type] ?? 0) + 1;
    if (item.dims.length > 0) withDims += 1;
  }
  return { total: items.length, withDims, withoutDims: items.length - withDims, byType };
}
