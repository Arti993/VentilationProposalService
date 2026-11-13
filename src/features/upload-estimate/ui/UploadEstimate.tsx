"use client";

/**
 * Фича: загрузка сметы.
 *
 * Держит всё, что нужно для одного действия: drag&drop, валидация на
 * клиенте, состояние загрузки и ошибки. Сервер валидирует повторно —
 * клиентская проверка для удобства, а не для безопасности.
 */
import { useCallback, useRef, useState, type DragEvent } from "react";
import { UploadCloud, FileText, Loader2, X, ArrowRight } from "lucide-react";
import { cn } from "@shared/lib/cn";
import { uploadEstimate } from "@shared/api/client";
import type { EstimateSession } from "@entities/estimate/model/types";

interface UploadEstimateProps {
  onLoaded: (session: EstimateSession & { id: string }) => void;
}

/**
 * Форматы, которые принимаем.
 *
 * Список продублирован в атрибуте accept и в проверке — это не
 * избыточность, а необходимость: accept только фильтрует диалог
 * выбора файла, обойти его можно перетаскиванием.
 */
const ACCEPTED = [".txt", ".csv", ".tsv", ".xlsx", ".xlsm", ".xls", ".docx"];

/** Подпись формата для показа пользователю. */
function formatLabel(name: string): string {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  const map: Record<string, string> = {
    ".xlsx": "Excel",
    ".xlsm": "Excel (с макросами)",
    ".xls": "Excel (старый формат)",
    ".docx": "Word",
    ".csv": "CSV",
    ".tsv": "TSV",
    ".txt": "Текст",
  };
  return map[ext] ?? ext;
}

export function UploadEstimate({ onLoaded }: UploadEstimateProps) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = useCallback((f: File | null) => {
    setError(null);
    if (!f) return;

    const ext = f.name.toLowerCase().slice(f.name.lastIndexOf("."));
    if (!ACCEPTED.includes(ext)) {
      setError(
        `Формат «${ext || "без расширения"}» не поддерживается. ` +
          `Подойдёт Excel, Word или текстовый файл.`,
      );
      return;
    }
    // Бинарные форматы тяжелее текстовых — отдельный лимит не нужен,
    // но пользователю полезно знать, что мы это учитываем
    if (f.size > 5 * 1024 * 1024) {
      setError(`Файл больше 5 МБ (${Math.round(f.size / 1024 / 1024)} МБ).`);
      return;
    }
    setFile(f);
  }, []);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files?.[0] ?? null);
  };

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await uploadEstimate(file);
      onLoaded(res.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить смету");
    } finally {
      setBusy(false);
    }
  };

  /** Демо-смета: сервер отдаёт файл, мы оборачиваем его в File и грузим как обычный */
  const loadDemo = async (which: "office" | "warehouse") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/demo-estimate?file=${which}`);
      if (!res.ok) throw new Error("Не удалось получить демо-смету");
      const text = await res.text();
      const name = which === "office" ? "estimate-office.txt" : "estimate-warehouse.csv";
      const demoFile = new File([text], name, { type: "text/plain" });
      const up = await uploadEstimate(demoFile);
      onLoaded(up.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка демо-сметы");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "group relative flex flex-col items-center justify-center gap-3 rounded-2xl",
          "border-2 border-dashed px-5 py-10 text-center transition-all duration-200 sm:gap-4 sm:px-6 sm:py-14",
          dragging
            ? "border-accent-400 bg-accent-50/60"
            : "border-slate-200 bg-slate-50/50 hover:border-accent-300 hover:bg-accent-50/30",
        )}
      >
        {/*
          Настоящая кнопка, а не div с role="button": браузер сам даёт
          ей фокус, отклик на Enter и пробел, и озвучивает как кнопку.
          Раньше здесь был div с тремя обработчиками — работало, но
          скринридер не понимал, что это элемент действия.
        */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 sm:gap-4"
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(",")}
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />

          {file ? (
            <>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 sm:h-14 sm:w-14">
                <FileText className="h-5 w-5 text-accent-600 sm:h-6 sm:w-6" aria-hidden />
              </span>
              <span className="min-w-0 max-w-full">
                <span className="block break-all font-medium text-slate-900">
                  {file.name}
                </span>
                <span className="mt-1 block text-xs text-slate-500 sm:text-sm">
                  {formatLabel(file.name)} · {Math.round(file.size / 1024)} КБ
                </span>
              </span>
            </>
          ) : (
            <>
              <span
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 sm:h-14 sm:w-14",
                  "transition-transform duration-200 group-hover:scale-105",
                )}
              >
                <UploadCloud className="h-5 w-5 text-accent-600 sm:h-6 sm:w-6" aria-hidden />
              </span>
              <span>
                <span className="block text-sm font-medium text-slate-900 sm:text-base">
                  Перетащите файл или нажмите для выбора
                </span>
                <span className="mt-1 block text-xs text-slate-500 sm:text-sm">
                  Excel, Word, CSV или текст — до 5 МБ
                </span>
              </span>
            </>
          )}
        </button>
      </div>

      {error && (
        <div
          className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700"
          role="alert"
        >
          <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          className="btn-primary min-h-11 w-full sm:flex-1"
          type="button"
          onClick={submit}
          disabled={!file || busy}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Обрабатываю…
            </>
          ) : (
            <>
              Обработать смету
              <ArrowRight className="h-4 w-4" aria-hidden />
            </>
          )}
        </button>
        {file && !busy && (
          <button
            className="btn-ghost min-h-11"
            onClick={() => {
              setFile(null);
              setError(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Демо: пользователю не нужно искать файл, чтобы увидеть работу сервиса */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-3">
        <span className="py-2 text-xs text-slate-500">Нет файла под рукой?</span>
        {/*
          type="button" обязателен. Кнопки загрузки демо — не единственные
          кнопки на этом экране, и без явного типа браузер считает их
          отправляющими: внутри формы клик сабмитит её и обработчик
          не вызывается вовсе. Симптом коварный — кнопка нажимается,
          ничего не происходит, ошибок в консоли нет.
        */}
        <button
          type="button"
          className="min-h-9 px-1 text-xs font-medium text-accent-700 underline-offset-4 hover:underline disabled:opacity-40"
          onClick={() => loadDemo("office")}
          disabled={busy}
        >
          Офисная смета
        </button>
        <span className="text-slate-300" aria-hidden>
          ·
        </span>
        <button
          type="button"
          className="min-h-9 px-1 text-xs font-medium text-accent-700 underline-offset-4 hover:underline disabled:opacity-40"
          onClick={() => loadDemo("warehouse")}
          disabled={busy}
        >
          Смета склада
        </button>
      </div>
    </div>
  );
}
