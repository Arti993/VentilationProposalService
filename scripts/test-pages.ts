/**
 * Собирает КП из реальной сессии в БД и проверяет разбиение на страницы.
 *
 * Запуск: node --env-file=.env.local scripts/test-pages.ts [sessionId]
 *
 * Зачем отдельно: короткая тестовая смета не выявляет дефектов вёрстки.
 * На 11 позициях документ мог вылезать на вторую страницу, оставляя там
 * три строки подписи. Проверять надо на настоящих данных.
 */
import fs from "node:fs";
import path from "node:path";
// Репозиторий импортируем напрямую, а не через sessionStore: тот тянет
// алиас "@/db", который понимает только сборщик Next.js.
import { getSession } from "../src/db/repositories/sessions.ts";
import { buildProposalDocx } from "../src/lib/proposal/docx.ts";

const sessionId =
  process.argv[2] ?? fs.readFileSync(".session-test-id", "utf8").trim();

async function main() {
  const session = await getSession(sessionId);
  if (!session) {
    console.error("Сессия не найдена:", sessionId);
    process.exit(1);
  }

  const priced = session.positions.filter((p) => p.status === "priced").length;
  console.log(`Сессия: ${session.name}`);
  console.log(`Позиций с ценой: ${priced} из ${session.positions.length}`);
  console.log(`Итог: ${session.stats.totalSum.toLocaleString("ru-RU")} ₽`);

  const buffer = await buildProposalDocx({ session });
  const out = path.join(process.cwd(), "kp-pages.docx");
  fs.writeFileSync(out, buffer);
  console.log(`\nФайл: ${out} (${Math.round(buffer.length / 1024)} КБ)`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
