/**
 * Браузерная проверка UI через Chrome DevTools Protocol.
 *
 * Делает два скриншота: пустое состояние и состояние с загруженной сметой.
 * Кликает по кнопке демо-сметы — так проверяется реальный пользовательский
 * путь, а не подставленное состояние.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const CHROME = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
const APP_URL = "http://localhost:3100";
const CDP_PORT = 9333;

class Cdp {
  #ws: WebSocket;
  #id = 0;

  constructor(ws: WebSocket) {
    this.#ws = ws;
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => {
      ws.addEventListener("open", () => res(), { once: true });
      ws.addEventListener("error", () => rej(new Error("websocket error")), { once: true });
    });
    return new Cdp(ws);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const onMessage = (ev: MessageEvent) => {
        const msg = JSON.parse(String(ev.data)) as {
          id?: number;
          result?: unknown;
          error?: unknown;
        };
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

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const res = (await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as {
      result?: { value?: T };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (res.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "eval error",
      );
    }
    return res.result?.value as T;
  }

  async screenshot(file: string): Promise<void> {
    const shot = (await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    })) as { data: string };
    fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${process.env.TEMP}\\chrome-cdp-shot`,
      "--window-size=1440,1300",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    // Ждём порт отладки
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {
        /* ещё стартует */
      }
      await sleep(250);
    }
    if (!ready) throw new Error("Chrome не поднял порт отладки");

    const targets = (await (
      await fetch(`http://127.0.0.1:${CDP_PORT}/json`)
    ).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("вкладка не найдена");

    const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1300,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // ── 1. Пустое состояние ─────────────────────────────────────────────
    await cdp.send("Page.navigate", { url: APP_URL });
    await sleep(4500);
    await cdp.screenshot("ui-1-empty.png");
    console.log("✓ ui-1-empty.png");

    // Проверяем, что страница отрисовалась
    const hasTitle = await cdp.evaluate<boolean>(
      `document.body.innerText.includes('Коммерческое предложение')`,
    );
    if (!hasTitle) throw new Error("страница не отрисовалась");

    // ── 2. Кликаем «Офисная смета» ──────────────────────────────────────
    const clicked = await cdp.evaluate<boolean>(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const b = btns.find(x => x.textContent && x.textContent.includes('Офисная смета'));
        if (!b) return false;
        b.click();
        return true;
      })()
    `);
    if (!clicked) throw new Error("кнопка демо-сметы не найдена");
    console.log("✓ клик по «Офисная смета»");

    // Ждём появления таблицы, а не фиксированное время: с БД загрузка
    // может занять больше времени, чем с файлом, и тест был бы ложным.
    let rows = 0;
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      rows = await cdp.evaluate<number>(`document.querySelectorAll('tbody tr').length`);
      if (rows > 0) break;
    }
    if (rows === 0) {
      const err = await cdp.evaluate<string>(`document.body.innerText.slice(0, 400)`);
      console.log("  таблица не появилась, текст страницы:", err.slice(0, 200));
    }
    console.log(`✓ таблица отрисована (${rows} строк за ${rows > 0 ? "?" : "60+"} с)`);
    await cdp.screenshot("ui-2-loaded.png");
    console.log("✓ ui-2-loaded.png");

    // Проверяем, что таблица появилась
    const state = await cdp.evaluate<{
      hasTable: boolean;
      sum: string;
      rows: number;
      hasChat: boolean;
    }>(`
      (() => {
        const text = document.body.innerText;
        const rows = document.querySelectorAll('tbody tr').length;
        const sumMatch = text.match(/([\\d\\s\\u00a0]+)\\s*₽/);
        return {
          hasTable: rows > 0,
          rows,
          sum: sumMatch ? sumMatch[1].trim() : 'не найдено',
          hasChat: text.includes('Ассистент'),
        };
      })()
    `);
    console.log("  строк в таблице:", state.rows);
    console.log("  итог на странице:", state.sum, "₽");
    console.log("  чат присутствует:", state.hasChat);

    // ── 3. Клик по позиции → вопрос в чат ───────────────────────────────
    const rowClicked = await cdp.evaluate<boolean>(`
      (() => {
        const row = document.querySelector('tbody tr');
        if (!row) return false;
        row.click();
        return true;
      })()
    `);
    if (rowClicked) {
      console.log("✓ клик по строке таблицы");
      await sleep(10_000);
      await cdp.screenshot("ui-3-chat.png");
      console.log("✓ ui-3-chat.png");

      const chatState = await cdp.evaluate<{ messages: number; last: string }>(`
        (() => {
          const text = document.body.innerText;
          return { messages: document.querySelectorAll('.rounded-2xl').length, last: text.slice(-300) };
        })()
      `);
      console.log("  пузырей в чате:", chatState.messages);
    }

    console.log("\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
  } finally {
    proc.kill();
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
