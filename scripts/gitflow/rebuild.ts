/**
 * Собирает ветки для gitflow — БЕЗ мержей.
 *
 * Запуск: node scripts/gitflow/rebuild.ts
 *
 * ГЛАВНОЕ ОТЛИЧИЕ ОТ ПРЕДЫДУЩИХ ВЕРСИЙ
 *
 * Здесь создаются только:
 *   - корневой коммит;
 *   - ветка dev от корня;
 *   - 13 feature-веток от dev, каждая со своими коммитами.
 *
 * Мержей НЕТ. Их сделает GitHub, когда я создам PR и нажму Merge.
 *
 * Почему так: PR невозможно создать, если ветка уже влита в base —
 * GitHub отвечает «No commits between». Две предыдущие версии сборки
 * мержили сразу, поэтому PR не создавались. Дев-ветка должна отставать
 * от feature-веток ровно настолько, чтобы было что вливать.
 *
 * ПОРЯДОК ДЕЙСТВИЙ
 *
 *   1. rebuild.ts  — создать ветки
 *   2. push        — отправить на GitHub
 *   3. publish.ts  — создать PR и смержить их через API
 *   4. после мержей запушить обновлённый dev и main
 *
 * Где взять main и теги после мержей — отдельный вопрос; для релизов
 * сделаем PR dev → main и теги на получившиеся коммиты.
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

  // dev на старте = корень. Ветки отводятся от него, dev НЕ двигается:
  // двигать его будут мержи через PR.
  const devStart = root;

  git(["update-ref", "refs/heads/dev", devStart]);
  git(["update-ref", "refs/heads/main", devStart]);

  console.log(`\n  корень ${root.slice(0, 7)} = dev и main на старте\n`);

  // Каждая ветка: от devStart, только свои коммиты.
  //
  // Последовательно, а не от «актуального» dev: dev здесь не меняется,
  // он ждёт мержей через PR. Поэтому все ветки равноудалены от dev и
  // любая может быть влита первой.
  for (const b of PLAN) {
    const branchName = `feature/${b.slug}`;
    let tip = devStart;

    for (const pc of b.commits) {
      const src = byPrefix.get(pc.prefix)!;
      tip = newCommit(treeOf(src.hash), [tip], messageOf(src), src.authorDate);
    }

    git(["update-ref", `refs/heads/${branchName}`, tip]);

    const n = b.commits.length;
    console.log(`  ${branchName.padEnd(34)} ${tip.slice(0, 7)}  ${n} коммит(а/ов)`);
  }

  git(["symbolic-ref", "HEAD", "refs/heads/dev"]);
  git(["reset", "--hard", devStart]);

  console.log(`\n  dev  ${devStart.slice(0, 7)}  (ждёт мержей через PR)`);
  console.log(`  main ${devStart.slice(0, 7)}`);
  console.log(`\nДальше: push → publish.ts (создаст и смержит PR)`);
}

main();
