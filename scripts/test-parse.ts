import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEstimateText } from "../src/lib/estimate/parse.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

for (const f of ["estimate-office.txt", "estimate-warehouse.csv"]) {
  const text = fs.readFileSync(path.join(root, "examples", f), "utf8");
  const rows = parseEstimateText(text);
  console.log(`\n=== ${f} : ${rows.length} позиций ===`);
  for (const r of rows) {
    console.log(
      `  [${String(r.qty).padStart(4)} ${(r.unit ?? "—").padEnd(5)}] ${r.name}`,
    );
  }
}
