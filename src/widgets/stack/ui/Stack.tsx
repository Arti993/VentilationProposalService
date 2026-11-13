/**
 * Технологический стек.
 *
 * Зачем это на лендинге: решение принимает не только менеджер, а ещё и
 * технический директор, которому важно «на чём сделано». Короткий ряд
 * названий отвечает на этот вопрос без отдельной страницы.
 *
 * Текстом, а не логотипами: чужие логотипы требуют лицензии и выглядят
 * как реклама чужих продуктов.
 */
const STACK = [
  { group: "Платформа", items: ["Next.js 15", "React 19", "TypeScript"] },
  { group: "Данные", items: ["PostgreSQL", "Pgvector", "Drizzle ORM"] },
  { group: "Искусственный интеллект", items: ["LangChain", "LangGraph", "LangSmith"] },
  { group: "Инфраструктура", items: ["Vercel", "n8n", "GitHub Actions"] },
];

export function Stack() {
  return (
    <section id="stack" className="border-t border-slate-200 bg-slate-900 py-24 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-400">
              Технологии
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Собрано на проверенном стеке
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-400">
              Никаких самописных велосипедов: каждая часть — стандартное решение,
              которое легко поддерживать и передать другой команде.
            </p>
          </div>

          <div className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
            {STACK.map((s) => (
              <div key={s.group}>
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {s.group}
                </h3>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {s.items.map((i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5
                                 text-xs font-medium text-slate-300"
                    >
                      {i}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
