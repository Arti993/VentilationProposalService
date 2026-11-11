/**
 * Проверяет гибридный поиск — особенно на случаях, где чистый вектор
 * ошибался.
 *
 * Запуск: node --env-file=.env.local scripts/test-hybrid.ts
 */
import { hybridSearch } from "../src/lib/rag/hybrid.ts";

interface Case {
  query: string;
  expect: string;
  note: string;
}

const CASES: Case[] = [
  { query: "воздух спиральный 315", expect: "спирально-навивной 315", note: "разговорное" },
  { query: "тройник 315 на 200", expect: "315/200", note: "«на» вместо дроби" },
  { query: "отвод 90 на 250", expect: "90 градусов 250", note: "сокращённый угол" },
  { query: "заглушка 315 торцевая", expect: "Заглушка", note: "перестановка" },
  { query: "переход 400-315", expect: "400/315", note: "дефис" },
  { query: "крестовина 250", expect: "Крестовина", note: "точное" },
  { query: "ниппель 315", expect: "Ниппель", note: "точное" },
  { query: "муфта ф 250", expect: "Муфта", note: "«ф» вместо d" },
  { query: "воздуховод прямошовный 400", expect: "прямошовный 400", note: "другой тип" },
  { query: "врезка прямая 250", expect: "Врезка", note: "точное" },
  // Уточнение через «для» — главное слово должно победить
  { query: "тройник для воздуховода 315 на 200", expect: "315/200", note: "уточнение «для»" },
  { query: "переход для воздуховода 400 315", expect: "400/315", note: "уточнение «для»" },
];

/**
 * Позиции, которых в прайсе НЕТ. Поиск не должен их находить:
 * выдать похожую позицию с чужой ценой опаснее, чем не найти ничего.
 */
const NEGATIVE: Array<{ query: string; forbidden: string }> = [
  // Хомутов в прайсе нет вообще — проверено запросом по названию и типу
  { query: "хомут крепежный 315", forbidden: "Хомут" },
  { query: "гибкая вставка 315", forbidden: "Вставка" },
];

async function main() {
  let ok = 0;
  let totalMs = 0;

  for (const c of CASES) {
    const start = Date.now();
    const hits = await hybridSearch(c.query, { limit: 3 });
    const ms = Date.now() - start;
    totalMs += ms;

    const found = hits.some((h) => h.rawName.toLowerCase().includes(c.expect.toLowerCase()));

    console.log(`\n«${c.query}»  (${c.note})`);
    for (const h of hits) {
      console.log(
        `   score ${h.score.toFixed(3)} = вектор ${h.vectorScore.toFixed(3)} + слова ${h.keywordScore.toFixed(2)}` +
          `  ${h.code} ${h.rawName}`,
      );
    }
    console.log(`   ${found ? "✓" : "✗ НЕ найдено"} «${c.expect}»   ${ms} мс`);
    if (found) ok++;
  }

  console.log(`\n=== ПОЗИТИВНЫЕ: ${ok}/${CASES.length} ===`);

  // Проверка на выдумывание: чего нет в прайсе — не должно находиться
  console.log("\n=== НЕГАТИВНЫЕ (не должно найтись) ===");
  let negOk = 0;
  for (const n of NEGATIVE) {
    const hits = await hybridSearch(n.query, { limit: 3 });
    const bad = hits.find((h) => h.rawName.toLowerCase().includes(n.forbidden.toLowerCase()));
    if (bad) {
      console.log(`  ✗ «${n.query}» выдал ${bad.code} ${bad.rawName} — ложное совпадение`);
    } else {
      negOk++;
      console.log(`  ✓ «${n.query}» — не нашлось (правильно)`);
    }
  }
  console.log(`=== НЕГАТИВНЫЕ: ${negOk}/${NEGATIVE.length} ===`);

  console.log(`\nСреднее время: ${Math.round(totalMs / CASES.length)} мс`);
  if (ok < CASES.length || negOk < NEGATIVE.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
