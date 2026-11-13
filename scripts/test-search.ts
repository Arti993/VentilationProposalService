/**
 * Проверяет, что векторный поиск находит то, что должен.
 *
 * Запуск: node --env-file=.env.local scripts/test-search.ts
 *
 * Запросы — как пишут клиенты: сокращения, разговорные названия,
 * опечатки. Если RAG не лучше детерминированного матчера, он не нужен.
 */
import { searchPrice } from "../src/lib/rag/search.ts";

interface Case {
  query: string;
  /** Что должно найтись (подстрока названия в прайсе) */
  expect: string;
  note: string;
}

const CASES: Case[] = [
  { query: "воздух спиральный 315", expect: "спирально-навивной 315", note: "разговорное «воздух»" },
  { query: "тройник 315 на 200", expect: "315/200", note: "«на» вместо дроби" },
  { query: "отвод 90 на 250", expect: "90 градусов 250", note: "сокращённый угол" },
  { query: "заглушка 315 торцевая", expect: "Заглушка", note: "перестановка слов" },
  { query: "переход 400-315", expect: "400/315", note: "дефис вместо дроби" },
  { query: "хомут для воздуховода 315", expect: "Хомут", note: "пояснение словами" },
  { query: "крестовина 250", expect: "Крестовина", note: "точное название" },
  { query: "ниппель 315", expect: "Ниппель", note: "точное название" },
  { query: "муфта ф 250", expect: "Муфта", note: "«ф» вместо d" },
  { query: "воздуховод прямошовный 400", expect: "прямошовный 400", note: "другой тип трубы" },
];

async function main() {
  let ok = 0;
  let totalMs = 0;

  for (const c of CASES) {
    const start = Date.now();
    const hits = await searchPrice(c.query, { limit: 3 });
    const ms = Date.now() - start;
    totalMs += ms;

    const top = hits[0];
    const found = hits.some((h) => h.rawName.toLowerCase().includes(c.expect.toLowerCase()));

    console.log(`\n«${c.query}»  (${c.note})`);
    for (const h of hits) {
      console.log(`   ${h.similarity.toFixed(3)}  ${h.code}  ${h.rawName}  — ${h.price} ₽`);
    }
    if (found) {
      ok++;
      console.log(`   ✓ ожидалось «${c.expect}»`);
    } else {
      console.log(`   ✗ НЕ найдено «${c.expect}», топ: ${top?.rawName ?? "пусто"}`);
    }
    console.log(`   ${ms} мс`);
  }

  console.log(`\n=== ИТОГ: ${ok}/${CASES.length} ===`);
  console.log(`Среднее время поиска: ${Math.round(totalMs / CASES.length)} мс`);

  if (ok < CASES.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
