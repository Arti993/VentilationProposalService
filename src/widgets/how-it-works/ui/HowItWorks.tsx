import { UploadCloud, ScanSearch, FileCheck2, Send } from "lucide-react";

const STEPS = [
  {
    icon: UploadCloud,
    title: "Загрузите смету",
    text: "Excel, Word или CSV — в каком виде прислали, в таком и загружайте. Книга из нескольких листов, таблица в документе, список строк из письма: формат определяем сами.",
    // Полный перечень под текстом: человек, который ищет «а моя смета
    // подойдёт?», должен получить ответ сразу, не открывая приложение
    formats: [
      { label: "Excel", ext: ".xlsx .xlsm .xls" },
      { label: "Word", ext: ".docx" },
      { label: "Текст", ext: ".csv .tsv .txt" },
    ],
  },
  {
    icon: ScanSearch,
    title: "Сопоставление",
    text: "Каждая строка приводится к канону и ищется в прайсе. Похожие названия, разные единицы, размеры через дефис — всё разбирается.",
  },
  {
    icon: FileCheck2,
    title: "Цены — только из прайса",
    text: "Совпадение однозначное — цена проставлена. Неоднозначное — позиция уходит менеджеру, а не в документ с догадкой.",
  },
  {
    icon: Send,
    title: "Готовый документ",
    text: "КП в DOCX с реквизитами, таблицей и итогом. Плюс текст для письма клиенту — можно скопировать и отправить.",
  },
];

/**
 * Секция «Как работает».
 *
 * Четыре шага, а не больше: если объяснение требует пяти пунктов,
 * продукт сложен для понимания. Здесь важна не полнота, а контраст
 * между «загрузил» и «получил».
 */
export function HowItWorks() {
  return (
    <section id="how" className="relative border-t border-slate-200 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="max-w-2xl">
          <p className="eyebrow">Процесс</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            От сметы до готового КП — четыре шага
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            Никаких настроек, шаблонов и обучения. Загрузили файл — получили документ,
            который можно отправлять клиенту.
          </p>
        </div>

        <ol className="mt-16 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.title} className="relative reveal">
                {/* Соединительная линия между шагами на широком экране */}
                {i < STEPS.length - 1 && (
                  <span
                    className="absolute left-12 top-5 hidden h-px w-[calc(100%-3rem)] bg-gradient-to-r from-slate-200 to-transparent lg:block"
                    aria-hidden
                  />
                )}

                <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
                  <Icon className="h-5 w-5 text-accent-600" aria-hidden />
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent-600 text-[10px] font-semibold text-white">
                    {i + 1}
                  </span>
                </div>

                <h3 className="mt-5 text-base font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.text}</p>

                {/* Форматы — только у первого шага: у остальных их нет,
                    и список был бы шумом */}
                {"formats" in s && s.formats && (
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {s.formats.map((f) => (
                      <li
                        key={f.label}
                        // Расширения показаны прямо здесь, а не в
                        // title-подсказке: на телефоне подсказки по
                        // наведению не существует вовсе, а на десктопе
                        // её находят единицы — человек, который ищет
                        // «подойдёт ли мой файл», должен увидеть ответ
                        // сразу
                        className="rounded-md bg-slate-100 px-2 py-1 text-2xs leading-relaxed text-slate-600"
                      >
                        <span className="font-medium text-slate-700">{f.label}</span>
                        <span className="ml-1 text-slate-500">{f.ext}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
