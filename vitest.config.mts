/**
 * Vitest для юнит-тестов чистых функций.
 *
 * ПОЧЕМУ ВИТЕСТ, А НЕ ЗАМЕНА СКРИПТАМ
 *
 * Часть проверок остаётся в `scripts/*.ts`, и это правильно: они бьют по
 * живому серверу и базе, проверяют HTTP-контракты и сквозные сценарии.
 * Vitest для такого не годится — ему нужен сервер, и он не должен
 * поднимать инфраструктуру в CI.
 *
 * Здесь же только то, что проверяется без окружения: парсеры, нормализация,
 * матчер, синонимы. Такие тесты запускаются за секунды, гоняются на каждый
 * PR и не падают от сетевой ошибки Neon (см. docs/INCIDENT-SIGNUP.md).
 *
 * РАЗДЕЛЕНИЕ ПРОСТОЕ
 *
 *   `*.test.ts`       — чистые функции, без сети и базы (Vitest)
 *   `scripts/test-*`  — живые сценарии через HTTP (node --env-file)
 *
 * ПОЧЕМУ АЛИАСЫ ДУБЛИРУЮТСЯ
 *
 * Vitest не читает `paths` из tsconfig автоматически: он разрешает
 * импорты своим резолвером. Без этих строк `@/lib/...` в тесте упадёт
 * «Cannot find module», хотя `tsc` тот же импорт принимает. Дублирование
 * здесь неизбежно, но список короткий и меняется редко.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

const root = path.resolve(import.meta.dirname);

export default defineConfig({
  // Next.js сохраняет JSX для сборки; тестам серверных страниц нужен готовый JS.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    /** Только юниты. Сквозные сценарии живут в scripts/ и запускаются отдельно. */
    include: ["src/**/*.test.ts"],

    /**
     * Node, а не jsdom: тестируем серверную логику. Для UI понадобится
     * отдельный проект с jsdom или Playwright — это следующий шаг.
     */
    environment: "node",

    /**
     * 10 секунд вместо 5: некоторые тесты матчера прогоняют весь демо-прайс.
     * На холодной машине это дольше пяти секунд, и тест падал бы по
     * таймауту, а не по существу.
     */
    testTimeout: 10_000,

    /** Явный отчёт: в CI видно, какой тест упал, по имени файла и строке. */
    reporters: ["default"],
  },
  resolve: {
    /**
     * Альias `@/*` указывает на `src`, а НЕ на корень проекта — как в
     * tsconfig. Первая версия этого конфига мапила `@` в корень, и
     * `@/lib/matcher/synonyms` искался в `./lib/...`, то есть мимо.
     *
     * Порядок важен: точные префиксы (`@shared/*`) должны идти раньше
     * общего `@/*`, иначе `@shared/ui/Logo` разрешится как `src/shared/...`
     * через общее правило и потеряет часть пути.
     */
    alias: [
      { find: /^@\/(.*)$/, replacement: path.resolve(root, "src/$1") },
      { find: /^@app\/(.*)$/, replacement: path.resolve(root, "src/app/$1") },
      { find: /^@views\/(.*)$/, replacement: path.resolve(root, "src/views/$1") },
      { find: /^@widgets\/(.*)$/, replacement: path.resolve(root, "src/widgets/$1") },
      { find: /^@features\/(.*)$/, replacement: path.resolve(root, "src/features/$1") },
      { find: /^@entities\/(.*)$/, replacement: path.resolve(root, "src/entities/$1") },
      { find: /^@shared\/(.*)$/, replacement: path.resolve(root, "src/shared/$1") },
    ],
  },
});
