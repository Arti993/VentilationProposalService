/**
 * Запускает сценарий n8n вручную и показывает, что произошло.
 *
 * Запуск: node --env-file=.env.local scripts/n8n/test-run.ts
 *
 * Зачем: сценарий с расписанием нельзя проверить сразу — ждать 15 минут.
 * API позволяет запустить его принудительно, минуя триггер. Так мы
 * увидим реальный результат: дошло ли сообщение в Telegram.
 */
import { readFileSync } from "node:fs";

const N8N = "http://localhost:5678";

function env(name: string): string {
  const text = readFileSync(".env.local", "utf8");
  const m = text.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!m) throw new Error(`${name} не найден в .env.local`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const API_KEY = env("N8N_API_KEY");
const WORKFLOW_NAME = "КП: уведомление о новом предложении";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${N8N}/api/v1${path}`, {
    ...init,
    headers: {
      "X-N8N-API-KEY": API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function main() {
  const all = await api<{ data: Array<{ id: string; name: string; active: boolean }> }>("/workflows");
  const wf = all.data.find((w) => w.name === WORKFLOW_NAME);
  if (!wf) throw new Error(`Сценарий «${WORKFLOW_NAME}» не найден`);

  console.log(`Сценарий: ${wf.name}`);
  console.log(`  id: ${wf.id}`);
  console.log(`  активен: ${wf.active}\n`);

  console.log("Запускаю вручную (жду результат)…");
  const run = await api<{ executionId?: string; status?: string }>(
    `/workflows/${wf.id}/run`,
    { method: "POST", body: JSON.stringify({}) },
  );
  console.log(`  запуск: ${JSON.stringify(run)}\n`);

  // Даём сценарию время отработать: один HTTP-запрос + Telegram
  await new Promise((r) => setTimeout(r, 8000));

  console.log("Последние выполнения:");
  const execs = await api<{
    data: Array<{
      id: number;
      status: string;
      startedAt: string;
      stoppedAt?: string;
      workflowId: string;
    }>;
  }>("/executions?limit=5");

  if (!execs.data.length) {
    console.log("  (нет)");
    return;
  }

  for (const e of execs.data) {
    const ms = e.stoppedAt
      ? new Date(e.stoppedAt).getTime() - new Date(e.startedAt).getTime()
      : undefined;
    const mark = e.status === "success" ? "УСПЕХ" : e.status === "error" ? "ОШИБКА" : e.status;
    console.log(`  #${e.id} ${mark}${ms !== undefined ? ` ${ms} мс` : ""}`);
  }

  // Подробности последнего выполнения
  const last = execs.data[0];
  console.log(`\nДетали выполнения #${last.id}:`);
  const detail = await api<{
    data: {
      status: string;
      data?: { resultData?: { error?: { message: string; node?: { name: string } } } };
    };
  }>(`/executions/${last.id}?includeData=true`);

  const err = detail.data?.data?.resultData?.error;
  if (err) {
    console.log(`  ОШИБКА в узле «${err.node?.name}»`);
    console.log(`  ${err.message}`);
  } else {
    console.log(`  статус: ${detail.data.status}, ошибок нет`);
  }
}

main().catch((e) => {
  console.error("\nОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
