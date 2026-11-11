/**
 * Заливает набор кейсов в LangSmith как датасет.
 *
 * Запуск: node --env-file=.env.local scripts/datasets/upload.ts
 *
 * Датасет — это пары «вход → эталон» плюс метаданные. Повторный запуск
 * не плодит дубликаты: набор приводится к состоянию из cases.ts
 * (изменившиеся примеры обновляются, новые добавляются).
 *
 * ВАЖНО: работаем через официальный SDK, а не через HTTP руками.
 * Ручной GET /api/v1/examples отвечает 400 «Either dataset_id or id is
 * required when as_of is a tag» независимо от аргументов — эндпоинт
 * привередлив к формату. SDK знает правильный формат.
 *
 * Формат примера:
 *   inputs   — { question }  (агент принимает вопрос человека)
 *   outputs  — { expected }  (эталон: код позиции / тип ответа / цель атаки)
 *   metadata — { case_id, kind, note }  (для фильтров в интерфейсе)
 */
import { Client } from "langsmith";
import { ALL_CASES } from "./cases.ts";

const DATASET_NAME = process.env.LANGSMITH_DATASET ?? "kp-service-eval";

async function main() {
  const client = new Client();

  console.log(`=== Датасет «${DATASET_NAME}» ===`);

  // Ищем существующий, иначе создаём
  let dataset = null;
  for await (const d of client.listDatasets({ datasetName: DATASET_NAME })) {
    if (d.name === DATASET_NAME) {
      dataset = d;
      break;
    }
  }

  if (dataset) {
    console.log(`  датасет найден: ${dataset.id}`);
  } else {
    dataset = await client.createDataset(DATASET_NAME, {
      description:
        "Проверочный набор для сервиса КП по вентиляции: поиск позиции в прайсе, " +
        "ответы агента, попытки промпт-инъекций.",
    });
    console.log(`  датасет создан: ${dataset.id}`);
  }

  // Существующие примеры по case_id — чтобы обновлять, а не дублировать
  const existing = new Map<string, string>();
  for await (const ex of client.listExamples({ datasetId: dataset.id })) {
    const caseId = ex.metadata?.case_id;
    if (typeof caseId === "string") existing.set(caseId, ex.id);
  }
  console.log(`  примеров уже в датасете: ${existing.size}`);

  // Раскладываем кейсы на «создать» и «обновить»
  const toCreate = [];
  const toUpdate = [];

  for (const c of ALL_CASES) {
    const payload = {
      inputs: { question: c.input },
      outputs: { expected: c.expect },
      metadata: { case_id: c.id, kind: c.kind, note: c.note },
    };
    const id = existing.get(c.id);
    if (id) toUpdate.push({ id, ...payload });
    else toCreate.push(payload);
  }

  if (toCreate.length) {
    await client.createExamples(
      toCreate.map((p) => ({ ...p, dataset_id: dataset.id })),
    );
  }

  for (const u of toUpdate) {
    await client.updateExample(u.id, {
      inputs: u.inputs,
      outputs: u.outputs,
      metadata: u.metadata,
    });
  }

  console.log(`  добавлено: ${toCreate.length}`);
  console.log(`  обновлено: ${toUpdate.length}`);

  // Проверяем результат
  let total = 0;
  const byKind = new Map<string, number>();
  for await (const ex of client.listExamples({ datasetId: dataset.id })) {
    total++;
    const kind = String(ex.metadata?.kind ?? "?");
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }

  console.log(`\nИтого в датасете: ${total} примеров`);
  for (const [k, v] of byKind) console.log(`  ${k.padEnd(8)} ${v}`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
