"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, Download, Info, Search } from "lucide-react";
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
 * Три вещи, которые нужны менеджеру сразу после загрузки и потому
 * вынесены наверх: фильтр по проблемным строкам, сортировка по сумме
 * (дорогое — первым) и поиск по названию. Всё остальное — украшение.
 *
 * Поиск добавлен не для красоты: в смете на 50 позиций найти конкретную
 * строку глазами дольше, чем набрать три буквы.
 */
export function EstimateTable({ positions, onSelect }: EstimateTableProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sortBySum, setSortBySum] = useState(false);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!.test;
    const q = query.trim().toLowerCase();

    let list = positions.filter((p) => f(p.status));
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.matchedName ?? "").toLowerCase().includes(q),
      );
    }
    if (sortBySum) {
      list = [...list].sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    }
    return list;
  }, [positions, filter, sortBySum, query]);

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
    <div className="w-full min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      {/* ── Панель управления ────────────────────────────── */}
      <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const count = positions.filter((p) => f.test(p.status)).length;
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                  active
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "ml-1.5 rounded-md px-1.5 py-0.5 text-2xs tabular",
                    active ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 lg:w-56 lg:flex-none">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти позицию"
              className="field !py-1.5 !pl-8 !text-xs"
              aria-label="Поиск по позициям"
            />
          </div>

          <button
            onClick={() => setSortBySum((v) => !v)}
            className={cn(
              "btn-ghost !px-2.5 !py-1.5 !text-xs",
              sortBySum && "bg-slate-100 text-slate-900",
            )}
            title="Сортировать по сумме"
            aria-pressed={sortBySum}
          >
            <ArrowDownUp className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">По сумме</span>
          </button>

          <button onClick={exportCsv} className="btn-ghost !px-2.5 !py-1.5 !text-xs">
            <Download className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">CSV</span>
          </button>
        </div>
      </div>

      {/* На узких экранах таблица скроллится внутри себя, а не распирает страницу */}
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left">
              <th className="w-12 px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">
                №
              </th>
              <th className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">
                Позиция клиента
              </th>
              <th className="w-20 px-3 py-2.5 text-right text-2xs font-semibold uppercase tracking-wider text-slate-500">
                Кол-во
              </th>
              <th className="w-20 px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">
                Статус
              </th>
              <th className="w-28 px-3 py-2.5 text-right text-2xs font-semibold uppercase tracking-wider text-slate-500">
                Цена
              </th>
              <th className="w-32 px-3 py-2.5 text-right text-2xs font-semibold uppercase tracking-wider text-slate-500">
                Сумма
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr
                key={p.posNo}
                onClick={() => onSelect?.(p)}
                className={cn(
                  "group border-b border-slate-100 transition-colors last:border-0",
                  onSelect && "cursor-pointer hover:bg-accent-50/40",
                )}
              >
                <td className="px-3 py-3 tabular text-xs text-slate-400">{p.posNo}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "text-slate-900 transition-colors",
                        onSelect && "group-hover:text-accent-700",
                      )}
                    >
                      {p.name}
                    </span>
                    {p.reason && (
                      <span title={p.reason} className="text-slate-300 hover:text-slate-500">
                        <Info className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    )}
                  </div>
                  {p.matchedName && p.status === "priced" && (
                    <p className="mt-0.5 truncate text-2xs text-slate-400">
                      в прайсе: {p.matchedName}
                    </p>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular text-slate-700">
                  {formatNumber(p.qty)}
                  {p.unit && <span className="ml-1 text-2xs text-slate-400">{p.unit}</span>}
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={p.status} withDot={false} />
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular text-slate-600">
                  {formatMoney(p.unitPrice)}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular text-slate-900">
                  {formatMoney(p.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <div className="px-4 py-14 text-center">
            <p className="text-sm font-medium text-slate-700">Ничего не найдено</p>
            <p className="mt-1 text-xs text-slate-500">
              {query ? `По запросу «${query}»` : "С таким фильтром"} позиций нет
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
