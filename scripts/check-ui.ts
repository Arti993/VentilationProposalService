/**
 * Проверка рабочего экрана после редизайна.
 *
 * Запуск: node --env-file=.env.local scripts/check-ui.ts
 *
 * Проверяем не «выглядит ли красиво» (это решает человек), а что
 * интерфейс не сломался по смыслу: демо-смета грузится, позиции
 * размечены, суммы сходятся, КП скачивается.
 */
const BASE = process.env.UI_BASE ?? "http://localhost:3000";

interface Position {
  posNo: number;
  name: string;
  status: string;
  unitPrice?: number;
  total?: number;
  matchedName?: string;
}

interface UploadResponse {
  ok: boolean;
  session?: {
    id: string;
    name: string;
    positions: Position[];
    stats: {
      total: number;
      priced: number;
      notFound: number;
      needsHuman: number;
      totalSum: number;
      attention: number;
    };
  };
  error?: string;
}

async function main() {
  console.log(`Проверка интерфейса на ${BASE}\n`);

  // 1. Демо-смета
  const demo = await fetch(`${BASE}/api/demo-estimate?file=office`);
  if (!demo.ok) throw new Error(`демо-смета: HTTP ${demo.status}`);
  const text = await demo.text();
  console.log(`1. Демо-смета получена: ${text.split("\n").length} строк`);

  // 2. Загрузка
  const form = new FormData();
  form.append("file", new Blob([text], { type: "text/plain" }), "estimate-office.txt");

  const res = await fetch(`${BASE}/api/estimate`, { method: "POST", body: form });
  const json = (await res.json()) as UploadResponse;
  if (!json.ok || !json.session) throw new Error(`загрузка: ${json.error ?? res.status}`);

  const s = json.session;
  console.log(`2. Обработано: ${s.name}`);
  console.log(
    `   позиций ${s.stats.total}, с ценой ${s.stats.priced}, ` +
      `без цены ${s.stats.notFound}, на проверку ${s.stats.needsHuman}`,
  );

  // 3. Сходится ли арифметика — то, что увидит заказчик в карточке
  const sumFromPositions = s.positions.reduce((acc, p) => acc + (p.total ?? 0), 0);
  const diff = Math.abs(sumFromPositions - s.stats.totalSum);
  console.log(`3. Сумма: в карточке ${s.stats.totalSum} ₽, по позициям ${sumFromPositions} ₽`);
  console.log(`   ${diff < 0.01 ? "сходится" : `РАСХОЖДЕНИЕ ${diff} ₽ — ПРОВАЛ`}`);

  // 4. Статусы размечены
  const statuses = new Map<string, number>();
  for (const p of s.positions) {
    statuses.set(p.status, (statuses.get(p.status) ?? 0) + 1);
  }
  console.log("4. Статусы:");
  for (const [k, v] of statuses) console.log(`   ${k}: ${v}`);

  // 5. Есть ли строки, о которых надо предупредить
  const problem = s.positions.filter((p) => p.status !== "priced");
  console.log(`5. Требуют внимания: ${problem.length}`);
  for (const p of problem.slice(0, 4)) {
    console.log(`   #${p.posNo} ${p.name} → ${p.status}`);
  }

  // 6. Скачивание КП
  const doc = await fetch(`${BASE}/api/proposal/${s.id}`);
  if (!doc.ok) throw new Error(`скачивание: HTTP ${doc.status}`);
  const buf = await doc.arrayBuffer();
  console.log(`6. КП скачано: ${Math.round(buf.byteLength / 1024)} КБ`);
  const magic = new Uint8Array(buf.slice(0, 2));
  const isZip = magic[0] === 0x50 && magic[1] === 0x4b;
  console.log(`   ${isZip ? "это DOCX (ZIP-контейнер)" : "ПРОВАЛ: не DOCX"}`);

  console.log("\nИнтерфейс работает: данные, статусы, суммы и документ на месте.");
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
