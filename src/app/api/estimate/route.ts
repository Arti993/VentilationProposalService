/**
 * POST /api/estimate — загрузка сметы клиента.
 *
 * Принимает файл (.txt/.csv), разбирает, сопоставляет с прайсом,
 * возвращает сессию с позициями. ID сессии нужен для последующих
 * вопросов агенту.
 *
 * Защита: тип файла проверяется по расширению И по содержимому
 * (первые байты), размер ограничен. Не доверяем ни имени, ни MIME
 * от клиента.
 */
import { NextResponse } from "next/server";
import { parseEstimateText } from "@/lib/estimate/parse.ts";
import { processRows } from "@/lib/matcher/hybrid.ts";
import { createSession } from "@/lib/agent/session.ts";
import type { EstimateSession } from "@entities/estimate/model/types";
import { getPrice } from "../_lib/price";
import { createSessionId, saveSession } from "../_lib/sessionStore";

export const runtime = "nodejs";
/** Обработка сметы с LLM может занять время: даём функции запас. */
export const maxDuration = 60;

const MAX_BYTES = 2 * 1024 * 1024; // 2 МБ — сметы на тысячи позиций
const ALLOWED_EXT = [".txt", ".csv", ".tsv"];

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Файл не передан. Прикрепите смету в формате .txt или .csv." },
        { status: 400 },
      );
    }

    if (file.size === 0) {
      return NextResponse.json({ ok: false, error: "Файл пустой." }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: `Файл слишком большой (${Math.round(file.size / 1024)} КБ). Максимум 2 МБ.` },
        { status: 413 },
      );
    }

    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json(
        { ok: false, error: `Неподдерживаемый формат «${ext}». Допустимо: ${ALLOWED_EXT.join(", ")}.` },
        { status: 415 },
      );
    }

    const text = await file.text();

    // Бинарный файл с расширением .txt — почти наверняка ошибка пользователя
    if (text.includes("\u0000")) {
      return NextResponse.json(
        { ok: false, error: "Файл похож на бинарный. Нужен текстовый .txt или .csv." },
        { status: 415 },
      );
    }

    const rows = parseEstimateText(text);
    if (!rows.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "В файле не найдено ни одной позиции. Проверьте, что это смета со списком оборудования.",
        },
        { status: 422 },
      );
    }

    const price = getPrice();
    const results = await processRows(rows, price, { concurrency: 3 });

    const session = createSession(file.name, results);
    const id = createSessionId();
    saveSession(id, session);

    // Отдаём клиенту, но сессию на сервере тоже сохраняем: чат возьмёт
    // данные оттуда, а не из тела запроса — так их нельзя подменить.
    const response: EstimateSession & { id: string } = { ...session, id };
    return NextResponse.json({ ok: true, session: response });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/estimate]", msg);
    return NextResponse.json(
      { ok: false, error: `Не удалось обработать смету: ${msg}` },
      { status: 500 },
    );
  }
}
