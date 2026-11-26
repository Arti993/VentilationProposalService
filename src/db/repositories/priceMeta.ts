/**
 * Сведения о загруженном прайсе организации.
 *
 * ОТДЕЛЬНО ОТ `price.ts`, ХОТЯ ТАБЛИЦЫ РЯДОМ
 *
 * `price.ts` — про позиции и цены: их читает матчер на каждый разбор
 * сметы, и там важна скорость и кэш. Здесь — одна строка-справка для
 * интерфейса. Смешивать их значило бы тащить в горячий путь лишние
 * запросы и усложнять кэш.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ
 *
 * Экран расчёта должен честно сказать «ваш прайс ещё не загружен, сейчас
 * считаем по тестовому». По позициям этого не определить: пустой
 * результат бывает и у демо-прайса, и у загруженного файла, из которого
 * ничего не разобралось. Это разные ситуации с разными советами.
 */

import { withRetry } from "@/db/connection";
import { DEMO_ORG_ID } from "@/lib/auth/org";

export interface PriceMeta {
  /** Имя файла, который загрузил человек. `null` — загружен до появления таблицы. */
  fileName: string | null;
  /** Сколько позиций разобралось в последней загрузке */
  itemCount: number | null;
  /** Когда загружен. `null` — неизвестно (старая загрузка) */
  uploadedAt: Date | null;
}

/**
 * Запоминает загрузку прайса.
 *
 * Вызывается из маршрута загрузки после успешной замены позиций.
 * Ошибка здесь не должна отменять загрузку: прайс уже сохранён, а
 * отсутствие имени файла — косметика. Поэтому исключение только
 * логируется вызывающим кодом.
 */
export async function savePriceMeta(
  orgId: string,
  fileName: string,
  itemCount: number,
): Promise<void> {
  await withRetry(
    async (sql) => {
      await sql`
        insert into price_meta (org_id, file_name, item_count, uploaded_at)
        values (${orgId}, ${fileName}, ${itemCount}, now())
        on conflict (org_id) do update
           set file_name   = excluded.file_name,
               item_count  = excluded.item_count,
               uploaded_at = excluded.uploaded_at
      `;
    },
    { label: "запись сведений о прайсе" },
  );
}

/**
 * Читает сведения о прайсе организации.
 *
 * Возвращает `null`, если записи нет. Это НЕ значит «прайса нет»: у
 * организаций, загрузивших прайс до появления таблицы, строки тоже нет.
 * Поэтому решение «свой прайс или демо» принимается по `isDemoOrg` и
 * числу позиций, а `priceMeta` только дополняет ответ именем файла.
 */
export async function getPriceMeta(orgId: string): Promise<PriceMeta | null> {
  if (!orgId || orgId === DEMO_ORG_ID) return null;

  const rows = await withRetry(
    (sql) =>
      sql<{ file_name: string; item_count: number; uploaded_at: Date }[]>`
        select file_name, item_count, uploaded_at
          from price_meta
         where org_id = ${orgId}
         limit 1
      `,
    { label: "чтение сведений о прайсе" },
  );

  const row = rows[0];
  if (!row) return null;

  return {
    fileName: row.file_name,
    itemCount: row.item_count,
    uploadedAt: row.uploaded_at,
  };
}