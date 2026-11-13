/**
 * Проверка блока «Как работает» после правки текста про форматы.
 *
 * Запуск: node scripts/check-formats-block.ts
 *
 * Что проверяем: главное — чтобы метки форматов не вылезли за пределы
 * карточки. Текст «Excel .xlsx .xlsm .xls» длинный, а первая колонка на
 * мобильном узкая (всего 360px минус отступы). Переполнение здесь
 * означает горизонтальный скролл на всём лендинге.
 *
 * Требует Chrome на порту 9222.
 */
const BASE = process.env.UI_BASE ?? "http://localhost:3000";
const CDP = "http://127.0.0.1:9222";

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

  for (const width of [360, 390, 768, 1024, 1440]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });

    await send("Page.navigate", { url: BASE });
    await new Promise((r) => setTimeout(r, 2000));

    const data = (await evaluate(`
      (() => {
        const de = document.documentElement;
        const section = document.querySelector('#how');
        if (!section) return { error: 'секция не найдена' };

        // Первая карточка списка — та, где метки форматов
        const first = section.querySelector('ol > li');
        const chips = [...(first?.querySelectorAll('ul > li') ?? [])];
        const cardBox = first?.getBoundingClientRect();

        // Метки не должны выходить за карточку по горизонтали
        const chipsOut = chips.filter(c => {
          const b = c.getBoundingClientRect();
          return b.right > cardBox.right + 1 || b.left < cardBox.left - 1;
        }).length;

        return {
          over: de.scrollWidth - de.clientWidth,
          chips: chips.length,
          chipsOut,
          text: (first?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 90),
        };
      })()
    `)) as { over?: number; chips?: number; chipsOut?: number; text?: string; error?: string };

    if (data.error) {
      console.log(`  ${width}px: ПРОВАЛ — ${data.error}`);
      failures++;
      continue;
    }

    const bad = (data.over ?? 0) > 1 || data.chipsOut !== 0 || data.chips !== 3;
    if (bad) failures++;

    console.log(
      `${bad ? "ПРОВАЛ" : "  ок  "} ${String(width).padStart(5)}px  ` +
        `меток ${data.chips}, вне карточки ${data.chipsOut}, ` +
        `переполнение ${data.over}px`,
    );
    if (width === 390) console.log(`         «${data.text}»`);
  }

  console.log(`\nПровалов: ${failures}`);
  ws.close();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
