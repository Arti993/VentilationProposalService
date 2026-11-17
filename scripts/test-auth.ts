/**
 * Проверка аккаунтов, организаций и изоляции данных.
 *
 * Запуск: node --env-file=.env.local scripts/test-auth.ts [baseUrl]
 *
 * ЧТО ДОКАЗЫВАЕТСЯ
 *
 * Главное утверждение проекта — «данные привязаны к организации и
 * проверяются на сервере». Проверка должна это ломать, а не
 * подтверждать: если тест проходит при уязвимом коде, он бесполезен.
 *
 *  1. Регистрация создаёт пользователя и организацию.
 *  2. Пароль не хранится в открытом виде (в базе его нет).
 *  3. Повторная регистрация на тот же адрес отклоняется.
 *  4. Вход с неверным паролем отклоняется — без подсказки, что адрес верный.
 *  5. Вторая организация НЕ видит смету первой (основная проверка).
 *  6. Анонимный пользователь не видит смету организации.
 *  7. Чужой КП не скачивается.
 *  8. Чужой диалог не читается.
 *
 * Записи после себя удаляются: тест не должен копить мусор в базе.
 */
import postgres from "postgres";
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

/** Уникальный адрес на каждый прогон: иначе второй запуск упрётся в «уже есть». */
function tag(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

interface Session {
  /** Cookie из Set-Cookie, которую надо возвращать в следующих запросах */
  cookie: string;
  userId: string;
}

/**
 * Выполняет запрос с cookie.
 *
 * Cookie берём из `set-cookie` ответа целиком (там несколько значений —
 * сам токен и его кэш), потому что Better Auth проверяет оба.
 *
 * `Origin` обязателен: Better Auth отклоняет запросы без него с
 * `MISSING_OR_NULL_ORIGIN` — это защита от CSRF, и она права. Браузер
 * подставляет Origin сам; тест должен вести себя как браузер.
 */
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

/** Сохраняет cookie из ответа: берём все пары name=value из set-cookie. */
function cookieFrom(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

/**
 * Регистрация, которая переживает потерю ответа.
 *
 * Канал до Neon теряет ответ у части транзакций уже после `COMMIT`
 * (docs/INCIDENT-SIGNUP.md). Поэтому тест НЕ требует, чтобы первая
 * попытка всегда удавалась. Он требует другого, более важного:
 *
 *   — после любой неудачи аккаунт либо полностью рабочий (можно войти),
 *     либо отсутствует (не осталось пользователя без пароля);
 *
 *   — не бывает состояния «пользователь есть, войти нельзя».
 *
 * Делаем до 4 попыток, как это сделает живой человек, нажимая кнопку.
 */
async function signUpResilient(
  name: string,
  email: string,
  password: string,
): Promise<{ session: Session | null; attempts: number; note: string }> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await withCookie("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    if (res.ok) {
      const cookie = cookieFrom(res);
      const json = (await res.json()) as { user?: { id: string } };
      const userId = json.user?.id;
      if (cookie && userId) {
        return { session: { cookie, userId }, attempts: attempt, note: "создан" };
      }
      return { session: null, attempts: attempt, note: "нет cookie или id" };
    }

    const text = await res.text();

    // Сервер сообщил, что пользователь на самом деле создан — остался
    // только вход. Проверяем это входом.
    if (res.status === 409 && text.includes("CREATED_NEEDS_LOGIN")) {
      const loginRes = await withCookie("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (loginRes.ok) {
        const cookie = cookieFrom(loginRes);
        const json = (await loginRes.json()) as { user?: { id: string } };
        return {
          session: json.user?.id ? { cookie, userId: json.user.id } : null,
          attempts: attempt,
          note: "создан ранее, вход выполнен",
        };
      }
      return {
        session: null,
        attempts: attempt,
        note: `409, но вход не прошёл: HTTP ${loginRes.status}`,
      };
    }

    // 503 SIGNUP_RETRY — регистрация не состоялась, можно пробовать снова
    if (res.status === 503) {
      console.log(`    попытка ${attempt}: не состоялась, повторяем`);
      continue;
    }

    // Остальное — настоящая ошибка (занятый адрес, короткий пароль)
    return { session: null, attempts: attempt, note: `HTTP ${res.status}: ${text.slice(0, 80)}` };
  }
  return { session: null, attempts: 4, note: "4 попытки не удались" };
}

async function main(): Promise<void> {
  console.log(`Проверка аккаунтов и изоляции данных: ${BASE}\n`);

  const t = tag();
  const emailA = `a${t}@test.local`;
  const emailB = `b${t}@test.local`;
  const password = "test-password-123";

  // ── 1. Регистрация ──────────────────────────────────────
  console.log("=== Регистрация (с устойчивостью к потере ответа) ===");

  const regA = await signUpResilient("Тест А", emailA, password);
  if (!regA.session) {
    fail("регистрация А", regA.note);
    return report();
  }
  ok("регистрация А", `${emailA} (${regA.note}, попыток: ${regA.attempts})`);

  const regB = await signUpResilient("Тест Б", emailB, password);
  if (!regB.session) {
    fail("регистрация Б", regB.note);
    return report();
  }
  ok("регистрация Б", `${emailB} (попыток: ${regB.attempts})`);

  const userA = regA.session;
  const userB = regB.session;

  // ── 1б. Войти можно тем же паролем ──────────────────────
  console.log("\n=== Вход после регистрации ===");

  const loginOk = await withCookie("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailA, password }),
  });
  if (loginOk.ok) ok("вход с паролем из регистрации работает", `HTTP 200`);
  else fail("вход с паролем из регистрации работает", `HTTP ${loginOk.status}`);

  // ── 2. Пароль не в открытом виде ────────────────────────
  console.log("\n=== Хранение пароля ===");

  const stored = await withRetry(
    async (sql) =>
      sql<{ password: string | null }[]>`
        select password from account
         where user_id = ${userA.userId} and provider_id = 'credential'
         limit 1
      `,
    { label: "пароль" },
  );

  const hash = stored[0]?.password;
  if (!hash) {
    fail("пароль сохранён", "записи нет");
  } else if (hash === password) {
    fail("пароль не в открытом виде", "в базе лежит пароль как есть");
  } else if (!/^[a-f0-9]{32,}:[a-f0-9]{32,}$/i.test(hash) && hash.length < 60) {
    fail("пароль похож на хеш", `длина ${hash.length}, начало «${hash.slice(0, 12)}»`);
  } else {
    ok("пароль не в открытом виде", `хеш ${hash.length} символов`);
  }

  // ── 3. Повторная регистрация ────────────────────────────
  console.log("\n=== Повторная регистрация ===");

  const dupRes = await withCookie("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Дубль", email: emailA, password }),
  });
  if (dupRes.ok) {
    fail("повторная регистрация отклонена", "сервер принял второй аккаунт на тот же адрес");
  } else {
    ok("повторная регистрация отклонена", `HTTP ${dupRes.status}`);
  }

  // ── 3б. Нет пользователей без пароля ────────────────────
  console.log("\n=== Нет «полузаписанных» аккаунтов ===");

  // Главная гарантия после разбора обрывов: не бывает состояния
  // «пользователь есть, войти нельзя». Проверяем по всей базе, а не
  // только по тестовым адресам — такая запись вредна любому человеку.
  //
  // Анонимов исключаем: у них пароля нет по устройству (вход по cookie),
  // и это не поломка регистрации. Отличаем их по домену почты, а не по
  // `is_anonymous`: у анонимов это поле приходит `null`, а не `false`.
  const orphans = await withRetry(
    async (sql) =>
      sql<{ email: string }[]>`
        select u.email from "user" u
         where not exists (select 1 from account a where a.user_id = u.id)
           and u.email not like '%@anon.local'
         limit 10
      `,
    { label: "проверка сирот" },
  );
  if (orphans.length === 0) {
    ok("нет пользователей без аккаунта", "все зарегистрированные могут войти");
  } else {
    fail(
      "нет пользователей без аккаунта",
      `${orphans.length} шт: ${orphans.map((o) => o.email).join(", ")}`,
    );
  }

  // ── 4. Неверный пароль ──────────────────────────────────
  console.log("\n=== Вход с неверным паролем ===");

  const badLogin = await withCookie("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailA, password: "wrong-password-999" }),
  });
  if (badLogin.ok) {
    fail("неверный пароль отклонён", "вход прошёл");
  } else {
    const text = (await badLogin.text()).toLowerCase();
    ok("неверный пароль отклонён", `HTTP ${badLogin.status}`);
    // Ответ не должен говорить, что адрес существует: иначе это перебор
    // зарегистрированных пользователей.
    if (text.includes("пользователь не найден") || text.includes("user not found")) {
      fail("ответ не выдаёт существование адреса", `«${text.slice(0, 80)}»`);
    } else {
      ok("ответ не выдаёт существование адреса");
    }
  }

  // ── 5. Организация создана ──────────────────────────────
  console.log("\n=== Организация ===");

  const orgs = await withRetry(
    async (sql) =>
      sql<{ organization_id: string; role: string }[]>`
        select organization_id, role from member where user_id = ${userA.userId}
      `,
    { label: "организации" },
  );
  if (orgs.length === 0) {
    fail("у пользователя есть организация", "в member нет записи");
  } else {
    ok("у пользователя есть организация", `${orgs[0]!.organization_id}, роль ${orgs[0]!.role}`);
  }

  // ── 6. Изоляция смет (главная проверка) ─────────────────
  console.log("\n=== Изоляция данных между организациями ===");

  /**
   * Сначала прайс организации А.
   *
   * Без своего прайса новый клиент получает КП без позиций и без цены —
   * API честно отвечает 422 «нет ни одной позиции с ценой». Проверять
   * изоляцию на пустом КП бессмысленно: там нечего защищать. Поэтому
   * сначала даём А цены, и только потом смотрим, что их не видит Б.
   */
  {
    const XLSX = await import("xlsx");
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Наименование", "Цена"],
      ["Воздуховод круглый 315", 1200],
      ["Тройник 315/200", 3400],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Прайс");
    const buf = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const priceForm = new FormData();
    priceForm.append("file", new Blob([buf]), "price.xlsx");

    const priceRes = await withCookie(
      "/api/price/upload",
      { method: "POST", body: priceForm },
      userA.cookie,
    );
    if (priceRes.ok) {
      ok("А загрузил свой прайс", "2 позиции");
    } else {
      fail("А загрузил свой прайс", `HTTP ${priceRes.status}`);
    }
  }

  // Пользователь А загружает смету
  const uploadRes = await (async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob(["Наименование,Кол-во\nВоздуховод круглый 315,10\nТройник 315/200,3\n"], {
        type: "text/csv",
      }),
      "test-estimate.csv",
    );
    return withCookie("/api/estimate", { method: "POST", body: form }, userA.cookie);
  })();

  let estimateId: string | null = null;
  if (!uploadRes.ok) {
    fail("А загрузил смету", `HTTP ${uploadRes.status}: ${(await uploadRes.text()).slice(0, 100)}`);
  } else {
    const json = (await uploadRes.json()) as { session?: { id: string } };
    estimateId = json.session?.id ?? null;
    if (estimateId) ok("А загрузил смету", estimateId.slice(0, 8) + "…");
    else fail("А загрузил смету", "в ответе нет id");
  }

  if (estimateId) {
    // Владелец видит свою смету
    const own = await withCookie(`/api/proposal/${estimateId}`, {}, userA.cookie);
    if (own.status === 200) ok("А скачивает свой КП", `HTTP 200, ${own.headers.get("content-type")?.slice(0, 40)}`);
    else fail("А скачивает свой КП", `HTTP ${own.status}`);

    // Б не видит смету А — это и есть проверка изоляции
    const foreign = await withCookie(`/api/proposal/${estimateId}`, {}, userB.cookie);
    if (foreign.status === 404) {
      ok("Б не видит смету А", "HTTP 404 (не 403 — не подтверждаем существование)");
    } else {
      fail("Б не видит смету А", `HTTP ${foreign.status} — данные утекли`);
    }

    // Аноним тоже не видит
    const anon = await withCookie(`/api/proposal/${estimateId}`, {});
    if (anon.status === 404) ok("аноним не видит смету А", "HTTP 404");
    else fail("аноним не видит смету А", `HTTP ${anon.status}`);

    // Чат по чужой смете не раскрывает данные
    const chatForeign = await withCookie(
      "/api/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "Какой итог по этой смете?", sessionId: estimateId }),
      },
      userB.cookie,
    );
    // Агент получит пустую сессию и ответит, что сметы нет — это
    // приемлемо. Проверяем главное: в ответе нет суммы из сметы А.
    const chatText = (await chatForeign.text()).toLowerCase();
    const leaksTotal = /\d{3,}\s*(?:₽|руб)/.test(chatText);
    if (leaksTotal) {
      fail("чат не раскрывает сумму чужой сметы", `в ответе цена: «${chatText.slice(0, 100)}»`);
    } else {
      ok("чат не раскрывает сумму чужой сметы");
    }
  }

  // ── 7. Анонимный вход ───────────────────────────────────
  console.log("\n=== Анонимный вход ===");

  const anonRes = await withCookie("/api/auth/sign-in/anonymous", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (anonRes.ok) {
    const cookie = cookieFrom(anonRes);
    const json = (await anonRes.json()) as { user?: { isAnonymous?: boolean } };
    ok("анонимный вход работает", `isAnonymous=${json.user?.isAnonymous}`);
    if (cookie) ok("аноним получил cookie сессии");
    else fail("аноним получил cookie сессии", "cookie нет");
  } else {
    fail("анонимный вход", `HTTP ${anonRes.status}: ${(await anonRes.text()).slice(0, 120)}`);
  }

  // ── Уборка ──────────────────────────────────────────────
  console.log("\n=== Уборка тестовых данных ===");

  // Убираем по одному DELETE в своём соединении: несколько запросов
  // подряд в одном соединении на этой базе рвутся (INCIDENT-SIGNUP.md).
  let cleaned = 0;
  for (const userId of [userA.userId, userB.userId]) {
    for (const table of ["member", "session", "account"]) {
      try {
        await one((s) => s`delete from ${s(table)} where user_id = ${userId}`);
        cleaned += 1;
      } catch {
        // не критично для проверки
      }
    }
    try {
      await one((s) => s`delete from "user" where id = ${userId}`);
      cleaned += 1;
    } catch {
      // не критично
    }
  }

  const leftover = await one(
    (s) => s`select count(*)::int as n from "user" where email in (${emailA}, ${emailB})`,
  );
  if (leftover[0]?.n === 0) {
    ok("тестовые пользователи удалены", `выполнено ${cleaned} запросов`);
  } else {
    fail("тестовые пользователи удалены", `осталось ${leftover[0]?.n}`);
  }

  report();
}

/**
 * Выполняет один запрос в отдельном соединении.
 *
 * Нужен для уборки: обычный `withRetry` из `connection.ts` держит
 * соединение между запросами и падает по таймауту 3 секунды.
 */
async function one<T>(
  fn: (sql: ReturnType<typeof postgres>) => Promise<T>,
): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const sql = postgres(url, {
    ssl: "require",
    prepare: true,
    max: 1,
    connect_timeout: 20,
  });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

function report(): void {
  const total = passed + failed;
  console.log(`\n═══ Итог: ${passed} из ${total} проверок пройдено ═══`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
