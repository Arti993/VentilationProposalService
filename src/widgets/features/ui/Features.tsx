import { CheckCircle2, MessageSquareQuote, FileDown, Sparkles } from "lucide-react";
import { cn } from "@shared/lib/cn";

const FEATURES = [
  {
    icon: CheckCircle2,
    title: "Три уровня проверки",
    text: "Точное совпадение по ключу → поиск по смыслу → человек. Чем ниже уверенность, тем больше контроля.",
    wide: true,
  },
  {
    icon: MessageSquareQuote,
    title: "Ассистент по смете",
    text: "Спросите «почему позиция 12 без цены» — ответит, показав ход мысли и найденные варианты.",
  },
  {
    icon: FileDown,
    title: "Готовый DOCX",
    text: "Таблица, итоги, примечание о позициях без цены. Не нужно переносить цифры руками.",
  },
  {
    icon: Sparkles,
    title: "Работает со свободным текстом",
    text: "«воздух спиральный 315», «отвод девяносто на двести пятьдесят» — понимает, как менеджер.",
  },
];

/**
 * Сетка возможностей.
 *
 * Первая карточка занимает два столбца: в ней главное отличие —
 * трёхуровневая проверка. Визуальный вес совпадает со смысловым, иначе
 * посетитель прочитает четыре равных пункта и не запомнит ни один.
 */
export function Features() {
  return (
    <section id="features" className="border-t border-slate-200 bg-slate-50/60 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="max-w-2xl">
          <p className="eyebrow">Возможности</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Всё, чтобы не считать вручную
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            Сервис делает скучную часть работы — сверку позиций и арифметику.
            Решение по спорным позициям остаётся за человеком.
          </p>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <article
                key={f.title}
                className={cn(
                  "card-hover reveal p-7",
                  f.wide && "sm:col-span-2",
                )}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-50 ring-1 ring-inset ring-accent-600/10">
                  <Icon className="h-5 w-5 text-accent-600" aria-hidden />
                </div>
                <h3 className="mt-5 text-base font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.text}</p>

                {f.wide && (
                  // В широкой карточке — схема уровней вместо текста
                  <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                    {[
                      { n: "1", label: "Точный ключ", sub: "≈90% строк, 0 мс" },
                      { n: "2", label: "Поиск по смыслу", sub: "≈8% строк, <1 с" },
                      { n: "3", label: "Менеджер", sub: "≈2% строк" },
                    ].map((step, i) => (
                      <div key={step.n} className="flex flex-1 items-center gap-2">
                        <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-semibold text-accent-600 ring-1 ring-inset ring-accent-600/20">
                              {step.n}
                            </span>
                            <span className="text-xs font-medium text-slate-800">
                              {step.label}
                            </span>
                          </div>
                          <p className="mt-1 text-2xs text-slate-500">{step.sub}</p>
                        </div>
                        {i < 2 && (
                          <span className="hidden text-slate-300 sm:block" aria-hidden>
                            →
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
