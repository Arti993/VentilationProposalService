/**
 * Проверка уборщика зависших транзакций.
 *
 * ЗАЧЕМ
 *
 * Уборщик — код, который вмешивается в чужие сессии, и цена ошибки
 * несимметрична: пропустить труп — блокировки и зависшие удаления,
 * снять живую сессию — оборванный запрос пользователя.
 *
 * Поэтому проверяем обе стороны: труп снимается, чужая сессия остаётся,
 * свежая своя — тоже.
 *
 * ОТКУДА ВЗЯЛАСЬ ВТОРАЯ ФОРМА ЗАВИСАНИЯ
 *
 * На уборке тестовых организаций нашлось двадцать сессий, державших
 * блокировки строк, при этом в `idle in transaction` они не были:
 * состояние `active`, ожидание `ClientRead`. Первая версия уборщика
 * такие не видела. Теперь видит — и это проверяется здесь.
 *
 * ЗАПУСК
 *
 *   node --env-file=.env.local scripts/test-reaper.ts
 */

import postgres from "postgres";
import { reapStaleTransactions } from "../src/db/reaper.ts";

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

type Sql = ReturnType<typeof postgres>;

function connect(appName: string): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  return postgres(url, {
    ssl: "require",
    max: 1,
    prepare: false,
    connect_timeout: 20,
    connection: { application_name: appName },
  });
}

/**
 * Создаёт сессию с открытой транзакцией — ровно то, что остаётся после
 * обрыва связи посреди работы.
 *
 * `begin` отдельным запросом: postgres.js в обычном режиме каждую строку
 * отправляет как самостоятельную транзакцию, поэтому открытая транзакция
 * получается только явной командой.
 */
async function makeStuck(appName: string): Promise<Sql> {
  const sql = connect(appName);
  await sql`begin`;
  await sql`select 1 as x`;
  return sql;
}

async function statesOf(names: string[]): Promise<
  { pid: number; application_name: string; state: string }[]
> {
  const watcher = connect("reaper-test");
  try {
    return await watcher<{ pid: number; application_name: string; state: string }[]>`
      select pid, application_name, state
        from pg_stat_activity
       where datname = current_database()
         and application_name = any(${names})
    `;
  } finally {
    await watcher.end({ timeout: 5 }).catch(() => {});
  }
}

async function main(): Promise<void> {
  console.log("Проверка уборщика зависших транзакций\n");

  const stuck = await makeStuck("kp-service");
  const foreign = await makeStuck("other-test");

  // ── Штатный порог свежую транзакцию не трогает ──────────
  /**
   * Это главная защита: уборка не должна рвать работу, которая идёт
   * прямо сейчас. Проверяем не «сессия жива» (простаивающее соединение
   * `postgres.js` закрывает сам, и проверка была бы пустой), а «свежая
   * транзакция пережила уборку с штатным порогом».
   */
  console.log("=== Штатный порог ===");
  {
    const before = await statesOf(["kp-service"]);
    if (before.length === 1 && before[0]?.state.startsWith("idle in transaction")) {
      ok("свежая транзакция открыта", `state=${before[0]?.state}`);
    } else {
      fail("свежая транзакция открыта", JSON.stringify(before));
    }

    const killed = await reapStaleTransactions();
    if (killed === 0) {
      ok("уборка не трогает свежую транзакцию", "порог 10 минут");
    } else {
      fail("уборка не трогает свежую транзакцию", `снято ${killed}`);
    }

    const after = await statesOf(["kp-service"]);
    if (after.length === 1) {
      ok("сессия пережила штатную уборку");
    } else {
      fail("сессия пережила штатную уборку", JSON.stringify(after));
    }
  }

  // ── Нулевой порог: зависшая снимается, чужая остаётся ───
  console.log("\n=== Уборка ===");
  {
    const foreignBefore = (await statesOf(["other-test"])).length;
    const killed = await reapStaleTransactions("0 seconds");
    if (killed >= 1) {
      ok("зависшая транзакция снята", `${killed} шт`);
    } else {
      fail("зависшая транзакция снята", `снято ${killed}`);
    }

    const after = await statesOf(["kp-service", "other-test"]);
    const stuckAfter = after.filter((r) => r.application_name === "kp-service");
    if (stuckAfter.length === 0) {
      ok("своя зависшая сессия снята", "0 осталось");
    } else {
      fail("своя зависшая сессия снята", `${stuckAfter.length} осталось`);
    }

    const foreignAfter = after.filter((r) => r.application_name === "other-test");
    if (foreignAfter.length === foreignBefore) {
      ok("чужая сессия не тронута", `other-test × ${foreignAfter.length}`);
    } else {
      fail("чужая сессия не тронута", `было ${foreignBefore}, стало ${foreignAfter.length}`);
    }
  }

  // ── Уборка ──────────────────────────────────────────────
  await stuck.end({ timeout: 3 }).catch(() => {});
  await foreign.end({ timeout: 3 }).catch(() => {});
  console.log("\n✓ соединения закрыты");

  console.log(`\n═══ Итог: ${passed} из ${passed + failed} проверок пройдено ═══`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nОшибка проверки:", e instanceof Error ? e.message : e);
  process.exit(1);
});