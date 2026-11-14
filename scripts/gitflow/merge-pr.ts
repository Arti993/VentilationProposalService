/**
 * Мержит PR, созданный на feature-ветку.
 *
 * Запуск: node scripts/gitflow/merge-pr.ts <номер> [--squash]
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ
 *
 * Через `node -e` в PowerShell не получается: оболочка съедает кавычки
 * внутри JSON, и скрипт падает с SyntaxError. Файл читается как есть.
 */
const API = "https://api.github.com";
const OWNER = "Arti993";
const REPO = "VentilationProposalService";

const number = process.argv[2];
const squash = process.argv.includes("--squash");

if (!number) {
  console.error("укажите номер PR: node scripts/gitflow/merge-pr.ts 14");
  process.exit(1);
}

async function gh(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("нужен GH_TOKEN");

  const res = await fetch(`${API}/repos/${OWNER}/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "kp-service-gitflow",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function main() {
  // Проверим, что PR можно мержить: иначе GitHub ответит 405 и
  // придётся догадываться, в чём дело
  const pr = (await gh(`/pulls/${number}`)) as {
    title: string;
    state: string;
    mergeable: boolean | null;
    base: { ref: string };
    head: { ref: string };
  };

  console.log(`PR #${number}: ${pr.title}`);
  console.log(`  ${pr.head.ref} → ${pr.base.ref}`);
  console.log(`  состояние: ${pr.state}, мержится: ${pr.mergeable}`);

  if (pr.state !== "open") {
    console.log("  уже не открыт — нечего делать");
    return;
  }

  if (pr.mergeable === false) {
    console.log("  конфликты: сначала надо разрешить вручную");
    process.exit(1);
  }

  const result = (await gh(`/pulls/${number}/merge`, {
    method: "PUT",
    body: JSON.stringify({
      merge_method: squash ? "squash" : "merge",
    }),
  })) as { merged: boolean; sha: string; message: string };

  if (result.merged) {
    console.log(`  смержен: ${result.sha.slice(0, 7)}`);
    console.log(`  ${result.message}`);
  } else {
    console.log(`  не смержен: ${result.message}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
