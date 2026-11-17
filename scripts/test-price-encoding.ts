/**
 * Проверка чтения CSV-прайсов в разных кодировках.
 *
 * Запуск: node --env-file=.env.local scripts/test-price-encoding.ts
 *
 * НАЙДЕННАЯ ОШИБКА
 *
 * SheetJS читает байты CSV как `latin1`. Кириллица в UTF-8 при этом
 * превращается в мусор («Наименование» → «ÐÐ°Ð¸Ð¼ÐµÐ½Ð¾Ð²Ð°Ð½Ð¸Ðµ»), разбор не находит
 * заголовки и отвечает «Не нашёл колонки "Наименование" и "Цена"».
 *
 * Ошибка была живой: клиент загружал совершенно правильный CSV, а система
 * говорила, что формат не тот. Нашлась случайно — при написании теста
 * обратной связи, где понадобился маленький прайс.
 *
 * Проверяем ВСЕ кодировки, которые реально встречаются:
 *   — UTF-8 без BOM (то, что отдаёт большинство редакторов и Google Sheets);
 *   — UTF-8 с BOM (Excel «CSV UTF-8»);
 *   — Windows-1251 (Excel «CSV (разделители с запятой)» в русской Windows).
 *
 * Последняя важнее остальных: именно её по умолчанию даёт Excel на русской
 * системе, а прайсы поставщиков делают в Excel.
 */

import { parsePriceWorkbook, decodeCsv } from "../src/lib/price/parse.ts";

let passed = 0;
let failed = 0;

function ok(name: string, detail = ""): void {
  passed += 1;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail: string): void {
  failed += 1;
  console.log(`  ✗ ${name} — ${detail}`);
}

/** Текст прайса. Один и тот же для всех кодировок. */
const TEXT =
  "Код,Наименование,Цена,Ед\n" +
  "p001,Воздуховод спирально-навивной 315,846,м.п.\n" +
  "p002,Тройник круглый 315/200,983,шт\n" +
  "p003,Ниппель круглый 250,221,шт";

/**
 * Кодирует текст в Windows-1251.
 *
 * Обратной функции в Node нет, поэтому строим карту так: декодируем
 * каждый байт 128..255 как 1251 и запоминаем, какой байт даёт какой
 * символ. Английские буквы и цифры совпадают с ASCII.
 */
function toCp1251(text: string): Uint8Array {
  const map = new Map<string, number>();
  const dec = new TextDecoder("windows-1251");
  for (let b = 128; b < 256; b += 1) {
    const ch = dec.decode(new Uint8Array([b]));
    if (!map.has(ch)) map.set(ch, b);
  }

  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 128) {
      out.push(cp);
    } else {
      const b = map.get(ch);
      if (b === undefined) throw new Error(`Символ «${ch}» не представим в 1251`);
      out.push(b);
    }
  }
  return Uint8Array.from(out);
}

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Проверяет, что прайс разобрался и кириллица читается верно. */
function checkParsed(label: string, buf: ArrayBuffer): void {
  const r = parsePriceWorkbook(buf);

  if (!r.ok) {
    fail(`${label}: разбор`, r.error);
    return;
  }
  ok(`${label}: разбор`, `позиций ${r.items.length}`);

  const first = r.items[0];
  if (!first) {
    fail(`${label}: первая позиция`, "список пуст");
    return;
  }

  /**
   * Главная проверка: текст не «побился». Мусор выглядит как Ð...
   *
   * Сравниваем по вхождению, а не по равенству: `rawName` включает
   * единицу измерения («… 315, м.п.»), и точное совпадение здесь зависело
   * бы от того, как разбор склеил название с единицей — а это к
   * кодировке отношения не имеет.
   */
  const expected = "Воздуховод спирально-навивной 315";
  if (first.rawName.startsWith(expected) && !first.rawName.includes("Ð")) {
    ok(`${label}: кириллица целая`, first.rawName);
  } else {
    fail(`${label}: кириллица целая`, `получили «${first.rawName}»`);
  }

  if (first.price === 846) ok(`${label}: цена разобрана`, "846");
  else fail(`${label}: цена разобрана`, `получили ${first.price}`);
}

console.log("Проверка кодировок CSV\n");

// ── 1. UTF-8 без BOM ──────────────────────────────────────
console.log("=== UTF-8 без BOM ===");
{
  const buf = asBuffer(new TextEncoder().encode(TEXT));
  checkParsed("UTF-8", buf);

  const decoded = decodeCsv(buf);
  if (decoded.startsWith("Код,Наименование")) ok("decodeCsv вернул текст как есть");
  else fail("decodeCsv вернул текст как есть", decoded.slice(0, 40));
}

// ── 2. UTF-8 с BOM ────────────────────────────────────────
console.log("\n=== UTF-8 с BOM ===");
{
  const body = new TextEncoder().encode(TEXT);
  const withBom = new Uint8Array(body.length + 3);
  withBom.set([0xef, 0xbb, 0xbf], 0);
  withBom.set(body, 3);

  checkParsed("UTF-8 BOM", asBuffer(withBom));

  /**
   * BOM не должен попасть в первый заголовок: иначе колонка называлась бы
   * «\uFEFFКод» и не совпала бы ни с одним кандидатом.
   */
  const decoded = decodeCsv(asBuffer(withBom));
  if (decoded.charCodeAt(0) === 0xfeff) fail("BOM срезан", "остался в тексте");
  else ok("BOM срезан");
}

// ── 3. Windows-1251 ───────────────────────────────────────
console.log("\n=== Windows-1251 ===");
{
  const buf = asBuffer(toCp1251(TEXT));
  checkParsed("Windows-1251", buf);
}

// ── 4. XLSX не должен ломаться ────────────────────────────
//
// Проверяем, что новая ветка «похоже на CSV» не захватывает zip-архив:
// xlsx это zip, и если бы мы декодировали его как текст, разбор падал бы
// на любом настоящем Excel-файле.
console.log("\n=== XLSX не перепутан с CSV ===");
{
  // Минимальная zip-сигнатура: именно её проверяет looksLikeCsv
  const fakeZip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  const r = parsePriceWorkbook(asBuffer(fakeZip));
  // Ожидаем ошибку чтения таблицы, а НЕ «не нашёл колонки»: значит, файл
  // ушёл в бинарную ветку, а не в текстовую.
  if (!r.ok && r.error.includes("Не удалось прочитать")) {
    ok("zip-файл идёт в бинарную ветку");
  } else if (!r.ok) {
    fail("zip-файл идёт в бинарную ветку", `получили: ${r.error}`);
  } else {
    fail("zip-файл идёт в бинарную ветку", "файл неожиданно разобрался");
  }
}

// ── 5. Пустой файл ────────────────────────────────────────
console.log("\n=== Крайние случаи ===");
{
  const r = parsePriceWorkbook(asBuffer(new Uint8Array(0)));
  if (!r.ok) ok("пустой файл → понятная ошибка", r.error);
  else fail("пустой файл → понятная ошибка", "файл разобрался");
}

console.log(`\n═══ Итог: ${passed} из ${passed + failed} проверок пройдено ═══`);
process.exit(failed === 0 ? 0 : 1);
