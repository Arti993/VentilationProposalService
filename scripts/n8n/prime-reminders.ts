/**
 * Готовит напоминание к проверке: сдвигает срок у свежих записей журнала.
 *
 * Запуск: node --env-file=.env.local scripts/n8n/prime-reminders.ts
 *
 * Зачем: первое напоминание по умолчанию через 3 дня. Ждать трое суток,
 * чтобы проверить сценарий, никто не станет — поэтому сдвигаем срок у
 * пары записей в прошлое и смотрим, придёт ли сообщение.
 */
import { withRetry } from "../../src/db/connection.ts";

async function main() {
  const rows = await withRetry(
    async (sql) =>
      sql<{ id: number; name: string }[]>`
        update proposal_log
           set next_reminder_at = now() - interval '1 minute',
               stage = 'sent',
               reminders_sent = 0
         where id in (
           select id from proposal_log
            where stage in ('sent', 'reminded')
            order by created_at desc
            limit 2
         )
        returning id, name
      `,
    { label: "подготовка напоминаний" },
  );

  if (!rows.length) {
    console.log("Нет записей в журнале. Сначала создайте смету и дайте уведомлению сработать.");
    return;
  }

  console.log(`Готово к напоминанию: ${rows.length}`);
  for (const r of rows) console.log(`  #${r.id} ${r.name}`);
  console.log("\nТеперь включите сценарий напоминаний и подождите до 30 минут.");
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
