/**
 * Создание и мерж PR через GitHub API.
 *
 * Запуск: node scripts/gitflow/pr.ts "заголовок" "описание" [--draft]
 *
 * Токен читается из файла, не из аргументов: аргументы видны в истории
 * команд, файл — нет. Имя файла передаётся переменной окружения.
 */
const REPO = "Arti993/VentilationProposalService";

interface PrResult {
  number: number;
  html_url: string;
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
  const head = process.env.HEAD_BRANCH ?? "feature/design-polish";
  const base = process.env.BASE_BRANCH ?? "dev";
  const title = args[0];
  const body = args[1] ?? "";

  if (!title) {
    console.error('Укажите заголовок: node scripts/gitflow/pr.ts "заголовок" "описание"');
    process.exit(1);
  }

  // Не создаём дубль, если PR уже есть
  const existing = await api(
    `/repos/${REPO}/pulls?head=Arti993:${head}&state=open`,
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
