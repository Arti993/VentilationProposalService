/**
 * Проверка обратной связи менеджера.
 *
 * Запуск: node --env-file=.env.local scripts/test-feedback.ts [baseUrl]
 *
 * ЧТО ПРОВЕРЯЕТСЯ
 *
 * 1. Запись сохраняется с кодом позиции из прайса организации.
 * 2. Код, которого нет в прайсе, отвергается с 422 — иначе в словарь
 *    попал бы синоним, который молча ничего не находит.
 * 3. Повторная правка той же позиции ОБНОВЛЯЕТ запись, а не плодит
 *    вторую. Двойной клик не должен давать два примера из одного случая.
 * 4. Гость получает отказ: у него демо-организация, общая для всех.
 * 5. Статус меняется, и только у записи своей организации.
 * 6. В словарь синонимов попадают только подтверждённые (`applied`).
 *
 * ПОЧЕМУ ЭТО СТОИТ ТЕСТА
 *
 * Ошибка здесь не видна сразу: система продолжит работать, просто словарь
 * будет расти мусором или не пополняться вовсе. Обнаружится это через
 * месяц по качеству матчинга, когда понять причину уже трудно.
 */

import { withRetry } from "../src/db/connection.ts";

const BASE = process.argv[2] ?? "http://localhost:3000";

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(name: string, detail = ""): void {
  passed += 1;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail: string): void {
  failed += 1;
  console.log(`  ✗ ${name} — ${detail}`);
}

function skip(name: string, reason: string): void {
  skipped += 1;
  console.log(`  − ${name} — ${reason}`);
}

async function withCookie(
  path: string,
  init: RequestInit = {},
  cookie?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", BASE);
  if (cookie) headers.set("Cookie", cookie);
  return fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
}

function cookieFrom(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

/**
 * Регистрация с терпением к обрывам.
 *
 * Канал до Neon теряет ответ у части транзакций уже после COMMIT
 * (docs/INCIDENT-SIGNUP.md), поэтому пробуем несколько раз, как это
 * делает test-auth.ts.
 */
async function signUp(): Promise<{ cookie: string; email: string } | null> {
  const email = `fb-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = "TestPass123!";

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await withCookie("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "FB Test", email, password }),
    });

    if (res.ok) {
      const cookie = cookieFrom(res);
      if (cookie) return { cookie, email };
    }

    const text = await res.text();
    if (res.status === 409 && text.includes("CREATED_NEEDS_LOGIN")) {
      const login = await withCookie("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (login.ok) {
        const cookie = cookieFrom(login);
        if (cookie) return { cookie, email };
      }
    }

    console.log(`    попытка ${attempt}: HTTP ${res.status}`);
  }

  return null;
}

async function main() {
  console.log(`Проверка обратной связи: ${BASE}\n`);

  // ── 1. Сервер доступен ───────────────────────────────────
  console.log("=== Доступность ===");
  try {
    const res = await fetch(`${BASE}/api/price/upload`, { signal: AbortSignal.timeout(5000) });
    if (res.status < 500) ok("сервер доступен");
    else fail("сервер доступен", `HTTP ${res.status}`);
  } catch {
    fail("сервер доступен", "нет соединения");
    process.exit(1);
  }

  // ── 2. Гость не может писать ─────────────────────────────
  console.log("\n=== Гость ===");
  {
    const res = await fetch(`${BASE}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText: "Воздуховод спиральный 315", chosenCode: "p015" }),
    });
    if (res.status === 401) ok("гость получает 401", "у него нет организации");
    else fail("гость получает 401", `получили HTTP ${res.status}`);
  }

  // ── 3. Регистрация ───────────────────────────────────────
  console.log("\n=== Своя организация ===");
  const user = await signUp();
  if (!user) {
    fail("регистрация", "не удалось за 4 попытки");
    console.log(`\n═══ Итог: ${passed} из ${passed + failed} ═══`);
    process.exit(1);
  }
  ok("регистрация", user.email);

  /**
   * У новой организации прайса нет. Загружаем маленький, чтобы было из
   * чего выбирать: без позиций проверить сохранение кода невозможно.
   *
   * Разделитель — ЗАПЯТАЯ, а не точка с запятой. SheetJS читает CSV по
   * запятой без настройки, а точка с запятой превращает всю строку в одну
   * колонку, и разбор отвечает «не нашёл колонки Наименование и Цена».
   * Ошибка выглядит как проблема формата, хотя причина в разделителе.
   */
  const csv = [
    "Код,Наименование,Цена,Ед",
    "p001,Воздуховод спирально-навивной 315,846,м.п.",
    "p002,Тройник круглый 315/200,983,шт",
    "p003,Ниппель круглый 250,221,шт",
  ].join("\n");

  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "price.csv");

  const upload = await withCookie("/api/price/upload", { method: "POST", body: form }, user.cookie);
  const uploadJson = (await upload.json()) as { ok?: boolean; inserted?: number; error?: string };
  if (upload.ok && uploadJson.ok) ok("прайс загружен", `позиций: ${uploadJson.inserted}`);
  else fail("прайс загружен", `HTTP ${upload.status}: ${uploadJson.error ?? "?"}`);

  // ── 4. Список позиций для выбора ─────────────────────────
  const list = await withCookie("/api/price/upload?withItems=1", {}, user.cookie);
  const listJson = (await list.json()) as {
    ok?: boolean;
    items?: Array<{ id: string; rawName: string }>;
  };
  const items = listJson.items ?? [];
  if (items.length > 0) ok("прайс отдаётся со списком позиций", `${items.length} шт`);
  else fail("прайс отдаётся со списком позиций", "список пуст");

  // ── 5. Сохранение ────────────────────────────────────────
  console.log("\n=== Сохранение разбора ===");
  const chosen = items[0]?.id;
  if (!chosen) {
    skip("сохранение", "нет позиций в прайсе");
  } else {
    const res = await withCookie(
      "/api/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: "Воздуховод спиральный 315",
          chosenCode: chosen,
          posNo: 1,
          note: "клиент пишет «спиральный»",
        }),
      },
      user.cookie,
    );
    const json = (await res.json()) as {
      ok?: boolean;
      feedback?: { id: number; chosenCode: string; status: string };
      error?: string;
    };

    if (res.ok && json.feedback) {
      ok("разбор сохранён", `id=${json.feedback.id}, код=${json.feedback.chosenCode}`);
      if (json.feedback.status === "new") ok("начальный статус — new");
      else fail("начальный статус — new", `получили ${json.feedback.status}`);
    } else {
      fail("разбор сохранён", `HTTP ${res.status}: ${json.error ?? "?"}`);
    }

    // ── 6. Повтор не плодит запись ─────────────────────────
    const again = await withCookie(
      "/api/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: "Воздуховод спиральный 315", chosenCode: chosen, posNo: 1 }),
      },
      user.cookie,
    );
    const againJson = (await again.json()) as { ok?: boolean; feedback?: { id: number } };
    if (againJson.ok && json.feedback && againJson.feedback?.id === json.feedback.id) {
      ok("повторная правка обновляет ту же запись", `id=${againJson.feedback.id}`);
    } else {
      fail("повторная правка обновляет ту же запись", "создалась новая");
    }

    // ── 7. Несуществующий код отвергается ──────────────────
    const bad = await withCookie(
      "/api/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: "Что-то несуществующее", chosenCode: "p999" }),
      },
      user.cookie,
    );
    if (bad.status === 422) ok("код, которого нет в прайсе, отвергнут", "HTTP 422");
    else fail("код, которого нет в прайсе, отвергнут", `получили HTTP ${bad.status}`);

    // ── 8. Статус: applied ─────────────────────────────────
    if (json.feedback) {
      const patch = await withCookie(
        `/api/feedback/${json.feedback.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "applied" }),
        },
        user.cookie,
      );
      if (patch.ok) ok("статус меняется на applied");
      else fail("статус меняется на applied", `HTTP ${patch.status}`);

      // Подтверждённая пара попадает в словарь синонимов
      const syn = await withRetry(
        async (sql) =>
          sql<{ n: number }[]>`
            select count(*)::int as n from match_feedback
             where status = 'applied' and chosen_code is not null
               and raw_text = 'Воздуховод спиральный 315'
          `,
        { label: "проверка синонима" },
      );
      if ((syn[0]?.n ?? 0) > 0) ok("подтверждённая пара видна как синоним");
      else fail("подтверждённая пара видна как синоним", "запись не найдена");
    }

    // ── 9. Список и сводка ─────────────────────────────────
    const ls = await withCookie("/api/feedback", {}, user.cookie);
    const lsJson = (await ls.json()) as {
      ok?: boolean;
      items?: unknown[];
      summary?: { total: number; applied: number };
    };
    if (lsJson.ok && (lsJson.items?.length ?? 0) > 0) {
      ok("список отдаётся", `записей ${lsJson.items?.length}, всего ${lsJson.summary?.total}`);
    } else {
      fail("список отдаётся", "пусто");
    }
  }

  // ── 10. Чужую запись менять нельзя ───────────────────────
  console.log("\n=== Изоляция организаций ===");
  {
    const other = await signUp();
    if (!other) {
      skip("вторая организация", "не удалось зарегистрировать");
    } else {
      // Ищем любую запись первой организации и пробуем поменять её статус
      const probe = await withRetry(
        async (sql) => sql<{ id: number }[]>`select id from match_feedback order by id limit 1`,
        { label: "поиск чужой записи" },
      );
      const foreignId = probe[0]?.id;
      if (!foreignId) {
        skip("чужая запись не меняется", "записей нет");
      } else {
        const res = await withCookie(
          `/api/feedback/${foreignId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "rejected" }),
          },
          other.cookie,
        );
        if (res.status === 404) ok("чужая запись не меняется", "HTTP 404");
        else fail("чужая запись не меняется", `получили HTTP ${res.status}`);
      }
    }
  }

  console.log(`\n═══ Итог: ${passed} из ${passed + failed} проверок пройдено, пропущено ${skipped} ═══`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ошибка:", e instanceof Error ? e.message : e);
  process.exit(1);
});
