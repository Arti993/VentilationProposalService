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

/**
 * Сценарии по короткому имени.
 *
 * Явный список, а не поиск по подстроке «КП:»: скрипт меняет состояние
 * того, что реально рассылает сообщения людям. Опечатка в аргументе
 * должна падать с ошибкой, а не находить первый похожий сценарий.
 */
const WORKFLOWS: Record<string, string> = {
  notify: "КП: уведомление о новом предложении",
  reminders: "КП: напоминания по сделкам",
};

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
  const [action, key] = [process.argv[2] ?? "status", process.argv[3] ?? "notify"];

  if (!["on", "off", "status"].includes(action)) {
    throw new Error(`Действие должно быть on, off или status — получено «${action}»`);
  }
  const name = WORKFLOWS[key];
  if (!name) {
    throw new Error(`Неизвестный сценарий «${key}». Доступны: ${Object.keys(WORKFLOWS).join(", ")}`);
  }

  const all = await api<{ data: Array<{ id: string; name: string; active: boolean }> }>("/workflows");
  const wf = all.data.find((w) => w.name === name);
  if (!wf) throw new Error(`Сценарий «${name}» не найден в n8n`);

  if (action === "status") {
    console.log(`${wf.name}: ${wf.active ? "АКТИВЕН" : "выключен"} (id ${wf.id})`);
    return;
  }

  if (action === "on") {
    await api(`/workflows/${wf.id}/activate`, { method: "POST", body: JSON.stringify({}) });
    // Активации мало: планировщик видит только опубликованную версию.
    // Без publish сценарий показывает «активен», но не запускается —
    // ровно на этом я потерял час в первом сценарии.
    await api(`/workflows/${wf.id}/publish`, { method: "POST", body: JSON.stringify({}) });
    console.log(`ВКЛЮЧЁН и ОПУБЛИКОВАН: ${wf.name}`);
    return;
  }

  await api(`/workflows/${wf.id}/deactivate`, { method: "POST", body: JSON.stringify({}) });
  console.log(`выключен: ${wf.name}`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
