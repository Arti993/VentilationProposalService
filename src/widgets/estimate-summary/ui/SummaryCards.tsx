import { CheckCircle2, AlertTriangle, HelpCircle, Wallet } from "lucide-react";
import { cn, formatMoney, formatNumber } from "@shared/lib/cn";
import type { EstimateStats } from "@entities/estimate/model/types";

interface SummaryCardsProps {
  stats: EstimateStats;
}

interface CardProps {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "neutral";
  hint?: string;
}

const TONES = {
  ok: "text-ok bg-ok/10",
  warn: "text-warn bg-warn/10",
  bad: "text-bad bg-bad/10",
  neutral: "text-ink-700 bg-ink-100",
} as const;

function Card({ icon: Icon, label, value, tone, hint }: CardProps) {
  return (
    <div className="card min-w-0 p-4">
      <div className="flex items-start justify-between">
        <div className={cn("rounded-lg p-2", TONES[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {/* Суммы длинные: на узком экране уменьшаем кегль, а не ломаем вёрстку */}
      <p className="mt-3 truncate text-xl font-semibold tabular-nums text-ink-900 sm:text-2xl">
        {value}
      </p>
      <p className="truncate text-xs text-ink-500 sm:text-sm">{label}</p>
      {hint && <p className="mt-1 truncate text-[11px] text-ink-400">{hint}</p>}
    </div>
  );
}

/** Карточки-метрики по смете. Сетка адаптивная: 2 колонки на телефоне. */
export function SummaryCards({ stats }: SummaryCardsProps) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
      <Card
        icon={Wallet}
        label="Итог по КП"
        value={formatMoney(stats.totalSum)}
        tone="neutral"
        hint={`${formatNumber(stats.priced)} из ${stats.total} позиций с ценой`}
      />
      <Card
        icon={CheckCircle2}
        label="Цена проставлена"
        value={String(stats.priced)}
        tone="ok"
      />
      <Card
        icon={AlertTriangle}
        label="Нет в прайсе"
        value={String(stats.notFound)}
        tone="warn"
      />
      <Card
        icon={HelpCircle}
        label="На проверку"
        value={String(stats.needsHuman)}
        tone="bad"
      />
    </div>
  );
}
