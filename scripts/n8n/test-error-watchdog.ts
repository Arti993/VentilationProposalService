/**
 * Проверяет, что сторож ошибок реально срабатывает.
 *
 * Запуск: node --env-file=.env.local scripts/n8n/test-error-watchdog.ts
 *
 * ПОЧЕМУ ПРОСТО «СОЗДАТЬ ERROR TRIGGER» НЕДОСТАТОЧНО
 *
 * Error Trigger в n8n срабатывает не на всякую ошибку, а только на
 * ошибку сценария, у которого в настройках указан `settings.errorWorkflow`.
 * Это отсылка «если я упаду — сообщи туда-то». Без неё узел висит
 * активированным и молчит: выглядит работающим, но не видит ничего.
 *
 * Глобальной настройки «все ошибки шлём в сценарий X» в публичном API
 * self-hosted n8n нет. Значит, привязку надо проставить каждому
 * сценарию, за которым хотим следить.
 *
 * ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ
 *
 *  1. Проверяет, что сторож существует.
 *  2. Проставляет settings.errorWorkflow всем сценариям проекта.
 *  3. Создаёт временный сценарий, который падает, и ждёт реакции.
 *  4. Удаляет за собой.
 *
 * Проверка «урони и посмотри» обязательна: сторож молчит и когда всё
 * хорошо, и когда он сломан. Отличить одно от другого можно только
 * устроив настоящую аварию.
 */

const N8N = process.env.N8N_URL ?? "http://localhost:5678";
const GUARD_NAME = "КП: сторож ошибок";
const TEST_NAME = "КП: ТЕСТ сторожа";

interface Workflow {
  id: string;
  name: string;
  active: boolean;
  nodes: unknown[];
  connections: unknown;
  settings?: Record<string, unknown>;
}

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ок  " : "ПРОВАЛ"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function api<T>(key: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${N8N}/api/v1${path}`, {
    ...init,
    headers: {
      "X-N8N-API-KEY": key,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} на ${path}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Удаляет сценарий, разбираясь с публикацией: n8n не даёт удалить активный. */
async function deleteWorkflow(key: string, id: string) {
  try {
    await api(key, `/workflows/${id}/deactivate`, { method: "POST" });
  } catch {
    /* неактивен */
  }
  try {
    await api(key, `/workflows/${id}/unpublish`, { method: "POST" });
  } catch {
    /* не опубликован */
  }

  for (let i = 0; i < 20; i++) {
    try {
      await api(key, `/workflows/${id}`, { method: "DELETE" });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("409")) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      return false;
    }
  }
  return false;
}

async function main() {
  const key = process.env.N8N_API_KEY;
  if (!key) {
    console.error("Нет N8N_API_KEY. Запуск: node --env-file=.env.local scripts/n8n/test-error-watchdog.ts");
    process.exit(1);
  }

  console.log(`Проверка сторожа на ${N8N}\n`);

  // ── 1. Сторож на месте ──
  const list = await api<{ data: Workflow[] }>(key, "/workflows?limit=100");
  const guard = list.data.find((w) => w.name === GUARD_NAME);

  if (!guard) {
    console.error(`Сторож «${GUARD_NAME}» не найден.`);
    console.error("Создайте: node --env-file=.env.local scripts/n8n/create-error-workflow.ts");
    process.exit(1);
  }

  console.log("1. Сторож найден:");
  check("активен", guard.active, guard.active ? "" : "не активирован — не сработает");
  console.log(`     id: ${guard.id}`);

  // ── 2. Привязка ко всем сценариям ──
  console.log("\n2. Привязываю сторож к сценариям:");

  const targets = list.data.filter((w) => w.id !== guard.id && !w.name.startsWith("КП: ТЕСТ"));
  for (const w of targets) {
    const settings = { ...(w.settings ?? {}), errorWorkflow: guard.id };
    try {
      await api(key, `/workflows/${w.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: w.name,
          nodes: w.nodes,
          connections: w.connections,
          settings,
        }),
      });
      console.log(`  ок   ${w.name}`);
    } catch (e) {
      console.log(`  ПРОВАЛ ${w.name}: ${e instanceof Error ? e.message : e}`);
      failures++;
    }
  }

  if (targets.length === 0) console.log("  (нет сценариев, кроме сторожа)");

  // ── 3. Настоящая авария ──
  console.log("\n3. Устраиваю аварию:");

  const old = list.data.find((w) => w.name === TEST_NAME);
  if (old) await deleteWorkflow(key, old.id);

  const created = await api<{ id: string }>(key, "/workflows", {
    method: "POST",
    body: JSON.stringify({
      name: TEST_NAME,
      nodes: [
        {
          parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } },
          id: "t1",
          name: "Каждую минуту",
          type: "n8n-nodes-base.scheduleTrigger",
          typeVersion: 1.2,
          position: [0, 0],
        },
        {
          parameters: { jsCode: "throw new Error('Тестовая авария: проверка сторожа');" },
          id: "t2",
          name: "Упасть намеренно",
          type: "n8n-nodes-base.code",
          typeVersion: 2,
          position: [220, 0],
        },
      ],
      connections: {
        "Каждую минуту": { main: [[{ node: "Упасть намеренно", type: "main", index: 0 }]] },
      },
      settings: { executionOrder: "v1", errorWorkflow: guard.id },
    }),
  });
  console.log(`  временный сценарий: ${created.id}`);

  await api(key, `/workflows/${created.id}/activate`, { method: "POST" });
  try {
    await api(key, `/workflows/${created.id}/publish`, { method: "POST" });
  } catch {
    /* нет публикации в этой версии */
  }

  // ── 4. Ждём падения ──
  console.log("  жду падения (до 2 минут)…");
  let crashedId = "";
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const ex = await api<{ data: Array<{ id: string; status: string }> }>(
      key,
      `/executions?workflowId=${created.id}&limit=5`,
    );
    const err = ex.data.find((e) => e.status === "error");
    if (err) {
      crashedId = err.id;
      console.log(`  сценарий упал: #${err.id}`);
      break;
    }
  }
  check("временный сценарий упал", Boolean(crashedId));

  // ── 5. Сторож отреагировал? ──
  let guardRun = "";
  if (crashedId) {
    console.log("  жду реакции сторожа (до минуты)…");
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const ex = await api<{ data: Array<{ id: string; status: string }> }>(
        key,
        `/executions?workflowId=${guard.id}&limit=5`,
      );
      if (ex.data.length) {
        guardRun = ex.data[0].id;
        console.log(`  сторож сработал: #${ex.data[0].id} (${ex.data[0].status})`);
        break;
      }
    }
  }
  check("сторож отреагировал", Boolean(guardRun));

  // ── 6. Уборка ──
  const cleaned = await deleteWorkflow(key, created.id);
  check("временный сценарий удалён", cleaned);

  console.log(
    `\n${failures === 0 ? "Сторож работает. Проверьте Telegram — должно быть сообщение «Автоматизация сломалась»." : `Провалов: ${failures}`}`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
