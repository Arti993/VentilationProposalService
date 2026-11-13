/**
 * Генерирует тестовые сметы в .xlsx и .docx — с ловушками.
 *
 * Запуск: node scripts/make-test-files.ts
 *
 * Зачем: проверять парсер на файлах, которые сам же и придумал, — плохая
 * идея. Поэтому повторяем то, что реально встречается в сметах:
 *
 *  - шапка не в первой строке (сверху реквизиты проекта);
 *  - несколько листов, причём «Титул» идёт первым;
 *  - наименование не в первой колонке (слева номер, справа цены);
 *  - количество строкой «48 м.п.» и числом в отдельной колонке;
 *  - объединённые ячейки раздела («Раздел 1. Воздуховоды»);
 *  - лист без шапки вообще — просто таблица.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun } from "docx";

const OUT = "data/test-estimates";

/** Лист с шапкой не в первой строке и мусором сверху. */
function sheetWithHeader(): unknown[][] {
  return [
    ["Смета на поставку вентиляционного оборудования"],
    ["Объект: офис на Ленской, 5"],
    ["Дата: 13.11.2026"],
    [],
    ["№", "Наименование", "Кол-во", "Ед. изм.", "Цена за ед.", "Сумма"],
    [1, "Воздуховод круглый d315", 48, "м.п.", 890, 42720],
    [2, "Тройник круглый 315/200", 3, "шт", 2340, 7020],
    [3, "Отвод штампованный 90° d250", 6, "шт", 1120, 6720],
    [4, "Переход 400-315", 2, "шт", 1800, 3600],
    [5, "Хомут для воздуховода d315", 12, "шт", 340, 4080],
    [],
    ["Итого", "", "", "", "", 64140],
  ];
}

/** Лист без шапки: количество приклеено к единице. */
function sheetNoHeader(): unknown[][] {
  return [
    ["Позиция", "Количество"],
    ["1. Воздуховод спирально-навивной d=900", "10 м.п."],
    ["2. Тройник вентиляционный круглый 315/150", "4 шт"],
    ["3. Заглушка торцевая 315", "2 шт"],
    ["4. Отвод сегментный 90 градусов 450", "8 шт"],
  ];
}

/** Лист с номером в первой колонке и наименованием во второй. */
function sheetShiftedColumns(): unknown[][] {
  return [
    ["Поз.", "Оборудование", "Ед.", "Кол.", "Примечание"],
    [1, "Диффузор приточный 4АП 400х400", "шт", 6, "оцинк."],
    [2, "Решётка вытяжная 300х150", "шт", 9, ""],
    [3, "Вентилятор канальный d160", "шт", 2, "3 скорости"],
  ];
}

async function makeExcel() {
  const wb = XLSX.utils.book_new();

  // Первым идёт титул — парсер должен его пропустить и взять остальные
  const title = XLSX.utils.aoa_to_sheet([
    ["Титульный лист"],
    ["Заказчик: ООО «Ромашка»"],
    ["Подрядчик: ООО «Вентиляция»"],
  ]);
  XLSX.utils.book_append_sheet(wb, title, "Титул");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetWithHeader()), "Смета");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetNoHeader()), "Без шапки");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetShiftedColumns()), "Сдвиг");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  writeFileSync(`${OUT}/smeta-polnyi.xlsx`, buf);
  console.log(`Excel: ${(buf.length / 1024).toFixed(0)} КБ, 4 листа`);
}

async function makeWord() {
  const rows = [
    ["№", "Наименование", "Кол-во", "Ед."],
    ["1", "Воздуховод круглый d315", "48", "м.п."],
    ["2", "Тройник круглый 315/200", "3", "шт"],
    ["3", "Отвод штампованный 90° d250", "6", "шт"],
    ["4", "Переход 400-315", "2", "шт"],
    ["5", "Ниппель d315", "10", "шт"],
  ];

  const table = new Table({
    rows: rows.map(
      (r) =>
        new TableRow({
          children: r.map(
            (cell) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun(cell)] })],
              }),
          ),
        }),
    ),
  });

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun("Смета на вентиляцию")] }),
          new Paragraph({ children: [new TextRun("Объект: склад на Парнасе")] }),
          new Paragraph({}),
          table,
          new Paragraph({}),
          new Paragraph({ children: [new TextRun("Итого: 58 490 руб.")] }),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  writeFileSync(`${OUT}/smeta.docx`, buf);
  console.log(`Word: ${(buf.length / 1024).toFixed(0)} КБ, таблица 5 строк`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await makeExcel();
  await makeWord();
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
