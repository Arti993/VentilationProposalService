/**
 * Загрузка прайса.
 *
 * В прототипе прайс лежит файлом в репозитории и нормализуется на старте.
 * Кэшируем результат в globalThis, чтобы не парсить 215 строк на каждый
 * запрос (в dev-режиме модули перезагружаются).
 */
import fs from "node:fs";
import path from "node:path";
import type { PriceItem } from "@/lib/price/normalize.ts";

const globalCache = globalThis as unknown as {
  __priceCache?: PriceItem[];
};

/**
 * Читает нормализованный прайс.
 *
 * Берём именно price.normalized.json: он получен прогоном нормализатора и
 * проверен (215/215 строк). Нормализовать на лету означало бы гонять regex
 * по 215 строкам при каждом холодном старте.
 */
export function getPrice(): PriceItem[] {
  if (globalCache.__priceCache) return globalCache.__priceCache;

  const file = path.join(process.cwd(), "data", "price.normalized.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      "Прайс не найден: data/price.normalized.json. Запустите: node scripts/normalize-price.ts",
    );
  }

  const price = JSON.parse(fs.readFileSync(file, "utf8")) as PriceItem[];
  globalCache.__priceCache = price;
  return price;
}
