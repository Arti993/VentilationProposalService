/**
 * Замеряет вертикальный размер блоков документа, рендеря их по одному.
 *
 * Зачем: LibreOffice не показывает, какой именно блок распирает страницу.
 * Собираем документ из частей и смотрим итоговую высоту.
 *
 * Запуск: node --env-file=.env.local scripts/measure-blocks.ts
 */
import fs from "node:fs";
import { getSession } from "../src/db/repositories/sessions.ts";
import { buildProposalDocx } from "../src/lib/proposal/docx.ts";

const sessionId = fs.readFileSync(".session-test-id", "utf8").trim();

async function main() {
  const full = await getSession(sessionId);
  if (!full) throw new Error("сессия не найдена");

  // Вариант без позиций без цены: проверяем, влияет ли блок «уточнения»
  const noPending = {
    ...full,
    positions: full.positions.filter((p) => p.status === "priced"),
  };

  // Вариант с укороченными условиями
  const cases: Array<[string, typeof full]> = [
    ["полный документ", full],
    ["без уточняемых позиций", noPending],
  ];

  for (const [label, s] of cases) {
    const buf = await buildProposalDocx({ session: s });
    const name = `measure-${label.replace(/\s+/g, "-")}.docx`;
    fs.writeFileSync(name, buf);
    const { unzipSync, strFromU8 } = await import("fflate");
    const files = unzipSync(new Uint8Array(buf));
    const xml = strFromU8(files["word/document.xml"]!);
    const textLen = xml.replace(/<[^>]+>/g, "").length;
    console.log(`${label.padEnd(26)} ${Math.round(buf.length / 1024)} КБ, ${name}, символов: ${textLen}`);
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
