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
import { appliedSynonyms } from "@/db/repositories/matchFeedback.ts";
import { buildSynonymTable, rewriteWithSynonym } from "@/lib/matcher/synonyms.ts";
import { createSession } from "@/lib/agent/session.ts";
import { clientKey, consume, pruneOldCounters } from "@/lib/limits/usage";
import { getActor, viewerOrganization } from "@/lib/auth/guard";
import type { SessionOwner } from "@/db/repositories/sessions";
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
  /**
   * Точка отсчёта для метрики времени разбора.
   *
   * Ставится ДО любых проверок и чтения тела: `/status` показывает эту
   * цифру как «от файла до готового КП», и всё, что происходит до неё,
   * тоже часть работы пользователя.
   */
  const startedAt = Date.now();

  try {
    // ── Лимит: до разбора файла ────────────────────────────
    // Загрузка дороже вопроса агенту: разбор Excel, матчинг сотни строк
    // и, для спорных позиций, вызовы LLM. Проверяем до чтения тела —
    // иначе один скрипт заставит сервер разбирать тысячи файлов.
    const ip = clientKey(req);
    const limit = await consume({ action: "upload", key: ip });
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: limit.reason, retryAt: limit.resetAt.toISOString() },
        { status: limit.status ?? 429, headers: limit.headers },
      );
    }

    // Уборка старых счётчиков — попутно, без отдельного крона
    void pruneOldCounters();

    /**
     * Владелец создаваемой сметы.
     *
     * Вошедший пользователь пишет в свою организацию. Анонимный
     * (или не вошедший вовсе) — в демо-организацию: работодатель
     * открывает ссылку и должен увидеть работающий продукт, не
     * регистрируясь. Данные анонимов живут по общему TTL и никому
     * больше не видны.
     */
    const actor = await getActor();
    // `viewerOrganization`, а не `actor?.orgId || DEMO_ORG_ID`: пустой
    // orgId через `||` становился демо-прайсом, и смета пользователя без
    // организации попадала в общую.
    const owner: SessionOwner = {
      orgId: viewerOrganization(actor),
      userId: actor?.userId ?? null,
    };

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
                "Содержимое файла не соответствует текстовому формату. " +
                "Сохраните документ Excel в формате .xlsx или Word в формате .docx.",
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
                "Содержимое файла не соответствует формату Excel. " +
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
        return await processAndRespond(file.name, rows, limit.headers, owner, startedAt);
      }

      case "word": {
        if (!isZip(bytes)) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "Содержимое файла не соответствует формату Word. " +
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

    return await processAndRespond(file.name, rows, limit.headers, owner, startedAt);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/estimate]", msg);

    // Повреждённый архив даёт CharacterData/CRC-ошибку из unzip —
    // пользователю нужно объяснить это человеческим языком
    const hint = /corrupt|invalid|zip|unexpected end|Central Directory/i.test(msg)
      ? " Файл повреждён или имеет неподдерживаемый формат. Сохраните его заново в Excel или Word."
      : "";

    return NextResponse.json(
      { ok: false, error: `Не удалось обработать смету. Попробуйте ещё раз.${hint}` },
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
  headers: Record<string, string>,
  owner: SessionOwner,
  /**
   * Когда начался разбор — передаётся из `POST`, а не берётся здесь.
   *
   * ЗАЧЕМ ПАРАМЕТРОМ
   *
   * Первая версия ставила `Date.now()` в начале этой функции, и медиана
   * получалась 1 мс при реальных трёх секундах. Причина: файл к этому
   * моменту уже разобран, строки уже извлечены, и сюда приходит готовый
   * список. Замер начинался после львиной доли работы.
   *
   * Страница `/status` показывает эту метрику публично, поэтому важно,
   * чтобы она мерила именно «от файла до готового КП», а не время
   * сохранения в базу.
   */
  startedAt: number,
): Promise<NextResponse> {
  // Прайс берём организации-владельца сметы, а не «вообще»: сопоставление
  // идёт по его ценам. У новой организации прайса нет — тогда все строки
  // получат «нет в прайсе», и это честный ответ.
  const price = await getPrice(owner.orgId);

  /**
   * Синонимы организации из обратной связи менеджера.
   *
   * Менеджер уже разбирал похожие строки и подтвердил пары «как написал
   * клиент → позиция прайса». Применяем их ДО матчинга: строка
   * переписывается на название из прайса, и детерминированный матчинг
   * находит цену сам, без модели.
   *
   * Почему до, а не после: после матчинга строка уже получила статус
   * `not_found` или `needs_human`, и «дотягивать» её значит спорить с
   * результатом. Переписывание на входе — не спор, а уточнение входа.
   *
   * Ошибка чтения синонимов не должна ломать загрузку сметы: словарь —
   * улучшение, а не обязательное условие. Пустой словарь = работа как
   * раньше.
   */
  let rowsForMatch = rows;
  try {
    const synonyms = await appliedSynonyms(owner.orgId);
    if (synonyms.length > 0) {
      const table = buildSynonymTable(synonyms);

      /**
       * Конфликтующие формулировки исключены из словаря. Логируем их
       * явно: иначе менеджеры, подтвердившие разные позиции по одной
       * фразе, никогда не узнают, что их разбор не работает.
       *
       * Чинить это должен человек (решить, кто прав), а не код: понять,
       * чей разбор вернее, у нас нет способа.
       */
      if (table.conflicts.length > 0) {
        console.warn(
          `[estimate] синонимы: ${table.conflicts.length} конфликт(ов) — ` +
            table.conflicts
              .map((c) => `«${c.phrase}» → ${c.codes.join(" / ")}`)
              .join("; "),
        );
      }

      const names = new Map(price.map((p) => [p.id, p.rawName]));
      /**
       * Размеры позиций нужны, чтобы не дублировать их в названии.
       * Без этой карты строка «Воздуховод спиральный 315» превращалась в
       * «Воздуховод спирально-навивной 315, м.п. 315», и разбор принимал
       * второй «315» за количество.
       */
      const dims = new Map(price.map((p) => [p.id, p.dims]));

      let rewritten = 0;
      rowsForMatch = rows.map((r) => {
        const { text, code } = rewriteWithSynonym(r.name, table, names, dims);
        if (code && text !== r.name) {
          rewritten += 1;
          return { ...r, name: text };
        }
        return r;
      });

      if (rewritten > 0) {
        console.log(`[estimate] синонимы: переписано ${rewritten} из ${rows.length}`);
      }
    }
  } catch (e) {
    // Не падаем: смета важнее словаря
    console.error(
      "[estimate] синонимы недоступны:",
      e instanceof Error ? e.message : e,
    );
  }

  const results = await processRows(rowsForMatch, price, { concurrency: 3 });

  const session = createSession(fileName, results);
  const id = createSessionId();

  /**
   * Время разбора и матчинга — от момента получения запроса.
   *
   * Считаем здесь, но точку отсчёта передал `POST`: разбор файла, извлечение
   * строк и нормализация уже произошли к этому моменту, и начинать замер
   * внутри этой функции значило бы измерять только матчинг (1 мс вместо
   * трёх секунд).
   */
  const parseMs = Date.now() - startedAt;

  // Сохраняем ДО ответа: если БД недоступна, пользователь узнает об
  // ошибке сразу, а не получит «работающий» интерфейс с мёртвой сессией.
  await saveSession(id, session, owner, parseMs);

  // Отдаём клиенту, но сессию на сервере тоже сохраняем: чат возьмёт
  // данные оттуда, а не из тела запроса — так их нельзя подменить.
  //
  // Заголовки лимита прикладываем и к успешному ответу: по ним клиент
  // понимает, сколько попыток осталось, и не бьётся в 429 вслепую.
  const response: EstimateSession & { id: string } = { ...session, id };
  return NextResponse.json({ ok: true, session: response }, { headers });
}
