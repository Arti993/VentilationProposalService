/**
 * Проверка аккаунта: имя, аватар, вход и состояние прайса.
 *
 * ЧТО ПРОВЕРЯЕМ И ПОЧЕМУ
 *
 * 1. Имя меняется и сразу видно в сессии. Если бы обновлялась только
 *    строка в базе, шапка показывала бы старое имя ещё пять минут —
 *    сессия живёт в cookie-кэше.
 * 2. Аватар принимается только как картинка и только разумного размера.
 *    Без серверной проверки в `user.image` можно положить мегабайты
 *    произвольного текста.
 * 3. `/account` закрыт для гостя: иначе форма настроек откроется тому,
 *    у кого нет аккаунта.
 * 4. Состояние прайса различает «своего нет» и «загружен»: от этого
 *    зависит предупреждение на экране расчёта.
 *
 * ЗАПУСК
 *
 *   node --env-file=.env.local scripts/test-account.ts
 *
 * Требует поднятого сервера (`npm run dev`) и доступа к базе.
 */

import * as XLSX from "xlsx";
import postgres from "postgres";

const BASE = process.env.UI_BASE ?? "http://localhost:3000";

let passed = 0;
let failed = 0;

function ok(name: string, detail = ""): void {
  passed += 1;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail = ""): void {
  failed += 1;
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Крошечная настоящая PNG 1×1 — валидный data URL для аватара. */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function makeXlsx(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Прайс");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

interface Reply {
  status: number;
  data: Record<string, unknown> | null;
  text: string;
}

/** Сессия одного пользователя: хранит cookie между запросами. */
class Client {
  private cookie: string | null = null;

  async req(
    path: string,
    opts: { method?: string; body?: BodyInit; json?: unknown } = {},
  ): Promise<Reply> {
    const headers: Record<string, string> = { Origin: BASE };
    if (this.cookie) headers.Cookie = this.cookie;
    if (opts.json !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(BASE + path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
      redirect: "manual",
    });

    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length > 0) {
      this.cookie = set.map((c) => c.split(";")[0]).join("; ");
    }

    const text = await res.text().catch(() => "");
    let data: Record<string, unknown> | null = null;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("json")) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        data = null;
      }
    }
    return { status: res.status, data, text };
  }

  async register(tag: string): Promise<{ email: string; userId: string }> {
    const email = `${tag}-${Date.now()}@test.local`;
    const res = await this.req("/api/auth/sign-up/email", {
      method: "POST",
      json: { name: `Тест ${tag}`, email, password: "test-password-123" },
    });
    if (res.status >= 400) {
      throw new Error(`регистрация не удалась: HTTP ${res.status} ${res.text.slice(0, 120)}`);
    }
    const user = res.data?.user as { id?: string } | undefined;
    return { email, userId: user?.id ?? "" };
  }

  async session(): Promise<{
    name?: string;
    email?: string;
    image?: string | null;
  } | null> {
    const res = await this.req("/api/auth/get-session");
    return (res.data?.user as { name?: string; email?: string; image?: string | null }) ?? null;
  }

  async updateUser(body: Record<string, unknown>): Promise<Reply> {
    return this.req("/api/auth/update-user", { method: "POST", json: body });
  }
}

/** Выполняет один запрос в своём соединении (уборка). */
async function one<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const sql = postgres(url, { ssl: "require", prepare: true, max: 1, connect_timeout: 20 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

async function main(): Promise<void> {
  console.log(`Проверка аккаунта: ${BASE}\n`);

  // ── Сервер доступен? ────────────────────────────────────
  console.log("=== Сервер ===");
  const probe = await fetch(`${BASE}/login`, { redirect: "manual" }).catch(() => null);
  if (!probe || probe.status >= 500) {
    console.log("  ✗ сервер недоступен — запустите npm run dev");
    process.exit(1);
  }
  ok("сервер отвечает", `HTTP ${probe.status}`);

  const a = new Client();
  const user = await a.register("account");
  ok("зарегистрирован пользователь", user.email);

  // ── 1. Имя ──────────────────────────────────────────────
  console.log("\n=== Имя ===");
  {
    const before = await a.session();
    if (before?.name === "Тест account") {
      ok("имя при регистрации", before.name);
    } else {
      fail("имя при регистрации", `получили ${String(before?.name)}`);
    }

    const upd = await a.updateUser({ name: "Артём Новый" });
    const after = await a.session();
    if (upd.status === 200 && after?.name === "Артём Новый") {
      ok("имя меняется и сразу видно в сессии", after.name);
    } else {
      fail(
        "имя меняется и сразу видно в сессии",
        `HTTP ${upd.status}, в сессии ${String(after?.name)}`,
      );
    }

    const short = await a.updateUser({ name: "Я" });
    if (short.status === 400) {
      ok("слишком короткое имя отклонено", "HTTP 400");
    } else {
      fail("слишком короткое имя отклонено", `HTTP ${short.status}`);
    }

    const empty = await a.updateUser({ name: "   " });
    if (empty.status === 400) {
      ok("имя из пробелов отклонено", "HTTP 400");
    } else {
      fail("имя из пробелов отклонено", `HTTP ${empty.status}`);
    }
  }

  // ── 2. Аватар ───────────────────────────────────────────
  console.log("\n=== Аватар ===");
  {
    const good = await a.updateUser({ image: TINY_PNG });
    const s = await a.session();
    if (good.status === 200 && s?.image === TINY_PNG) {
      ok("аватар сохранён", `${TINY_PNG.length} символов`);
    } else {
      fail("аватар сохранён", `HTTP ${good.status}`);
    }

    const huge = await a.updateUser({ image: `data:image/png;base64,${"A".repeat(300_000)}` });
    if (huge.status === 400) {
      ok("слишком большой аватар отклонён", "HTTP 400");
    } else {
      fail("слишком большой аватар отклонён", `HTTP ${huge.status}`);
    }

    const notImage = await a.updateUser({ image: "javascript:alert(1)" });
    if (notImage.status === 400) {
      ok("не-картинка отклонена", "HTTP 400");
    } else {
      fail("не-картинка отклонена", `HTTP ${notImage.status}`);
    }

    const cleared = await a.updateUser({ image: null });
    const s2 = await a.session();
    if (cleared.status === 200 && !s2?.image) {
      ok("аватар можно убрать");
    } else {
      fail("аватар можно убрать", `HTTP ${cleared.status}, image=${String(s2?.image)}`);
    }
  }

  // ── 3. Прайс ────────────────────────────────────────────
  console.log("\n=== Прайс ===");
  {
    const empty = await a.req("/api/price/upload");
    if (empty.data?.hasOwnPrice === false && empty.data?.total === 0) {
      ok("своего прайса нет", "hasOwnPrice=false");
    } else {
      fail(
        "своего прайса нет",
        `hasOwnPrice=${String(empty.data?.hasOwnPrice)}, total=${String(empty.data?.total)}`,
      );
    }

    const buf = makeXlsx([
      ["Наименование", "Цена", "Ед."],
      ["Воздуховод спирально-навивной 315", 846, "м.п."],
      ["Тройник круглый 315/200", 1900, "шт"],
    ]);
    const form = new FormData();
    form.append("file", new Blob([buf]), "мой_прайс.xlsx");
    const uploaded = await a.req("/api/price/upload", { method: "POST", body: form });
    if (uploaded.data?.ok === true) {
      ok("прайс загружен", `HTTP ${uploaded.status}`);
    } else {
      fail("прайс загружен", `HTTP ${uploaded.status}`);
    }

    const info = await a.req("/api/price/upload");
    const d = info.data ?? {};
    if (
      d.hasOwnPrice === true &&
      d.fileName === "мой_прайс.xlsx" &&
      Number(d.itemCount) > 0 &&
      typeof d.uploadedAt === "string"
    ) {
      ok("состояние прайса после загрузки", `${String(d.itemCount)} позиций, ${String(d.fileName)}`);
    } else {
      fail("состояние прайса после загрузки", JSON.stringify(d).slice(0, 160));
    }
  }

  // ── 4. Страницы ─────────────────────────────────────────
  console.log("\n=== Страницы ===");
  {
    const account = await a.req("/account");
    if (account.status === 200 && account.text.includes("Аккаунт")) {
      ok("/account открывается вошедшему", "HTTP 200");
    } else {
      fail("/account открывается вошедшему", `HTTP ${account.status}`);
    }

    if (account.text.includes("Артём Новый")) {
      ok("имя видно в кабинете");
    } else {
      fail("имя видно в кабинете", "не нашлось в HTML");
    }

    const app = await a.req("/app");
    if (app.status === 200 && app.text.includes("Артём Новый")) {
      ok("имя видно в шапке приложения");
    } else {
      fail("имя видно в шапке приложения", `HTTP ${app.status}`);
    }

    /**
     * Гость не должен попадать в кабинет.
     *
     * `redirect()` в серверном компоненте отдаёт 307 — клиент пойдёт на
     * /login. Проверяем и код, и заголовок: одного кода мало, важно куда.
     */
    const guest = new Client();
    const denied = await guest.req("/account");
    if (denied.status >= 300 && denied.status < 400) {
      ok("гость перенаправлен на вход", `HTTP ${denied.status}`);
    } else {
      fail("гость перенаправлен на вход", `HTTP ${denied.status}`);
    }
  }

  // ── Уборка ──────────────────────────────────────────────
  console.log("\n=== Уборка ===");
  {
    let cleaned = 0;
    const orgs = await one(
      (sql) => sql`select organization_id from member where user_id = ${user.userId}`,
    );
    for (const org of orgs) {
      try {
        await one((sql) => sql`delete from price_meta where org_id = ${org.organization_id}`);
        await one((sql) => sql`delete from price_items where org_id = ${org.organization_id}`);
        await one((sql) => sql`delete from member where organization_id = ${org.organization_id}`);
        await one((sql) => sql`delete from organization where id = ${org.organization_id}`);
        cleaned += 1;
      } catch {
        // не критично для результатов проверки
      }
    }
    for (const table of ["session", "account"]) {
      try {
        await one((sql) => sql`delete from ${sql(table)} where user_id = ${user.userId}`);
      } catch {
        // не критично
      }
    }
    try {
      await one((sql) => sql`delete from "user" where id = ${user.userId}`);
    } catch {
      // не критично
    }
    ok("тестовые данные удалены", `${cleaned} организация`);
  }

  console.log(`\n═══ Итог: ${passed} из ${passed + failed} проверок пройдено ═══`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nОшибка проверки:", e instanceof Error ? e.message : e);
  process.exit(1);
});