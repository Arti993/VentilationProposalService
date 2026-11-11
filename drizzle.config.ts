/**
 * Конфиг Drizzle Kit: генерация и применение миграций.
 *
 * Схема описана в TypeScript, миграции генерируются в SQL.
 * Так изменения БД попадают в репозиторий и ревьюятся как код.
 */
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
} satisfies Config;
