/**
 * Нормализатор позиций прайс-листа вентиляции.
 *
 * Задача: превратить строку вида
 *   "Тройник вентиляционный круглый  315/160"  ->  { type: "tee", d1: 315, d2: 160 }
 * чтобы сравнение сметы с прайсом было детерминированным, а не "на глаз".
 */

export type ItemType =
  | "duct_spiral" // Воздуховод спирально-навивной
  | "duct_straight" // Воздуховод прямошовный
  | "nipple" // Ниппель вентиляционный круглый
  | "coupling" // Муфта-воздуховод
  | "elbow_segmented" // Отвод сегментный
  | "elbow_stamped" // Отвод штампованный
  | "tee" // Тройник
  | "reducer" // Переход
  | "saddle" // Врезка седло
  | "straight_tap" // Врезка прямая
  | "cap" // Заглушка торцевая
  | "cross" // Крестовина
  | "unknown";

export interface PriceItem {
  /** Исходная строка как в файле */
  rawName: string;
  /** Цена, руб. */
  price: number;
  /** Числовой id для стабильных ссылок */
  id: string;
  type: ItemType;
  /** Угол для отводов, градусы */
  angle?: number;
  /** Диаметры: для тройников/переходов/крестовин — несколько */
  dims: number[];
  /** Вариант исполнения, если в названии есть пометка, например "(R)" */
  variant?: string;
  /** Всё, что не удалось разложить структурно (для диагностики) */
  unparsed?: string;
}

/** Единица измерения по умолчанию для типа (в прайсе её нет — задаём явно). */
export const DEFAULT_UNIT: Record<ItemType, string> = {
  duct_spiral: "м.п.",
  duct_straight: "м.п.",
  nipple: "шт",
  coupling: "шт",
  elbow_segmented: "шт",
  elbow_stamped: "шт",
  tee: "шт",
  reducer: "шт",
  saddle: "шт",
  straight_tap: "шт",
  cap: "шт",
  cross: "шт",
  unknown: "шт",
};

export const TYPE_LABEL: Record<ItemType, string> = {
  duct_spiral: "Воздуховод спирально-навивной",
  duct_straight: "Воздуховод прямошовный",
  nipple: "Ниппель круглый",
  coupling: "Муфта-воздуховод",
  elbow_segmented: "Отвод сегментный",
  elbow_stamped: "Отвод штампованный",
  tee: "Тройник круглый",
  reducer: "Переход круглый",
  saddle: "Врезка седло",
  straight_tap: "Врезка прямая",
  cap: "Заглушка торцевая",
  cross: "Крестовина круглая",
  unknown: "Неизвестный тип",
};

const DEGREE_WORDS: Record<string, number> = {
  "90": 90,
  "45": 45,
  "60": 60,
  "30": 30,
};

/**
 * ВАЖНО: в JS `\w` = [A-Za-z0-9_] и НЕ включает кириллицу!
 * Поэтому вместо `\w*` используем `[а-яё]*` с флагом `i`.
 * Это грабли, на которые легко попасться со всей русскоязычной нормализацией.
 */
const W = "[а-яё]*";

/** Синонимы, которые клиенты пишут вместо прайсовых формулировок. */
const TYPE_SYNONYMS: Array<[RegExp, ItemType]> = [
  [new RegExp(`оцинкованн${W}\\s+спиральн|спиральн${W}\\s+оцинкованн`, "i"), "duct_spiral"],
  [new RegExp(`спиральн${W}\\s+воздуховод|воздуховод${W}\\s+спиральн`, "i"), "duct_spiral"],
  [new RegExp(`спиральн${W}\\s+навивн${W}|навивн${W}`, "i"), "duct_spiral"],
  [new RegExp(`оцинкованн${W}\\s+прямошовн|прямошовн${W}\\s+оцинкованн`, "i"), "duct_straight"],
  [new RegExp(`штампованн${W}\\s+отвод|отвод${W}\\s+штампованн`, "i"), "elbow_stamped"],
  [new RegExp(`сегментн${W}\\s+отвод|отвод${W}\\s+сегментн`, "i"), "elbow_segmented"],
  [new RegExp(`соединительн${W}\\s+ниппель`, "i"), "nipple"],
];

/**
 * Определяет тип по названию. Порядок важен:
 * "врезка седло" должна проверяться раньше "врезка прямая" и т.п.
 */
function detectType(name: string): ItemType {
  const n = name.toLowerCase();

  // Врезки: у седла есть два размера, у прямой — один
  if (n.includes("врезка седло")) return "saddle";
  if (n.includes("врезка прямая")) return "straight_tap";
  if (n.includes("отвод сегментный")) return "elbow_segmented";
  if (n.includes("отвод штампованный")) return "elbow_stamped";
  if (n.includes("спирально-навивной")) return "duct_spiral";
  if (n.includes("прямошовный")) return "duct_straight";
  if (n.includes("ниппель")) return "nipple";
  if (n.includes("муфта")) return "coupling";
  if (n.includes("тройник")) return "tee";
  if (n.includes("переход")) return "reducer";
  if (n.includes("заглушка")) return "cap";
  if (n.includes("крестовина")) return "cross";

  // Не нашли точного совпадения — пробуем синонимы
  for (const [re, t] of TYPE_SYNONYMS) {
    if (re.test(n)) return t;
  }

  // Голое "отвод" без вида: тип не определён, но LLM нужен список кандидатов
  // из ОБОИХ видов — иначе подбор кандидатов ничего не найдёт.
  if (/\bотвод/.test(n)) return "unknown";

  return "unknown";
}

/**
 * "переход с 400 на 355" -> "переход 400/355".
 *
 * Осторожно: "отвод 90 на 315" — здесь "90" это УГОЛ, а не размер.
 * Если слово между числами — "на" и предыдущее число похоже на угол,
 * склеивать нельзя.
 */
function normalizeSeparators(name: string): string {
  return name.replace(
    /(\d+)\s*(?:мм\s*)?(?:на|к|→|->)\s*(\d+)/gi,
    (full, a: string, b: string) => {
      const prev = Number(a);
      // 30/45/60/90 перед "на" — это угол, а не диаметр
      if (DEGREE_WORDS[String(prev)] !== undefined) return full;
      return `${a}/${b}`;
    },
  );
}

/** Угол: "90 градусов", "45 градусов", просто "90°". */
function parseAngle(name: string): number | undefined {
  const m = name.match(/(\d{1,2})\s*(?:градус|°|град)/i);
  if (m) {
    const v = Number(m[1]);
    if (DEGREE_WORDS[String(v)] !== undefined) return v;
  }
  return undefined;
}

/**
 * Пометки в скобках, которые описывают ФОРМУ/ТИП, а не исполнение.
 * Их нельзя считать вариантом: иначе "Заглушка ... (круглая) 315" и
 * "Заглушка ... (круглая) 355" окажутся в разных "вариантах" исполнения,
 * хотя это один и тот же тип.
 */
const TYPE_WORDS_IN_PARENS = new Set([
  "круглая",
  "круглый",
  "прямоугольная",
  "прямоугольный",
]);

/** Вариант исполнения: "(R)", "(с фланцем)" и подобные. */
function parseVariant(name: string): string | undefined {
  const m = name.match(/\(([^)]+)\)/);
  if (!m) return undefined;
  const v = m[1].trim();
  if (TYPE_WORDS_IN_PARENS.has(v.toLowerCase())) return undefined;
  return v;
}

/**
 * Числовые токены размеров.
 *
 * Аккуратно: диаметры могут быть записаны как "315/160", "315х160",
 * "ф315" или просто последним числом "315".
 * Угол (90/45) исключается, а пометка варианта удаляется заранее.
 */
function parseDims(name: string, type: ItemType): number[] {
  // Убираем пометки в скобках — иначе "(R)" попадает в мусор
  let s = name.replace(/\([^)]*\)/g, " ");

  // Убираем угол, чтобы его числа не попали в размеры
  s = s.replace(/\d{1,2}\s*(?:градус\w*|°|град\.?)/gi, " ");

  // "отвод 90 на 315": угол стоял ОТДЕЛЬНО ("90 на 315"), без слова "градус".
  // После normalizeSeparators это уже "90 на 315" (не склеено). Убираем
  // одинокое число угла, за которым идёт "на <число>".
  s = s.replace(/\b(?:30|45|60|90)\s+(?=на\s+\d)/gi, " ");
  // "отвод 90 315" — угол отдельным токеном перед размером
  s = s.replace(/^\s*отвод\w*\s+(?:30|45|60|90)\b/i, (m) =>
    m.replace(/\b(?:30|45|60|90)\b/, " "),
  );

  // Число с приклеенной единицей ("100мм", "315мм") — оставляем число
  s = s.replace(/(\d)\s*мм\b/gi, "$1 ");

  // Заменяем разделители размеров на "/", кроме дробей, которых тут нет
  s = s.replace(/[хx×*]\s*(?=\d)/gi, "/");

  // "ф315" -> "315"
  s = s.replace(/[фf]\s*(?=\d)/gi, " ");

  // Достаём цепочки чисел, разделённых "/"
  const chains = s.match(/\d+(?:\s*\/\s*\d+)*/g) ?? [];

  // Берём самую длинную цепочку — это и есть размеры
  let best: number[] = [];
  for (const ch of chains) {
    const nums = ch
      .split("/")
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length > best.length) best = nums;
  }

  // Если для типа с одним размером нашли несколько чисел, а среди них есть
  // угол — угол уже отфильтрован выше. Дополнительно отбрасываем кандидатов
  // < 50 мм: таких диаметров в вентиляции не бывает, это мусор из артикулов.
  if (expectedDimCount(type).includes(1)) {
    const real = best.filter((d) => d >= 50);
    if (real.length) best = [real[0]];
  }

  return best;
}

/** Проверка ожиданий по количеству размеров для типа. */
function expectedDimCount(type: ItemType): number[] {
  switch (type) {
    case "tee":
    case "reducer":
    case "saddle":
      return [2];
    case "cross":
      return [2, 4];
    default:
      return [1];
  }
}

export function normalize(rawName: string, price: number, index: number): PriceItem {
  const name = normalizeSeparators(rawName.trim());
  const type = detectType(name);
  const angle = parseAngle(name);
  const variant = parseVariant(name);
  const dims = parseDims(name, type);

  const expected = expectedDimCount(type);
  const ok =
    type !== "unknown" && expected.includes(dims.length) && dims.length > 0;

  return {
    rawName: name,
    price,
    id: `p${String(index + 1).padStart(3, "0")}`,
    type,
    angle,
    dims,
    variant,
    unparsed: ok ? undefined : `${type} | dims=[${dims.join(",")}] | expected=${expected.join("|")}`,
  };
}

/** Ключ позиции для быстрого точного сравнения при матчинге. */
export function matchKey(item: {
  type: ItemType;
  angle?: number;
  dims: number[];
  variant?: string;
}): string {
  return [item.type, item.angle ?? "", item.dims.join("/"), item.variant ?? ""].join("|");
}
