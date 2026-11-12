/**
 * Проверка сквозного цикла: создать КП → отдать в автоматизацию.
 *
 * Запуск: node --env-file=.env.local scripts/test-automation-flow.ts
 *
 * Что проверяем:
 *  1. Смета сохраняется в базу и появляется в /api/proposals/recent.
 *  2. Повторный запрос ту же смету НЕ возвращает (отметка notified_at).
 *  3. С ?include=all она видна снова — для отладки.
 */
import { saveSession } from "../src/db/repositories/sessions.ts";
import type { EstimateSession } from "../src/entities/estimate/model/types.ts";

const BASE = "http://localhost:3000";
const KEY = process.env.AUTOMATION_API_KEY ?? "";

/** Смета из трёх позиций: две с ценой, одна без, одна не по теме. */
function demoSession(): EstimateSession {
  const positions: EstimateSession["positions"] = [
    {
      posNo: 1,
      lineNo: 1,
      name: "Воздуховод круглый 315",
      qty: 10,
      unit: "м",
      status: "priced",
      unitPrice: 1240,
      total: 12400,
      matchedName: "Воздуховод круглый d=315",
      source: "deterministic",
      confidence: 0.95,
    },
    {
      posNo: 2,
      lineNo: 2,
      name: "Тройник 315х200",
      qty: 3,
      unit: "шт",
      status: "priced",
      unitPrice: 2870,
      total: 8610,
      matchedName: "Тройник 315x200",
      source: "deterministic",
      confidence: 0.9,
    },
    {
      posNo: 3,
      lineNo: 3,
      name: "Хомут для воздуховода 315",
      qty: 5,
      unit: "шт",
      status: "not_found",
      reason: "нет в прайсе",
    },
  ];

  return {
    name: "тест-автоматизации.xlsx",
    loadedAt: new Date().toISOString(),
    positions,
    stats: {
      total: positions.length,
      priced: 2,
      notFound: 1,
      needsHuman: 0,
      offTopic: 0,
      totalSum: 21010,
      attention: 1,
    },
  };
}

async function callRecent(query = ""): Promise<{ count: number; proposals: Array<{ id: string; name: string; totalSum: number }> }> {
  const res = await fetch(`${BASE}/api/proposals/recent${query}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as { count: number; proposals: Array<{ id: string; name: string; totalSum: number }> };
}

async function main() {
  if (!KEY) throw new Error("AUTOMATION_API_KEY не задан");

  const id = crypto.randomUUID();
  console.log(`Создаю смету ${id.slice(0, 8)}…`);
  await saveSession(id, demoSession());
  console.log("  сохранена в базу\n");

  console.log("1. Первый запрос (ждём 1 смету)");
  const first = await callRecent();
  console.log(`   count=${first.count}`);
  for (const p of first.proposals) console.log(`     ${p.id.slice(0, 8)}… ${p.name} — ${p.totalSum} ₽`);

  if (first.count !== 1) {
    console.log("   ПРОВАЛ: ожидалась 1 смета");
  }

  console.log("\n2. Второй запрос подряд (ждём 0 — уже отдана)");
  const second = await callRecent();
  console.log(`   count=${second.count}`);
  if (second.count !== 0) {
    console.log("   ПРОВАЛ: смета отдана повторно — будут дубли напоминаний");
  } else {
    console.log("   Отметка notified_at работает — дублей не будет");
  }

  console.log("\n3. С ?include=all (ждём её же)");
  const all = await callRecent("?include=all&limit=10");
  const found = all.proposals.some((p) => p.id === id);
  console.log(`   count=${all.count}, наша смета ${found ? "видна" : "НЕ видна"}`);

  console.log("\n4. Скачивание КП по ссылке");
  const res = await fetch(`${BASE}/api/proposal/${id}`);
  const buf = await res.arrayBuffer();
  console.log(`   статус ${res.status}, размер ${buf.byteLength} байт, ZIP-подпись: ${new Uint8Array(buf)[0] === 0x50 ? "есть" : "НЕТ"}`);

  console.log(`\nID для проверки в базе: ${id}`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
