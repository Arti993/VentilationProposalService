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
  /** Классы для строки таблицы */
  row?: string;
  /** Маркер точки */
  dot: string;
}

export const STATUS_STYLES: Record<PositionStatus, StatusStyle> = {
  priced: {
    label: "Цена есть",
    short: "ok",
    badge: "bg-ok/10 text-ok border border-ok/20",
    dot: "bg-ok",
  },
  not_found: {
    label: "Нет в прайсе",
    short: "нет",
    badge: "bg-warn/10 text-warn border border-warn/20",
    dot: "bg-warn",
  },
  needs_human: {
    label: "На проверку",
    short: "пров.",
    badge: "bg-bad/10 text-bad border border-bad/20",
    dot: "bg-bad",
  },
  ambiguous: {
    label: "Неоднозначно",
    short: "неодн.",
    badge: "bg-bad/10 text-bad border border-bad/20",
    dot: "bg-bad",
  },
  off_topic: {
    label: "Вне темы",
    short: "—",
    badge: "bg-ink-100 text-ink-500 border border-ink-200",
    dot: "bg-ink-400",
  },
  error: {
    label: "Ошибка",
    short: "err",
    badge: "bg-bad/10 text-bad border border-bad/20",
    dot: "bg-bad",
  },
};
