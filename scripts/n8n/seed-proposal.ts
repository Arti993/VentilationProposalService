/**
 * Создаёт демонстрационную смету в базе и сбрасывает отметку отправки.
 *
 * Запуск: node --env-file=.env.local scripts/n8n/seed-proposal.ts
 *
 * Зачем: чтобы проверить сценарий n8n, нужно новое КП, которое ещё не
 * отдавали автоматизации. Заодно сбрасываем notified_at у старой
 * тестовой сметы — иначе она уже «отправлена» и не появится в выдаче.
 */
import { withRetry } from "../../src/db/connection.ts";
import { saveSession } from "../../src/db/repositories/sessions.ts";
import { loadPrice } from "../../src/db/repositories/price.ts";
import { processEstimate } from "../../src/lib/matcher/hybrid.ts";
import type { EstimateSession } from "../../src/entities/estimate/model/types.ts";

const LINES = [
  "Воздуховод круглый 315, 10 м",
  "Тройник 315х200, 3 шт",
  "Отвод 90 градусов 250, 6 шт",
  "Хомут для воздуховода 315, 5 шт",
];

async function main() {
  const price = await loadPrice();
  console.log(`Прайс: ${price.length} позиций`);

  const results = await processEstimate(LINES, price, { useLlm: false });

  const positions: EstimateSession["positions"] = results.map((r, i) => ({
    posNo: i + 1,
    lineNo: i + 1,
    name: LINES[i],
    qty: r.qty ?? 1,
    unit: r.unit ?? "шт",
    // Статус берём как есть — в hybrid.ts он уже называется priced /
    // not_found / needs_human. Прежняя версия этого скрипта проверяла
    // r.status === "matched", такого значения не существует, и все
    // позиции молча становились «без цены». Смета с нулевой суммой
    // дальше отсекается в эндпоинте (priced_count > 0) — то есть
    // ошибка была невидимой: сценарий просто ничего не присылал.
    status: r.status,
    unitPrice: r.item?.price,
    total: r.item?.price !== undefined ? r.item.price * (r.qty ?? 1) : undefined,
    matchedName: r.item?.name,
    source: r.status === "priced" ? "deterministic" : undefined,
    confidence: r.confidence,
  }));

  const priced = positions.filter((p) => p.status === "priced");
  const totalSum = priced.reduce((s, p) => s + (p.total ?? 0), 0);

  const session: EstimateSession = {
    name: "смета-от-клиента-ноябрь.xlsx",
    loadedAt: new Date().toISOString(),
    positions,
    stats: {
      total: positions.length,
      priced: priced.length,
      notFound: positions.filter((p) => p.status === "not_found").length,
      needsHuman: positions.filter((p) => p.status === "needs_human").length,
      offTopic: 0,
      totalSum,
      attention: positions.filter((p) => p.status !== "priced").length,
    },
  };

  const id = crypto.randomUUID();
  await saveSession(id, session);
  console.log(`Смета создана: ${id}`);
  console.log(`  позиций: ${session.stats.total}, с ценой: ${session.stats.priced}, сумма: ${totalSum} ₽`);

  // Сбрасываем отметку у прошлых тестовых смет, чтобы сценарий их увидел
  const reset = await withRetry(
    async (sql) =>
      sql<{ id: string }[]>`
        update estimates set notified_at = null
         where expires_at > now() and priced_count > 0
        returning id
      `,
    { label: "сброс отметки" },
  );
  console.log(`Сброшена отметка у ${reset.length} смет — сценарий их увидит`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
