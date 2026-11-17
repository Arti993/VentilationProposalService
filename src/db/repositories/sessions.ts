/**
 * Репозиторий сессий смет.
 *
 * Заменяет хранилище в памяти, которое теряло данные при холодном старте
 * и не разделялось между инстансами Vercel.
 *
 * Ключевое свойство: клиент присылает только id. Все данные сметы
 * читаются из БД — подменить цены в запросе невозможно.
 *
 * ОСОБЕННОСТЬ NEON: соединение живёт 4-5 запросов. Поэтому:
 *  - запись: две операции (шапка + позиции), каждая своим соединением;
 *  - чтение: две операции (шапка + позиции), можно параллельно.
 * Транзакция тут не нужна: если упадёт вторая операция, шапка без позиций
 * не пройдёт проверку количества и сессия не считается валидной.
 */
import { withRetry } from "../connection.ts";
import { isDemoOrg } from "../../lib/auth/org.ts";
import type {
  EstimateSession,
  EstimatePosition,
  PositionStatus,
} from "../../entities/estimate/model/types.ts";

/** Время жизни анонимной сессии: 24 часа. */
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Время жизни сметы организации: год.
 *
 * Дольше, чем у анонима, и это осознанно: «моя работа пропала за ночь» —
 * не то, чего ждут от личного кабинета. Год, а не «вечно»: хранить чужие
 * коммерческие данные бессрочно — ответственность, а не удобство.
 */
const ORG_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function num(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

interface HeadRow {
  id: string;
  name: string;
  total_sum: string;
  total_count: number;
  priced_count: number;
  not_found_count: number;
  needs_human_count: number;
  off_topic_count: number;
  created_at: Date;
  expires_at: Date;
  org_id: string | null;
}

interface PositionRow {
  pos_no: number;
  line_no: number;
  name: string;
  qty: string;
  unit: string | null;
  status: string;
  unit_price: string | null;
  total: string | null;
  matched_name: string | null;
  reason: string | null;
  source: string | null;
  confidence: string | null;
}

/** Владелец сохраняемой сметы. */
export interface SessionOwner {
  /** Организация — владелец данных */
  orgId: string;
  /** Пользователь, если он вошёл. NULL у анонимных. */
  userId?: string | null;
}

/**
 * Сохраняет сессию: шапка и позиции двумя запросами.
 *
 * `owner` обязателен. Разница между «не передали владельца» и «передали
 * демо-организацию» — это разница между потерей данных и нормальной
 * работой, поэтому параметр не имеет значения по умолчанию: забыть его
 * должно быть нельзя, а не «тихо получится демо».
 */
export async function saveSession(
  id: string,
  session: EstimateSession,
  owner: SessionOwner,
  /**
   * Сколько занял разбор и матчинг, мс.
   *
   * Необязателен, потому что не все вызывающие могут его посчитать
   * (скрипты наполнения тестовых данных разбора не делают). У страницы
   * `/status` это главная метрика, поэтому основной путь его передаёт.
   */
  parseMs?: number,
): Promise<void> {
  // Срок зависит от владельца: демо-данные убираем быстро, данные
  // организации живут, пока владелец их не удалит.
  const ttl = isDemoOrg(owner.orgId) ? TTL_MS : ORG_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);

  await withRetry(
    async (sql) => {
      await sql`
        insert into estimates (
          id, name, total_sum, total_count, priced_count,
          not_found_count, needs_human_count, off_topic_count, expires_at,
          org_id, created_by, parse_ms
        ) values (
          ${id}, ${session.name}, ${String(session.stats.totalSum)},
          ${session.stats.total}, ${session.stats.priced},
          ${session.stats.notFound}, ${session.stats.needsHuman},
          ${session.stats.offTopic}, ${expiresAt},
          ${owner.orgId}, ${owner.userId ?? null}, ${parseMs ?? null}
        )
      `;
    },
    { label: "сохранение шапки сметы" },
  );

  if (!session.positions.length) return;

  // Позиции вставляем одним запросом с нарезкой по размеру:
  // 50 позиций кириллицей — это ~10 КБ, близко к пределу Neon.
  const CHUNK = 40;
  for (let i = 0; i < session.positions.length; i += CHUNK) {
    const chunk = session.positions.slice(i, i + CHUNK);
    await withRetry(
      async (sql) => {
        await sql`
          insert into estimate_positions ${sql(
            chunk.map((p) => ({
              estimate_id: id,
              pos_no: p.posNo,
              line_no: p.lineNo,
              name: p.name,
              qty: String(p.qty),
              unit: p.unit ?? null,
              status: p.status,
              unit_price: p.unitPrice !== undefined ? String(p.unitPrice) : null,
              total: p.total !== undefined ? String(p.total) : null,
              matched_name: p.matchedName ?? null,
              reason: p.reason ?? null,
              source: p.source ?? null,
              confidence: p.confidence !== undefined ? String(p.confidence) : null,
            })),
            "estimate_id",
            "pos_no",
            "line_no",
            "name",
            "qty",
            "unit",
            "status",
            "unit_price",
            "total",
            "matched_name",
            "reason",
            "source",
            "confidence",
          )}
        `;
      },
      { label: `сохранение позиций ${i / CHUNK + 1}` },
    );
  }
}

/**
 * Читает сессию по id. Возвращает null, если нет, истекла или не
 * принадлежит указанной организации.
 *
 * ПРО ПОСЛЕДНИЙ СЛУЧАЙ
 *
 * id сметы — UUID, угадать его нельзя. Но «нельзя угадать» — не то же
 * самое, что «нельзя узнать»: id попадает в адрес страницы, в историю
 * браузера, в лог прокси, в ссылку, которой поделились. Поэтому при
 * известном `orgId` доступ проверяется явно, а не полагается на
 * секретность идентификатора.
 *
 * Возвращает null, а не «отказ»: для вызывающего кода чужой сметы не
 * существует. Разный ответ на «есть, но чужая» и «нет такой» сам по
 * себе утечка — по нему перебирают существующие id.
 */
export async function getSession(
  id: string,
  orgId?: string,
): Promise<EstimateSession | null> {
  const head = await withRetry(
    async (sql) => {
      const rows = await sql<HeadRow[]>`
        select id, name, total_sum, total_count, priced_count,
               not_found_count, needs_human_count, off_topic_count,
               created_at, expires_at, org_id
          from estimates where id = ${id} limit 1
      `;
      return rows[0];
    },
    { label: "чтение шапки сметы" },
  );

  if (!head) return null;

  if (orgId !== undefined && head.org_id !== orgId) {
    // Не логируем id целиком: этого достаточно, чтобы сопоставить
    // попытки, и недостаточно, чтобы восстановить ссылку из лога.
    console.warn(
      `[sessions] отказ в доступе к смете ${id.slice(0, 8)}… из чужой организации`,
    );
    return null;
  }

  if (head.expires_at.getTime() < Date.now()) {
    await withRetry(
      async (sql) => {
        await sql`delete from estimates where id = ${id}`;
      },
      { label: "удаление истёкшей сессии" },
    );
    return null;
  }

  const positions = await withRetry(
    async (sql) => {
      return sql<PositionRow[]>`
        select pos_no, line_no, name, qty, unit, status, unit_price, total,
               matched_name, reason, source, confidence
          from estimate_positions
         where estimate_id = ${id}
         order by pos_no
      `;
    },
    { label: "чтение позиций" },
  );

  // Проверка целостности: шапка без позиций означает неудачную запись
  if (head.total_count > 0 && positions.length === 0) {
    console.error(`[sessions] сессия ${id} без позиций — считаем недействительной`);
    return null;
  }

  const mapped: EstimatePosition[] = positions.map((p) => ({
    posNo: p.pos_no,
    lineNo: p.line_no,
    name: p.name,
    qty: num(p.qty) ?? 0,
    unit: p.unit ?? undefined,
    status: p.status as PositionStatus,
    unitPrice: num(p.unit_price),
    total: num(p.total),
    matchedName: p.matched_name ?? undefined,
    reason: p.reason ?? undefined,
    source: (p.source as EstimatePosition["source"]) ?? undefined,
    confidence: num(p.confidence),
  }));

  return {
    name: head.name,
    loadedAt: head.created_at.toISOString(),
    positions: mapped,
    stats: {
      total: head.total_count,
      priced: head.priced_count,
      notFound: head.not_found_count,
      needsHuman: head.needs_human_count,
      offTopic: head.off_topic_count,
      totalSum: num(head.total_sum) ?? 0,
      attention: head.not_found_count + head.needs_human_count,
    },
  };
}

/** Удаляет протухшие сессии. */
export async function purgeExpired(): Promise<number> {
  return withRetry(
    async (sql) => {
      const rows = await sql<{ id: string }[]>`
        delete from estimates where expires_at < now() returning id
      `;
      return rows.length;
    },
    { label: "очистка истёкших" },
  );
}
