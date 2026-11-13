/**
 * Переставляет ветку fix-docx-pagination после postgres-persistence.
 *
 * Запуск: node scripts/gitflow/reorder.ts
 *
 * ЗАЧЕМ СКРИПТ, А НЕ РУКАМИ
 *
 * Блок в plan.ts — это объект с многострочными шаблонными строками,
 * внутри которых есть markdown, отступы и обратные кавычки. Вырезать и
 * вставлять его вручную через редактор легко с ошибкой: пропустить
 * закрывающую скобку, сбить отступ, зацепить соседний блок.
 *
 * Скрипт работает по границам блоков «  {\n ... \n  },» и не смотрит
 * внутрь — поэтому не может испортить содержимое.
 *
 * Идемпотентен: повторный запуск ничего не меняет.
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "scripts/gitflow/plan.ts";

/** Разбивает файл на блоки веток по отступу. */
function splitBlocks(source: string): { head: string; blocks: string[]; tail: string } {
  const startMarker = "export const PLAN: PlanBranch[] = [";
  const startIdx = source.indexOf(startMarker);
  if (startIdx < 0) throw new Error("не найден массив PLAN");

  // Начало массива — сразу после «[\n»
  const arrayStart = source.indexOf("\n", startIdx) + 1;
  const head = source.slice(0, arrayStart);

  // Конец массива — строка «];» на нулевом отступе
  const endIdx = source.indexOf("\n];", arrayStart);
  if (endIdx < 0) throw new Error("не найден конец массива PLAN");

  const body = source.slice(arrayStart, endIdx + 1);
  const tail = source.slice(endIdx + 1);

  // Блок начинается с «  {» и заканчивается «  },»
  const blocks: string[] = [];
  const lines = body.split("\n");
  let current: string[] = [];

  for (const line of lines) {
    if (line === "  {" && current.length) {
      blocks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));

  return { head, blocks, tail };
}

function slugOf(block: string): string {
  const m = block.match(/slug: "([^"]+)"/);
  return m ? m[1] : "";
}

function main() {
  const source = readFileSync(FILE, "utf8");
  const { head, blocks, tail } = splitBlocks(source);

  const order = blocks.map(slugOf);
  console.log(`Веток в плане: ${blocks.length}`);
  console.log(`Порядок: ${order.join(" → ")}`);

  const fixIdx = order.indexOf("fix-docx-pagination");
  const pgIdx = order.indexOf("postgres-persistence");

  if (fixIdx < 0 || pgIdx < 0) {
    throw new Error("не найдены нужные ветки");
  }

  if (fixIdx === pgIdx + 1) {
    console.log("\nПорядок уже верный, ничего не меняю.");
    return;
  }

  // Вынимаем фикс и ставим сразу после Postgres
  const [fix] = blocks.splice(fixIdx, 1);
  const pgIdxAfter = blocks.map(slugOf).indexOf("postgres-persistence");
  blocks.splice(pgIdxAfter + 1, 0, fix);

  const rebuilt = head + blocks.join("\n") + tail;
  writeFileSync(FILE, rebuilt, "utf8");

  console.log(`\nНовый порядок: ${blocks.map(slugOf).join(" → ")}`);
}

main();
