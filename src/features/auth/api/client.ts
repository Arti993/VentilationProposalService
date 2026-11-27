/**
 * Клиент авторизации.
 *
 * Тонкая обёртка над `better-auth/client`. Почему не используем SDK
 * напрямую в компонентах: у него одинаковые имена методов (`signIn`,
 * `signUp`) и разные формы вызова для разных плагинов. Обёртка держит
 * одну форму и в одном месте — если библиотека поменяет API, править
 * нужно здесь, а не в десяти компонентах.
 */

import { isAnonymousUser } from "@shared/lib/auth";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  isAnonymous: boolean;
  /** Аватар: data URL (после сжатия в кабинете) или ссылка. `null` — нет. */
  image: string | null;
}

export interface AuthError {
  message: string;
}

/**
 * Базовый адрес для запросов авторизации.
 *
 * На клиенте всегда относительный путь: `localhost` и прод-домен
 * отличаются, а `/api/auth` работает на обоих.
 */
const BASE = "/api/auth";

async function call(
  path: string,
  body: unknown,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const msg =
        (json as { message?: string; error?: string } | null)?.message ??
        (json as { error?: string } | null)?.error ??
        "Не удалось выполнить запрос. Попробуйте ещё раз.";
      return { ok: false, error: msg };
    }
    return { ok: true, data: json };
  } catch {
    return {
      ok: false,
      error: "Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.",
    };
  }
}

/** Текущий пользователь или null. Не бросает: гость — это нормальный случай. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${BASE}/get-session`, { credentials: "same-origin" });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      user?: {
        id: string;
        name: string;
        email: string;
        isAnonymous?: boolean | null;
        image?: string | null;
      };
    } | null;
    if (!json?.user) return null;
    return {
      id: json.user.id,
      name: json.user.name,
      email: json.user.email,
      isAnonymous: isAnonymousUser(json.user),
      image: json.user.image ?? null,
    };
  } catch {
    return null;
  }
}

/** Вход по email и паролю. */
export async function signIn(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await call("/sign-in/email", { email, password });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Регистрация. */
export async function signUp(
  name: string,
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await call("/sign-up/email", { name, email, password });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Выход. */
export async function signOut(): Promise<void> {
  await call("/sign-out", {});
}

/**
 * Обновление имени и аватара.
 *
 * ПОЧЕМУ ЧЕРЕЗ ЭНДПОИНТ БИБЛИОТЕКИ, А НЕ СВОЙ SQL
 *
 * `update-user` не просто пишет строку в `user`: он переставляет cookie
 * сессии с новыми данными. При включённом `cookieCache` сессия живёт в
 * подписанной cookie пять минут, и правка в базе без обновления cookie
 * означала бы «имя изменилось, но шапка показывает старое ещё пять
 * минут». Библиотека делает обе записи в одном месте — повторять это
 * руками значит однажды забыть вторую.
 */
export async function updateProfile(input: {
  name?: string;
  image?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await call("/update-user", input);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/**
 * Анонимный вход — «попробовать без регистрации».
 *
 * Создаёт временного пользователя. Работодатель, открывший ссылку из
 * резюме, не должен заполнять форму, чтобы увидеть продукт.
 */
export async function signInAnonymous(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const r = await call("/sign-in/anonymous", {});
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
