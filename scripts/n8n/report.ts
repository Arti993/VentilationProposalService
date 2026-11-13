/**
 * Отчёт по истории выполнений n8n.
 *
 * Запуск: node scripts/n8n/report.ts
 *         node scripts/n8n/report.ts --limit 100
 *         node scripts/n8n/report.ts --json
 *
 * ЗАЧЕМ СКРИПТ, А НЕ ГЛАЗАМИ В ИНТЕРФЕЙСЕ
 *
 * В интерфейсе n8n выполнение открывается по одному: нажал, посмотрел,
 * закрыл, следующее. Чтобы понять «сколько КП ушло за неделю» или «падает
 * ли отправка в Telegram», нужно открыть все запуски подряд и сложить
 * цифры в голове. На пяти запусках это терпимо, на сотне — нет.
 *
 * Здесь то же самое, но одним запросом к API и одной таблицей на выходе.
 *
 * ЧТО ИМЕННО СЧИТАЕТСЯ
 *
 * Ключевая цифра — не «сколько раз сценарий запустился», а СКОЛЬКО РАБОТЫ
 * ОН РЕАЛЬНО СДЕЛАЛ. Планировщик будит сценарий каждые 15 минут, но в
 * большинстве запусков новых КП нет, и он ничего не отправляет. Если
 * этого не различать, 96 запусков в сутки выглядят как 96 уведомлений.
 *
 * Поэтому считаем два числа:
 *   запусков — сколько раз сценарий просыпался;
 *   полезных — сколько раз реально ушло сообщение (есть элементы на
 *             узле отправки).
 *
 * Расхождение между ними — это и есть цена опроса: 96 запусков ради
 * 2 уведомлений. Плата за то, что событие не теряется.
 */

const N8N_URL = process.env.N8N_URL ?? "http://localhost:5678";

interface Execution {
  id: string;
  status: "success" | "error" | "waiting" | string;
  mode: string;
  startedAt: string;
  stoppedAt?: string;
  workflowId: string;
  workflowName?: string;
}

interface NodeRun {
  data?: { main?: Array<Array<{ json: Record<string, unknown> }>> };
  error?: unknown;
}

interface ExecutionDetail {
  status?: string;
  data?: {
    resultData?: {
      runData?: Record<string, NodeRun[]>;
      error?: { message?: string; node?: { name?: string } };
    };
  };
}

/** Узлы, на которых видно, что сценарий реально что-то отправил. */
const SEND_NODE_RE = /напомнить менеджеру|отправить уведомление|telegram/i;

/** Узлы-ответвления «делать нечего». */
const SKIP_NODE_RE = /новых нет|напоминать некому/i;

interface ExecutionReport {
  id: string;
  status: string;
  startedAt: string;
  /** Сколько элементов прошло через узел отправки. 0 — отправлять было нечего. */
  sent: number;
  /** Сценарий честно дошёл до ветки «делать нечего». */
  skipped: boolean;
  /** Текст ошибки, если упал */
  error?: string;
}

/**
 * Ошибка n8n с HTTP-статусом.
 *
 * Статус нужен отдельным полем, чтобы отличить «выполнение удалено
 * прунингом» (404 — не ошибка отчёта) от «ключ неверный» (401).
 *
 * Поле объявлено и присвоено руками, а не через `readonly status: number`
 * в параметрах: Node исполняет TypeScript в strip-only режиме и
 * параметры-свойства не поддерживает.
 */
class N8nError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function api<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${N8N_URL}/api/v1${path}`, {
    headers: {
      "X-N8N-API-KEY": key,
      // Без явного Accept n8n отдаёт кодировку, которую PowerShell
      // читает как cp1251 — и кириллица в названиях превращается в «??».
      // Заголовок обязателен: без него отчёт выглядит сломанным.
      Accept: "application/json; charset=utf-8",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new N8nError(`HTTP ${res.status} на ${path}: ${text.slice(0, 160)}`, res.status);
  }
  return (await res.json()) as T;
}

/** Собирает отчёт по одному выполнению: сколько работы реально сделано. */
async function inspect(id: string, key: string): Promise<ExecutionReport> {
  const detail = await api<ExecutionDetail>(`/executions/${id}?includeData=true`, key);
  const runData = detail.data?.resultData?.runData ?? {};

  let sent = 0;
  let skipped = false;

  for (const [name, runs] of Object.entries(runData)) {
    const out = runs.at(-1)?.data?.main?.[0] ?? [];

    if (SEND_NODE_RE.test(name)) sent += out.length;
    if (SKIP_NODE_RE.test(name)) skipped = true;
  }

  const err = detail.data?.resultData?.error;

  return {
    id,
    status: detail.status ?? "unknown",
    startedAt: "",
    sent,
    skipped,
    error: err ? `${err.node?.name ?? "?"}: ${err.message ?? "ошибка"}` : undefined,
  };
}

function fmtTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes("--json");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 30 : 30;

  const key = process.env.N8N_API_KEY;
  if (!key) {
    console.error(
      "Нет N8N_API_KEY.\n" +
        "Запуск: node --env-file=.env.local scripts/n8n/report.ts",
    );
    process.exit(1);
  }

  // ── Сценарии ──
  const wf = await api<{ data: Array<{ id: string; name: string; active: boolean }> }>(
    "/workflows?limit=50",
    key,
  );

  if (!jsonOnly) {
    console.log(`n8n: ${N8N_URL}`);
    console.log(`Сценариев: ${wf.data.length}\n`);
    for (const w of wf.data) {
      console.log(`  ${w.active ? "● активен " : "○ выключен"} ${w.name}`);
    }
    console.log("");
  }

  const result: Array<{
    name: string;
    active: boolean;
    runs: number;
    productive: number;
    failed: number;
    lastRun: string;
    minutesBetween: number | null;
  }> = [];

  // ── История по каждому сценарию ──
  for (const w of wf.data) {
    const ex = await api<{ data: Execution[] }>(
      `/executions?workflowId=${w.id}&limit=${limit}`,
      key,
    );

    const reports: ExecutionReport[] = [];
    for (const e of ex.data) {
      try {
        const r = await inspect(e.id, key);
        reports.push({ ...r, status: e.status, startedAt: e.startedAt });
      } catch (err) {
        // Выполнение могли уже удалить прунингом — это не ошибка отчёта
        if (err instanceof N8nError && err.status === 404) continue;
        throw err;
      }
    }

    const productive = reports.filter((r) => r.sent > 0).length;
    const failed = reports.filter((r) => r.status === "error").length;

    // Интервал между запусками: показывает, что планировщик жив
    let minutesBetween: number | null = null;
    if (reports.length >= 2) {
      const times = reports.map((r) => new Date(r.startedAt).getTime()).sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      minutesBetween = Math.round(avg / 60000);
    }

    result.push({
      name: w.name,
      active: w.active,
      runs: reports.length,
      productive,
      failed,
      lastRun: reports[0]?.startedAt ?? "",
      minutesBetween,
    });

    if (!jsonOnly) {
      console.log(`=== ${w.name} ===`);
      if (!reports.length) {
        console.log("  нет выполнений");
      } else {
        console.log(
          `  запусков ${reports.length}, из них полезных ${productive}, ` +
            `ошибок ${failed}` +
            (minutesBetween ? `, интервал ~${minutesBetween} мин` : ""),
        );
        console.log("  последние:");
        for (const r of reports.slice(0, 8)) {
          const mark = r.status === "error" ? "ОШИБКА" : r.sent > 0 ? "отправлено" : "нечего";
          console.log(
            `    #${String(r.id).padStart(3)} ${fmtTime(r.startedAt).padEnd(14)} ` +
              `${mark.padEnd(11)} ${r.sent > 0 ? `${r.sent} шт` : ""}` +
              (r.error ? `  ${r.error}` : ""),
          );
        }
      }
      console.log("");
    }
  }

  if (jsonOnly) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // ── Итог ──
  console.log("=== Итог ===");
  let allRuns = 0;
  let allProductive = 0;
  for (const r of result) {
    allRuns += r.runs;
    allProductive += r.productive;
    console.log(
      `  ${r.name}: ${r.productive} полезных из ${r.runs} запусков` +
        (r.runs ? ` (${((r.productive / r.runs) * 100).toFixed(0)}%)` : ""),
    );
  }

  if (allRuns > 0) {
    const ratio = allRuns / Math.max(allProductive, 1);
    console.log(
      `\n  Всего запусков: ${allRuns}, из них с работой: ${allProductive}`,
    );
    console.log(
      `  Плата за опрос: ${ratio.toFixed(0)} запусков на одно действие.`,
    );
    console.log(
      "  Это нормально для опроса по расписанию: событие не теряется,\n" +
        "  если n8n лежал. Альтернатива — webhook, но тогда Vercel должен\n" +
        "  достучаться до вашего компьютера, а он не может.",
    );
  }

  // ── Падения ──
  //
  // Отдельно разбираем падения САМОГО сторожа: если упал он, значит
  // сообщение об аварии не ушло, и об этом нужно знать громче всего.
  const guardFails = result.filter((r) => r.name.includes("сторож") && r.failed > 0);
  const otherFails = result.filter((r) => !r.name.includes("сторож") && r.failed > 0);

  if (guardFails.length) {
    console.log("\n  ВНИМАНИЕ: падал САМ сторож ошибок.");
    console.log("  Пока он падает, об остальных авариях вы не узнаете.");
    console.log("  Проверьте: node --env-file=.env.local scripts/n8n/test-error-watchdog.ts");
  }

  if (otherFails.length) {
    console.log("\n  Падения сценариев:");
    for (const f of otherFails) {
      console.log(`    ${f.name}: ${f.failed} ошибок`);
    }
    // Поясняем, что старые падения не обязательно означают проблему
    // сейчас: исправленный сценарий продолжает показывать свою историю
    console.log(
      "\n  Это история, а не текущее состояние. Если последние запуски\n" +
        "  успешны — проблема была и её починили.",
    );
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`ОШИБКА: ${msg}`);
  if (msg.includes("ECONNREFUSED")) {
    console.error("n8n не запущен. Стартуйте: .\\scripts\\start-n8n.ps1");
  }
  if (msg.includes("401")) {
    console.error("Ключ N8N_API_KEY неверный или отозван.");
  }
  process.exit(1);
});
