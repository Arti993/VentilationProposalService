/**
 * Схема базы данных.
 *
 * Две группы таблиц:
 *  1. Прайс (price_items) — справочник цен. Заменяет JSON-файл, готовит
 *     почву для RAG: сюда же лягут эмбеддинги.
 *  2. Сметы клиента (estimates + estimate_positions) — сессии работы.
 *     Заменяют Map в памяти, который терялся при холодном старте на Vercel.
 *
 * ВАЖНО про деньги: цены храним в numeric(12,2), а не в float.
 * 0.1 + 0.2 в float не равно 0.3 — для бухгалтерии это недопустимо.
 */
import {
  pgTable,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  serial,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Тип pgvector. Drizzle не имеет встроенной поддержки, объявляем сами.
 *
 * Размерность 1024 — под модель baai/bge-m3 из polza.ai. Менять модель
 * без переиндексации нельзя: размерность вектора зашита в тип колонки.
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1024)";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    const s = String(value).trim();
    return s.slice(1, -1).split(",").map(Number);
  },
});

/**
 * Прайс-лист. Одна строка — одна позиция каталога.
 *
 * Денормализация сознательная: dims и type_detail хранятся как JSON,
 * потому что это результат нормализатора, а не то, по чему мы ищем.
 * Поиск идёт по type + dims_key (строка вида "315/200"), которые
 * индексируются.
 */
export const priceItems = pgTable(
  "price_items",
  {
    /** Внутренний суррогатный ключ */
    id: serial("id").primaryKey(),
    /** Идентификатор из нормализатора: p001, p002… */
    code: text("code").notNull(),
    /** Как позиция называется в прайсе */
    rawName: text("raw_name").notNull(),
    /** Цена за единицу в рублях */
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    /** Тип изделия: duct_spiral, tee, reducer… */
    type: text("type").notNull(),
    /** Отсортированные размеры через дробь: "315/200" — для поиска */
    dimsKey: text("dims_key").notNull(),
    /** Массив размеров как есть */
    dims: jsonb("dims").$type<number[]>().notNull(),
    /** Угол в градусах для отводов */
    angle: integer("angle"),
    /** Исполнение: "R" и подобное */
    variant: text("variant"),
    /** Не удалось разобрать — требует внимания человека */
    unparsed: text("unparsed"),
    /**
     * Вектор названия — для поиска по смыслу.
     *
     * NULL означает «не проиндексировано»: прайс может быть обновлён, а
     * эмбеддинги ещё не посчитаны. RAG должен это переживать и не
     * выдавать пустоту как «ничего не найдено».
     */
    embedding: vector("embedding"),
    /** Когда посчитан эмбеддинг — чтобы находить устаревшие */
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("price_items_code_uq").on(t.code),
    index("price_items_type_dims_idx").on(t.type, t.dimsKey),
  ],
);

/**
 * Загруженная смета клиента.
 *
 * Хранит агрегаты, чтобы отдать сводку одним запросом, и сводку по
 * позициям — для чата. Позиции лежат в отдельной таблице: их может быть
 * сотни, и грузить их в одну JSON-колонку значит терять возможность
 * запросов.
 */
export const estimates = pgTable(
  "estimates",
  {
    /** UUID — он же sessionId для клиента. Угадать нельзя. */
    id: text("id").primaryKey(),
    /** Имя загруженного файла */
    name: text("name").notNull(),
    /** Итоговая сумма по позициям с ценой */
    totalSum: numeric("total_sum", { precision: 14, scale: 2 }).notNull().default("0"),
    totalCount: integer("total_count").notNull().default(0),
    pricedCount: integer("priced_count").notNull().default(0),
    notFoundCount: integer("not_found_count").notNull().default(0),
    needsHumanCount: integer("needs_human_count").notNull().default(0),
    offTopicCount: integer("off_topic_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** Срок жизни: чистим крон-задачей или при чтении */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /**
     * Когда КП отдали внешней автоматизации (n8n).
     *
     * Без этой отметки опрос «что нового» возвращал бы одни и те же
     * сметы на каждом запуске, и клиент получал бы напоминание каждые
     * 15 минут. null — ещё не отдавали.
     */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => [
    index("estimates_expires_idx").on(t.expiresAt),
    // Частичный индекс: опрос ищет только необработанные строки, а их
    // со временем становится всё меньше. Размер индекса растёт с числом
    // ожидающих отправки, а не с общим числом смет.
    index("estimates_pending_idx").on(t.createdAt).where(sql`notified_at is null`),
  ],
);

/**
 * Реестр отправленных КП — журнал для менеджера.
 *
 * Заменяет Google Sheets: та же задача (видеть все КП и их судьбу в одном
 * месте), но без внешнего сервиса, OAuth и ещё одного места, где могут
 * утечь данные клиентов. Плюс данные остаются в той же базе, и по ним
 * можно считать отчёты обычным SQL, не выгружая таблицу.
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ estimates
 *
 * estimates — рабочая сессия с TTL 24 часа, её удаляет очистка.
 * proposal_log — журнал без срока жизни: клиенты возвращаются через
 * недели и месяцы, и история нужна дольше, чем живёт документ.
 *
 * Отдельная таблица, а не поля в estimates, потому что у записи журнала
 * своя жизнь: один и тот же КП может быть отправлен повторно, статус
 * меняется независимо от документа, а удаление сессии не должно стирать
 * историю продаж.
 */
export const proposalLog = pgTable(
  "proposal_log",
  {
    id: serial("id").primaryKey(),
    /** Ссылка на сессию. Не каскадная: журнал переживает удаление сметы. */
    estimateId: text("estimate_id").notNull(),
    /** Название файла клиента на момент отправки */
    name: text("name").notNull(),
    /** Сумма и количество позиций — снимком, как и цены */
    totalSum: numeric("total_sum", { precision: 14, scale: 2 }).notNull(),
    pricedCount: integer("priced_count").notNull(),
    totalCount: integer("total_count").notNull(),

    /**
     * Стадия сделки:
     *   sent      — отправили клиенту, ответа ждём
     *   reminded  — напомнили один раз
     *   closed    — клиент ответил, дальше ведёт менеджер
     *   lost      — отказался или пропал
     *
     * Строкой, а не enum: стадии меняются чаще, чем схема, а ALTER TYPE
     * в Postgres — операция, требующая блокировки. Ограничение ставим
     * проверкой на уровне кода и списком ниже.
     */
    stage: text("stage").notNull().default("sent"),
    /** Сколько напоминаний отправлено: 0, 1, 2. Дальше не дёргаем. */
    remindersSent: integer("reminders_sent").notNull().default(0),
    /** Когда отправлять следующее напоминание. null — не планируется. */
    nextReminderAt: timestamp("next_reminder_at", { withTimezone: true }),
    /** Когда менеджер закрыл сделку */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Комментарий менеджера */
    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Поиск «кому пора напомнить»: идёт по индексу, а не по всей таблице
    index("proposal_log_reminder_idx").on(t.nextReminderAt),
    // УНИКАЛЬНЫЙ, а не обычный: на него опирается on conflict do nothing
    // при записи. Без уникальности повторный запуск сценария создал бы
    // дубль, и клиент получил бы два напоминания об одном КП.
    uniqueIndex("proposal_log_estimate_idx").on(t.estimateId),
    // Отчёты по стадиям и датам
    index("proposal_log_stage_idx").on(t.stage, t.createdAt),
  ],
);

/** Допустимые стадии. Один источник правды для кода и проверок. */
export const PROPOSAL_STAGES = ["sent", "reminded", "closed", "lost"] as const;
export type ProposalStage = (typeof PROPOSAL_STAGES)[number];

/**
 * Позиция сметы.
 *
 * Цены здесь — СНИМОК на момент обработки, а не ссылка на прайс.
 * Если прайс завтра изменится, старое КП не должно «пересчитаться» само:
 * клиенту уже назвали цену. Ссылка на price_item_id остаётся для аудита.
 */
export const estimatePositions = pgTable(
  "estimate_positions",
  {
    id: serial("id").primaryKey(),
    estimateId: text("estimate_id")
      .notNull()
      .references(() => estimates.id, { onDelete: "cascade" }),
    /** Номер позиции в КП: 1, 2, 3… */
    posNo: integer("pos_no").notNull(),
    /** Номер строки в исходном файле */
    lineNo: integer("line_no").notNull(),
    /** Название от клиента */
    name: text("name").notNull(),
    qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
    unit: text("unit"),
    status: text("status").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
    total: numeric("total", { precision: 14, scale: 2 }),
    matchedName: text("matched_name"),
    reason: text("reason"),
    source: text("source"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
  },
  (t) => [index("estimate_positions_estimate_idx").on(t.estimateId, t.posNo)],
);
