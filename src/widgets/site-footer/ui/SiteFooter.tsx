import Link from "next/link";
import { Logo } from "@shared/ui/Logo";

/**
 * Подвал сайта.
 *
 * Колонки короткие и по делу: заказчику нужны переходы по странице и
 * вход в приложение, а не карта из двенадцати ссылок. Раздела
 * «Технологии» здесь нет — стек живёт в README.
 */
const COLUMNS = [
  {
    title: "Сервис",
    links: [
      { href: "#how", label: "Как работает" },
      { href: "#features", label: "Возможности" },
      { href: "#precision", label: "Точность" },
      { href: "#faq", label: "Вопросы" },
    ],
  },
  {
    title: "Начать",
    links: [
      { href: "/app", label: "Открыть приложение" },
      { href: "#how", label: "Форматы смет" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-7xl px-5 py-12 lg:px-8 lg:py-14">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr]">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              Коммерческое предложение по смете клиента за секунды. Цены — только
              из прайса: лучше оставить позицию без цены, чем назвать неверную.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                {col.title}
              </h2>
              <ul className="mt-4 space-y-1">
                {col.links.map((l) => (
                  <li key={`${col.title}-${l.href}-${l.label}`}>
                    {l.href.startsWith("/") ? (
                      <Link
                        href={l.href}
                        // -my-1 py-1: сама ссылка остаётся текстом, но
                        // зона нажатия растёт до 36px. На телефоне палец
                        // шириной 10 мм не попадает в строку высотой 19px
                        className="-my-1 inline-block py-1 text-sm text-slate-600 transition-colors hover:text-accent-700"
                      >
                        {l.label}
                      </Link>
                    ) : (
                      <a
                        href={l.href}
                        className="-my-1 inline-block py-1 text-sm text-slate-600 transition-colors hover:text-accent-700"
                      >
                        {l.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-slate-500">
            Демонстрационный проект. Прайс — вентиляционное оборудование.
          </p>
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} Расчёт стоимости
          </p>
        </div>
      </div>
    </footer>
  );
}
