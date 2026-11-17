/**
 * Юнит-тесты словаря синонимов.
 *
 * ПРОВЕРЯЕТСЯ НЕ РАДИ ПОКРЫТИЯ
 *
 * Каждый тест здесь — это ошибка, которая уже случилась или могла
 * случиться в проде. Комментарии объясняют, какая именно: через месяц
 * непонятно, почему граница слова такая сложная, и первый же рефакторинг
 * её упростит.
 */
import { describe, it, expect } from "vitest";
import {
  buildSynonymTable,
  applySynonyms,
  rewriteWithSynonym,
} from "@/lib/matcher/synonyms";

/** Сокращение для пары «формулировка → код». */
const pair = (rawText: string, code: string) => ({ rawText, code });

describe("buildSynonymTable", () => {
  it("отбрасывает слишком короткие фразы", () => {
    const table = buildSynonymTable([
      pair("отв", "p065"),
      pair("отвод", "p065"),
    ]);

    // «отв» — стандартное сокращение от «отвод», но как синоним ко
    // конкретной позиции оно смертельно: переписало бы ЛЮБОЙ отвод в p065,
    // независимо от угла и размера. Порог — 4 символа.
    expect(table.byPhrase.has("отв")).toBe(false);
    expect(table.byPhrase.has("отвод")).toBe(true);
  });

  it("приводит фразы к нижнему регистру", () => {
    const table = buildSynonymTable([pair("ОтВоД", "p065")]);
    expect(table.byPhrase.get("отвод")).toBe("p065");
  });

  it("нормализует лишние пробелы", () => {
    const table = buildSynonymTable([pair("отвод   сегментный", "p065")]);
    expect(table.byPhrase.get("отвод сегментный")).toBe("p065");
  });

  it("одинаковая фраза с тем же кодом не конфликтует", () => {
    const table = buildSynonymTable([
      pair("отвод 250", "p065"),
      pair("отвод 250", "p065"),
    ]);
    expect(table.byPhrase.get("отвод 250")).toBe("p065");
    expect(table.conflicts).toHaveLength(0);
  });

  it("одинаковая фраза с разными кодами — конфликт, а не молчаливый выбор", () => {
    /**
     * Два менеджера подтвердили по одной формулировке РАЗНЫЕ позиции.
     *
     * Первая версия брала «первое подтверждение выигрывает»: результат был
     * воспроизводим, но второй разбор менеджера просто терялся — он видел
     * свой ответ сохранённым, а система его игнорировала.
     *
     * Теперь фраза исключается из словаря, а конфликт возвращается наружу.
     * Строка пойдёт обычным путём: матчинг → RAG/LLM → человек. Цена не
     * будет поставлена по спорному правилу.
     */
    const table = buildSynonymTable([
      pair("отвод 250", "p065"),
      pair("отвод 250", "p066"),
    ]);

    expect(table.byPhrase.has("отвод 250")).toBe(false);
    expect(table.conflicts).toHaveLength(1);
    expect(table.conflicts[0].phrase).toBe("отвод 250");
    expect(table.conflicts[0].codes).toEqual(["p065", "p066"]);
  });

  it("пустая таблица не ломается", () => {
    const table = buildSynonymTable([]);
    expect(table.byPhrase.size).toBe(0);
    expect(table.conflicts).toHaveLength(0);
  });
});

describe("applySynonyms: границы слов", () => {
  const table = buildSynonymTable([pair("отвод", "p065")]);

  it("заменяет фразу в начале строки", () => {
    expect(applySynonyms("отвод 250", table).code).toBe("p065");
  });

  it("заменяет фразу после пробела", () => {
    expect(applySynonyms("Купить отвод 250", table).code).toBe("p065");
  });

  it("не находит фразу внутри слова", () => {
    /**
     * «подотвод» не должен срабатывать. Сравнение по подстроке нашло бы
     * «отвод» внутри и переписало бы строку в p065 — а это другая позиция.
     */
    expect(applySynonyms("подотвод 250", table).code).toBe(null);
  });

  it("не находит фразу перед буквами", () => {
    // «отводной» — другое слово
    expect(applySynonyms("отводной 250", table).code).toBe(null);
  });

  it("находит фразу перед цифрой", () => {
    // «отвод250» — слипшееся написание из Excel, реальный случай
    expect(applySynonyms("отвод250", table).code).toBe("p065");
  });

  it("находит фразу перед запятой и точкой", () => {
    expect(applySynonyms("отвод, 250", table).code).toBe("p065");
    expect(applySynonyms("отвод. 250", table).code).toBe("p065");
  });

  it("игнорирует регистр в строке", () => {
    expect(applySynonyms("ОТВОД 250", table).code).toBe("p065");
  });
});

describe("applySynonyms: порядок фраз", () => {
  const table = buildSynonymTable([
    pair("воздуховод", "p001"),
    pair("воздуховод спиральный", "p015"),
  ]);

  it("длинная фраза выигрывает у короткой", () => {
    /**
     * Если бы короткая проверялась первой, строка «воздуховод спиральный»
     * дала бы p001 (обычный воздуховод) — и цена была бы неверной.
     */
    expect(applySynonyms("воздуховод спиральный 315", table).code).toBe("p015");
    expect(applySynonyms("воздуховод 315", table).code).toBe("p001");
  });
});

describe("rewriteWithSynonym", () => {
  const table = buildSynonymTable([pair("воздуховод спиральный", "p015")]);
  const names = new Map([["p015", "Воздуховод спирально-навивной 315"]]);
  const dims = new Map([["p015", [315]]]);

  it("заменяет формулировку на название из прайса", () => {
    const r = rewriteWithSynonym("воздуховод спиральный 315", table, names, dims);
    expect(r.code).toBe("p015");
    expect(r.text).toBe("Воздуховод спирально-навивной 315");
  });

  it("сохраняет количество и единицу", () => {
    const r = rewriteWithSynonym(
      "Воздуховод спиральный 315; 10; м.п.",
      table,
      names,
      dims,
    );
    expect(r.text).toBe("Воздуховод спирально-навивной 315; 10; м.п.");
  });

  it("не дублирует размер, который уже есть в названии", () => {
    /**
     * Найдено сквозным тестом в проде: без чистки размеров получалось
     * «Воздуховод спирально-навивной 315, м.п. 315», и разбор количества
     * принимал второй «315» за количество — в смете появлялось 315 штук.
     */
    const r = rewriteWithSynonym("Воздуховод спиральный 315", table, names, dims);
    expect(r.text.match(/315/g)?.length).toBe(1);
  });

  it("не трогает строку, если позиции нет в прайсе", () => {
    // Прайс перезаписали, код исчез: синоним устарел, строку не меняем
    const r = rewriteWithSynonym(
      "воздуховод спиральный 315",
      table,
      new Map(),
      dims,
    );
    expect(r.code).toBe(null);
    expect(r.text).toBe("воздуховод спиральный 315");
  });

  it("не трогает незнакомую строку", () => {
    const r = rewriteWithSynonym("тройник 315/200", table, names, dims);
    expect(r.code).toBe(null);
    expect(r.text).toBe("тройник 315/200");
  });

  it("сохраняет размер позиции, даже если он отличается от строки", () => {
    /**
     * Менеджер мог сопоставить «315» с позицией «400». Размер «400» из
     * названия убирать нельзя: это размер самой позиции. Лучше лишний
     * размер, чем потерянный — по названию без размера менеджер не поймёт,
     * что заказывать.
     */
    const otherNames = new Map([["p015", "Воздуховод спирально-навивной 400"]]);
    const otherDims = new Map([["p015", [400]]]);

    const r = rewriteWithSynonym(
      "Воздуховод спиральный 315",
      table,
      otherNames,
      otherDims,
    );
    expect(r.text).toContain("400");
  });
});
