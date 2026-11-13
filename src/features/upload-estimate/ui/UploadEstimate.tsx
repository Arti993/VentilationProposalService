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
    if (![".txt", ".csv", ".tsv"].includes(ext)) {
      setError(`Формат «${ext || "без расширения"}» не поддерживается. Нужен .txt или .csv.`);
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      setError("Файл больше 2 МБ.");
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
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl",
          "border-2 border-dashed px-6 py-14 text-center transition-all duration-200",
          dragging
            ? "border-accent-400 bg-accent-50/60 scale-[1.01]"
            : "border-slate-200 bg-slate-50/50 hover:border-accent-300 hover:bg-accent-50/30",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.csv,.tsv"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />

        {file ? (
          <>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <FileText className="h-6 w-6 text-accent-600" />
            </div>
            <div>
              <p className="font-medium text-slate-900">{file.name}</p>
              <p className="mt-1 text-sm text-slate-500">
                {Math.round(file.size / 1024)} КБ · готов к обработке
              </p>
            </div>
          </>
        ) : (
          <>
            <div
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200",
                "transition-transform duration-200 group-hover:scale-105",
              )}
            >
              <UploadCloud className="h-6 w-6 text-accent-600" />
            </div>
            <div>
              <p className="font-medium text-slate-900">
                Перетащите файл или нажмите для выбора
              </p>
              <p className="mt-1 text-sm text-slate-500">
                .txt, .csv, .tsv — до 2 МБ
              </p>
            </div>
          </>
        )}
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

      <div className="flex items-center gap-2">
        <button className="btn-primary flex-1" onClick={submit} disabled={!file || busy}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Обрабатываю…
            </>
          ) : (
            <>
              Обработать смету
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
        {file && !busy && (
          <button
            className="btn-ghost"
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-4">
        <span className="text-xs text-slate-500">Нет файла под рукой?</span>
        <button
          className="text-xs font-medium text-accent-600 underline-offset-4 hover:text-accent-700 hover:underline disabled:opacity-40"
          onClick={() => loadDemo("office")}
          disabled={busy}
        >
          Офисная смета
        </button>
        <span className="text-slate-200" aria-hidden>
          ·
        </span>
        <button
          className="text-xs font-medium text-accent-600 underline-offset-4 hover:text-accent-700 hover:underline disabled:opacity-40"
          onClick={() => loadDemo("warehouse")}
          disabled={busy}
        >
          Смета склада
        </button>
      </div>
    </div>
  );
}
