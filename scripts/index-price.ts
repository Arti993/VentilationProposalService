/**
 * Считает эмбеддинги для всех позиций прайса.
 *
 * Запуск: node --env-file=.env.local scripts/index-price.ts
 *
 * Идемпотентно: берёт только те строки, где эмбеддинга ещё нет или он
 * устарел (название изменилось). Повторный запуск ничего не пересчитывает.
 *
 * Почему по одной строке за записи, а не одним UPDATE: лимит пулера Neon
 * на объём запроса. Вектор из 1024 чисел в текстовом виде — это ~10 КБ,
 * и пачка из нескольких штук уже рвёт соединение.
 */
import { connectOnce, closeQuietly, withRetry } from "../src/db/connection.ts";
import { embedTexts, itemEmbeddingText, toVectorLiteral } from "../src/lib/rag/embed.ts";

const BATCH = 8;

/**
 * Пауза между записями.
 *
 * Пулер Neon закрывает соединение, если запросы идут слишком плотно:
 * 16 записей подряд без задержки стабильно рвали соединение, хотя
 * каждая по отдельности проходила. 120 мс — запас, полная индексация
 * 215 позиций занимает ~30 секунд.
 */
const PAUSE_MS = 120;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  id: number;
  code: string;
  raw_name: string;
  type: string;
  dims_key: string;
  angle: number | null;
}

async function main() {
  // Каждый запрос — со своим соединением и с ретраем.
  //
  // Здесь была ошибка, стоившая часа отладки: два запроса подряд в ОДНОМ
  // соединении. Первый проходит, второй пулер рвёт с CONNECTION_CLOSED.
  // Ошибка выглядела как проблема записи вектора, хотя падение случалось
  // до всякой записи — на чтении списка строк.
  const cnt = await withRetry(
    async (sql) => sql<{ n: string }[]>`SELECT count(*)::text AS n FROM price_items`,
    { label: "count" },
  );
  const total = Number(cnt[0]!.n);

  // Берём строки без эмбеддинга ПОСТРАНИЧНО.
  //
  // Замерено: один SELECT всех 199 строк роняет соединение — ответ слишком
  // велик для пулера. По 20 строк проходит стабильно. Та же причина, что
  // заставила сделать постраничное чтение прайса в репозитории.
  const todo: Row[] = [];
  let lastId = 0;
  for (let page = 0; page < 100; page++) {
    const rows = await withRetry(
      async (sql) => sql<Row[]>`
        SELECT id, code, raw_name, type, dims_key, angle
        FROM price_items
        WHERE embedding IS NULL AND id > ${lastId}
        ORDER BY id
        LIMIT 20
      `,
      { label: `todo page ${page}` },
    );
    todo.push(...rows);
    if (rows.length < 20) break;
    lastId = rows[rows.length - 1]!.id;
    await sleep(PAUSE_MS);
  }

  console.log(`Всего в прайсе: ${total}`);
  console.log(`Без эмбеддинга: ${todo.length}`);

  if (todo.length === 0) {
    console.log("\nВсё уже проиндексировано. Ничего делать не нужно.");
    return;
  }

  const started = Date.now();
  let done = 0;

  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);

    const texts = chunk.map((r) =>
      itemEmbeddingText({
        rawName: r.raw_name,
        type: r.type,
        dimsKey: r.dims_key,
        angle: r.angle,
      }),
    );

    let vectors: number[][];
    try {
      vectors = await embedTexts(texts);
    } catch (e) {
      console.error(`\nОШИБКА ЭМБЕДДИНГОВ на пачке ${i}-${i + chunk.length}:`);
      console.error("  первая строка:", chunk[0]?.code, chunk[0]?.raw_name);
      throw e;
    }

    // Запись по одной: вектор в текстовом виде ~7.7 КБ после округления,
    // пачка из нескольких штук рвёт пулер Neon.
    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j]!;
      const vec = toVectorLiteral(vectors[j]!);

      await withRetry(
        async (conn) => {
          // conn приходит от withRetry — своё соединение открывать нельзя:
          // оно не закроется, и пулер упрётся в лимит подключений.
          await conn`
            UPDATE price_items
            SET embedding = ${vec}::vector, embedded_at = now()
            WHERE id = ${row.id}
          `;
        },
        { label: `update ${row.code}`, retries: 5 },
      );

      done++;

      // Небольшая пауза между записями внутри пачки: пулер рвёт
      // соединение при плотном потоке запросов.
      if (j < chunk.length - 1) await sleep(PAUSE_MS);
    }

    // Пауза после пачки — чтобы пулер успел освободить соединения
    await sleep(PAUSE_MS);

    const pct = Math.round((done / todo.length) * 100);
    process.stdout.write(`\r  проиндексировано ${done}/${todo.length} (${pct}%)`);
  }

  const sec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n\nГотово за ${sec} с`);

  // Проверка результата. Каждый запрос — своё соединение (см. комментарий
  // в начале main: два запроса подряд в одном соединении рвутся).
  const after = await withRetry(
    async (sql) => sql<{ n: string; indexed: string }[]>`
      SELECT count(*)::text AS n,
             count(embedding)::text AS indexed
      FROM price_items
    `,
    { label: "verify" },
  );
  const n = Number(after[0]!.n);
  const indexed = Number(after[0]!.indexed);
  console.log(`В базе: ${n} позиций, с вектором: ${indexed}`);

  if (indexed !== n) {
    console.error(`ПРОВАЛ: ${n - indexed} позиций остались без вектора`);
    process.exitCode = 1;
  } else {
    const probe = await withRetry(
      async (sql) => sql<{ code: string; raw_name: string }[]>`
        SELECT code, raw_name FROM price_items
        WHERE code IN ('p106', 'p006', 'p195') ORDER BY code
      `,
      { label: "probe" },
    );
    console.log("Контрольные позиции:", probe.map((r) => `${r.code} ${r.raw_name}`).join("; "));
    console.log("OK: прайс проиндексирован полностью");
  }
}

main().catch((e) => {
  console.error("\nОШИБКА:", e instanceof Error ? e.message : e);
  if (e instanceof Error && e.stack) {
    console.error("\nСтек:");
    console.error(e.stack.split("\n").slice(1, 8).join("\n"));
  }
  process.exit(1);
});
