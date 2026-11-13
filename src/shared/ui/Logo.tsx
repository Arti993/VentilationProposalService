import { cn } from "@shared/lib/cn";

/**
 * Логотип сервиса.
 *
 * Знак: воздуховод в разрезе — три вложенные дуги с потоком воздуха.
 * Простая геометрия, узнаваемая в 24 пикселя, и по смыслу ровно про
 * то, чем занимается сервис. Иконка из lucide подошла бы, но у неё
 * неуникальный силуэт: такой же стоит в сотне проектов.
 */
interface LogoProps {
  className?: string;
  /** Вариант для тёмного фона */
  onDark?: boolean;
  /** Показать название рядом */
  withWordmark?: boolean;
}

export function Logo({ className, onDark = false, withWordmark = true }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-xl",
          onDark ? "bg-white/10 ring-1 ring-inset ring-white/15" : "bg-accent-600 shadow-sm",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-5 w-5"
          aria-hidden
          strokeWidth={1.75}
          strokeLinecap="round"
        >
          {/* Ствол воздуховода: три дуги сходятся к центру */}
          <path d="M4 7h9a5 5 0 0 1 5 5v5" stroke="white" strokeOpacity="0.95" />
          <path d="M4 12h8a2.5 2.5 0 0 1 2.5 2.5V17" stroke="white" strokeOpacity="0.6" />
          <path d="M4 17h5" stroke="white" strokeOpacity="0.35" />
          <circle cx="18" cy="6" r="1.6" fill="white" />
        </svg>
      </span>
      {withWordmark && (
        <span className="flex flex-col leading-none">
          <span
            className={cn(
              "text-[15px] font-semibold tracking-tight",
              onDark ? "text-white" : "text-slate-900",
            )}
          >
            Воздуховод
          </span>
          <span
            className={cn(
              "mt-1 text-[10px] font-medium uppercase tracking-[0.16em]",
              // slate-400 давал контраст 2.56:1 — вдвое ниже нормы.
              // Подпись мелкая, поэтому нужен slate-500 минимум.
              onDark ? "text-white/60" : "text-slate-500",
            )}
          >
            КП по смете
          </span>
        </span>
      )}
    </span>
  );
}
