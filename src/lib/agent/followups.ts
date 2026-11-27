/** Follow-ups share the answer's model call and trusted server-side history. */
export const FOLLOWUP_PROMPT = `

ПОДСКАЗКИ ПРОДОЛЖЕНИЯ:
После ответа добавь отдельный блок <follow_up_questions>["вопрос 1", "вопрос 2", "вопрос 3"]</follow_up_questions>.
Это JSON-массив из 2–3 коротких вопросов от лица пользователя (до 100 символов каждый).
Учитывай ВСЮ переданную историю и свой текущий ответ. Предлагай конкретный следующий шаг по обсуждаемому товару или смете.
Не повторяй уже заданные вопросы и не предлагай то, на что уже ответил. Не выдумывай товары, размеры, цены или возможности сервиса.
При отсутствии сметы предлагай вопросы только по прайсу. Вопросы не должны содержать утверждений о ценах.
Блок добавляется только к окончательному ответу, после работы с инструментами.`;

type Turn = { role: "user" | "assistant"; text: string };
const normalize = (text: string) => text.toLocaleLowerCase("ru").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function splitFollowups(raw: string): { answer: string; suggestions: string[] } {
  const start = raw.indexOf("<follow_up_questions>");
  if (start < 0) return { answer: raw.trim(), suggestions: [] };
  const answer = raw.slice(0, start).trim();
  const end = raw.indexOf("</follow_up_questions>", start);
  if (end < 0) return { answer, suggestions: [] };
  try {
    const parsed: unknown = JSON.parse(raw.slice(start + "<follow_up_questions>".length, end));
    return { answer, suggestions: Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [] };
  } catch {
    return { answer, suggestions: [] };
  }
}

export function selectFollowups(proposed: string[], history: Turn[], hasEstimate: boolean): string[] {
  const seen = new Set(history.filter((t) => t.role === "user").map((t) => normalize(t.text)));
  const result: string[] = [];
  // A malformed or truncated metadata block must not break the answer.
  const fallback = hasEstimate
    ? ["Какие позиции сметы требуют уточнения?", "Какие позиции остались без цены?", "Подготовь краткую сводку по смете для клиента"]
    : ["Какие типы изделий есть в прайсе?", "Какие размеры воздуховодов есть в прайсе?", "Какие отводы есть в прайсе?"];
  for (const candidate of [...proposed, ...fallback]) {
    const text = candidate.trim();
    const key = normalize(text);
    if (!key || text.length > 120 || /[<>\n\r]/.test(text) || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length === 3) break;
  }
  return result;
}
