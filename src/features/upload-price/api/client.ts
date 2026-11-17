/**
 * Клиент загрузки прайса.
 *
 * Отдельный слой API-вызовов, как у загрузки сметы: компонент не знает
 * про `fetch`, адреса и коды ответов. Это позволяет позже заменить
 * транспорт (например, на прямую загрузку в хранилище) и не трогать UI.
 */

export interface PriceUploadSuccess {
  ok: true;
  fileName: string;
  inserted: number;
  removed: number;
  skipped: number;
  quality: {
    total: number;
    withDims: number;
    withoutDims: number;
    byType: Record<string, number>;
  };
  /** Какие колонки разбор принял за название, цену, код и единицу. */
  columns: {
    name: number;
    price: number;
    code: number | null;
    unit: number | null;
  };
  warning: string | null;
}

export interface PriceUploadFailure {
  ok: false;
  /** Что не так — коротко. Показываем крупно. */
  error: string;
  /** Что делать — конкретно. Показываем мелко под ошибкой. */
  hint?: string;
}

export type PriceUploadResult = PriceUploadSuccess | PriceUploadFailure;

/** Сколько позиций в прайсе организации. */
export interface PriceInfo {
  ok: boolean;
  total: number;
  isDemo: boolean;
}

/** Загружает файл прайса. */
export async function uploadPrice(file: File): Promise<PriceUploadResult> {
  const body = new FormData();
  body.append("file", file);

  try {
    const res = await fetch("/api/price/upload", { method: "POST", body });
    const data = (await res.json()) as PriceUploadResult;
    return data;
  } catch {
    return {
      ok: false,
      error: "Сервер не ответил",
      hint: "Проверьте связь и попробуйте ещё раз.",
    };
  }
}

/** Читает текущее состояние прайса организации. */
export async function fetchPriceInfo(): Promise<PriceInfo> {
  try {
    const res = await fetch("/api/price/upload", { cache: "no-store" });
    return (await res.json()) as PriceInfo;
  } catch {
    return { ok: false, total: 0, isDemo: false };
  }
}
