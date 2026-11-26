"use client";

/**
 * Загрузка своего прайса.
 *
 * ПОЧЕМУ ЗДЕСЬ ПОДТВЕРЖДЕНИЕ, А НЕ ЗАГРУЗКА «КАК ЕСТЬ»
 *
 * Загрузка заменяет прайс целиком: старые позиции удаляются. Значит
 * случайный выбор файла не «добавит новое», а снесёт рабочие цены, по
 * которым уже выставлены счета. Поэтому сначала показываем, что нашли в
 * файле (колонки, число позиций, сколько без размеров), и просим
 * подтвердить. Это секунда лишнего клика против потерянного прайса.
 *
 * ПОЧЕМУ ПОКАЗЫВАЕМ КОЛОНКИ
 *
 * Самая частая ошибка в прайсах — колонка «цена закупки» рядом с «ценой
 * продажи». Если разбор взял не ту, клиент увидит это здесь: «колонка с
 * ценой — вторая» — и остановится до загрузки, а не после того, как
 * менеджер выставил счёт по закупочной цене.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, LogIn, Upload } from "lucide-react";
import { uploadPrice, type PriceUploadResult } from "../api/client";

interface Props {
  /**
   * Вызывается после успешной загрузки.
   *
   * Передаём имя файла и число позиций: родитель показывает «прайс
   * загружен: такой-то файл» и убирает блок загрузки. Без этих данных
   * ему пришлось бы делать лишний запрос, чтобы узнать то, что уже
   * пришло в ответе.
   */
  onUploaded?: (info: { fileName: string; inserted: number }) => void;
  /**
   * Как показывать.
   *
   * `card` — обычная карточка «Свой прайс» (кабинет, где замена прайса —
   * осознанное действие).
   *
   * `notice` — предупреждение на экране расчёта: «прайса нет, считаем по
   * тестовому». Там загрузка — не настройка, а снятие блокирующего
   * предупреждения, поэтому и тон другой.
   */
  variant?: "card" | "notice";
}

type Phase =
  | { kind: "idle" }
  | { kind: "confirm"; file: File }
  | { kind: "uploading" }
  | { kind: "done"; result: PriceUploadResult & { ok: true } }
  | { kind: "failed"; result: PriceUploadResult & { ok: false } };

/** Читает перенос строки в заголовке для показа человеку. */
function columnLabel(index: number | null): string {
  if (index === null) return "не найдена";
  return `${index + 1}-я колонка`;
}

export function UploadPrice({ onUploaded, variant = "card" }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const isNotice = variant === "notice";

  /** Шаг 1: выбрали файл — показываем, что будем делать. */
  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhase({ kind: "confirm", file });
  }

  /** Шаг 2: подтвердили — загружаем. */
  async function confirmUpload(file: File) {
    setPhase({ kind: "uploading" });
    const result = await uploadPrice(file);
    if (result.ok) {
      setPhase({ kind: "done", result });
      onUploaded?.({ fileName: result.fileName, inserted: result.inserted });
    } else {
      setPhase({ kind: "failed", result });
    }
  }

  /** Возврат к выбору файла. */
  function reset() {
    setPhase({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div
      className={
        isNotice
          ? "rounded-2xl border border-amber-200 bg-amber-50/60 p-5"
          : "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      }
    >
      <div className="flex items-start gap-3">
        <div
          className={
            isNotice
              ? "rounded-xl bg-amber-100 p-2 text-amber-700"
              : "rounded-xl bg-slate-100 p-2 text-slate-600"
          }
          aria-hidden
        >
          <FileSpreadsheet className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">
            {isNotice ? "Свой прайс не загружен" : "Свой прайс"}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">
            {isNotice ? (
              <>
                Сейчас расчёт идёт по тестовому прайсу — цены в КП будут
                демонстрационными. Загрузите прайс поставщика, и сметы начнут
                считаться по вашим ценам.
              </>
            ) : (
              <>
                Загрузите прайс поставщика — сметы будут считаться по вашим
                ценам. Подойдёт .xlsx, .xls или .csv с колонками
                «Наименование» и «Цена».
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-4">
        {phase.kind === "idle" && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={onPick}
              className="sr-only"
              id="price-file"
            />
            <label
              htmlFor="price-file"
              className={
                isNotice
                  ? "btn-primary inline-flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm"
                  : "inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
              }
            >
              <Upload className="h-4 w-4" aria-hidden />
              Выбрать файл прайса
            </label>
          </>
        )}

        {phase.kind === "confirm" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <p className="text-sm font-medium text-slate-900">
              {isNotice
                ? `Загрузить прайс файлом «${phase.file.name}»?`
                : `Заменить прайс файлом «${phase.file.name}»?`}
            </p>
            {/*
              Главное предупреждение: загрузка не добавляет, а заменяет.
              Человек должен понимать последствие до нажатия, а не после.
            */}
            <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
              {isNotice
                ? "Сметы, загруженные раньше, останутся, но их цены при следующем расчёте возьмутся из вашего прайса."
                : "Текущий прайс будет удалён полностью и заменён новым. Сметы, загруженные раньше, останутся, но их цены при следующем расчёте возьмутся из нового прайса."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={() => confirmUpload(phase.file)}
              >
                {isNotice ? "Загрузить прайс" : "Заменить прайс"}
              </button>
              <button type="button" className="btn-secondary" onClick={reset}>
                Отмена
              </button>
            </div>
          </div>
        )}

        {phase.kind === "uploading" && (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Разбираю файл и сохраняю позиции…
          </p>
        )}

        {phase.kind === "done" && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
              {isNotice
                ? `Прайс загружен: ${phase.result.inserted} позиций`
                : `Прайс заменён: ${phase.result.inserted} позиций`}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              <li>
                Разобрано с размерами: {phase.result.quality.withDims} из{" "}
                {phase.result.quality.total}
              </li>
              {/* Пропущенные строки показываем: это не ошибка, но человек
                  должен знать, что часть прайса не попала */}
              {phase.result.skipped > 0 && (
                <li>Пропущено строк без названия или цены: {phase.result.skipped}</li>
              )}
              <li>
                Колонка с ценой: {columnLabel(phase.result.columns.price)}
                {" · "}
                с названием: {columnLabel(phase.result.columns.name)}
              </li>
            </ul>
            {phase.result.warning && (
              <p className="mt-2 text-sm text-amber-800">{phase.result.warning}</p>
            )}
            <button type="button" className="btn-secondary mt-3" onClick={reset}>
              Загрузить другой файл
            </button>
          </div>
        )}

        {phase.kind === "failed" && (
          <div className="rounded-xl border border-red-200 bg-red-50/60 p-4">
            <p className="flex items-start gap-2 text-sm font-medium text-slate-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
              {phase.result.error}
            </p>
            {phase.result.hint && (
              <p className="mt-1.5 pl-6 text-sm leading-relaxed text-slate-700">
                {phase.result.hint}
              </p>
            )}
            {/*
              Ссылка на вход прямо из ошибки.

              Раньше здесь был только текст «Войдите или зарегистрируйтесь»,
              и человек читал совет, по которому нельзя кликнуть. Страница
              /login существовала, но путь к ней из интерфейса отсутствовал
              вовсе — это и была настоящая причина, почему вход «не
              находился».
            */}
            {phase.result.needAuth && (
              <Link
                href="/login"
                className="btn-primary mt-3 ml-6 inline-flex items-center gap-1.5 px-3.5 py-2 text-sm"
              >
                <LogIn className="h-4 w-4" aria-hidden />
                Войти или зарегистрироваться
              </Link>
            )}
            <button type="button" className="btn-secondary mt-3" onClick={reset}>
              Выбрать другой файл
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
