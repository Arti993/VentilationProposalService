/**
 * Проверка журнала КП: запись, напоминания, стадии, воронка.
 *
 * Запуск: node --env-file=.env.local scripts/test-proposal-log.ts
 *
 * Проверяем то, что в Google Sheets пришлось бы делать руками:
 *  1. КП попадает в журнал при выдаче в автоматизацию.
 *  2. Повторная запись не создаёт дубль (идемпотентность).
 *  3. Напоминание выдаётся один раз, а не на каждом запросе.
 *  4. После двух напоминаний КП выпадает из выборки.
 *  5. Закрытие сделки снимает запланированное напоминание.
 */
import { logProposal, listProposals, takeDueReminders, setStage, funnel } from "../src/db/repositories/proposalLog.ts";
import { withRetry } from "../src/db/connection.ts";

async function main() {
  const testId = `test-${Date.now()}`;

  console.log("1. Запись в журнал");
  const entry = await logProposal({
    estimateId: testId,
    name: "проверка-журнала.xlsx",
    totalSum: 12345,
    pricedCount: 3,
    totalCount: 4,
  });
  console.log(`   id=${entry.id}, стадия=${entry.stage}, напоминаний=${entry.remindersSent}`);
  console.log(`   следующее напоминание: ${entry.nextReminderAt}`);
  console.log(`   ${entry.stage === "sent" && entry.remindersSent === 0 ? "ок" : "ПРОВАЛ"}`);

  console.log("\n2. Повторная запись не создаёт дубль");
  const again = await logProposal({
    estimateId: testId,
    name: "проверка-журнала.xlsx",
    totalSum: 12345,
    pricedCount: 3,
    totalCount: 4,
  });
  console.log(`   id=${again.id} ${again.id === entry.id ? "— тот же, ок" : "— ДУБЛЬ, провал"}`);

  console.log("\n3. Напоминание по расписанию (срок ещё не пришёл)");
  const notDue = await takeDueReminders(10);
  const caught = notDue.find((r) => r.estimateId === testId);
  console.log(`   выдано ${notDue.length}, наша запись: ${caught ? "ПОПАЛА (провал)" : "не попадала, ок"}`);

  console.log("\n4. Сдвигаем срок в прошлое и забираем");
  await withRetry(
    async (sql) =>
      sql`update proposal_log set next_reminder_at = now() - interval '1 minute' where estimate_id = ${testId}`,
    { label: "сдвиг срока" },
  );
  const due1 = await takeDueReminders(10);
  const got1 = due1.find((r) => r.estimateId === testId);
  console.log(`   выдано: ${got1 ? `да, напоминаний ${got1.remindersSent}, стадия ${got1.stage}` : "нет — провал"}`);
  console.log(`   ${got1?.remindersSent === 1 && got1?.stage === "reminded" ? "ок" : "ПРОВАЛ"}`);

  console.log("\n5. Повторный запрос не выдаёт ту же запись");
  const due2 = await takeDueReminders(10);
  const got2 = due2.find((r) => r.estimateId === testId);
  console.log(`   ${got2 ? "ПОПАЛА снова — провал" : "не попадала, ок"}`);

  console.log("\n6. Второе напоминание и выход из выборки");
  await withRetry(
    async (sql) =>
      sql`update proposal_log set next_reminder_at = now() - interval '1 minute' where estimate_id = ${testId}`,
    { label: "сдвиг 2" },
  );
  const due3 = await takeDueReminders(10);
  const got3 = due3.find((r) => r.estimateId === testId);
  console.log(`   выдано: ${got3 ? `да, напоминаний ${got3.remindersSent}` : "нет — провал"}`);
  console.log(`   следующее напоминание: ${got3?.nextReminderAt ?? "не планируется"}`);
  console.log(`   ${got3?.remindersSent === 2 && got3?.nextReminderAt === null ? "ок" : "ПРОВАЛ"}`);

  console.log("\n7. Закрытие сделки");
  const closed = await setStage(entry.id, "closed", "клиент согласился");
  console.log(`   стадия: ${closed?.stage}, напоминание: ${closed?.nextReminderAt ?? "снято"}`);
  console.log(`   ${closed?.stage === "closed" && closed?.nextReminderAt === null ? "ок" : "ПРОВАЛ"}`);

  console.log("\n8. Воронка");
  for (const f of await funnel()) {
    console.log(`   ${f.stage}: ${f.count} шт, ${f.sum} ₽`);
  }

  console.log("\n9. Список журнала (последние 3)");
  for (const p of await listProposals(3)) {
    console.log(`   #${p.id} ${p.name}: ${p.totalSum} ₽, стадия ${p.stage}, напоминаний ${p.remindersSent}`);
  }

  // Убираем за собой, чтобы не засорять журнал
  await withRetry(
    async (sql) => sql`delete from proposal_log where estimate_id = ${testId}`,
    { label: "очистка" },
  );
  console.log("\nТестовая запись удалена.");
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
