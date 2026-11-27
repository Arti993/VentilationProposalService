/**
 * Загрузка своего прайса.
 *
 * ЧТО ДЕЛАЕТ
 *
 * Принимает файл (.xlsx/.xls/.csv), разбирает его в позиции и заменяет
 * прайс организации целиком. После этого сметы считаются по ценам
 * клиента, а не по демо-прайсу.
 *
 * ПОЧЕМУ ЗАМЕНА, А НЕ ДОПОЛНЕНИЕ
 *
 * Прайс — снимок на дату. Если поставщик убрал позицию, она должна
 * исчезнуть. «Добавить недостающие» оставило бы в базе цены, которых
 * больше нет, и клиент увидел бы в КП устаревшую цену. Устаревшая цена
 * хуже отсутствующей: по отсутствующей менеджер пойдёт уточнять, а по
 * устаревшей — выставит счёт.
 *
 * ПОЧЕМУ ORG_DEMO НЕЛЬЗЯ
 *
 * Демо-прайс общий: его видят все гости. Если разрешить перезаписывать
 * его, любой посетитель снёс бы демо для всех. Поэтому загрузка в
 * демо-организацию запрещена, а гость получает понятное объяснение.
 */

import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getActor, denied } from "@/lib/auth/guard.ts";
import { isDemoOrg } from "@/lib/auth/org.ts";
import { parsePriceWorkbook, describeQuality } from "@/lib/price/parse.ts";
import { replacePrice, countPrice, loadPrice } from "@/db/repositories/price.ts";
import { getPriceMeta } from "@/db/repositories/priceMeta.ts";
import { indexPriceInBackground } from "@/db/repositories/priceIndex.ts";

export const runtime = "nodejs";

/**
 * Предел размера файла.
 *
 * 4 МБ — это примерно 30 тысяч строк прайса. Ограничение не про
 * возможности сервера, а про бесплатный тариф: запрос должен уложиться в
 * лимит времени функции. Большой файл разбирался бы дольше, и человек
 * получил бы таймаут вместо ответа.
 */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json(
      {
        ok: false,
        error: "Войдите в аккаунт",
        hint: "Для загрузки прайса войдите в аккаунт или зарегистрируйтесь.",
        /**
         * Машиночитаемый признак «дело в авторизации».
         *
         * Без него клиент различал бы причины отказа по тексту сообщения, а
         * это ломается при любой правке формулировки. По этому флагу
         * интерфейс показывает кнопку «Войти» — раньше человек читал совет
         * и не мог по нему кликнуть.
         */
        needAuth: true,
      },
      { status: 401 },
    );
  }

  // Гость работает в демо-прайсе, который общий для всех
  if (isDemoOrg(actor.orgId)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Демонстрационный прайс доступен только для просмотра",
        hint:
          "Создайте аккаунт, чтобы загрузить прайс поставщика.",
        // Тот же признак: человеку нужно завести аккаунт, и интерфейс
        // предложит кнопку, а не просто совет
        needAuth: true,
      },
      { status: 403 },
    );
  }

  // Пользователь без организации: загружать некуда
  if (!actor.orgId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Организация аккаунта не найдена",
        hint: "Повторите вход в аккаунт. Если ошибка сохраняется, повторите попытку позже.",
      },
      { status: 409 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Файл не получен", hint: "Выберите файл и попробуйте снова." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "В запросе нет файла", hint: "Выберите файл прайса." },
      { status: 400 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json(
      { ok: false, error: "Файл пустой", hint: "Проверьте, что в файле есть данные." },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `Файл больше ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} МБ`,
        hint:
          "Уменьшите размер файла: оставьте только необходимые разделы и повторите загрузку.",
      },
      { status: 413 },
    );
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Не удалось прочитать файл", hint: "Попробуйте другой файл." },
      { status: 400 },
    );
  }

  const parsed = parsePriceWorkbook(buffer);
  if (!parsed.ok) {
    // 422, а не 400: файл дошёл и читается, но содержимое не подходит.
    // Это разная ситуация для клиента: чинится правкой таблицы.
    return NextResponse.json(
      { ok: false, error: parsed.error, hint: parsed.hint },
      { status: 422 },
    );
  }

  let replaced: { inserted: number; removed: number };
  try {
    replaced = await replacePrice(actor.orgId, parsed.items, file.name);
  } catch (e) {
    console.error(
      "[price] не удалось сохранить прайс:",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json(
      {
        ok: false,
        error: "Не удалось сохранить прайс",
        hint:
          "Не удалось подтвердить загрузку прайса. Проверьте его состояние и при необходимости повторите загрузку.",
      },
      { status: 500 },
    );
  }

  const quality = describeQuality(parsed.items);

  /**
   * Индексация — в фоне, без ожидания.
   *
   * Почему не дожидаемся: 215 позиций — это семь обращений к модели
   * эмбеддингов, то есть десятки секунд. На бесплатном Vercel запрос
   * упёрся бы в лимит 60 с уже после того, как база обновлена, и клиент
   * увидел бы таймаут при фактически работающем прайсе.
   *
   * Пока индекс не готов, точный матчинг работает полностью (он берёт
   * тип и размеры из колонок, а не из вектора). Сложные формулировки
   * временно уйдут в «требует проверки» — это безопасный отказ, а не
   * выдуманная цена.
   *
   * `waitUntil` не держит ответ, но продлевает жизнь функции, чтобы
   * индексация не оборвалась на середине. Остаток добьёт ночной прогон
   * `scripts/index-price.ts` — он ищет позиции без вектора.
   */
  waitUntil(
    indexPriceInBackground(actor.orgId).then((result) => {
      if (result.error) {
        console.error("[price] индексация не удалась:", result.error);
      } else if (result.indexed > 0) {
        console.log(`[price] проиндексировано ${result.indexed}, осталось ${result.pending}`);
      }
    }),
  );

  return NextResponse.json({
    ok: true,
    fileName: file.name,
    inserted: replaced.inserted,
    removed: replaced.removed,
    skipped: parsed.skipped,
    quality,
    columns: parsed.columns,
    // Честно говорим, что поиск по смыслу может отставать — это не
    // ошибка, но человек должен знать, почему сложная строка не нашлась
    indexing: "started" as const,
    warning:
      quality.withoutDims > 0
        ? `${quality.withoutDims} позиций без размеров: они найдутся только по точному названию.`
        : null,
  });
}

/**
 * Сколько позиций в прайсе организации.
 *
 * Нужно кабинету: показать «в прайсе 215 позиций» и дату, когда его
 * загружали. Отдельный GET, а не часть ответа на загрузку — иначе
 * кабинет не узнает состояние прайса, не загружая файл заново.
 *
 * `?withItems=1` добавляет сами позиции. Это нужно разбору спорных строк:
 * менеджер подтверждает «какой позиции прайса соответствует эта строка»,
 * и выбирать ему надо из настоящего прайса организации, а не из демо.
 *
 * ПОЧЕМУ ФЛАГОМ, А НЕ ВСЕГДА
 *
 * 215 позиций — это ~40 КБ JSON. Кабинету они не нужны, а платить за
 * передачу при каждом открытии не стоит. Флаг делает выбор явным.
 */
export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) {
    const d = denied(actor);
    return NextResponse.json(d.body, { status: d.status });
  }

  const orgId = actor.orgId;
  if (!orgId) {
    return NextResponse.json({ ok: true, total: 0, isDemo: false });
  }

  const withItems = new URL(request.url).searchParams.get("withItems") === "1";

  if (withItems) {
    /**
     * `loadPrice` кэшируется в памяти функции на 5 минут (см. price.ts),
     * поэтому повторные открытия списка не бьют в базу. Организация
     * берётся из сессии, а не из запроса: подставив чужой orgId, можно
     * было бы выгрузить чужой прайс — то есть цены поставщика конкурента.
     */
    const items = await loadPrice(orgId);
    const isDemo = isDemoOrg(orgId);
    return NextResponse.json({
      ok: true,
      total: items.length,
      isDemo,
      hasOwnPrice: !isDemo && items.length > 0,
      items: items.map((p) => ({
        id: p.id,
        rawName: p.rawName,
        price: p.price,
        type: p.type,
        dims: p.dims,
      })),
    });
  }

  const total = await countPrice(orgId);

  /**
   * Свой прайс — это «не демо И есть позиции».
   *
   * Одного `total > 0` мало: демо-прайс тоже даёт 215 позиций, и новый
   * пользователь увидел бы «прайс загружен», хотя своего у него нет.
   * Одного `!isDemoOrg` тоже мало: организация могла загрузить файл, из
   * которого ничего не разобралось, — это другой разговор с человеком.
   */
  const isDemo = isDemoOrg(orgId);
  const meta = await getPriceMeta(orgId);

  return NextResponse.json({
    ok: true,
    total,
    isDemo,
    hasOwnPrice: !isDemo && total > 0,
    /**
     * Имя файла и дата — только если загрузка была после появления
     * `price_meta`. У старых загрузок их нет, и это не ошибка:
     * интерфейс покажет «прайс загружен» без подробностей.
     */
    fileName: meta?.fileName ?? null,
    itemCount: meta?.itemCount ?? null,
    uploadedAt: meta?.uploadedAt?.toISOString() ?? null,
  });
}
