import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PriceItem } from "../src/lib/price/normalize.ts";
import { matchLine, parseEstimateLine } from "../src/lib/matcher/match.ts";
import { ALL_ESTIMATES } from "../src/lib/matcher/fixtures.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const price = JSON.parse(
  fs.readFileSync(path.join(root, "data", "price.normalized.json"), "utf8"),
) as PriceItem[];

let total = 0;
let correct = 0;
const misses: string[] = [];

for (const [estimateName, cases] of Object.entries(ALL_ESTIMATES)) {
  console.log(`\n===== ${estimateName} =====`);
  for (const c of cases) {
    total++;
    const parsed = parseEstimateLine(c.line);
    const res = matchLine(c.line, price);
    const got =
      res.status === "matched" && c.expectedPrice !== undefined
        ? res.item?.price === c.expectedPrice
          ? "ok"
          : `цена ${res.item?.price} != ${c.expectedPrice}`
        : res.status === c.expected ? "ok" : `status ${res.status} != ${c.expected}`;

    const ok = got === "ok";
    if (ok) correct++;
    else misses.push(`${estimateName}: "${c.line}" -> ${got}; ${c.why}`);

    console.log(
      `${ok ? "OK " : "BAD"} [${res.status}] "${c.line}"` +
        (res.item ? ` = ${res.item.price}₽ (${res.item.rawName})` : "") +
        (res.note ? `  // ${res.note}` : ""),
    );
  }
}

console.log(`\n=== ИТОГ: ${correct}/${total} (${Math.round((correct / total) * 100)}%) ===`);
if (misses.length) {
  console.log("\nПРОМАХИ:");
  for (const m of misses) console.log(" -", m);
}
