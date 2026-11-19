"use client";

/**
 * Кнопка входа / состояние пользователя в шапке приложения.
 *
 * ПОЧЕМУ ЭТОТ КОМПОНЕНТ ПОНАДОБИЛСЯ
 *
 * Страница `/login` существовала, но на неё не вела НИ ОДНА ссылка во всём
 * интерфейсе. Войти можно было, только зная адрес наизусть. Человек
 * пытался загрузить свой прайс, получал «Войдите или зарегистрируйтесь» —
 * и не мог понять, где это сделать.
 *
 * Работающий вход, о котором знает только автор, не работает.
 *
 * ПОЧЕМУ СОСТОЯНИЕ ПРИХОДИТ ПРОПСОМ, А НЕ ЗАПРАШИВАЕТСЯ
 *
 * Первая версия спрашивала `getCurrentUser()` в `useEffect` и до ответа
 * рисовала пустую заглушку. Результат: кнопка появлялась через
 * полсекунды после загрузки, а если сеть притормозила — заметно позже.
 * Для ссылки «Войти» это плохо: человек успевает решить, что входа нет.
 *
 * Теперь сервер (`/app`) уже знает, кто пришёл, и отдаёт это пропсом.
 * Кнопка есть в первом же HTML. Клиентское состояние нужно только после
 * выхода: разлогин происходит в браузере, и страницу надо перерисовать.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, LogOut } from "lucide-react";
import { signOut } from "../api/client";

export interface AuthButtonProps {
  /**
   * Кто пришёл — известно на сервере.
   *
   * `null` — гость. Анонимный пользователь тоже считается гостем: у него
   * есть сессия, но нет своей организации, поэтому своих прайсов нет.
   */
  user: { email: string; isAnonymous: boolean } | null;
}

export function AuthButton({ user }: AuthButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  /**
   * После выхода пользователь становится гостем — сразу, без ожидания
   * сервера. Иначе кнопка «Выйти» осталась бы на экране до перезагрузки,
   * и человек нажал бы её второй раз.
   */
  const [loggedOut, setLoggedOut] = useState(false);

  const logout = async () => {
    setBusy(true);
    try {
      await signOut();
      setLoggedOut(true);
      /**
       * `refresh()`, а не `push`: серверные компоненты читают куки через
       * `headers()`, и без обновления они остались бы с данными старой
       * сессии. Перезагружаем данные, не теряя состояние страницы —
       * загруженная смета на экране останется.
       */
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  /**
   * Гость или аноним.
   *
   * Аноним видит «Войти» намеренно: у него есть сессия, но нет своих
   * прайсов. С точки зрения пользы он гость, и ему нужен путь к
   * регистрации — иначе он упрётся в «демо-прайс менять нельзя» без
   * выхода из ситуации.
   */
  if (!user || user.isAnonymous || loggedOut) {
    return (
      <Link href="/login" className="btn-secondary gap-1.5 px-3 py-1.5 text-xs sm:text-sm">
        <LogIn className="h-3.5 w-3.5" aria-hidden />
        Войти
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/*
        Email обрезаем: длинный адрес растянул бы шапку и вытолкнул кнопку
        «Новая смета» за границу. Полный остаётся в `title` — при наведении
        видно целиком.
      */}
      <span
        className="hidden max-w-[16ch] truncate text-xs text-slate-500 sm:inline"
        title={user.email}
      >
        {user.email}
      </span>
      <button
        type="button"
        className="btn-secondary gap-1.5 px-3 py-1.5 text-xs sm:text-sm"
        onClick={logout}
        disabled={busy}
        aria-label="Выйти"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden />
        {/* На телефоне остаётся иконка: подпись занимает место, а смысл
            уже в aria-label */}
        <span className="hidden sm:inline">{busy ? "Выхожу…" : "Выйти"}</span>
      </button>
    </div>
  );
}
