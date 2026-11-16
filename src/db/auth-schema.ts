/**
 * Схема авторизации.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ В ОБЩЕМ schema.ts
 *
 * Эти таблицы не принадлежат домену «смета → КП». Они принадлежат
 * библиотеке Better Auth, которая читает и пишет их сама: имена колонок
 * и типы должны совпадать с её ожиданиями байт в байт. Смешивать
 * генерируемую схему с рукописной в одном файле — значит гарантировать,
 * что при обновлении библиотеки кто-то поправит не то поле.
 *
 * МОДЕЛЬ: организация, а не пользователь
 *
 * Данные привязаны к `org_id`, а не к `user_id`. Это решение из ревью, и
 * оно про будущее: сегодня у каждого свой прайс и свои сметы, но
 * «компания с тремя менеджерами» на такой схеме добавляется без
 * миграции данных. При регистрации создаётся личная организация, и
 * пользователь в ней — владелец.
 *
 * Выбранная организация в интерфейсе — это КОНТЕКСТ, а не
 * доказательство доступа. Права проверяются на сервере в каждом
 * запросе: иначе подмена одного поля в запросе открыла бы чужие данные.
 */

import { pgTable, text, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";

/** Пользователь. Таблица Better Auth, имя и поля фиксированы. */
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    /** Подтверждён ли адрес. Неподтверждённым — ограниченный доступ. */
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    /** Анонимный аккаунт: создаётся кнопкой «попробовать без регистрации» */
    isAnonymous: boolean("is_anonymous").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("user_email_uq").on(t.email)],
);

/** Сессия. Одна активная сессия — одна строка. */
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    /** Когда истекает. Пользователь может отозвать сессию досрочно. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Организация, выбранная в этой сессии — контекст, не разрешение */
    activeOrganizationId: text("active_organization_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("session_token_uq").on(t.token),
    index("session_user_idx").on(t.userId),
  ],
);

/** Способ входа: пароль, OAuth-провайдер, passkey. */
export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    /** Идентификатор пользователя у провайдера (для OAuth) */
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** Хеш пароля. NULL для OAuth — там пароля нет. */
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("account_user_idx").on(t.userId),
    index("account_provider_idx").on(t.providerId, t.accountId),
  ],
);

/** Одноразовый код проверки: подтверждение адреса, вход по коду. */
export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/**
 * Организация — владелец данных.
 *
 * У каждого пользователя при регистрации создаётся личная организация.
 * Сметы, прайсы и журнал КП ссылаются на неё, а не на пользователя.
 */
export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    /** Реквизиты для шаблона КП: ИНН, адрес, подпись */
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("organization_slug_uq").on(t.slug)],
);

/**
 * Участник организации.
 *
 * `role`: owner | admin | member. Проверять права нужно на сервере по
 * этой таблице, а не по тому, что клиент прислал в запросе.
 */
export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("member_org_idx").on(t.organizationId),
    index("member_user_idx").on(t.userId),
    // Один человек — один участник в организации
    uniqueIndex("member_org_user_uq").on(t.organizationId, t.userId),
  ],
);

/** Приглашение в организацию. */
export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Когда приглашение создано: нужно для сортировки и для срока */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invitation_org_idx").on(t.organizationId),
    index("invitation_email_idx").on(t.email),
  ],
);
