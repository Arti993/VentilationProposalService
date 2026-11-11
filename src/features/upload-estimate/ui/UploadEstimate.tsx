"use client";

/**
 * Фича: загрузка сметы.
 *
 * Держит всё, что нужно для одного действия: drag&drop, валидация на
 * клиенте, состояние загрузки и ошибки. Сервер валидирует повторно —
 * клиентская проверка для удобства, а не для безопасности.
 */
import { useCallback, useRef, useState, type DragEvent } from "react";
import { UploadCloud, FileText, Loader2, X } from "lucide-react";
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
    <div className="space-y-3">
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
          "group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl",
          "border-2 border-dashed px-6 py-10 text-center transition-colors",
          dragging
            ? "border-copper-500 bg-copper-50"
            : "border-ink-200 bg-white hover:border-ink-300 hover:bg-ink-50",
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
            <FileText className="h-8 w-8 text-ink-400" />
            <div>
              <p className="font-medium text-ink-900">{file.name}</p>
              <p className="text-sm text-ink-500">{Math.round(file.size / 1024)} КБ</p>
            </div>
          </>
        ) : (
          <>
            <UploadCloud className="h-8 w-8 text-ink-400 transition-colors group-hover:text-ink-600" />
            <div>
              <p className="font-medium text-ink-900">
                Перетащите смету или нажмите для выбора
              </p>
              <p className="text-sm text-ink-500">.txt, .csv — до 2 МБ</p>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-bad/20 bg-bad/5 px-3 py-2 text-sm text-bad">
          <X className="mt-0.5 h-4 w-4 shrink-0" />
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
            "Обработать смету"
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
      <div className="flex items-center gap-2 border-t border-ink-100 pt-3">
        <span className="text-xs text-ink-400">Нет файла под рукой?</span>
        <button
          className="text-xs font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline disabled:opacity-40"
          onClick={() => loadDemo("office")}
          disabled={busy}
        >
          Офисная смета
        </button>
        <span className="text-ink-200">·</span>
        <button
          className="text-xs font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline disabled:opacity-40"
          onClick={() => loadDemo("warehouse")}
          disabled={busy}
        >
          Смета склада
        </button>
      </div>
    </div>
  );
}
