/**
 * Сессия работы сметой: память агента о загруженном документе.
 *
 * Агент без памяти отвечает на вопросы «в вакууме». С сессией он знает,
 * какую смету смотрит, и может ответить «почему позиция 12 без цены»,
 * «сколько позиций не нашлось», «дай сводку по КП».
 *
 * ВАЖНО: в памяти лежит РЕЗУЛЬТАТ обработки, а не сырой текст. Это значит,
 * что цены в сессии уже зафиксированы матчером и никакой последующий
 * разговор не может их изменить. Сессия — только для чтения.
 *
 * Типы берём из entities: сервер и клиент должны говорить на одном языке,
 * иначе расхождение контрактов всплывёт багом уже в браузере.
 */
import type { HybridResult } from "../matcher/hybrid.ts";
import type {
  EstimatePosition,
  EstimateSession,
  EstimateStats,
} from "../../entities/estimate/model/types.ts";

/** Позиция сессии — это доменная позиция сметы. */
export type SessionPosition = EstimatePosition;

/** Статистика сессии. */
export type SessionStats = EstimateStats;

export type { EstimateSession };

/** Считает статистику по списку позиций. Только чтение, без LLM. */
export function computeStats(positions: SessionPosition[]): SessionStats {
  let priced = 0;
  let notFound = 0;
  let needsHuman = 0;
  let offTopic = 0;
  let totalSum = 0;

  for (const p of positions) {
    switch (p.status) {
      case "priced":
        priced++;
        totalSum += p.total ?? 0;
        break;
      case "not_found":
        notFound++;
        break;
      case "needs_human":
      case "ambiguous":
        needsHuman++;
        break;
      case "off_topic":
        offTopic++;
        break;
      case "error":
        // Сбой обработки — тоже требует внимания человека
        needsHuman++;
        break;
      default:
        needsHuman++;
    }
  }

  return {
    total: positions.length,
    priced,
    notFound,
    needsHuman,
    offTopic,
    totalSum: Math.round(totalSum * 100) / 100,
    attention: notFound + needsHuman,
  };
}

/**
 * Создаёт сессию из результата обработки сметы.
 *
 * ВАЖНО: различаем два номера.
 *  - posNo — порядковый номер позиции в КП (1, 2, 3…). Именно его называет
 *    человек, когда говорит «позиция 4».
 *  - lineNo — номер строки в исходном файле (может быть 17, если выше шапка).
 * Храним оба, чтобы агент не путал их в ответах.
 */
export function createSession(
  name: string,
  results: HybridResult[],
): EstimateSession {
  const positions: SessionPosition[] = results.map((r, i) => ({
    posNo: i + 1,
    lineNo: r.lineNo ?? 0,
    name: r.line,
    qty: r.qty,
    unit: r.unit,
    status: r.status,
    unitPrice: r.item?.price,
    total: r.total,
    matchedName: r.item?.rawName,
    reason: r.reason,
    source: r.source,
    confidence: r.confidence,
  }));
  return {
    name,
    loadedAt: new Date().toISOString(),
    positions,
    stats: computeStats(positions),
  };
}

/**
 * Изменяемая ячейка сессии, разделяемая инструментами и CLI.
 * Простой класс вместо глобальной переменной: состояние явное,
 * его видно при чтении кода и легко сбросить в тестах.
 */
export class SessionStore {
  #session: EstimateSession | null = null;

  load(session: EstimateSession): void {
    this.#session = session;
  }

  /**
   * Восстанавливает ранее сохранённую сессию.
   *
   * Нужно для API-роутов: смета загружается одним запросом, а вопросы
   * приходят другими. Сессия берётся из серверного хранилища по ID,
   * при этом клиент не может подменить цены — он присылает только ID.
   */
  restore(session: EstimateSession): void {
    this.#session = session;
  }

  get current(): EstimateSession | null {
    return this.#session;
  }

  clear(): void {
    this.#session = null;
  }

  /** Текстовая сводка для промпта/ответа. */
  summary(): string {
    const s = this.#session;
    if (!s) return "Смета не загружена.";
    const st = s.stats;
    return [
      `Смета «${s.name}»: позиций ${st.total}.`,
      `С ценой: ${st.priced}, нет в прайсе: ${st.notFound}, требуют проверки: ${st.needsHuman}, вне темы: ${st.offTopic}.`,
      `Итоговая сумма: ${st.totalSum.toLocaleString("ru-RU")} ₽.`,
      st.attention > 0 ? `Внимание требуют ${st.attention} позиций.` : "Все позиции обработаны.",
    ].join(" ");
  }
}
