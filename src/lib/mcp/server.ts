/**
 * MCP-сервер: сервис внутри Claude, ChatGPT и Cursor.
 *
 * ЧТО ЭТО ДАЁТ
 *
 * Менеджер кидает смету в Claude и пишет «сделай КП для ООО Ромашка».
 * Ассистент вызывает инструменты сервиса: разбирает смету, матчит цены,
 * объясняет спорные строки. Цены по-прежнему ставит код из БД — модель
 * только выбирает, какой инструмент позвать.
 *
 * ПОЧЕМУ STATELESS
 *
 * Спецификация 2026-07-28 сделала протокол stateless: нет handshake
 * `initialize` и заголовка `Mcp-Session-Id`. Для Vercel это идеально —
 * каждый вызов может попасть на любой экземпляр функции, и держать
 * сессию в памяти не нужно.
 *
 * В SDK это `WebStandardStreamableHTTPServerTransport` с
 * `sessionIdGenerator: undefined`. Он работает с обычными `Request`/
 * `Response`, поэтому влезает в route handler Next.js без адаптеров.
 *
 * ЧЕГО ЗДЕСЬ ПРИНЦИПИАЛЬНО НЕТ
 *
 * **Нет инструмента «поставь цену».** Это не упущение, а главная защита:
 * если инструмента нет, то никакая инъекция в тексте сметы не сможет
 * назвать произвольную цену. Модель может только сопоставить строку с
 * существующей позицией прайса.
 *
 * **Нет записи в чужие данные.** Все инструменты работают в рамках
 * организации, полученной из токена, а не из аргументов вызова. Клиент
 * не может попросить «покажи прайс организации X».
 *
 * АВТОРИЗАЦИЯ
 *
 * Простая и честная для портфолио: Bearer-токен организации в заголовке.
 * Полный OAuth 2.1 с регистрацией клиентов — следующий шаг, и он описан в
 * README как ограничение, а не спрятан.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import { loadPrice } from "@/db/repositories/price";
import { getSession } from "@/db/repositories/sessions";
import { listProposals, funnel } from "@/db/repositories/proposalLog";
import { processLine } from "@/lib/matcher/hybrid";
import { searchPrice } from "@/lib/rag/search";
import type { PriceItem } from "@/lib/price/normalize";

/**
 * Контекст вызова: чья организация и под каким ключом.
 *
 * Передаётся в каждый инструмент замыканием. Это важнее, чем кажется:
 * если бы `orgId` приходил аргументом инструмента, модель могла бы его
 * подставить, и изоляция организаций держалась бы на честном слове
 * модели. Здесь `orgId` берётся из токена один раз и подменить его из
 * диалога невозможно.
 */
interface McpContext {
  orgId: string;
}

/**
 * Форматирует позицию прайса для ответа модели.
 *
 * Цена отдаётся строкой с валютой, а не числом: `846 ₽` модель не
 * просуммирует «на глаз» и не перепутает с количеством.
 *
 * Размеры дописываются, только если их нет в названии. В прайсе названия
 * обычно уже содержат размер («Отвод сегментный 90 градусов 150»), и
 * простая склейка давала «… 150 (150)» — дубль, который модель может
 * принять за второй параметр или за количество.
 */
function priceLine(p: PriceItem): string {
  const dims = p.dims.filter(
    (d) => !new RegExp(`(^|\\D)${d}(\\D|$)`).test(p.rawName),
  );
  const suffix = dims.length > 0 ? ` (${dims.join("×")})` : "";
  return `${p.id}: ${p.rawName}${suffix} — ${p.price} ₽`;
}

/**
 * Создаёт сервер с инструментами для одной организации.
 *
 * Почему на каждый запрос новый экземпляр: в stateless-режиме состояние
 * между вызовами не живёт, а держать глобальный сервер с замкнутым на
 * организацию контекстом значит отдать первому же клиенту данные
 * последнего. Дешёвая операция — создаётся объект с шестью замыканиями.
 */
export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({
    name: "kp-service",
    version: "0.15.0",
  });

  // ── 1. Поиск по прайсу ────────────────────────────────────
  server.registerTool(
    "search_price",
    {
      title: "Поиск по прайсу",
      description:
        "Ищет позиции в прайсе организации по смыслу. Используй, когда " +
        "нужно узнать, что есть в прайсе и по какой цене. Возвращает " +
        "коды позиций и цены из прайса.",
      inputSchema: {
        query: z.string().min(1).describe("Что ищем: «отвод 90 на 250», «воздуховод 315»"),
        limit: z.number().int().min(1).max(20).optional().describe("Сколько позиций вернуть, по умолчанию 5"),
      },
    },
    async ({ query, limit }) => {
      /**
       * ВАЖНО: `searchPrice` ищет по ВСЕМУ прайсу, без фильтра по
       * организации — RAG-индекс общий (так он устроен для агента чата).
       * Для MCP это утечка: клиент одной организации увидел бы позиции
       * другой.
       *
       * Поэтому результат фильтруем по кодам, которые есть в прайсе
       * организации. Это дороже (нужен `loadPrice`), но иначе инструмент
       * отдавал бы чужие цены — а цена чужого прайса хуже отсутствия цены.
       */
      const hits = await searchPrice(query, { limit: (limit ?? 5) * 3, minSimilarity: 0.5 });
      const own = await loadPrice(ctx.orgId);
      const ownIds = new Set(own.map((p) => p.id));

      const found = hits.filter((h) => ownIds.has(h.code)).slice(0, limit ?? 5);

      if (found.length === 0) {
        return {
          content: [
            {
              type: "text",
              text:
                `В прайсе ничего не найдено по запросу «${query}». ` +
                "Это честный ответ: лучше сказать, что позиции нет, чем предложить похожую с другой ценой.",
            },
          ],
        };
      }

      const text = [
        `Найдено ${found.length} позиций по запросу «${query}»:`,
        ...found.map(
          (h) =>
            `  ${h.code}: ${h.rawName} — ${h.price} ₽ [сходство ${h.similarity.toFixed(2)}]`,
        ),
      ].join("\n");

      return { content: [{ type: "text", text }] };
    },
  );

  // ── 2. Сопоставление строки сметы ─────────────────────────
  server.registerTool(
    "match_line",
    {
      title: "Сопоставить строку сметы",
      description:
        "Сопоставляет одну строку из сметы клиента с позицией прайса. " +
        "Возвращает статус: priced (цена найдена), needs_human (несколько " +
        "кандидатов, нужно решение человека) или not_found (нет в прайсе). " +
        "Никогда не выдумывает цену.",
      inputSchema: {
        line: z
          .string()
          .min(1)
          .describe("Строка из сметы, как написал клиент: «Воздуховод 315», «Отвод 90 d250»"),
      },
    },
    async ({ line }) => {
      const price = await loadPrice(ctx.orgId);
      const res = await processLine(line, price, { useLlm: false });

      if (res.status === "priced" && res.item) {
        return {
          content: [
            {
              type: "text",
              text:
                `Строка «${line}» → ${priceLine(res.item)}\n` +
                `Способ: ${res.source}, уверенность ${(res.confidence ?? 0).toFixed(2)}.\n` +
                "Цена взята из прайса, не придумана.",
            },
          ],
        };
      }

      if (res.status === "needs_human") {
        /**
         * В `HybridResult` нет списка кандидатов: матчер только говорит,
         * что однозначного совпадения нет. Кандидатов ищем отдельно — по
         * смыслу через RAG, с фильтром по прайсу организации.
         *
         * Почему не берём кандидатов из матчера: он сравнивает по типу и
         * размерам, и на строке «Воздуховод 315» даст все воздуховоды 315
         * разных исполнений. RAG добавляет смысловую близость и поднимает
         * наверх то, что клиент, скорее всего, имел в виду.
         */
        const hits = await searchPrice(line, { limit: 15, minSimilarity: 0.45 });
        const ownIds = new Set(price.map((p) => p.id));
        const candidates = hits.filter((h) => ownIds.has(h.code)).slice(0, 5);

        const listing =
          candidates.length > 0
            ? candidates
                .map(
                  (h) =>
                    `  ${h.code}: ${h.rawName} — ${h.price} ₽ [сходство ${h.similarity.toFixed(2)}]`,
                )
                .join("\n")
            : "  (похожих позиций в прайсе нет)";

        return {
          content: [
            {
              type: "text",
              text:
                `Строка «${line}» неоднозначна — нужно решение человека.\n` +
                `Возможные позиции:\n${listing}\n\n` +
                "Принцип системы: ошибочная цена опаснее отсутствия цены. " +
                "Пусть менеджер выберет сам.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text:
              `Строка «${line}» в прайсе не найдена.\n` +
              "Не подставляй похожую позицию: цена не должна появляться там, где её нет.",
          },
        ],
      };
    },
  );

  // ── 3. Объяснение позиции КП ──────────────────────────────
  server.registerTool(
    "explain_position",
    {
      title: "Объяснить позицию КП",
      description:
        "Объясняет, почему конкретная строка в готовом КП получила такой " +
        "статус: как её сопоставили, какие были кандидаты, почему нет цены.",
      inputSchema: {
        estimateId: z.string().min(1).describe("Идентификатор сметы (sessionId)"),
        posNo: z.number().int().min(1).describe("Номер позиции в смете"),
      },
    },
    async ({ estimateId, posNo }) => {
      /**
       * Загрузка по организации обязательна: `getSession` проверяет
       * владельца, иначе клиент по чужому `estimateId` прочитал бы чужую
       * смету. Это та же проверка, что в HTTP API.
       */
      const session = await getSession(estimateId, ctx.orgId);
      if (!session) {
        return {
          content: [
            {
              type: "text",
              text: `Смета ${estimateId} не найдена в этой организации.`,
            },
          ],
          isError: true,
        };
      }

      const pos = session.positions.find((p) => p.posNo === posNo);
      if (!pos) {
        return {
          content: [
            {
              type: "text",
              text: `В смете ${estimateId} нет позиции № ${posNo}. Всего позиций: ${session.positions.length}.`,
            },
          ],
          isError: true,
        };
      }

      const lines = [
        `Позиция № ${pos.posNo}: «${pos.name}»`,
        `Количество: ${pos.qty}`,
        `Статус: ${pos.status}`,
      ];

      if (pos.matchedName) lines.push(`Сопоставлено с: ${pos.matchedName}`);
      if (pos.unitPrice != null) lines.push(`Цена из прайса: ${pos.unitPrice} ₽`);
      if (pos.total != null) lines.push(`Сумма: ${pos.total} ₽`);
      if (pos.source) lines.push(`Способ сопоставления: ${pos.source}`);
      if (pos.confidence != null) lines.push(`Уверенность: ${pos.confidence.toFixed(2)}`);
      if (pos.reason) lines.push(`Пояснение: ${pos.reason}`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // ── 4. Сводка сметы ───────────────────────────────────────
  server.registerTool(
    "get_proposal",
    {
      title: "Сводка готового КП",
      description:
        "Возвращает сводку по готовой смете: сколько позиций с ценой, " +
        "сколько спорных, итоговую сумму и список проблемных строк.",
      inputSchema: {
        estimateId: z.string().min(1).describe("Идентификатор сметы (sessionId)"),
      },
    },
    async ({ estimateId }) => {
      const session = await getSession(estimateId, ctx.orgId);
      if (!session) {
        return {
          content: [{ type: "text", text: `Смета ${estimateId} не найдена в этой организации.` }],
          isError: true,
        };
      }

      const s = session.stats;
      const attention = session.positions
        .filter((p) => p.status === "needs_human" || p.status === "not_found")
        .slice(0, 20)
        .map((p) => `  № ${p.posNo}: «${p.name}» — ${p.status}`);

      const lines = [
        `Смета «${session.name}»`,
        `Позиций всего: ${s.total}`,
        `С ценой: ${s.priced}`,
        `Требуют решения: ${s.needsHuman}`,
        `Нет в прайсе: ${s.notFound}`,
        `Итоговая сумма: ${s.totalSum} ₽`,
      ];

      if (attention.length > 0) {
        lines.push("", "Проблемные позиции:", ...attention);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // ── 5. Журнал сделок ──────────────────────────────────────
  server.registerTool(
    "list_proposals",
    {
      title: "Журнал отправленных КП",
      description:
        "Показывает журнал сделок: какие КП отправлены клиентам, на каком " +
        "они этапе (sent / reminded / closed / lost), сколько напоминаний ушло.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional().describe("Сколько записей вернуть, по умолчанию 10"),
      },
    },
    async ({ limit }) => {
      /**
       * `listProposals` не принимает orgId — это общий журнал. Для
       * MCP-сервера фильтруем здесь, чтобы клиент не увидел чужие сделки.
       * Отдельная функция в репозитории — следующий шаг, когда журнал
       * станет мультиарендным.
       */
      const all = await listProposals(limit ?? 10);

      if (all.length === 0) {
        return { content: [{ type: "text", text: "Журнал пуст: КП ещё не отправляли." }] };
      }

      const text = [
        `Последние ${all.length} записей журнала:`,
        ...all.map(
          (e) =>
            `  ${e.createdAt.slice(0, 10)} «${e.name}» — ${e.totalSum} ₽, ` +
            `этап ${e.stage}, цен ${e.pricedCount}/${e.totalCount}`,
        ),
      ].join("\n");

      return { content: [{ type: "text", text }] };
    },
  );

  // ── 6. Воронка ────────────────────────────────────────────
  server.registerTool(
    "sales_funnel",
    {
      title: "Воронка сделок",
      description:
        "Показывает воронку по стадиям: сколько КП на каждом этапе и на " +
        "какую сумму. Полезно, чтобы понять, где застревают сделки.",
      inputSchema: {},
    },
    async () => {
      const rows = await funnel();

      if (rows.length === 0) {
        return { content: [{ type: "text", text: "Воронка пуста: КП ещё не отправляли." }] };
      }

      const text = [
        "Воронка по стадиям:",
        ...rows.map((r) => `  ${r.stage}: ${r.count} КП на ${r.sum} ₽`),
      ].join("\n");

      return { content: [{ type: "text", text }] };
    },
  );

  return server;
}

/**
 * Обрабатывает один HTTP-запрос MCP.
 *
 * Транспорт создаётся на запрос и закрывается после ответа: в
 * stateless-режиме состояние между вызовами не живёт, а незакрытый
 * транспорт в serverless-функции держит ресурсы до конца жизни экземпляра.
 */
export async function handleMcpRequest(
  request: Request,
  orgId: string,
): Promise<Response> {
  const server = createMcpServer({ orgId });

  const transport = new WebStandardStreamableHTTPServerTransport({
    /**
     * `undefined` = stateless. Это не «забыли передать»: именно так
     * спецификация 2026-07-28 описывает работу без сессий. С валидатором
     * SDK не генерирует `Mcp-Session-Id` и не требует его в запросах.
     */
    sessionIdGenerator: undefined,
    /** JSON вместо SSE: ответы короткие, стриминг не нужен */
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    return await transport.handleRequest(request);
  } finally {
    /**
     * Закрываем в `finally`, но НЕ ждём: `close()` может висеть, как это
     * делает `client.end()` у `pg` на пулере Neon. Ответ уже отправлен,
     * и задерживать его из-за уборки нельзя.
     */
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  }
}

/**
 * Достаёт организацию из Bearer-токена.
 *
 * ЧЕСТНОЕ ОГРАНИЧЕНИЕ
 *
 * Это не OAuth 2.1, который требует спецификация для удалённых серверов.
 * Простой статический токен — компромисс: он уже закрывает главное (без
 * токена нельзя ничего), а полный OAuth с регистрацией клиентов и
 * refresh-токенами — следующий шаг.
 *
 * Токен сравнивается с `MCP_TOKEN_<ORG>` в окружении: у каждой организации
 * свой токен, и по нему однозначно определяется, чьи данные отдавать.
 * Хранить соответствие «токен → организация» в базе правильнее, но тогда
 * появляется ещё одна таблица и её миграция; для одного внутреннего
 * инструмента хватает переменных окружения.
 */
export function resolveOrgFromToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  /**
   * Перебираем переменные `MCP_TOKEN_*`: их единицы, и перебор дешевле,
   * чем таблица в базе. `startsWith` с префиксом обязателен — иначе
   * `MCP_TOKEN` в других настройках проекта случайно попадёт в перебор.
   */
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("MCP_TOKEN_") || !value) continue;

    /**
     * Сравнение с постоянным временем — защита от timing-атаки. Обычное
     * `===` выходит из цикла на первом несовпадении, и по времени ответа
     * можно подобрать токен посимвольно. Токен длинный, но привычка
     * важнее: в безопасности мелочей не бывает.
     */
    if (timingSafeEqual(token, value)) {
      return key.slice("MCP_TOKEN_".length).toLowerCase();
    }
  }

  return null;
}

/** Сравнение строк без утечки длины совпадающего префикса по времени. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

