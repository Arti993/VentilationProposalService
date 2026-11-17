/**
 * POST /api/feedback — менеджер разобрал спорную позицию.
 *
 * ЧТО ПРИНИМАЕТ
 *
 * `{ rawText, chosenCode, estimateId?, posNo?, guessCode?, note? }`
 *
 * `rawText` — как написал клиент в смете, `chosenCode` — код позиции
 * прайса, которую менеджер считает правильной (или `null`, если такой
 * позиции в прайсе нет).
 *
 * ПОЧЕМУ ЭТО ВАЖНЕЕ, ЧЕМ КАЖЕТСЯ
 *
 * Из таких пар складывается словарь синонимов организации. Система
 * отказывается ставить цену при неоднозначности — ошибочный матч дороже
 * отсутствия матча, — и каждое ручное решение это готовый пример. Без
 * записи он теряется: менеджер правит КП и уходит, а завтра система
 * спотыкается о то же слово.
 *
 * ЧЕГО РОУТ НЕ ДЕЛАЕТ
 *
 * Не меняет КП и не трогает цены. Это принципиально: обратная связь —
 * только обучающий сигнал для словаря. Менять цены по подсказке модели
 * или по клику в интерфейсе нельзя, иначе весь смысл «цену ставит код»
 * разваливается.
 *
 * ПРОВЕРКИ
 *
 * 1. Нужен вход: у гостя нет организации, а словарь у каждого свой.
 * 2. Демо-организация запрещена: её словарь был бы общим для всех
 *    посетителей, и один гость менял бы выдачу другому.
 * 3. `chosenCode` проверяется по прайсу этой организации — иначе в
 *    словарь попал бы код, которого нет, и синоним молча не работал бы.
 */

import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/guard.ts";
import { isDemoOrg } from "@/lib/auth/org.ts";
import { loadPrice } from "@/db/repositories/price.ts";
import { saveFeedback } from "@/db/repositories/matchFeedback.ts";

export const runtime = "nodejs";

interface FeedbackBody {
  rawText?: string;
  chosenCode?: string | null;
  estimateId?: string | null;
  posNo?: number | null;
  guessCode?: string | null;
  note?: string | null;
}

/** Пределы на текст: больше — это не формулировка позиции, а что-то не то. */
const MAX_RAW_TEXT = 500;
const MAX_NOTE = 1000;

export async function POST(request: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json(
      {
        ok: false,
        error: "Нужен вход",
        hint: "Синонимы привязаны к организации. Войдите или зарегистрируйтесь — это бесплатно.",
      },
      { status: 401 },
    );
  }

  if (!actor.orgId) {
    return NextResponse.json(
      { ok: false, error: "У аккаунта нет организации" },
      { status: 409 },
    );
  }

  if (isDemoOrg(actor.orgId)) {
    return NextResponse.json(
      {
        ok: false,
        error: "В демо-организации это недоступно",
        hint:
          "Демо-прайс общий для всех посетителей: правки одного гостя меняли бы " +
          "выдачу другому. Зарегистрируйтесь — получите свою организацию.",
      },
      { status: 403 },
    );
  }

  let body: FeedbackBody;
  try {
    body = (await request.json()) as FeedbackBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Некорректный JSON" }, { status: 400 });
  }

  const rawText = (body.rawText ?? "").trim();
  if (!rawText) {
    return NextResponse.json(
      { ok: false, error: "Пустая формулировка" },
      { status: 400 },
    );
  }
  if (rawText.length > MAX_RAW_TEXT) {
    return NextResponse.json(
      { ok: false, error: `Формулировка слишком длинная (максимум ${MAX_RAW_TEXT})` },
      { status: 413 },
    );
  }

  const note = body.note?.trim() ?? null;
  if (note && note.length > MAX_NOTE) {
    return NextResponse.json(
      { ok: false, error: `Комментарий слишком длинный (максимум ${MAX_NOTE})` },
      { status: 413 },
    );
  }

  /**
   * Код позиции проверяем по прайсу организации.
   *
   * Без проверки в словарь мог попасть код, которого нет: клиент опечатался
   * в интерфейсе, прайс перезаписали между показом и сохранением, или
   * запрос собрали руками. Тогда синоним существовал бы, но не находил
   * позиции — и это самый неприятный вид ошибки: она молчаливая, и
   * менеджер считал бы, что его правка учтена.
   */
  let chosenCode = body.chosenCode?.trim() || null;
  let guessCode = body.guessCode?.trim() || null;

  if (chosenCode || guessCode) {
    const price = await loadPrice(actor.orgId);
    const codes = new Set(price.map((p) => p.id));

    if (chosenCode && !codes.has(chosenCode)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Такой позиции нет в прайсе",
          hint: `Код ${chosenCode} не найден. Возможно, прайс обновили — обновите страницу и попробуйте снова.`,
        },
        { status: 422 },
      );
    }

    // Несуществующий `guessCode` не ошибка: позицию могли убрать из прайса
    // уже после того, как система её предложила. Просто не сохраняем.
    if (guessCode && !codes.has(guessCode)) guessCode = null;
  }

  try {
    const row = await saveFeedback({
      orgId: actor.orgId,
      estimateId: body.estimateId ?? null,
      posNo: body.posNo ?? null,
      rawText,
      guessCode,
      chosenCode,
      note,
    });

    return NextResponse.json({ ok: true, feedback: row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/feedback]", msg);
    return NextResponse.json(
      { ok: false, error: `Не удалось сохранить: ${msg}` },
      { status: 500 },
    );
  }
}

/**
 * GET /api/feedback — список разобранных и неразобранных позиций.
 *
 * Нужен кабинету: менеджер видит, что ещё не разобрано, и что уже стало
 * синонимом. `?status=new` — только новое.
 */
export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor?.orgId) {
    return NextResponse.json({ ok: false, error: "Нужен вход" }, { status: 401 });
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status =
    statusParam === "new" || statusParam === "applied" || statusParam === "rejected"
      ? statusParam
      : undefined;

  /**
   * Импорт внутри функции, а не сверху: страница статистики и кабинет
   * читают эту же сводку, и держать её в модуле, который грузится ради
   * POST, значит тянуть лишний код в холодный старт записи.
   */
  const { listFeedback, feedbackSummary } = await import("@/db/repositories/matchFeedback.ts");

  try {
    const [items, summary] = await Promise.all([
      listFeedback(actor.orgId, { status, limit: 50 }),
      feedbackSummary(actor.orgId),
    ]);
    return NextResponse.json({ ok: true, items, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/feedback] чтение", msg);
    return NextResponse.json(
      { ok: false, error: `Не удалось прочитать: ${msg}` },
      { status: 500 },
    );
  }
}
