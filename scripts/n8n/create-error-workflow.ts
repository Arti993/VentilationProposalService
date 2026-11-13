/**
 * Создаёт сценарий n8n «Сторож: ошибка в автоматизации».
 *
 * Запуск: node --env-file=.env.local scripts/n8n/create-error-workflow.ts
 *
 * ЗАЧЕМ
 *
 * n8n падает молча. Сценарий не отправил уведомление — никто не узнал.
 * Тишина выглядит одинаково в двух случаях: «всё хорошо, новых КП нет» и
 * «сценарий сломался три дня назад». Различить их можно только по
 * истории выполнений, а её никто не открывает каждый день.
 *
 * Сторож превращает тишину в громкое молчание: если что-то упало —
 * в Telegram приходит сообщение с названием сценария, узлом и текстом
 * ошибки.
 *
 * ПОЧЕМУ ERROR TRIGGER, А НЕ ПРОВЕРКА РАСПИСАНИЕМ
 *
 * Можно было бы раз в час опрашивать API «есть ли ошибки». Но тогда
 * сообщение приходит с задержкой до часа, а если падает сам опрос —
 * сторож не заметит и этого. Error Trigger срабатывает в момент падения,
 * внутри того же процесса, и не требует ни сети, ни ключей.
 *
 * ЛОВУШКА: ЧЕМ ERROR TRIGGER ОТЛИЧАЕТСЯ ОТ ОСТАЛЬНЫХ
 *
 * У Error Trigger нет параметров — вообще. Это узел-заглушка: он не
 * «инструктирует» n8n, а служит меткой «сюда придут ошибки». Всё, что
 * нужно, он получает из самого события падения:
 *
 *   $json.execution.error.node.name  — какой узел упал
 *   $json.execution.error.message    — текст ошибки
 *   $json.workflow.name              — какой сценарий
 *   $json.execution.id               — номер выполнения
 *
 * Ошибка в использовании: положить в parameters какую-нибудь настройку
 * («только ошибки этих сценариев») и удивиться, что она не работает.
 * Фильтровать сценарии нужно ВНУТРИ, после узла-фильтра.
 *
 * ЛОВУШКА 2: СТОРОЖ НЕ ДОЛЖЕН ПАДАТЬ САМ
 *
 * Если этот сценарий упадёт, сообщить о падении будет некому. Поэтому
 * здесь нет HTTP-запросов к нашему API и минимум зависимостей: только
 * Telegram. Падение Telegram — единственное, что может его сломать, и
 * это уже видно в интерфейсе.
 *
 * ЛОВУШКА 3: SETTINGS НА УРОВНЕ СЦЕНАРИЯ
 *
 * У Error Trigger есть особый режим: он срабатывает на ошибки сценариев
 * ТОГО ЖЕ проекта. В n8n self-hosted проект один, так что сторож видит
 * ошибки всех сценариев. На n8n Cloud проектов может быть несколько —
 * тогда сторож в каждом.
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

const WORKFLOW_NAME = "КП: сторож ошибок";

/**
 * Текст сообщения.
 *
 * Выражения n8n — это JavaScript внутри {{ }}. Обращаемся к ним
 * защищённо: `.node.name` может быть undefined, если ошибка пришла не
 * от узла (например, при старте сценария). Без `?.` сообщение упало бы
 * ровно тогда, когда оно нужнее всего.
 *
 * Первая строка — что сломалось. Второй абзац — где. Третье — текст
 * ошибки, обрезанный до 500 символов: длинные стектрейсы Telegram
 * режет некрасиво, а самое информативное обычно в начале.
 */
const MESSAGE_TEXT = [
  "🚨 Автоматизация сломалась",
  "",
  "Сценарий: {{ $json.workflow?.name ?? 'неизвестно' }}",
  "Узел: {{ $json.execution?.error?.node?.name ?? '—' }}",
  "Выполнение: #{{ $json.execution?.id ?? '?' }}",
  "",
  "Ошибка:",
  "{{ String($json.execution?.error?.message ?? 'без описания').slice(0, 500) }}",
  "",
  "Откройте n8n → Executions, чтобы разобраться.",
].join("\n");

const workflow = {
  name: WORKFLOW_NAME,
  nodes: [
    {
      // Параметров нет намеренно: узел-метка, а не настройка
      parameters: {},
      id: "trigger-error",
      name: "При ошибке",
      type: "n8n-nodes-base.errorTrigger",
      typeVersion: 1,
      position: [0, 0],
    },
    {
      // Второй сторож не должен сообщать о себе: иначе падение
      // этого же сценария породит бесконечную петлю сообщений
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
              rightValue: WORKFLOW_NAME,
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
      // Отправляем через HTTP, а не через узел Telegram: у узла
      // Telegram своя настройка credentials, которую пришлось бы
      // заводить заново. HTTP с токеном в URL работает сразу и не
      // добавляет ещё одно место, где может разъехаться конфиг.
      parameters: {
        method: "POST",
        url: "=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage",
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: "Content-Type", value: "application/json" }],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: JSON.stringify({
          chat_id: "={{ $env.TELEGRAM_CHAT_ID }}",
          text: MESSAGE_TEXT,
          disable_web_page_preview: true,
        }),
        options: {
          timeout: 20000,
        },
      },
      id: "send-telegram",
      name: "Сообщить в Telegram",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [440, 0],
      // Повторы обязательны: это последняя линия обороны. Если и оно
      // упадёт, о падении никто не узнает — но хотя бы попыток будет три
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 5000,
    },
  ],
  connections: {
    "При ошибке": { main: [[{ node: "Не о себе", type: "main", index: 0 }]] },
    "Не о себе": { main: [[{ node: "Сообщить в Telegram", type: "main", index: 0 }]] },
  },
  settings: {
    executionOrder: "v1",
    // Сохраняем и успешные запуски: успешный прогон сторожа — это
    // признак, что ЧТО-ТО упало и сообщение ушло. Без истории не
    // отличить «ошибок не было» от «сторож не работает»
    saveManualExecutions: true,
    saveExecutionProgress: true,
  },
};

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
 * Удаляет старую версию сценария, если она есть.
 *
 * Порядок важен: n8n 2.x не даёт удалить опубликованный сценарий
 * (409), и не даёт удалить сразу после снятия с публикации (409, пока
 * идёт публикация). Приходится снимать и ждать.
 */
async function removeExisting(id: string) {
  console.log(`  удаляю старую версию ${id}`);
  try {
    await api(`/workflows/${id}/deactivate`, { method: "POST" });
  } catch {
    // Уже неактивен — это нормально
  }

  // Снятие с публикации в n8n 2.x — отдельная операция. Пробуем,
  // но не считаем обязательной: у неопубликованного сценария её нет.
  try {
    await api(`/workflows/${id}/unpublish`, { method: "POST" });
  } catch {
    /* нет такой операции — значит и публикации нет */
  }

  for (let i = 0; i < 20; i++) {
    try {
      await api(`/workflows/${id}`, { method: "DELETE" });
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("409") && msg.includes("unpublishing")) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw e;
    }
  }
  throw new Error("не удалось удалить старый сценарий");
}

async function main() {
  console.log("Создаю сторожа ошибок\n");

  const existing = await api<{ data: Array<{ id: string; name: string }> }>(
    "/workflows?limit=100",
  );
  const dup = existing.data.find((w) => w.name === WORKFLOW_NAME);
  if (dup) await removeExisting(dup.id);

  const created = await api<{ id: string }>("/workflows", {
    method: "POST",
    body: JSON.stringify(workflow),
  });
  console.log(`  создан: ${created.id}`);

  // Активируем и публикуем: активный, но неопубликованный сценарий
  // не видит планировщик — я на этом уже обжигался
  await api(`/workflows/${created.id}/activate`, { method: "POST" });
  console.log("  активирован");

  try {
    await api(`/workflows/${created.id}/publish`, { method: "POST" });
    console.log("  опубликован");
  } catch (e) {
    console.log(
      `  публикация не удалась: ${e instanceof Error ? e.message : e}\n` +
        "  в этой версии n8n публикации может не быть — только активация",
    );
  }

  console.log(`\nГотово. Сторож активен и смотрит на все сценарии проекта.`);

  await testFire();
}

/**
 * Проверка «выстрелит ли».
 *
 * Намеренно роняем временный сценарий по расписанию (раз в минуту) и
 * смотрим, отреагировал ли сторож. Проверять сторожа «на глаз»
 * бессмысленно: он молчит, когда всё хорошо, и молчит, когда сломан.
 * Единственный способ узнать — устроить настоящую аварию.
 *
 * Почему расписание, а не ручной запуск: публичный API n8n не умеет
 * запускать сценарии (405 на /run), а кнопка в интерфейсе — это ручная
 * работа. Расписание раз в минуту даёт настоящий запуск за минуту.
 *
 * Временный сценарий удаляется сразу после проверки — в проекте не
 * должно оставаться мусора, который потом будет падать каждый час.
 */
async function testFire() {
  console.log("\n=== Проверка: роняю временный сценарий ===");

  const crash = {
    name: "КП: ТЕСТ сторожа",
    nodes: [
      {
        parameters: {
          rule: { interval: [{ field: "minutes", minutesInterval: 1 }] },
        },
        id: "test-schedule",
        name: "Каждую минуту",
        type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2,
        position: [0, 0],
      },
      {
        // Code-узел с исключением — самый дешёвый способ уронить
        // сценарий без внешних зависимостей и сети
        parameters: {
          jsCode: "throw new Error('Тестовая авария: проверка сторожа');",
        },
        id: "test-throw",
        name: "Упасть намеренно",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [220, 0],
      },
    ],
    connections: {
      "Каждую минуту": {
        main: [[{ node: "Упасть намеренно", type: "main", index: 0 }]],
      },
    },
    settings: { executionOrder: "v1" },
  };

  const test = await api<{ id: string }>("/workflows", {
    method: "POST",
    body: JSON.stringify(crash),
  });
  console.log(`  временный сценарий: ${test.id}`);

  await api(`/workflows/${test.id}/activate`, { method: "POST" });
  try {
    await api(`/workflows/${test.id}/publish`, { method: "POST" });
  } catch {
    /* в этой версии может не быть — активации достаточно */
  }
  console.log("  активирован, ждём запуска (до 90 секунд)…");

  // Ждём исполнения: планировщик будит сценарий не мгновенно
  let crashed = "";
  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const ex = await api<{ data: Array<{ id: string; status: string }> }>(
      `/executions?workflowId=${test.id}&limit=5`,
    );
    const err = ex.data.find((e) => e.status === "error");
    if (err) {
      crashed = err.id;
      console.log(`  сценарий упал, выполнение #${err.id}`);
      break;
    }
  }

  // Снимаем с публикации и удаляем: тестовый мусор не должен остаться
  try {
    await api(`/workflows/${test.id}/deactivate`, { method: "POST" });
  } catch {
    /* уже неактивен */
  }
  try {
    await api(`/workflows/${test.id}/unpublish`, { method: "POST" });
  } catch {
    /* не опубликован */
  }
  for (let i = 0; i < 20; i++) {
    try {
      await api(`/workflows/${test.id}`, { method: "DELETE" });
      console.log("  временный сценарий удалён");
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("409")) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      console.log(`  не удалось удалить: ${msg}`);
      break;
    }
  }

  if (!crashed) {
    console.log("\n  ПРОВАЛ: сценарий не запустился за 90 секунд.");
    console.log("  Проверьте вручную в интерфейсе n8n.");
    return;
  }

  // Смотрим, что сторож отреагировал
  console.log("\n  ждём реакции сторожа…");
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const mine = await api<{ data: Array<{ id: string; name: string }> }>("/workflows");
    const guard = mine.data.find((w) => w.name === WORKFLOW_NAME);
    if (!guard) break;

    const ex = await api<{ data: Array<{ id: string; status: string; startedAt: string }> }>(
      `/executions?workflowId=${guard.id}&limit=5`,
    );
    if (ex.data.length) {
      console.log(`  сторож сработал: выполнение #${ex.data[0].id} (${ex.data[0].status})`);
      console.log("\n  Проверьте Telegram — должно прийти «Автоматизация сломалась»");
      return;
    }
  }
  console.log("  сторож не отреагировал за минуту — проверьте вручную");
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
