/**
 * Что лежит в базе и что отдаёт прод — сравнение.
 *
 * Запуск: node --env-file=.env.local scripts/n8n/compare-db.ts
 *
 * Прод вернул 0 смет, хотя в локальной базе они есть. Значит либо
 * Vercel подключён к другой базе, либо сметы не проходят фильтр
 * (истекли, priced_count = 0, notified_at выставлен).
 */
import { withRetry } from "../../src/db/connection.ts";

interface Row {
  id: string;
  name: string;
  total_sum: string;
  priced_count: number;
  notified_at: Date | null;
  expires_at: Date;
}

async function main() {
  console.log("=== Все сметы в базе ===");
  const rows = await withRetry(
    async (sql) =>
      sql<Row[]>`
        select id, name, total_sum, priced_count, notified_at, expires_at
          from estimates order by created_at desc limit 10
      `,
    { label: "сметы" },
  );

  if (!rows.length) {
    console.log("  (пусто)");
  }
  const now = Date.now();
  for (const r of rows) {
    const expired = r.expires_at.getTime() < now;
    const pending = r.notified_at === null;
    const ok = !expired && pending && r.priced_count > 0;
    console.log(`  ${r.id.slice(0, 8)} ${r.name}`);
    console.log(
      `     сумма ${r.total_sum}, цен ${r.priced_count}, ` +
        `notified: ${r.notified_at ? "да" : "нет"}, ` +
        `истекла: ${expired ? "ДА" : "нет"} → ${ok ? "ПОПАДЁТ в выдачу" : "НЕ попадёт"}`,
    );
  }

  console.log("\n=== Проверка фильтра эндпоинта ===");
  const passing = await withRetry(
    async (sql) =>
      sql<{ n: number }[]>`
        select count(*)::int as n from estimates
         where notified_at is null and expires_at > now() and priced_count > 0
      `,
    { label: "фильтр" },
  );
  console.log(`  подходит под условия: ${passing[0]?.n ?? 0}`);

  console.log("\n=== Что видит прод ===");
  const key = process.env.AUTOMATION_API_KEY ?? "";
  const res = await fetch(
    "https://ventilation-proposal-service.vercel.app/api/proposals/recent?include=all&limit=20",
    { headers: { Authorization: `Bearer ${key}` } },
  );
  const j = (await res.json()) as { count?: number; proposals?: Array<{ name: string }> };
  console.log(`  статус ${res.status}, count=${j.count}`);
  for (const p of j.proposals ?? []) console.log(`    - ${p.name}`);

  console.log(
    "\nЕсли локально сметы есть, а прод их не видит — у Vercel другая DATABASE_URL.",
  );
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
