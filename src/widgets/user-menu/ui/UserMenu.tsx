"use client";

/**
 * Пользователь в шапке: аватар, имя и меню перехода в кабинет.
 *
 * ЧТО БЫЛО НЕ ТАК
 *
 * В шапке стояли адрес почты и кнопка «Выйти». Почта — это логин: её не
 * выбирают, человек её не узнаёт в интерфейсе как «себя». Кнопка «Выйти»
 * на видном месте — тоже странный акцент: выход нужен раз в месяц, а
 * место занимает всегда. И главное: из шапки не было пути в настройки,
 * потому что настроек не было вовсе.
 *
 * Теперь в шапке аватар (круглая картинка или инициалы) и имя, которое
 * человек сам задал. Клик по любому из них открывает меню с переходом в
 * кабинет. Выход переехал в кабинет, где ему и место.
 *
 * ПОЧЕМУ СОСТОЯНИЕ МОЖЕТ ПРИЙТИ ПРОПСОМ
 *
 * На `/app` сервер уже знает пользователя, и шапка рисуется сразу — без
 * мигания «Войти → имя». На статических страницах (лендинг) сессии на
 * сервере нет, и компонент запрашивает её сам. Вариант `undefined`
 * означает «ещё не знаем»: до ответа рисуется заглушка того же размера,
 * поэтому шапка не прыгает.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, LogIn, Settings } from "lucide-react";
import { Avatar } from "@shared/ui/Avatar";
import { getCurrentUser, type AuthUser } from "@features/auth/api/client";

export interface UserMenuProps {
  /**
   * `undefined` — спросить у сервера, `null` — точно гость.
   *
   * Разница принципиальна: `null` как начальное значение показал бы
   * «Войти» вошедшему человеку на долю секунды.
   */
  user?: { name: string; email: string; image: string | null } | null;
}

/**
 * Что показать: `undefined` — ответа ещё нет, `null` — гость.
 *
 * Три состояния, а не два, потому что «не знаю» нельзя приравнивать ни к
 * гостю, ни к пользователю: первое даёт мигание «Войти», второе —
 * мигание имени.
 */
type Shown = { name: string; email: string; image: string | null } | null | undefined;

export function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();
  const [fetched, setFetched] = useState<AuthUser | null | undefined>(
    user === undefined ? undefined : null,
  );
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user !== undefined) return;
    let alive = true;
    void getCurrentUser().then((u) => {
      if (alive) setFetched(u);
    });
    return () => {
      alive = false;
    };
  }, [user]);

  /**
   * Закрытие по клику вне меню и по Escape.
   *
   * Без этого меню остаётся открытым после перехода по ссылке или клика
   * в любое другое место, и висит поверх страницы.
   */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown: Shown =
    user !== undefined
      ? user
      : fetched === undefined
        ? undefined
        : fetched && !fetched.isAnonymous
          ? { name: fetched.name, email: fetched.email, image: fetched.image }
          : null;

  // Ответа ещё нет — держим место под кнопку, чтобы шапка не дёргалась
  if (shown === undefined) {
    return <span className="h-8 w-20" aria-hidden />;
  }

  /**
   * Гость и аноним — одно и то же с точки зрения шапки.
   *
   * У анонима есть сессия, но нет своей организации: кабинет ему ничего
   * не даст, а регистрация — да. Показывать ему «имя и аватар» значило бы
   * вести в тупик.
   */
  if (!shown) {
    return (
      <Link prefetch={true} href="/login" className="btn-secondary gap-1.5 px-3 py-1.5 text-xs sm:text-sm">
        <LogIn className="h-3.5 w-3.5" aria-hidden />
        Войти
      </Link>
    );
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onPointerEnter={() => router.prefetch("/account")}
        onFocus={() => router.prefetch("/account")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Аккаунт: ${shown.name}. Открыть меню`}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
      >
        <Avatar image={shown.image} name={shown.name} size={30} />
        {/*
          Имя скрываем на узких экранах: в шапке уже есть логотип и
          действия, и «Артём Симонов» вытеснило бы кнопку загрузки сметы.
          Аватар остаётся, а имя целиком видно в открытом меню.
        */}
        <span className="hidden max-w-[14ch] truncate font-medium sm:inline">
          {shown.name}
        </span>
        <ChevronDown
          className={`hidden h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform sm:block ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate text-sm font-medium text-slate-900">{shown.name}</p>
            <p className="mt-0.5 truncate text-xs text-slate-500">{shown.email}</p>
          </div>
          <Link
            prefetch={true} href="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-3 text-sm text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Settings className="h-4 w-4 text-slate-500" aria-hidden />
            Настройки аккаунта
          </Link>
        </div>
      )}
    </div>
  );
}