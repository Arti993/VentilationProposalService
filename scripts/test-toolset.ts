/**
 * Проверяет, что выбор инструментов не сломал работу со сметой.
 *
 * Запуск: node --env-file=.env.local scripts/test-toolset.ts
 *
 * Риск: инструменты делятся на группы по тексту вопроса. Если
 * классификация ошибётся, агент не увидит нужный инструмент и начнёт
 * выдумывать ответ. Здесь проверяем обе ветки на реальной смете.
 */
import { createAgent, HumanMessage } from "../src/lib/agent/graph.ts";
import { loadPrice } from "../src/db/repositories/price.ts";
import { SessionStore, createSession } from "../src/lib/agent/session.ts";
import { processEstimate } from "../src/lib/matcher/hybrid.ts";

/** Строки учебной сметы — те же, что в демо. */
const ESTIMATE_LINES = [
  "Воздуховод спиральный 315 - 24 шт",
  "Отвод сегментный 90 градусов 315 - 6 шт",
  "Тройник 315/200 - 2 шт",
  "Переход 315-250 - 2 шт",
  "Заглушка 315 - 1 шт",
  "Хомут крепежный 315 - 40 шт",
];

async function main() {
  const price = await loadPrice();
  const rows = await processEstimate(ESTIMATE_LINES, price, { useLlm: false });
  console.log(`Смета собрана: ${rows.length} позиций`);

  const store = new SessionStore();
  store.load(createSession("смета-офис.xlsx", rows));
  console.log(`${store.summary()}\n`);

  const agent = createAgent({ getPrice: loadPrice, useLlm: true }, { store });

  const QUESTIONS = [
    "Сколько позиций в смете и на какую сумму?",
    "Какие позиции остались без цены?",
    "Почему позиция 2 получила такую цену?",
    "Посчитай итог по смете",
    "Сколько стоит отвод 90 на 250?", // не про смету — должен уйти в прайс
  ];

  for (const q of QUESTIONS) {
    const t = Date.now();
    const res = await agent.invoke({ messages: [new HumanMessage(q)] });
    const ms = Date.now() - t;

    const tools: string[] = [];
    for (const m of res.messages) {
      const tc = (m as { tool_calls?: Array<{ name: string }> }).tool_calls;
      if (tc?.length) for (const c of tc) tools.push(c.name);
    }

    const last = res.messages[res.messages.length - 1];
    const text = typeof last.content === "string" ? last.content : "";

    console.log(`«${q}»`);
    console.log(`  ${ms} мс, инструменты: ${tools.join(", ") || "—"}`);
    console.log(`  → ${text.slice(0, 150).replace(/\n/g, " ")}\n`);
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
