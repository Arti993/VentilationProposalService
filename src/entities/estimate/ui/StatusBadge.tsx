import { cn } from "@shared/lib/cn";
import { STATUS_STYLES } from "../model/status";
import type { PositionStatus } from "../model/types";

interface StatusBadgeProps {
  status: PositionStatus;
  className?: string;
  /** Показывать точку слева. На узких экранах лучше выключить. */
  withDot?: boolean;
}

/**
 * Бейдж статуса позиции.
 *
 * Смысл несёт текст, а не только цвет: около 8% мужчин не различают
 * красный с зелёным. Цвет — подсказка для быстрого сканирования,
 * текст — источник правды.
 */
export function StatusBadge({ status, className, withDot = true }: StatusBadgeProps) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.error;
  return (
    <span className={cn("badge whitespace-nowrap", s.badge, className)}>
      {withDot && (
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s.dot)} aria-hidden />
      )}
      {s.label}
    </span>
  );
}
