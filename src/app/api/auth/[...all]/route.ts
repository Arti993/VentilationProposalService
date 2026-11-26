/**
 * Эндпоинты авторизации.
 *
 * Better Auth сам разбирает путь внутри `/api/auth/*` — мы только
 * передаём ему запрос. Отдельных обработчиков для «войти», «выйти»,
 * «зарегистрировать» писать не нужно: библиотека уже содержит их и
 * следит за корректностью cookie, CSRF и валидацией.
 *
 * `runtime = "nodejs"`: адаптер Drizzle работает с драйвером postgres,
 * который не живёт в edge-рантайме.
 *
 * ПОЧЕМУ POST ОБЁРНУТ
 *
 * Регистрация идёт в транзакции (запись в `user`, затем в `account`).
 * Канал до Neon теряет ответ у части транзакций уже после `COMMIT`:
 * данные записаны, а клиент видит ошибку соединения. Разбор —
 * docs/INCIDENT-SIGNUP.md.
 *
 * Без обёртки человек получал 500, пробовал зарегистрироваться снова и
 * упирался в «адрес занят» на собственный аккаунт. Обёртка после ошибки
 * смотрит факт: создан ли пользователь на самом деле.
 */
import { auth } from "@/lib/auth/auth";
import { resolveSignUpFailure } from "@/lib/auth/signup";
import { reapStaleTransactions } from "@/db/reaper";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = "nodejs";

const handlers = toNextJsHandler(auth.handler);

export const GET = handlers.GET;

/**
 * Пределы для самостоятельного редактирования профиля.
 *
 * ПОЧЕМУ ПРОВЕРКА ЗДЕСЬ, А НЕ В КОМПОНЕНТЕ
 *
 * Кабинет сжимает аватар до 128×128 перед отправкой — но это забота
 * удобства, а не защиты. Запрос можно собрать руками и прислать картинку
 * на десять мегабайт: Better Auth сохранит любую строку в `user.image`, и
 * строка ляжет в базу навсегда. Проверка живёт перед библиотекой, потому
 * что после неё данные уже записаны.
 *
 * 200 КБ на data URL — это примерно 150 КБ картинки. С запасом больше
 * того, что даёт сжатие в кабинете (там выходит 6–15 КБ), и достаточно
 * мало, чтобы база не росла от одной аватарки.
 */
const PROFILE_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  imageMaxChars: 200_000,
} as const;

/** Разрешённые виды аватара: data URL картинки или обычная ссылка. */
function isAcceptableImage(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  if (value.length > PROFILE_LIMITS.imageMaxChars) return false;
  return /^data:image\/(png|jpe?g|webp);base64,/i.test(value) || /^https:\/\//i.test(value);
}

/** Возвращает текст ошибки или null, если профиль можно сохранять. */
function validateProfileUpdate(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Некорректный запрос.";
  }
  const { name, image } = body as { name?: unknown; image?: unknown };

  if (name !== undefined) {
    if (typeof name !== "string") return "Имя должно быть строкой.";
    const trimmed = name.trim();
    if (trimmed.length < PROFILE_LIMITS.nameMin) return "Имя слишком короткое.";
    if (trimmed.length > PROFILE_LIMITS.nameMax) return "Имя слишком длинное.";
  }

  if (image !== undefined && !isAcceptableImage(image)) {
    return "Аватар должен быть картинкой PNG, JPEG или WebP до 200 КБ.";
  }

  return null;
}

export async function POST(request: Request): Promise<Response> {
  // Зависшие транзакции от прошлых обрывов душат базу и вызывают новые
  // обрывы. Убираем их перед работой — это лёгкий запрос, а цена
  // бездействия измеряется часами разбирательств.
  void reapStaleTransactions();

  // Тело нужно прочитать дважды — запоминаем до передачи обработчику
  const body = await request.clone().text();

  /**
   * Правка профиля проверяется до библиотеки.
   *
   * Разбираем тело отдельно: у `/update-user` любое поле — произвольная
   * строка, и без этой проверки в `user.image` можно положить что угодно.
   */
  if (request.url.includes("/update-user")) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      return Response.json({ message: "Некорректный JSON." }, { status: 400 });
    }
    const problem = validateProfileUpdate(parsed);
    if (problem) return Response.json({ message: problem }, { status: 400 });
  }

  const response = await handlers.POST(request);

  // Штатные отказы (занятый адрес, короткий пароль) не трогаем:
  // там ничего не сломалось посреди пути.
  if (response.status < 500) return response;
  if (!request.url.includes("/sign-up/email")) return response;

  let email = "";
  try {
    email = (JSON.parse(body) as { email?: string }).email ?? "";
  } catch {
    return response;
  }
  if (!email) return response;

  const outcome = await resolveSignUpFailure(email);

  if (outcome.kind === "created-but-needs-login") {
    // Пользователь создан полностью — потерялся только ответ
    return Response.json(
      {
        code: "CREATED_NEEDS_LOGIN",
        message:
          "Аккаунт создан, но ответ не дошёл. Войдите с тем же паролем — всё на месте.",
      },
      { status: 409 },
    );
  }

  // `retry`: пользователя нет либо он был недописан и убран
  return Response.json(
    {
      code: "SIGNUP_RETRY",
      message:
        outcome.kind === "retry"
          ? outcome.reason
          : "Регистрация не завершилась. Попробуйте ещё раз.",
    },
    { status: 503 },
  );
}
