/**
 * Пересобирает историю по gitflow, сохраняя исходные даты коммитов.
 *
 * Запуск: node scripts/gitflow/build.ts
 *
 * ЧТО ДЕЛАЕМ
 *
 * Было: 26 коммитов подряд в main.
 *
 * Стало:
 *
 *   main ───●──────────●───────────●──────►  только релизы (теги)
 *            ╲        ╱ ╲         ╱
 *   dev ──────●──●───●────●───●──●────────►  интеграция
 *              ╲╱          ╲╱
 *   feature/* ─●────────────●─────────────►  работа
 *
 * КАК СОХРАНЯЮТСЯ ДАТЫ
 *
 * У каждого коммита есть две даты: авторства (когда написано) и
 * коммита (когда легло в историю). Git позволяет задать обе через
 * переменные окружения. Ставим обе одинаковыми — исходную дату.
 *
 * Даты мержей и релизов не «настоящие» в смысле git, а проставлены
 * автором коммита. Для учебного проекта это честно: содержимое и
 * даты работы не меняются, меняется только форма истории. Но знать
 * это надо — подделывать даты легко, и именно поэтому по датам в git
 * нельзя судить о том, кто что сделал.
 *
 * ПОЧЕМУ ORPHAN, А НЕ ПЕРЕПИСЫВАНИЕ ПО ОДНОМУ
 *
 * Можно было бы пройтись filter-branch и разложить существующие
 * коммиты по веткам. Но структура получилась бы неполной: не было бы
 * коммитов мержа с осмысленными сообщениями, не было бы релизов.
 *
 * Чистая сборка даёт ровно ту историю, которую хочется получить.
 * Содержимое не меняется: каждый коммит — это то же дерево файлов,
 * что и в исходной истории.
 */
import { execFileSync } from "node:child_process";
import { PLAN } from "./plan.ts";

const GITFLOW_EMAIL = "artem.ulm@gmail.com";
const GITFLOW_NAME = "Artem Simonov";

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

/** Полные сообщения: нужны целиком, чтобы перенести их один в один. */
function readHistory(): RealCommit[] {
  const raw = execFileSync(
    "git",
    ["log", "--reverse", "--format=%H%x1f%aI%x1f%B%x1e"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  return raw
    .split("\x1e")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash, authorDate, ...rest] = chunk.split("\x1f");
      const message = rest.join("\x1f").trim();
      const [subject, ...bodyParts] = message.split("\n\n");
      return {
        hash,
        authorDate,
        subject: subject.split("\n")[0],
        body: bodyParts.join("\n\n"),
      };
    });
}

/**
 * Собирает историю в отдельные ветки.
 *
 * Стратегия: не переписываем существующее дерево, а собираем заново
 * на тех же деревьях файлов.
 *
 * Для каждого коммита получаем его ДЕРЕВО (`git rev-parse <hash>^{tree}`)
 * и создаём новый коммит с этим деревом, исходным сообщением и исходной
 * датой, но с нужным родителем. Содержимое файлов не трогается вообще —
 * меняется только форма истории.
 *
 * Почему не `git cherry-pick`: он применяет ДИФФ, а диффы могут не
 * примениться к другому родителю. Здесь же родитель меняется, а дерево
 * берётся готовое — применить нечего, конфликтов быть не может.
 */

interface NewCommits {
  [slug: string]: { branch: string; tip: string };
}

function commitOnTree(
  tree: string,
  parent: string | null,
  message: string,
  date: string,
  secondParent?: string,
): string {
  const args = ["commit-tree", tree, "-m", message];
  if (parent) args.push("-p", parent);
  // У мерж-коммита два родителя. Порядок важен: первый — тот, в кого
  // вливаем (main), второй — тот, кого вливаем (dev).
  if (secondParent) args.push("-p", secondParent);

  // Обе даты одинаковые: «когда написано» и «когда в истории».
  // Иначе авторская дата сохранится, а дата коммита станет сегодняшней —
  // и в `git log` коммит встанет не туда.
  return git(args, {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
    GIT_AUTHOR_NAME: GITFLOW_NAME,
    GIT_AUTHOR_EMAIL: GITFLOW_EMAIL,
    GIT_COMMITTER_NAME: GITFLOW_NAME,
    GIT_COMMITTER_EMAIL: GITFLOW_EMAIL,
  });
}

function treeOf(hash: string): string {
  return git(["rev-parse", `${hash}^{tree}`]);
}

/** Переносит сообщение целиком: заголовок + тело, если оно было. */
function messageOf(c: RealCommit): string {
  return c.body ? `${c.subject}\n\n${c.body}` : c.subject;
}

function build(real: RealCommit[]) {
  const byPrefix = new Map<string, RealCommit>();
  for (const branch of PLAN) {
    for (const pc of branch.commits) {
      const found = real.find((r) => r.subject.startsWith(pc.prefix));
      if (!found) throw new Error(`не найден коммит «${pc.prefix}»`);
      byPrefix.set(pc.prefix, found);
    }
  }

  // Корень: пустой коммит — от него пойдут и dev, и main.
  // Нужен, чтобы main и dev имели общую точку, иначе git не сможет
  // построить связную историю.
  const firstDate = real[0].authorDate;
  const emptyTree = git(["hash-object", "-t", "tree", "-w", "/dev/null"], {}).trim();
  const root = commitOnTree(emptyTree, null, "chore: начальный коммит", firstDate);

  let devTip = root;
  let mainTip = root;
  const refs: string[] = [];
  const tags: Array<{ name: string; sha: string; message: string }> = [];

  console.log(`\n  корень: ${root.slice(0, 7)}`);

  for (const branch of PLAN) {
    const branchName = `feature/${branch.slug}`;

    // ── коммиты ветки ──
    //
    // Ветка начинается не от tip ветки, а от dev: в gitflow feature
    // отводится от dev и уходит в свою сторону. Иначе получилась бы
    // не ветка, а продолжение прямой линии — и на графе не видно,
    // что работа шла параллельно.
    let tip: string = devTip;
    for (const pc of branch.commits) {
      const src = byPrefix.get(pc.prefix)!;
      tip = commitOnTree(treeOf(src.hash), tip, messageOf(src), src.authorDate);
    }

    git(["update-ref", `refs/heads/${branchName}`, tip]);
    refs.push(branchName);

    // ── мерж в dev ──
    //
    // Два родителя: 1) dev, каким он был, 2) ветка.
    // Без второго родителя это не мерж, а обычный коммит: ветка
    // останется «не влитой» (git merge-base --is-ancestor вернёт ложь),
    // и на графе не будет вилки.
    //
    // Дерево берём от ветки: после мержа dev равен ветке по содержимому.
    const previousDev = devTip;
    devTip = commitOnTree(
      treeOf(tip),
      previousDev, // первый родитель — dev, куда вливаем
      `Merge branch '${branchName}' into dev\n\n${branch.title}`,
      branch.mergeAt,
      tip, // второй родитель — сама ветка
    );
    git(["update-ref", "refs/heads/dev", devTip]);

    // ── релиз в main ──
    //
    // Родители: 1) текущий main, 2) dev.
    // В первой версии был только первый, и получилось 10 независимых
    // линий от пустого корня: main не содержал ни одного файла, а
    // feature-ветки висели отдельно.
    if (branch.release) {
      mainTip = commitOnTree(
        treeOf(devTip),
        mainTip, // первый родитель — предыдущий релиз
        `Merge branch 'dev' into main: ${branch.release.title}`,
        branch.mergeAt,
        devTip, // второй родитель — dev с этой работой
      );
      git(["update-ref", "refs/heads/main", mainTip]);

      if (branch.release.tag) {
        tags.push({
          name: branch.release.tag,
          sha: mainTip,
          message: branch.release.title,
        });
      }
    }

    const mark = branch.release?.tag ? `  → main ${branch.release.tag}` : "";
    console.log(`  ${branchName.padEnd(34)} ${tip.slice(0, 7)}${mark}`);
  }

  return { devTip, mainTip, refs, tags };
}

function main() {
  const real = readHistory();
  console.log(`Исходных коммитов: ${real.length}`);

  const { devTip, mainTip, refs, tags } = build(real);

  // Аннотированные теги: у них есть автор и сообщение, в отличие от
  // лёгких. Для релизов правильнее аннотированный.
  for (const t of tags) {
    git(["tag", "-a", t.name, "-m", t.message, t.sha], {
      GIT_COMMITTER_DATE: t.sha ? git(["log", "-1", "--format=%aI", t.sha]) : "",
      GIT_AUTHOR_NAME: GITFLOW_NAME,
      GIT_AUTHOR_EMAIL: GITFLOW_EMAIL,
      GIT_COMMITTER_NAME: GITFLOW_NAME,
      GIT_COMMITTER_EMAIL: GITFLOW_EMAIL,
    });
    console.log(`  тег ${t.name}`);
  }

  // Рабочую ветку ставим на dev: там идёт работа, main — только релизы
  git(["symbolic-ref", "HEAD", "refs/heads/dev"]);
  git(["reset", "--hard", devTip]);

  console.log(`\nВетки: ${refs.join(", ")}, dev, main`);
  console.log(`dev:  ${devTip.slice(0, 7)}`);
  console.log(`main: ${mainTip.slice(0, 7)}`);
  console.log(`тегов: ${tags.length}`);
}

main();
