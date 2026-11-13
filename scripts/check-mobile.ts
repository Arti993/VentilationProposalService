/**
 * Проверка вёрстки на мобильных ширинах.
 *
 * Открывает страницы через Chrome DevTools Protocol и для каждой
 * ширины проверяет три вещи, которые ломаются первыми:
 *
 *   1. Горизонтальный скролл — главный признак неадаптированной вёрстки.
 *   2. Элементы шире экрана — даже без скролла они торчат за край.
 *   3. Обрезанный текст в шапке и кнопках.
 *
 * Плюс делает скриншоты, чтобы можно было посмотреть глазами.
 *
 * Запуск: node scripts/check-mobile.ts [--shots]
 * Требует запущенный Chrome с --remote-debugging-port=9222.
 */
const CDP_PORT = process.env.CDP_PORT ?? "9222";
const BASE = process.env.SITE_URL ?? "http://localhost:3000";

const WIDTHS = [320, 360, 390, 414, 768];

interface Target {
  path: string;
  name: string;
}

const PAGES: Target[] = [
  { path: "/", name: "лендинг" },
  { path: "/app", name: "приложение" },
];

interface Cdp {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  close: () => void;
}

async function connect(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error("WebSocket не открылся"));
  });

  let id = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  };

  return {
    send(method, params = {}) {
      id += 1;
      const myId = id;
      return new Promise((resolve, reject) => {
        pending.set(myId, { resolve, reject });
        ws.send(JSON.stringify({ id: myId, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function newTarget(): Promise<{ cdp: Cdp; id: string }> {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, {
    method: "PUT",
  });
  const target = (await res.json()) as { id: string; webSocketDebuggerUrl: string };
  const cdp = await connect(target.webSocketDebuggerUrl);
  return { cdp, id: target.id };
}

/** Проверки, выполняемые в контексте страницы */
const PROBE = `
(() => {
  const docW = document.documentElement.scrollWidth;
  const winW = window.innerWidth;

  // Элементы, вылезающие за правый край
  const overflow = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.position === "fixed") continue;
    if (r.right > winW + 1 || r.left < -1) {
      // Исключаем то, что само скроллится внутри
      const parent = el.parentElement;
      let scrollable = false;
      let p = parent;
      while (p) {
        const ps = getComputedStyle(p);
        if (ps.overflowX === "auto" || ps.overflowX === "scroll" || ps.overflow === "hidden") {
          scrollable = true;
          break;
        }
        p = p.parentElement;
      }
      if (scrollable) continue;
      overflow.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && String(el.className).slice(0, 90)) || "",
        text: (el.textContent || "").trim().slice(0, 45),
        left: Math.round(r.left),
        right: Math.round(r.right),
        w: Math.round(r.width),
      });
    }
  }

  // Текст, обрезанный с ellipsis там, где это не задумано
  const clipped = [];
  for (const el of document.querySelectorAll("h1, h2, button, a")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    const t = (el.textContent || "").trim();
    if (!t) continue;
    if (el.tagName === "A" && r.width < 40) continue;
    const cs = getComputedStyle(el);
    const isTruncate = cs.textOverflow === "ellipsis" && cs.overflow === "hidden";
    if (isTruncate && el.scrollWidth > el.clientWidth + 2) {
      clipped.push({ tag: el.tagName.toLowerCase(), text: t.slice(0, 45) });
    }
  }

  return {
    docW,
    winW,
    hasHScroll: docW > winW + 1,
    overflow: overflow.slice(0, 12),
    overflowCount: overflow.length,
    clipped,
    hasStack: !!document.querySelector("#stack"),
    hasBadge215: document.body.innerText.includes("215 позиций"),
    // Старое название бренда ищем в шапке и подвале, а не по всему
    // тексту: «Воздуховод» — это ещё и название позиции прайса
    // («Воздуховод круглый 315»), путать их нельзя
    hasOldTitle: (() => {
      const zones = [
        document.querySelector("header"),
        document.querySelector("footer"),
      ].filter(Boolean);
      return zones.some((z) => (z.textContent || "").includes("Воздуховод"));
    })(),
    title: document.title,
  };
})()
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const shots = process.argv.includes("--shots");
  let failures = 0;
  let checks = 0;

  for (const page of PAGES) {
    console.log(`\n═══ ${page.name} (${page.path}) ═══`);

    for (const width of WIDTHS) {
      const { cdp, id } = await newTarget();

      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 844,
        deviceScaleFactor: 2,
        mobile: width < 768,
      });

      await cdp.send("Page.navigate", { url: BASE + page.path });
      await sleep(2200);

      const { result } = await cdp.send("Runtime.evaluate", {
        expression: PROBE,
        returnByValue: true,
        awaitPromise: false,
      });

      const r = result.value as {
        docW: number;
        winW: number;
        hasHScroll: boolean;
        overflow: Array<{ tag: string; cls: string; text: string; right: number }>;
        overflowCount: number;
        clipped: Array<{ tag: string; text: string }>;
        hasStack: boolean;
        hasBadge215: boolean;
        hasOldTitle: boolean;
      };

      const problems: string[] = [];

      checks += 1;
      if (r.hasHScroll) {
        problems.push(`горизонтальный скролл: контент ${r.docW}px при экране ${r.winW}px`);
      }

      checks += 1;
      if (r.overflowCount > 0) {
        problems.push(
          `вылезает за экран (${r.overflowCount}): ` +
            r.overflow
              .slice(0, 4)
              .map((o) => `${o.tag}.${o.cls.split(" ")[0]} «${o.text}»`)
              .join("; "),
        );
      }

      checks += 1;
      if (r.clipped.length > 0) {
        problems.push(
          `обрезанный текст: ${r.clipped.map((c) => `«${c.text}»`).join(", ")}`,
        );
      }

      // Содержательные проверки — только на лендинге
      if (page.path === "/") {
        checks += 1;
        if (r.hasStack) problems.push("секция «Стек» всё ещё на странице");

        checks += 1;
        if (r.hasBadge215) problems.push("плашка «215 позиций» всё ещё видна");

        checks += 1;
        if (r.hasOldTitle) problems.push("старое название «Воздуховод» ещё встречается");
      }

      if (problems.length === 0) {
        console.log(`  ✓ ${width}px`);
      } else {
        failures += problems.length;
        console.log(`  ✗ ${width}px`);
        for (const p of problems) console.log(`      ${p}`);
      }

      if (shots) {
        const shot = await cdp.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
        });
        const fs = await import("node:fs");
        fs.mkdirSync(".shots", { recursive: true });
        const file = `.shots/${page.name}-${width}.png`;
        fs.writeFileSync(file, Buffer.from(shot.data as string, "base64"));
        console.log(`      снимок: ${file}`);
      }

      cdp.close();
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${id}`).catch(() => {});
    }
  }

  console.log(`\n═══ Итог: ${checks - failures} из ${checks} проверок пройдено ═══`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Ошибка:", e instanceof Error ? e.message : e);
  process.exit(1);
});
