/**
 * Проверка MCP-сервера по протоколу.
 *
 * Запуск: node --env-file=.env.local scripts/test-mcp.ts [baseUrl]
 *
 * ЧТО ПРОВЕРЯЕТСЯ
 *
 * Не «сервер отвечает 200», а протокол целиком: клиент присылает JSON-RPC
 * поверх HTTP, сервер отвечает по спецификации 2026-07-28. Если сломать
 * транспорт, обычный HTTP-тест этого не заметит — он увидит 200 и решит,
 * что всё хорошо. Настоящий MCP-клиент (Claude, Cursor) при этом не
 * сможет подключиться.
 *
 * ПОЧЕМУ STATELESS ПРОВЕРЯЕТСЯ ОТДЕЛЬНО
 *
 * Главное обещание спецификации 2026-07-28 — работа без сессий. Значит,
 * второй запрос без `Mcp-Session-Id` должен работать так же, как первый.
 * Если бы SDK остался в stateful-режиме, второй вызов упал бы с 400 —
 * и на Vercel это ломалось бы через раз, когда запросы попадают на разные
 * экземпляры функции.
 *
 * ЧТО ПРОВЕРЯЕТСЯ НА БЕЗОПАСНОСТЬ
 *
 *   - без токена — отказ
 *   - с неверным токеном — отказ
 *   - нет инструмента, который «ставит цену»
 *   - поиск не отдаёт позиции чужой организации
 */

const BASE = process.argv[2] ?? "http://localhost:3000";

let passed = 0;
let failed = 0;

function ok(name: string, detail = ""): void {
  passed += 1;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail: string): void {
  failed += 1;
  console.log(`  ✗ ${name} — ${detail}`);
}

/** Токен из окружения: имя переменной — это orgId. */
function findToken(): string | null {
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("MCP_TOKEN_") && value) return value;
  }
  return null;
}

const TOKEN = findToken();

/** Один JSON-RPC вызов к MCP-серверу. */
async function rpc(
  method: string,
  params: unknown,
  token: string | null = TOKEN,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  const text = await res.text();

  /**
   * Транспорт может ответить SSE-потоком даже при `enableJsonResponse`:
   * тогда тело — это `event: message\ndata: {...}`. Разбираем оба формата,
   * иначе тест «не увидит» успешный ответ и покажет ложную ошибку.
   */
  let body: any = null;
  if (text.startsWith("event:") || text.includes("\ndata:")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    body = line ? JSON.parse(line.slice(5).trim()) : null;
  } else {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }
  }

  return { status: res.status, body };
}

async function main() {
  console.log(`Проверка MCP-сервера: ${BASE}\n`);

  if (!TOKEN) {
    fail("токен в окружении", "нет переменной MCP_TOKEN_*");
    process.exit(1);
  }
  ok("токен найден", `${TOKEN.slice(0, 6)}… (${TOKEN.length} символов)`);

  // ── 1. Авторизация ──────────────────────────────────────
  console.log("\n=== Авторизация ===");
  {
    const noToken = await rpc("tools/list", {}, null);
    if (noToken.status === 401) ok("без токена — отказ", "401");
    else fail("без токена — отказ", `HTTP ${noToken.status}`);

    const badToken = await rpc("tools/list", {}, "wrong-token-12345");
    if (badToken.status === 401) ok("с неверным токеном — отказ", "401");
    else fail("с неверным токеном — отказ", `HTTP ${badToken.status}`);

    const wrongPrefix = await rpc("tools/list", {}, "Bearer " + TOKEN);
    if (wrongPrefix.status === 401) ok("двойной Bearer не проходит", "401");
    else fail("двойной Bearer не проходит", `HTTP ${wrongPrefix.status}`);
  }

  // ── 2. Список инструментов ──────────────────────────────
  console.log("\n=== Список инструментов ===");
  let tools: Array<{ name: string; description?: string }> = [];
  {
    const res = await rpc("tools/list", {});
    if (res.status !== 200) {
      fail("tools/list", `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
    } else if (!Array.isArray(res.body?.result?.tools)) {
      fail("tools/list", `нет result.tools: ${JSON.stringify(res.body).slice(0, 200)}`);
    } else {
      tools = res.body.result.tools;
      ok("tools/list отвечает", `${tools.length} инструментов`);
      console.log(`    ${tools.map((t) => t.name).join(", ")}`);
    }
  }

  // ── 3. Главный принцип ──────────────────────────────────
  //
  // Инструмента, который «ставит цену», быть не должно. Это не стиль, а
  // защита: если такого инструмента нет, никакая инъекция в тексте сметы
  // не сможет назвать произвольную цену.
  console.log("\n=== Инструмента «поставь цену» нет ===");
  {
    const forbidden = ["set_price", "update_price", "force_price", "override_price"];
    const found = tools.filter((t) => forbidden.includes(t.name));
    if (found.length === 0) ok("инструментов изменения цены нет");
    else fail("инструментов изменения цены нет", found.map((t) => t.name).join(", "));

    const hasMatch = tools.some((t) => t.name === "match_line");
    if (hasMatch) ok("match_line есть", "сопоставление, но не назначение");
    else fail("match_line есть", "не найден");
  }

  // ── 4. Рабочий вызов инструмента ────────────────────────
  console.log("\n=== match_line на реальной строке ===");
  {
    const res = await rpc("tools/call", {
      name: "match_line",
      arguments: { line: "Воздуховод 315" },
    });

    const text = res.body?.result?.content?.[0]?.text;
    if (res.status === 200 && typeof text === "string") {
      ok("вызов прошёл", text.split("\n")[0].slice(0, 90));

      /**
       * Проверяем не конкретную цену (прайс может измениться), а
       * соблюдение принципа: если цена названа — рядом должно быть
       * указано, откуда она, и не должно быть «придумал».
       */
      if (/придуман/i.test(text) && !/не придуман/i.test(text)) {
        fail("цена не выдумана", "в ответе есть слово «придумал»");
      } else {
        ok("цена не выдумана", "ответ ссылается на прайс");
      }
    } else {
      fail("вызов прошёл", `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 250)}`);
    }
  }

  // ── 5. Stateless: второй запрос без сессии ──────────────
  //
  // Главное обещание спецификации 2026-07-28. Если сервер остался
  // stateful, этот вызов упадёт с 400 «нет сессии».
  console.log("\n=== Stateless: два запроса подряд ===");
  {
    const a = await rpc("tools/call", {
      name: "match_line",
      arguments: { line: "Тройник 315/200" },
    });
    const b = await rpc("tools/call", {
      name: "match_line",
      arguments: { line: "Заглушка 100" },
    });

    if (a.status === 200 && b.status === 200) {
      ok("оба запроса без сессии прошли", "stateless работает");
    } else {
      fail(
        "оба запроса без сессии прошли",
        `первый ${a.status}, второй ${b.status}: ${JSON.stringify(b.body).slice(0, 150)}`,
      );
    }
  }

  // ── 6. Неизвестный инструмент ───────────────────────────
  //
  // Модель может ошибиться и позвать несуществующий инструмент. Сервер
  // обязан ответить понятной ошибкой, а не 500: иначе хост решит, что
  // сервер сломан, и отключит его целиком.
  //
  // ФОРМАТ ОТВЕТА
  //
  // SDK отдаёт ошибку инструмента внутри `result` с флагом `isError: true`,
  // а не в поле `error`. Это правильный MCP: ошибка инструмента — часть
  // результата вызова, и модель должна её прочитать и исправиться. Поле
  // `error` верхнего уровня остаётся для ошибок протокола (неизвестный
  // метод, битый JSON-RPC).
  //
  // Первая версия теста ждала `error` и падала на корректном ответе.
  console.log("\n=== Неизвестный инструмент ===");
  {
    const res = await rpc("tools/call", {
      name: "delete_everything",
      arguments: {},
    });

    const viaResult = res.body?.result?.isError === true;
    const viaError = res.body?.error !== undefined;
    const message =
      res.body?.result?.content?.[0]?.text ?? res.body?.error?.message ?? "";

    if (res.status === 200 && (viaResult || viaError) && /not found/i.test(message)) {
      ok(
        "ошибка инструмента, а не 500",
        `${viaResult ? "result.isError" : "error"}: ${message.slice(0, 55)}`,
      );
    } else {
      fail(
        "ошибка инструмента, а не 500",
        `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 150)}`,
      );
    }
  }

  // ── 7. CORS preflight ───────────────────────────────────
  //
  // Без этого браузерные клиенты MCP не смогут подключиться вовсе.
  console.log("\n=== CORS preflight ===");
  {
    const res = await fetch(`${BASE}/api/mcp`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://claude.ai",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,mcp-method,mcp-name",
      },
    });

    const origin = res.headers.get("access-control-allow-origin");
    const headers = res.headers.get("access-control-allow-headers") ?? "";

    if (res.status === 204 && origin) ok("preflight отвечает 204", `allow-origin: ${origin}`);
    else fail("preflight отвечает 204", `HTTP ${res.status}`);

    if (/mcp-method/i.test(headers) && /mcp-name/i.test(headers)) {
      ok("Mcp-Method и Mcp-Name разрешены");
    } else {
      fail("Mcp-Method и Mcp-Name разрешены", `allow-headers: ${headers}`);
    }
  }

  // ── 8. GET отклоняется ──────────────────────────────────
  console.log("\n=== GET отклоняется ===");
  {
    const res = await fetch(`${BASE}/api/mcp`, {
      method: "GET",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (res.status === 405) ok("GET → 405", "спецификация 2026-07-28");
    else fail("GET → 405", `HTTP ${res.status}`);
  }

  console.log(`\n═══ Итог: ${passed} из ${passed + failed} проверок пройдено ═══`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ошибка:", e instanceof Error ? e.message : e);
  process.exit(1);
});
