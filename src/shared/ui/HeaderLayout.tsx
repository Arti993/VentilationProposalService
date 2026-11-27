import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@shared/lib/cn";
import { Logo } from "@shared/ui/Logo";

/** Общая ширина шапки не зависит от ширины содержимого страницы. */
export function HeaderBar({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
      {children}
    </div>
  );
}

/** Возврат всегда перед логотипом, чтобы действия справа не смещали бренд. */
export function HeaderBrand({
  showHomeLink = true,
  compact = false,
}: {
  showHomeLink?: boolean;
  /** На экране сметы оставляем место для скачивания и новой загрузки. */
  compact?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      {showHomeLink && (
        <>
          <Link
            href="/"
            aria-label="На главную"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 sm:px-0"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">На главную</span>
          </Link>
          <span className="hidden h-5 w-px bg-slate-200 sm:block" aria-hidden />
        </>
      )}
      <Link href="/" aria-label="Вентиляционное оборудование — на главную" className="shrink-0">
        <span className={cn(compact ? "lg:hidden" : "sm:hidden")}>
          <Logo withWordmark={false} />
        </span>
        <span className={cn("hidden", compact ? "lg:block" : "sm:block")}>
          <Logo />
        </span>
      </Link>
    </div>
  );
}
