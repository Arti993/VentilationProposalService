/**
 * Разбор смет из Excel (.xlsx, .xlsm) и Word (.docx).
 *
 * Оба формата — это ZIP-архив с XML внутри. Своими руками их не читают:
 * для Excel берём SheetJS, для Word — mammoth. Обе библиотеки работают
 * и в Node, и на Vercel.
 *
 * ГЛАВНАЯ СЛОЖНОСТЬ — НЕ ЧТЕНИЕ, А ПОНИМАНИЕ
 *
 * Прочитать ячейки легко. Трудно понять, какая колонка что значит:
 * в одной смете наименование во второй колонке, в другой — в третьей;
 * количество может быть строкой «48 м.п.» или числом 48 в отдельной
 * колонке; единица измерения — отдельной колонкой или приклеена к числу.
 *
 * Поэтому сначала ищем строку заголовка (в ней есть слова «наименование»,
 * «кол-во», «ед.»), и только потом читаем данные по найденным колонкам.
 * Если заголовка нет — работаем по позициям: ищем в каждой строке ячейку
 * с названием изделия, а рядом — число.
 */
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import type { EstimateRow } from "./parse.ts";

/** Ячейка в том виде, в каком её отдаёт SheetJS. */
type Cell = string | number | boolean | Date | null | undefined;

/**
 * Расширенная строка: помимо готового наименования и количества несёт
 * номер строки в исходном файле — чтобы менеджер мог найти её глазами.
 */
export interface ParsedRow extends EstimateRow {
  /** Лист Excel или номер таблицы Word */
  sheetName?: string;
}

// ────────────────────────────────────────────────────────────
//  Распознавание колонок
// ────────────────────────────────────────────────────────────

/** Что означает заголовок колонки. */
type ColumnRole = "name" | "qty" | "unit" | "num" | "price" | "sum" | "ignore";

/**
 * Правила распознавания заголовков.
 *
 * Порядок важен: «цена за ед.» должна попасть в price, а не в qty,
 * поэтому конкретные шаблоны стоят выше общих. Сравнение идёт по
 * началу строки в нижнем регистре.
 */
const HEADER_RULES: Array<{ role: ColumnRole; re: RegExp }> = [
  { role: "num", re: /^(№|п\/п|n|no|номер|порядков)/i },
  { role: "price", re: /(цена|стоимость).*(ед|шт|м)/i },
  { role: "price", re: /^(цена|стоимость)/i },
  { role: "sum", re: /^(сумма|итого|всего|стоимость\s+всего)/i },
  { role: "qty", re: /^(кол|колич|к-во|объ[её]м|quantity)/i },
  { role: "unit", re: /^(ед|ед\.?\s*изм|единиц)/i },
  { role: "name", re: /^(наименование|название|позиция|товар|оборудование|описание|материал)/i },
  { role: "name", re: /^(позиция|наимен)/i },
];

/**
 * Определяет, что означает колонка по её заголовку.
 *
 * Возвращает null, если заголовок не опознан: такие колонки попадают
 * в ignore и не мешают.
 */
function roleOf(header: string): ColumnRole | null {
  const h = header.toLowerCase().replace(/\s+/g, " ").trim();
  if (!h) return null;
  for (const r of HEADER_RULES) {
    if (r.re.test(h)) return r.role;
  }
  return null;
}

/**
 * Ищет строку заголовка в первых 30 строках листа.
 *
 * Больше 30 не смотрим: сметы, где заголовок ниже, встречаются, но
 * редко, а ложное срабатывание внутри таблицы данных дороже. Признак
 * настоящего заголовка — минимум два опознанных слова из разных колонок:
 * одна ячейка «позиция» может оказаться частью данных.
 */
function findHeaderRow(rows: Cell[][]): { index: number; roles: Map<number, ColumnRole> } | null {
  const limit = Math.min(rows.length, 30);

  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (!row) continue;

    const roles = new Map<number, ColumnRole>();
    for (let c = 0; c < row.length; c++) {
      const text = asText(row[c]);
      if (!text) continue;
      const role = roleOf(text);
      if (role && ![...roles.values()].includes(role)) roles.set(c, role);
    }

    // Нужны минимум наименование и ещё что-то — иначе это не шапка
    if (roles.size >= 2 && [...roles.values()].includes("name")) {
      return { index: i, roles };
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────
//  Приведение значений
// ────────────────────────────────────────────────────────────

function asText(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return "";
  if (v instanceof Date) return "";
  return "";
}

/**
 * Число из ячейки: 48, "48", "48,5", "48 м.п.", "1 200".
 *
 * Возвращает null, если числа нет. Ноль и отрицательное считаем
 * отсутствием: позиция с количеством 0 в смете не имеет смысла.
 */
function asNumber(v: Cell): number | null {
  if (typeof v === "number") return v > 0 ? v : null;
  if (typeof v !== "string") return null;

  // Первое число в строке. Пробелы внутри числа — разделитель тысяч
  const m = v.replace(/\s/g, "").match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;

  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Единица измерения из отдельной ячейки или из хвоста количества. */
const UNIT_RE = /^(м\.?п\.?|п\.?м\.?|пог\.?\s*м|м2|м²|кв\.?\s*м|шт\.?|компл\.?|уп\.?|кг|т|л\.?м\.?|рул\.?)$/i;

function asUnit(v: Cell): string | undefined {
  const t = asText(v);
  if (!t) return undefined;
  const m = t.match(UNIT_RE);
  return m ? m[0].toLowerCase().replace(/\./g, "") : undefined;
}

/**
 * Единица, приклеенная к количеству: «48 м.п.», «12 шт».
 * В Excel так пишут чаще, чем отдельной колонкой.
 */
function unitFromQtyText(v: Cell): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(/(м\.?п\.?|п\.?м\.?|м2|м²|кв\.?\s*м|шт\.?|компл\.?|уп\.?|кг)\s*$/i);
  return m ? m[1].toLowerCase().replace(/\./g, "") : undefined;
}

/** Похоже ли на название изделия — по тем же корням, что и в текстовом парсере. */
const ITEM_HINT =
  /воздуховод|отвод|тройник|переход|ниппель|муфта|заглушк|крестовин|врезк|хомут|клапан|фильтр|вентилятор|диффузор|решетк|решётк|зонт|дроссел|гибк|фланец|дюбель|креп|сегмент|штампован|спиральн|кругл|прямоугольн|оцинков|нержав/i;

// ────────────────────────────────────────────────────────────
//  Разбор листа
// ────────────────────────────────────────────────────────────

/** Строки, которые заведомо не позиции — заголовки шапки и итоги. */
const SKIP_ROW =
  /^(итого|всего|сумма|примечан|прим\.|проект|смета|дата|заказчик|объект|раздел|лист|подпись|составил|проверил|адрес|телефон|контакт)/i;

/**
 * Снимает ведущую нумерацию позиции: «1. », «2) », «12 | ».
 *
 * В книгах без шапки номер обычно вклеен в текст ячейки, а не вынесен
 * в колонку. Номер мешает сопоставлению с прайсом («1. Воздуховод
 * d315» не совпадёт ни с чем), поэтому снимаем его на входе.
 *
 * Осторожно с размерами: «315/200» и «90 градусов» тоже начинаются с
 * цифр, но там после числа нет точки или скобки. Условие `[.)|]` или
 * пробела+буквы отсекает их.
 */
function stripNumbering(name: string): string {
  return name
    .replace(/^\d{1,3}\s*[.)|]\s+/, "")
    .replace(/^\d{1,3}\s+(?=[А-ЯЁA-Zа-яёa-z«"])/u, "")
    .trim();
}

/**
 * Разбирает лист Excel в позиции сметы.
 *
 * Два режима:
 *  1. Найдена шапка — читаем по колонкам, это надёжно.
 *  2. Шапки нет — эвристика по строке: ищем ячейку с названием изделия,
 *     количество берём из соседней числовой.
 *
 * Второй режим нужен потому, что половина реальных смет приходит без
 * шапки: люди просто копируют таблицу из другого файла.
 */
function parseSheet(rows: Cell[][], sheetName: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  const header = findHeaderRow(rows);

  if (header) {
    const { index: start, roles } = header;
    const nameCol = [...roles.entries()].find(([, r]) => r === "name")![0];
    const qtyCol = [...roles.entries()].find(([, r]) => r === "qty")?.[0];
    const unitCol = [...roles.entries()].find(([, r]) => r === "unit")?.[0];

    for (let i = start + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const rawName = asText(row[nameCol]);
      if (!rawName || rawName.length < 3) continue;
      if (SKIP_ROW.test(rawName)) continue;

      // Номер может стоять и отдельной колонкой, и быть вклеенным в
      // название — второй случай для книг без шапки, но и при шапке
      // встречается
      const name = stripNumbering(rawName);
      if (!name || name.length < 3) continue;

      const qtyCell = qtyCol !== undefined ? row[qtyCol] : undefined;
      const qty = asNumber(qtyCell) ?? 1;
      const unit =
        (unitCol !== undefined ? asUnit(row[unitCol]) : undefined) ??
        unitFromQtyText(qtyCell);

      out.push({
        name,
        qty,
        unit,
        raw: row.map(asText).filter(Boolean).join(" | "),
        lineNo: i + 1,
        sheetName,
      });
    }
    return out;
  }

  // ── Режим без шапки ──
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    // Название — самая длинная текстовая ячейка, похожая на изделие
    let rawName = "";
    let nameCol = -1;
    for (let c = 0; c < row.length; c++) {
      const t = asText(row[c]);
      if (t.length > rawName.length && ITEM_HINT.test(t)) {
        rawName = t;
        nameCol = c;
      }
    }
    if (!rawName || rawName.length < 3) continue;
    if (SKIP_ROW.test(rawName)) continue;

    // Номер позиции вклеен в название («1. Воздуховод…») — снимаем,
    // иначе он ломает сопоставление с прайсом
    const name = stripNumbering(rawName);
    if (!name || name.length < 3) continue;

    // Количество — первое число справа от названия
    let qty = 1;
    let unit: string | undefined;
    for (let c = nameCol + 1; c < row.length; c++) {
      const n = asNumber(row[c]);
      if (n !== null) {
        qty = n;
        unit = unitFromQtyText(row[c]) ?? asUnit(row[c + 1]);
        break;
      }
    }

    out.push({
      name,
      qty,
      unit,
      raw: row.map(asText).filter(Boolean).join(" | "),
      lineNo: i + 1,
      sheetName,
    });
  }

  return out;
}

/**
 * Читает Excel-файл целиком.
 *
 * Берём ВСЕ листы, а не первый: в сметах часто есть лист «Титул» с
 * реквизитами и лист «Смета» с оборудованием, причём порядок бывает
 * любой. Позиции с разных листов объединяем.
 *
 * `sheet_to_json` с `header: 1` отдаёт массив массивов — именно то, что
 * нужно: имя колонки может быть в любой строке, а не только в первой.
 */
export async function parseExcel(buffer: ArrayBuffer): Promise<ParsedRow[]> {
  const wb = XLSX.read(buffer, {
    type: "array",
    // Формулы не вычисляем: в файле нет закэшированных значений, а
    // вычисление требует полноценного движка. Текст и числа читаются.
    cellFormula: false,
    dense: false,
  });

  const out: ParsedRow[] = [];

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<Cell[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });

    if (!rows.length) continue;
    out.push(...parseSheet(rows, name));
  }

  return out;
}

// ────────────────────────────────────────────────────────────
//  Word
// ────────────────────────────────────────────────────────────

/**
 * Читает .docx и превращает в текстовые строки.
 *
 * КЛЮЧЕВОЕ РЕШЕНИЕ: берём HTML, а не сырой текст.
 *
 * `extractRawText` разбивает ячейки таблицы на отдельные строки: «48»,
 * «м.п.», «2340» идут каждая своей строкой. Текстовый парсер ищет
 * количество в хвосте названия — и не находит, поэтому все позиции
 * получают количество 1. Ошибка тихая: смета выглядит разобранной,
 * но суммы неверны.
 *
 * HTML сохраняет структуру: `<tr>` — строка, `<td>` — ячейка. Разбираем
 * и склеиваем ячейки одной строки через разделитель, который понимает
 * текстовый парсер («название   48   м.п.»).
 *
 * mammoth не использует DOMParser в Node, поэтому работаем регэкспом:
 * разметка, которую он отдаёт, предельно простая и предсказуемая.
 */
export async function parseWord(buffer: ArrayBuffer): Promise<string> {
  // mammoth в Node ищет только `buffer` и не читает `arrayBuffer` —
  // это разница между его сборками для браузера и для сервера.
  // Сообщение «Could not find file in options» означает ровно это,
  // а не отсутствие файла.
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(buffer) });
  return htmlToText(result.value);
}

/** Убирает HTML-сущности, которые mammoth ставит в тексте. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Превращает HTML от mammoth в строки для текстового парсера.
 *
 * Таблицы становятся строками из ячеек, склеенных тремя пробелами —
 * ровно тот формат, который parseEstimateText уже умеет читать
 * («название   48   м.п.»). Абзацы вне таблиц остаются отдельными
 * строками, чтобы реквизиты в шапке отсеялись штатными правилами.
 */
function htmlToText(html: string): string {
  const lines: string[] = [];

  // Каждую таблицу обрабатываем отдельно и заменяем на текстовые строки
  const withoutTables = html.replace(/<table[\s\S]*?<\/table>/gi, (table) => {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];

    for (const row of rows) {
      const cells = row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? [];
      const parts = cells.map((c) =>
        decodeEntities(
          c
            .replace(/<\/t[dh]>/i, "")
            .replace(/<t[dh][^>]*>/i, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        ),
      );

      // Пустые ячейки сохраняем как пустые позиции: сдвиг колонок
      // важнее компактности — иначе количество уедет в соседнюю графу
      const joined = parts.join("   ").trim();
      if (joined) lines.push(joined);
    }

    return "\n";
  });

  // Абзацы вне таблиц
  for (const p of withoutTables.split(/<\/p>/i)) {
    const text = decodeEntities(p.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (text) lines.push(text);
  }

  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────
//  Определение формата
// ────────────────────────────────────────────────────────────

export type EstimateFormat = "text" | "excel" | "word";

export const EXTENSIONS: Record<string, EstimateFormat> = {
  ".txt": "text",
  ".csv": "text",
  ".tsv": "text",
  ".xlsx": "excel",
  ".xlsm": "excel",
  ".xls": "excel",
  ".docx": "word",
};

export const ALLOWED_EXTENSIONS = Object.keys(EXTENSIONS);

/**
 * Определяет формат по расширению.
 *
 * Расширение не доверяем как доказательству — файл ещё проверяется по
 * сигнатуре. Но определять формат по содержимому целиком тоже нельзя:
 * .xlsx и .docx начинаются одинаково (оба ZIP, «PK»), и различить их
 * можно только заглянув внутрь архива.
 */
export function formatOf(fileName: string): EstimateFormat | null {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  return EXTENSIONS[ext] ?? null;
}
