/**
 * Разбирает DOCX и показывает, что именно попадает на вторую страницу.
 *
 * Запуск: node scripts/inspect-docx.ts kp-pages.docx
 */
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

const file = process.argv[2] ?? "kp-pages.docx";
const files = unzipSync(new Uint8Array(fs.readFileSync(file)));
const xml = strFromU8(files["word/document.xml"]!);

const explicitBreaks = xml.match(/<w:br[^>]*w:type="page"/g)?.length ?? 0;
const cantSplit = xml.match(/<w:cantSplit/g)?.length ?? 0;
// В OOXML флаг заголовочной строки называется w:tblHeader, а не tableHeader
const tableHeader = xml.match(/<w:tblHeader/g)?.length ?? 0;
const trCount = xml.match(/<w:tr[ >]/g)?.length ?? 0;

console.log(`Разрывов страниц:      ${explicitBreaks}`);
console.log(`Строк с cantSplit:     ${cantSplit}`);
console.log(`Строк-шапок (tblHeader): ${tableHeader}`);
console.log(`Всего строк таблиц:    ${trCount}`);

// Собираем текст по абзацам. Регексп на <w:p ...> не ловил абзацы
// без атрибутов, поэтому искали пустоту.
const paragraphs = xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) ?? [];
console.log(`Абзацев:               ${paragraphs.length}`);

const texts = paragraphs.map((p) =>
  (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
    .map((t) => t.replace(/<[^>]+>/g, ""))
    .join(""),
);

console.log("\nПоследние 8 абзацев документа:");
for (const t of texts.slice(-8)) {
  console.log("  •", t || "(пустой)");
}
