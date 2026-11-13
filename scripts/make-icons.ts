/**
 * Генератор PNG-иконок.
 *
 * Next.js ищет apple-icon как PNG или JPEG; SVG в этой роли он молча
 * не регистрирует — иконка отдаётся 404, в HTML ссылки на неё нет.
 * Проверено запросом к /apple-icon.svg: 404 при валидном файле.
 *
 * Поэтому рисуем растровую иконку сами, без установки sharp или canvas:
 * 180×180 — это 32 400 пикселей, для них хватает чистого кода. Формат
 * PNG простой: сигнатура, IHDR, IDAT с zlib и IEND. zlib есть в
 * стандартной библиотеке Node, CRC32 пишем сами.
 *
 * Запуск: node scripts/make-icons.ts
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const ACCENT: [number, number, number] = [0x25, 0x63, 0xeb]; // accent-600
const WHITE: [number, number, number] = [0xff, 0xff, 0xff];

/** Сглаживание: считаем покрытие пикселя фигурой по сетке 4×4. */
const SUB = 4;

type Rgb = [number, number, number];

function crc32(buf: Buffer): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * Описание знака в нормальных координатах [0..1].
 *
 * Воздуховод в разрезе: две дуги сходятся к центру, точка — поток
 * воздуха. Возвращает функцию «покрыт ли пиксель».
 */
function makeShape(size: number, withDot: boolean) {
  // Пропорции взяты из icon.svg, переведённые в доли стороны
  const strokeW = withDot ? 0.085 : 0.12;

  /** Расстояние от точки до отрезка прямой */
  const distToSegment = (
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): number => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  };

  return (x: number, y: number, alpha: number): Rgb | null => {
    // Верхняя дуга: горизонталь от (0.2, 0.36) до (0.5,0.36), затем
    // четверть окружности радиусом 0.2 вниз
    const r1 = 0.2;
    const cx1 = 0.5;
    const cy1 = 0.56;

    const d1h = distToSegment(x, y, 0.2, 0.36, cx1, 0.36);
    // Дуга: только в правой нижней четверти
    const onArc1 = x >= cx1 && y >= cy1 - r1 && y <= cy1;
    const d1a = onArc1 ? Math.abs(Math.hypot(x - cx1, y - cy1) - r1) : Infinity;
    const d1v = distToSegment(x, y, cx1 + r1, cy1, cx1 + r1, 0.9);
    const d1 = Math.min(d1h, d1a, d1v);

    if (d1 < strokeW / 2) return blend(WHITE, alpha);

    // Вторая дуга, короче и полупрозрачная
    const r2 = 0.1;
    const cx2 = 0.4;
    const cy2 = 0.64;
    const d2h = distToSegment(x, y, 0.2, 0.64, cx2, 0.64);
    const onArc2 = x >= cx2 && y >= cy2 - r2 && y <= cy2;
    const d2a = onArc2 ? Math.abs(Math.hypot(x - cx2, y - cy2) - r2) : Infinity;
    const d2 = Math.min(d2h, d2a);
    if (d2 < strokeW / 2) return blend(WHITE, alpha * 0.55);

    // Точка «поток воздуха»
    if (withDot) {
      const dotR = 0.075;
      const dd = Math.hypot(x - 0.68, y - 0.26);
      if (dd < dotR) return blend(WHITE, alpha);
    }

    return null;
  };

  function blend(c: Rgb, a: number): Rgb {
    return [
      Math.round(ACCENT[0] + (c[0] - ACCENT[0]) * a),
      Math.round(ACCENT[1] + (c[1] - ACCENT[1]) * a),
      Math.round(ACCENT[2] + (c[2] - ACCENT[2]) * a),
    ];
  }
}

function makePng(size: number, withDot: boolean): Buffer {
  const shape = makeShape(size, withDot);

  // Строки: фильтр 0 (None) + RGB на пиксель
  const raw = Buffer.alloc(size * (1 + size * 3));
  let p = 0;

  for (let y = 0; y < size; y += 1) {
    raw[p++] = 0; // filter type
    for (let x = 0; x < size; x += 1) {
      // Усредняем по подсетке — так края получаются гладкими
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SUB; sy += 1) {
        for (let sx = 0; sx < SUB; sx += 1) {
          const nx = (x + (sx + 0.5) / SUB) / size;
          const ny = (y + (sy + 0.5) / SUB) / size;
          const hit = shape(nx, ny, 1);
          const col = hit ?? ACCENT;
          r += col[0];
          g += col[1];
          b += col[2];
        }
      }
      const n = SUB * SUB;
      raw[p++] = Math.round(r / n);
      raw[p++] = Math.round(g / n);
      raw[p++] = Math.round(b / n);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 180×180 — стандарт для apple-touch-icon
const apple = makePng(180, false);
writeFileSync("src/app/apple-icon.png", apple);
console.log(`apple-icon.png: ${apple.length} байт`);

// 32×32 — запасной растровый фавикон для браузеров без SVG
const fav = makePng(32, true);
writeFileSync("src/app/favicon.ico.png", fav);
console.log(`favicon-32.png: ${fav.length} байт`);
