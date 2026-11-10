/**
 * Конфиг Next.js.
 *
 * Важно для деплоя на Vercel: демо-сметы (.txt/.csv) импортируются как
 * строки. Это требует правила webpack с asset/source — без него сборка
 * упадёт на «Module parse failed».
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },

  // Пакеты с нативными/динамическими зависимостями не бандлим:
  // LangChain подгружает провайдеров в рантайме, и бандлер это ломает.
  serverExternalPackages: ["@langchain/openai", "@langchain/langgraph", "langsmith"],

  webpack(config) {
    // Текстовые файлы — как строки, а не как модули.
    // Нужно для демо-смет: на Vercel нельзя читать их с диска в рантайме.
    config.module.rules.push({
      test: /\.(txt|csv)$/,
      type: "asset/source",
    });
    return config;
  },
};

export default nextConfig;
