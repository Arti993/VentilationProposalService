/**
 * Проверяет замену числительных словами на цифры.
 *
 * Запуск: node --env-file=.env.local scripts/test-digits.ts
 */
import { digitsFromWords, hybridSearch } from "../src/lib/rag/hybrid.ts";

const CASES = [
  "тройник триста пятнадцать на двести, 2 шт",
  "отвод девяносто на двести пятьдесят",
  "воздуховод двести пятьдесят",
  "переход триста пятнадцать четыреста",
  "ниппель сто двадцать пять",
  "тройник 315 на 200", // уже цифры — не должно сломаться
];

async function main() {
  console.log("Замена числительных:\n");
  for (const c of CASES) {
    console.log(`  «${c}»`);
    console.log(`   → «${digitsFromWords(c)}»`);
  }

  console.log("\nПоиск после замены:\n");
  for (const c of CASES) {
    const hits = await hybridSearch(c, { limit: 2 });
    const top = hits[0];
    console.log(`  «${c}»`);
    console.log(`   → ${top ? `${top.code} ${top.rawName} (${top.score.toFixed(3)})` : "НЕ НАЙДЕНО"}`);
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
