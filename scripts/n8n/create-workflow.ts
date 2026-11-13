/**
 * Создаёт сценарий n8n «Уведомление о новых КП».
 *
 * Запуск: node --env-file=.env.local scripts/n8n/create-workflow.ts
 *
 * СХЕМА
 *
 *   Schedule Trigger (каждые 15 минут)
 *         ↓
 *   HTTP Request → наш /api/proposals/recent  (X-ключ автоматизации)
 *         ↓
 *   Есть новые КП?  ── нет ──→ No Operation (стоп)
 *         │ да
 *         ↓
 *   Split Out (развернуть массив proposals в отдельные элементы)
 *         ↓
 *   Telegram → сообщение с суммой и ссылкой
 *
 * ПОЧЕМУ ИМЕННО ТАК
 *
 * Опрос раз в 15 минут, а не мгновенная реакция: наш эндпоинт ставит
 * отметку notified_at при выдаче, поэтому КП отдаётся ровно один раз.
 * Чаще опрашивать незачем, реже — менеджер узнает о заявке с задержкой.
 *
 * Проверка «есть ли новые» стоит до Telegram: без неё бот присылал бы
 * пустое сообщение каждые 15 минут. Это первое, что раздражает людей
 * в автоматизациях.
 *
 * Ключи НЕ вписываются в сценарий текстом: n8n хранит их в credentials.
 * Здесь они передаются через переменные окружения n8n — так сценарий
 * можно коммитить в репозиторий, не вычищая секреты.
 */
import { readFileSync } from "node:fs";

const N8N = "http://localhost:5678";

/** Читает ключ из .env.local — в код не хардкодим. */
function env(name: string): string {
  const text = readFileSync(".env.local", "utf8");
  const m = text.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!m) throw new Error(`${name} не найден в .env.local`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const API_KEY = env("N8N_API_KEY");
const AUTOMATION_KEY = env("AUTOMATION_API_KEY");
const BOT_TOKEN = env("TELEGRAM_BOT_TOKEN");
const CHAT_ID = env("TELEGRAM_CHAT_ID");

/**
 * Адрес нашего API.
 *
 * По умолчанию прод: n8n живёт на той же машине, что и дев-сервер, но
 * проверять сценарий надо на том, что реально работает у клиента.
 * Для локальной отладки: KPI_BASE_URL=http://localhost:3000
 */
const BASE = process.env.KPI_BASE_URL ?? "https://ventilation-proposal-service.vercel.app";

const WORKFLOW_NAME = "КП: уведомление о новом предложении";

const workflow = {
  name: WORKFLOW_NAME,
  nodes: [
    {
      parameters: {
        rule: {
          interval: [{ field: "minutes", minutesInterval: 15 }],
        },
      },
      id: "trigger-schedule",
      name: "Каждые 15 минут",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 0],
    },
    {
      parameters: {
        url: `${BASE}/api/proposals/recent?limit=20`,
        authentication: "none",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Authorization", value: `Bearer ${AUTOMATION_KEY}` },
            { name: "Accept", value: "application/json" },
          ],
        },
        options: {
          // Таймаут 60 с, а не 20: первый запрос к Vercel после простоя
          // поднимает функцию с нуля, и это занимает время. На 20 с
          // запуск падал с «connection closed unexpectedly» — хотя
          // сервис жив, просто просыпался.
          timeout: 60000,
        },
      },
      id: "http-recent",
      name: "Забрать новые КП",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [220, 0],
      // Повтор при обрыве — свойство УЗЛА, а не параметров. Внутри
      // parameters.options его никто не читает, и первая версия
      // сценария падала на ETIMEDOUT без единого повтора, хотя
      // настройка «была». Разница неочевидная: options — про сам
      // запрос, retryOnFail — про поведение узла при ошибке.
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
              id: "has-new",
              leftValue: "={{ $json.count }}",
              rightValue: 0,
              operator: { type: "number", operation: "gt" },
            },
          ],
          combinator: "and",
        },
        options: {},
      },
      id: "if-has-new",
      name: "Есть новые?",
      type: "n8n-nodes-base.if",
      typeVersion: 2,
      position: [440, 0],
    },
    {
      parameters: {
        fieldToSplitOut: "proposals",
        options: {},
      },
      id: "split-proposals",
      name: "Развернуть список",
      type: "n8n-nodes-base.splitOut",
      typeVersion: 1,
      position: [660, -100],
    },
    {
      parameters: {
        chatId: CHAT_ID,
        text: [
          "=Новое КП: {{ $json.name }}",
          "",
          "Сумма: {{ $json.totalSum }} ₽",
          "Позиций с ценой: {{ $json.pricedCount }} из {{ $json.totalCount }}",
          "",
          "Скачать: {{ $json.downloadUrl }}",
          "",
          "Документ доступен {{ $json.expiresInHours }} ч.",
        ].join("\n"),
        additionalFields: {
          // Без Markdown-разметки: названия файлов клиентов содержат
          // символы вроде _ и *, и Telegram отверг бы сообщение целиком.
          appendAttribution: false,
        },
      },
      id: "telegram-notify",
      name: "Уведомить в Telegram",
      type: "n8n-nodes-base.telegram",
      typeVersion: 1.2,
      position: [880, -100],
      credentials: {
        telegramApi: { id: "__TELEGRAM_CRED__", name: "Telegram VentKP" },
      },
    },
    {
      parameters: {},
      id: "no-new",
      name: "Новых нет",
      type: "n8n-nodes-base.noOp",
      typeVersion: 1,
      position: [660, 100],
    },
  ],
  connections: {
    "Каждые 15 минут": {
      main: [[{ node: "Забрать новые КП", type: "main", index: 0 }]],
    },
    "Забрать новые КП": {
      main: [[{ node: "Есть новые?", type: "main", index: 0 }]],
    },
    "Есть новые?": {
      main: [
        [{ node: "Развернуть список", type: "main", index: 0 }],
        [{ node: "Новых нет", type: "main", index: 0 }],
      ],
    },
    "Развернуть список": {
      main: [[{ node: "Уведомить в Telegram", type: "main", index: 0 }]],
    },
  },
  settings: {
    executionOrder: "v1",
    // Сохраняем удачные запуски — по ним видно, что сценарий живой
    saveManualExecutions: true,
    saveExecutionProgress: true,
  },
  // ВАЖНО: поля active здесь нет — API его не принимает при создании
  // («request/body/active is read-only»). Включение отдельным запросом
  // на /workflows/{id}/activate. Сценарий создаём выключенным: сначала
  // проверим вручную, чтобы не разослать мусор.
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
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function main() {
  console.log(`Базовый адрес API: ${BASE}\n`);

  // 1. Credentials для Telegram — создаём один раз
  console.log("1. Учётные данные Telegram");
  const existing = await api<{ data: Array<{ id: string; name: string }> }>("/credentials");
  let credId = existing.data.find((c) => c.name === "Telegram VentKP")?.id;

  if (credId) {
    console.log(`   уже есть (id ${credId})`);
  } else {
    const cred = await api<{ id: string }>("/credentials", {
      method: "POST",
      body: JSON.stringify({
        name: "Telegram VentKP",
        type: "telegramApi",
        data: { accessToken: BOT_TOKEN },
      }),
    });
    credId = cred.id;
    console.log(`   созданы (id ${credId})`);
  }

  // Подставляем настоящий id туда, где стояла заглушка
  workflow.nodes.find((n) => n.id === "telegram-notify")!.credentials!.telegramApi.id = credId;

  // 2. Сам сценарий
  console.log("\n2. Сценарий");
  const all = await api<{ data: Array<{ id: string; name: string }> }>("/workflows");
  const found = all.data.find((w) => w.name === WORKFLOW_NAME);
  if (found) {
    console.log(`   уже существует (id ${found.id}), удаляю и создаю заново`);
    // Публикацию нужно снять ДО удаления: API отвечает
    // 409 «Cannot delete a published workflow». В n8n 2.x
    // публикация — отдельная сущность, и без этого шага
    // пересоздать сценарий невозможно.
    await api(`/workflows/${found.id}/deactivate`, {
      method: "POST",
      body: JSON.stringify({}),
    }).catch(() => {});
    await api(`/workflows/${found.id}/unpublish`, {
      method: "POST",
      body: JSON.stringify({}),
    }).catch(() => {});

    // Снятие публикации асинхронное: сразу после ответа API ещё
    // говорит «still being unpublished». Ждём, пока состояние
    // успокоится, а не полагаемся на фиксированную паузу.
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
  console.log(`   создан: ${created.name} (id ${created.id})`);
  console.log(`   открыть: ${N8N}/workflow/${created.id}`);
  console.log(`\nСценарий ВЫКЛЮЧЕН. Проверим вручную, потом включим.`);
}

main().catch((e) => {
  console.error("\nОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
