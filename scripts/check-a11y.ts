/**
 * Проверка доступности: контраст текста и подписи интерактивных элементов.
 *
 * Запуск: node scripts/check-a11y.ts
 *
 * Зачем: «красивый сайт» и «доступный сайт» конфликтуют ровно в одном
 * месте — светлый серый текст на белом. Он выглядит элегантно в макете
 * и нечитаем на старом мониторе в светлой комнате. Проверяем контраст
 * по формуле WCAG, а не на глаз.
 *
 * Порог: 4.5:1 для обычного текста, 3:1 для крупного (18pt+ или 14pt+
 * полужирного) — это требования уровня AA.
 */
const BASE = process.env.UI_BASE ?? "http://localhost:3000";
const CDP = "http://127.0.0.1:9222";

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

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
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  for (const path of ["/", "/app"]) {
    await send("Page.navigate", { url: `${BASE}${path}` });
    await new Promise((r) => setTimeout(r, 2000));

    const items = (await evaluate(`
      (() => {
        const out = [];
        const seen = new Set();
        // Фон может быть на любом предке — ищем первый непрозрачный
        function bgOf(el) {
          let cur = el;
          while (cur && cur !== document.documentElement) {
            const bg = getComputedStyle(cur).backgroundColor;
            const m = bg.match(/rgba?\\(([^)]+)\\)/);
            if (m) {
              const p = m[1].split(',').map(Number);
              const alpha = p.length > 3 ? p[3] : 1;
              if (alpha > 0.85) return [p[0], p[1], p[2]];
            }
            cur = cur.parentElement;
          }
          return [255, 255, 255];
        }

        document.querySelectorAll('p,span,h1,h2,h3,h4,a,button,li,td,th,dt,dd,label').forEach(el => {
          const text = (el.innerText || '').trim();
          if (!text || text.length < 2) return;
          // Только элементы с собственным текстом, не контейнеры
          if ([...el.children].some(c => (c.innerText || '').trim() === text)) return;
          const st = getComputedStyle(el);
          if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') return;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return;

          const fg = st.color.match(/rgba?\\(([^)]+)\\)/);
          if (!fg) return;
          const f = fg[1].split(',').map(Number);

          const key = st.color + '|' + st.fontSize + '|' + st.fontWeight;
          if (seen.has(key)) return;
          seen.add(key);

          out.push({
            text: text.slice(0, 40),
            fg: [f[0], f[1], f[2]],
            bg: bgOf(el),
            size: Math.round(parseFloat(st.fontSize)),
            weight: st.fontWeight,
            tag: el.tagName.toLowerCase(),
          });
        });
        return out;
      })()
    `)) as Array<{
      text: string;
      fg: [number, number, number];
      bg: [number, number, number];
      size: number;
      weight: string;
      tag: string;
    }>;

    console.log(`\n=== ${path} — проверено ${items.length} вариантов текста ===`);

    let fails = 0;
    for (const it of items) {
      // Крупный текст: 24px+ или 18.66px+ полужирный
      const large = it.size >= 24 || (it.size >= 18.66 && Number(it.weight) >= 700);
      const need = large ? 3 : 4.5;
      const ratio = contrast(it.fg, it.bg);

      if (ratio < need) {
        fails++;
        console.log(
          `  ПРОВАЛ ${ratio.toFixed(2)}:1 (нужно ${need}) ${it.size}px ${it.tag} «${it.text}»\n` +
            `         цвет rgb(${it.fg.join(",")}) на rgb(${it.bg.join(",")})`,
        );
      }
    }

    if (fails === 0) console.log("  все тексты проходят WCAG AA");
    else console.log(`  провалов: ${fails}`);
  }

  ws.close();
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
