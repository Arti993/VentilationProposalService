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

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300 ease-out-expo",
        scrolled || open
          ? "border-b border-slate-200/70 bg-white/85 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
        <Link href="/" aria-label="На главную" className="shrink-0">
          <Logo />
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

        <div className="flex items-center gap-2">
          <Link href="/app" className="btn-primary hidden sm:inline-flex">
            Попробовать
            <ArrowRight className="h-4 w-4" />
          </Link>

          <button
            className="btn-ghost -mr-2 !px-2.5 md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Мобильное меню */}
      {open && (
        <div className="border-t border-slate-200 bg-white px-5 py-4 md:hidden">
          <nav className="flex flex-col">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {n.label}
              </a>
            ))}
            <Link href="/app" className="btn-primary mt-3 w-full">
              Попробовать
              <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
