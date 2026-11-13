/**
 * Журнал отправленных КП — замена таблицы в Google Sheets.
 *
 * GET   /api/proposals/log            — список для менеджера
 * PATCH /api/proposals/log            — сменить стадию сделки
 * GET   /api/proposals/log?due=1      — кому пора напомнить (для n8n)
 *
 * ПОЧЕМУ СВОЯ ТАБЛИЦА, А НЕ GOOGLE SHEETS
 *
 * Задача одна: видеть все КП и их судьбу в одном месте. Но у таблицы в
 * Postgres три преимущества:
 *  - данные клиентов не уезжают в чужой сервис;
 *  - отчёты считаются SQL, без выгрузки и ручных формул;
 *  - нет OAuth-токена, который нужно хранить и обновлять.
 *
 * Где Google Sheets действительно уместен — когда таблицу заполняют
 * люди, не имеющие доступа к базе. У нас такой задачи нет.
 */
import { NextResponse } from "next/server";
import {
  listProposals,
  takeDueReminders,
  setStage,
  funnel,
} from "@/db/repositories/proposalLog";
import { PROPOSAL_STAGES, type ProposalStage } from "@/db/schema";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Ключ тот же, что у остальных эндпоинтов автоматизации.
 *
 * Журнал содержит имена файлов клиентов и суммы их сделок. Это не
 * публичные данные, поэтому без ключа — 401.
 */
function authorized(req: Request): boolean {
  const expected = process.env.AUTOMATION_API_KEY;
  if (!expected) return false;

  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function unauthorized(): Response {
  if (!process.env.AUTOMATION_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Журнал не настроен на сервере." },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: false, error: "Нет доступа." }, { status: 401 });
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return unauthorized();

  const url = new URL(req.url);

  try {
    // Режим напоминаний: забирает и сдвигает срок одной операцией
    if (url.searchParams.get("due") === "1") {
      const due = await takeDueReminders(Number(url.searchParams.get("limit") ?? 20));
      return NextResponse.json(
        { ok: true, count: due.length, reminders: due },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const [items, stages] = await Promise.all([
      listProposals(Number(url.searchParams.get("limit") ?? 50)),
      funnel(),
    ]);

    return NextResponse.json(
      { ok: true, count: items.length, proposals: items, funnel: stages },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/proposals/log] GET", msg);
    return NextResponse.json({ ok: false, error: "Не удалось прочитать журнал." }, { status: 500 });
  }
}

export async function PATCH(req: Request): Promise<Response> {
  if (!authorized(req)) return unauthorized();

  let body: { id?: unknown; stage?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Ожидается JSON." }, { status: 400 });
  }

  const id = Number(body.id);
  const stage = String(body.stage ?? "");

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Некорректный id." }, { status: 400 });
  }
  if (!PROPOSAL_STAGES.includes(stage as ProposalStage)) {
    return NextResponse.json(
      { ok: false, error: `Стадия должна быть одной из: ${PROPOSAL_STAGES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const updated = await setStage(
      id,
      stage as ProposalStage,
      typeof body.note === "string" ? body.note : undefined,
    );
    if (!updated) {
      return NextResponse.json({ ok: false, error: "Запись не найдена." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, proposal: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/proposals/log] PATCH", msg);
    return NextResponse.json({ ok: false, error: "Не удалось обновить стадию." }, { status: 500 });
  }
}
