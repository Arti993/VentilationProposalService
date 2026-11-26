"use client";

/**
 * Форма входа и регистрации.
 *
 * Одна форма на два режима, а не две отдельные страницы: разница между
 * «войти» и «зарегистрироваться» — два поля и одна ссылка. Отдельные
 * страницы заставляли бы человека, ошибшегося вкладкой, вводить почту
 * заново.
 *
 * ОШИБКИ ПОКАЗЫВАЕМ ТЕКСТОМ, А НЕ КОДОМ
 *
 * «HTTP 422» ничего не говорит человеку. Переводим частые случаи:
 * занятый адрес, короткий пароль, неверный пароль. Остальное — общей
 * фразой и в консоль, чтобы не пугать пользователя техническим.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { signIn, signUp, signInAnonymous } from "../api/client";

type Mode = "signin" | "signup";

export function AuthForm({ initialMode = "signin" }: { initialMode?: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  /**
   * Повтор пароля при регистрации.
   *
   * Зачем, если пароль и так проверяется на длину: опечатка в одном
   * символе при регистрации создаёт аккаунт, в который человек не может
   * войти — и узнаёт об этом уже после того, как данные привязаны к
   * организации. Повтор ловит опечатку до создания аккаунта, когда
   * исправить ещё ничего не стоит.
   */
  const [passwordConfirm, setPasswordConfirm] = useState("");

  /**
   * Показывать ли введённые символы.
   *
   * По умолчанию пароль скрыт — это ожидаемое поведение и защита от
   * взгляда через плечо. Глазок нужен для другого: на телефоне с
   * автоисправлением легко не заметить, что пароль набран не в той
   * раскладке. Один клик — и видно.
   *
   * Один переключатель на оба поля: человек, который проверяет пароль,
   * делает это сразу в обоих.
   */
  const [showPassword, setShowPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Переводит ответ сервера в понятную фразу.
   *
   * Отдельно обрабатываем два случая из `api/auth/[...all]/route.ts`:
   *
   * `CREATED_NEEDS_LOGIN` — аккаунт создан, но ответ потерялся на пути.
   * Человеку не надо регистрироваться снова: надо войти. Иначе он
   * упрётся в «адрес занят» на собственный аккаунт.
   *
   * `SIGNUP_RETRY` — регистрация не состоялась, данных не осталось.
   * Можно пробовать ещё раз без опасений.
   */
  function humanError(raw: string): string {
    const lower = raw.toLowerCase();
    if (lower.includes("аккаунт создан") || lower.includes("войдите с тем же")) {
      return "Аккаунт уже создан — войдите с тем же паролем. Переключаю на вход…";
    }
    if (lower.includes("already exists") || lower.includes("уже существует")) {
      return "Этот адрес уже зарегистрирован — войдите.";
    }
    if (lower.includes("invalid password") || lower.includes("неверный пароль")) {
      return "Неверный пароль. Попробуйте ещё раз.";
    }
    if (lower.includes("invalid email") || lower.includes("user not found")) {
      return "Не нашли аккаунт с таким адресом. Проверьте написание или зарегистрируйтесь.";
    }
    if (lower.includes("password") && lower.includes("8")) {
      return "Пароль должен быть не короче 8 символов.";
    }
    return "Не удалось выполнить вход. Попробуйте ещё раз.";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes("@")) {
      setError("Проверьте адрес электронной почты.");
      return;
    }
    if (password.length < 8) {
      setError("Пароль должен быть не короче 8 символов.");
      return;
    }
    if (mode === "signup" && name.trim().length < 2) {
      setError("Укажите имя — его видно в документах.");
      return;
    }
    /**
     * Пароли сверяем ДО запроса к серверу: если они разошлись, аккаунт
     * создавать не надо вовсе. Сервер о такой проверке ничего не знает —
     * второе поле существует только здесь.
     */
    if (mode === "signup" && password !== passwordConfirm) {
      setError("Пароли не совпадают. Проверьте, нет ли опечатки.");
      return;
    }

    setBusy(true);
    try {
      const result =
        mode === "signin"
          ? await signIn(cleanEmail, password)
          : await signUp(name.trim(), cleanEmail, password);

      if (!result.ok) {
        const message = humanError(result.error);
        setError(message);

        // Аккаунт уже создан, остался только вход. Переключаем режим
        // сами: человеку не надо соображать, что делать дальше, — поля
        // уже заполнены, достаточно нажать «Войти».
        if (message.includes("Переключаю на вход")) {
          setMode("signin");
        }
        return;
      }

      // Полная перезагрузка, а не router.push: cookie сессии уже стоит,
      // и нужен свежий рендер серверных компонентов с новым пользователем
      router.refresh();
      window.location.assign("/app");
    } finally {
      setBusy(false);
    }
  }

  async function tryAnonymous() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await signInAnonymous();
      if (!r.ok) {
        setError(humanError(r.error));
        return;
      }
      window.location.assign("/app");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {mode === "signin" ? "Вход" : "Регистрация"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {mode === "signin"
            ? "Сметы, журнал КП и прайс привязаны к вашей организации."
            : "Создадим личный кабинет и вашу организацию — прайс и сметы будут только вашими."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          {mode === "signup" && (
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-700">
                Имя
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
                placeholder="Как к вам обращаться"
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              Почта
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
              placeholder="manager@company.ru"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Пароль
            </label>
            {/*
              Кнопка-глазок внутри поля, а не рядом с ним: так она не
              сдвигает соседние элементы и остаётся в зоне внимания.
              `type="button"` обязателен — иначе она отправит форму.
            */}
            <div className="relative mt-1.5">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-slate-300 py-2.5 pl-3 pr-11 text-slate-900 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
                placeholder="Не короче 8 символов"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-500 transition-colors hover:text-slate-900"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>
          </div>

          {mode === "signup" && (
            <div>
              <label
                htmlFor="password-confirm"
                className="block text-sm font-medium text-slate-700"
              >
                Повторите пароль
              </label>
              <div className="relative mt-1.5">
                <input
                  id="password-confirm"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className="block w-full rounded-lg border border-slate-300 py-2.5 pl-3 pr-11 text-slate-900 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
                  placeholder="Ещё раз тот же пароль"
                />
                {/*
                  Второй глазок не нужен: он переключал бы то же самое
                  состояние и выглядел бы как отдельная настройка. Но
                  место справа оставляем — иначе поле окажется на 11
                  пикселей короче соседнего и форма поедет.
                */}
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-700 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {mode === "signin" ? "Войти" : "Зарегистрироваться"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-600">
          {mode === "signin" ? (
            <>
              Нет аккаунта?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                  // Поле повтора пришло из другого режима пустым — иначе
                  // в нём остался бы прошлый пароль и «не совпадает»
                  setPasswordConfirm("");
                }}
                className="font-medium text-accent-700 hover:underline"
              >
                Зарегистрироваться
              </button>
            </>
          ) : (
            <>
              Уже есть аккаунт?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                  setPasswordConfirm("");
                }}
                className="font-medium text-accent-700 hover:underline"
              >
                Войти
              </button>
            </>
          )}
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm leading-relaxed text-slate-600">
          Хотите просто посмотреть, как это работает? Демо не требует регистрации.
        </p>
        <button
          type="button"
          onClick={tryAnonymous}
          disabled={busy}
          className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-100 disabled:opacity-60"
        >
          Попробовать на демо-прайсе
        </button>
      </div>
    </div>
  );
}
