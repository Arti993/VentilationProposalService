/**
 * Создаёт pull request на каждую feature-ветку и мержит их через GitHub.
 *
 * Запуск: node scripts/gitflow/publish.ts --apply
 *
 * ЧТО ДЕЛАЕТ
 *
 * Для каждой ветки из плана:
 *   1. создаёт PR feature/* → dev с описанием из плана;
 *   2. мержит его через API.
 *
 * ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ ПРОСТОГО ПУША
 *
 * Ветки уже запушены и содержат только свои коммиты, но ещё не влиты
 * в dev. Это ровно то состояние, которое нужно для PR: GitHub видит
 * разницу между веткой и base и даёт кнопку Merge.
 *
 * ЧЕСТНО ПРО ДАТЫ
 *
 * Мерж через API создаёт коммит с СЕГОДНЯШНЕЙ датой — иначе нельзя,
 * GitHub не принимает произвольную дату мержа. Даты самих коммитов
 * остаются исходными, их задали при сборке.
 *
 * Значит, в истории будет: коммиты разбросаны по 9–13 ноября, как и
 * было, а мерж-коммиты помечены сегодняшним числом. Это честнее, чем
 * подделывать и даты мержей: по крайней мере видно, когда история
 * была перестроена.
 *
 * ПОЧЕМУ МЕРЖИМ СРАЗУ
 *
 * Если оставить ветки открытыми, следующая ветка будет отведена от
 * более старого dev, и её PR покажет чужие изменения как свои. Мерж
 * сразу после создания держит base актуальным.
 */
import { PLAN } from "./plan.ts";

const API = "https://api.github.com";
const OWNER = "Arti993";
const REPO = "VentilationProposalService";
const APPLY = process.argv.includes("--apply");

function token(): string {
  const t = process.env.GH_TOKEN;
  if (!t) throw new Error("нужен GH_TOKEN");
  return t;
}

async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}/repos/${OWNER}/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "kp-service-gitflow",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

interface Pull {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
}

async function main() {
  console.log(`Репозиторий: ${OWNER}/${REPO}`);

  if (!APPLY) {
    console.log(`\nБудет создано и смержено ${PLAN.length} PR feature/* → dev.`);
    console.log("Добавьте --apply.");
    return;
  }

  const ok: Pull[] = [];
  const failed: string[] = [];

  console.log("\n=== PR feature/* → dev ===\n");

  for (const b of PLAN) {
    const head = `feature/${b.slug}`;
    try {
      const pr = await gh<Pull>("/pulls", {
        method: "POST",
        body: JSON.stringify({
          title: b.title,
          body: b.body,
          head,
          base: "dev",
        }),
      });

      if (!pr.merged_at) {
        await gh(`/pulls/${pr.number}/merge`, {
          method: "PUT",
          body: JSON.stringify({
            merge_method: "merge",
            commit_title: `Merge branch '${head}' into dev`,
            commit_message: b.title,
          }),
        });
      }

      ok.push(pr);
      console.log(`  #${pr.number}  ${b.title.slice(0, 50)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("already exists")) {
        console.log(`  (был)  ${b.title.slice(0, 50)}`);
        ok.push({ number: 0, title: b.title, html_url: "", merged_at: null });
        continue;
      }
      failed.push(`${head}: ${msg.slice(0, 140)}`);
      console.log(`  ОШИБКА  ${head}`);
    }
  }

  console.log(`\nУспешно: ${ok.length} из ${PLAN.length}`);
  if (failed.length) {
    console.log(`\nОшибки:`);
    for (const f of failed) console.log(`  ${f}`);
  }
  console.log(`\nСписок: https://github.com/${OWNER}/${REPO}/pulls?q=is%3Apr`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
