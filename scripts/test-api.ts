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
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ question, sessionId }),
  });

  /**
   * Ответ приходит потоком SSE: шаги и финальный `done`.
   *
   * Здесь читаем текст целиком и берём последний кадр `done` — скрипту
   * нужен итоговый ответ, а не таймлайн. Разбор нарочно простой:
   * `res.json()` на потоке падает с `Unexpected token 'e'`, и это
   * ровно та ошибка, которая была до правки.
   */
  const body = await res.text();
  const doneFrame = body
    .split("\n\n")
    .filter((f) => f.startsWith("event: done"))
    .pop();
  const errorFrame = body
    .split("\n\n")
    .filter((f) => f.startsWith("event: error"))
    .pop();

  console.log(`\nВОПРОС: ${question}`);

  if (errorFrame) {
    const data = /^data: (.+)$/m.exec(errorFrame)?.[1];
    console.log(`  ОШИБКА: ${data ? (JSON.parse(data) as { message: string }).message : "?"}`);
    return;
  }
  if (!doneFrame) {
    console.log(`  ОШИБКА: поток завершился без ответа (HTTP ${res.status})`);
    return;
  }

  const raw = /^data: (.+)$/m.exec(doneFrame)?.[1];
  const json = raw
    ? (JSON.parse(raw) as { answer: string; toolCalls: number; ms: number })
    : null;
  if (!json) {
    console.log("  ОШИБКА: не удалось разобрать кадр done");
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
