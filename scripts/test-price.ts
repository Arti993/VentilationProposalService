/**
 * Проверка своего прайса и изоляции цен между организациями.
 *
 * ЧТО ПРОВЕРЯЕМ И ПОЧЕМУ ИМЕННО ЭТО
 *
 * 1. Свой прайс действительно влияет на КП. Иначе весь пункт роадмапа —
 *    украшение: форма есть, а цены берутся из демо.
 * 2. Цены одной организации не видит другая. Это главный риск: прайс —
 *    коммерческая тайна, и утечка хуже отсутствия функции.
 * 3. Загрузка заменяет прайс, а не дополняет. Клиент должен получать
 *    актуальные цены, а не смесь старой и новой загрузки.
 * 4. Демо-прайс нельзя испортить: он общий для всех гостей.
 * 5. Плохие файлы отклоняются с понятным текстом, а не молча.
 *
 * ЗАПУСК
 *
 *   node --env-file=.env.local scripts/test-price.ts
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

/** Собирает .xlsx из массива строк — как файл, который пришлёт клиент. */
function makeXlsx(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Прайс");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Сессия одного пользователя: хранит cookie между запросами. */
class Client {
  private cookie: string | null = null;

  async req(
    path: string,
    opts: { method?: string; body?: BodyInit; json?: unknown } = {},
  ): Promise<{ status: number; data: Record<string, unknown> | null }> {
    const headers: Record<string, string> = { Origin: BASE };
    if (this.cookie) headers.Cookie = this.cookie;
    if (opts.json !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(BASE + path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
    });

    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length > 0) {
      this.cookie = set.map((c) => c.split(";")[0]).join("; ");
    }

    const ct = res.headers.get("content-type") ?? "";
    const data = ct.includes("json")
      ? ((await res.json().catch(() => null)) as Record<string, unknown> | null)
      : null;
    return { status: res.status, data };
  }

  /** Регистрирует нового пользователя (он же — новая организация). */
  async register(tag: string): Promise<{ email: string; userId: string }> {
    const email = `${tag}-${Date.now()}@test.local`;
    const res = await this.req("/api/auth/sign-up/email", {
      method: "POST",
      json: { name: `Тест ${tag}`, email, password: "test-password-123" },
    });
    if (res.status >= 400) {
      throw new Error(`регистрация не удалась: HTTP ${res.status}`);
    }
    const user = res.data?.user as { id?: string } | undefined;
    return { email, userId: user?.id ?? "" };
  }

  /** Загружает прайс файлом. */
  async uploadPrice(rows: unknown[][], fileName = "price.xlsx") {
    const buf = makeXlsx(rows);
    const form = new FormData();
    form.append("file", new Blob([buf]), fileName);
    return this.req("/api/price/upload", { method: "POST", body: form });
  }

  /** Считает смету из CSV. */
  async estimate(csv: string) {
    const form = new FormData();
    form.append("file", new Blob([csv]), "estimate.csv");
    return this.req("/api/estimate", { method: "POST", body: form });
  }
}

interface Position {
  name: string;
  status: string;
  unitPrice?: number;
  total?: number;
  confidence?: number;
}

/** Достаёт позиции и итог из ответа сметы. */
function positionsOf(data: Record<string, unknown> | null): {
  positions: Position[];
  totalSum: number;
} {
  const session = data?.session as { positions?: Position[]; stats?: { totalSum?: number } } | undefined;
  return {
    positions: session?.positions ?? [],
    totalSum: session?.stats?.totalSum ?? 0,
  };
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

async function main() {
  console.log(`Проверка своего прайса: ${BASE}\n`);

  // ── Сервер доступен? ────────────────────────────────────
  const probe = await new Client().req("/api/price/upload");
  if (probe.status !== 200 && probe.status !== 401) {
    console.log("  ✗ сервер недоступен — запустите npm run dev");
    process.exit(1);
  }
  ok("сервер доступен");

  const a = new Client();
  const b = new Client();
  const userA = await a.register("price-a");
  const userB = await b.register("price-b");
  ok("зарегистрированы две организации", `${userA.email}, ${userB.email}`);

  // ── 1. У новой организации прайса нет ───────────────────
  console.log("\n=== У новой организации прайса нет ===");
  {
    const res = await a.req("/api/price/upload");
    if (res.data?.total === 0) {
      ok("прайс пустой", "0 позиций");
    } else {
      fail("прайс пустой", `оказалось ${String(res.data?.total)}`);
    }
  }

  // ── 2. Загрузка своего прайса ───────────────────────────
  console.log("\n=== Свой прайс влияет на КП ===");
  {
    const res = await a.uploadPrice([
      ["Код", "Наименование", "Цена"],
      ["A-1", "Воздуховод спирально-навивной 315", 9999],
      ["A-2", "Тройник вентиляционный круглый 315/160", 8888],
    ]);

    if (res.status === 200 && res.data?.inserted === 2) {
      ok("прайс загружен", "2 позиции");
    } else {
      fail("прайс загружен", `HTTP ${res.status}: ${String(res.data?.error ?? "")}`);
    }

    // Смета по своим ценам: 9999 × 2 + 8888 = 28886
    const est = await a.estimate(
      "Наименование,Кол-во\nВоздуховод спирально-навивной 315,2\nТройник вентиляционный круглый 315/160,1\n",
    );
    const { positions, totalSum } = positionsOf(est.data);

    const duct = positions.find((p) => p.name.includes("Воздуховод"));
    const tee = positions.find((p) => p.name.includes("Тройник"));

    if (duct?.unitPrice === 9999) {
      ok("воздуховод по своей цене", "9999₽");
    } else {
      fail("воздуховод по своей цене", `получилось ${String(duct?.unitPrice)}`);
    }

    if (tee?.unitPrice === 8888) {
      ok("тройник по своей цене", "8888₽");
    } else {
      fail("тройник по своей цене", `получилось ${String(tee?.unitPrice)}`);
    }

    if (totalSum === 9999 * 2 + 8888) {
      ok("итог КП верный", `${totalSum}₽`);
    } else {
      fail("итог КП верный", `${totalSum}₽ вместо 28886₽`);
    }
  }

  // ── 3. Цены не видны другой организации ─────────────────
  console.log("\n=== Цены одной организации не видит другая ===");
  {
    // У Б прайса нет: та же смета должна остаться без цен
    const est = await b.estimate("Наименование,Кол-во\nВоздуховод спирально-навивной 315,2\n");
    const { positions, totalSum } = positionsOf(est.data);
    const duct = positions.find((p) => p.name.includes("Воздуховод"));

    if (duct?.status === "not_found" && duct.unitPrice === undefined) {
      ok("Б не получил цену А", `статус ${duct.status}`);
    } else {
      fail("Б не получил цену А", `статус ${String(duct?.status)}, цена ${String(duct?.unitPrice)}`);
    }

    if (totalSum === 0) {
      ok("итог Б пустой", "0₽");
    } else {
      fail("итог Б пустой", `${totalSum}₽ — цены просочились`);
    }

    // И свой прайс Б загружает независимо, с тем же кодом позиции
    const res = await b.uploadPrice([
      ["Код", "Наименование", "Цена"],
      ["A-1", "Воздуховод спирально-навивной 315", 111],
    ]);

    if (res.status === 200 && res.data?.inserted === 1) {
      ok("Б загрузил свой прайс с тем же кодом A-1", "код не конфликтует между организациями");
    } else {
      fail("Б загрузил свой прайс с тем же кодом A-1", `HTTP ${res.status}: ${String(res.data?.error ?? "")}`);
    }

    // У Б теперь своя цена, а у А — прежняя
    const estB = await b.estimate("Наименование,Кол-во\nВоздуховод спирально-навивной 315,1\n");
    const priceB = positionsOf(estB.data).positions[0]?.unitPrice;
    const estA = await a.estimate("Наименование,Кол-во\nВоздуховод спирально-навивной 315,1\n");
    const priceA = positionsOf(estA.data).positions[0]?.unitPrice;

    if (priceB === 111 && priceA === 9999) {
      ok("у каждой организации своя цена", `Б ${priceB}₽, А ${priceA}₽`);
    } else {
      fail("у каждой организации своя цена", `Б ${String(priceB)}₽, А ${String(priceA)}₽`);
    }
  }

  // ── 4. Загрузка заменяет прайс ──────────────────────────
  console.log("\n=== Загрузка заменяет прайс, а не дополняет ===");
  {
    const res = await a.uploadPrice([
      ["Наименование", "Цена"],
      ["Заглушка воздуховода торцевая (круглая) 315", 495],
    ]);

    if (res.status === 200 && res.data?.inserted === 1 && res.data?.removed === 2) {
      ok("старый прайс заменён", `удалено ${String(res.data.removed)}, вставлено 1`);
    } else {
      fail(
        "старый прайс заменён",
        `HTTP ${res.status}: удалено ${String(res.data?.removed)}, вставлено ${String(res.data?.inserted)}`,
      );
    }

    // Позиции, которой больше нет в прайсе, не должно быть в КП
    const est = await a.estimate(
      "Наименование,Кол-во\nВоздуховод спирально-навивной 315,1\nЗаглушка воздуховода торцевая (круглая) 315,1\n",
    );
    const { positions } = positionsOf(est.data);
    const duct = positions.find((p) => p.name.includes("Воздуховод"));
    const cap = positions.find((p) => p.name.includes("Заглушка"));

    if (duct?.status === "not_found") {
      ok("удалённая позиция больше не находит цену");
    } else {
      fail("удалённая позиция больше не находит цену", `статус ${String(duct?.status)}`);
    }

    if (cap?.unitPrice === 495) {
      ok("новая позиция находит цену", "495₽");
    } else {
      fail("новая позиция находит цену", `получилось ${String(cap?.unitPrice)}`);
    }
  }

  // ── 5. Плохие файлы отклоняются ─────────────────────────
  console.log("\n=== Плохие файлы отклоняются понятным текстом ===");
  {
    // Нет колонки с ценой
    const noPrice = await a.uploadPrice([["Наименование", "Количество"], ["Воздуховод 315", 5]]);
    if (noPrice.status === 422 && typeof noPrice.data?.hint === "string") {
      ok("файл без колонки «Цена» отклонён", String(noPrice.data.error));
    } else {
      fail("файл без колонки «Цена» отклонён", `HTTP ${noPrice.status}`);
    }

    // Цены не числа
    const noNumbers = await a.uploadPrice([
      ["Наименование", "Цена"],
      ["Воздуховод 315", "по запросу"],
      ["Тройник 315/160", "договорная"],
    ]);
    if (noNumbers.status === 422) {
      ok("файл без числовых цен отклонён", String(noNumbers.data?.error));
    } else {
      fail("файл без числовых цен отклонён", `HTTP ${noNumbers.status}`);
    }
  }

  // ── 6. Ни аноним, ни демо-прайс не перезаписать ──────────
  console.log("\n=== Защита демо-прайса и гостя ===");
  {
    const anon = new Client();
    const res = await anon.uploadPrice([["Наименование", "Цена"], ["Воздуховод 315", 1]]);
    if (res.status === 401) {
      ok("без входа загрузка запрещена", "HTTP 401");
    } else {
      fail("без входа загрузка запрещена", `HTTP ${res.status}`);
    }

    // Гость: вход анонимно, потом попытка загрузить прайс
    const guest = new Client();
    const anonRes = await guest.req("/api/auth/sign-in/anonymous", { method: "POST", json: {} });
    if (anonRes.status === 200) {
      const demoTry = await guest.uploadPrice([["Наименование", "Цена"], ["Воздуховод 315", 1]]);
      if (demoTry.status === 403) {
        ok("гость не может менять демо-прайс", "HTTP 403");
      } else {
        fail("гость не может менять демо-прайс", `HTTP ${demoTry.status}`);
      }
    } else {
      fail("анонимный вход", `HTTP ${anonRes.status}`);
    }

    // Демо-прайс цел: в нём по-прежнему 215 позиций
    const demo = await one((sql) => sql`select count(*)::int as n from price_items where org_id = 'org_demo'`);
    if (demo[0]?.n === 215) {
      ok("демо-прайс не пострадал", "215 позиций");
    } else {
      fail("демо-прайс не пострадал", `оказалось ${demo[0]?.n}`);
    }
  }

  // ── Уборка ──────────────────────────────────────────────
  console.log("\n=== Уборка ===");
  {
    let cleaned = 0;
    for (const userId of [userA.userId, userB.userId]) {
      if (!userId) continue;
      const orgs = await one(
        (sql) => sql`select organization_id from member where user_id = ${userId}`,
      );
      for (const org of orgs) {
        try {
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
          await one((sql) => sql`delete from ${sql(table)} where user_id = ${userId}`);
        } catch {
          // не критично
        }
      }
      try {
        await one((sql) => sql`delete from "user" where id = ${userId}`);
      } catch {
        // не критично
      }
    }
    ok("тестовые организации удалены", `${cleaned} шт`);
  }

  console.log(
    `\n═══ Итог: ${passed} из ${passed + failed} проверок пройдено ═══`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nОшибка проверки:", e instanceof Error ? e.message : e);
  process.exit(1);
});
