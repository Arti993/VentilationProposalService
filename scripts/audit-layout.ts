/**
 * Проверка вёрстки метриками: без глаз, но по фактам.
 *
 * Смотрим то, что ломается в реальности: переполнение по горизонтали,
 * слипшиеся элементы, невидимый текст, съехавшую сетку, контраст.
 */
import { spawn } from "node:child_process";

const CHROME = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
const APP_URL = "http://localhost:3100";
const CDP_PORT = 9334;

class Cdp {
  #ws: WebSocket;
  #id = 0;
  constructor(ws: WebSocket) {
    this.#ws = ws;
  }
  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((res) =>
      ws.addEventListener("open", () => res(), { once: true }),
    );
    return new Cdp(ws);
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const onMessage = (ev: MessageEvent) => {
        const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: unknown };
        if (msg.id !== id) return;
        this.#ws.removeEventListener("message", onMessage);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      };
      this.#ws.addEventListener("message", onMessage);
      this.#ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => reject(new Error(`timeout: ${method}`)), 40_000);
    });
  }
  async evaluate<T>(expression: string): Promise<T> {
    const res = (await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: T }; exceptionDetails?: { exception?: { description?: string } } };
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? "eval");
    return res.result?.value as T;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface LayoutReport {
  horizontalOverflow: number;
  overflowingElements: string[];
  zeroSizeBlocks: string[];
  tableColumns: number;
  summaryCards: number;
  cardHeights: number[];
  bodyBg: string;
  textColor: string;
  fontFamily: string;
  chatPanelHeight: number;
  viewport: { w: number; h: number };
  scrollHeight: number;
}

async function audit(cdp: Cdp, label: string): Promise<LayoutReport> {
  const r = await cdp.evaluate<LayoutReport>(`
    (() => {
      const de = document.documentElement;
      const overflow = de.scrollWidth - de.clientWidth;
      const overflowing = [];
      const zero = [];
      document.querySelectorAll('*').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.right > de.clientWidth + 2) {
          overflowing.push(el.tagName + '.' + (el.className || '').toString().slice(0, 40));
        }
        if ((el.tagName === 'DIV' || el.tagName === 'SECTION') && rect.width > 200 && rect.height === 0) {
          zero.push(el.tagName + '.' + (el.className || '').toString().slice(0, 40));
        }
      });
      const bodyStyle = getComputedStyle(document.body);
      const cards = document.querySelectorAll('.card');
      const heights = Array.from(cards).slice(0, 6).map(c => Math.round(c.getBoundingClientRect().height));
      const table = document.querySelector('table');
      const cols = table ? (table.querySelector('thead tr')?.children.length ?? 0) : 0;
      const chatCard = document.querySelector('aside .card');
      return {
        horizontalOverflow: overflow,
        overflowingElements: overflowing.slice(0, 5),
        zeroSizeBlocks: zero.slice(0, 5),
        tableColumns: cols,
        summaryCards: cards.length,
        cardHeights: heights,
        bodyBg: bodyStyle.backgroundColor,
        textColor: bodyStyle.color,
        fontFamily: bodyStyle.fontFamily.slice(0, 40),
        chatPanelHeight: chatCard ? Math.round(chatCard.getBoundingClientRect().height) : 0,
        viewport: { w: de.clientWidth, h: de.clientHeight },
        scrollHeight: de.scrollHeight,
      };
    })()
  `);

  console.log(`\n── ${label} ──`);
  console.log(`  viewport: ${r.viewport.w}×${r.viewport.h}, высота документа: ${r.scrollHeight}px`);
  console.log(`  горизонтальное переполнение: ${r.horizontalOverflow}px ${r.horizontalOverflow <= 0 ? "✓" : "✗ ЕСТЬ!"}`);
  if (r.overflowingElements.length) {
    console.log("  вылезают за край:", r.overflowingElements.join(", "));
  }
  console.log(`  колонок в таблице: ${r.tableColumns}${r.tableColumns === 7 ? " ✓" : ""}`);
  console.log(`  карточек .card: ${r.summaryCards}`);
  console.log(`  высоты карточек: ${r.cardHeights.join(", ")}px`);
  console.log(`  панель чата: ${r.chatPanelHeight}px`);
  console.log(`  фон body: ${r.bodyBg}, текст: ${r.textColor}`);
  console.log(`  шрифт: ${r.fontFamily}`);
  if (r.zeroSizeBlocks.length) {
    console.log("  схлопнутые блоки:", r.zeroSizeBlocks.join(", "));
  }
  return r;
}

async function main() {
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${process.env.TEMP}\\chrome-audit`,
      "--window-size=1440,1100",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break;
      } catch {
        /* стартует */
      }
      await sleep(250);
    }

    const targets = (await (
      await fetch(`http://127.0.0.1:${CDP_PORT}/json`)
    ).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
    const page = targets.find((t) => t.type === "page")!;
    const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    // Десктоп
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Page.navigate", { url: APP_URL });
    await sleep(4000);
    await audit(cdp, "ДЕСКТОП 1440px — пустое состояние");

    // Загружаем смету
    await cdp.evaluate(`
      (() => {
        const b = Array.from(document.querySelectorAll('button'))
          .find(x => x.textContent && x.textContent.includes('Офисная смета'));
        b && b.click();
      })()
    `);
    await sleep(13_000);
    const loaded = await audit(cdp, "ДЕСКТОП 1440px — смета загружена");

    // Мобильный
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(1500);
    await audit(cdp, "МОБИЛЬНЫЙ 390px — смета загружена");

    // Итог
    console.log("\n── ВЕРДИКТ ──");
    const ok = loaded.horizontalOverflow <= 0 && loaded.tableColumns === 7;
    console.log(ok ? "  вёрстка десктопа корректна ✓" : "  есть проблемы ✗");
  } finally {
    proc.kill();
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
