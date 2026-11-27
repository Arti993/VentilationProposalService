/**
 * PATCH /api/feedback/[id] — смена статуса разбора.
 *
 * `applied` — менеджер подтвердил пару «формулировка → позиция», и она
 * идёт в словарь синонимов организации.
 * `rejected` — пример ошибочный, в словарь не попадает.
 *
 * ПОЧЕМУ НЕ УДАЛЯЕМ ОТКЛОНЁННОЕ
 *
 * Если два менеджера разошлись во мнении по одной строке, это сигнал о
 * неоднозначности самого прайса, и его стоит видеть. Удаление стёрло бы
 * следы: система выглядела бы так, будто менеджер никогда не пытался
 * разобрать эту позицию.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МАРШРУТ, А НЕ POST С ДЕЙСТВИЕМ
 *
 * `PATCH` по идентификатору — идемпотентная операция над одним объектом.
 * Через POST пришлось бы присылать весь объект заново, и появился бы шанс
 * затереть `rawText` неверной копией из устаревшего интерфейса.
 */

import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/guard.ts";
import { isDemoOrg } from "@/lib/auth/org.ts";
import { setFeedbackStatus } from "@/db/repositories/matchFeedback.ts";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getActor();
  if (!actor?.orgId) {
    return NextResponse.json({ ok: false, error: "Войдите в аккаунт" }, { status: 401 });
  }
  if (isDemoOrg(actor.orgId)) {
    return NextResponse.json(
      { ok: false, error: "Для сохранения изменений нужен аккаунт" },
      { status: 403 },
    );
  }

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Неверный идентификатор" }, { status: 400 });
  }

  let body: { status?: string };
  try {
    body = (await request.json()) as { status?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Некорректный JSON" }, { status: 400 });
  }

  /**
   * `new` здесь недоступен намеренно: вернуть запись в «не разобрано»
   * значит подтвердить, что разбор был ошибочным НЕ в примере, а в
   * решении — это уже другой разговор. Достаточно двух состояний.
   */
  if (body.status !== "applied" && body.status !== "rejected") {
    return NextResponse.json(
      { ok: false, error: "Статус должен быть applied или rejected" },
      { status: 400 },
    );
  }

  try {
    /**
     * Обновление ограничено организацией: `where org_id = …` внутри
     * `setFeedbackStatus`. Без этого, зная идентификатор, можно было бы
     * переключить статус чужого разбора — и повлиять на чужой словарь.
     */
    const found = await setFeedbackStatus(actor.orgId, id, body.status);
    if (!found) {
      return NextResponse.json({ ok: false, error: "Сохранённое соответствие не найдено" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id, status: body.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/feedback/:id]", msg);
    return NextResponse.json(
      { ok: false, error: "Не удалось обновить соответствие. Попробуйте ещё раз." },
      { status: 500 },
    );
  }
}
