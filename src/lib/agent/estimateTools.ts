/**
 * Инструменты работы с ЗАГРУЖЕННОЙ сметой.
 *
 * Отличие от `tools.ts`: те ищут по прайсу «в вакууме», эти работают
 * с конкретным документом в памяти сессии. Именно они дают агенту
 * способность ответить «почему позиция 12 без цены».
 *
 * Все инструменты только ЧИТАЮТ сессию. Изменить цену или статус
 * позиции через них невозможно — это защита от подмены данных в диалоге.
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { SessionStore } from "./session.ts";

const NO_SESSION = JSON.stringify({
  error: "Смета не загружена. Попросите пользователя загрузить файл сметы.",
});

/** Инструмент: сводка по загруженной смете. */
export function makeEstimateSummaryTool(store: SessionStore) {
  return tool(
    async () => {
      const s = store.current;
      if (!s) return NO_SESSION;

      return JSON.stringify({
        name: s.name,
        loadedAt: s.loadedAt,
        stats: s.stats,
        summaryText: store.summary(),
      });
    },
    {
      name: "estimate_summary",
      description:
        "Сводка по загруженной смете: сколько позиций, сколько с ценой, " +
        "сколько не найдено, итоговая сумма. Используй для вопросов " +
        "«что в смете», «какой итог», «сколько позиций не нашлось».",
      schema: z.object({}),
    },
  );
}

/** Инструмент: список позиций сметы с фильтром по статусу. */
export function makeEstimatePositionsTool(store: SessionStore) {
  return tool(
    async ({
      status,
      posNo,
      limit,
    }: {
      status: string | null;
      posNo: number | null;
      limit: number | null;
    }) => {
      const s = store.current;
      if (!s) return NO_SESSION;

      // Конкретная позиция по номеру в КП
      if (typeof posNo === "number") {
        const p = s.positions.find((x) => x.posNo === posNo);
        if (!p) {
          return JSON.stringify({
            error: `Позиции №${posNo} в смете нет`,
            hint: `Всего позиций ${s.positions.length}, нумерация с 1`,
            availablePosNos: s.positions.map((x) => x.posNo),
          });
        }
        return JSON.stringify(p);
      }

      let items = s.positions;
      if (status) {
        const st = status.toLowerCase().trim();
        items = items.filter((p) => p.status === st);
      }

      const max = Math.min(limit ?? 30, 50);
      return JSON.stringify({
        count: items.length,
        shown: Math.min(items.length, max),
        positions: items.slice(0, max),
      });
    },
    {
      name: "estimate_positions",
      description:
        "Позиции загруженной сметы. Можно отфильтровать по статусу " +
        "(priced — с ценой, not_found — нет в прайсе, needs_human — нужна " +
        "проверка, off_topic — не про вентиляцию) или запросить одну позицию " +
        "по её номеру в КП (posNo, нумерация с 1).",
      schema: z.object({
        status: z
          .string()
          .nullable()
          .describe("priced | not_found | needs_human | off_topic | error, либо null"),
        posNo: z
          .number()
          .nullable()
          .describe("номер позиции в КП (1, 2, 3…), либо null"),
        limit: z.number().nullable().describe("сколько позиций вернуть (максимум 50), либо null"),
      }),
    },
  );
}

/** Инструмент: объяснение, почему позиция без цены. */
export function makeExplainPositionTool(store: SessionStore) {
  return tool(
    async ({ posNo, query }: { posNo: number | null; query: string | null }) => {
      const s = store.current;
      if (!s) return NO_SESSION;

      let p = undefined;
      if (typeof posNo === "number") {
        p = s.positions.find((x) => x.posNo === posNo);
      } else if (query) {
        const q = query.toLowerCase();
        p = s.positions.find((x) => x.name.toLowerCase().includes(q));
      }

      if (!p) {
        return JSON.stringify({
          error: "Позиция не найдена в смете",
          hint: "Укажите номер позиции (posNo) или часть названия (query)",
          positions: s.positions.map((x) => ({ posNo: x.posNo, name: x.name })),
        });
      }

      return JSON.stringify({
        posNo: p.posNo,
        lineNo: p.lineNo,
        clientName: p.name,
        qty: p.qty,
        unit: p.unit ?? null,
        status: p.status,
        matchedName: p.matchedName ?? null,
        unitPrice: p.unitPrice ?? null,
        total: p.total ?? null,
        reason: p.reason ?? null,
        decidedBy: p.source ?? null,
        confidence: p.confidence ?? null,
        explanation:
          p.status === "priced"
            ? "Позиция однозначно сопоставлена с прайсом, цена подставлена."
            : p.status === "not_found"
              ? "Такой позиции нет в прайсе — цена не ставится, чтобы не выдать ошибочную."
              : p.status === "needs_human"
                ? "Позиция требует решения менеджера: сопоставление неоднозначно."
                : "Строка не относится к вентиляционному оборудованию.",
      });
    },
    {
      name: "explain_position",
      description:
        "Объяснить, почему позиция в смете получила такой статус и цену. " +
        "Используй для вопросов «почему без цены», «что не так с позицией N».",
      schema: z.object({
        posNo: z
          .number()
          .nullable()
          .describe("номер позиции в КП (1, 2, 3…), либо null"),
        query: z.string().nullable().describe("часть названия позиции, либо null"),
      }),
    },
  );
}

/** Все инструменты сессии. */
export function makeSessionTools(store: SessionStore) {
  return [
    makeEstimateSummaryTool(store),
    makeEstimatePositionsTool(store),
    makeExplainPositionTool(store),
  ];
}
