/**
 * Объявления для не-TS импортов.
 *
 * Next.js перезаписывает next-env.d.ts при каждой сборке, поэтому
 * свои объявления держим здесь — иначе они пропадут.
 */
declare module "*.css";
declare module "*.scss";

/**
 * Текстовые файлы импортируются как строки.
 *
 * Нужно для демо-смет: они встраиваются в бандл на этапе сборки, а не
 * читаются с диска. На Vercel файловая система функции read-only и не
 * содержит файлов репозитория — fs.readFileSync там не сработает.
 */
declare module "*.txt" {
  const content: string;
  export default content;
}

declare module "*.csv" {
  const content: string;
  export default content;
}
