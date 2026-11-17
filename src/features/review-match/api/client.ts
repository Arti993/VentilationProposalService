/**
 * Клиент обратной связи: менеджер подтверждает, какая позиция прайса
 * соответствует строке сметы.
 *
 * ЭТО НЕ «ИСПРАВИТЬ ЦЕНУ»
 *
 * Здесь нет и не должно быть пути, меняющего цену в КП. Запись только
 * учит словарь синонимов организации: в следующий раз строка с такой
 * формулировкой найдётся сама. Дать возможность «поправить цену» значило
 * бы открыть ровно ту дыру, ради закрытия которой весь проект и устроен:
 * цена приходит только из прайса, и только по коду.
 */

export interface FeedbackItem {
  id: number;
  orgId: string;
  estimateId: string | null;
  posNo: number | null;
  rawText: string;
  guessCode: string | null;
  chosenCode: string | null;
  note: string | null;
  status: "new" | "applied" | "rejected";
  createdAt: string;
}

export interface FeedbackSummary {
  total: number;
  new: number;
  applied: number;
  rejected: number;
}

export interface SubmitFeedbackInput {
  rawText: string;
  chosenCode: string | null;
  estimateId?: string | null;
  posNo?: number | null;
  guessCode?: string | null;
  note?: string | null;
}

/**
 * Сохраняет разбор.
 *
 * Возвращает понятную ошибку вместо кода состояния: вызывающая сторона
 * показывает текст менеджеру, а он не должен читать «HTTP 422».
 */
export async function submitFeedback(input: SubmitFeedbackInput): Promise<FeedbackItem> {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    feedback?: FeedbackItem;
    error?: string;
    hint?: string;
  };

  if (!res.ok || json.ok !== true || !json.feedback) {
    const parts = [json.error ?? `Ошибка (HTTP ${res.status})`, json.hint].filter(Boolean);
    throw new Error(parts.join(". "));
  }

  return json.feedback;
}

/** Читает список разборов и сводку. */
export async function loadFeedback(): Promise<{
  items: FeedbackItem[];
  summary: FeedbackSummary;
}> {
  const res = await fetch("/api/feedback", { headers: { Accept: "application/json" } });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: FeedbackItem[];
    summary?: FeedbackSummary;
    error?: string;
  };

  if (!res.ok || json.ok !== true) {
    throw new Error(json.error ?? `Ошибка чтения (HTTP ${res.status})`);
  }

  return {
    items: json.items ?? [],
    summary: json.summary ?? { total: 0, new: 0, applied: 0, rejected: 0 },
  };
}

/** Меняет статус разбора: подтвердить в словарь или отклонить. */
export async function setFeedbackStatus(
  id: number,
  status: "applied" | "rejected",
): Promise<void> {
  const res = await fetch(`/api/feedback/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `Ошибка (HTTP ${res.status})`);
  }
}
