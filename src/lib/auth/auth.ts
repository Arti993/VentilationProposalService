/**
 * Конфигурация Better Auth.
 *
 * ПОЧЕМУ BETTER AUTH, А НЕ CLERK ИЛИ NEXTAUTH
 *
 *  - Clerk хранит пользователей у себя: для проекта про изоляцию данных
 *    это лишняя зависимость, и на бесплатном тарифе есть лимит MAU.
 *  - NextAuth (Auth.js) умеет вход, но не умеет организаций — их пришлось
 *    бы строить руками поверх.
 *  - Better Auth держит данные в нашем Postgres, работает с Drizzle,
 *    из коробки даёт организации, приглашения, анонимные аккаунты и
 *    2FA. Лицензия MIT, в 2026 куплен Vercel — под этот хостинг
 *    естественный выбор.
 *
 * ЧТО ВКЛЮЧЕНО
 *
 *  - email + пароль (база для обоих рынков);
 *  - анонимные аккаунты (плагин anonymous): работодатель должен увидеть
 *    продукт без регистрации. При регистрации данные переносятся в
 *    полный аккаунт;
 *  - организации (плагин organization): данные привязаны к `org_id`,
 *    чтобы «компания с менеджерами» добавилась без миграции данных.
 *
 * ЧЕГО НАМЕРЕННО НЕТ
 *
 *  - OAuth-провайдеров (Яндекс, VK, Google, Telegram): для каждого нужны
 *    ключи приложения, которых у владельца проекта пока нет. Добавляются
 *    в `socialProviders` без изменения остального кода.
 *  - Отправки писем: без SMTP подтверждение адреса не работает, поэтому
 *    `requireEmailVerification` выключен. Включается, когда появится
 *    почтовый провайдер.
 */

import { betterAuth } from "better-auth";
import { organization, anonymous } from "better-auth/plugins";
import { isolatedDrizzleAdapter } from "@/db/auth-adapter";
import { ensurePersonalOrganization } from "@/lib/auth/organization";

/**
 * Секрет подписи сессий.
 *
 * В продакшене обязателен и должен быть длинным: с ним можно подделать
 * cookie. В dev допускаем запасное значение, чтобы проект запускался
 * сразу после клонирования, но громко предупреждаем: на проде такое
 * значение — дыра.
 */
function resolveSecret(): string {
  const fromEnv = process.env.BETTER_AUTH_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "BETTER_AUTH_SECRET не задан или короче 32 символов. " +
        "Сгенерируйте: openssl rand -base64 32",
    );
  }

  console.warn(
    "[auth] BETTER_AUTH_SECRET не задан — использую временный ключ разработки. " +
      "Сессии перестанут работать после перезапуска.",
  );
  return "dev-only-insecure-secret-change-me-32chars";
}

/**
 * Базовый адрес приложения.
 *
 * Нужен, чтобы ссылки в письмах и OAuth-редиректы вели куда надо.
 * На Vercel переменная VERCEL_URL меняется на каждый деплой, поэтому
 * для продакшена берём постоянный адрес из NEXT_PUBLIC_SITE_URL.
 */
function resolveBaseUrl(): string | undefined {
  const explicit = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const auth = betterAuth({
  // Адаптер без явных транзакций: вторая запись внутри транзакции рвёт
  // канал до Neon, из-за чего регистрация оставляла пользователя без
  // пароля. Подробный разбор и замеры — docs/INCIDENT-SIGNUP.md.
  database: isolatedDrizzleAdapter(),

  secret: resolveSecret(),
  baseURL: resolveBaseUrl(),
  /** Доверяем только своему адресу: иначе cookie уйдёт на чужой домен */
  trustedOrigins: [
    "http://localhost:3000",
    ...(process.env.NEXT_PUBLIC_SITE_URL ? [process.env.NEXT_PUBLIC_SITE_URL] : []),
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
  ],

  emailAndPassword: {
    enabled: true,
    /**
     * 8 символов — минимум, который ещё не бесит. Сложные требования
     * («заглавная, цифра, спецсимвол») на практике дают «Password1!» у
     * половины пользователей и ничего не добавляют к защите: длину
     * важнее сложности.
     */
    minPasswordLength: 8,
    /**
     * Подтверждение адреса выключено: нужен почтовый провайдер, которого
     * пока нет. Без подтверждения остаётся риск регистрации на чужой
     * адрес, но доступа к чужим данным это не даёт — данные привязаны
     * к организации, а не к адресу.
     */
    requireEmailVerification: false,
  },

  session: {
    /** 7 дней: неделя работы без повторного входа */
    expiresIn: 60 * 60 * 24 * 7,
    /** Обновлять раз в сутки — иначе сессия не продлевается */
    updateAge: 60 * 60 * 24,
    cookieCache: {
      /** Кэш cookie на 5 минут: экономит запрос к базе на каждый рендер */
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  /**
   * Хуки базы.
   *
   * ЗАЧЕМ
   *
   * Плагин organization создаёт организацию только по явному запросу
   * (`organization.create`). При регистрации пользователь оставался без
   * организации, `getActor` возвращал orgId = null, и дальше всё
   * работает в демо-практике — то есть данные смешивались с чужими.
   *
   * Создаём организацию сразу после регистрации: человек регистрируется
   * и попадает в свою «компанию», даже если она у него одна.
   */
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          // Анонимам организацию не создаём: они работают в демо-прайсе
          if (createdUser.isAnonymous) return;

          try {
            await ensurePersonalOrganization(createdUser.id, createdUser.name);
          } catch (e) {
            // Регистрация не должна падать из-за этого: без организации
            // пользователь попадёт в демо-прайс, что хуже, но не смертельно.
            console.error(
              "[auth] не удалось создать организацию:",
              e instanceof Error ? e.message : e,
            );
          }
        },
      },
    },
  },

  plugins: [
    /**
     * Организации. `creatorRole` — при создании организации автор
     * становится владельцем, а не просто участником.
     */
    organization({
      /** Лимит организаций на пользователя: защита от скриптов */
      organizationLimit: 5,
      /**
       * Создавать организацию автоматически при регистрации.
       *
       * Без этого пользователь появлялся без организации, и все данные
       * падали в демо-прайс — то есть были видны всем. Проверка
       * владельца при этом пропускала чужие сметы.
       *
       * Анонимные аккаунты сюда не попадают: они создаются через свой
       * плагин, и `isAnonymous` у них помечен.
       */
      allowUserToCreateOrganization: true,
    }),

    /**
     * Анонимные аккаунты. Кнопка «попробовать без регистрации».
     *
     * `onLinkAccount` выполняется, когда анонимный пользователь
     * регистрируется: здесь переносим его данные в полный аккаунт.
     */
    anonymous({
      /** Через сколько удалять брошенные анонимные аккаунты */
      emailDomainName: "anon.local",
    }),
  ],

  advanced: {
    /**
     * Имя cookie с префиксом проекта. По умолчанию `better-auth.session_token`,
     * и на одном домене с другими сервисами получилась бы коллизия.
     */
    cookiePrefix: "kp",
    /**
     * За прокси Vercel настоящий IP приходит в заголовке. Без этого
     * Better Auth увидит адрес прокси и лимиты по IP станут бесполезны.
     */
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
    },
  },
});

export type Auth = typeof auth;
