/**
 * Сверяет план с реальной историей: ничего не потеряли, ничего не задвоили.
 *
 * Запуск: node scripts/gitflow/verify.ts
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ШАГ
 *
 * Переписывание истории необратимо. Ошибка в плане — пропущенный коммит
 * или коммит, попавший в две ветки — обнаружится только после force push,
 * когда откатиться будет некуда.
 *
 * Поэтому сначала сверка: каждый коммит из \`git log\` должен попасть
 * ровно в одну ветку плана, и наоборот.
 */
import { execFileSync } from "node:child_process";
import { PLAN } from "./plan.ts";

interface RealCommit {
  hash: string;
  date: string;
  subject: string;
}

function readHistory(): RealCommit[] {
  // -z разделяет записи NUL-ом: сообщения коммитов могут содержать
  // переводы строк, и разбор по \n их бы разорвал. Здесь сообщения
  // однострочные, но привычка правильная.
  const out = execFileSync(
    "git",
    ["log", "--reverse", "--format=%H%x1f%ad%x1f%s", "--date=iso"],
    { encoding: "utf8" },
  );

  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, date, subject] = line.split("\x1f");
      return { hash, date: date.slice(0, 16), subject };
    });
}

function main() {
  const real = readHistory();
  console.log(`Коммитов в истории: ${real.length}\n`);

  const claimed = new Map<string, string>(); // hash → slug ветки
  const problems: string[] = [];

  console.log("=== Распределение по веткам ===\n");

  for (const branch of PLAN) {
    console.log(`  ${branch.slug}  →  ${branch.commits.length} коммитов`);

    for (const pc of branch.commits) {
      // Ищем все коммиты с этим префиксом: если больше одного — план
      // неоднозначен и надо уточнить префикс
      const matches = real.filter((r) => r.subject.startsWith(pc.prefix));

      if (matches.length === 0) {
        problems.push(`«${pc.prefix}» — не найден ни один коммит`);
        console.log(`      НЕ НАЙДЕН: «${pc.prefix}»`);
        continue;
      }

      if (matches.length > 1) {
        problems.push(
          `«${pc.prefix}» — совпадает с ${matches.length} коммитами: ` +
            matches.map((m) => m.subject.slice(0, 40)).join(" | "),
        );
        console.log(`      НЕОДНОЗНАЧНО (${matches.length}): «${pc.prefix}»`);
        continue;
      }

      const m = matches[0];
      if (claimed.has(m.hash)) {
        problems.push(
          `«${m.subject.slice(0, 50)}» — уже в ветке ${claimed.get(m.hash)}, ` +
            `а теперь ещё и в ${branch.slug}`,
        );
        console.log(`      ЗАДВОЕН: ${m.subject.slice(0, 50)}`);
        continue;
      }

      claimed.set(m.hash, branch.slug);
    }
  }

  // Не потеряли ли что-то
  console.log("\n=== Непокрытые коммиты ===\n");
  const orphans = real.filter((r) => !claimed.has(r.hash));
  if (orphans.length === 0) {
    console.log("  все коммиты распределены");
  } else {
    for (const o of orphans) {
      console.log(`  ${o.hash.slice(0, 7)}  ${o.date}  ${o.subject}`);
      problems.push(`не распределён: ${o.subject}`);
    }
  }

  // Порядок: дата мержа ветки должна быть не раньше её последнего коммита
  console.log("\n=== Хронология ===\n");
  let prevMerge = "";
  for (const b of PLAN) {
    const dates = b.commits
      .map((pc) => real.find((r) => r.subject.startsWith(pc.prefix)))
      .filter((r): r is RealCommit => Boolean(r))
      .map((r) => r.date);

    const last = dates.sort().at(-1) ?? "";
    const merge = b.mergeAt.slice(0, 16).replace("T", " ");
    const afterLast = last && merge >= last;
    const afterPrev = !prevMerge || merge >= prevMerge;
    const ok = afterLast && afterPrev;
    if (!ok) {
      problems.push(
        `${b.slug}: мерж ${merge} раньше ` +
          (!afterPrev ? `предыдущего мержа ${prevMerge}` : `последнего коммита ${last}`),
      );
    }

    console.log(
      `  ${ok ? "ок  " : "ПРОВАЛ"} ${b.slug.padEnd(22)} ` +
        `коммиты до ${last}, мерж ${merge}` +
        (b.release ? `  → main (${b.release.tag ?? "без тега"})` : ""),
    );
    prevMerge = merge;
  }

  // Версии идут по возрастанию
  console.log("\n=== Релизы ===\n");
  const tags = PLAN.filter((b) => b.release?.tag).map((b) => b.release!.tag!);
  console.log(`  ${tags.join(" → ")}`);
  const sorted = [...tags].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  if (tags.join() !== sorted.join()) {
    problems.push("версии идут не по возрастанию");
  }

  // ── Итог ──
  console.log("\n=== Итог ===\n");
  console.log(`  веток: ${PLAN.length}`);
  console.log(`  PR в dev: ${PLAN.length}`);
  console.log(`  релизов в main: ${PLAN.filter((b) => b.release).length}`);
  console.log(`  покрыто коммитов: ${claimed.size} из ${real.length}`);

  if (problems.length) {
    console.log(`\n  ПРОБЛЕМ: ${problems.length}`);
    for (const p of problems) console.log(`    • ${p}`);
    process.exit(1);
  }

  console.log("\n  План корректен: все коммиты распределены ровно по одному разу,");
  console.log("  хронология не нарушена, версии по возрастанию.");
}

main();
