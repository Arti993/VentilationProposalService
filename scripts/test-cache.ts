/**
 * Проверяет выигрыш от кэша эмбеддингов.
 *
 * Запуск: node --env-file=.env.local scripts/test-cache.ts
 */
import { hybridSearch } from "../src/lib/rag/hybrid.ts";
import { clearEmbedCache } from "../src/lib/rag/embed.ts";

async function main() {
  const q = "отвод 90 градусов 250";

  console.log("Первый запрос (кэш пуст):");
  let t = Date.now();
  await hybridSearch(q, { limit: 3 });
  const cold = Date.now() - t;
  console.log(`  ${cold} мс`);

  console.log("\nПовтор того же запроса (из кэша):");
  t = Date.now();
  await hybridSearch(q, { limit: 3 });
  const warm = Date.now() - t;
  console.log(`  ${warm} мс`);

  console.log("\nДругой запрос (снова холодный):");
  t = Date.now();
  await hybridSearch("тройник 315 на 200", { limit: 3 });
  console.log(`  ${Date.now() - t} мс`);

  console.log(`\nЭкономия на повторе: ${cold - warm} мс (${Math.round((1 - warm / cold) * 100)}%)`);

  clearEmbedCache();
  console.log("Кэш очищен");
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
