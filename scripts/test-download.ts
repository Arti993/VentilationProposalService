/**
 * Проверка кнопки «Скачать КП» в браузере.
 *
 * Нажимаем кнопку и перехватываем скачивание — важно убедиться, что
 * файл действительно уходит пользователю, а не просто кнопка нарисована.
 *
 * Запуск: node scripts/test-download.ts
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const CHROME = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
const APP_URL = "http://localhost:3100";
const CDP_PORT = 9336;
const DOWNLOAD_DIR = `${process.cwd()}\\.downloads`;

class Cdp {
  #ws: WebSocket;
  #id = 0;
  constructor(ws: WebSocket) {
    this.#ws = ws;
  }
  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((res) => ws.addEventListener("open", () => res(), { once: true }));
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

async function main() {
  fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${process.env.TEMP}\\chrome-dl`,
      "--window-size=1440,1200",
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
    await cdp.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: DOWNLOAD_DIR,
      eventsEnabled: true,
    });

    await cdp.send("Page.navigate", { url: APP_URL });
    await sleep(4000);

    // Загружаем демо-смету
    await cdp.evaluate(`
      (() => {
        const b = Array.from(document.querySelectorAll('button'))
          .find(x => x.textContent && x.textContent.includes('Офисная смета'));
        b && b.click();
      })()
    `);

    // Ждём таблицу
    let rows = 0;
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      rows = await cdp.evaluate<number>(`document.querySelectorAll('tbody tr').length`);
      if (rows > 0) break;
    }
    console.log(`Таблица: ${rows} строк`);

    // Проверяем наличие кнопки
    const hasButton = await cdp.evaluate<boolean>(`
      Array.from(document.querySelectorAll('button'))
        .some(b => b.textContent && b.textContent.includes('Скачать КП'))
    `);
    console.log(`Кнопка «Скачать КП» на странице: ${hasButton ? "ДА" : "НЕТ"}`);

    if (!hasButton) {
      console.error("ПРОВАЛ: кнопки нет");
      process.exit(1);
    }

    // Проверяем, что кнопка активна
    const enabled = await cdp.evaluate<boolean>(`
      (() => {
        const b = Array.from(document.querySelectorAll('button'))
          .find(x => x.textContent && x.textContent.includes('Скачать КП'));
        return b ? !b.disabled : false;
      })()
    `);
    console.log(`Кнопка активна: ${enabled ? "ДА" : "НЕТ"}`);

    // Нажимаем
    await cdp.evaluate(`
      (() => {
        const b = Array.from(document.querySelectorAll('button'))
          .find(x => x.textContent && x.textContent.includes('Скачать КП'));
        b && b.click();
      })()
    `);
    console.log("Кнопка нажата, ждём скачивание…");

    // Ждём файл
    let file: string | null = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const files = fs.readdirSync(DOWNLOAD_DIR).filter((f) => f.endsWith(".docx"));
      if (files.length) {
        file = files[0]!;
        break;
      }
    }

    if (!file) {
      const listing = fs.readdirSync(DOWNLOAD_DIR);
      console.error("ПРОВАЛ: файл не скачался. В папке:", listing.join(", ") || "пусто");
      // Проверим, нет ли ошибки в интерфейсе
      const err = await cdp.evaluate<string>(`
        (() => {
          const el = document.querySelector('[role=alert]');
          return el ? el.textContent : 'нет сообщения об ошибке';
        })()
      `);
      console.error("Сообщение в UI:", err);
      process.exit(1);
    }

    const full = `${DOWNLOAD_DIR}\\${file}`;
    const size = fs.statSync(full).size;
    const head = fs.readFileSync(full).subarray(0, 2);
    const isZip = head[0] === 0x50 && head[1] === 0x4b;

    console.log(`\nФайл: ${file}`);
    console.log(`Размер: ${Math.round(size / 1024)} КБ`);
    console.log(`Валидный DOCX (ZIP): ${isZip ? "ДА" : "НЕТ"}`);

    if (!isZip || size < 5000) {
      console.error("ПРОВАЛ: файл повреждён или подозрительно мал");
      process.exit(1);
    }

    console.log("\nOK: скачивание работает, файл валиден");
  } finally {
    proc.kill();
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
