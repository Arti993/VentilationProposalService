import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Корневой layout.
 *
 * Название бренда — «Вентиляционное оборудование. Расчёт стоимости».
 * Это не слоган, а описание: человек, который получил ссылку от коллеги,
 * должен понять по заголовку вкладки, что за сервис, не открывая его.
 *
 * Иконки лежат файлами в этой же папке (icon.svg, apple-icon.svg):
 * Next сам добавляет теги <link> в нужном порядке и формате. Прописывать
 * их в metadata вручную не нужно и даже вредно — получится два
 * конкурирующих набора, и браузер выберет не тот.
 */
export const metadata: Metadata = {
  // metadataBase нужен для абсолютных URL в openGraph: без него
  // соцсети не смогут показать превью, потому что относительные пути
  // они не разрешают
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://ventilation-proposal-service.vercel.app",
  ),
  title: {
    default: "Вентиляционное оборудование. Расчёт стоимости",
    // Подстраницы: сначала их название, потом бренд через точку,
    // как принято в русскоязычных каталогах
    template: "%s — Вентиляционное оборудование",
  },
  description:
    "Коммерческое предложение по смете клиента: каждая позиция сопоставляется с прайсом, цена ставится только при однозначном совпадении.",
  applicationName: "Вентиляционное оборудование",
  openGraph: {
    title: "Вентиляционное оборудование. Расчёт стоимости",
    description:
      "Смета клиента превращается в коммерческое предложение. Цены — только из прайса.",
    type: "website",
    locale: "ru_RU",
  },
  // Без явного robots Next отдаёт index,follow — оставляем как есть,
  // но фиксируем намеренно, чтобы это не было случайностью
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  // Цвет адресной строки на мобильном совпадает с фоном шапки:
  // строка сливается с сайтом, а не висит серой полосой
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  // Не блокируем масштабирование: людям со слабым зрением нужно
  // разглядывать таблицу с ценами
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-white antialiased">{children}</body>
    </html>
  );
}
