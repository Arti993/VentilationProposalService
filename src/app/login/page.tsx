/**
 * Страница входа.
 *
 * Серверный компонент: если человек уже вошёл, отправляем в приложение —
 * незачем показывать форму тому, кто только что вышел из кабинета и
 * нажал «назад».
 *
 * `redirect` здесь, а не в клиенте: сессия читается на сервере, и
 * клиентский редирект дал бы вспышку формы у вошедшего пользователя.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { getActor } from "@/lib/auth/guard";
import { AuthForm } from "@features/auth";
import { Logo } from "@shared/ui/Logo";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Вход",
  description: "Вход в личный кабинет сервиса расчёта стоимости вентиляционного оборудования.",
};

/**
 * Страница всегда рендерится на сервере, а не при сборке.
 *
 * `getActor` читает cookie через `headers()`. На этапе сборки заголовков
 * нет, и Next пытался отрендерить страницу статически — отсюда ошибка
 * `Dynamic server usage` в логе сборки. Явное `dynamic` убирает и
 * ошибку, и бессмысленную попытку.
 */
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const actor = await getActor();
  if (actor?.userId) redirect("/app");

  return (
    <main className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" aria-label="На главную" className="shrink-0">
            <Logo />
          </Link>
          {/*
            На самых узких экранах (320px) логотип и подпись «На главную»
            не помещаются в ряд — текст скрываем до 400px. Смысл ссылки
            остаётся в aria-label, стрелка остаётся видимой.
            `sm:` (640px) — единственный мелкий брейкпоинт в проекте,
            поэтому используем его, а не новый `xs:`.
          */}
          <Link
            href="/"
            aria-label="На главную"
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span className="hidden min-[400px]:inline">На главную</span>
          </Link>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        <AuthForm />
      </div>
    </main>
  );
}
