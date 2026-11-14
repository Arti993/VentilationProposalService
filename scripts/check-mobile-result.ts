/**
 * Проверка приложения С загруженной сметой.
 *
 * Пустой экран загрузки проверять легко и почти бесполезно: он простой.
 * Всё интересное начинается после загрузки — карточки итогов, таблица
 * на 40+ строк, чат. Именно там вылезает горизонтальный скролл, если
 * он есть.
 *
 * Загружает демо-смету, ждёт результат, гоняет проверки на нескольких
 * ширинах и делает снимки.
 *
 * Запуск: node scripts/check-mobile-result.ts [--shots]
 */
const CDP_PORT = process.env.CDP_PORT ?? "9222";
const BASE = process.env.SITE_URL ?? "http://localhost:3000";
const WIDTHS = [360, 390, 414, 768, 1024];

async function connect(wsUrl: string) {
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
    send(method: string, params: Record<string, unknown> = {}) {
      id += 1;
      const myId = id;
      return new Promise<any>((resolve, reject) => {
        pending.set(myId, { resolve, reject });
        ws.send(JSON.stringify({ id: myId, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

const PROBE = `
(() => {
  const winW = window.innerWidth;
  const docW = document.documentElement.scrollWidth;

  // Таблица на мобильном должна быть скрыта, карточки — видны
  const table = document.querySelector("table");
  const cards = document.querySelectorAll("ul.divide-y > li");
  const tableVisible = table ? table.getBoundingClientRect().width > 0 : false;
  const cardsVisible = cards.length > 0;

  const overflow = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (getComputedStyle(el).position === "fixed") continue;
    if (r.right > winW + 1 || r.left < -1) {
      let p = el.parentElement, scrollable = false;
      while (p) {
        const ps = getComputedStyle(p);
        if (ps.overflowX === "auto" || ps.overflowX === "scroll" || ps.overflow === "hidden") {
          scrollable = true; break;
        }
        p = p.parentElement;
      }
      if (scrollable) continue;
      overflow.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().slice(0, 40),
        right: Math.round(r.right),
      });
    }
  }

  // Высота чата: на мобильном он не должен схлопнуться или растянуться
  const chatCard = document.querySelector("#assistant > div");
  const chatH = chatCard ? Math.round(chatCard.getBoundingClientRect().height) : 0;

  return {
    winW, docW,
    hasHScroll: docW > winW + 1,
    tableVisible, cardsVisible, cardCount: cards.length,
    overflowCount: overflow.length, overflow: overflow.slice(0, 6),
    chatH,
    rowCount: document.querySelectorAll("tbody tr").length + cards.length,
  };
})()
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const shots = process.argv.includes("--shots");
  let failures = 0;
  let checks = 0;
  const fs = await import("node:fs");

  for (const width of WIDTHS) {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" });
    const target = (await res.json()) as { id: string; webSocketDebuggerUrl: string };
    const cdp = await connect(target.webSocketDebuggerUrl);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width, height: 844, deviceScaleFactor: 2, mobile: width < 768,
    });

    await cdp.send("Page.navigate", { url: `${BASE}/app` });
    await sleep(2500);

    // Загружаем демо-смету кликом по ссылке «Офисная смета»
    const clicked = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const btns = [...document.querySelectorAll("button")];
          const b = btns.find((x) => (x.textContent || "").includes("Офисная смета"));
          if (!b) return "кнопка не найдена";
          b.click();
          return "клик";
        })()
      `,
      returnByValue: true,
    });

    if (clicked.result.value !== "клик") {
      console.log(`  ✗ ${width}px — не удалось загрузить демо: ${clicked.result.value}`);
      failures += 1;
      cdp.close();
      continue;
    }

    // Ждём появления таблицы/карточек. 25 секунд, а не 15:
    // в dev-режиме первый заход на страницу компилирует её, и это
    // занимает до десяти секунд на медленной машине. На проде ответ
    // приходит за секунды, но проверка не должна зависеть от прогрева
    let loaded = false;
    for (let i = 0; i < 50; i += 1) {
      await sleep(500);
      const st = await cdp.send("Runtime.evaluate", {
        expression: `document.querySelectorAll("ul.divide-y > li").length > 0 || document.querySelectorAll("tbody tr").length > 0`,
        returnByValue: true,
      });
      if (st.result.value) { loaded = true; break; }
    }

    if (!loaded) {
      console.log(`  ✗ ${width}px — смета не обработалась за 15 с`);
      failures += 1;
      cdp.close();
      continue;
    }

    await sleep(600);
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: PROBE, returnByValue: true,
    });
    const r = result.value as {
      winW: number; docW: number; hasHScroll: boolean;
      tableVisible: boolean; cardsVisible: boolean; cardCount: number;
      overflowCount: number; overflow: Array<{ tag: string; text: string; right: number }>;
      chatH: number; rowCount: number;
    };

    const problems: string[] = [];

    checks += 1;
    if (r.hasHScroll) problems.push(`горизонтальный скролл: ${r.docW}px при экране ${r.winW}px`);

    checks += 1;
    if (r.overflowCount > 0) {
      problems.push(
        `вылезает (${r.overflowCount}): ` +
          r.overflow.slice(0, 3).map((o) => `${o.tag} «${o.text}»`).join("; "),
      );
    }

    // До 640px — карточки и никакой таблицы; от 640px — наоборот
    checks += 1;
    if (width < 640 && r.tableVisible) problems.push("на телефоне видна таблица вместо карточек");
    checks += 1;
    if (width < 640 && !r.cardsVisible) problems.push("на телефоне нет карточек позиций");
    checks += 1;
    if (width >= 640 && !r.tableVisible) problems.push("на планшете нет таблицы");

    checks += 1;
    if (r.chatH < 300) problems.push(`чат схлопнулся: ${r.chatH}px`);

    checks += 1;
    if (r.rowCount < 10) problems.push(`позиций отрисовано ${r.rowCount}, ожидалось 10+`);

    if (problems.length === 0) {
      console.log(`  ✓ ${width}px — позиций ${r.rowCount}, чат ${r.chatH}px`);
    } else {
      failures += problems.length;
      console.log(`  ✗ ${width}px`);
      for (const p of problems) console.log(`      ${p}`);
    }

    if (shots) {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      fs.mkdirSync(".shots", { recursive: true });
      const file = `.shots/результат-${width}.png`;
      fs.writeFileSync(file, Buffer.from(shot.data as string, "base64"));
      console.log(`      снимок: ${file}`);
    }

    cdp.close();
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`).catch(() => {});
  }

  console.log(`\n═══ Итог: ${checks - failures} из ${checks} проверок пройдено ═══`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Ошибка:", e instanceof Error ? e.message : e);
  process.exit(1);
});
