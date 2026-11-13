import Link from "next/link";
import { Logo } from "@shared/ui/Logo";

const COLUMNS = [
  {
    title: "Продукт",
    links: [
      { href: "#how", label: "Как работает" },
      { href: "#features", label: "Возможности" },
      { href: "#precision", label: "Точность" },
      { href: "/app", label: "Открыть приложение" },
    ],
  },
  {
    title: "Технологии",
    links: [
      { href: "#stack", label: "Стек" },
      { href: "#faq", label: "Вопросы" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              Коммерческое предложение по смете клиента за секунды. Цены — только
              из прайса: лучше оставить позицию без цены, чем назвать неверную.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                {col.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    {l.href.startsWith("/") ? (
                      <Link
                        href={l.href}
                        className="text-sm text-slate-600 transition-colors hover:text-accent-600"
                      >
                        {l.label}
                      </Link>
                    ) : (
                      <a
                        href={l.href}
                        className="text-sm text-slate-600 transition-colors hover:text-accent-600"
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

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-slate-500">
            Демонстрационный проект. Прайс — вентиляционное оборудование, 215 позиций.
          </p>
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} Воздуховод
          </p>
        </div>
      </div>
    </footer>
  );
}
