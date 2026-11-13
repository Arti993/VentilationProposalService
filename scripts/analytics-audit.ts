/**
 * Что уже можно посчитать по базе прямо сейчас.
 *
 * Запуск: node --env-file=.env.local scripts/analytics-audit.ts
 *
 * Не «что теоретически возможно», а что реально лежит в таблицах и
 * сколько из этого даёт ответ на вопросы вида «какая доля позиций
 * получает цену» и «сколько раз LLM понадобился».
 *
 * Скрипт читающий и ничего не меняет — его безопасно запускать на
 * боевой базе.
 */
import { withRetry } from "../src/db/connection.ts";

interface Stat {
  label: string;
  value: string;
  note?: string;
}

const out: Stat[] = [];

async function q<T>(sqlText: string): Promise<T[]> {
  return withRetry(async (sql) => sql.unsafe(sqlText) as Promise<T[]>, {
    label: "audit",
    heavy: true,
  });
}

async function main() {
  console.log("Что лежит в базе и что из этого считается\n");

  // ── Сметы ──
  const est = await q<{
    n: number;
    with_price: number;
    positions: number;
    priced: number;
    not_found: number;
    needs_human: number;
    sum: string;
  }>(`
    select count(*)::int as n,
           sum(case when priced_count > 0 then 1 else 0 end)::int as with_price,
           coalesce(sum(total_count), 0)::int as positions,
           coalesce(sum(priced_count), 0)::int as priced,
           coalesce(sum(not_found_count), 0)::int as not_found,
           coalesce(sum(needs_human_count), 0)::int as needs_human,
           coalesce(sum(total_sum), 0)::text as sum
      from estimates
  `);
  const e = est[0];
  out.push({ label: "смет загружено", value: String(e.n) });
  out.push({ label: "позиций всего", value: String(e.positions) });
  out.push({
    label: "доля позиций с ценой",
    value: e.positions ? `${((e.priced / e.positions) * 100).toFixed(1)}%` : "—",
    note: `${e.priced} из ${e.positions}`,
  });
  out.push({ label: "без цены", value: String(e.not_found) });
  out.push({ label: "на проверку", value: String(e.needs_human) });
  out.push({ label: "сумма всех смет", value: `${Number(e.sum).toLocaleString("ru-RU")} ₽` });

  // ── Источник решения: детерминированный или LLM ──
  const src = await q<{ source: string; n: number; priced: number }>(`
    select coalesce(source, 'null') as source,
           count(*)::int as n,
           sum(case when status = 'priced' then 1 else 0 end)::int as priced
      from estimate_positions
     group by source
     order by n desc
  `);
  console.log("Источник решения по позициям:");
  for (const s of src) {
    const share = e.positions ? ((s.n / e.positions) * 100).toFixed(1) : "0";
    console.log(
      `  ${s.source.padEnd(14)} ${String(s.n).padStart(4)} шт (${share}%), ` +
        `из них с ценой ${s.priced}`,
    );
  }

  // ── Точность: какая доля LLM-решений стала ценой ──
  const llm = src.find((s) => s.source === "llm");
  if (llm) {
    out.push({
      label: "LLM вызван для",
      value: `${llm.n} позиций`,
      note: `${((llm.n / e.positions) * 100).toFixed(1)}% от всех`,
    });
    out.push({
      label: "LLM дал цену",
      value: `${llm.priced} из ${llm.n}`,
      note: llm.n ? `${((llm.priced / llm.n) * 100).toFixed(0)}% решений LLM` : "—",
    });
  }

  // ── Журнал КП ──
  const log = await q<{ stage: string; n: number; sum: string }>(`
    select stage, count(*)::int as n, coalesce(sum(total_sum), 0)::text as sum
      from proposal_log group by stage order by n desc
  `);
  console.log("\nЖурнал и воронка:");
  let totalLog = 0;
  for (const l of log) {
    totalLog += l.n;
    console.log(
      `  ${l.stage.padEnd(10)} ${String(l.n).padStart(3)} ` +
        `на ${Number(l.sum).toLocaleString("ru-RU")} ₽`,
    );
  }
  if (totalLog) {
    const closed = log.find((l) => l.stage === "closed")?.n ?? 0;
    out.push({
      label: "конверсия журнала",
      value: `${((closed / totalLog) * 100).toFixed(0)}%`,
      note: `${closed} закрыто из ${totalLog} записей`,
    });
  }

  // ── Топ позиций, которые не нашлись ──
  const misses = await q<{ name: string; n: number }>(`
    select name, count(*)::int as n
      from estimate_positions
     where status in ('not_found', 'needs_human')
     group by name order by n desc limit 5
  `);
  if (misses.length) {
    console.log("\nЧаще всего не находится (кандидаты на добавление в прайс):");
    for (const m of misses) console.log(`  ${m.n}× ${m.name}`);
  }

  // ── Чего НЕТ ──
  console.log("\nЧего в базе нет:");
  const tables = await q<{ table_name: string }>(`
    select table_name from information_schema.tables
     where table_schema = 'public' order by table_name
  `);
  const names = tables.map((t) => t.table_name);
  const missing = ["chat_log", "events"].filter((t) => !names.includes(t));
  for (const m of missing) console.log(`  таблицы «${m}» нет — диалоги и события не логируются`);
  console.log(`  таблиц всего: ${names.length} (${names.join(", ")})`);

  console.log("\n=== Сводка ===");
  for (const s of out) {
    console.log(`  ${s.label.padEnd(28)} ${s.value}${s.note ? `  (${s.note})` : ""}`);
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
