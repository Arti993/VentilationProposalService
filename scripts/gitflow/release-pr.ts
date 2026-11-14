/**
 * Создаёт релизный PR dev → main.
 *
 * Запуск: node scripts/gitflow/release-pr.ts "Release: v1.0.0 — название"
 *
 * ЗАЧЕМ
 *
 * В gitflow в main попадает только dev, и только через PR. Прямой пуш
 * в main — это то, чего не бывает в командной работе.
 *
 * После мержа ставим тег на получившийся коммит main.
 */
const API = "https://api.github.com";
const OWNER = "Arti993";
const REPO = "VentilationProposalService";

const title = process.argv[2];

if (!title) {
  console.error('укажите заголовок: node scripts/gitflow/release-pr.ts "Release: v1.0.0"');
  process.exit(1);
}

async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function main() {
  const pr = await gh<{ number: number; html_url: string }>("/pulls", {
    method: "POST",
    body: JSON.stringify({
      title,
      head: "dev",
      base: "main",
      body: [
        "Релиз: `dev` → `main`.",
        "",
        "Включает всё, что накопилось в `dev` с прошлого релиза.",
        "",
        "После мержа ставится тег.",
      ].join("\n"),
    }),
  });

  console.log(`PR #${pr.number}: ${pr.html_url}`);

  const merged = await gh<{ merged: boolean; sha: string }>(
    `/pulls/${pr.number}/merge`,
    { method: "PUT", body: JSON.stringify({ merge_method: "merge" }) },
  );

  if (!merged.merged) {
    console.log("не смержен");
    process.exit(1);
  }

  console.log(`  смержен: ${merged.sha.slice(0, 7)}`);
  console.log(`\nТеперь поставьте тег:`);
  console.log(`  git fetch origin && git tag -a vX.Y.Z ${merged.sha.slice(0, 7)} -m "..." && git push origin vX.Y.Z`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
