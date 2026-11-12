/**
 * Проверяет, что эксперимент с оценками действительно дошёл до LangSmith.
 *
 * Запуск: node --env-file=.env.local scripts/datasets/verify-eval.ts
 *
 * Смотреть надо не «отправлено N запусков» (это лишь факт вызова API),
 * а что в проекте есть запуски с привязанными оценками. Иначе легко
 * принять за успех отправку, которая никуда не легла.
 */
import { Client } from "langsmith";

const KEY = process.env.LANGCHAIN_API_KEY ?? "";
const BASE = process.env.LANGCHAIN_ENDPOINT ?? "https://api.smith.langchain.com";

async function api<T>(path: string, body?: unknown): Promise<T> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method: body ? "POST" : "GET",
      headers: { "x-api-key": KEY, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1200 * attempt));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }
  throw new Error("rate limit");
}

async function main() {
  const client = new Client();

  console.log("=== Проекты экспериментов ===");
  const projects: Array<{ id: string; name: string }> = [];
  for await (const p of client.listProjects({ limit: 20 })) {
    projects.push({ id: p.id, name: p.name });
  }

  const experiments = projects.filter((p) => /^(price|agent|attack|all)-/.test(p.name));
  console.log(`  найдено экспериментов: ${experiments.length}`);
  for (const e of experiments) console.log(`    ${e.name}`);

  if (!experiments.length) {
    console.log("\n  Экспериментов нет. Запустите evaluate.ts");
    process.exitCode = 1;
    return;
  }

  // Берём последний
  const last = experiments[experiments.length - 1]!;
  console.log(`\n=== Последний эксперимент: ${last.name} ===`);

  const runs = await api<{ runs: Array<{ id: string; name: string; outputs?: Record<string, unknown> }> }>(
    "/api/v1/runs/query",
    {
      session: [last.id],
      limit: 30,
      select: ["id", "name", "outputs", "reference_example_id"],
    },
  );
  console.log(`  запусков: ${runs.runs?.length ?? 0}`);

  // Считаем оценки по каждому запуску
  let withFeedback = 0;
  const byKey = new Map<string, { sum: number; n: number }>();

  for (const r of runs.runs ?? []) {
    await new Promise((res) => setTimeout(res, 400));
    const fb = await api<Array<{ key: string; score?: number }>>(`/api/v1/feedback?run_id=${r.id}`);
    if (fb.length) withFeedback++;

    for (const f of fb) {
      const acc = byKey.get(f.key) ?? { sum: 0, n: 0 };
      acc.sum += f.score ?? 0;
      acc.n += 1;
      byKey.set(f.key, acc);
    }
  }

  console.log(`  запусков с оценками: ${withFeedback}`);
  console.log("\n  Средние оценки:");
  for (const [key, acc] of byKey) {
    const avg = acc.n ? (acc.sum / acc.n).toFixed(2) : "—";
    console.log(`    ${key.padEnd(16)} ${avg}  (${acc.n} оценок)`);
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
