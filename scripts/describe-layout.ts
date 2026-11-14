/**
 * Описание того, что видно на экране телефона.
 *
 * Я не могу смотреть скриншоты, поэтому измеряю раскладку числами:
 * координаты блоков первого экрана, размеры шрифтов, попадание кнопок
 * в кадр, размер зоны нажатия. Из этого видно, что вёрстка собранная,
 * а не просто «нет скролла».
 *
 * Запуск: node scripts/describe-layout.ts [ширина]
 */
const CDP_PORT = process.env.CDP_PORT ?? "9222";
const BASE = process.env.SITE_URL ?? "http://localhost:3000";
const width = Number(process.argv[2] ?? 390);

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PROBE = `
(() => {
  const out = [];
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const info = (label, el) => {
    if (!el) { out.push({ label, missing: true }); return; }
    const b = box(el);
    const cs = getComputedStyle(el);
    out.push({
      label,
      box: b,
      font: Math.round(parseFloat(cs.fontSize)),
      text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 55),
      fits: b.x >= 0 && b.x + b.w <= window.innerWidth + 1,
    });
  };

  info("h1", document.querySelector("h1"));
  info("подзаголовок", document.querySelector("h1 + p"));
  const btns = document.querySelectorAll("main a.btn-primary, main a.btn-secondary");
  btns.forEach((b, i) => info("кнопка " + (i + 1), b));
  info("карточка-демо", document.querySelector("main .shadow-lift"));
  info("шапка", document.querySelector("header"));
  info("логотип-знак", document.querySelector("header svg") ? document.querySelector("header svg").closest("span").parentElement : null);

  // Зоны нажатия: по стандарту доступности минимум 44×44
  const small = [];
  for (const el of document.querySelectorAll("a, button")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (getComputedStyle(el).position === "fixed") continue;
    if (r.height < 36 || r.width < 36) {
      small.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().slice(0, 30),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  }

  return {
    winW: window.innerWidth,
    winH: window.innerHeight,
    docH: document.documentElement.scrollHeight,
    elements: out,
    smallTargets: small.filter(s => s.text).slice(0, 10),
    smallCount: small.filter(s => s.text).length,
    sections: [...document.querySelectorAll("main > section")].map(s => ({
      id: s.id || "(без id)",
      h: Math.round(s.getBoundingClientRect().height),
    })),
  };
})()
`;

async function main() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" });
  const target = (await res.json()) as { id: string; webSocketDebuggerUrl: string };
  const cdp = await connect(target.webSocketDebuggerUrl);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await cdp.send("Page.navigate", { url: BASE + "/" });
  await sleep(2600);

  const { result } = await cdp.send("Runtime.evaluate", {
    expression: PROBE, returnByValue: true,
  });
  const r = result.value;

  console.log(`\nШирина ${r.winW}px, высота экрана ${r.winH}px, вся страница ${r.docH}px\n`);
  console.log("Элементы первого экрана:");
  for (const e of r.elements) {
    if (e.missing) { console.log(`  ${e.label.padEnd(16)} — НЕ НАЙДЕН`); continue; }
    const fits = e.fits ? "в кадре" : "ВЫЛЕЗАЕТ";
    console.log(
      `  ${e.label.padEnd(16)} x=${String(e.box.x).padStart(3)} y=${String(e.box.y).padStart(4)} ` +
        `${String(e.box.w).padStart(4)}×${String(e.box.h).padStart(3)}  шрифт ${String(e.font).padStart(2)}  ${fits}`,
    );
    console.log(`  ${" ".repeat(16)} «${e.text}»`);
  }

  console.log("\nСекции страницы:");
  for (const s of r.sections) {
    console.log(`  ${s.id.padEnd(12)} ${s.h}px`);
  }

  console.log(`\nМелкие зоны нажатия (< 36px): ${r.smallCount}`);
  for (const s of r.smallTargets) {
    console.log(`  ${s.tag} ${s.w}×${s.h} «${s.text}»`);
  }

  cdp.close();
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`).catch(() => {});
}

main().catch((e) => {
  console.error("Ошибка:", e instanceof Error ? e.message : e);
  process.exit(1);
});
