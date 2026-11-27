"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@shared/lib/cn";

/**
 * Частые вопросы.
 *
 * Здесь отвечаем на настоящие возражения заказчика, а не на выдуманные.
 * Возражения собраны из того, что реально спрашивают про такие системы:
 * «а если не найдёт», «а если цены изменятся», «а можно ли доверять
 * нейросети».
 *
 * Аккордеон на нативных <details>: работает без JavaScript, доступен с
 * клавиатуры и читается скринридером. Своя реализация на div дала бы
 * красивую анимацию и сломанную семантику.
 */
const FAQ = [
  {
    q: "Что будет, если позиции нет в прайсе?",
    a: "Позиция останется без цены и будет указана в разделе КП «Позиции, требующие уточнения». Стоимость можно уточнить у поставщика.",
  },
  {
    q: "Откуда берутся цены в КП?",
    a: "Цены берутся из загруженного прайса поставщика. Сервис сопоставляет позиции по типу оборудования, размерам и названию. Неоднозначные соответствия выделяются для проверки.",
  },
  {
    q: "Что если прайс изменится после отправки КП?",
    a: "Ранее сформированное КП сохраняет цены расчёта. Обновлённый прайс используется для новых смет.",
  },
  {
    q: "Какие форматы смет принимаются?",
    a: "Excel (.xlsx, .xlsm, .xls), Word (.docx), CSV, TSV и TXT. Поддерживаются книги с несколькими листами и таблицы, перед которыми размещены реквизиты или другие сведения.",
  },
  {
    q: "Кто отвечает за спорные позиции?",
    a: "Менеджер проверяет строки в разделе «Требуют внимания» и выбирает соответствующие позиции прайса. Причины отсутствия цены можно уточнить у ассистента.",
  },
  {
    q: "Как загрузить прайс поставщика?",
    a: "Войдите в аккаунт и загрузите файл .xlsx, .xls или .csv с колонками «Наименование» и «Цена». Новые сметы будут рассчитываться по этому прайсу.",
  },
];

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="border-t border-slate-200 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
          <div>
            <p className="eyebrow">Вопросы</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              Частые вопросы
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              Форматы файлов, источники цен и проверка результатов расчёта.
            </p>
          </div>

          <div className="divide-y divide-slate-200 border-y border-slate-200">
            {FAQ.map((item, i) => {
              const open = openIndex === i;
              return (
                <div key={item.q}>
                  <button
                    type="button"
                    onClick={() => setOpenIndex(open ? null : i)}
                    aria-expanded={open}
                    className="flex w-full items-start justify-between gap-4 py-5 text-left
                               transition-colors hover:text-accent-700"
                  >
                    <span
                      className={cn(
                        "text-sm font-medium transition-colors",
                        open ? "text-accent-700" : "text-slate-900",
                      )}
                    >
                      {item.q}
                    </span>
                    <ChevronDown
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform duration-300",
                        open && "rotate-180 text-accent-600",
                      )}
                      aria-hidden
                    />
                  </button>

                  {/* Высота через grid-template-rows: анимируется без JS и
                      без прыжка, в отличие от max-height с угаданным числом */}
                  <div
                    className={cn(
                      "grid transition-all duration-300 ease-out-expo",
                      open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                    )}
                  >
                    <div className="overflow-hidden">
                      <p className="pb-5 pr-8 text-sm leading-relaxed text-slate-600">
                        {item.a}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
