#!/usr/bin/env node
/**
 * CLI-демо: смета клиента -> готовое КП.
 *
 * Запуск:
 *   node --env-file=.env.local scripts/kp.ts examples/estimate-office.txt
 *   node --env-file=.env.local scripts/kp.ts examples/estimate-office.txt --no-llm
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PriceItem } from "../src/lib/price/normalize.ts";
import { processRow } from "../src/lib/matcher/hybrid.ts";
import { parseEstimateText } from "../src/lib/estimate/parse.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// ─── ANSI ───────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

// ─── Аргументы ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const fileArg = args.find((a) => !a.startsWith("--"));
const useLlm = !args.includes("--no-llm");
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;

if (!fileArg) {
  console.log(`${C.bold}Использование:${C.reset}
  node --env-file=.env.local scripts/kp.ts <файл-сметы> [--no-llm] [--out результат.csv]

${C.dim}Примеры:${C.reset}
  scripts/kp.ts examples/estimate-office.txt
  scripts/kp.ts examples/estimate-warehouse.csv --out kp.csv`);
  process.exit(1);
}

const inputPath = path.resolve(process.cwd(), fileArg);
if (!fs.existsSync(inputPath)) {
  console.error(`${C.red}Файл не найден: ${inputPath}${C.reset}`);
  process.exit(1);
}

// ─── Прайс ──────────────────────────────────────────────────────────────
const price = JSON.parse(
  fs.readFileSync(path.join(root, "data", "price.normalized.json"), "utf8"),
) as PriceItem[];

// ─── Табличный вывод ────────────────────────────────────────────────────
/**
 * Обрезка по видимой ширине. ANSI-коды не считаются, но в заголовке таблицы
 * их нет — поэтому простая длина подходит для обычных строк.
 */
function cut(s: string, w: number): string {
  if (s.length <= w) return s;
  return s.slice(0, Math.max(0, w - 1)) + "…";
}

/**
 * Паддинг с учётом ANSI-кодов: они занимают 0 видимых символов.
 * Без этого цветные ячейки разъезжаются и текст обрезается.
 */
function pad(s: string, w: number, align: "left" | "right" = "left"): string {
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "").length;
  if (visible > w) {
    // Обрезаем только «чистую» часть, сохраняя цвет
    const plain = s.replace(/\x1b\[[0-9;]*m/g, "");
    const codes = s.match(/\x1b\[[0-9;]*m/g)?.join("") ?? "";
    return codes + cut(plain, w);
  }
  const space = " ".repeat(w - visible);
  return align === "right" ? space + s : s + space;
}

interface Col {
  title: string;
  width: number;
  align?: "left" | "right";
}

function printTable(
  cols: Col[],
  rows: string[][],
  colorize: (cells: string[], rowIndex: number) => string[],
): void {
  const line = (ch: string, join: string) =>
    cols.map((c) => ch.repeat(c.width + 2)).join(join);

  console.log(C.gray + line("─", "┼") + C.reset);
  console.log(
    C.bold +
      "│ " +
      cols.map((c) => pad(c.title, c.width)).join(" │ ") +
      " │" +
      C.reset,
  );
  console.log(C.gray + line("─", "┼") + C.reset);

  rows.forEach((r, i) => {
    const cells = colorize(r, i);
    console.log("│ " + cells.map((cell, j) => pad(cell, cols[j].width, cols[j].align)).join(" │ ") + " │");
  });
  console.log(C.gray + line("─", "┴") + C.reset);
}

// ─── Запуск ─────────────────────────────────────────────────────────────
const text = fs.readFileSync(inputPath, "utf8");
const estimateRows = parseEstimateText(text);

console.log(`\n${C.bold}${C.cyan}КП · ${path.basename(inputPath)}${C.reset}`);
console.log(
  C.dim +
    `Позиций в смете: ${estimateRows.length} · режим: ${useLlm ? "гибрид (детерминизм + LLM)" : "только детерминизм"} · прайс: ${price.length} позиций` +
    C.reset,
);

const t0 = Date.now();

const results = [];
for (const row of estimateRows) {
  const res = await processRow(row, price, { useLlm });
  results.push(res);
  const icon =
    res.status === "priced"
      ? `${C.green}✓${C.reset}`
      : res.status === "not_found"
        ? `${C.yellow}—${C.reset}`
        : `${C.red}?${C.reset}`;
  process.stdout.write(`${C.dim}${icon} ${cut(row.name, 60)}${C.reset}\n`);
}
const elapsed = Date.now() - t0;

// ─── Результат ──────────────────────────────────────────────────────────
const cols: Col[] = [
  { title: "№", width: 3, align: "right" },
  { title: "Позиция клиента", width: 44 },
  { title: "Кол-во", width: 7, align: "right" },
  { title: "Ед.", width: 5 },
  { title: "Статус", width: 13 },
  { title: "Цена", width: 13, align: "right" },
  { title: "Сумма", width: 14, align: "right" },
];

const tableRows = results.map((r, i) => [
  String(i + 1),
  r.line,
  String(r.qty),
  r.unit ?? "—",
  statusLabel(r.status),
  r.unitPrice !== undefined ? fmt(r.unitPrice) : "—",
  r.total !== undefined ? fmt(r.total) : "—",
]);

const STATUS_COLOR: Record<string, string> = {
  priced: C.green,
  not_found: C.yellow,
  needs_human: C.red,
  off_topic: C.magenta,
  error: C.red,
};

printTable(cols, tableRows, (cells, i) => {
  const r = results[i];
  const color = STATUS_COLOR[r.status] ?? "";
  return cells.map((cell, j) => {
    if (j === 4) return `${color}${cell}${C.reset}`; // статус
    if (j === 5 || j === 6) return `${C.bold}${cell}${C.reset}`; // цена/сумма
    return cell;
  });
});

// ─── Сводка ─────────────────────────────────────────────────────────────
const priced = results.filter((r) => r.status === "priced");
const notFound = results.filter((r) => r.status === "not_found");
const needsHuman = results.filter((r) => r.status === "needs_human");
const offTopic = results.filter((r) => r.status === "off_topic");
const totalSum = priced.reduce((s, r) => s + (r.total ?? 0), 0);
const llmCalls = results.filter((r) => r.source === "llm").length;

console.log(`\n${C.bold}Итого по КП${C.reset}`);
console.log(`  ${C.green}С ценой:${C.reset}        ${priced.length}`);
console.log(`  ${C.yellow}Нет в прайсе:${C.reset}   ${notFound.length}`);
console.log(`  ${C.red}На проверку:${C.reset}    ${needsHuman.length}`);
if (offTopic.length) console.log(`  ${C.magenta}Не из сметы:${C.reset}    ${offTopic.length}`);
console.log(`  ${C.dim}LLM-вызовов: ${llmCalls} · время: ${(elapsed / 1000).toFixed(1)} с${C.reset}`);
console.log(`\n  ${C.bold}${C.green}СУММА: ${totalSum.toLocaleString("ru-RU")} ₽${C.reset}\n`);

// ─── Требуют внимания ──────────────────────────────────────────────────
const attention = [...notFound, ...needsHuman, ...offTopic];
if (attention.length) {
  console.log(`${C.bold}${C.yellow}Требует внимания:${C.reset}`);
  for (const r of attention) {
    const label = r.status === "not_found" ? "нет в прайсе" : r.status === "off_topic" ? "не из сметы" : "проверить";
    console.log(`  ${C.red}•${C.reset} ${r.line}`);
    console.log(`      ${C.dim}${label}: ${r.reason}${C.reset}`);
  }
  console.log();
}

// ─── Экспорт ────────────────────────────────────────────────────────────
if (outPath) {
  const header = "Наименование;Кол-во;Ед.;Статус;Цена за ед.;Сумма;Комментарий";
  const lines = results.map((r) =>
    [
      csvEscape(r.line),
      String(r.qty),
      r.unit ?? "",
      statusLabel(r.status),
      r.unitPrice !== undefined ? String(r.unitPrice) : "",
      r.total !== undefined ? String(r.total) : "",
      csvEscape(r.reason),
    ].join(";"),
  );
  const csv = "\uFEFF" + [header, ...lines].join("\r\n");
  const dest = path.resolve(process.cwd(), outPath);
  fs.writeFileSync(dest, csv, "utf8");
  console.log(`${C.green}CSV сохранён:${C.reset} ${dest}\n`);
}

// ─── Хелперы ────────────────────────────────────────────────────────────
function statusLabel(s: string): string {
  switch (s) {
    case "priced":
      return "цена есть";
    case "not_found":
      return "нет в прайсе";
    case "needs_human":
      return "проверить";
    case "off_topic":
      return "не из сметы";
    default:
      return "ошибка";
  }
}

function fmt(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function csvEscape(s: string): string {
  if (/[;"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
