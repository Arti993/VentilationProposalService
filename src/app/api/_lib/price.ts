/**
 * Загрузка прайса для API-роутов.
 *
 * Прайс живёт в Postgres (таблица price_items). Поэтому функция стала
 * асинхронной: чтение из БД не может быть синхронным.
 *
 * Кэш остаётся — но уже в репозитории, со сроком 5 минут. Здесь только
 * тонкая обёртка, чтобы роуты не знали деталей хранения.
 */
import { loadPrice } from "@/db/repositories/price.ts";
import type { PriceItem } from "@/lib/price/normalize.ts";

/** Читает прайс из БД (с кэшем на 5 минут). */
export async function getPrice(): Promise<PriceItem[]> {
  return loadPrice();
}
