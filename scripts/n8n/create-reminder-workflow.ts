/**
 * Сценарий n8n «Напоминания по КП без ответа».
 *
 * Запуск: node --env-file=.env.local scripts/n8n/create-reminder-workflow.ts
 *
 * СХЕМА
 *
 *   Каждые 30 минут
 *         ↓
 *   GET /api/proposals/log?due=1   (забрать и сдвинуть срок)
 *         ↓
 *   Есть кому напомнить?  ── нет ──→ стоп
 *         │ да
 *         ↓
 *   Развернуть список
 *         ↓
 *   Telegram менеджеру: «пора напомнить клиенту»
 *
 * ПОЧЕМУ НАПОМИНАНИЕ ИДЁТ МЕНЕДЖЕРУ, А НЕ КЛИЕНТУ
 *
 * Клиенту писать некуда: в смете нет email. Хранить чужой адрес только
 * ради автоматического письма — так себе идея, а выдумывать его нельзя.
 *
 * Поэтому сценарий напоминает ЧЕЛОВЕКУ, а не клиенту: «это КП висит три
 * дня, пора позвонить». Письмо пишет менеджер, зная контекст разговора.
 * Это честнее и, по-хорошему, полезнее: шаблонное «вы не ответили»
 * раздражает, живой звонок — нет.
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
const AUTOMATION_KEY = env("AUTOMATION_API_KEY");
const CHAT_ID = env("TELEGRAM_CHAT_ID");
const BASE = process.env.KPI_BASE_URL ?? "https://ventilation-proposal-service.vercel.app";

const NAME = "КП: напоминания по сделкам";

const workflow = {
  name: NAME,
  nodes: [
    {
      parameters: {
        rule: { interval: [{ field: "minutes", minutesInterval: 30 }] },
      },
      id: "trig-remind",
      name: "Каждые 30 минут",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 0],
    },
    {
      parameters: {
        url: `${BASE}/api/proposals/log?due=1&limit=20`,
        authentication: "none",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Authorization", value: `Bearer ${AUTOMATION_KEY}` },
            { name: "Accept", value: "application/json" },
          ],
        },
        // Один элемент на выходе — объект { ok, count, reminders[] }
        options: { timeout: 60000, response: { response: { responseFormat: "json" } } },
      },
      id: "http-due",
      name: "Кому пора напомнить",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [220, 0],
      // Свойства узла, а не options: первая версия сценария держала
      // повторы внутри parameters, где их никто не читает.
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 5000,
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
          conditions: [
            {
              id: "has-due",
              leftValue: "={{ $json.count }}",
              rightValue: 0,
              operator: { type: "number", operation: "gt" },
            },
          ],
          combinator: "and",
        },
        options: {},
      },
      id: "if-due",
      name: "Есть кому?",
      type: "n8n-nodes-base.if",
      typeVersion: 2,
      position: [440, 0],
    },
    {
      parameters: { fieldToSplitOut: "reminders", options: {} },
      id: "split-due",
      name: "Развернуть",
      type: "n8n-nodes-base.splitOut",
      typeVersion: 1,
      position: [660, -100],
    },
    {
      parameters: {
        chatId: CHAT_ID,
        text: [
          "=Пора напомнить о КП: {{ $json.name }}",
          "",
          "Сумма: {{ $json.totalSum }} ₽",
          "Отправлено: {{ $json.createdAt }}",
          "Напоминание №{{ $json.remindersSent }}",
          "",
          "{{ $json.remindersSent === 1 ? 'Клиент молчит 3 дня — стоит позвонить.' : 'Прошла неделя без ответа — последнее напоминание, дальше не дёргаем.' }}",
        ].join("\n"),
        additionalFields: { appendAttribution: false },
      },
      id: "tg-remind",
      name: "Напомнить менеджеру",
      type: "n8n-nodes-base.telegram",
      typeVersion: 1.2,
      position: [880, -100],
      credentials: { telegramApi: { id: "__TELEGRAM_CRED__", name: "Telegram VentKP" } },
    },
    {
      parameters: {},
      id: "no-due",
      name: "Напоминать некому",
      type: "n8n-nodes-base.noOp",
      typeVersion: 1,
      position: [660, 100],
    },
  ],
  connections: {
    "Каждые 30 минут": { main: [[{ node: "Кому пора напомнить", type: "main", index: 0 }]] },
    "Кому пора напомнить": { main: [[{ node: "Есть кому?", type: "main", index: 0 }]] },
    "Есть кому?": {
      main: [
        [{ node: "Развернуть", type: "main", index: 0 }],
        [{ node: "Напоминать некому", type: "main", index: 0 }],
      ],
    },
    Развернуть: { main: [[{ node: "Напомнить менеджеру", type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1", saveManualExecutions: true },
};

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
  const creds = await api<{ data: Array<{ id: string; name: string }> }>("/credentials");
  const cred = creds.data.find((c) => c.name === "Telegram VentKP");
  if (!cred) throw new Error("Учётные данные Telegram VentKP не найдены");
  workflow.nodes.find((n) => n.id === "tg-remind")!.credentials!.telegramApi.id = cred.id;

  const all = await api<{ data: Array<{ id: string; name: string }> }>("/workflows");
  const found = all.data.find((w) => w.name === NAME);
  if (found) {
    console.log(`уже существует (${found.id}) — удаляю`);
    await api(`/workflows/${found.id}/deactivate`, { method: "POST", body: "{}" }).catch(() => {});
    await api(`/workflows/${found.id}/unpublish`, { method: "POST", body: "{}" }).catch(() => {});
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        await api(`/workflows/${found.id}`, { method: "DELETE" });
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("still being unpublished") && i < 19) continue;
        throw e;
      }
    }
  }

  const created = await api<{ id: string; name: string }>("/workflows", {
    method: "POST",
    body: JSON.stringify(workflow),
  });
  console.log(`создан: ${created.name} (${created.id})`);
  console.log(`открыть: ${N8N}/workflow/${created.id}`);
  console.log("\nДля включения: node --env-file=.env.local scripts/n8n/toggle.ts on-reminders");
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
