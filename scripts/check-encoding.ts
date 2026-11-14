/**
 * Поиск испорченной кодировки в исходниках.
 *
 * Признак: UTF-8, прочитанный как cp1251 и снова записанный как UTF-8,
 * даёт характерные пары вида «Рџ», «Рѕ», «в”Ђ». Ищем именно их, а не
 * просто «не кириллицу»: так не бывает ложных срабатываний на латинице
 * и цифрах.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["src", "scripts", "docs", "data"];

const MOJIBAKE = [
  "Рџ", "Рѕ", "Рµ", "Р°", "Рё", "С‚", "СЂ", "СЃ", "РІ", "РЅ",
  "в”Ђ", "в”", "РѕР", "СЊ", "С‹", "Р¶",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (e === "node_modules" || e === ".next") continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx|css|json|md)$/.test(e) && !p.includes(".next")) {
      out.push(p);
    }
  }
  return out;
}

const files = ROOTS.flatMap(walk).filter((f) => !f.endsWith("check-encoding.ts"));
let bad = 0;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const hits: string[] = [];

  for (const pat of MOJIBAKE) {
    if (text.includes(pat)) {
      const idx = text.indexOf(pat);
      const line = text.slice(0, idx).split("\n").length;
      const frag = text.slice(Math.max(0, idx - 30), idx + 30).replace(/\n/g, "⏎");
      hits.push(`строка ${line}: …${frag}…`);
    }
  }

  if (hits.length > 0) {
    bad += 1;
    console.log(`\n✗ ${relative(process.cwd(), file)}`);
    for (const h of hits.slice(0, 3)) console.log(`    ${h}`);
  }
}

console.log(
  bad === 0
    ? `\n✓ Проверено ${files.length} файлов — испорченной кодировки нет`
    : `\n✗ Найдено ${bad} файлов с испорченной кодировкой из ${files.length}`,
);

if (bad > 0) process.exit(1);
