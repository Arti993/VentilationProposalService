/**
 * Клиент загрузки прайса.
 *
 * Отдельный слой API-вызовов, как у загрузки сметы: компонент не знает
 * про `fetch`, адреса и коды ответов. Это позволяет позже заменить
 * транспорт (например, на прямую загрузку в хранилище) и не трогать UI.
 */

/**
 * Позиция прайса в том виде, в каком она приходит для выбора в интерфейсе.
 *
 * Обрезанная копия `PriceItem` из `lib/price/normalize`: клиенту нужны
 * только код, название, цена и размеры. Служебные поля (угол, исполнение,
 * что не разобралось при разборе файла) наружу не отдаются — они ничего
 * не значат для менеджера, который выбирает позицию, и раздувают ответ
 * втрое.
 */
export interface PriceItem {
  id: string;
  rawName: string;
  price: number;
  type: string;
  dims: number[];
}

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
  /**
   * Отказ из-за отсутствия аккаунта.
   *
   * Признак приходит с сервера, а не выводится из текста: различать
   * причины по формулировке — значит сломать интерфейс при первой же
   * правке сообщения. По этому флагу показывается кнопка «Войти».
   */
  needAuth?: boolean;
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

/**
 * Позиции прайса организации — для выбора в разборе спорных строк.
 *
 * Возвращает пустой массив при любой ошибке, а не бросает исключение:
 * разбор — вспомогательная функция. Если прайс не загрузился, таблица КП
 * должна работать как раньше, просто без подсказки «из чего выбрать».
 */
export async function fetchPriceItems(): Promise<PriceItem[]> {
  try {
    const res = await fetch("/api/price/upload?withItems=1", { cache: "no-store" });
    const json = (await res.json()) as { ok?: boolean; items?: PriceItem[] };
    return json.ok && Array.isArray(json.items) ? json.items : [];
  } catch {
    return [];
  }
}
