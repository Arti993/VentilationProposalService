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
      // Метрики — не украшение: это единственный способ проверить
      // слова «работает точно» числами, а не обещанием
      { href: "/status", label: "Как работает сервис в цифрах" },
      // MCP — самая заметная для разработчика возможность: сервис
      // работает прямо внутри Claude и Cursor
      { href: "/mcp", label: "MCP-сервер" },
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
                        prefetch={true} href={l.href}
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

        <div className="mt-10 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-slate-500">
            Подключён демо-прайс по вентиляционному оборудованию. Загрузите свой
            прайс — сметы будут считаться по вашим ценам.
          </p>
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} Расчёт стоимости
          </p>
        </div>

        {/*
          Ссылки на исходники и автора.

          ЗАЧЕМ ОТДЕЛЬНОЙ СТРОКОЙ

          Ревьюер проекта должен за пять секунд понять, чья это работа.
          Ссылка «в подвале среди прочих» этого не даёт: нужна отдельная
          строка с прямым текстом. Это же место — единственный путь к
          документации ARCHITECTURE.md, который читают на собеседовании.

          `rel="noopener noreferrer"` обязателен для `target="_blank"`:
          без `noopener` открытая страница получает доступ к `window.opener`
          и может увести исходную вкладку на фишинг.
        */}
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <a
            href="https://github.com/Arti993/VentilationProposalService"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 transition-colors hover:text-accent-700"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            Исходный код на GitHub
          </a>
          <span className="text-xs text-slate-500">
            Автор —{" "}
            <a
              href="https://github.com/Arti993"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-slate-700 transition-colors hover:text-accent-700"
            >
              Артём Симонов
            </a>
          </span>
          <a
            href="https://github.com/Arti993/VentilationProposalService/blob/main/docs/ARCHITECTURE.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-500 transition-colors hover:text-accent-700"
          >
            Как это устроено внутри
          </a>
        </div>
      </div>
    </footer>
  );
}
