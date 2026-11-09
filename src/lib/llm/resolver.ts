/**
 * Разбор неоднозначных строк сметы через LLM.
 *
 * Роль LLM здесь ровно одна: понять, ЧТО имел в виду клиент, если строгая
 * нормализация не справилась. Цену LLM не назначает — её всегда берём из БД
 * по id позиции. Это отсекает главный класс ошибок и атак (выдуманные цены).
 */
import { chatJson, type ChatMessage } from "./client.ts";
import type { PriceItem } from "../price/normalize.ts";

/** Шкала уверенности — жёстко зафиксирована в промпте, а не «на глаз». */
export const CONFIDENCE_THRESHOLD = 0.85;

export interface ResolverOutput {
  /** id позиции прайса, если модель уверена; иначе null */
  priceId: string | null;
  /** Насколько модель уверена: 0..1 */
  confidence: number;
  /** Почему — короткое объяснение, обязательно непустое */
  reason: string;
  /** Неоднозначность сохраняется — нужен человек */
  needsHuman: boolean;
  /** Строка клиента относилась не к товарам (оффтоп) */
  offTopic: boolean;
}

export interface ResolverInput {
  /** Сырая строка из сметы */
  line: string;
  /** Ограниченный набор кандидатов из прайса — НЕ весь прайс */
  candidates: PriceItem[];
}

const SYSTEM_PROMPT = `Ты — эксперт по вентиляционным системам. Твоя задача: определить, какая позиция прайса соответствует строке сметы клиента.

ПРАВИЛА (соблюдай строго):
1. Всегда возвращай JSON по заданной схеме. Ничего кроме JSON.
2. priceId — только id из списка кандидатов. Никогда не придумывай id.
3. Если ни один кандидат не подходит — priceId = null и needsHuman = true.
4. ВАЖНО: если в списке есть несколько кандидатов, отличающихся только исполнением
   (например, «(R)» и без него), а в строке клиента исполнение НЕ указано —
   верни priceId = null и needsHuman = true. Не выбирай один из них наугад:
   разница в исполнении — это разная цена, и клиент вправе иметь в виду другую.
5. confidence — число от 0 до 1 по шкале:
   - 0.95–1.0 — точное совпадение типа, размеров И исполнения
   - 0.85–0.94 — совпадение с несущественным расхождением в формулировке
   - 0.60–0.84 — подходит, но есть сомнение (нужна проверка человеком)
   - 0.0–0.59 — не уверен или не подходит
6. reason — обязательно конкретное обоснование, минимум 10 символов. Пустую строку не возвращай.
7. Если строка не относится к вентиляционному оборудованию (кабель, поборы, работы) — offTopic = true, priceId = null.
8. Все числа в названиях — это диаметры (мм), кроме углов в градусах.
9. Не угадывай по похожести названия: «переход» и «тройник» — разные изделия.

Никогда не изменяй цены и не предлагай их — ты только сопоставляешь позиции.`;

function buildUserPrompt(input: ResolverInput): string {
  const lines: string[] = [];
  lines.push(`<line_from_estimate>`);
  lines.push(input.line);
  lines.push(`</line_from_estimate>`);
  lines.push("");
  lines.push(`<candidates_from_price>`);
  for (const c of input.candidates) {
    const dims = c.dims.join("/");
    const angle = c.angle ? `, ${c.angle}°` : "";
    const variant = c.variant ? `, исполнение: ${c.variant}` : "";
    lines.push(`${c.id} | ${c.type} | размеры ${dims}${angle}${variant} | «${c.rawName}»`);
  }
  lines.push(`</candidates_from_price>`);
  lines.push("");
  lines.push("Определи соответствие и верни JSON по схеме.");
  return lines.join("\n");
}

const SCHEMA = {
  type: "object",
  properties: {
    priceId: { type: ["string", "null"] },
    confidence: { type: "number" },
    reason: { type: "string" },
    needsHuman: { type: "boolean" },
    offTopic: { type: "boolean" },
  },
  required: ["priceId", "confidence", "reason", "needsHuman", "offTopic"],
  additionalProperties: false,
} as const;

/** Постпроверка ответа модели — не доверяем ей слепо. */
export function validate(
  output: ResolverOutput,
  candidates: PriceItem[],
  line = "",
): ResolverOutput {
  const allowed = new Set(candidates.map((c) => c.id));
  const problems: string[] = [];

  // Модель придумала id, которого нет среди кандидатов
  if (output.priceId !== null && !allowed.has(output.priceId)) {
    problems.push(`несуществующий priceId=${output.priceId}`);
    output = { ...output, priceId: null, needsHuman: true };
  }

  // «Уверенность» без обоснования — красный флаг, обнуляем доверие
  if (!output.reason || output.reason.trim().length < 10) {
    problems.push("пустое или слишком короткое обоснование");
    output = { ...output, confidence: 0, needsHuman: true };
  }

  // confidence вне диапазона
  if (!Number.isFinite(output.confidence) || output.confidence < 0 || output.confidence > 1) {
    problems.push(`confidence вне диапазона: ${output.confidence}`);
    output = { ...output, confidence: 0, needsHuman: true };
  }

  // КОД-УРОВНЕВЫЙ ЗАПРЕТ УГАДЫВАНИЯ ИСПОЛНЕНИЯ.
  // Если модель выбрала позицию, а в прайсе есть ДРУГИЕ кандидаты с теми же
  // размерами и типом, но иным исполнением — это угадывание разницы в цене.
  // Промпт может не сработать, а код сработает всегда.
  //
  // НО: если клиент САМ указал исполнение в строке ("(R)"), угадывания нет —
  // он явно его выбрал, и блокировать нельзя.
  if (output.priceId !== null) {
    const chosen = candidates.find((c) => c.id === output.priceId);
    if (chosen) {
      const rivals = candidates.filter(
        (c) =>
          c.id !== chosen.id &&
          c.type === chosen.type &&
          c.dims.join("/") === chosen.dims.join("/") &&
          (c.angle ?? 0) === (chosen.angle ?? 0) &&
          (c.variant ?? "") !== (chosen.variant ?? ""),
      );

      const lineStatesVariant =
        chosen.variant !== undefined &&
        new RegExp(`\\(\\s*${escapeRe(chosen.variant)}\\s*\\)`, "i").test(line);

      if (rivals.length && !lineStatesVariant) {
        const alternatives = rivals
          .map((r) => `${r.rawName} — ${r.price} ₽`)
          .join("; ");
        return {
          ...output,
          priceId: null,
          confidence: Math.min(output.confidence, 0.5),
          needsHuman: true,
          reason:
            `В прайсе есть другой вариант исполнения с той же геометрией, ` +
            `разница в цене не подтверждена сметой: ${alternatives}`,
        };
      }
    }
  }

  // Порог уверенности: ниже — нужно решение человека, цену не ставим
  if (output.priceId !== null && output.confidence < CONFIDENCE_THRESHOLD) {
    output = { ...output, needsHuman: true };
  }

  if (problems.length) {
    output = {
      ...output,
      reason: `${output.reason} [постпроверка: ${problems.join("; ")}]`,
    };
  }

  return output;
}

const FALLBACK: ResolverOutput = {
  priceId: null,
  confidence: 0,
  reason: "LLM недоступен, требуется ручная проверка",
  needsHuman: true,
  offTopic: false,
};

/**
 * Главная функция: сопоставить неоднозначную строку с кандидатами.
 * Никогда не бросает — при сбое возвращает needsHuman, а не «лучшее предположение».
 */
export async function resolveLine(
  input: ResolverInput,
  opts: { model?: string; maxCandidates?: number } = {},
): Promise<ResolverOutput> {
  if (!input.candidates.length) {
    return {
      priceId: null,
      confidence: 0,
      reason: "Кандидатов из прайса не найдено",
      needsHuman: true,
      offTopic: false,
    };
  }

  // Ограничиваем число кандидатов: иначе промпт раздувается и падает точность
  const maxC = opts.maxCandidates ?? 12;
  const candidates = input.candidates.slice(0, maxC);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt({ ...input, candidates }) },
  ];

  try {
    const raw = await chatJson<ResolverOutput>(messages, {
      model: opts.model ?? process.env.LLM_RESOLVER_MODEL ?? "deepseek/deepseek-v4.1-flash-1017",
      temperature: 0,
      maxTokens: 600,
      jsonSchema: { name: "resolve_line", schema: SCHEMA as unknown as Record<string, unknown> },
    });
    return validate(raw, candidates, input.line);
  } catch {
    return FALLBACK;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
