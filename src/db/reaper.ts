/**
 * Уборка зависших транзакций.
 *
 * ОТКУДА ЭТО ВЗЯЛОСЬ
 *
 * Разбор падений регистрации занял часы. Итоговая цепочка оказалась
 * такой (подробно — docs/INCIDENT-SIGNUP.md):
 *
 *  1. `postgres.js` при обрыве соединения не закрывает транзакцию.
 *     На сервере она остаётся в состоянии `idle in transaction` — то
 *     есть PostgreSQL держит открытую транзакцию и её блокировки.
 *  2. Зависшие транзакции копятся. Дошло до шести одновременных.
 *  3. Начали падать даже два `select` подряд внутри транзакции.
 *     Каждое падение оставляло ещё одну зависшую транзакцию.
 *  4. Получился порочный круг: падения порождают утечки, утечки
 *     вызывают падения.
 *
 * После ручной чистки (pg_terminate_backend) четыре транзакции из
 * четырёх прошли за 360 мс, утечек — ноль. Круг замкнулся.
 *
 * ЗАЧЕМ ЭТОТ МОДУЛЬ
 *
 * Тот же эффект может случиться у любого пользователя: сеть моргнула на
 * середине транзакции — сессия осталась висеть. Само не рассосётся:
 * PostgreSQL не закрывает такие сессии сам (таймаут по умолчанию 0 —
 * «никогда»).
 *
 * Поэтому раз в сутки, при первом запросе к сервису, убираем свои
 * зависшие сессии. Чужие не трогаем: в базе могут быть миграции и наш же
 * CLI.
 */

import { runIsolated } from "./client.ts";

/** Возраст, после которого сессия считается брошенной. */
const STALE_AFTER = "10 minutes";

/**
 * Снимает зависшие транзакции ЭТОГО приложения.
 *
 * `application_name` выставляется в `createClient`, поэтому фильтр
 * работает точно: миграции и скрипты из терминала сюда не попадают.
 */
export async function reapStaleTransactions(): Promise<number> {
  try {
    return await runIsolated(async (_db, sql) => {
      const rows = await sql<{ pid: number }[]>`
        select pid from pg_stat_activity
         where datname = current_database()
           and state like 'idle in transaction%'
           and state_change < now() - ${STALE_AFTER}::interval
           and application_name = 'kp-service'
      `;

      let killed = 0;
      for (const row of rows) {
        try {
          await sql`select pg_terminate_backend(${row.pid})`;
          killed += 1;
        } catch {
          // Не удалось — не страшно, попробуем на следующем запуске
        }
      }

      if (killed > 0) {
        console.warn(`[db] снято зависших транзакций: ${killed}`);
      }
      return killed;
    });
  } catch {
    // Уборка не должна ломать основной сценарий
    return 0;
  }
}
