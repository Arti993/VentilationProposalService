/**
 * Юнит-тесты разбора прайса и нормализации.
 *
 * ПОЧЕМУ ЭТО ВАЖНО ПОКРЫВАТЬ
 *
 * Прайс — источник всех цен в системе. Ошибка здесь не «неточность
 * отображения», а неверная цена в коммерческом предложении клиенту.
 *
 * И одна такая ошибка уже была в проде: SheetJS читал CSV-байты как
 * latin1, кириллица превращалась в мусор, и любой русский прайс в UTF-8
 * отвергался с «не нашёл колонки». Тесты ниже фиксируют это поведение,
 * чтобы оно не вернулось.
 */
import { describe, it, expect } from "vitest";
import { decodeCsv } from "@/lib/price/parse";
import { normalize, matchKey } from "@/lib/price/normalize";

/** Кодирует строку в UTF-8 байты и отдаёт как ArrayBuffer. */
function utf8(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Кодирует строку в Windows-1251 байты. */
function cp1251(text: string): ArrayBuffer {
  /**
   * Простая таблица для теста: кириллица Windows-1251 идёт подряд с 0xC0
   * (А) до 0xFF (я), а ё и Ё — отдельными байтами. Полная таблица не
   * нужна: тест проверяет определение кодировки, а не весь алфавит.
   */
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;

    if (code < 128) {
      out.push(code);
    } else if (ch === "ё") {
      out.push(0xb8);
    } else if (ch === "Ё") {
      out.push(0xa8);
    } else if (code >= 0x0410 && code <= 0x044f) {
      // А..я подряд: 0x0410 → 0xC0
      out.push(code - 0x0410 + 0xc0);
    } else if (ch === "—") {
      out.push(0x97);
    } else {
      out.push(0x3f); // «?» для всего, что не поддержано
    }
  }
  return new Uint8Array(out).buffer;
}

describe("decodeCsv: кодировки", () => {
  it("читает UTF-8", () => {
    const text = "Код,Наименование,Цена\np001,Воздуховод 315,846";
    expect(decodeCsv(utf8(text))).toBe(text);
  });

  it("читает UTF-8 с BOM", () => {
    /**
     * Excel при сохранении в «CSV UTF-8» ставит BOM. Без его удаления
     * первая колонка называется "\uFEFFКод", и поиск заголовка по слову
     * «Код» не находит её.
     */
    const text = "\uFEFFКод,Наименование,Цена\np001,Воздуховод,846";
    expect(decodeCsv(utf8(text))).toBe("Код,Наименование,Цена\np001,Воздуховод,846");
  });

  it("читает Windows-1251", () => {
    /**
     * Именно эту кодировку даёт Excel «CSV (разделители с запятой)» на
     * русской Windows — а прайсы поставщиков делают в Excel. Без фолбэка
     * на 1251 такие файлы не читались бы вовсе.
     */
    const text = "Код,Наименование,Цена\np001,Воздуховод 315,846";
    expect(decodeCsv(cp1251(text))).toBe(text);
  });

  it("не путает UTF-16LE с мусором", () => {
    // Notepad сохраняет «Юникод» как UTF-16LE с BOM
    const text = "Код,Наименование";
    const buf = new Uint8Array(2 + text.length * 2);
    buf[0] = 0xff;
    buf[1] = 0xfe;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      buf[2 + i * 2] = code & 0xff;
      buf[3 + i * 2] = code >> 8;
    }
    expect(decodeCsv(buf.buffer)).toBe(text);
  });

  it("пустой файл не ломает чтение", () => {
    expect(decodeCsv(new ArrayBuffer(0))).toBe("");
  });
});

describe("normalize", () => {
  it("выделяет тип и размеры из названия", () => {
    const item = normalize("Воздуховод спирально-навивной 315", 846, 0);

    expect(item.price).toBe(846);
    expect(item.dims).toContain(315);
    // Тип должен распознаться: иначе матчинг по типу не сработает
    expect(item.type).not.toBe("unknown");
  });

  it("разбирает угол у отвода", () => {
    const item = normalize("Отвод сегментный 90 градусов 150", 606, 0);
    expect(item.angle).toBe(90);
    expect(item.dims).toContain(150);
  });

  it("разбирает два размера у тройника", () => {
    const item = normalize("Тройник круглый 315/200", 983, 0);
    expect(item.dims).toEqual(expect.arrayContaining([315, 200]));
  });

  it("не выдумывает размер, если его нет", () => {
    // Название без числа: размер пустой, а не «0»
    const item = normalize("Заглушка торцевая", 100, 0);
    expect(item.dims).toEqual([]);
  });

  it("цена сохраняется как есть", () => {
    // Цена — источник истины из прайса, нормализация её не должна трогать
    const item = normalize("Муфта 500", 400, 0);
    expect(item.price).toBe(400);
  });
});

describe("matchKey", () => {
  it("одинаковые позиции дают одинаковый ключ", () => {
    /**
     * Ключ используется для быстрого поиска точного совпадения. Если он
     * нестабилен, детерминированный матчинг перестанет находить позиции,
     * и всё уедет в модель — дорого и медленно.
     */
    const a = normalize("Отвод сегментный 90 градусов 150", 606, 0);
    const b = normalize("Отвод сегментный 90 градусов 150", 700, 1);

    // Цена в ключ не входит: одна позиция, разные цены на даты
    expect(matchKey(a)).toBe(matchKey(b));
  });

  it("разные размеры дают разные ключи", () => {
    const a = normalize("Отвод сегментный 90 градусов 150", 606, 0);
    const b = normalize("Отвод сегментный 90 градусов 250", 441, 1);

    /**
     * Это главная защита от ошибочного матча: отвод 150 и отвод 250 —
     * разные изделия с разной ценой. Общий ключ склеил бы их, и клиент
     * получил бы цену не того диаметра.
     */
    expect(matchKey(a)).not.toBe(matchKey(b));
  });

  it("разный угол даёт разные ключи", () => {
    const a = normalize("Отвод сегментный 90 градусов 250", 441, 0);
    const b = normalize("Отвод сегментный 45 градусов 250", 326, 1);
    expect(matchKey(a)).not.toBe(matchKey(b));
  });
});
