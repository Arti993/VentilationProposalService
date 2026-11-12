/**
 * Проверка главного свойства: сессия переживает перезапуск сервера.
 *
 * Сценарий:
 *  1. загружаем смету — получаем sessionId;
 *  2. убиваем сервер (снаружи этого скрипта);
 *  3. поднимаем заново;
 *  4. спрашиваем по тому же sessionId — должен ответить по данным сметы.
 *
 * Скрипт умеет работать в двух ролях:
 *   node scripts/persist-test.ts save     — загрузить и записать sessionId
 *   node scripts/persist-test.ts check    — проверить сессию после рестарта
 *
 * Запуск: node scripts/persist-test.ts <save|check> [base-url]
 */
import fs from "node:fs";
import path from "node:path";

const mode = process.argv[2] ?? "save";
const BASE = process.argv[3] ?? "http://localhost:3100";
const ID_FILE = path.join(process.cwd(), ".session-test-id");

async function save(): Promise<void> {
  const file = fs.readFileSync("examples/estimate-office.txt");
  const form = new FormData();
  form.append("file", new Blob([file], { type: "text/plain" }), "estimate-office.txt");

  const res = await fetch(`${BASE}/api/estimate`, { method: "POST", body: form });
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    session?: { id: string; stats: { total: number; priced: number; totalSum: number } };
  };

  if (!json.ok || !json.session) {
    console.error("ЗАГРУЗКА НЕ УДАЛАСЬ:", json.error);
    process.exit(1);
  }

  fs.writeFileSync(ID_FILE, json.session.id, "utf8");
  console.log("Смета загружена");
  console.log("  sessionId:", json.session.id);
  console.log("  позиций:", json.session.stats.total);
  console.log("  с ценой:", json.session.stats.priced);
  console.log("  сумма:", json.session.stats.totalSum);
  console.log("\nТеперь перезапустите сервер и выполните: check");
}

async function check(): Promise<void> {
  if (!fs.existsSync(ID_FILE)) {
    console.error("Нет файла", ID_FILE, "— сначала выполните save");
    process.exit(1);
  }

  const sessionId = fs.readFileSync(ID_FILE, "utf8").trim();
  console.log("Проверяю сессию:", sessionId);

  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: "Какой итог по этой смете и сколько позиций без цены?",
      sessionId,
    }),
  });

  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    answer?: string;
    toolCalls?: number;
  };

  console.log("\nОТВЕТ СЕРВЕРА:");
  if (!json.ok) {
    console.error("  ОШИБКА:", json.error);
    console.error("\nСЕССИЯ НЕ ВОССТАНОВИЛАСЬ — цель не достигнута");
    process.exit(1);
  }

  console.log(json.answer);
  console.log(`\n(инструментов: ${json.toolCalls})`);

  // Главная проверка: агент назвал реальный итог, а не «смета не найдена»
  const text = json.answer ?? "";
  const knowsTotal = text.includes("123") && text.includes("170");
  const notLost = !text.toLowerCase().includes("не найдена");

  console.log("\nРЕЗУЛЬТАТ:");
  console.log("  сессия найдена:", notLost ? "ДА" : "НЕТ");
  console.log("  знает итог 123 170:", knowsTotal ? "ДА" : "НЕТ");

  if (notLost && knowsTotal) {
    console.log("\nOK: сессия пережила перезапуск сервера");
    process.exit(0);
  }

  console.error("\nПРОВАЛ: сессия потеряна или данные неверны");
  process.exit(1);
}

if (mode === "save") await save();
else if (mode === "check") await check();
else {
  console.error("Режим должен быть save или check");
  process.exit(1);
}
