import Link from "next/link";
import { ArrowRight, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";

/** Контроль стоимости на каждом этапе подготовки предложения. */
const CONTROLS = [
  { value: "Прайс", label: "Источник цен", hint: "Стоимость берётся из прайса поставщика" },
  { value: "Проверка", label: "Спорные позиции", hint: "Варианты соответствия доступны менеджеру" },
  { value: "Расчёт", label: "Зафиксированные цены", hint: "Обновление прайса не меняет готовое КП" },
  { value: "Word", label: "Готовый документ", hint: "Таблица оборудования и итоговая стоимость" },
];

const LEVELS = [
  {
    icon: ShieldCheck,
    tone: "text-emerald-600 bg-emerald-50 ring-emerald-600/10",
    title: "Точное соответствие",
    text: "Найдена соответствующая позиция прайса. Цена подставляется в расчёт автоматически.",
  },
  {
    icon: ShieldAlert,
    tone: "text-amber-600 bg-amber-50 ring-amber-600/10",
    title: "Требуется проверка",
    text: "Найдено несколько вариантов. Менеджер проверяет параметры и выбирает подходящую позицию.",
  },
  {
    icon: ShieldX,
    tone: "text-rose-600 bg-rose-50 ring-rose-600/10",
    title: "Позиция не найдена",
    text: "Строка остаётся без цены и включается в список позиций, требующих уточнения.",
  },
];

export function Precision() {
  return (
    <section id="precision" className="relative overflow-hidden border-t border-slate-200 py-24 lg:py-32">
      {/* Тёмная половина: контраст с остальными секциями и акцент на главном */}
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid items-start gap-14 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="eyebrow">Принцип</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              Контроль цен <br /> перед отправкой КП
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-600">
              Каждая рассчитанная цена связана с позицией прайса. Строки без однозначного соответствия выделяются для проверки.
            </p>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              Проверьте спорные позиции и уточните отсутствующие цены перед отправкой предложения клиенту.
            </p>

            <div className="mt-9 grid grid-cols-2 gap-4">
              {CONTROLS.map((m) => (
                <div key={m.label} className="card p-5">
                  <p className="text-2xl font-semibold tracking-tight tabular text-slate-900">
                    {m.value}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-700">{m.label}</p>
                  <p className="mt-1 text-2xs leading-relaxed text-slate-500">{m.hint}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Правая колонка: три исхода */}
          <div className="space-y-3">
            {LEVELS.map((l) => {
              const Icon = l.icon;
              return (
                <div
                  key={l.title}
                  className="card reveal flex gap-4 p-6 transition-colors hover:border-slate-300"
                >
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${l.tone}`}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{l.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{l.text}</p>
                  </div>
                </div>
              );
            })}

            <Link
              prefetch={true} href="/app"
              className="group flex items-center justify-between rounded-2xl border border-accent-600/15
                         bg-accent-50/60 px-6 py-5 transition-colors hover:bg-accent-50"
            >
              <div>
                <p className="text-sm font-semibold text-accent-900">
                  Проверить на своей смете
                </p>
                <p className="mt-0.5 text-xs text-accent-700/80">
                  Загрузите файл или выберите пример
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-accent-600 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
