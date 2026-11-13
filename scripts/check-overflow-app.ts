/**
 * Проверка переполнения рабочего экрана ПОСЛЕ загрузки сметы.
 *
 * Запуск: node scripts/check-overflow-app.ts
 *
 * Отдельный скрипт, потому что таблица появляется только после загрузки.
 * Пустой экран загрузки узкий и по нему нельзя судить о вёрстке таблицы —
 * а именно таблица чаще всего и распирает страницу.
 */
const BASE = process.env.UI_BASE ?? "http://localhost:3000";
const CDP = "http://127.0.0.1:9222";
const WIDTHS = [360, 390, 768, 1024, 1280, 1440];

async function main() {
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

  let failures = 0;

  for (const width of WIDTHS) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });

    await send("Page.navigate", { url: `${BASE}/app` });
    await new Promise((r) => setTimeout(r, 1500));

    // Кликаем «Офисная смета» — кнопка с таким текстом есть только
    // в состоянии загрузки
    const clicked = await evaluate(`
      (() => {
        const btn = [...document.querySelectorAll('button')]
          .find(b => b.textContent.trim() === 'Офисная смета');
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);

    if (!clicked) {
      console.log(`  ${width}px: кнопка демо не найдена`);
      failures++;
      continue;
    }

    // Ждём обработки: сопоставление 15 позиций ~2-8 с.
    // Проверяем не текст, а появление строк таблицы: подпись над
    // таблицей набрана капителью через CSS (uppercase), и innerText
    // отдаёт её в верхнем регистре — сравнение с «Смета обработана»
    // всегда ложно, хотя смета загружена.
    let loaded = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      loaded = Boolean(
        await evaluate(`document.querySelectorAll('tbody tr').length >= 10`),
      );
      if (loaded) break;
    }

    const data = (await evaluate(`
      (() => {
        const de = document.documentElement;
        return {
          over: de.scrollWidth - de.clientWidth,
          rows: document.querySelectorAll('tbody tr').length,
          h: de.scrollHeight,
        };
      })()
    `)) as { over: number; rows: number; h: number };

    const bad = data.over > 1 || !loaded;
    if (bad) failures++;
    console.log(
      `${bad ? "ПРОВАЛ" : "  ок  "} ${String(width).padStart(5)}px  ` +
        `переполнение ${data.over}px, строк ${data.rows}, высота ${data.h}px` +
        (loaded ? "" : " — смета не загрузилась"),
    );
  }

  console.log(`\nПровалов: ${failures}`);
  ws.close();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
