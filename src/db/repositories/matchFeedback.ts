/**
 * Обратная связь менеджера по спорным позициям.
 *
 * ЗАЧЕМ ЭТО НУЖНО
 *
 * Система честно отказывается ставить цену, когда совпадение неоднозначное
 * — ошибочный матч дороже отсутствия матча. Такие строки разбирает
 * человек. Но разбор уходит вместе с менеджером: он правит КП и закрывает
 * вкладку, а система в следующий раз спотыкается о то же слово.
 *
 * Здесь этот опыт сохраняется. Каждая запись — пара «как написал клиент →
 * какая позиция прайса имелась в виду». Из пар двух видов пользы:
 *
 * 1. СИНОНИМЫ. Если менеджер сказал, что «воздуховод спиральный» — это
 *    `p015`, то это слово можно добавить в словарь организации, и
 *    детерминированный матчинг начнёт находить его сам, без модели.
 *
 * 2. ДАТАСЕТ ДЛЯ ОЦЕНКИ. Из тех же пар собираются кейсы для `eval.ts`:
 *    «на такой-то формулировке должна найтись такая-то позиция». Это
 *    проверка, что новый синоним не сломал соседние случаи.
 *
 * ПОЧЕМУ НЕ ДООБУЧЕНИЕ МОДЕЛИ
 *
 * Двадцать примеров — это переобучение и непредсказуемые провалы на
 * других формулировках. Словарь синонимов, наоборот, расширяется явно,
 * проверяется eval-ом и в любой момент может быть откатан: видно, какое
 * именно правило дало какой результат.
 */
import { withRetry } from "../connection.ts";

/** Жизненный цикл записи. */
export type FeedbackStatus = "new" | "applied" | "rejected";

export interface FeedbackInput {
  orgId: string;
  estimateId?: string | null;
  posNo?: number | null;
  /** Как написал клиент */
  rawText: string;
  /** Что система предполагала, если что-то нашла */
  guessCode?: string | null;
  /** Что выбрал менеджер. `null` — позиции в прайсе нет */
  chosenCode?: string | null;
  note?: string | null;
}

export interface FeedbackRow {
  id: number;
  orgId: string;
  estimateId: string | null;
  posNo: number | null;
  rawText: string;
  guessCode: string | null;
  chosenCode: string | null;
  note: string | null;
  status: FeedbackStatus;
  createdAt: Date;
}

/** Сырая строка из БД: имена колонок в snake_case. */
interface RawRow {
  id: number;
  org_id: string;
  estimate_id: string | null;
  pos_no: number | null;
  raw_text: string;
  guess_code: string | null;
  chosen_code: string | null;
  note: string | null;
  status: string;
  created_at: Date | string;
}

function toRow(r: RawRow): FeedbackRow {
  return {
    id: r.id,
    orgId: r.org_id,
    estimateId: r.estimate_id,
    posNo: r.pos_no,
    rawText: r.raw_text,
    guessCode: r.guess_code,
    chosenCode: r.chosen_code,
    note: r.note,
    status: r.status as FeedbackStatus,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  };
}

/**
 * Сохраняет разбор менеджера.
 *
 * Повторная правка той же позиции ОБНОВЛЯЕТ запись, а не добавляет вторую.
 * Без этого двойной клик по «сохранить» давал два примера вместо одного, и
 * следующий разбор учитывал бы случай дважды — а словарь, собранный из
 * такого счётчика, вдвое чаще подтверждал бы случайный выбор.
 *
 * ПОЧЕМУ ДВА ПУТИ, А НЕ ОДИН `on conflict`
 *
 * Уникальный индекс `(org_id, estimate_id, pos_no)` работает только когда
 * все три колонки не `null`. В Postgres `null` не равен `null`, поэтому
 * две записи с `estimate_id = null` конфликтом НЕ считаются, и `on conflict`
 * пропускает обе. Это обнаружил тест: вторая правка создавала новую строку
 * вместо обновления.
 *
 * Для записей без сметы (разбор отдельной формулировки, не привязанной к
 * КП) обновляем вручную: сначала ищем по `(org_id, raw_text)` среди строк
 * без сметы и позиции, потом вставляем или обновляем. Неатомарно, но
 * административные разборы не пишутся конкурентно, а потеря одной копии
 * здесь дешевле, чем дубли в словаре.
 */
export async function saveFeedback(input: FeedbackInput): Promise<FeedbackRow> {
  const raw = input.rawText.trim();
  if (!raw) throw new Error("Пустая формулировка: нечего сохранять");

  /**
   * Значения выносим в константы ДО замыкания.
   *
   * Внутри шаблонной строки TypeScript не сохраняет сужение типа после
   * проверки `input.estimateId && input.posNo != null`: вложенная функция
   * может быть вызвана позже, и компилятор считает, что `input` мог
   * измениться. Из-за этого `string | undefined` попадал в параметр тега
   * и сборка падала. Локальные `const` сужение сохраняют.
   */
  const orgId = input.orgId;
  const estimateId = input.estimateId ?? null;
  const posNo = input.posNo ?? null;
  const guessCode = input.guessCode ?? null;
  const chosenCode = input.chosenCode ?? null;
  const note = input.note ?? null;

  // ── Путь 1: запись привязана к позиции сметы ─────────────
  // Здесь уникальный индекс работает: все три колонки не null.
  if (estimateId && posNo != null) {
    const rows = await withRetry(
      (sql) =>
        sql<RawRow[]>`
          insert into match_feedback as f
            (org_id, estimate_id, pos_no, raw_text, guess_code, chosen_code, note, status)
          values
            (${orgId}, ${estimateId}, ${posNo},
             ${raw}, ${guessCode}, ${chosenCode}, ${note}, 'new')
          on conflict (org_id, estimate_id, pos_no) do update
             set raw_text    = excluded.raw_text,
                 guess_code  = excluded.guess_code,
                 chosen_code = excluded.chosen_code,
                 note        = excluded.note,
                 status      = 'new'
           returning *
        `,
      { label: "сохранение обратной связи" },
    );

    if (!rows[0]) throw new Error("Запись не сохранилась");
    return toRow(rows[0]);
  }

  // ── Путь 2: запись без сметы ─────────────────────────────
  // `on conflict` не сработает из-за `null`, поэтому сначала ищем.
  const existing = await withRetry(
    (sql) =>
      sql<RawRow[]>`
        select * from match_feedback
         where org_id = ${orgId}
           and estimate_id is null
           and pos_no is null
           and raw_text = ${raw}
         order by id
         limit 1
      `,
    { label: "поиск существующего разбора" },
  );

  const found = existing[0];
  if (found) {
    const updated = await withRetry(
      (sql) =>
        sql<RawRow[]>`
          update match_feedback
             set guess_code  = ${guessCode},
                 chosen_code = ${chosenCode},
                 note        = ${note},
                 status      = 'new'
           where id = ${found.id} and org_id = ${orgId}
           returning *
        `,
      { label: "обновление разбора" },
    );
    if (updated[0]) return toRow(updated[0]);
  }

  const inserted = await withRetry(
    (sql) =>
      sql<RawRow[]>`
        insert into match_feedback
          (org_id, estimate_id, pos_no, raw_text, guess_code, chosen_code, note, status)
        values
          (${orgId}, null, null, ${raw},
           ${guessCode}, ${chosenCode}, ${note}, 'new')
        returning *
      `,
    { label: "вставка разбора" },
  );

  if (!inserted[0]) throw new Error("Запись не сохранилась");
  return toRow(inserted[0]);
}

/**
 * Записи организации, новые сверху.
 *
 * `status` — фильтр: `undefined` значит «все». Это нужно кабинету, где
 * менеджер сначала смотрит неразобранное, а потом архив.
 */
export async function listFeedback(
  orgId: string,
  options: { status?: FeedbackStatus; limit?: number } = {},
): Promise<FeedbackRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const status = options.status ?? null;

  const rows = await withRetry(
    async (sql) =>
      sql<RawRow[]>`
        select * from match_feedback
         where org_id = ${orgId}
           and (${status}::text is null or status = ${status})
         order by created_at desc
         limit ${limit}
      `,
    { label: "чтение обратной связи" },
  );

  return rows.map(toRow);
}

/**
 * Меняет статус записи.
 *
 * `applied` ставится, когда из записи сделали синоним; `rejected` — когда
 * пример оказался ошибочным. Отклонённые не удаляем: если два менеджера
 * разошлись во мнении, это само по себе сигнал о неоднозначности прайса,
 * и такое стоит видеть, а не терять.
 */
export async function setFeedbackStatus(
  orgId: string,
  id: number,
  status: FeedbackStatus,
): Promise<boolean> {
  const rows = await withRetry(
    async (sql) =>
      sql<{ id: number }[]>`
        update match_feedback
           set status = ${status}
         where org_id = ${orgId} and id = ${id}
         returning id
      `,
    { label: "смена статуса" },
  );
  return rows.length > 0;
}

/**
 * Сводка по организации: сколько чего.
 *
 * Один запрос вместо трёх `count(*)`: на пулере Neon каждый лишний
 * round-trip стоит десятки миллисекунд, а страница статистики открывается
 * часто.
 */
export async function feedbackSummary(
  orgId: string,
): Promise<{ total: number; new: number; applied: number; rejected: number }> {
  const rows = await withRetry(
    async (sql) =>
      sql<{ total: number; new: number; applied: number; rejected: number }[]>`
        select count(*)::int as total,
               count(*) filter (where status = 'new')::int as new,
               count(*) filter (where status = 'applied')::int as applied,
               count(*) filter (where status = 'rejected')::int as rejected
          from match_feedback
         where org_id = ${orgId}
      `,
    { label: "сводка обратной связи" },
  );

  return rows[0] ?? { total: 0, new: 0, applied: 0, rejected: 0 };
}

/**
 * Пары «формулировка → код позиции», из которых строится словарь синонимов.
 *
 * Берём только `applied`: `new` ещё не подтверждено человеком, `rejected`
 * — заведомо неверно. Код должен быть непустым: запись «такой позиции в
 * прайсе нет» полезна для статистики пробелов, но синоним из неё не
 * сделать.
 */
export async function appliedSynonyms(
  orgId: string,
): Promise<Array<{ rawText: string; code: string }>> {
  const rows = await withRetry(
    async (sql) =>
      sql<{ raw_text: string; chosen_code: string }[]>`
        select distinct raw_text, chosen_code
          from match_feedback
         where org_id = ${orgId}
           and status = 'applied'
           and chosen_code is not null
         order by raw_text
      `,
    { label: "чтение синонимов" },
  );

  return rows.map((r) => ({ rawText: r.raw_text, code: r.chosen_code }));
}
