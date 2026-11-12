/**
 * Включает или выключает сценарий n8n.
 *
 * Запуск: node --env-file=.env.local scripts/n8n/toggle.ts on
 *         node --env-file=.env.local scripts/n8n/toggle.ts off
 *         node --env-file=.env.local scripts/n8n/toggle.ts status
 *
 * Отдельный скрипт, потому что поле active нельзя передать при создании
 * сценария («request/body/active is read-only») — для этого есть
 * собственные эндпоинты activate и deactivate.
 */
import { readFileSync } from "node:fs";

const N8N = "http://localhost:5678";
const NAME = "КП: уведомление о новом предложении";

function env(name: string): string {
  const text = readFileSync(".env.local", "utf8");
  const m = text.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!m) throw new Error(`${name} не найден в .env.local`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const API_KEY = env("N8N_API_KEY");

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
  const action = (process.argv[2] ?? "status") as "on" | "off" | "status";

  const all = await api<{ data: Array<{ id: string; name: string; active: boolean }> }>("/workflows");
  const wf = all.data.find((w) => w.name === NAME);
  if (!wf) throw new Error(`Сценарий «${NAME}» не найден`);

  if (action === "status") {
    console.log(`${wf.name}: ${wf.active ? "АКТИВЕН" : "выключен"} (id ${wf.id})`);
    return;
  }

  if (action === "on") {
    if (wf.active) {
      console.log("Уже активен — ничего не делаю.");
      return;
    }
    await api(`/workflows/${wf.id}/activate`, { method: "POST", body: JSON.stringify({}) });
    console.log(`ВКЛЮЧЁН: ${wf.name}`);
    console.log(`Проверка будет каждые 15 минут. Первый запуск — по расписанию.`);
    return;
  }

  await api(`/workflows/${wf.id}/deactivate`, { method: "POST", body: JSON.stringify({}) });
  console.log(`выключен: ${wf.name}`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
