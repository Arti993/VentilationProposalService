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

export async function POST(request: Request): Promise<Response> {
  // Зависшие транзакции от прошлых обрывов душат базу и вызывают новые
  // обрывы. Убираем их перед работой — это лёгкий запрос, а цена
  // бездействия измеряется часами разбирательств.
  void reapStaleTransactions();

  // Тело нужно прочитать дважды — запоминаем до передачи обработчику
  const body = await request.clone().text();

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
