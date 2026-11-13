import { CheckCircle2, AlertTriangle, HelpCircle, Wallet, ArrowUpRight } from "lucide-react";
import { cn, formatMoney, formatNumber } from "@shared/lib/cn";
import type { EstimateStats } from "@entities/estimate/model/types";

interface SummaryCardsProps {
  stats: EstimateStats;
}

/**
 * Карточки-метрики.
 *
 * Главная карточка (итог) отличается от остальных: она в два раза шире
 * на десктопе и с синим акцентом. Это иерархия смысла, а не украшение —
 * менеджер первым делом смотрит на сумму.
 */
export function SummaryCards({ stats }: SummaryCardsProps) {
  const share = stats.total > 0 ? Math.round((stats.priced / stats.total) * 100) : 0;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* ── Главная: итог ───────────────────────────────── */}
      <div className="relative col-span-2 overflow-hidden rounded-2xl bg-slate-900 p-5 shadow-card lg:col-span-1">
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-accent-500/20 blur-2xl"
          aria-hidden
        />
        <div className="relative">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-accent-400" aria-hidden />
            <span className="text-2xs font-medium uppercase tracking-[0.12em] text-slate-400">
              Итог по КП
            </span>
          </div>

          {/* Суммы длинные: на узком экране уменьшаем кегль, а не ломаем вёрстку */}
          <p className="mt-3 truncate text-2xl font-semibold tracking-tight tabular text-white sm:text-3xl">
            {formatMoney(stats.totalSum)}
          </p>

          <div className="mt-3 flex items-center gap-2">
            {/* Полоска заполнения: доля позиций с ценой */}
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent-500 transition-[width] duration-700 ease-out-expo"
                style={{ width: `${share}%` }}
              />
            </div>
            <span className="text-2xs tabular text-slate-400">
              {formatNumber(stats.priced)}/{stats.total}
            </span>
          </div>
        </div>
      </div>

      <Card
        icon={CheckCircle2}
        label="Цена проставлена"
        value={String(stats.priced)}
        hint="позиций из прайса"
        tone="ok"
      />
      <Card
        icon={AlertTriangle}
        label="Нет в прайсе"
        value={String(stats.notFound)}
        hint="уточнит менеджер"
        tone="warn"
      />
      <Card
        icon={HelpCircle}
        label="На проверку"
        value={String(stats.needsHuman)}
        hint="неоднозначное совпадение"
        tone="bad"
      />
    </div>
  );
}

const TONES = {
  ok: { icon: "text-emerald-600 bg-emerald-50 ring-emerald-600/10", value: "text-slate-900" },
  warn: { icon: "text-amber-600 bg-amber-50 ring-amber-600/10", value: "text-slate-900" },
  bad: { icon: "text-rose-600 bg-rose-50 ring-rose-600/10", value: "text-slate-900" },
} as const;

function Card({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
  hint: string;
  tone: keyof typeof TONES;
}) {
  const t = TONES[tone];
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-inset",
            t.icon,
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <p className={cn("mt-3 text-2xl font-semibold tracking-tight tabular", t.value)}>
        {value}
      </p>
      <p className="truncate text-xs font-medium text-slate-700">{label}</p>
      <p className="mt-0.5 truncate text-2xs text-slate-400">{hint}</p>
    </div>
  );
}
