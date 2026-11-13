import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "КП по смете — коммерческое предложение за минуту",
    template: "%s · Воздуховод",
  },
  description:
    "Загрузите смету клиента и получите коммерческое предложение: каждая позиция сопоставляется с прайсом, цена ставится только при однозначном совпадении.",
  applicationName: "Воздуховод",
  keywords: [
    "коммерческое предложение",
    "смета",
    "прайс",
    "вентиляционное оборудование",
    "автоматизация",
  ],
  openGraph: {
    title: "КП по смете — коммерческое предложение за минуту",
    description:
      "Позиции сметы сопоставляются с прайсом автоматически. Цена — только при однозначном совпадении.",
    type: "website",
    locale: "ru_RU",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-white antialiased">{children}</body>
    </html>
  );
}
