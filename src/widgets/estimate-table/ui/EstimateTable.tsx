"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, Download, Info } from "lucide-react";
import { cn, formatMoney, formatNumber } from "@shared/lib/cn";
import { StatusBadge } from "@entities/estimate/ui/StatusBadge";
import type { EstimatePosition, PositionStatus } from "@entities/estimate/model/types";

interface EstimateTableProps {
  positions: EstimatePosition[];
  /** Клик по позиции — например, чтобы спросить агента про неё */
  onSelect?: (pos: EstimatePosition) => void;
}

type Filter = "all" | "priced" | "problems";

const FILTERS: Array<{ key: Filter; label: string; test: (s: PositionStatus) => boolean }> = [
  { key: "all", label: "Все", test: () => true },
  { key: "priced", label: "С ценой", test: (s) => s === "priced" },
  {
    key: "problems",
    label: "Требуют внимания",
    test: (s) => s !== "priced" && s !== "off_topic",
  },
];

/**
 * Таблица позиций сметы.
 *
 * Сортировка по сумме включена: менеджер первым делом смотрит на дорогие
 * позиции. Фильтр «требуют внимания» — самая частая задача после загрузки.
 */
export function EstimateTable({ positions, onSelect }: EstimateTableProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sortBySum, setSortBySum] = useState(false);

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!.test;
    let list = positions.filter((p) => f(p.status));
    if (sortBySum) {
      list = [...list].sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    }
    return list;
  }, [positions, filter, sortBySum]);

  const exportCsv = () => {
    const header = ["№", "Позиция клиента", "Кол-во", "Ед.", "Статус", "Цена за ед.", "Сумма", "В прайсе"];
    const rows = positions.map((p) => [
      p.posNo,
      p.name,
      p.qty,
      p.unit ?? "",
      p.status,
      p.unitPrice ?? "",
      p.total ?? "",
      p.matchedName ?? "",
    ]);

    // Точка с запятой и BOM: Excel в русской локали не иначе
    const csv =
      "\uFEFF" +
      [header, ...rows]
        .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
        .join("\r\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kp.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card w-full min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const count = positions.filter((p) => f.test(p.status)).length;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  filter === f.key
                    ? "bg-ink-900 text-white"
                    : "text-ink-600 hover:bg-ink-100",
                )}
              >
                {f.label}
                <span className={cn("ml-1.5 text-xs", filter === f.key ? "text-ink-300" : "text-ink-400")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-1">
          <button
            onClick={() => setSortBySum((v) => !v)}
            className={cn("btn-ghost !px-2.5 !py-1.5 text-xs", sortBySum && "bg-ink-100")}
            title="Сортировать по сумме"
          >
            <ArrowDownUp className="h-3.5 w-3.5" />
            По сумме
          </button>
          <button onClick={exportCsv} className="btn-ghost !px-2.5 !py-1.5 text-xs">
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
        </div>
      </div>

      {/* На узких экранах таблица скроллится внутри себя, а не распирает страницу */}
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
              <th className="w-12 px-3 py-2.5 font-medium">№</th>
              <th className="px-3 py-2.5 font-medium">Позиция клиента</th>
              <th className="w-20 px-3 py-2.5 text-right font-medium">Кол-во</th>
              <th className="w-14 px-3 py-2.5 font-medium">Ед.</th>
              <th className="w-32 px-3 py-2.5 font-medium">Статус</th>
              <th className="w-28 px-3 py-2.5 text-right font-medium">Цена</th>
              <th className="w-32 px-3 py-2.5 text-right font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr
                key={p.posNo}
                onClick={() => onSelect?.(p)}
                className={cn(
                  "border-b border-ink-100 last:border-0 transition-colors",
                  onSelect && "cursor-pointer hover:bg-ink-50",
                )}
              >
                <td className="px-3 py-2.5 tabular-nums text-ink-400">{p.posNo}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-ink-900">{p.name}</span>
                    {p.reason && (
                      <span title={p.reason} className="text-ink-300 hover:text-ink-500">
                        <Info className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                  {p.matchedName && p.status === "priced" && (
                    <p className="mt-0.5 text-xs text-ink-400">в прайсе: {p.matchedName}</p>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">
                  {formatNumber(p.qty)}
                </td>
                <td className="px-3 py-2.5 text-ink-500">{p.unit ?? "—"}</td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={p.status} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">
                  {formatMoney(p.unitPrice)}
                </td>
                <td className="px-3 py-2.5 text-right font-medium tabular-nums text-ink-900">
                  {formatMoney(p.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-ink-400">Нет позиций с таким фильтром</p>
        )}
      </div>
    </div>
  );
}
