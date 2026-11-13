import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalize, type PriceItem, TYPE_LABEL } from "../src/lib/price/normalize.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const dump = JSON.parse(fs.readFileSync(path.join(root, "data", "price.json"), "utf8")) as {
  rows: [string, string][];
};

const items: PriceItem[] = dump.rows
  .filter((r) => r[0] && r[0].trim())
  .map((r, i) => normalize(r[0], Number(r[1].replace(",", ".")), i));

const unparsed = items.filter((i) => i.unparsed);

console.log(`Всего строк: ${items.length}`);
console.log(`Разобрано:   ${items.length - unparsed.length}`);
console.log(`Не разобрано: ${unparsed.length}`);

if (unparsed.length) {
  console.log("\n--- ПРОБЛЕМЫ ---");
  for (const u of unparsed) console.log(`! ${u.rawName}  -->  ${u.unparsed}`);
}

console.log("\n--- РАСПРЕДЕЛЕНИЕ ПО ТИПАМ ---");
const byType = new Map<string, PriceItem[]>();
for (const it of items) {
  const arr = byType.get(it.type) ?? [];
  arr.push(it);
  byType.set(it.type, arr);
}

for (const [type, arr] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const withVariant = arr.filter((a) => a.variant).length;
  console.log(
    `${TYPE_LABEL[type as keyof typeof TYPE_LABEL] ?? type}: ${arr.length}` +
      (withVariant ? ` (с вариантами: ${withVariant})` : ""),
  );
}

fs.writeFileSync(
  path.join(root, "data", "price.normalized.json"),
  JSON.stringify(items, null, 1),
  "utf8",
);
console.log("\nЗаписано: data/price.normalized.json");
