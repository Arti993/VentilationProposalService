/**
 * Инструменты агента.
 *
 * Ключевой принцип: инструменты работают с прайсом и БД, а НЕ с LLM.
 * Агент решает, какой инструмент вызвать, но цена всегда приходит из
 * данных, а не из генерации модели. Даже успешная инъекция не сможет
 * «поставить» произвольную цену — нет такого инструмента.
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { PriceItem, ItemType } from "../price/normalize.ts";
import { TYPE_LABEL } from "../price/normalize.ts";
import { matchLine } from "../matcher/match.ts";
import { processLine } from "../matcher/hybrid.ts";

/** Контекст, доступный инструментам (замыкание на текущий прайс). */
export interface ToolContext {
  price: PriceItem[];
  /** Разрешено ли инструменту искать через LLM для сложных строк */
  useLlm: boolean;
}

/**
 * Инструмент 1: найти позицию в прайсе по строке из сметы.
 * Возвращает структурированный результат с ценой из прайса.
 */
export function makeFindItemTool(ctx: ToolContext) {
  return tool(
    async ({ query }: { query: string }) => {
      const res = await processLine(query, ctx.price, { useLlm: ctx.useLlm });

      if (res.status === "priced" && res.item) {
        return JSON.stringify({
          found: true,
          status: "priced",
          matchedName: res.item.rawName,
          pricePerUnit: res.item.price,
          qty: res.qty,
          total: res.total,
          unit: res.unit ?? "шт",
          confidence: res.confidence,
          source: res.source,
          reason: res.reason,
        });
      }

      return JSON.stringify({
        found: false,
        status: res.status,
        qty: res.qty,
        unit: res.unit ?? null,
        reason: res.reason,
      });
    },
    {
      name: "find_item",
      description:
        "Найти позицию в прайс-листе по названию из сметы клиента. " +
        "Возвращает цену из прайса или причину, почему позиции нет / нужна проверка. " +
        "Используй для любых вопросов о ценах, наличии и стоимости позиций.",
      schema: z.object({
        query: z
          .string()
          .describe("точная строка позиции из сметы, например «Тройник 315/200»"),
      }),
    },
  );
}

/**
 * Инструмент 2: что вообще есть в прайсе по типу товара.
 * Нужен, когда клиент спрашивает «а какие размеры у вас есть?».
 */
export function makeListByTypeTool(ctx: ToolContext) {
  return tool(
    async ({ type }: { type: string }) => {
      const types = Object.keys(TYPE_LABEL) as ItemType[];
      const key = type.toLowerCase().trim() as ItemType;
      const resolved = types.find((t) => t === key);
      if (!resolved) {
        return JSON.stringify({
          error: `Неизвестный тип. Допустимые: ${types.filter((t) => t !== "unknown").join(", ")}`,
        });
      }

      const items = ctx.price
        .filter((p) => p.type === resolved)
        .map((p) => ({
          name: p.rawName,
          dims: p.dims.join("/"),
          angle: p.angle ?? null,
          variant: p.variant ?? null,
          price: p.price,
        }));

      return JSON.stringify({
        type: resolved,
        label: TYPE_LABEL[resolved],
        count: items.length,
        items,
      });
    },
    {
      name: "list_by_type",
      description:
        "Показать все позиции и размеры в прайсе для типа товара: " +
        "duct_spiral (спиральный воздуховод), duct_straight (прямошовный), " +
        "elbow_segmented (отвод сегментный), elbow_stamped (отвод штампованный), " +
        "tee (тройник), reducer (переход), nipple (ниппель), coupling (муфта), " +
        "cap (заглушка), cross (крестовина), saddle (врезка седло), " +
        "straight_tap (врезка прямая).",
      schema: z.object({
        type: z.string().describe("код типа товара из описания"),
      }),
    },
  );
}

/**
 * Инструмент 3: посчитать стоимость по позициям сметы.
 * Считает детерминированно, в JS — LLM не выполняет арифметику.
 */
export function makeCalculateTool(ctx: ToolContext) {
  return tool(
    async ({ items }: { items: Array<{ query: string; qty: number }> }) => {
      const priced: Array<Record<string, unknown>> = [];
      const missing: Array<Record<string, unknown>> = [];
      let sum = 0;

      for (const it of items) {
        // ВАЖНО: количество из аргумента инструмента обязательно передаём -
        // иначе processLine возьмёт qty=1 из строки и сумма будет неверной.
        const res = await processLine(it.query, ctx.price, {
          useLlm: ctx.useLlm,
          qty: it.qty,
        });
        if (res.status === "priced" && res.item && res.total !== undefined) {
          sum += res.total;
          priced.push({
            query: it.query,
            matchedName: res.item.rawName,
            pricePerUnit: res.item.price,
            qty: it.qty,
            total: res.total,
          });
        } else {
          missing.push({ query: it.query, status: res.status, reason: res.reason });
        }
      }

      return JSON.stringify({
        total: Math.round(sum * 100) / 100,
        priced,
        missing,
        note: missing.length
          ? "Позиции без цены НЕ включены в сумму — их нет в прайсе или нужна проверка."
          : "Все позиции найдены.",
      });
    },
    {
      name: "calculate_total",
      description:
        "Посчитать стоимость набора позиций: цена из прайса × количество, и итог. " +
        "Используй для вопросов «сколько будет стоить», «посчитай итог».",
      schema: z.object({
        items: z
          .array(
            z.object({
              query: z.string().describe("название позиции"),
              qty: z
                .number()
                .positive()
                .describe(
                  "количество из вопроса клиента. ОБЯЗАТЕЛЬНО: если клиент сказал " +
                    "«48 метров», qty=48, а не 1. Без количества используй 1.",
                ),
            }),
          )
          .describe("список позиций с количествами"),
      }),
    },
  );
}

/** Все инструменты, доступные агенту. */
export function makeTools(ctx: ToolContext) {
  return [makeFindItemTool(ctx), makeListByTypeTool(ctx), makeCalculateTool(ctx)];
}

/** Прямой вызов матчера без LLM — для тестов и отладки. */
export function rawMatch(line: string, price: PriceItem[]) {
  return matchLine(line, price);
}
