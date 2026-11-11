import { cn } from "@shared/lib/cn";
import { STATUS_STYLES } from "../model/status";
import type { PositionStatus } from "../model/types";

interface StatusBadgeProps {
  status: PositionStatus;
  className?: string;
}

/** Бейдж статуса позиции. Цвет + текст: не полагаемся только на цвет. */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.error;
  return (
    <span className={cn("badge whitespace-nowrap", s.badge, className)}>
      {s.label}
    </span>
  );
}
