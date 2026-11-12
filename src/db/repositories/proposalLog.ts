/**
 * Репозиторий журнала отправленных КП.
 *
 * Задача — заменять таблицу в Google Sheets: менеджер видит все КП, их
 * стадии и кому пора напомнить, а n8n забирает список для напоминаний.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ ТРАНЗАКЦИЙ
 *
 * Пулер Neon рвёт соединение после одного тяжёлого запроса, и
 * BEGIN/COMMIT через него ненадёжны: соединение может умереть посреди
 * транзакции. Поэтому каждая функция — один атомарный запрос, а там где
 * нужно «прочитать и изменить» — UPDATE ... RETURNING, который атомарен
 * сам по себе.
 */
import { withRetry } from "../connection.ts";
import type { ProposalStage } from "../schema.ts";
import { PROPOSAL_STAGES } from "../schema.ts";

/** Сколько ждать до следующего напоминания. */
const REMINDER_DELAYS_HOURS = [72, 168]; // 3 дня, затем 7 дней

/** Строка журнала в том виде, в каком её видит клиент API. */
export interface ProposalLogEntry {
  id: number;
  estimateId: string;
  name: string;
  totalSum: number;
  pricedCount: number;
  totalCount: number;
  stage: ProposalStage;
  remindersSent: number;
  nextReminderAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: number;
  estimate_id: string;
  name: string;
  total_sum: string;
  priced_count: number;
  total_count: number;
  stage: string;
  reminders_sent: number;
  next_reminder_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function map(r: Row): ProposalLogEntry {
  return {
    id: r.id,
    estimateId: r.estimate_id,
    name: r.name,
    totalSum: Number(r.total_sum),
    pricedCount: r.priced_count,
    totalCount: r.total_count,
    stage: r.stage as ProposalStage,
    remindersSent: r.reminders_sent,
    nextReminderAt: r.next_reminder_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

/**
 * Записывает КП в журнал и сразу планирует первое напоминание.
 *
 * Идемпотентно по estimate_id: повторный вызов (например, n8n
 * перезапустил сценарий) не создаст вторую строку, а вернёт
 * существующую. Без этого при каждом сбое появлялись бы дубли, и
 * клиент получал бы несколько напоминаний об одном КП.
 */
export async function logProposal(input: {
  estimateId: string;
  name: string;
  totalSum: number;
  pricedCount: number;
  totalCount: number;
}): Promise<ProposalLogEntry> {
  const nextReminder = new Date(Date.now() + REMINDER_DELAYS_HOURS[0] * 3600_000);

  const rows = await withRetry(
    async (sql) =>
      sql<Row[]>`
        insert into proposal_log (
          estimate_id, name, total_sum, priced_count, total_count, next_reminder_at
        ) values (
          ${input.estimateId}, ${input.name}, ${String(input.totalSum)},
          ${input.pricedCount}, ${input.totalCount}, ${nextReminder}
        )
        on conflict do nothing
        returning id, estimate_id, name, total_sum, priced_count, total_count,
                  stage, reminders_sent, next_reminder_at, created_at, updated_at
      `,
    { label: "запись КП в журнал" },
  );

  // Строка уже была — читаем её
  if (!rows.length) {
    const existing = await withRetry(
      async (sql) =>
        sql<Row[]>`
          select id, estimate_id, name, total_sum, priced_count, total_count,
                 stage, reminders_sent, next_reminder_at, created_at, updated_at
            from proposal_log where estimate_id = ${input.estimateId} limit 1
        `,
      { label: "чтение строки журнала" },
    );
    if (!existing.length) throw new Error("не удалось записать КП в журнал");
    return map(existing[0]);
  }

  return map(rows[0]);
}

/** Последние записи журнала — для страницы менеджера и отчётов. */
export async function listProposals(limit = 50): Promise<ProposalLogEntry[]> {
  const safe = Math.min(Math.max(limit, 1), 200);
  const rows = await withRetry(
    async (sql) =>
      sql<Row[]>`
        select id, estimate_id, name, total_sum, priced_count, total_count,
               stage, reminders_sent, next_reminder_at, created_at, updated_at
          from proposal_log
         order by created_at desc
         limit ${safe}
      `,
    { label: "список журнала" },
  );
  return rows.map(map);
}

/**
 * Забирает КП, которым пора напомнить, и сдвигает срок.
 *
 * Одна операция UPDATE ... RETURNING: два одновременных вызова n8n не
 * получат одно и то же КП. Если разнести чтение и обновление на два
 * запроса, между ними успевает влезть второй вызов — а пулер Neon рвёт
 * соединение, и «между запросами» здесь не теоретическое место.
 *
 * После последнего напоминания next_reminder_at становится null, и
 * строка выпадает из выборки навсегда. Клиентов без ответа не дёргаем
 * бесконечно: два напоминания — предел вежливости.
 */
export async function takeDueReminders(limit = 20): Promise<ProposalLogEntry[]> {
  const safe = Math.min(Math.max(limit, 1), 50);

  const rows = await withRetry(
    async (sql) =>
      sql<Row[]>`
        update proposal_log
           set reminders_sent = reminders_sent + 1,
               stage = case when stage = 'sent' then 'reminded' else stage end,
               next_reminder_at = case
                 when reminders_sent + 1 >= ${REMINDER_DELAYS_HOURS.length} then null
                 else now() + (${REMINDER_DELAYS_HOURS[1]} || ' hours')::interval
               end,
               updated_at = now()
         where id in (
           select id from proposal_log
            where stage in ('sent', 'reminded')
              and next_reminder_at is not null
              and next_reminder_at <= now()
            order by next_reminder_at
            limit ${safe}
         )
        returning id, estimate_id, name, total_sum, priced_count, total_count,
                  stage, reminders_sent, next_reminder_at, created_at, updated_at
      `,
    { label: "выдача напоминаний" },
  );

  return rows.map(map);
}

/**
 * Меняет стадию сделки руками — менеджер отметил, что клиент ответил
 * или отказался.
 *
 * При закрытии снимаем запланированное напоминание: писать «вы не
 * ответили» человеку, который уже ответил, — худшее, что может сделать
 * автоматизация.
 */
export async function setStage(
  id: number,
  stage: ProposalStage,
  note?: string,
): Promise<ProposalLogEntry | null> {
  if (!PROPOSAL_STAGES.includes(stage)) {
    throw new Error(`неизвестная стадия: ${stage}`);
  }

  const closing = stage === "closed" || stage === "lost";

  const rows = await withRetry(
    async (sql) =>
      sql<Row[]>`
        update proposal_log
           set stage = ${stage},
               note = coalesce(${note ?? null}, note),
               closed_at = case when ${closing} then now() else closed_at end,
               next_reminder_at = case when ${closing} then null else next_reminder_at end,
               updated_at = now()
         where id = ${id}
        returning id, estimate_id, name, total_sum, priced_count, total_count,
                  stage, reminders_sent, next_reminder_at, created_at, updated_at
      `,
    { label: "смена стадии" },
  );

  return rows.length ? map(rows[0]) : null;
}

/** Сводка для отчёта: воронка по стадиям и сумма. */
export interface FunnelRow {
  stage: ProposalStage;
  count: number;
  sum: number;
}

export async function funnel(): Promise<FunnelRow[]> {
  const rows = await withRetry(
    async (sql) =>
      sql<{ stage: string; n: number; total: string }[]>`
        select stage, count(*)::int as n, coalesce(sum(total_sum), 0)::text as total
          from proposal_log
         group by stage
      `,
    { label: "воронка" },
  );

  return rows.map((r) => ({
    stage: r.stage as ProposalStage,
    count: r.n,
    sum: Number(r.total),
  }));
}
