/**
 * POST /api/estimate — загрузка сметы клиента.
 *
 * Принимает .txt/.csv/.tsv, а также .xlsx/.xls/.xlsm и .docx.
 * Разбирает, сопоставляет с прайсом, возвращает сессию с позициями.
 * ID сессии нужен для последующих вопросов агенту.
 *
 * ЗАЩИТА
 *
 * 1. Расширение проверяется по белому списку.
 * 2. Формат дополнительно подтверждается сигнатурой: .xlsx и .docx
 *    обязаны начинаться с «PK» (ZIP), текстовые — не содержать NUL-байт.
 *    Расширению от клиента не доверяем: переименовать файл легко.
 * 3. Размер ограничен до чтения в память.
 * 4. Архивы распаковываются библиотеками с ограничением: ZIP-бомба
 *    отсекается по размеру до распаковки, а не после.
 *
 * Почему нельзя просто проверять «нет ли NUL» для всех форматов:
 * xlsx — это ZIP, в нём всегда есть нулевые байты. Проверка одна на
 * все форматы отклонила бы любой Excel.
 */
import { NextResponse } from "next/server";
import { parseEstimateText } from "@/lib/estimate/parse.ts";
import {
  ALLOWED_EXTENSIONS,
  formatOf,
  parseExcel,
  parseWord,
} from "@/lib/estimate/binary.ts";
import { processRows } from "@/lib/matcher/hybrid.ts";
import { createSession } from "@/lib/agent/session.ts";
import type { EstimateSession } from "@entities/estimate/model/types";
import { getPrice } from "../_lib/price";
import { createSessionId, saveSession } from "../_lib/sessionStore";

export const runtime = "nodejs";
/** Обработка сметы с LLM может занять время: даём функции запас. */
export const maxDuration = 60;

/** 5 МБ: Excel-сметы с форматированием заметно тяжелее текстовых. */
const MAX_BYTES = 5 * 1024 * 1024;

/** Сигнатура ZIP: с неё начинаются и .xlsx, и .docx. */
function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** Старый формат .xls — бинарный OLE-контейнер, не ZIP. */
function isOle(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Файл не передан. Прикрепите смету в формате Excel, Word или текстовом.",
        },
        { status: 400 },
      );
    }

    if (file.size === 0) {
      return NextResponse.json({ ok: false, error: "Файл пустой." }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `Файл слишком большой (${Math.round(file.size / 1024)} КБ). Максимум 5 МБ.`,
        },
        { status: 413 },
      );
    }

    const format = formatOf(file.name);
    if (!format) {
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
      return NextResponse.json(
        {
          ok: false,
          error:
            `Формат «${ext || "без расширения"}» не поддерживается. ` +
            `Допустимо: ${ALLOWED_EXTENSIONS.join(", ")}.`,
        },
        { status: 415 },
      );
    }

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer.slice(0, 8));

    /** Текст после разбора — единый формат для всех входных форматов. */
    let text: string;

    switch (format) {
      case "text": {
        // Бинарный файл с расширением .txt — почти наверняка ошибка
        // пользователя, а не смета
        const decoded = new TextDecoder("utf-8").decode(buffer);
        if (decoded.includes("\u0000")) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "Файл похож на бинарный, хотя расширение текстовое. " +
                "Если это Excel или Word — сохраните файл в его обычном формате.",
            },
            { status: 415 },
          );
        }
        text = decoded;
        break;
      }

      case "excel": {
        if (!isZip(bytes) && !isOle(bytes)) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "Файл не похож на Excel: у него другое содержимое. " +
                "Откройте его в Excel и сохраните как .xlsx.",
            },
            { status: 415 },
          );
        }

        const rows = await parseExcel(buffer);
        if (!rows.length) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "В книге не найдено ни одной позиции. Проверьте, что на листах " +
                "есть список оборудования с количеством.",
            },
            { status: 422 },
          );
        }

        // Excel уже разобран в структуру — текстовый парсер не нужен.
        // Превращаем строки в общий формат EstimateRow.
        return await processAndRespond(file.name, rows);
      }

      case "word": {
        if (!isZip(bytes)) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "Файл не похож на Word: у него другое содержимое. " +
                "Файлы .doc (старый формат) не поддерживаются — сохраните как .docx.",
            },
            { status: 415 },
          );
        }

        text = await parseWord(buffer);
        break;
      }
    }

    const rows = parseEstimateText(text);
    if (!rows.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "В файле не найдено ни одной позиции. Проверьте, что это смета " +
            "со списком оборудования.",
        },
        { status: 422 },
      );
    }

    return await processAndRespond(file.name, rows);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/estimate]", msg);

    // Повреждённый архив даёт CharacterData/CRC-ошибку из unzip —
    // пользователю нужно объяснить это человеческим языком
    const hint = /corrupt|invalid|zip|unexpected end|Central Directory/i.test(msg)
      ? " Файл повреждён или это не настоящий документ Office."
      : "";

    return NextResponse.json(
      { ok: false, error: `Не удалось обработать смету: ${msg}.${hint}` },
      { status: 500 },
    );
  }
}

/**
 * Сопоставление с прайсом и сохранение сессии.
 *
 * Вынесено, потому что вызывается из двух веток — Excel и текстовой.
 * Дублировать 20 строк в каждой ветке значило бы гарантировать, что
 * однажды поправят только одну.
 */
async function processAndRespond(
  fileName: string,
  rows: Parameters<typeof processRows>[0],
): Promise<NextResponse> {
  const price = await getPrice();
  const results = await processRows(rows, price, { concurrency: 3 });

  const session = createSession(fileName, results);
  const id = createSessionId();

  // Сохраняем ДО ответа: если БД недоступна, пользователь узнает об
  // ошибке сразу, а не получит «работающий» интерфейс с мёртвой сессией.
  await saveSession(id, session);

  // Отдаём клиенту, но сессию на сервере тоже сохраняем: чат возьмёт
  // данные оттуда, а не из тела запроса — так их нельзя подменить.
  const response: EstimateSession & { id: string } = { ...session, id };
  return NextResponse.json({ ok: true, session: response });
}
