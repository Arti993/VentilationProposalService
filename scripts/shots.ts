/**
 * Полностраничные скриншоты через протокол отладки Chrome.
 *
 * Запуск: node scripts/shots.ts
 *
 * Зачем отдельный скрипт: `chrome --screenshot` снимает только видимую
 * область окна. Для лендинга высотой 5000 px это бесполезно — нужен
 * весь page. Через CDP можно задать область кадра вручную.
 *
 * Требует Chrome на порту 9223 (отдельно от порта 9222, где идут
 * проверки вёрстки, — чтобы скрипты не мешали друг другу).
 */
import { writeFileSync, mkdirSync } from "node:fs";

const CDP = "http://127.0.0.1:9223";
const OUT = ".shots";

const SHOTS = [
  { name: "landing-full", path: "/", width: 1440 },
  { name: "landing-mobile-full", path: "/", width: 390 },
  { name: "app-full", path: "/app", width: 1440 },
];

const BASE = process.env.UI_BASE ?? "https://ventilation-proposal-service.vercel.app";

async function main() {
  mkdirSync(OUT, { recursive: true });

  const list = (await (await fetch(`${CDP}/json/list`)).json()) as Array<{
    type: string;
    webSocketDebuggerUrl?: string;
  }>;
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) throw new Error("нет вкладки Chrome");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });

  let id = 0;
  const pending = new Map<number, (v: unknown) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown };
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)!(m.result);
      pending.delete(m.id);
    }
  };
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<unknown>((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const evaluate = async (expr: string) => {
    const r = (await send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    })) as { result?: { value?: unknown } };
    return r.result?.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");

  for (const shot of SHOTS) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: shot.width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: shot.width < 768,
    });

    await send("Page.navigate", { url: `${BASE}${shot.path}` });
    await new Promise((r) => setTimeout(r, 2500));

    // Прокручиваем до конца: анимации появления зависят от viewport,
    // без прокрутки нижние блоки останутся невидимыми на снимке
    await evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
    await new Promise((r) => setTimeout(r, 1200));
    await evaluate(`window.scrollTo(0, 0)`);
    await new Promise((r) => setTimeout(r, 900));

    const height = (await evaluate(
      `Math.min(document.documentElement.scrollHeight, 12000)`,
    )) as number;

    const res = (await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: shot.width, height, scale: 1 },
    })) as { data?: string };

    if (!res.data) throw new Error(`скриншот ${shot.name} не получен`);
    writeFileSync(`${OUT}/${shot.name}.png`, Buffer.from(res.data, "base64"));
    console.log(`${shot.name}.png — ${shot.width}×${height}`);
  }

  ws.close();
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
