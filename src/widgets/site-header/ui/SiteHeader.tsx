"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import { cn } from "@shared/lib/cn";
import { Logo } from "@shared/ui/Logo";

const NAV = [
  { href: "#how", label: "Как работает" },
  { href: "#features", label: "Возможности" },
  { href: "#precision", label: "Точность" },
  { href: "#faq", label: "Вопросы" },
];

/**
 * Шапка сайта.
 *
 * Липкая, но не сразу: на самом верху страницы она прозрачная и не
 * мешает заголовку. Фон появляется при скролле — так первый экран
 * выглядит чище, а навигация остаётся под рукой.
 *
 * Порог 12px, а не 1px: при 1px шапка «дрожит» на тачпаде, потому что
 * событие скролла приходит рывками.
 *
 * МОБИЛЬНАЯ ВЕРСИЯ
 *
 * До 640px в шапке остаётся только знак без названия: две строки текста
 * плюс кнопка меню на 360px не влезают, а обрезанное «Вентиляционн…»
 * выглядит хуже, чем просто знак. Название целиком живёт в меню, где
 * места достаточно, и в заголовке вкладки.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Меню открыто — не даём странице скроллиться под ним
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Escape закрывает меню: открыв его кнопкой, мышью уйти некуда,
  // если не найти крестик
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300 ease-out-expo",
        scrolled || open
          ? "border-b border-slate-200/70 bg-white/85 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-5 lg:px-8">
        <Link href="/" aria-label="На главную" className="min-w-0 shrink">
          {/* На узком экране — только знак: см. комментарий выше */}
          <span className="sm:hidden">
            <Logo withWordmark={false} />
          </span>
          <span className="hidden sm:block">
            <Logo />
          </span>
        </Link>

        {/* Навигация на десктопе */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600
                         transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <Link href="/app" className="btn-primary hidden sm:inline-flex">
            Попробовать
            <ArrowRight className="h-4 w-4" />
          </Link>

          <button
            type="button"
            className="btn-ghost -mr-2 !px-2.5 md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={open}
            aria-controls="mobile-nav"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Мобильное меню */}
      {open && (
        <div
          id="mobile-nav"
          className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-slate-200 bg-white px-4 py-4 sm:px-5 md:hidden"
        >
          {/* Название целиком: в шапке на телефоне его нет */}
          <div className="mb-3 border-b border-slate-100 pb-3 sm:hidden">
            <Logo />
          </div>

          <nav className="flex flex-col">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                // Высота 48px: по этому меню жмут пальцем, и промах
                // раздражает сильнее, чем экономия восьми пикселей
                className="flex min-h-12 items-center rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {n.label}
              </a>
            ))}
            <Link
              href="/app"
              onClick={() => setOpen(false)}
              className="btn-primary mt-3 min-h-12 w-full"
            >
              Попробовать
              <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
