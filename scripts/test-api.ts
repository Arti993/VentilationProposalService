/**
 * Проверка UI-API без браузера: загрузка сметы и вопрос агенту.
 * Запуск: node scripts/test-api.ts [http://localhost:3100]
 */
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3100";

async function upload(filePath: string): Promise<string> {
  const file = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([file], { type: "text/plain" }), path.basename(filePath));

  const res = await fetch(`${BASE}/api/estimate`, { method: "POST", body: form });
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    session?: {
      id: string;
      stats: {
        total: number;
        priced: number;
        notFound: number;
        needsHuman: number;
        totalSum: number;
      };
      positions: Array<{ posNo: number; name: string; status: string; total?: number }>;
    };
  };

  if (!json.ok || !json.session) throw new Error(json.error ?? "загрузка не удалась");

  const s = json.session;
  console.log(`\nЗАГРУЗКА ${path.basename(filePath)}`);
  console.log(`  позиций: ${s.stats.total} | с ценой: ${s.stats.priced} | нет в прайсе: ${s.stats.notFound} | на проверку: ${s.stats.needsHuman}`);
  console.log(`  сумма: ${s.stats.totalSum} руб`);
  console.log(`  sessionId: ${s.id}`);
  console.log(`  пример позиции: ${JSON.stringify(s.positions[0])}`);

  return s.id;
}

async function ask(question: string, sessionId?: string): Promise<void> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, sessionId }),
  });
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    answer?: string;
    toolCalls?: number;
  };

  console.log(`\nВОПРОС: ${question}`);
  if (!json.ok) {
    console.log(`  ОШИБКА: ${json.error}`);
    return;
  }
  console.log(`  ОТВЕТ: ${json.answer}`);
  console.log(`  (инструментов: ${json.toolCalls}, ${Date.now() - t0} мс)`);
}

const id = await upload("examples/estimate-office.txt");
await ask("Какой итог по этой смете?", id);
await ask("Сколько позиций не нашлось?", id);
await ask("Почему позиция 15 требует проверки?", id);
await ask("Сколько стоит тройник 315/200?");
await ask("Какая погода в Москве?");

console.log("\nПРОВЕРКА ЗАВЕРШЕНА");
