/**
 * Проверка горизонтального переполнения на разных ширинах.
 *
 * Запуск: node scripts/check-overflow.ts
 *
 * Зачем: горизонтальный скролл на телефоне — самая частая и самая
 * заметная поломка вёрстки. На глаз со скриншота её не видно: страница
 * выглядит нормально, пока не тронешь пальцем. Здесь измеряем точно.
 *
 * Требует запущенный Chrome в режиме отладки на порту 9222.
 */
import { writeFileSync } from "node:fs";

const BASE = process.env.UI_BASE ?? "http://localhost:3000";
const CDP = "http://127.0.0.1:9222";

const WIDTHS = [360, 390, 768, 1024, 1280, 1440, 1920];
const PAGES = ["/", "/app"];

interface Target {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

async function main() {
  const list = (await (await fetch(`${CDP}/json/list`)).json()) as Target[];
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) throw new Error("нет доступной вкладки Chrome");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });

  let id = 0;
  const pending = new Map<number, (v: unknown) => void>();

  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as { id?: number; result?: unknown };
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result);
      pending.delete(msg.id);
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

  let failures = 0;
  const report: string[] = [];

  for (const path of PAGES) {
    for (const width of WIDTHS) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width < 768,
      });

      await send("Page.navigate", { url: `${BASE}${path}` });
      // Ждём загрузку и анимации появления
      await new Promise((r) => setTimeout(r, 1800));

      const data = (await evaluate(`
        (() => {
          const de = document.documentElement;
          const over = de.scrollWidth - de.clientWidth;
          // Ищем конкретных виновников: элементы шире окна
          const wide = [];
          document.querySelectorAll('*').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width > de.clientWidth + 2 && r.height > 0) {
              const st = getComputedStyle(el);
              if (st.position !== 'fixed' && st.overflowX !== 'auto' && st.overflowX !== 'scroll') {
                wide.push(el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 40));
              }
            }
          });
          return { over, wide: wide.slice(0, 3), h: de.scrollHeight };
        })()
      `)) as { over: number; wide: string[]; h: number };

      const bad = data.over > 1;
      if (bad) failures++;
      report.push(
        `${bad ? "ПРОВАЛ" : "  ок  "} ${path.padEnd(5)} ${String(width).padStart(5)}px  ` +
          `переполнение ${data.over}px, высота ${data.h}px` +
          (data.wide.length ? `\n         виновники: ${data.wide.join(" | ")}` : ""),
      );
    }
  }

  console.log("Ширина : результат\n");
  console.log(report.join("\n"));
  console.log(`\nПровалов: ${failures}`);

  writeFileSync(".shots/overflow.txt", report.join("\n"), "utf8");
  ws.close();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
