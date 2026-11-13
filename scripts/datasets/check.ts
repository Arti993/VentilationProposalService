/**
 * Прогон датасета БЕЗ LangSmith и без базы — для CI.
 *
 * Запуск: node scripts/datasets/check.ts            # все группы
 *         node scripts/datasets/check.ts price      # только цена
 *
 * Отличия от evaluate.ts:
 *  - кейсы берутся из cases.ts напрямую, а не из LangSmith;
 *  - прайс читается из data/price.normalized.json, а не из Neon;
 *  - оцениваются только ДЕТЕРМИНИРОВАННЫЕ проверки.
 *
 * Почему так. CI гоняется на каждый пуш и должен быть быстрым,
 * воспроизводимым и не зависеть от внешних ключей. Поэтому:
 *  - сеть до Neon не нужна: прайс в репозитории;
 *  - ключ LangSmith не нужен: результаты идут в лог;
 *  - агент не вызывается: вызовы LLM стоят денег и дают разные ответы
 *    от прогона к прогону, то есть не годятся как критерий «сломал/не сломал».
 *
 * Что это ловит: регрессии в детерминированной части — разбор строк,
 * поиск по прайсу, предохранение от инъекций на уровне кода. Именно там
 * ошибки опаснее всего: неверная цена уходит клиенту.
 *
 * Кейсы группы agent/attack, требующие модели, здесь проверяются только
 * теми оценками, что не зависят от ответа LLM (attack-кейсы проходят
 * через processLine, а не через агента).
 *
 * Код возврата: 0 — всё прошло, 1 — есть провалы. GitHub Actions
 * покажет красный крест.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_CASES, type TestCase } from "./cases.ts";
import { processLine } from "../../src/lib/matcher/hybrid.ts";
import {
  priceCodeEvaluator,
  attackResistedEvaluator,
  type Actual,
  type Expectation,
} from "./evaluators.ts";
import type { PriceItem } from "../../src/lib/price/normalize.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const GROUP = (process.argv[2] ?? "all") as "price" | "agent" | "attack" | "all";

/** Прайс из репозитория — база не нужна. */
function loadLocalPrice(): PriceItem[] {
  const file = path.join(root, "data", "price.normalized.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as PriceItem[];
}

/**
 * Прогоняет один кейс детерминированно.
 *
 * Для price и attack используем processLine с useLlm: false — это ровно
 * тот путь, где цена назначается без участия модели. Кейсы agent без
 * модели не проверить (там нужен ответ на свободный вопрос), поэтому
 * они пропускаются с явной пометкой, а не считаются пройденными.
 */
async function runCase(c: TestCase, price: PriceItem[]): Promise<Actual | null> {
  if (c.expect.type === "agent") return null; // нужен LLM — см. evaluate.ts
  // Кейс, где детерминированный путь отказывается решать осознанно
  if (c.expect.type === "price" && c.expect.needsLlm) return null;

  const res = await processLine(c.input, price, { useLlm: false });
  return {
    code: res.item?.id ?? null,
    price: res.item?.price ?? null,
    status: res.status,
  };
}

async function main() {
  const price = loadLocalPrice();
  console.log(`Прайс: ${price.length} позиций (из репозитория)\n`);

  const cases = ALL_CASES.filter((c) => GROUP === "all" || c.kind === GROUP);
  if (!cases.length) {
    console.error(`Нет кейсов для группы «${GROUP}»`);
    process.exit(1);
  }

  console.log(`=== Проверка «${GROUP}»: ${cases.length} кейсов ===\n`);

  const failures: string[] = [];
  let skipped = 0;
  let checked = 0;

  for (const c of cases) {
    const actual = await runCase(c, price);
    if (actual === null) {
      skipped++;
      continue;
    }
    checked++;

    const args = {
      outputs: actual as unknown as Record<string, unknown>,
      referenceOutputs: { expected: c.expect as Expectation },
    };
    const scores = [priceCodeEvaluator(args), attackResistedEvaluator(args)].filter(
      (s) => !s.comment?.startsWith("не относится"),
    );

    const bad = scores.filter((s) => s.score < 1);
    if (bad.length) {
      const mark = c.expect.type === "price" && c.expect.code === null ? "ЛОЖНОЕ" : "ПРОВАЛ";
      console.log(`${mark} ${c.id}`);
      console.log(`         «${c.input}»`);
      for (const b of bad) console.log(`         ${b.key}: ${b.comment}`);
      failures.push(c.id);
    } else {
      console.log(`OK     ${c.id}`);
    }
  }

  console.log(`\n=== ИТОГ ===`);
  console.log(`  проверено:  ${checked}`);
  console.log(`  пропущено:  ${skipped} (требуют LLM, см. evaluate.ts)`);
  console.log(`  провалов:   ${failures.length}`);

  if (skipped) {
    console.log(
      `\n  Пропущенные кейсы не проверены в CI намеренно: ответ модели\n` +
        `  меняется от прогона к прогону, и красный крест на таком кейсе\n` +
        `  означал бы «модель сегодня ответила иначе», а не поломку кода.`,
    );
  }

  if (failures.length) {
    console.log(`\nПровалы: ${failures.join(", ")}`);
    process.exit(1);
  }

  console.log("\nВсё прошло.");
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
