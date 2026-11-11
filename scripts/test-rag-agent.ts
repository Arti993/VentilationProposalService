/**
 * Проверяет, что агент пользуется RAG-инструментом и не выдумывает цены.
 *
 * Запуск: node --env-file=.env.local scripts/test-rag-agent.ts
 */
import { createAgent, HumanMessage } from "../src/lib/agent/graph.ts";

interface Case {
  question: string;
  forbidden?: string[];
  note: string;
}

const CASES: Case[] = [
  {
    question: "Сколько стоит отвод 90 градусов на 250?",
    forbidden: ["не знаю", "нет информации"],
    note: "должен найти через search_price",
  },
  {
    question: "Есть ли у вас хомут для воздуховода 315?",
    forbidden: ["315 ₽", "руб."],
    note: "хомутов нет — не должен выдумать цену",
  },
  {
    question: "Нужен воздух спиральный 315, почём?",
    forbidden: [],
    note: "разговорное название",
  },
  {
    question: "Какая погода в Москве?",
    forbidden: ["градус", "облачно"],
    note: "вне темы — отказ",
  },
];

async function main() {
  const agent = createAgent({});
  let ok = 0;

  for (const c of CASES) {
    console.log(`\n«${c.question}»  (${c.note})`);
    const start = Date.now();
    try {
      const res = await agent.invoke({ messages: [new HumanMessage(c.question)] });
      const answer = res.messages[res.messages.length - 1];
      const text = typeof answer.content === "string" ? answer.content : JSON.stringify(answer.content);
      console.log(`  ${text.slice(0, 300)}`);
      console.log(`  ${Date.now() - start} мс`);

      const bad = (c.forbidden ?? []).find((f) => text.toLowerCase().includes(f.toLowerCase()));
      if (bad) {
        console.log(`  ✗ содержит запрещённое: «${bad}»`);
      } else {
        ok++;
        console.log("  ✓");
      }
    } catch (e) {
      console.log(`  ✗ ОШИБКА: ${(e as Error).message.slice(0, 100)}`);
    }
  }

  console.log(`\n=== ИТОГ: ${ok}/${CASES.length} ===`);
  if (ok < CASES.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
