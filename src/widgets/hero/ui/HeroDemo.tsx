"use client";

/**
 * Живая демонстрация на первом экране.
 *
 * Показывает не картинку, а настоящую разметку с настоящими данными из
 * прайса: строки сметы, статусы, суммы. Заказчик видит продукт, а не
 * иллюстрацию к нему.
 *
 * Строки «печатаются» по очереди — 160 мс между ними. Приём знакомый по
 * консолям и лендингам про ИИ, и здесь он уместен по смыслу: показывает,
 * что обработка поштучная и вдумчивая, а не «магия за один кадр».
 * Анимация запускается один раз, дальше карточка статична: повторять её
 * при каждом скролле было бы навязчиво.
 */
import { useEffect, useState } from "react";
import { FileCheck2, Loader2 } from "lucide-react";
import { cn, formatMoney } from "@shared/lib/cn";

interface DemoRow {
  name: string;
  qty: string;
  price: number | null;
  status: "priced" | "not_found" | "needs_human";
  matched?: string;
}

/**
 * Данные взяты из реального прогона сметы «офис» — специально вместе с
 * проблемными строками. Демонстрация, где всё находится, выглядит
 * подозрительно: настоящий прайс не покрывает смету полностью.
 */
const ROWS: DemoRow[] = [
  { name: "Воздуховод круглый 315", qty: "10 м", price: 890, status: "priced", matched: "Воздуховод круглый d315" },
  { name: "Тройник 315х200", qty: "3 шт", price: 2_340, status: "priced", matched: "Тройник круглый 315/200" },
  { name: "Отвод 90° 250", qty: "6 шт", price: 1_120, status: "priced", matched: "Отвод штампованный 90° d250" },
  { name: "Хомут для воздуховода 315", qty: "5 шт", price: null, status: "not_found" },
  { name: "Переход 400-315", qty: "2 шт", price: null, status: "needs_human" },
];

const STATUS_LABEL: Record<DemoRow["status"], string> = {
  priced: "Цена есть",
  not_found: "Нет в прайсе",
  needs_human: "На проверку",
};

const STATUS_STYLE: Record<DemoRow["status"], string> = {
  priced: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15",
  not_found: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15",
  needs_human: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15",
};

const STEP_MS = 160;

export function HeroDemo() {
  const [shown, setShown] = useState(0);
  const done = shown >= ROWS.length;

  useEffect(() => {
    // Уважаем настройку «меньше движения»: показываем всё сразу
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(ROWS.length);
      return;
    }

    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      setShown(n);
      if (n >= ROWS.length) {
        clearInterval(timer);
      }
    }, STEP_MS);

    return () => clearInterval(timer);
  }, []);

  const total = ROWS.slice(0, shown)
    .filter((r) => r.price !== null)
    .reduce((s, r) => {
      const qty = Number(r.qty.replace(/[^\d.]/g, "")) || 0;
      return s + r.price! * qty;
    }, 0);

  return (
    <div className="relative">
      {/* Свечение позади карточки — отделяет её от фона */}
      <div
        className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br
                   from-accent-100/60 via-white to-slate-100/70 blur-2xl"
        aria-hidden
      />

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lift">
        {/* Панель окна */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileCheck2 className="h-4 w-4 shrink-0 text-accent-600" />
            <span className="truncate text-xs font-medium text-slate-700">
              смета-от-клиента.txt
            </span>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium transition-colors",
              done
                ? "bg-emerald-50 text-emerald-700"
                : "bg-accent-50 text-accent-700",
            )}
          >
            {done ? "Готово" : "Обработка…"}
          </span>
        </div>

        {/* Строки */}
        <div className="divide-y divide-slate-100">
          {ROWS.slice(0, shown).map((r, i) => (
            <div
              key={r.name}
              className="flex items-center gap-3 px-4 py-3 animate-slide-up"
              style={{ animationDuration: "280ms" }}
            >
              <span className="w-4 shrink-0 text-2xs tabular text-slate-300">{i + 1}</span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-slate-800">{r.name}</p>
                {r.matched ? (
                  <p className="truncate text-2xs text-slate-500">в прайсе: {r.matched}</p>
                ) : (
                  <p className="truncate text-2xs text-slate-500">{r.qty}</p>
                )}
              </div>

              <span
                className={cn(
                  "badge hidden shrink-0 whitespace-nowrap sm:inline-flex",
                  STATUS_STYLE[r.status],
                )}
              >
                {STATUS_LABEL[r.status]}
              </span>

              <span
                className={cn(
                  "w-20 shrink-0 text-right text-[13px] tabular",
                  r.price !== null ? "font-medium text-slate-900" : "text-slate-300",
                )}
              >
                {r.price !== null ? formatMoney(r.price) : "—"}
              </span>
            </div>
          ))}

          {!done && (
            <div className="flex items-center gap-2 px-4 py-3 text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-2xs">Сопоставляю с прайсом…</span>
            </div>
          )}
        </div>

        {/* Итог */}
        <div
          className={cn(
            "flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-4 py-3.5 transition-opacity duration-500",
            done ? "opacity-100" : "opacity-0",
          )}
        >
          <div>
            <p className="text-2xs text-slate-500">Итог по КП</p>
            <p className="text-lg font-semibold tracking-tight tabular text-slate-900">
              {formatMoney(total)}
            </p>
          </div>
          <p className="max-w-[10rem] text-right text-2xs leading-relaxed text-slate-500">
            Две позиции без цены — уточнит менеджер
          </p>
        </div>
      </div>

      {/* Ярлык поверх карточки: подчёркивает ключевое свойство */}
      <div
        className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full
                   border border-slate-200 bg-white px-3.5 py-1.5 text-2xs font-medium
                   text-slate-600 shadow-card sm:left-auto sm:right-6 sm:translate-x-0"
      >
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />
        Ни одной выдуманной цены
      </div>
    </div>
  );
}
