import fs from "node:fs";
import type { PriceItem } from "../src/lib/price/normalize.ts";
import { makeCalculateTool } from "../src/lib/agent/tools.ts";

const price = JSON.parse(
  fs.readFileSync("data/price.normalized.json", "utf8"),
) as PriceItem[];

const tool = makeCalculateTool({ price, useLlm: false });

const out = await tool.invoke({
  items: [
    { query: "Воздуховод спирально-навивной 315", qty: 48 },
    { query: "Отвод сегментный 90 градусов 315", qty: 12 },
  ],
});

console.log("Результат инструмента с правильными qty:");
console.log(JSON.stringify(JSON.parse(String(out)), null, 1));
