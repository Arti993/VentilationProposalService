/**
 * Проверка парсеров Excel и Word на файлах с ловушками.
 *
 * Запуск: node scripts/test-binary-parse.ts
 *
 * Что проверяем и почему именно это:
 *
 *  1. Шапка не в первой строке — в реальных сметах сверху реквизиты.
 *  2. Несколько листов, «Титул» первым — титул не должен попасть в позиции.
 *  3. Наименование не в первой колонке — слева номер позиции.
 *  4. Количество строкой «10 м.п.» и отдельным числом.
 *  5. Строка «Итого» не становится позицией.
 *  6. Word-таблица разбирается тем же текстовым парсером.
 */
import { readFileSync } from "node:fs";
import { parseExcel, parseWord } from "../src/lib/estimate/binary.ts";
import { parseEstimateText } from "../src/lib/estimate/parse.ts";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ок  " : "ПРОВАЛ"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function testExcel() {
  console.log("\n=== Excel: smeta-polnyi.xlsx ===");
  const buf = readFileSync("data/test-estimates/smeta-polnyi.xlsx");
  const rows = await parseExcel(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );

  console.log(`Найдено позиций: ${rows.length}, листов задействовано: ${
    [...new Set(rows.map((r) => r.sheetName))].join(", ")
  }`);

  for (const r of rows) {
    console.log(
      `  [${r.sheetName}] ${r.name} — ${r.qty}${r.unit ? " " + r.unit : ""}` +
        (r.lineNo ? ` (стр. ${r.lineNo})` : ""),
    );
  }

  console.log("\nПроверки:");

  // Лист «Смета»: шапка в 5-й строке, мусор сверху отброшен
  const fromSheet = rows.filter((r) => r.sheetName === "Смета");
  check("лист «Смета» разобран", fromSheet.length === 5, `позиций ${fromSheet.length}`);

  const duct = fromSheet.find((r) => /воздуховод/i.test(r.name));
  check(
    "шапка не в первой строке: реквизиты не стали позициями",
    Boolean(duct) && !fromSheet.some((r) => /объект|дата|смета на поставку/i.test(r.name)),
  );
  check(
    "количество и единица из отдельных колонок",
    duct?.qty === 48 && duct?.unit === "мп",
    duct ? `${duct.qty} «${duct.unit}»` : "не найдено",
  );

  // «Итого» не должно стать позицией
  check(
    "строка «Итого» отброшена",
    !rows.some((r) => /^итого/i.test(r.name)),
  );

  // Лист «Титул» — ни одной позиции
  check(
    "титульный лист не дал позиций",
    !rows.some((r) => r.sheetName === "Титул"),
  );

  // Лист без шапки: количество склеено с единицей
  const noHeader = rows.filter((r) => r.sheetName === "Без шапки");
  check("лист без шапки разобран", noHeader.length >= 3, `позиций ${noHeader.length}`);
  const spiral = noHeader.find((r) => /спирально/i.test(r.name));
  check(
    "количество из строки «10 м.п.»",
    spiral?.qty === 10,
    spiral ? `${spiral.qty}` : "не найдено",
  );

  // Лист со сдвинутыми колонками
  const shifted = rows.filter((r) => r.sheetName === "Сдвиг");
  check("лист со сдвинутыми колонками разобран", shifted.length === 3, `позиций ${shifted.length}`);
  const diffuser = shifted.find((r) => /диффузор/i.test(r.name));
  check(
    "наименование не в первой колонке",
    diffuser?.qty === 6,
    diffuser ? `${diffuser.name} — ${diffuser.qty}` : "не найдено",
  );

  // Номер позиции не попал в название
  check(
    "номер позиции снят с названия",
    !shifted.some((r) => /^\d/.test(r.name)),
  );
}

async function testWord() {
  console.log("\n=== Word: smeta.docx ===");
  const buf = readFileSync("data/test-estimates/smeta.docx");
  const text = await parseWord(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  console.log(`Извлечено строк: ${lines.length}`);
  for (const l of lines.slice(0, 8)) console.log(`  «${l.trim()}»`);

  const rows = parseEstimateText(text);
  console.log(`\nПозиций после текстового парсера: ${rows.length}`);
  for (const r of rows) console.log(`  ${r.name} — ${r.qty}${r.unit ? " " + r.unit : ""}`);

  console.log("\nПроверки:");
  check("таблица из Word разобрана", rows.length >= 4, `позиций ${rows.length}`);

  const duct = rows.find((r) => /воздуховод/i.test(r.name));
  check("количество найдено", duct?.qty === 48, duct ? `${duct.qty}` : "не найдено");
  check(
    "заголовки и «Итого» не стали позициями",
    !rows.some((r) => /^(наименование|итого)/i.test(r.name)),
  );
}

async function main() {
  await testExcel();
  await testWord();
  console.log(`\n${failures === 0 ? "Все проверки пройдены." : `Провалов: ${failures}`}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
