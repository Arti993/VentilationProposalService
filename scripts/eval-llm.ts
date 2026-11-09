import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PriceItem } from "../src/lib/price/normalize.ts";
import { processLine } from "../src/lib/matcher/hybrid.ts";
import { ALL_ESTIMATES } from "../src/lib/matcher/fixtures.ts";
import { balance } from "../src/lib/llm/client.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const price = JSON.parse(
  fs.readFileSync(path.join(root, "data", "price.normalized.json"), "utf8"),
) as PriceItem[];

const USE_LLM = process.env.WITH_LLM !== "0";

let total = 0;
let correct = 0;
let llmCalls = 0;
let llmTime = 0;
const misses: string[] = [];

const balBefore = USE_LLM ? await balance().catch(() => null) : null;

for (const [name, cases] of Object.entries(ALL_ESTIMATES)) {
  console.log(`\n===== ${name} =====`);
  for (const c of cases) {
    total++;
    const t0 = Date.now();
    const res = await processLine(c.line, price, { useLlm: USE_LLM });
    const dt = Date.now() - t0;
    if (res.source === "llm") {
      llmCalls++;
      llmTime += dt;
    }

    // Ожидание матчится со статусом: matched/ambiguous -> priced (LLM мог решить),
    // needs_llm -> либо priced (LLM справился), либо needs_human.
    let ok: boolean;
    if (c.expected === "matched") {
      ok = res.status === "priced" && res.unitPrice === c.expectedPrice;
    } else if (c.expected === "not_found") {
      ok = res.status === "not_found";
    } else {
      // ambiguous / needs_llm: допускаем needs_human ИЛИ priced, если LLM уверен
      ok =
        res.status === "needs_human" ||
        (res.status === "priced" && res.confidence >= 0.85);
    }

    if (ok) correct++;
    else misses.push(`${name}: "${c.line}" -> ${res.status} ${res.unitPrice ?? ""} | ${c.why}`);

    const priceStr = res.unitPrice ? ` ${res.unitPrice}₽` : "";
    console.log(
      `${ok ? "OK " : "BAD"} [${res.status}${priceStr}] ${res.source.padEnd(13)} "${c.line}"` +
        (res.reason ? `\n      ↳ ${res.reason.replace(/\n/g, " ").slice(0, 110)}` : ""),
    );
  }
}

const balAfter = USE_LLM ? await balance().catch(() => null) : null;

console.log(`\n=== ИТОГ: ${correct}/${total} (${Math.round((correct / total) * 100)}%) ===`);
console.log(`LLM-вызовов: ${llmCalls}, среднее время: ${llmCalls ? Math.round(llmTime / llmCalls) : 0} мс`);

if (balBefore && balAfter) {
  console.log(
    `Расход баланса: ${(balBefore.available - balAfter.available).toFixed(4)} ₽ ` +
      `(${balBefore.available} -> ${balAfter.available})`,
  );
}

if (misses.length) {
  console.log("\nПРОМАХИ:");
  for (const m of misses) console.log(" -", m);
}
