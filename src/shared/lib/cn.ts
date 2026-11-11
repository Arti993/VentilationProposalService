import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Склейка классов с разрешением конфликтов Tailwind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Формат денег: 123 170 ₽. Intl, а не ручные replace — не ломается на локали. */
export function formatMoney(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)} ₽`;
}

/** Формат числа с разделителями. */
export function formatNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

/** Человеческая подпись статуса позиции. */
export const STATUS_LABEL: Record<string, string> = {
  priced: "цена есть",
  not_found: "нет в прайсе",
  needs_human: "на проверку",
  ambiguous: "неоднозначно",
  off_topic: "вне темы",
  error: "ошибка",
};
