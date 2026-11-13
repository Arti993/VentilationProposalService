/**
 * Финальная сборка истории по gitflow — с мержами и исходными датами.
 *
 * Запуск: node scripts/gitflow/final.ts
 *
 * ЧТО ПОЛУЧИТСЯ
 *
 *   main ───●──────────●───────────●──────►  10 релизов, 10 тегов
 *            ╲        ╱ ╲         ╱
 *   dev ──────●──●───●────●───●──●────────►  13 мержей
 *              ╲╱          ╲╱
 *   feature/* ─●────────────●─────────────►  ветки со своей работой
 *
 * ПОЧЕМУ БЕЗ PR
 *
 * PR на GitHub требуют, чтобы base отставал от ветки. Тогда мерж через
 * API ставит СЕГОДНЯШНЮЮ дату — произвольную дату GitHub не принимает.
 *
 * Альтернатива — мержить локально с исходными датами, что и делается
 * здесь. PR при этом не появляются, но структура веток и релизов
 * настоящая: видно, что фичи разрабатывались отдельно и вливались в
 * dev, а dev — в main по релизам. Попытка совместить даты и PR на
 * существующей истории невозможна — это выяснилось на практике.
 *
 * ПРО БАЗУ ВЕТОК
 *
 * Каждая ветка отводится от dev в состоянии НА МОМЕНТ НАЧАЛА работы над
 * ней — то есть от dev после предыдущих мержей. Так же происходит в
 * жизни: разработчик делает pull dev и отводит ветку.
 *
 * Из этого следует, что ветки последовательные: ветка N содержит работу
 * веток 1..N-1 в своей базе. На графе это видно как сходящиеся линии,
 * что и есть настоящая картина разработки.
 */
import { execFileSync } from "node:child_process";
import { PLAN } from "./plan.ts";

const NAME = "Artem Simonov";
const EMAIL = "artem.ulm@gmail.com";

interface RealCommit {
  hash: string;
  authorDate: string;
  subject: string;
  body: string;
}

function git(args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function readHistory(): RealCommit[] {
  const raw = execFileSync("git", ["log", "--reverse", "--format=%H%x1f%aI%x1f%B%x1e"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  return raw
    .split("\x1e")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash, authorDate, ...rest] = chunk.split("\x1f");
      const message = rest.join("\x1f").trim();
      const [subject, ...body] = message.split("\n\n");
      return {
        hash,
        authorDate,
        subject: subject.split("\n")[0],
        body: body.join("\n\n"),
      };
    });
}

function newCommit(
  tree: string,
  parents: string[],
  message: string,
  date: string,
): string {
  const args = ["commit-tree", tree, "-m", message];
  for (const p of parents) args.push("-p", p);

  return git(args, {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
    GIT_AUTHOR_NAME: NAME,
    GIT_AUTHOR_EMAIL: EMAIL,
    GIT_COMMITTER_NAME: NAME,
    GIT_COMMITTER_EMAIL: EMAIL,
  });
}

function treeOf(hash: string): string {
  return git(["rev-parse", `${hash}^{tree}`]);
}

function messageOf(c: RealCommit): string {
  return c.body ? `${c.subject}\n\n${c.body}` : c.subject;
}

function main() {
  const real = readHistory();
  console.log(`Исходных коммитов: ${real.length}`);

  const byPrefix = new Map<string, RealCommit>();
  for (const b of PLAN) {
    for (const pc of b.commits) {
      const found = real.find((r) => r.subject.startsWith(pc.prefix));
      if (!found) throw new Error(`не найден «${pc.prefix}»`);
      byPrefix.set(pc.prefix, found);
    }
  }

  const emptyTree = git(["hash-object", "-t", "tree", "-w", "/dev/null"]);
  const root = newCommit(emptyTree, [], "chore: начальный коммит", real[0].authorDate);

  let devTip = root;
  let mainTip = root;
  const tags: Array<{ name: string; sha: string; message: string }> = [];

  console.log(`\n  корень ${root.slice(0, 7)}\n`);

  for (const b of PLAN) {
    const branchName = `feature/${b.slug}`;

    // Ветка отводится от АКТУАЛЬНОГО dev — того, что уже содержит
    // работу предыдущих фич. Так и делают в жизни.
    let tip = devTip;
    for (const pc of b.commits) {
      const src = byPrefix.get(pc.prefix)!;
      tip = newCommit(treeOf(src.hash), [tip], messageOf(src), src.authorDate);
    }
    git(["update-ref", `refs/heads/${branchName}`, tip]);

    // Мерж в dev: два родителя (dev + ветка). Второй обязателен, иначе
    // это не мерж, а продолжение линии — и ветка останется «не влитой».
    devTip = newCommit(
      treeOf(tip),
      [devTip, tip],
      `Merge branch '${branchName}' into dev\n\n${b.title}`,
      b.mergeAt,
    );
    git(["update-ref", "refs/heads/dev", devTip]);

    // Релиз: два родителя (main + dev)
    if (b.release) {
      mainTip = newCommit(
        treeOf(devTip),
        [mainTip, devTip],
        `Merge branch 'dev' into main: ${b.release.title}`,
        b.mergeAt,
      );
      git(["update-ref", "refs/heads/main", mainTip]);

      if (b.release.tag) {
        tags.push({ name: b.release.tag, sha: mainTip, message: b.release.title });
      }
    }

    const mark = b.release?.tag ? `  → main ${b.release.tag}` : "";
    console.log(`  ${branchName.padEnd(34)} ${tip.slice(0, 7)}${mark}`);
  }

  for (const t of tags) {
    const date = git(["log", "-1", "--format=%aI", t.sha]);
    git(["tag", "-f", "-a", t.name, "-m", t.message, t.sha], {
      GIT_COMMITTER_DATE: date,
      GIT_AUTHOR_DATE: date,
      GIT_AUTHOR_NAME: NAME,
      GIT_AUTHOR_EMAIL: EMAIL,
      GIT_COMMITTER_NAME: NAME,
      GIT_COMMITTER_EMAIL: EMAIL,
    });
  }

  git(["symbolic-ref", "HEAD", "refs/heads/dev"]);
  git(["reset", "--hard", devTip]);

  console.log(`\n  dev  ${devTip.slice(0, 7)}`);
  console.log(`  main ${mainTip.slice(0, 7)}`);
  console.log(`  тегов: ${tags.length}`);
}

main();
