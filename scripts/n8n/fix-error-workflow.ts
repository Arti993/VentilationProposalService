/**
 * Переделывает сторожа: токен из credentials вместо $env.
 *
 * Запуск: node --env-file=.env.local scripts/n8n/fix-error-workflow.ts
 *
 * ЧТО БЫЛО СЛОМАНО
 *
 * Первая версия брала токен бота так: `{{ $env.TELEGRAM_BOT_TOKEN }}`.
 * n8n 2.x по умолчанию запрещает выражениям читать переменные окружения
 * (это защита от утечки чужих секретов через сценарий). Результат:
 * «access to env vars denied» ровно в момент аварии — то есть сторож
 * падал именно тогда, когда должен был спасать.
 *
 * ЧЕГО Я НЕ СТАЛ ДЕЛАТЬ
 *
 * Можно было включить `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` и оставить
 * $env. Но тогда секрет доступен из ЛЮБОГО узла любого сценария, в том
 * числе того, куда однажды скопируют чужой код из интернета. Для
 * учебного проекта это лишний риск без выгоды.
 *
 * КАК ПРАВИЛЬНО
 *
 * Токен живёт в credentials — отдельном хранилище n8n, зашифрованном и
 * невидимом в тексте сценария. В узле Telegram используется
 * `authentication: predefinedCredentialType`, а сам токен подставляется
 * n8n при запросе. В экспорт сценария секрет не попадает.
 *
 * ПОЧЕМУ УЗЕЛ TELEGRAM, А НЕ HTTP
 *
 * У HTTP-узла тоже есть credentials (Header Auth), но тогда в сценарии
 * остаётся URL с плейсхолдером токена — соблазн вписать ключ руками
 * никуда не девается. Узел Telegram принимает credentials напрямую и
 * сам собирает URL. Меньше мест, где можно ошибиться.
 */
import { readFileSync } from "node:fs";

const N8N = process.env.N8N_URL ?? "http://localhost:5678";
const GUARD_NAME = "КП: сторож ошибок";

function env(name: string): string {
  const text = readFileSync(".env.local", "utf8");
  const m = text.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!m) throw new Error(`${name} не найден в .env.local`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const API_KEY = env("N8N_API_KEY");
const BOT_TOKEN = env("TELEGRAM_BOT_TOKEN");
const CHAT_ID = env("TELEGRAM_CHAT_ID");

const CRED_NAME = "Telegram · сторож ошибок";

interface Credential {
  id: string;
  name: string;
  type: string;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${N8N}/api/v1${path}`, {
    ...init,
    headers: {
      "X-N8N-API-KEY": API_KEY,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} на ${path}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/**
 * Текст сообщения.
 *
 * `$json.execution` может быть неполным — если ошибка случилась до
 * первого узла. `?.` и `??` здесь обязательны: сообщение о падении не
 * должно падать само.
 *
 * Длина ограничена: Telegram принимает 4096 символов, а стектрейс
 * бывает длиннее. Обрезаем на 500 — самое полезное всегда в начале.
 */
const MESSAGE_TEXT = `🚨 Автоматизация сломалась

Сценарий: {{ $json.workflow?.name ?? 'неизвестно' }}
Узел: {{ $json.execution?.error?.node?.name ?? '—' }}
Выполнение: #{{ $json.execution?.id ?? '?' }}

Ошибка:
{{ String($json.execution?.error?.message ?? 'без описания').slice(0, 500) }}

Откройте n8n → Executions.`;

async function main() {
  console.log("Переделываю сторожа на credentials\n");

  // ── 1. Credentials ──
  const existing = await api<{ data: Credential[] }>("/credentials?limit=100");
  let cred = existing.data.find((c) => c.name === CRED_NAME && c.type === "telegramApi");

  if (cred) {
    console.log(`  credentials уже есть: ${cred.id}`);
  } else {
    const created = await api<{ id: string }>("/credentials", {
      method: "POST",
      body: JSON.stringify({
        name: CRED_NAME,
        type: "telegramApi",
        data: { accessToken: BOT_TOKEN },
      }),
    });
    cred = { id: created.id, name: CRED_NAME, type: "telegramApi" };
    console.log(`  credentials созданы: ${cred.id}`);
  }

  // ── 2. Пересобираю сценарий ──
  const list = await api<{ data: Array<{ id: string; name: string; settings?: Record<string, unknown> }> }>(
    "/workflows?limit=100",
  );
  const guard = list.data.find((w) => w.name === GUARD_NAME);
  if (!guard) throw new Error(`сторож «${GUARD_NAME}» не найден`);

  const workflow = {
    name: GUARD_NAME,
    nodes: [
      {
        parameters: {},
        id: "trigger-error",
        name: "При ошибке",
        type: "n8n-nodes-base.errorTrigger",
        typeVersion: 1,
        position: [0, 0],
      },
      {
        // Не сообщаем о собственном падении: иначе петля сообщений
        parameters: {
          conditions: {
            options: {
              caseSensitive: true,
              leftValue: "",
              typeValidation: "strict",
            },
            conditions: [
              {
                id: "not-self",
                leftValue: "={{ $json.workflow?.name ?? '' }}",
                rightValue: GUARD_NAME,
                operator: { type: "string", operation: "notEquals" },
              },
            ],
            combinator: "and",
          },
          options: {},
        },
        id: "filter-self",
        name: "Не о себе",
        type: "n8n-nodes-base.filter",
        typeVersion: 2.2,
        position: [220, 0],
      },
      {
        parameters: {
          // chatId строкой: Telegram ждёт именно строку, а $env
          // закрыт — подставляем значение при создании сценария
          chatId: CHAT_ID,
          text: MESSAGE_TEXT,
          additionalFields: {},
        },
        id: "send-telegram",
        name: "Сообщить в Telegram",
        type: "n8n-nodes-base.telegram",
        typeVersion: 1.2,
        position: [440, 0],
        credentials: {
          telegramApi: { id: cred.id, name: cred.name },
        },
        // Три попытки: сеть до Telegram нестабильна из-за прокси,
        // и единственное сообщение об аварии терять нельзя
        retryOnFail: true,
        maxTries: 3,
        waitBetweenTries: 5000,
        onError: "continueErrorOutput",
      },
    ],
    connections: {
      "При ошибке": { main: [[{ node: "Не о себе", type: "main", index: 0 }]] },
      "Не о себе": { main: [[{ node: "Сообщить в Telegram", type: "main", index: 0 }]] },
    },
    settings: {
      executionOrder: "v1",
      saveManualExecutions: true,
      saveExecutionProgress: true,
    },
  };

  // Снимаем с публикации, иначе PUT вернёт 409
  try {
    await api(`/workflows/${guard.id}/deactivate`, { method: "POST" });
  } catch {
    /* неактивен */
  }
  try {
    await api(`/workflows/${guard.id}/unpublish`, { method: "POST" });
  } catch {
    /* не опубликован */
  }

  const updated = await api<{ id: string; settings?: Record<string, unknown> }>(
    `/workflows/${guard.id}`,
    { method: "PUT", body: JSON.stringify(workflow) },
  );
  console.log(`  сценарий пересобран: ${updated.id}`);

  await api(`/workflows/${updated.id}/activate`, { method: "POST" });
  try {
    await api(`/workflows/${updated.id}/publish`, { method: "POST" });
  } catch (e) {
    console.log(`  публикация: ${e instanceof Error ? e.message : e}`);
  }
  console.log("  активирован и опубликован");

  console.log("\nГотово. Проверьте срабатывание:");
  console.log("  node --env-file=.env.local scripts/n8n/test-error-watchdog.ts");
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
