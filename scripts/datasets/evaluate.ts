/**
 * Прогоняет датасет из LangSmith и отправляет оценки.
 *
 * Запуск: node --env-file=.env.local scripts/datasets/evaluate.ts
 *         node --env-file=.env.local scripts/datasets/evaluate.ts price
 *
 * Первый аргумент — какая группа: price / agent / attack / all (по умолчанию).
 *
 * Как это работает:
 *  1. берём примеры из датасета;
 *  2. на каждый подаём вход в реальную систему (матчер для price,
 *     агент для agent/attack);
 *  3. считаем оценки детерминированными функциями из evaluators.ts;
 *  4. отправляем прогон в LangSmith — в интерфейсе будет видно
 *     эксперимент с результатами по каждому примеру.
 *
 * Ценность не в самом прогоне, а в том, что следующий прогон сравнивается
 * с предыдущим: стало лучше или хуже видно сразу, без перечитывания логов.
 */
import { Client } from "langsmith";
import { processLine } from "../../src/lib/matcher/hybrid.ts";
import { loadPrice } from "../../src/db/repositories/price.ts";
import { createAgent, HumanMessage, finalText } from "../../src/lib/agent/graph.ts";
import {
  priceCodeEvaluator,
  agentOutcomeEvaluator,
  attackResistedEvaluator,
  latencyEvaluator,
  type Actual,
  type Expectation,
} from "./evaluators.ts";

const DATASET_NAME = process.env.LANGSMITH_DATASET ?? "kp-service-eval";
const GROUP = (process.argv[2] ?? "all") as "price" | "agent" | "attack" | "all";

/** Прогоняет один кейс и возвращает фактический результат. */
async function runCase(
  question: string,
  expected: Expectation,
  ctx: { price: Awaited<ReturnType<typeof loadPrice>>; agent: ReturnType<typeof createAgent> },
): Promise<Actual> {
  const t = Date.now();

  if (expected.type === "price") {
    // Проверяем именно матчер: так видно, тянет ли детерминированная часть
    const res = await processLine(question, ctx.price, { useLlm: false });
    return {
      code: res.item?.id ?? null,
      price: res.item?.price ?? null,
      status: res.status,
      ms: Date.now() - t,
    };
  }

  // agent и attack — через агента, как в реальной работе
  const state = await ctx.agent.invoke({ messages: [new HumanMessage(question)] });
  const answer = finalText(state);

  // Достаём цену из ответа, если она там есть (первое число с ₽ или руб)
  const priceMatch = answer.match(/(\d[\d\s]*)\s*(?:₽|руб)/i);
  const namedPrice = priceMatch ? Number(priceMatch[1]!.replace(/\s/g, "")) : null;

  return {
    answer,
    price: namedPrice,
    status: "agent",
    ms: Date.now() - t,
  };
}

async function main() {
  const client = new Client();

  // Находим датасет
  let datasetId: string | null = null;
  for await (const d of client.listDatasets({ datasetName: DATASET_NAME })) {
    if (d.name === DATASET_NAME) {
      datasetId = d.id;
      break;
    }
  }
  if (!datasetId) {
    console.log(`Датасет «${DATASET_NAME}» не найден. Сначала запустите upload.ts`);
    process.exitCode = 1;
    return;
  }

  // Собираем примеры нужной группы
  const examples: Array<{ id: string; question: string; expected: Expectation; caseId: string }> = [];
  for await (const ex of client.listExamples({ datasetId })) {
    const kind = String(ex.metadata?.kind ?? "");
    if (GROUP !== "all" && kind !== GROUP) continue;

    const question = String((ex.inputs as { question?: string }).question ?? "");
    const expected = (ex.outputs as { expected?: Expectation })?.expected;
    const caseId = String(ex.metadata?.case_id ?? ex.id);
    if (!question || !expected) continue;
    examples.push({ id: ex.id, question, expected, caseId });
  }

  console.log(`=== Прогон «${GROUP}»: ${examples.length} кейсов ===\n`);

  const price = await loadPrice();
  const agent = createAgent({ getPrice: loadPrice, useLlm: true });

  const results: Array<{
    caseId: string;
    question: string;
    actual: Actual;
    expected: Expectation;
    scores: Array<{ key: string; score: number; comment?: string }>;
    ms: number;
  }> = [];

  let n = 0;
  for (const ex of examples) {
    n++;
    const t = Date.now();

    let actual: Actual;
    try {
      actual = await runCase(ex.question, ex.expected, { price, agent });
    } catch (e) {
      actual = { answer: `ОШИБКА: ${(e as Error).message}`, code: null, price: null };
    }

    const evalArgs = { outputs: actual as unknown as Record<string, unknown>, referenceOutputs: { expected: ex.expected } };
    const scores = [
      priceCodeEvaluator(evalArgs),
      agentOutcomeEvaluator(evalArgs),
      attackResistedEvaluator(evalArgs),
      latencyEvaluator({ outputs: actual as unknown as Record<string, unknown> }),
    ];

    const ms = Date.now() - t;
    results.push({ caseId: ex.caseId, question: ex.question, actual, expected: ex.expected, scores, ms });

    // Только релевантные оценки: у кейса цены нет смысла смотреть agent_outcome
    const relevant = scores.filter((s) => !s.comment?.startsWith("не относится"));
    const mark = relevant.every((s) => s.score === 1) ? "OK  " : "ПРОВАЛ";
    const detail = relevant.filter((s) => s.score < 1).map((s) => `${s.key}: ${s.comment}`).join("; ");

    console.log(`${mark} [${n}/${examples.length}] ${ex.caseId}  ${ms} мс`);
    if (detail) console.log(`        ${detail}`);
  }

  // Итоги по каждой оценке
  console.log("\n=== ИТОГИ ===");
  const keys = ["price_code", "agent_outcome", "attack_resisted", "latency"];
  for (const key of keys) {
    const relevant = results.flatMap((r) => r.scores.filter((s) => s.key === key && !s.comment?.startsWith("не относится")));
    if (!relevant.length) continue;
    const passed = relevant.filter((s) => s.score === 1).length;
    console.log(`  ${key.padEnd(16)} ${passed}/${relevant.length}`);
  }

  const falsePositives = results.filter((r) =>
    r.scores.some((s) => s.key === "price_code" && s.comment?.includes("ЛОЖНОЕ СРАБАТЫВАНИЕ")),
  );
  console.log(`\n  Ложных срабатываний: ${falsePositives.length}`);
  if (falsePositives.length) {
    for (const f of falsePositives) console.log(`    - ${f.caseId}`);
  }

  // Отправляем эксперимент в LangSmith.
  //
  // Почему не официальная функция evaluate(). Она запускает дочерние
  // процессы через child_process.spawn, а в песочнице это запрещено
  // (spawn EPERM) — прогон обрывается уже после всех вычислений. Поэтому
  // отправляем напрямую через createRun, но правильно: с
  // reference_example_id, чтобы запуски привязались к примерам датасета
  // и в интерфейсе появился полноценный эксперимент с оценками, а не
  // россыпь отдельных запусков.
  console.log("\n=== Отправка эксперимента в LangSmith ===");

  const { randomUUID } = await import("node:crypto");
  const experimentName = `${GROUP}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;

  // Проект эксперимента создаём заранее: его id нужен и для запусков,
  // и для оценок. Если проект уже есть (повторный запуск в ту же минуту),
  // берём существующий.
  let experimentProject: string;
  const knownProject = await client.readProject({ projectName: experimentName }).catch(() => null);
  if (knownProject) {
    experimentProject = knownProject.id;
  } else {
    const created = await client.createProject({ projectName: experimentName });
    experimentProject = created.id;
  }

  // Примеры сопоставляем по case_id: в датасете это metadata.case_id
  const exampleByCase = new Map<string, string>();
  for await (const ex of client.listExamples({ datasetId })) {
    const caseId = ex.metadata?.case_id;
    if (typeof caseId === "string") exampleByCase.set(caseId, ex.id);
  }

  let sent = 0;
  for (const r of results) {
    const exampleId = exampleByCase.get(r.caseId);
    if (!exampleId) continue;

    const traceId = randomUUID();
    const startTime = new Date(Date.now() - r.ms);

    // Корневой запуск — один кейс
    await client.createRun({
      id: traceId,
      name: r.caseId,
      run_type: "chain",
      inputs: { question: r.question },
      outputs: r.actual as unknown as Record<string, unknown>,
      start_time: startTime.getTime(),
      end_time: Date.now(),
      session_id: experimentProject,
      reference_example_id: exampleId,
      extra: { metadata: { expected: r.expected, case_id: r.caseId } },
    });

    // Оценки — отдельными feedback-записями, по одной на каждую проверку.
    // Только релевантные: у кейса цены нет смысла ставить agent_outcome.
    //
    // sessionId передаём явно: без него SDK берёт проект по умолчанию и
    // предупреждает, что так скоро перестанет работать. Нам нужен именно
    // проект эксперимента.
    const relevant = r.scores.filter((s) => !s.comment?.startsWith("не относится"));
    for (const s of relevant) {
      await client.createFeedback({
        runId: traceId,
        key: s.key,
        score: s.score,
        comment: s.comment,
        sessionId: experimentProject,
      });
    }
    sent++;
  }

  console.log(`  эксперимент «${experimentName}»`);
  console.log(`  отправлено запусков: ${sent} из ${results.length}`);
  console.log(`  смотрите проект «${experimentName}» в LangSmith`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
