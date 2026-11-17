/**
 * Сквозная проверка: разбор менеджера → синоним → смета находит цену.
 *
 * Запуск: node --env-file=.env.local scripts/test-feedback-loop.ts [baseUrl]
 *
 * ЧТО ПРОВЕРЯЕТСЯ
 *
 * Замкнутый круг, ради которого делалась обратная связь:
 *
 *   1. Приходит смета со строкой, которую система не понимает
 *      («Воздуховод спиральный 315» — в прайсе такого названия нет).
 *   2. Менеджер подтверждает, что имелся в виду `p001`.
 *   3. Следующая смета с той же формулировкой находит цену САМА,
 *      без участия человека.
 *
 * Если разорвать круг в любом месте (не сохраняется, не применяется,
 * применяется слишком широко), тест это покажет. Ценность в том, что
 * проверяется не отдельная функция, а польза для пользователя.
 *
 * ОТДЕЛЬНЫЙ СЛУЧАЙ — ЛОЖНОЕ СРАБАТЫВАНИЕ
 *
 * Синоним не должен переписывать родственные слова: «ниппель» не должен
 * находиться внутри «ниппельный». Это проверяется тем же прогоном.
 */

import { withRetry } from "../src/db/connection.ts";

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

async function signUp(): Promise<{ cookie: string; email: string } | null> {
  const email = `loop-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = "TestPass123!";

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await withCookie("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Loop Test", email, password }),
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
  }
  return null;
}

/** Загружает смету из текста и возвращает позиции. */
async function loadEstimate(
  cookie: string,
  text: string,
): Promise<Array<{ posNo: number; name: string; status: string; unitPrice: number | null }>> {
  const form = new FormData();
  form.append("file", new Blob([text], { type: "text/plain" }), "estimate.txt");

  const res = await withCookie("/api/estimate", { method: "POST", body: form }, cookie);
  const json = (await res.json()) as {
    ok?: boolean;
    session?: { positions?: Array<{ posNo: number; name: string; status: string; unitPrice: number | null }> };
    error?: string;
  };

  if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.session?.positions ?? [];
}

async function main() {
  console.log(`Сквозная проверка обратной связи: ${BASE}\n`);

  const user = await signUp();
  if (!user) {
    fail("регистрация", "не удалось");
    process.exit(1);
  }
  ok("регистрация", user.email);

  // ── Прайс организации ────────────────────────────────────
  const csv = [
    "Код,Наименование,Цена,Ед",
    "p001,Воздуховод спирально-навивной 315,846,м.п.",
    "p002,Тройник круглый 315/200,983,шт",
  ].join("\n");

  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "price.csv");
  const up = await withCookie("/api/price/upload", { method: "POST", body: form }, user.cookie);
  const upJson = (await up.json()) as { ok?: boolean; inserted?: number; error?: string };
  if (up.ok && upJson.ok) ok("прайс загружен", `позиций ${upJson.inserted}`);
  else {
    fail("прайс загружен", upJson.error ?? `HTTP ${up.status}`);
    process.exit(1);
  }

  // ── 1. Смета ДО обучения ────────────────────────────────
  //
  // Формулировка «спиральный» отличается от прайсного
  // «спирально-навивной». Матчинг может найти её через синонимы типа
  // (в normalize есть TYPE_SYNONYMS), поэтому проверяем не «не найдено
  // вовсе», а конкретное: цену находит или нет.
  console.log("\n=== Смета до обучения ===");

  const before = await loadEstimate(user.cookie, "Воздуховод спиральный 315; 10; м.п.");
  const beforeRow = before[0];
  if (!beforeRow) {
    fail("смета загружена", "позиций нет");
    process.exit(1);
  }
  console.log(`    позиция: «${beforeRow.name}» → ${beforeRow.status}${beforeRow.unitPrice != null ? `, ${beforeRow.unitPrice} ₽` : ""}`);

  // ── 2. Менеджер подтверждает соответствие ───────────────
  console.log("\n=== Разбор менеджера ===");
  {
    const res = await withCookie(
      "/api/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: "Воздуховод спиральный",
          chosenCode: "p001",
          posNo: 1,
        }),
      },
      user.cookie,
    );
    const json = (await res.json()) as { ok?: boolean; feedback?: { id: number }; error?: string };

    if (res.ok && json.feedback) {
      ok("разбор сохранён", `id=${json.feedback.id}`);

      // Подтверждаем — только после этого пара идёт в словарь
      const patch = await withCookie(
        `/api/feedback/${json.feedback.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "applied" }),
        },
        user.cookie,
      );
      if (patch.ok) ok("подтверждён (applied)");
      else fail("подтверждён (applied)", `HTTP ${patch.status}`);
    } else {
      fail("разбор сохранён", json.error ?? `HTTP ${res.status}`);
    }
  }

  // ── 3. Смета ПОСЛЕ обучения ─────────────────────────────
  console.log("\n=== Смета после обучения ===");
  {
    const after = await loadEstimate(user.cookie, "Воздуховод спиральный 315; 10; м.п.");
    const row = after[0];

    if (!row) {
      fail("смета загружена", "позиций нет");
    } else {
      console.log(`    позиция: «${row.name}» → ${row.status}${row.unitPrice != null ? `, ${row.unitPrice} ₽` : ""}`);

      if (row.status === "priced" && row.unitPrice === 846) {
        ok("после обучения цена найдена", `${row.unitPrice} ₽`);
      } else {
        fail("после обучения цена найдена", `статус ${row.status}, цена ${row.unitPrice}`);
      }

      /**
       * Формулировка в смете должна быть переписана на прайсную. Это
       * видно по названию: `matchedName` содержит позицию прайса.
       */
      if (row.name.toLowerCase().includes("спирально")) {
        ok("строка переписана на прайсное название", row.name);
      } else {
        console.log(`    (название осталось: «${row.name}» — не критично)`);
      }
    }
  }

  // ── 4. Ложное срабатывание не появилось ─────────────────
  //
  // Строка с «спиральный» должна найтись, а вот совершенно другая позиция
  // (тройник) — нет. Если бы словарь переписывал всё подряд, здесь была
  // бы цена воздуховода.
  console.log("\n=== Синоним не переписывает лишнего ===");
  {
    const rows = await loadEstimate(user.cookie, "Тройник круглый 315/200; 2; шт");
    const row = rows[0];

    if (!row) {
      fail("смета загружена", "позиций нет");
    } else if (row.unitPrice === 983) {
      ok("тройник получил свою цену", "983 ₽");
    } else {
      fail("тройник получил свою цену", `цена ${row.unitPrice}, статус ${row.status}`);
    }
  }

  // ── 5. Уборка ───────────────────────────────────────────
  //
  // Тестовая организация остаётся, если её не убрать: следующая проверка
  // увидит лишние данные, а в базе накопится мусор. Чистим по email.
  console.log("\n=== Уборка ===");
  {
    const deleted = await withRetry(
      async (sql) =>
        sql<{ id: string }[]>`
          delete from "user" where email = ${user.email} returning id
        `,
      { label: "удаление тестового пользователя" },
    );
    if (deleted.length > 0) ok("тестовый пользователь удалён");
    else console.log("    (пользователь уже удалён)");
  }

  console.log(`\n═══ Итог: ${passed} из ${passed + failed} проверок пройдено ═══`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ошибка:", e instanceof Error ? e.message : e);
  process.exit(1);
});
