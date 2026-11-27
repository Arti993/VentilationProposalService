"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { cn } from "@shared/lib/cn";
import { downloadProposal } from "@shared/api/client";

interface DownloadProposalProps {
  sessionId: string;
  /** Сколько позиций получит цену — показываем в подсказке */
  pricedCount: number;
  className?: string;
  /** На телефоне в шапке оставляем только иконку. */
  compact?: boolean;
}

/**
 * Кнопка «Скачать КП».
 *
 * Отдельная фича, а не часть таблицы: скачивание — действие пользователя
 * над всей сметой, а не над строкой.
 */
export function DownloadProposal({
  sessionId,
  pricedCount,
  className,
  compact = false,
}: DownloadProposalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadProposal(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось скачать КП");
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || pricedCount === 0;

  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      <button
        type="button"
        onClick={handle}
        disabled={disabled}
        className={cn("btn-primary text-sm", compact && "px-2.5 sm:px-5")}
        aria-label={busy ? "Формирую КП" : "Скачать КП"}
        title={
          pricedCount === 0
            ? "Нет позиций с ценой — КП будет пустым"
            : `Скачать документ: ${pricedCount} позиций с ценой`
        }
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className={cn(compact && "hidden sm:inline")}>Формирую…</span>
          </>
        ) : (
          <>
            <Download className="h-4 w-4" />
            <span className={cn(compact && "hidden sm:inline")}>Скачать КП</span>
          </>
        )}
      </button>

      {error && (
        <p className="max-w-xs text-xs text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
