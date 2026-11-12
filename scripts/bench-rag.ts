/**
 * Сравнивает RAG и детерминированный матчер на одних и тех же строках.
 *
 * Запуск: node --env-file=.env.local scripts/bench-rag.ts
 *
 * Зачем: RAG выглядит красиво, но нужен ответ на вопрос «что он добавляет
 * к тому, что уже работает». Если матчер справляется сам — RAG нужен только
 * для случаев, где матчер пасует. Если RAG ошибается чаще — его нельзя
 * ставить на путь принятия решения о цене.
 */
import { matchLine } from "../src/lib/matcher/match.ts";
import { loadPrice } from "../src/db/repositories/price.ts";
import { hybridSearch } from "../src/lib/rag/hybrid.ts";

interface BenchCase {
  line: string;
  /** Код позиции, которая ДОЛЖНА быть найдена. null — позиции нет в прайсе. */
  expect: string | null;
  why: string;
}

/**
 * Набор специально разный по сложности:
 *  - простые строки — матчер обязан справиться, RAG проверяем на скорость;
 *  - сокращения и опечатки — тут RAG может помочь;
 *  - позиции вне прайса — оба должны промолчать.
 */
const CASES: BenchCase[] = [
  { line: "Воздуховод спирально-навивной 315, 12 м.п.", expect: "p006", why: "простая" },
  { line: "Тройник 315/200, 4 шт", expect: "p106", why: "простая" },
  { line: "Отвод 90 градусов 250, 6 шт", expect: "p065", why: "простая" },
  { line: "Заглушка торцевая 315, 2 шт", expect: "p195", why: "простая" },
  { line: "Переход 400/315, 3 шт", expect: "p139", why: "простая" },
  { line: "Ниппель 315, 8 шт", expect: "p039", why: "простая" },
  { line: "воздух спиральный 315, 10 м", expect: "p006", why: "разговорное" },
  { line: "тройник триста пятнадцать на двести, 2 шт", expect: "p106", why: "числа словами" },
  { line: "отвод 90 на 250, 3 шт", expect: "p065", why: "сокращение" },
  { line: "переход 400-315, 1 шт", expect: "p139", why: "дефис" },
  { line: "заглушка 315 торц, 2 шт", expect: "p195", why: "обрывок слова" },
  { line: "муфта ф250, 5 шт", expect: "p051", why: "ф вместо d" },
  { line: "хомут крепёжный 315, 20 шт", expect: null, why: "нет в прайсе" },
  { line: "гибкая вставка 315, 4 шт", expect: null, why: "нет в прайсе" },
  { line: "Воздуховод спирально-навивной 999, 1 м", expect: null, why: "нет размера" },
];

interface Outcome {
  name: string;
  correct: number;
  falsePositive: number;
  missed: number;
  ms: number;
}

async function main() {
  const price = await loadPrice();

  const matcher: Outcome = { name: "матчер", correct: 0, falsePositive: 0, missed: 0, ms: 0 };
  const rag: Outcome = { name: "RAG", correct: 0, falsePositive: 0, missed: 0, ms: 0 };
  const both: Outcome = { name: "матчер→RAG", correct: 0, falsePositive: 0, missed: 0, ms: 0 };

  console.log("Разбор случаев:\n");

  for (const c of CASES) {
    // 1. Детерминированный матчер
    let t = Date.now();
    const m = matchLine(c.line, price);
    const matcherMs = Date.now() - t;
    matcher.ms += matcherMs;
    // MatchResult: статус matched означает однозначное совпадение, item.id —
    // это код позиции (p006). Обращаюсь через id, а не code: у PriceItem
    // поле называется id — на этом был баг в первой версии бенчмарка.
    const matcherCode = m.status === "matched" && m.item ? m.item.id : null;

    // 2. RAG
    t = Date.now();
    const hits = await hybridSearch(c.line, { limit: 1 });
    rag.ms += Date.now() - t;
    const ragCode = hits[0]?.code ?? null;

    // 3. Каскад: если матчер уверен — берём его, иначе RAG
    t = Date.now();
    const cascadeCode = matcherCode ?? ragCode;
    both.ms += matcherMs + (matcherCode ? 0 : Date.now() - t);

    const judge = (got: string | null, o: Outcome) => {
      if (c.expect === null) {
        if (got === null) o.correct++;
        else o.falsePositive++;
      } else if (got === c.expect) {
        o.correct++;
      } else if (got === null) {
        o.missed++;
      } else {
        o.falsePositive++;
      }
    };

    judge(matcherCode, matcher);
    judge(ragCode, rag);
    judge(cascadeCode, both);

    const mark = (got: string | null) => {
      if (c.expect === null) return got === null ? "верно" : `ЛОЖНО ${got}`;
      if (got === c.expect) return "верно";
      return got === null ? "не нашёл" : `ЛОЖНО ${got}`;
    };

    console.log(`${c.line}`);
    console.log(`   ожидалось: ${c.expect ?? "— (нет в прайсе)"}   [${c.why}]`);
    console.log(`   матчер: ${mark(matcherCode).padEnd(12)} RAG: ${mark(ragCode).padEnd(12)} каскад: ${mark(cascadeCode)}`);
  }

  console.log("\n=== ИТОГ ===");
  console.log("режим        верно  ложно  не найдено   время");
  for (const o of [matcher, rag, both]) {
    console.log(
      `${o.name.padEnd(12)} ${String(o.correct).padStart(5)}/${CASES.length}  ${String(o.falsePositive).padStart(5)}  ${String(o.missed).padStart(10)}   ${(o.ms / 1000).toFixed(1)} с`,
    );
  }

  console.log(
    "\nКлючевой критерий — ЛОЖНЫЕ срабатывания: ошибочная цена опаснее\n" +
      "отсутствия цены. Меньше ложно — лучше.",
  );
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
