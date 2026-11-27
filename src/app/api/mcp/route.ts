/**
 * MCP-сервер: `POST /api/mcp`.
 *
 * ЭТО НЕ ОБЫЧНЫЙ API-МАРШРУТ
 *
 * Здесь говорит не наш клиент, а Claude, ChatGPT или Cursor по протоколу
 * MCP. Поэтому нет «наших» форматов ответа: транспорт SDK отвечает так,
 * как того требует спецификация.
 *
 * ПОЧЕМУ STATELESS
 *
 * Спецификация 2026-07-28 убрала handshake `initialize` и заголовок
 * `Mcp-Session-Id`. Для Vercel это ровно то, что нужно: каждый вызов
 * может попасть на любой экземпляр функции, и хранить сессию в памяти
 * не требуется. Состояние живёт в базе (сметы, прайс, журнал), а не в
 * процессе.
 *
 * ЧТО ОТДАЁМ В ОШИБКАХ
 *
 * Сообщения без внутренностей: текст исключения может содержать строку
 * подключения к базе с паролем. Клиенту — только «не авторизован» или
 * «внутренняя ошибка», подробности — в лог сервера.
 */
import { handleMcpRequest, resolveOrgFromToken } from "@/lib/mcp/server";

/**
 * Маршрут должен быть динамическим: тело запроса читается на месте, а
 * статическая оптимизация попыталась бы его закэшировать.
 */
export const dynamic = "force-dynamic";

/**
 * MCP-вызовы короткие: поиск по прайсу и разбор одной строки. 60 секунд —
 * верхняя граница Vercel, но по факту упираемся в 10–20.
 */
export const maxDuration = 60;

/** CORS: клиенты MCP живут на других доменах. */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Mcp-Method, Mcp-Name, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

/** Ответ с CORS и без кэширования. */
function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, headers });
}

/** JSON-ответ об ошибке. */
function fail(status: number, message: string): Response {
  return withCors(
    Response.json({ ok: false, error: message }, { status }),
  );
}

/**
 * Preflight.
 *
 * Обязателен: браузерные клиенты MCP (и веб-версии Claude) сначала
 * спрашивают разрешение. Без этого заголовки `Mcp-Method`/`Mcp-Name` не
 * пройдут проверку, и сервер будет выглядеть недоступным при верном токене.
 */
export function OPTIONS(): Response {
  return withCors(new Response(null, { status: 204 }));
}

/**
 * Пост запросов MCP.
 *
 * Bearer-токен обязателен всегда. Публичный MCP без авторизации означал
 * бы, что любой, кто узнал адрес, читает прайс организации и жжёт наш
 * бюджет на эмбеддинги.
 */
export async function POST(request: Request): Promise<Response> {
  const orgId = resolveOrgFromToken(request);

  if (!orgId) {
    return fail(
      401,
      "Передайте токен организации в заголовке Authorization: Bearer <токен>.",
    );
  }

  try {
    return withCors(await handleMcpRequest(request, orgId));
  } catch (e) {
    /**
     * В лог — подробно, клиенту — общо. `e.message` от драйвера базы
     * содержит строку подключения целиком, включая пароль.
     */
    console.error("[mcp] ошибка обработки:", e instanceof Error ? e.message : e);
    return fail(500, "Внутренняя ошибка сервера. Попробуйте ещё раз.");
  }
}

/**
 * GET для MCP не используется.
 *
 * В спецификации 2026-07-28 GET открывал SSE-поток от сервера к клиенту.
 * В stateless-режиме такого потока нет, поэтому отвечаем 405 — это
 * корректный сигнал клиенту «используй POST», а не ошибка.
 */
export function GET(): Response {
  return fail(405, "MCP-сервер принимает только POST (stateless, спецификация 2026-07-28).");
}
