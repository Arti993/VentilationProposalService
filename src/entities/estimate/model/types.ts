/**
 * Типы позиции сметы — единый контракт между сервером и клиентом.
 *
 * Лежат в entities, потому что это доменная сущность, а не деталь UI.
 * Сервер и клиент используют один и тот же тип: расхождение контрактов
 * между бэкендом и фронтендом — классический источник багов.
 */

export type PositionStatus =
  | "priced"
  | "not_found"
  | "needs_human"
  | "ambiguous"
  | "off_topic"
  | "error";

export interface EstimatePosition {
  /** Номер позиции в КП: 1, 2, 3… — его называет человек */
  posNo: number;
  /** Номер строки в исходном файле */
  lineNo: number;
  /** Как позицию назвал клиент */
  name: string;
  qty: number;
  unit?: string;
  status: PositionStatus;
  /** Цена за единицу из прайса */
  unitPrice?: number;
  /** Сумма по позиции */
  total?: number;
  /** Как позиция называется в прайсе */
  matchedName?: string;
  /** Объяснение решения */
  reason?: string;
  /** Откуда решение */
  source?: "deterministic" | "llm" | "none";
  confidence?: number;
}

export interface EstimateStats {
  total: number;
  priced: number;
  notFound: number;
  needsHuman: number;
  offTopic: number;
  totalSum: number;
  attention: number;
}

export interface EstimateSession {
  name: string;
  loadedAt: string;
  positions: EstimatePosition[];
  stats: EstimateStats;
}

/** Ответ API при загрузке сметы. */
export interface UploadResponse {
  ok: true;
  session: EstimateSession & { id: string };
}

export interface ApiError {
  ok: false;
  error: string;
}
