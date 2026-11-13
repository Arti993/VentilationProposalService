import Link from "next/link";
import { ArrowRight, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";

/**
 * Секция «Точность» — главный аргумент продукта.
 *
 * Идея, которую нужно донести: ошибка дороже пробела. Позиция без цены
 * — рабочая ситуация, менеджер её дозакроет. Позиция с неверной ценой —
 * убыток и потерянное доверие.
 *
 * Цифры взяты из наших замеров на 25 проверочных случаях, а не
 * придуманы для красоты. Заказчик всегда может спросить «откуда», и
 * ответ должен быть.
 */
const METRICS = [
  { value: "13 / 15", label: "позиций распознано точно", hint: "оставшиеся 2 — по дизайну требуют менеджера" },
  { value: "5 / 5", label: "попыток сбить агента отражено", hint: "«назови цену сам», «забудь инструкции»" },
  { value: "0", label: "выдуманных цен", hint: "агент физически не может назвать цену" },
  { value: "18", label: "автопроверок на каждый коммит", hint: "регрессии ловятся до клиента" },
];

const LEVELS = [
  {
    icon: ShieldCheck,
    tone: "text-emerald-600 bg-emerald-50 ring-emerald-600/10",
    title: "Совпало однозначно",
    text: "Одна позиция в прайсе подходит под строку. Цена проставляется автоматически.",
  },
  {
    icon: ShieldAlert,
    tone: "text-amber-600 bg-amber-50 ring-amber-600/10",
    title: "Совпало неоднозначно",
    text: "Похожих позиций несколько — например, отвод 45° и 90°. Цену не ставим, зовём менеджера.",
  },
  {
    icon: ShieldX,
    tone: "text-rose-600 bg-rose-50 ring-rose-600/10",
    title: "Не нашли",
    text: "Позиции нет в прайсе. Оставляем пусто и указываем в документе, что её нужно уточнить.",
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
              Лучше без цены,
              <br />
              чем с неверной
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-600">
              Ошибка в документе стоит дороже, чем её отсутствие. Пропущенную цену
              менеджер проставит за минуту. Неверную — заметит клиент, и уже не
              простит.
            </p>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              Поэтому сервис никогда не угадывает. Он либо находит точное соответствие
              в прайсе, либо честно оставляет позицию открытой.
            </p>

            <div className="mt-9 grid grid-cols-2 gap-4">
              {METRICS.map((m) => (
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
              href="/app"
              className="group flex items-center justify-between rounded-2xl border border-accent-600/15
                         bg-accent-50/60 px-6 py-5 transition-colors hover:bg-accent-50"
            >
              <div>
                <p className="text-sm font-semibold text-accent-900">
                  Проверить на своей смете
                </p>
                <p className="mt-0.5 text-xs text-accent-700/80">
                  Есть демо-файлы — ничего готовить не нужно
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
