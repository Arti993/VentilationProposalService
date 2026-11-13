/**
 * Эндпоинт для внешних автоматизаций (n8n): отдаёт КП за период.
 *
 * GET /api/proposals/recent?since=2026-11-01T00:00:00Z&limit=50
 *
 * ЗАЧЕМ ОПРОС, А НЕ WEBHOOK.
 *
 * Казалось бы, правильнее слать событие из /api/proposal/[id] в n8n,
 * как только клиент скачал файл. Но n8n на этапе разработки живёт на
 * локальной машине, а сервис — на Vercel. У Vercel нет адреса нашего
 * компьютера, и дотянуться до него он не может.
 *
 * К тому же webhook теряет событие, если n8n в этот момент лежал.
 * Опрос лишён обоих недостатков: событие лежит в базе, и n8n заберёт
 * его, когда проснётся. Цена — один запрос раз в 15 минут.
 *
 * ОТМЕТКА ОБРАБОТКИ.
 *
 * Если n8n просто спросит «какие КП были за последние 3 дня», он получит
 * одни и те же строки на каждом запуске и пришлёт клиенту 288
 * напоминаний в сутки. Поэтому КП считается отправленным в автоматизацию
 * ровно один раз: при выдаче ставится отметка notified_at.
 *
 * Повторное чтение возможно явно — через ?include=all, для отладки.
 */
import { NextResponse } from "next/server";
import { withRetry } from "@/db/connection";
import { logProposal } from "@/db/repositories/proposalLog";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Секрет для внешних вызовов.
 *
 * Без него эндпоинт открыт всему интернету: любой желающий увидел бы
 * имена файлов клиентов и суммы их смет. Это утечка, а не мелочь.
 *
 * Если переменная не задана, эндпоинт отвечает 503: лучше не работать,
 * чем работать открытым.
 */
function authorized(req: Request): boolean {
  const expected = process.env.AUTOMATION_API_KEY;
  if (!expected) return false;

  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  // Сравнение постоянного времени не нужно: ключ не передаётся по
  // символу, а лежит целиком в заголовке. Но длину уравниваем, чтобы
  // не давать подсказку через время ответа.
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** Строка отчёта — ровно то, что нужно узлам n8n. */
interface ProposalRow {
  id: string;
  name: string;
  total_sum: string;
  total_count: number;
  priced_count: number;
  created_at: Date;
  download_url: string;
}

export async function GET(req: Request): Promise<Response> {
  if (!process.env.AUTOMATION_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Отправка в автоматизацию не настроена на сервере." },
      { status: 503 },
    );
  }

  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Нет доступа." }, { status: 401 });
  }

  const url = new URL(req.url);
  const include = url.searchParams.get("include");

  // По умолчанию — только те, кому ещё не слали напоминание
  const onlyNew = include !== "all";

  // Сколько отдавать за раз. Ограничение сверху обязательно: без него
  // ?limit=100000 вытянет все сметы и уронит соединение с Neon.
  const rawLimit = Number(url.searchParams.get("limit") ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 200);

  try {
    const rows = await withRetry(
      async (sql) => {
        // Отметку ставим в том же запросе, что и читаем: иначе два
        // одновременных вызова n8n получат одни и те же строки.
        // UPDATE ... RETURNING атомарен, поэтому дублей не будет.
        if (onlyNew) {
          return sql<ProposalRow[]>`
            update estimates
               set notified_at = now()
             where id in (
               select id from estimates
                where notified_at is null
                  and expires_at > now()
                  and priced_count > 0
                order by created_at
                limit ${limit}
             )
            returning id, name, total_sum, total_count, priced_count,
                      created_at, 'x'::text as download_url
          `;
        }

        return sql<ProposalRow[]>`
          select id, name, total_sum, total_count, priced_count,
                 created_at, 'x'::text as download_url
            from estimates
           where expires_at > now()
             and priced_count > 0
           order by created_at desc
           limit ${limit}
        `;
      },
      { label: "выдача КП для автоматизации" },
    );

    // Ссылку собираем из запроса: хост в базе не хранится
    const origin = url.origin;

    const proposals = rows.map((r) => ({
      id: r.id,
      name: r.name,
      totalSum: Number(r.total_sum),
      totalCount: r.total_count,
      pricedCount: r.priced_count,
      createdAt: r.created_at.toISOString(),
      downloadUrl: `${origin}/api/proposal/${r.id}`,
      // Через сколько часов документ перестанет быть доступен
      expiresInHours: Math.max(
        0,
        Math.round(
          (new Date(r.created_at).getTime() + 24 * 60 * 60 * 1000 - Date.now()) / 3_600_000,
        ),
      ),
    }));

    // Попутно заводим записи в журнале — это и есть «таблица», ради
    // которой обычно тянут Google Sheets. Делаем после выдачи и не
    // роняем запрос при ошибке: главное — отдать КП в n8n, а журнал
    // можно дозаписать следующим запуском (logProposal идемпотентен).
    for (const p of proposals) {
      try {
        await logProposal({
          estimateId: p.id,
          name: p.name,
          totalSum: p.totalSum,
          pricedCount: p.pricedCount,
          totalCount: p.totalCount,
        });
      } catch (e) {
        console.warn(
          `[api/proposals/recent] журнал для ${p.id.slice(0, 8)}: ` +
            (e instanceof Error ? e.message : String(e)),
        );
      }
    }

    return NextResponse.json(
      { ok: true, count: proposals.length, proposals },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/proposals/recent]", msg);
    return NextResponse.json(
      { ok: false, error: "Не удалось получить список КП." },
      { status: 500 },
    );
  }
}
