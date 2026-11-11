/**
 * Гибридный поиск: вектор + совпадение ключевых слов.
 *
 * Зачем не чистый вектор. Запрос «хомут для воздуховода 315» проваливался:
 * слова «воздуховод» и «315» перетягивали результат на воздуховод, хотя
 * главный тип изделия — хомут. Модель смотрит на весь текст целиком и не
 * понимает, что «для воздуховода» — это уточнение, а не главное слово.
 *
 * Решение: считать не только косинусное сходство, но и то, насколько
 * совпадают значимые слова. Слова запроса ищутся в названии прайса, причём
 * совпадение по началу слова («хомут» ↔ «Хомут») считается полностью —
 * так работает словообразование в русском.
 *
 * ВАЖНО про честность: гибрид — это переранжирование выдачи, а не
 * выдумывание совпадений. Если позиции нет в прайсе, никакое сочетание
 * весов её не создаст.
 */
import { searchPrice, type SearchHit } from "./search.ts";
import { normalize, type ItemType } from "../price/normalize.ts";

/**
 * Слова запроса, по которым можно определить ТИП изделия.
 *
 * Это главный предохранитель гибридного поиска. Вектор ищет «похожее
 * по смыслу», и на запрос «хомут крепёжный 315» выдаёт воздуховод 315 —
 * потому что хомутов в прайсе нет, а размер совпал. Цена воздуховода,
 * подставленная в строку про хомут, — это ровно та ошибка, которую мы
 * договорились не допускать.
 *
 * Поэтому если в запросе назван тип, которого нет среди `type` найденных
 * позиций, — совпадение отбрасывается целиком, а не помечается «неточным».
 */
const TYPE_HINTS: Record<string, ItemType> = {
  воздуховод: "duct_spiral",
  воздуховоды: "duct_spiral",
  труба: "duct_spiral",
  спиральный: "duct_spiral",
  прямошовный: "duct_straight",
  ниппель: "nipple",
  муфта: "coupling",
  отвод: "elbow_segmented",
  тройник: "tee",
  переход: "reducer",
  врезка: "straight_tap",
  седло: "saddle",
  заглушка: "cap",
  крестовина: "cross",
};

/**
 * Заменяет числительные словами на цифры: «триста пятнадцать» → «315».
 *
 * Зачем на входе модели: эмбеддинг плохо связывает слова «триста
 * пятнадцать» с цифрой 315 в прайсе. Замерено — все тройники получают
 * сходство 0.51-0.53, и нужный 315/200 не попадает даже в топ-10.
 * После замены на цифры задача сводится к той, которую вектор решает
 * хорошо: «тройник 315 на 200».
 *
 * Обратная замена (цифры → слова) не нужна и вредна: в прайсе цифры.
 *
 * ВНИМАНИЕ: \b в JavaScript не считает кириллицу словесными символами,
 * поэтому \bтриста\b не сработает. Раньше на этом обработка молчала —
 * функция возвращала текст без изменений. Вместо \b используем
 * явные границы «начало строки или не-буква».
 */
const B_START = "(?:^|[^а-яё])";
const B_END = "(?![а-яё])";

const UNITS: Record<string, number> = {
  сто: 100,
  двести: 200,
  триста: 300,
  четыреста: 400,
  пятьсот: 500,
  шестьсот: 600,
  семьсот: 700,
  восемьсот: 800,
  девятьсот: 900,
  тысяча: 1000,
};

const TEENS_AND_TENS: Record<string, number> = {
  десять: 10,
  пятнадцать: 15,
  двадцать: 20,
  тридцать: 30,
  сорок: 40,
  пятьдесят: 50,
  шестьдесят: 60,
  семьдесят: 70,
  восемьдесят: 80,
  девяносто: 90,
};

/** Единицы: нужны для составных вроде «сто двадцать пять». */
const ONES: Record<string, number> = {
  один: 1,
  два: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
};

const UNIT_KEYS = Object.keys(UNITS).join("|");
const TEN_KEYS = Object.keys(TEENS_AND_TENS).join("|");

export function digitsFromWords(text: string): string {
  let s = text.toLowerCase().replace(/ё/g, "е");

  const ONE_KEYS = Object.keys(ONES).join("|");

  // 0. Три слова: «сто двадцать пять» → 125, «двести тридцать один» → 231
  const triple = new RegExp(
    `${B_START}(${UNIT_KEYS})\\s+(${TEN_KEYS})\\s+(${ONE_KEYS})${B_END}`,
    "g",
  );
  s = s.replace(
    triple,
    (_m, u: string, t: string, o: string) =>
      ` ${(UNITS[u] ?? 0) + (TEENS_AND_TENS[t] ?? 0) + (ONES[o] ?? 0)} `,
  );

  // 1. Составные: «триста пятнадцать» → 315, «двести пятьдесят» → 250
  const compound = new RegExp(`${B_START}(${UNIT_KEYS})\\s+(${TEN_KEYS})${B_END}`, "g");
  s = s.replace(compound, (_m, p: string, t: string) => ` ${(UNITS[p] ?? 0) + (TEENS_AND_TENS[t] ?? 0)} `);

  // 2. Одиночные: «двести» → 200
  const single = new RegExp(`${B_START}(${UNIT_KEYS})${B_END}`, "g");
  s = s.replace(single, (_m, w: string) => ` ${UNITS[w] ?? w} `);

  return s.replace(/\s+/g, " ").trim();
}
const NUM_WORDS: Record<string, number> = {
  сто: 100,
  двести: 200,
  триста: 300,
  четыреста: 400,
  пятьсот: 500,
  шестьсот: 600,
  семьсот: 700,
  восемьсот: 800,
  девятьсот: 900,
  тысяча: 1000,
  стосто: 100,
};

/** Разбирает числа словами и составные («триста пятнадцать» → 315). */
function wordsToNumbers(text: string): number[] {
  const words = text.toLowerCase().replace(/ё/g, "е").split(/[\s,;()+/]+/);
  const out: number[] = [];

  // Составные числительные: «триста пятнадцать» = 300 + 15
  const PREFIX: Record<string, number> = {
    триста: 300,
    четыреста: 400,
    пятьсот: 500,
    шестьсот: 600,
    семьсот: 700,
    восемьсот: 800,
    девятьсот: 900,
  };
  const TEENS: Record<string, number> = {
    пятнадцать: 15,
    десять: 10,
    двадцать: 20,
    тридцать: 30,
    сорок: 40,
    пятьдесят: 50,
    шестьдесят: 60,
    семьдесят: 70,
    восемьдесят: 80,
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const p = PREFIX[w];
    if (p !== undefined) {
      // Пробуем склеить с предыдущим/следующим словом: «двести пятьдесят»
      const next = words[i + 1];
      const t = next ? TEENS[next] : undefined;
      if (t !== undefined) {
        out.push(p + t);
        i++;
        continue;
      }
    }
    const n = NUM_WORDS[w];
    if (n !== undefined) out.push(n);
  }
  return out;
}

/**
 * Слова, которые ЗАВЕДОМО обозначают изделие, отсутствующее в прайсе.
 *
 * Зачем отдельный список, если есть TYPE_HINTS: когда тип не распознан,
 * предохранитель молчит, и поиск отдаёт «похожее по размеру» — воздуховод
 * на запрос про хомут. Такая цена хуже пустого ответа.
 *
 * Список собран из того, чего в нашем прайсе реально нет: крепёж,
 * гибкие элементы, автоматика. Проверяется ДО векторного поиска, чтобы
 * не тратить на него секунду.
 */
const NOT_IN_PRICE: string[] = [
  "хомут",
  "крепёж",
  "крепеж",
  "крепление",
  "вставка",
  "гибкий",
  "гибкая",
  "гибкое",
  "диффузор",
  "решетка",
  "решётка",
  "заслонка",
  "клапан",
  "фильтр",
  "вентилятор",
  "калорифер",
  "шумоглушитель",
];

/**
 * Назван ли в запросе товар, которого в прайсе нет.
 *
 * Возвращает само слово — чтобы объяснить отказ внятно.
 */
export function unservedItem(query: string): string | null {
  const norm = query.toLowerCase().replace(/ё/g, "е");
  for (const w of NOT_IN_PRICE) {
    const base = w.replace(/ё/g, "е");
    if (norm.includes(base)) return w;
  }
  return null;
}

/**
 * Определяет тип изделия, названный в запросе.
 *
 * Порядок разбора важен. «Воздуховод прямошовный 400» — это прямошовный,
 * хотя «воздуховод» стоит первым и по общему правилу типа побеждает.
 * Поэтому сначала ищем УТОЧНЯЮЩИЕ слова (спиральный, прямошовный), и
 * только если их нет — берём общее (воздуховод, труба).
 */
const REFINING_HINTS: Array<[string, ItemType]> = [
  ["спиральн", "duct_spiral"],
  ["прямошовн", "duct_straight"],
  ["сегментн", "elbow_segmented"],
  ["штампованн", "elbow_stamped"],
  ["седло", "saddle"],
];

function requestedType(text: string): ItemType | null {
  const norm = text.toLowerCase().replace(/ё/g, "е");

  // 1. Уточняющее слово решает: «спиральный» vs «прямошовный»
  for (const [hint, type] of REFINING_HINTS) {
    if (norm.includes(hint)) return type;
  }

  // 2. Иначе — общее слово, но тоже в порядке появления в тексте:
  //    «хомут крепёжный 315» ищем как хомут, а не как воздуховод
  const words = norm.split(/[\s,;()+/]+/);
  for (const w of words) {
    for (const [hint, type] of Object.entries(TYPE_HINTS)) {
      if (w === hint) return type;
      if (w.startsWith(hint) && hint.length >= 5) return type;
    }
  }
  return null;
}

/** Совместимы ли типы: точное совпадение или одна семья (отводы). */
function typeMatches(requested: ItemType, found: ItemType): boolean {
  if (requested === found) return true;
  return (TYPE_FAMILY[requested] ?? []).includes(found);
}

/** Типы, которые взаимозаменяемы: отвод бывает сегментный и штампованный. */
const TYPE_FAMILY: Partial<Record<ItemType, ItemType[]>> = {
  elbow_segmented: ["elbow_segmented", "elbow_stamped"],
  elbow_stamped: ["elbow_segmented", "elbow_stamped"],
};

/**
 * Достаёт числа из запроса как ожидаемые размеры.
 *
 * Названия в прайсе содержат размеры («315», «315/200»), и если клиент
 * просит 999 — такой позиции нет, что бы ни говорил вектор. Числа меньше
 * 20 не берём: это углы (90, 45) и количество (шт), а не диаметры.
 */
/**
 * Углы, которые встречаются в названиях отводов.
 *
 * Их нельзя считать размерами: в «Отвод 90 градусов 250» число 90 — это
 * угол, а диаметр — 250. Если принять 90 за размер, предохранитель
 * потребует позицию с диметром 90 и отсечёт правильную 250.
 */
const ANGLES = new Set([15, 30, 45, 60, 90, 135, 180]);

/**
 * Достаёт числа из запроса как ожидаемые размеры.
 *
 * Исключаем:
 *  - углы (90, 45, …) — через ANGLES;
 *  - количество «шт» и «м» — иначе «6 шт» станет размером 6;
 *  - всё меньше 20 — мелкие числа это не диаметры.
 */
function requestedDims(text: string): number[] {
  // Убираем куски с количеством и углами ДО извлечения чисел
  const cleaned = text
    .toLowerCase()
    .replace(/\d+\s*(шт|штук|м\.?п\.?|м|м2|м³|компл)\b/gi, " ")
    .replace(/\d+\s*(°|градус\w*)/gi, " ")
    .replace(/(°|градус\w*)\s*\d+/gi, " ");

  const digits = (cleaned.match(/\d+/g) ?? [])
    .map(Number)
    .filter((n) => n >= 20 && !ANGLES.has(n));

  if (digits.length > 0) return digits;

  // Цифр нет — пробуем словами: «тройник триста пятнадцать на двести»
  return wordsToNumbers(cleaned).filter((n) => n >= 20 && !ANGLES.has(n));
}

/**
 * Нормализует размеры к множеству чисел.
 *
 * Клиент пишет «400-315», прайс — «400/315». Как строки они разные, как
 * числа — одинаковые. Поэтому извлекаем все числа и сравниваем множества,
 * не глядя на разделители.
 */
function dimsSet(text: string): Set<number> {
  return new Set((text.match(/\d+/g) ?? []).map(Number));
}

/**
 * Есть ли в позиции прайса все запрошенные размеры.
 *
 * Сравниваем по числу, а не по строке: «315» и «d315» — одно и то же.
 */
function dimsMatch(wanted: number[], dimsKey: string): boolean {
  if (wanted.length === 0) return true;
  const have = dimsSet(dimsKey);
  return wanted.every((n) => have.has(n));
}

/**
 * Слова, которые не несут смысла о типе изделия.
 *
 * Предлоги, союзы и общие слова вроде «шт» или «для». «воздуховод» сюда
 * НЕ входит: он часто и есть искомый тип. Исключаем только служебное.
 */
const STOP_WORDS = new Set([
  "для",
  "под",
  "из",
  "на",
  "и",
  "или",
  "с",
  "по",
  "в",
  "шт",
  "штук",
  "штуки",
  "компл",
  "м",
  "мп",
  "м2",
  "пог",
  "погонных",
  "метров",
  "метра",
  "длина",
  "диаметр",
  "размер",
  "тип",
  "угол",
  "градусов",
  "градуса",
  "вентиляционный",
  "вентиляционная",
  "вентиляционное",
  "круглый",
  "круглая",
  "круглое",
]);

/** Приводит слово к основе: нижний регистр, без ё, без знаков. */
export function stem(word: string): string {
  return word
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9./]/g, "");
}

/** Значимые слова запроса: без стоп-слов и коротких обрывков. */
export function keywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[\s,;()+]+/)
    .map(stem)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/**
 * Насколько название прайса совпадает с ключевыми словами запроса.
 *
 * Возвращает долю найденных слов: 1.0 — все слова нашлись, 0 — ни одного.
 * Совпадение по началу слова считается как полное: «хомут» в «Хомут»
 * и «отвод» в «Отвод» — это то же слово, а не частичное совпадение.
 */
export function keywordScore(queryWords: string[], name: string): number {
  if (queryWords.length === 0) return 0;

  const nameWords = name
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[\s,;()/]+/)
    .map(stem)
    .filter((w) => w.length > 0);

  let matched = 0;
  for (const q of queryWords) {
    const found = nameWords.some((n) => {
      if (n === q) return true;
      // Основы: «ниппел» ↔ «ниппель», «заглушк» ↔ «заглушка».
      // Достаточно общего префикса в 4 символа — этого хватает, чтобы
      // различить «муфта»/«муфты», но не склеить «отвод» с «отверстие».
      const min = Math.min(n.length, q.length);
      if (min < 4) return false;
      let common = 0;
      while (common < min && n[common] === q[common]) common++;
      return common >= Math.min(4, min);
    });
    if (found) matched++;
  }

  return matched / queryWords.length;
}

/**
 * Итоговый балл: взвешенная сумма векторного сходства и слов.
 *
 * Веса подобраны так, чтобы слова решали при близких векторах (случай
 * «хомут для воздуховода»), но не перебивали сильное смысловое сходство
 * (случай «воздух спиральный» → «Воздуховод спирально-навивной»).
 */
const VECTOR_WEIGHT = 0.55;
const KEYWORD_WEIGHT = 0.45;

export interface HybridHit extends SearchHit {
  /** Сходство по вектору, 0..1 */
  vectorScore: number;
  /** Доля найденных ключевых слов, 0..1 */
  keywordScore: number;
  /** Итоговый балл */
  score: number;
}

/**
 * Ищет позиции гибридно: берёт широкую векторную выборку и переранжирует.
 *
 * Широкая выборка нужна потому, что правильная позиция может быть не
 * первой по вектору. Но шире 10 брать нельзя: на 15 строках ответ
 * превышает порог пулера Neon, и запрос висит до таймаута (замерено:
 * 3/5/10 строк — 0.6 с, 15 строк — 5.5 с).
 */
export async function hybridSearch(
  query: string,
  { limit = 5, pool = 10 }: { limit?: number; pool?: number } = {},
): Promise<HybridHit[]> {
  // Предохранитель №0: товар, которого у нас нет.
  //
  // Проверяется ДО поиска: если человек просит хомут, а хомутов в прайсе
  // нет, честный ответ — «нет». Векторный поиск в этом случае всегда
  // найдёт «что-то 315 мм», и эта цена уйдёт в смету как настоящая.
  if (unservedItem(query)) return [];

  // Числительные словами → цифры ДО эмбеддинга. Иначе модель не связывает
  // «триста пятнадцать» с 315, и все однотипные позиции получают одинаковое
  // сходство ~0.52 — нужная не попадает даже в топ-10 (замерено).
  const searchText = digitsFromWords(query);

  const [hits, words] = [await searchPrice(searchText, { limit: pool }), keywords(searchText)];

  // Предохранитель №1: тип изделия.
  //
  // Проверяем по searchText, а не по исходному тексту: там числительные уже
  // заменены цифрами, и разбор не зависит от того, словами их написали
  // или нет. Одна версия текста на все проверки — одна меньше причина
  // для расхождений.
  const wantedType = requestedType(searchText);
  const byType = wantedType ? hits.filter((h) => typeMatches(wantedType, h.type as ItemType)) : hits;

  if (wantedType && byType.length === 0) return [];

  // Предохранитель №2: размеры.
  //
  // Если размеры названы, но ни у одного кандидата их нет — это не «неточное
  // совпадение», а другой товар. Возвращаем пусто.
  //
  // Раньше здесь был fallback на byType, и он пропускал «воздуховод 999» →
  // ближайший воздуховод 1000 по цене 4 200 ₽. Именно от таких подстановок
  // и защищаемся: ошибочная цена опаснее отсутствия цены.
  const wantedDims = requestedDims(searchText);
  const byDims = byType.filter((h) => dimsMatch(wantedDims, h.dimsKey));
  if (wantedDims.length > 0 && byDims.length === 0) return [];

  const survivors = byDims.length > 0 ? byDims : byType;

  const scored: HybridHit[] = survivors.map((h) => {
    const kw = keywordScore(words, h.rawName);
    return {
      ...h,
      vectorScore: h.similarity,
      keywordScore: kw,
      score: VECTOR_WEIGHT * h.similarity + KEYWORD_WEIGHT * kw,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
