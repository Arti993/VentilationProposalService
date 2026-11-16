/**
 * Создание PR через GitHub API.
 *
 * Запуск: node --env-file=.env.local scripts/gitflow/pr.ts "заголовок" "описание"
 *
 * Ветки определяются сами: head — текущая ветка, base — dev.
 * Переопределяются переменными HEAD_BRANCH и BASE_BRANCH.
 *
 * Токен читается из GH_TOKEN, а не из аргументов: аргументы видны в
 * истории команд, переменная окружения — нет.
 */
import { execFileSync } from "node:child_process";

const REPO = "Arti993/VentilationProposalService";

interface PrResult {
  number: number;
  html_url: string;
}

/** Текущая git-ветка. Пустая строка, если git недоступен. */
function currentBranch(): string {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN не задан");

  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const msg = body?.message ?? res.statusText;
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return body;
}

async function main() {
  const args = process.argv.slice(2);

  // Ветка по умолчанию — та, в которой сейчас стоим. Раньше здесь было
  // жёстко зашито имя ветки, и второй PR уходил не туда.
  const head = process.env.HEAD_BRANCH ?? currentBranch();
  const base = process.env.BASE_BRANCH ?? "dev";
  const title = args[0];
  const body = args[1] ?? "";

  if (!title) {
    console.error('Укажите заголовок: node scripts/gitflow/pr.ts "заголовок" "описание"');
    process.exit(1);
  }

  if (!head) {
    console.error("Не удалось определить текущую ветку. Задайте HEAD_BRANCH.");
    process.exit(1);
  }

  if (head === base || head === "main" || head === "master") {
    console.error(`Из ветки «${head}» PR не создаётся: это базовая ветка.`);
    process.exit(1);
  }

  console.log(`Ветки: ${head} → ${base}`);

  // Не создаём дубль, если PR уже есть
  const existing = await api(
    `/repos/${REPO}/pulls?head=Arti993:${encodeURIComponent(head)}&state=open`,
  );
  if (Array.isArray(existing) && existing.length > 0) {
    console.log(`PR уже существует: #${existing[0].number} ${existing[0].html_url}`);
    return;
  }

  const pr = (await api(`/repos/${REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, body, head, base }),
  })) as PrResult;

  console.log(`Создан PR #${pr.number}: ${pr.html_url}`);
}

main().catch((e) => {
  console.error("Ошибка:", e instanceof Error ? e.message : e);
  process.exit(1);
});
