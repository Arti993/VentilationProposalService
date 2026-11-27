"use client";

/**
 * Состояние прайса в кабинете.
 *
 * ЧТО ПОКАЗЫВАЕТ
 *
 *  - своего прайса нет → предупреждение и кнопка загрузки;
 *  - прайс есть → имя файла, число позиций, дата; замена спрятана в
 *    раскрывающийся блок.
 *
 * ПОЧЕМУ ЗАМЕНА СПРЯТАНА
 *
 * «Свой прайс» — действие раз в квартал: поставщик присылает новый файл,
 * менеджер его загружает. Если форма загрузки всегда развёрнута, каждый
 * заход в кабинет начинается с риска случайно заменить рабочий прайс.
 * `details` даёт замену в один клик, но без случайного нажатия.
 *
 * ПОЧЕМУ ДАТА С ФИКСИРОВАННОЙ ЗОНОЙ
 *
 * Сервер рендерит эту разметку в UTC, браузер — в московском времени.
 * Без явной зоны одна и та же дата дала бы разный текст на сервере и в
 * браузере, и React сообщил бы о расхождении гидрации. `Europe/Moscow`
 * делает результат одинаковым у всех: сервис русскоязычный, и даты в нём
 * и так московские.
 */
import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { UploadPrice } from "@features/upload-price";

export interface PriceCardProps {
  hasOwnPrice: boolean;
  fileName: string | null;
  itemCount: number | null;
  uploadedAt: string | null;
  /** Сколько позиций в прайсе сейчас — у старых загрузок имени нет */
  total: number;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeZone: "Europe/Moscow",
  }).format(d);
}

export function PriceCard({
  hasOwnPrice,
  fileName,
  itemCount,
  uploadedAt,
  total,
}: PriceCardProps) {
  /**
   * После загрузки данные приходят из ответа, а не из пропсов: пропсы
   * посчитаны на сервере при открытии страницы и о новой загрузке не
   * знают. `null` — «как в пропсах».
   */
  const [fresh, setFresh] = useState<{ fileName: string; inserted: number } | null>(null);

  const loaded = hasOwnPrice || fresh !== null;
  const shownName = fresh?.fileName ?? fileName;
  const shownCount = fresh?.inserted ?? itemCount ?? total;
  const shownDate = fresh ? null : formatDate(uploadedAt);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-slate-100 p-2 text-slate-600" aria-hidden>
          <FileSpreadsheet className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900">Прайс</h2>

          {loaded ? (
            <>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">
                Прайс используется для расчёта новых смет.
              </p>
              {/*
                Имя файла может быть неизвестно: прайс, загруженный до
                появления учёта, живёт в базе без него. Тогда честно
                показываем только число позиций, а не выдумываем название.
              */}
              <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Файл</dt>
                  <dd className="mt-0.5 truncate text-slate-900" title={shownName ?? undefined}>
                    {shownName ?? "Название недоступно"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Позиций</dt>
                  <dd className="mt-0.5 text-slate-900">{shownCount}</dd>
                </div>
                {shownDate && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Загружен</dt>
                    <dd className="mt-0.5 text-slate-900">{shownDate}</dd>
                  </div>
                )}
              </dl>

              <details className="mt-4 rounded-xl border border-slate-200">
                <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Заменить прайс
                </summary>
                <div className="border-t border-slate-200 p-4">
                  <UploadPrice
                    variant="card"
                    onUploaded={(info) => setFresh({ fileName: info.fileName, inserted: info.inserted })}
                  />
                </div>
              </details>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">
                Используется демонстрационный прайс. Загрузите прайс поставщика для расчёта по вашим ценам.
              </p>
              <div className="mt-4">
                <UploadPrice
                  variant="card"
                  onUploaded={(info) => setFresh({ fileName: info.fileName, inserted: info.inserted })}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}