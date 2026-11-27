import type { PositionStatus } from "./types";

/**
 * Презентационные характеристики статуса.
 *
 * Держим вне компонентов: одна точка правды. Если менеджер попросит
 * переименовать «на проверку» в «требует уточнения» — правим здесь,
 * а не в пяти местах.
 */
export interface StatusStyle {
  label: string;
  short: string;
  /** Классы для бейджа */
  badge: string;
  /** Маркер точки */
  dot: string;
  /** Одним предложением — что значит статус для менеджера */
  meaning: string;
}

/**
 * Цвета статусов намеренно приглушены.
 *
 * Яркий светофор (чистый красный, чистый зелёный) в таблице из тридцати
 * строк превращается в рябь и перестаёт работать как сигнал. Приглушённые
 * оттенки читаются спокойнее, а смысл несёт текст, а не только цвет —
 * это важно и для тех, кто не различает красный с зелёным.
 */
export const STATUS_STYLES: Record<PositionStatus, StatusStyle> = {
  priced: {
    label: "С ценой",
    short: "ok",
    badge: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15",
    dot: "bg-emerald-500",
    meaning: "Цена рассчитана по соответствующей позиции прайса.",
  },
  not_found: {
    label: "Нет в прайсе",
    short: "нет",
    badge: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15",
    dot: "bg-amber-500",
    meaning: "Позиция не найдена в прайсе. Стоимость требует уточнения.",
  },
  needs_human: {
    label: "На проверку",
    short: "пров.",
    badge: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15",
    dot: "bg-rose-500",
    meaning: "Соответствие требует проверки менеджером.",
  },
  ambiguous: {
    label: "Неоднозначно",
    short: "неодн.",
    badge: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15",
    dot: "bg-rose-500",
    meaning: "Найдено несколько вариантов с разными ценами. Выберите подходящий.",
  },
  off_topic: {
    label: "Пропущено",
    short: "—",
    badge: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-600/10",
    dot: "bg-slate-400",
    meaning: "Строка не содержит позиции оборудования и исключена из расчёта.",
  },
  error: {
    label: "Ошибка",
    short: "err",
    badge: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15",
    dot: "bg-rose-500",
    meaning: "Строку не удалось разобрать.",
  },
};
