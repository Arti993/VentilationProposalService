/**
 * Проверка генерации КП: собирает документ и разбирает его обратно.
 *
 * Запуск: node --env-file=.env.local scripts/test-docx.ts
 *
 * Проверяем не «файл создался», а содержимое: позиции с ценой попали,
 * статусы и внутренние причины НЕ попали, итог совпадает с сессией.
 */
import fs from "node:fs";
import path from "node:path";
import { buildProposalDocx } from "../src/lib/proposal/docx.ts";
import type { EstimateSession } from "../src/entities/estimate/model/types.ts";

const session: EstimateSession = {
  name: "estimate-office.txt",
  loadedAt: new Date().toISOString(),
  stats: {
    total: 5,
    priced: 3,
    notFound: 1,
    needsHuman: 1,
    offTopic: 0,
    totalSum: 48_684,
    attention: 2,
  },
  positions: [
    {
      posNo: 1,
      lineNo: 6,
      name: "Воздуховод спирально-навивной d=315",
      qty: 48,
      unit: "м.п.",
      status: "priced",
      unitPrice: 846,
      total: 40_608,
      matchedName: "Воздуховод спирально-навивной 315",
      reason: "Точное совпадение типа и размеров",
      source: "deterministic",
      confidence: 1,
    },
    {
      posNo: 2,
      lineNo: 7,
      name: "Тройник вентиляционный круглый 315/200",
      qty: 2,
      unit: "шт",
      status: "priced",
      unitPrice: 983,
      total: 1_966,
      matchedName: "Тройник вентиляционный круглый  315/200",
      reason: "Точное совпадение",
      source: "deterministic",
      confidence: 1,
    },
    {
      posNo: 3,
      lineNo: 8,
      name: "Заглушка воздуховода торцевая (круглая) 315",
      qty: 6,
      unit: "шт",
      status: "priced",
      unitPrice: 495,
      total: 2_970,
      matchedName: "Заглушка воздуховода торцевая (круглая) 315",
      reason: "Точное совпадение",
      source: "deterministic",
      confidence: 1,
    },
    {
      posNo: 4,
      lineNo: 12,
      name: "Отвод сегментный 90 градусов 450",
      qty: 3,
      unit: "шт",
      status: "not_found",
      reason: "В прайсе нет отводов сегментных 450 90°",
      source: "llm",
      confidence: 0.9,
    },
    {
      posNo: 5,
      lineNo: 15,
      name: "Хомут крепежный d315",
      qty: 40,
      unit: "шт",
      status: "needs_human",
      reason: "Крепёжное изделие, в списке кандидатов хомутов нет",
      source: "llm",
      confidence: 0.4,
    },
  ],
};

async function main() {
  console.log("Генерирую документ…");
  const buffer = await buildProposalDocx({ session });

  const out = path.join(process.cwd(), "kp-test.docx");
  fs.writeFileSync(out, buffer);
  console.log(`Файл: ${out}`);
  console.log(`Размер: ${Math.round(buffer.length / 1024)} КБ`);

  // Проверяем, что это валидный docx: ZIP с нужными частями
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  console.log(`ZIP-сигнатура: ${isZip ? "OK" : "НЕТ"}`);

  // Читаем ZIP прямо из буфера: без внешних процессов и временных файлов.
  // DOCX — это ZIP, а fflate уже установлен как зависимость docx.
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(buffer));
  console.log("Части архива:", Object.keys(files).join(", "));

  const docXml = strFromU8(files["word/document.xml"]!);
  console.log(`document.xml: ${Math.round(docXml.length / 1024)} КБ`);

  // Текст без тегов: в XML слова могут быть разбиты на runs
  const plain = docXml.replace(/<[^>]+>/g, "");

  // Что должно быть в документе
  const mustContain = [
    "КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ",
    "Воздуховод спирально-навивной 315",
    "Тройник вентиляционный круглый",
    "Заглушка воздуховода торцевая",
    "48 684",
    "Условия сотрудничества",
    "Позиции, требующие уточнения",
    "Хомут крепежный",
  ];

  // Чего быть НЕ должно: внутренняя кухня не должна утечь клиенту
  const mustNotContain = [
    "not_found",
    "needs_human",
    "off_topic",
    "priced",
    "deterministic",
    "confidence",
    "LLM",
    "Уверенность",
  ];

  console.log("\nОБЯЗАТЕЛЬНО:");
  let failed = 0;
  for (const s of mustContain) {
    const found = plain.replace(/\s+/g, " ").includes(s.replace(/\s+/g, " "));
    console.log(`  ${found ? "✓" : "✗"} ${s}`);
    if (!found) failed++;
  }

  console.log("\nНЕ ДОЛЖНО БЫТЬ:");
  for (const s of mustNotContain) {
    const found = plain.includes(s);
    console.log(`  ${found ? "✗ ЕСТЬ!" : "✓"} ${s}`);
    if (found) failed++;
  }

  const rows = (docXml.match(/<w:tr[ >]/g) ?? []).length;
  console.log(`\nСтрок таблиц в документе: ${rows}`);

  if (failed) {
    console.error(`\nПРОВАЛ: ${failed} проверок не прошло`);
    process.exitCode = 1;
  } else {
    console.log("\nOK: документ содержит нужное и не содержит лишнего");
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
