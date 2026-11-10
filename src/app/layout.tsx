import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "КП по смете — вентиляционное оборудование",
  description:
    "Загрузите смету клиента и получите коммерческое предложение: позиции сопоставляются с прайсом, цена ставится только при однозначном совпадении.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
