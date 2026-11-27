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
import { getActor } from "@/lib/auth/guard";
import { AuthForm } from "@features/auth";
import { HeaderBar, HeaderBrand } from "@shared/ui/HeaderLayout";

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
        <HeaderBar>
          <HeaderBrand />
        </HeaderBar>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        <AuthForm />
      </div>
    </main>
  );
}
