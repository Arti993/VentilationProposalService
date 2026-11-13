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
    a: "Она останется без цены и попадёт в КП с пометкой «уточнить у менеджера». Мы не подставляем похожую цену и не оцениваем приблизительно: неверная цена в документе обходится дороже, чем пустая ячейка.",
  },
  {
    q: "Можно ли доверять нейросети в расчётах?",
    a: "Нейросеть не называет цены. Её роль — понять, о какой позиции прайса идёт речь, и вернуть идентификатор. Цену подставляет код, беря её из прайса. Даже при сбое модели в документе не может появиться выдуманная сумма.",
  },
  {
    q: "Что если прайс изменится после отправки КП?",
    a: "В документе остаются цены на момент его создания. Мы специально храним снимок, а не ссылку на прайс: клиенту уже назвали сумму, и она не должна поменяться задним числом.",
  },
  {
    q: "Какие форматы смет принимаются?",
    a: "Текстовые и табличные: .txt, .csv, .tsv. Подходит и выгрузка из Excel, и список строк, скопированный из письма. Файлы Word и PDF пока не разбираются.",
  },
  {
    q: "Кто отвечает за спорные позиции?",
    a: "Менеджер. Сервис показывает все сомнительные строки отдельным фильтром и объясняет по каждой, что именно смутило. Решение всегда остаётся за человеком.",
  },
  {
    q: "Это работает с моим прайсом?",
    a: "В демонстрации используется прайс на 215 позиций по вентиляционному оборудованию. Структура загрузки прайса универсальная — подключается свой файл, а правила сопоставления настраиваются под номенклатуру.",
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
              Что обычно спрашивают
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              Если ответа нет — напишите, и мы добавим его сюда.
            </p>
          </div>

          <div className="divide-y divide-slate-200 border-y border-slate-200">
            {FAQ.map((item, i) => {
              const open = openIndex === i;
              return (
                <div key={item.q}>
                  <button
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
