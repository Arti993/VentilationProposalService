/**
 * Сквозная проверка загрузки Excel и Word через настоящий API.
 *
 * Запуск: node --env-file=.env.local scripts/test-formats-e2e.ts
 *
 * Проверяем не парсер, а весь путь: HTTP → проверка сигнатуры →
 * разбор → сопоставление с прайсом → сохранение сессии → скачивание КП.
 *
 * Отдельно проверяем ОТКАЗ в неверных случаях. Мягкая обработка
 * неправильного файла опаснее ошибки: менеджер получит КП с пустыми
 * ценами и не поймёт, что файл не тот.
 */
import { readFileSync } from "node:fs";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ок  " : "ПРОВАЛ"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

interface UploadResult {
  ok: boolean;
  error?: string;
  session?: {
    id: string;
    name: string;
    positions: Array<{ posNo: number; name: string; qty: number; status: string; total?: number }>;
    stats: { total: number; priced: number; notFound: number; needsHuman: number; totalSum: number };
  };
}

async function upload(name: string, bytes: Uint8Array, type = "application/octet-stream") {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), name);

  const res = await fetch(`${BASE}/api/estimate`, { method: "POST", body: form });
  const json = (await res.json()) as UploadResult;
  return { status: res.status, json };
}

async function testExcel() {
  console.log("\n=== Excel через API ===");
  const buf = new Uint8Array(readFileSync("data/test-estimates/smeta-polnyi.xlsx"));

  const { status, json } = await upload("smeta.xlsx", buf);
  check("принят", status === 200 && json.ok, `HTTP ${status}${json.error ? ": " + json.error : ""}`);
  if (!json.session) return;

  const s = json.session;
  console.log(
    `  позиций ${s.stats.total}, с ценой ${s.stats.priced}, ` +
      `без цены ${s.stats.notFound}, на проверку ${s.stats.needsHuman}, ` +
      `сумма ${s.stats.totalSum} ₽`,
  );

  check("позиции найдены", s.stats.total >= 10, `${s.stats.total} шт`);
  check(
    "количества сохранились (не все единицы)",
    s.positions.some((p) => p.qty !== 1),
    s.positions
      .slice(0, 3)
      .map((p) => `${p.qty}`)
      .join(", "),
  );
  check(
    "названия без номеров позиций",
    !s.positions.some((p) => /^\d+\s*[.)]/.test(p.name)),
  );

  // КП скачивается
  const doc = await fetch(`${BASE}/api/proposal/${s.id}`);
  check("КП скачалось", doc.ok, `HTTP ${doc.status}`);
  if (doc.ok) {
    const b = new Uint8Array(await doc.arrayBuffer());
    check("это DOCX", b[0] === 0x50 && b[1] === 0x4b, `${Math.round(b.length / 1024)} КБ`);
  }
}

async function testWord() {
  console.log("\n=== Word через API ===");
  const buf = new Uint8Array(readFileSync("data/test-estimates/smeta.docx"));

  const { status, json } = await upload("smeta.docx", buf);
  check("принят", status === 200 && json.ok, `HTTP ${status}${json.error ? ": " + json.error : ""}`);
  if (!json.session) return;

  const s = json.session;
  console.log(`  позиций ${s.stats.total}, с ценой ${s.stats.priced}, сумма ${s.stats.totalSum} ₽`);
  for (const p of s.positions) {
    console.log(`    ${p.name} — ${p.qty} → ${p.status}`);
  }

  check("позиции найдены", s.stats.total === 5, `${s.stats.total} шт`);

  const duct = s.positions.find((p) => /воздуховод/i.test(p.name));
  check("количество из Word не потерялось", duct?.qty === 48, duct ? `${duct.qty}` : "нет");
}

async function testRejections() {
  console.log("\n=== Отказы (важнее успехов) ===");

  // 1. Excel там, где заявлен текст
  const excelBuf = new Uint8Array(readFileSync("data/test-estimates/smeta-polnyi.xlsx"));
  const asTxt = await upload("smeta.txt", excelBuf);
  check(
    "Excel под видом .txt отклонён",
    asTxt.status === 415,
    `HTTP ${asTxt.status}`,
  );

  // 2. Текст под видом Excel
  const fake = new TextEncoder().encode("Это просто текст, а не Excel");
  const asXlsx = await upload("smeta.xlsx", fake);
  check("текст под видом .xlsx отклонён", asXlsx.status === 415, `HTTP ${asXlsx.status}`);

  // 3. Неподдерживаемое расширение
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
  const asPdf = await upload("smeta.pdf", pdf);
  check("PDF отклонён", asPdf.status === 415, `HTTP ${asPdf.status}`);

  // 4. Обрезанный xlsx — повреждённый архив
  const truncated = excelBuf.slice(0, 400);
  const broken = await upload("broken.xlsx", truncated);
  check(
    "обрезанный xlsx не роняет сервер",
    broken.status >= 400 && broken.status < 600,
    `HTTP ${broken.status}`,
  );

  // 5. Excel без оборудования
  const { utils, write } = await import("xlsx");
  const emptyWb = utils.book_new();
  utils.book_append_sheet(emptyWb, utils.aoa_to_sheet([["Отчёт"], ["Ничего нет"]]), "Лист1");
  const emptyBuf = new Uint8Array(
    write(emptyWb, { type: "buffer", bookType: "xlsx" }) as Buffer,
  );
  const empty = await upload("empty.xlsx", emptyBuf);
  check("Excel без позиций отклонён", empty.status === 422, `HTTP ${empty.status}`);
}

async function main() {
  console.log(`Проверка форматов на ${BASE}`);
  await testExcel();
  await testWord();
  await testRejections();
  console.log(`\n${failures === 0 ? "Все проверки пройдены." : `Провалов: ${failures}`}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
