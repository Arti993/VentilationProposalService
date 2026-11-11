/**
 * Читает трассы из LangSmith через API и показывает их структуру.
 *
 * Запуск: node --env-file=.env.local scripts/inspect-traces.ts
 *
 * Зачем: проверить, что трассы действительно дошли и что в них есть то,
 * что должно быть — узлы графа, вызовы инструментов, токены. Не полагаемся
 * на «скрипт сказал отправлено»: SDK проглатывает ошибки отправки молча.
 */
const KEY = process.env.LANGCHAIN_API_KEY ?? "";
const BASE = process.env.LANGCHAIN_ENDPOINT ?? "https://api.smith.langchain.com";
const PROJECT = process.env.LANGCHAIN_PROJECT ?? "kp-service";

interface Run {
  id: string;
  name: string;
  run_type: string;
  start_time: string;
  end_time?: string;
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  error?: string | null;
  tags?: string[];
  extra?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  parent_run_id?: string | null;
}

async function api<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: { "x-api-key": KEY },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/**
 * Список прогонов.
 *
 * GET /api/v1/runs не существует (405) — этот эндпоинт принимает POST с
 * телом в стиле «query DSL». Поэтому отдельная функция.
 */
async function queryRuns(body: Record<string, unknown>): Promise<Run[]> {
  // Публичный API LangSmith ограничивает частоту запросов (429), поэтому
  // между вызовами держим паузу и повторяем с нарастающим ожиданием.
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${BASE}/api/v1/runs/query`, {
      method: "POST",
      headers: { "x-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (res.status === 429) {
      const wait = 1500 * attempt;
      console.log(`  (rate limit, ждём ${wait} мс)`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const json = (await res.json()) as { runs?: Run[] } | Run[];
    return Array.isArray(json) ? json : (json.runs ?? []);
  }

  throw new Error("Rate limit не отпустил после 4 попыток");
}

async function main() {
  if (!KEY) {
    console.log("Ключ не задан");
    process.exitCode = 1;
    return;
  }

  // 1. Есть ли сессия (проект)
  const sessions = await api<Array<{ id: string; name: string; run_count?: number }>>(
    "/api/v1/sessions",
    { name: PROJECT },
  );
  const session = sessions.find((s) => s.name === PROJECT) ?? sessions[0];

  if (!session) {
    console.log(`Проект «${PROJECT}» не найден в LangSmith.`);
    console.log(`Найдено проектов: ${sessions.length}`);
    for (const s of sessions) console.log(`  - ${s.name}`);
    process.exitCode = 1;
    return;
  }

  console.log(`=== Проект «${session.name}» (${session.id}) ===`);

  // 2. Последние корневые прогоны
  const runs = await queryRuns({
    session: [session.id],
    is_root: true,
    limit: 10,
    select: [
      "id",
      "name",
      "run_type",
      "start_time",
      "end_time",
      "total_tokens",
      "error",
      "tags",
      "trace_id",
    ],
  });

  console.log(`Корневых прогонов получено: ${runs.length}\n`);
  if (runs.length === 0) {
    console.log("Трасс нет. Возможные причины:");
    console.log("  - SDK не успел отправить (нужно ждать дольше);");
    console.log("  - ключ от другого проекта/тенанта;");
    console.log("  - трейсинг не включён в процессе.");
    process.exitCode = 1;
    return;
  }

  for (const r of runs) {
    const dur = r.end_time
      ? `${((new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 1000).toFixed(1)} с`
      : "в процессе";
    console.log(`[${r.run_type}] «${r.name}» — ${dur}`);
    console.log(`  id: ${r.id}`);
    console.log(`  теги: ${r.tags?.length ? r.tags.join(", ") : "—"}`);
    if (r.error) console.log(`  ОШИБКА: ${r.error}`);
    if (r.total_tokens) console.log(`  токены: ${r.total_tokens}`);

    // 3. Дочерние прогоны — дерево шагов
    await new Promise((r) => setTimeout(r, 1200));
    const children = await queryRuns({
      session: [session.id],
      trace: r.id,
      limit: 50,
      select: ["id", "name", "run_type", "start_time", "end_time", "total_tokens", "error"],
    });
    const nested = children.filter((c) => c.id !== r.id);
    console.log(`  шагов внутри: ${nested.length}`);

    const byType = new Map<string, number>();
    for (const c of nested) byType.set(c.run_type, (byType.get(c.run_type) ?? 0) + 1);
    console.log(`  по типам: ${[...byType.entries()].map(([k, v]) => `${k}×${v}`).join(", ")}`);

    const toolRuns = nested.filter((c) => c.run_type === "tool");
    if (toolRuns.length) {
      console.log(`  инструменты: ${toolRuns.map((c) => c.name).join(", ")}`);
    }
    const llmRuns = nested.filter((c) => c.run_type === "llm");
    if (llmRuns.length) {
      const tokens = llmRuns.reduce((n, c) => n + (c.total_tokens ?? 0), 0);
      console.log(`  вызовов LLM: ${llmRuns.length}, токенов всего: ${tokens}`);
    }
    console.log();
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
