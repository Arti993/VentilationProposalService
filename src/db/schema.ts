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
} from "drizzle-orm/pg-core";

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
  },
  (t) => [index("estimates_expires_idx").on(t.expiresAt)],
);

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
