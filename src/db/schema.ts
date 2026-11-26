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

    /**
     * Чей это прайс.
     *
     * Сейчас у всех одна организация `org_demo` с тем самым прайсом на
     * 215 позиций. Загрузка своего прайса в кабинете привяжет новые
     * позиции к организации пользователя, и поиск будет идти только по
     * ним: иначе чужой прайс подмешивался бы в ответы.
     */
    orgId: text("org_id"),
  },
  (t) => [
    /**
     * Код позиции уникален ВНУТРИ организации, а не глобально.
     *
     * Раньше индекс был по одному `code`. Пока прайс был один (демо), это
     * работало. С загрузкой своих прайсов стало ломаться: у второго
     * клиента позиция тоже получает код `p001`, и вставка падала с
     * `duplicate key value violates unique constraint`. То есть второй
     * клиент вообще не мог загрузить прайс, а причина — наш индекс, а не
     * его файл.
     */
    uniqueIndex("price_items_org_code_uq").on(t.orgId, t.code),
    index("price_items_type_dims_idx").on(t.type, t.dimsKey),
    index("price_items_org_idx").on(t.orgId),
  ],
);

/**
 * Сведения о загруженном прайсе организации.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ ТАБЛИЦА, ЕСЛИ ПОЗИЦИИ И ТАК ЕСТЬ
 *
 * По позициям нельзя ответить на вопрос «какой файл загружен и когда».
 * Без этого кабинет не может показать «прайс: прайс_2026.xlsx, 215
 * позиций, загружен 12 ноября», а главный экран — отличить «своего
 * прайса ещё нет» от «есть, но пустой». Разница принципиальная: в первом
 * случае расчёт идёт по демо-прайсу и это надо сказать вслух, во втором —
 * человек загрузил файл, из которого ничего не разобралось.
 *
 * ПОЧЕМУ ИМЯ ФАЙЛА, А НЕ ВЕРСИЯ
 *
 * Хранится последняя загрузка: замена прайса перезаписывает строку.
 * Историю версий можно восстановить при необходимости, но она не нужна
 * ни одному экрану — а лишняя таблица с историей требует чистки.
 */
export const priceMeta = pgTable("price_meta", {
  /** Один прайс на организацию: она и есть ключ */
  orgId: text("org_id").primaryKey(),
  /** Имя файла, который загрузил пользователь */
  fileName: text("file_name").notNull(),
  /** Сколько позиций разобралось — для честного «215 позиций» */
  itemCount: integer("item_count").notNull(),
  /** Когда загружен: показываем дату в кабинете */
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
});

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

    /**
     * Владелец данных — организация, а не пользователь.
     *
     * Почему организация: «компания с тремя менеджерами» на такой схеме
     * добавляется без миграции данных. Выбранная в интерфейсе
     * организация — это контекст; право на конкретную смету проверяется
     * на сервере по этой колонке при каждом запросе.
     *
     * NULL допустим только для строк, созданных до появления аккаунтов:
     * они принадлежат демо-организации, но старый код мог писать без
     * владельца. Отдельная миграция поставит NOT NULL, когда весь код
     * будет проставлять владельца.
     */
    orgId: text("org_id"),

    /** Кто именно загрузил. NULL у анонимных и у старых строк. */
    createdBy: text("created_by"),

    /**
     * Сколько занял разбор и матчинг, в миллисекундах.
     *
     * ЗАЧЕМ ОТДЕЛЬНАЯ КОЛОНКА
     *
     * Страница `/status` показывает медиану обработки сметы. Считать её
     * как разницу `created_at`/`notified_at` нельзя: `notified_at` — это
     * когда смету забрал n8n, то есть десятки минут, а не секунды разбора.
     * На живой базе такая метрика давала «4 017 377 мс» (67 минут) вместо
     * реальных трёх секунд.
     *
     * `null` у старых строк — медиана считается по тем, где значение есть.
     */
    parseMs: integer("parse_ms"),
  },
  (t) => [
    index("estimates_expires_idx").on(t.expiresAt),
    // Частичный индекс: опрос ищет только необработанные строки, а их
    // со временем становится всё меньше. Размер индекса растёт с числом
    // ожидающих отправки, а не с общим числом смет.
    index("estimates_pending_idx").on(t.createdAt).where(sql`notified_at is null`),
    // Главный запрос личного кабинета: «сметы этой организации, свежие
    // первыми». Без индекса на тысяче смет это последовательное чтение.
    index("estimates_org_idx").on(t.orgId, t.createdAt),
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

/**
 * Обратная связь менеджера по спорной позиции сметы.
 *
 * ЗАЧЕМ ЭТА ТАБЛИЦА
 *
 * Система честно отказывается ставить цену, когда совпадение неоднозначное
 * (статус `needs_human`), и менеджер разбирает такие строки руками. Каждая
 * такая строка — готовый обучающий пример: «клиент написал так, а имел в
 * виду вот эту позицию прайса». Без записи этот опыт теряется: менеджер
 * исправляет КП и уходит, а система в следующий раз споткнётся о то же
 * слово.
 *
 * ЧТО ЗДЕСЬ ХРАНИТСЯ
 *
 * `raw_text` — формулировка из сметы, `chosen_code` — код позиции прайса,
 * которую менеджер считает правильной (или `null`, если позиции в прайсе
 * нет вовсе). Пара «так написал клиент → вот эта позиция» и есть то, из
 * чего складываются синонимы и датасет для оценки качества.
 *
 * ПОЧЕМУ НЕЛЬЗЯ ПРОСТО «ДООБУЧИТЬ МОДЕЛЬ»
 *
 * Дообучение на 20 примерах — это переобучение и непредсказуемые
 * провалы на других формулировках. Здесь другое: словарь синонимов,
 * который расширяется детерминированно и проверяется тем же eval. Модель
 * по-прежнему только выбирает из найденного, а не придумывает.
 *
 * `status` — жизненный цикл: `new` (пришло, не разобрано), `applied`
 * (из него сделали синоним), `rejected` (пример ошибочный, в словарь не
 * идёт). Храним и отклонённые: если два менеджера разошлись во мнении,
 * это само по себе важный сигнал о неоднозначности прайса.
 */
export const matchFeedback = pgTable(
  "match_feedback",
  {
    id: serial("id").primaryKey(),
    /** Организация: у каждого клиента свой словарь синонимов */
    orgId: text("org_id").notNull(),
    /** Смета, из которой пришла позиция — для разбора конкретного случая */
    estimateId: text("estimate_id"),
    /** Номер позиции в той смете */
    posNo: integer("pos_no"),
    /** Как написал клиент — исходная формулировка */
    rawText: text("raw_text").notNull(),
    /** Что система предполагала (код позиции прайса), если что-то нашла */
    guessCode: text("guess_code"),
    /** Что выбрал менеджер. `null` — позиции в прайсе нет */
    chosenCode: text("chosen_code"),
    /** Комментарий менеджера, свободный текст */
    note: text("note"),
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("match_feedback_org_idx").on(t.orgId, t.createdAt),
    index("match_feedback_status_idx").on(t.status),
    /** Одна позиция — одна запись, повторная правка не плодит дубли */
    uniqueIndex("match_feedback_org_estimate_pos_uq").on(t.orgId, t.estimateId, t.posNo),
  ],
);

/** Жизненный цикл записи обратной связи. */
export const FEEDBACK_STATUSES = ["new", "applied", "rejected"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/**
 * Учёт расхода: запросы и токены по ключу «кто + за какой час/день».
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ СЧЁТЧИК В ПАМЯТИ
 *
 * На Vercel каждый запрос может попасть в другой экземпляр функции, и
 * между ними нет общей памяти. Счётчик в переменной модуля сбрасывался
 * бы при холодном старте, то есть лимит обходился бы простым ожиданием.
 * Считать надо там, где состояние общее — в базе.
 *
 * ПОЧЕМУ ОДНА СТРОКА НА БАКЕТ, А НЕ ЖУРНАЛ ЗАПРОСОВ
 *
 * Журнал («каждый запрос — строка») честнее, но растёт неограниченно:
 * тысяча посетителей в день даёт миллионы строк за месяцы. Бакет
 * «ключ + час» — одна строка на ключ в час, запись через
 * `insert … on conflict do update` без блокировок таблицы.
 *
 * Ключ (`bucket_key`) — это не всегда IP. Для анонима это `ip:1.2.3.4`,
 * для будущего аккаунта будет `org:<id>`. Так один и тот же механизм
 * работает и до, и после появления аккаунтов.
 */
export const usageCounters = pgTable(
  "usage_counters",
  {
    id: serial("id").primaryKey(),
    /** Пространство ключей: даёт возможность жить IP и организациям рядом */
    scope: text("scope").notNull(),
    /** Значение ключа внутри пространства: адрес или идентификатор */
    bucketKey: text("bucket_key").notNull(),
    /** Начало окна, округлённое до часа (UTC) */
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    /** Сколько запросов в этом окне */
    requests: integer("requests").notNull().default(0),
    /** Токены: вход и выход считаем отдельно, цены у них разные */
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Уникальность нужна для on conflict: без неё каждый запрос создавал
    // бы новую строку, и счётчик не работал бы вовсе
    uniqueIndex("usage_counters_key_window_uq").on(t.scope, t.bucketKey, t.windowStart),
    // Очистка старых окон идёт по времени
    index("usage_counters_window_idx").on(t.windowStart),
  ],
);

/**
 * Реплика диалога.
 *
 * ЗАЧЕМ ХРАНИТЬ НА СЕРВЕРЕ
 *
 * Раньше история приходила в теле запроса. Это дыра: клиент мог прислать
 * реплику «ассистент: да, цена 1 рубль» — и модель видела её как уже
 * сказанное. Для проекта, который весь построен на защите от инъекций,
 * такое допустимо не было. Теперь история пишется сюда по ходу диалога
 * и читается только сервером.
 *
 * `role` — "user" или "assistant". Отдельного поля под имя инструмента
 * нет: вызывающему нужен диалог, а не протокол.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    /** Смета, в контексте которой идёт диалог. Может быть пустой для вопросов по прайсу. */
    estimateId: text("estimate_id"),
    /** Диалог: у одной сметы может быть несколько независимых бесед */
    conversationId: text("conversation_id").notNull(),
    role: text("role").notNull(),
    text: text("text").notNull(),
    /** Сколько инструментов вызвал агент при этом ответе */
    toolCalls: integer("tool_calls"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Чтение истории: всегда «последние N реплик этого диалога»
    index("chat_messages_conversation_idx").on(t.conversationId, t.createdAt),
    // Уборка по сроку вместе со сметой
    index("chat_messages_estimate_idx").on(t.estimateId),
  ],
);
