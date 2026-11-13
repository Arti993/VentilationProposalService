/**
 * Настройка LangSmith-трейсинга.
 *
 * LangSmith показывает каждый шаг графа: какой узел вызван, что ушло в
 * модель, что вернулось, сколько токенов и времени заняло. Включается
 * переменными окружения — без них агент работает как обычно.
 *
 *   LANGCHAIN_TRACING_V2=true
 *   LANGCHAIN_API_KEY=lsv2_...
 *   LANGCHAIN_PROJECT=kp-service
 *
 * ВАЖНО: трейсинг отправляет тексты смет на внешний сервис. Для учебного
 * проекта допустимо, для реальных клиентских данных — требует согласования.
 * Поэтому выключен по умолчанию и включается явно.
 *
 * ВАЖНО 2: трейсинг НИКОГДА не должен ломать обработку. Если ключ неверный
 * или сеть недоступна — SDK пишет в лог и продолжает работу. Это правильно:
 * потерять трейс неприятно, потерять КП — недопустимо.
 */

export interface TracingInfo {
  enabled: boolean;
  project: string | null;
  reason?: string;
}

/**
 * Проверяет конфигурацию трейсинга. Вызывается один раз при старте CLI,
 * чтобы напечатать честный статус, а не молчать.
 */
export function tracingInfo(): TracingInfo {
  const enabled = process.env.LANGCHAIN_TRACING_V2 === "true";
  if (!enabled) {
    return {
      enabled: false,
      project: null,
      reason: "LANGCHAIN_TRACING_V2 не задан — трейсинг выключен",
    };
  }

  const key = process.env.LANGCHAIN_API_KEY;
  if (!key) {
    return {
      enabled: false,
      project: null,
      reason: "LANGCHAIN_TRACING_V2=true, но LANGCHAIN_API_KEY не задан",
    };
  }

  const project = process.env.LANGCHAIN_PROJECT ?? "default";
  return { enabled: true, project };
}

/**
 * Помечает текущий прогон именем и метаданными.
 * Имя видно в LangSmith в списке запусков — по нему удобно отличить
 * демо от отладки.
 */
export function sessionTags(name: string, extra: Record<string, string> = {}) {
  return {
    runName: name,
    tags: ["kp-service", ...Object.values(extra)],
    metadata: { ...extra, app: "ventilation-proposal-service" },
  };
}

/**
 * Приглушает шум логов SDK при включённом трейсинге.
 *
 * LangSmith при недоступном ключе/сети печатает длинные стектрейсы с
 * trace-id. Они не ломают работу, но делают вывод CLI нечитаемым.
 * Оставляем только предупреждения о выключенном трейсинге.
 */
export function configureTracingLogs(): void {
  const info = tracingInfo();
  if (!info.enabled) return;

  // Ошибки отправки трейсов не должны забивать консоль
  process.env.LANGCHAIN_HIDE_INPUTS ??= "false";
  process.on("unhandledRejection", (reason) => {
    const msg = String(reason);
    if (msg.includes("LangSmith") || msg.includes("trace")) {
      // Тихо игнорируем сбои отправки трейса
      return;
    }
    console.error("Необработанная ошибка:", reason);
  });
}
