/**
 * Ограничение частоты запросов и дневные квоты.
 *
 * ПРОБЛЕМА, КОТОРУЮ ЭТО РЕШАЕТ
 *
 * До этого слоя `/api/chat` и `/api/estimate` были открыты всем без
 * счёта. Один цикл `for i in {1..10000}; do curl …` сжигал деньги на
 * polza.ai. Для публичной ссылки в резюме это не «недоработка», а дыра.
 *
 * ПОЧЕМУ НЕ UPCASH RATELIMIT
 *
 * Upstash — правильный выбор для распределённого лимитера, но он
 * добавляет внешний сервис, сетевой вызов в горячем пути и ещё один
 * ключ в окружении. Здесь уже есть Postgres: одна строка на
 * «ключ + час» пишется одним `insert … on conflict do update` без
 * блокировки таблицы. При росте это меняется на Upstash за полчаса —
 * интерфейс функции `consume()` останется тем же.
 *
 * ПОЧЕМУ СЧЁТЧИК В БАЗЕ, А НЕ В ПАМЯТИ
 *
 * На Vercel каждый запрос может попасть в другой экземпляр функции.
 * Счётчик в переменной модуля сбрасывался бы при холодном старте, то
 * есть лимит обходился бы простым ожиданием.
 *
 * ДВА ОГРАНИЧЕНИЯ, А НЕ ОДНО
 *
 *   1. Частота: N запросов в час на адрес — защита от скрипта.
 *   2. Квота: M токенов в сутки на адрес — защита от «медленного
 *      разорения», когда скрипт укладывается в частоту, но каждый
 *      запрос тянет 40 000 токенов контекста.
 *
 * Одно без другого бессмысленно.
 */
import { withRetry } from "../../db/connection.ts";

/** Пространства ключей. Строкой, а не enum — как стадии сделок в схеме. */
export type UsageScope = "ip" | "org";

export interface LimitDecision {
  allowed: boolean;
  /** Почему отказано — текст для пользователя, не для лога */
  reason?: string;
  /** Сколько запросов осталось в текущем окне. -1 — неизвестно. */
  remaining: number;
  /** Когда окно обнулится */
  resetAt: Date;
  /** Код ответа, который стоит вернуть */
  status?: number;
  /** Заголовки для ответа: клиент видит лимиты, не читая документацию */
  headers: Record<string, string>;
}

/**
 * Настройки лимитов.
 *
 * Значения подобраны так, чтобы живой человек не упирался в них никогда,
 * а скрипт упирался сразу. 30 вопросов агенту в час — больше, чем
 * менеджер задаёт за смену. 20 загрузок смет в час — больше, чем он
 * загружает за день.
 *
 * Переопределяются переменными окружения: на демо лимиты можно поднять,
 * не трогая код и не пересобирая проект.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const LIMITS = {
  /** Вопросов агенту в час с одного адреса */
  chatPerHour: () => envInt("LIMIT_CHAT_PER_HOUR", 30),
  /** Загрузок смет в час с одного адреса */
  uploadsPerHour: () => envInt("LIMIT_UPLOADS_PER_HOUR", 20),
  /** Токенов LLM в сутки с одного адреса */
  tokensPerDay: () => envInt("LIMIT_TOKENS_PER_DAY", 400_000),
} as const;

const HOUR_MS = 60 * 60 * 1000;

/** Начало часового окна: округляем вниз, чтобы окна были выровнены */
function hourStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
}

/** Начало суток по UTC: чтобы не зависеть от часового пояса экземпляра функции */
function dayStart(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Достаёт адрес клиента из заголовков.
 *
 * На Vercel настоящий адрес приходит первым элементом `x-forwarded-for`.
 * `x-real-ip` — запасной вариант для других прокси.
 *
 * ОГОВОРКА: заголовок подделывается клиентом, если запрос идёт не через
 * прокси. На Vercel прокси перезаписывает его, поэтому полагаться можно.
 * При локальном запуске без прокси лимит обходится подменой заголовка —
 * это приемлемо: локально жалеть нечего.
 */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

/** Поля счётчика, которые можно увеличивать */
type CounterField = "requests" | "tokens_in" | "tokens_out";

const COLUMN: Record<CounterField, string> = {
  requests: "requests",
  tokens_in: "tokens_in",
  tokens_out: "tokens_out",
};

/**
 * Прибавляет amount к счётчику окна. Возвращает новое значение.
 *
 * Один запрос на всё: `insert … on conflict do update … returning`.
 * Так счётчик атомарен без транзакции — а транзакции через пулер Neon
 * ненадёжны, см. комментарий в proposalLog.ts.
 */
async function bump(
  scope: UsageScope,
  key: string,
  windowStart: Date,
  field: CounterField,
  amount: number,
): Promise<number> {
  const col = COLUMN[field];

  return withRetry(
    async (sql) => {
      const rows = await sql<{ value: number }[]>`
        insert into usage_counters (scope, bucket_key, window_start, ${sql(col)})
        values (${scope}, ${key}, ${windowStart}, ${amount})
        on conflict (scope, bucket_key, window_start)
        do update set ${sql(col)} = usage_counters.${sql(col)} + ${amount},
                      updated_at = now()
        returning ${sql(col)} as value
      `;
      return Number(rows[0]?.value ?? amount);
    },
    { label: "счётчик лимита" },
  );
}

/** Текущее значение счётчика без записи. 0, если строки нет. */
async function read(
  scope: UsageScope,
  key: string,
  windowStart: Date,
  field: CounterField,
): Promise<number> {
  const col = COLUMN[field];

  return withRetry(
    async (sql) => {
      const rows = await sql<{ value: number }[]>`
        select ${sql(col)} as value
        from usage_counters
        where scope = ${scope}
          and bucket_key = ${key}
          and window_start = ${windowStart}
        limit 1
      `;
      return Number(rows[0]?.value ?? 0);
    },
    { label: "чтение лимита" },
  );
}

interface ConsumeOptions {
  /** Что вызывают: определяет лимит частоты */
  action: "chat" | "upload";
  scope?: UsageScope;
  key: string;
  /** Тратить ли запрос из часового лимита. Квота токенов проверяется всегда. */
  countRequest?: boolean;
}

/**
 * Проверяет оба лимита и, если можно, списывает один запрос.
 *
 * Порядок важен: сначала проверяем оба, потом списываем. Если списать
 * до проверки, отказанный запрос всё равно съест квоту — пользователь
 * получит отказ и увидит, что счётчик уменьшился непонятно почему.
 *
 * ПОВЕДЕНИЕ ПРИ НЕДОСТУПНОЙ БАЗЕ — fail-open.
 *
 * Осознанный выбор: лимитер защищает деньги, база — сам продукт.
 * Уронить сервис целиком из-за сломанного счётчика хуже, чем пропустить
 * лишний запрос. Отказ логируем.
 */
export async function consume(opts: ConsumeOptions): Promise<LimitDecision> {
  const now = new Date();
  const scope = opts.scope ?? "ip";
  const windowAt = hourStart(now);
  const resetAt = new Date(windowAt.getTime() + HOUR_MS);
  const dayAt = dayStart(now);

  const perHour =
    opts.action === "chat" ? LIMITS.chatPerHour() : LIMITS.uploadsPerHour();

  const headersBase: Record<string, string> = {
    "X-RateLimit-Limit": String(perHour),
    "X-RateLimit-Reset": String(Math.floor(resetAt.getTime() / 1000)),
  };

  try {
    const [requestsSoFar, tokensIn, tokensOut] = await Promise.all([
      read(scope, opts.key, windowAt, "requests"),
      read(scope, opts.key, dayAt, "tokens_in"),
      read(scope, opts.key, dayAt, "tokens_out"),
    ]);

    // ── 1. Дневная квота токенов ──────────────────────────
    const tokenBudget = LIMITS.tokensPerDay();
    if (tokensIn + tokensOut >= tokenBudget) {
      const nextDay = new Date(dayAt);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      return {
        allowed: false,
        status: 429,
        reason:
          "Дневной лимит на ассистента исчерпан. Он обновится в 00:00 UTC — это около трёх часов ночи по Москве.",
        remaining: 0,
        resetAt: nextDay,
        headers: {
          ...headersBase,
          "X-RateLimit-Remaining": "0",
          "Retry-After": String(
            Math.max(1, Math.ceil((nextDay.getTime() - now.getTime()) / 1000)),
          ),
        },
      };
    }

    // ── 2. Частота запросов ───────────────────────────────
    if (opts.countRequest !== false && requestsSoFar >= perHour) {
      return {
        allowed: false,
        status: 429,
        reason: `Слишком много запросов подряд. Лимит — ${perHour} в час, следующий можно будет сделать в ${resetAt.toISOString().slice(11, 16)} UTC.`,
        remaining: 0,
        resetAt,
        headers: {
          ...headersBase,
          "X-RateLimit-Remaining": "0",
          "Retry-After": String(
            Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
          ),
        },
      };
    }

    // ── 3. Списываем только после успешной проверки ───────
    let remaining = Math.max(0, perHour - requestsSoFar);
    if (opts.countRequest !== false) {
      const used = await bump(scope, opts.key, windowAt, "requests", 1);
      remaining = Math.max(0, perHour - used);
    }

    return {
      allowed: true,
      remaining,
      resetAt,
      headers: {
        ...headersBase,
        "X-RateLimit-Remaining": String(remaining),
      },
    };
  } catch (e) {
    // fail-open: см. комментарий выше
    console.error(
      "[limits] счётчик недоступен, лимит не применён:",
      e instanceof Error ? e.message : e,
    );
    return {
      allowed: true,
      remaining: -1,
      resetAt,
      headers: { ...headersBase, "X-RateLimit-Remaining": "-1" },
    };
  }
}

/**
 * Записывает израсходованные токены.
 *
 * Вызывается ПОСЛЕ ответа модели: до вызова неизвестно, сколько она
 * потратит. Поэтому квота может быть превышена на один запрос — это
 * нормально и не требует блокировки.
 */
export async function recordTokens(
  key: string,
  tokensIn: number,
  tokensOut: number,
  scope: UsageScope = "ip",
): Promise<void> {
  if (tokensIn <= 0 && tokensOut <= 0) return;
  const dayAt = dayStart(new Date());

  try {
    if (tokensIn > 0) {
      await bump(scope, key, dayAt, "tokens_in", Math.round(tokensIn));
    }
    if (tokensOut > 0) {
      await bump(scope, key, dayAt, "tokens_out", Math.round(tokensOut));
    }
  } catch (e) {
    console.error(
      "[limits] не удалось записать токены:",
      e instanceof Error ? e.message : e,
    );
  }
}

/** Текущий расход — для страницы статуса и для отладки. */
export async function usageSnapshot(
  key: string,
  scope: UsageScope = "ip",
): Promise<{ requestsThisHour: number; tokensToday: number; tokenBudget: number }> {
  const now = new Date();
  const budget = LIMITS.tokensPerDay();
  try {
    const [requests, tokensIn, tokensOut] = await Promise.all([
      read(scope, key, hourStart(now), "requests"),
      read(scope, key, dayStart(now), "tokens_in"),
      read(scope, key, dayStart(now), "tokens_out"),
    ]);
    return {
      requestsThisHour: requests,
      tokensToday: tokensIn + tokensOut,
      tokenBudget: budget,
    };
  } catch {
    return { requestsThisHour: 0, tokensToday: 0, tokenBudget: budget };
  }
}

/**
 * Удаляет окна старше двух суток.
 *
 * Вызывается попутно при загрузке сметы, а не по таймеру: на Vercel нет
 * фонового процесса, а отдельный крон ради одной строки дороже. Если
 * уборка не случится, таблица просто вырастет — чтение всё равно идёт
 * по индексу конкретного окна.
 */
export async function pruneOldCounters(): Promise<number> {
  const cutoff = new Date(Date.now() - 48 * HOUR_MS);
  try {
    return await withRetry(
      async (sql) => {
        const rows = await sql<{ id: number }[]>`
          delete from usage_counters
          where window_start < ${cutoff}
          returning id
        `;
        return rows.length;
      },
      { label: "уборка счётчиков" },
    );
  } catch {
    return 0;
  }
}
