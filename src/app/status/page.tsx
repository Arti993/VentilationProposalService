/**
 * `/status` — публичные продуктовые метрики.
 *
 * ЗАЧЕМ ПУБЛИЧНО
 *
 * «Работает хорошо» — не аргумент. Аргумент — «70% позиций получают цену
 * автоматически, медиана обработки 1.2 секунды, 87% решений приняты без
 * модели». Такие числа невозможно подделать, не соврав: они считаются
 * из тех же таблиц, что и сама работа.
 *
 * ЧЕГО ЗДЕСЬ НЕТ
 *
 * Ни одной цены, названия позиции или суммы по клиенту. Только агрегаты.
 * Даже «всего выставлено на 4.2 млн ₽» раскрыло бы масштаб бизнеса
 * клиента, поэтому этой цифры нет.
 *
 * ПОЧЕМУ СЕРВЕРНЫЙ КОМПОНЕНТ
 *
 * Метрики считаются одним SQL-запросом на сервере. Если бы страница была
 * клиентской, пришлось бы отдавать их через API — а это лишний маршрут,
 * который надо защищать и кэшировать отдельно.
 *
 * `dynamic = "force-dynamic"` обязателен: без него Next.js попытается
 * отрендерить страницу при сборке, база будет недоступна, и сборка упадёт.
 */

import { Activity } from "lucide-react";
import { Suspense } from "react";
import { unstable_cache } from "next/cache";
import { productMetrics, type ProductMetrics } from "@/db/repositories/metrics";
import { HeaderBar, HeaderBrand } from "@shared/ui/HeaderLayout";
import { UserMenu } from "@widgets/user-menu";

export const dynamic = "force-dynamic";

/**
 * Кэш на минуту.
 *
 * Запрос делает полный проход по `estimates` и `estimate_positions`.
 * Таблицы небольшие, но страница публичная, и без кэша её можно
 * «обдолбить» запросами, нагрузив базу. Минута — компромисс: числа
 * выглядят живыми, база дышит.
 */
const cachedMetrics = unstable_cache(productMetrics, ["public-product-metrics"], { revalidate: 60 });

/** Форматирует миллисекунды в человекочитаемое время. */
function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} мс`;
  return `${(ms / 1000).toFixed(1)} с`;
}

function formatPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function formatNumberRu(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

/** Одна крупная цифра с подписью. */
function StatCard({
  value,
  label,
  hint,
  accent = false,
}: {
  value: string;
  label: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p
        className={
          accent
            ? "text-3xl font-semibold tracking-tight text-accent-600 tabular"
            : "text-3xl font-semibold tracking-tight text-slate-900 tabular"
        }
      >
        {value}
      </p>
      <p className="mt-1.5 text-sm font-medium text-slate-700">{label}</p>
      {hint && <p className="mt-1 text-2xs leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}

/** Полоса распределения статусов. */
function DistributionBar({ m }: { m: ProductMetrics }) {
  const total = m.positionsTotal || 1;

  const segments = [
    { key: "priced", label: "с ценой", value: m.positionsPriced, color: "bg-emerald-500" },
    { key: "human", label: "на проверку", value: m.positionsNeedsHuman, color: "bg-amber-500" },
    { key: "notfound", label: "нет в прайсе", value: m.positionsNotFound, color: "bg-slate-400" },
    { key: "offtopic", label: "прочие строки", value: m.positionsOffTopic, color: "bg-slate-300" },
  ].filter((s) => s.value > 0);

  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
        {segments.map((s) => (
          <div
            key={s.key}
            className={s.color}
            style={{ width: `${(s.value / total) * 100}%` }}
            title={`${s.label}: ${formatNumberRu(s.value)}`}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-2xs text-slate-600">
            <span className={`h-2 w-2 rounded-full ${s.color}`} aria-hidden />
            {s.label}
            <span className="tabular font-medium text-slate-900">
              {formatNumberRu(s.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetricsSkeleton() {
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-3" role="status" aria-label="Загрузка статистики">
      {[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-200/60" aria-hidden />)}
      <span className="sr-only">Загружаем статистику…</span>
    </div>
  );
}

async function StatusMetrics() {
  let metrics: ProductMetrics | null = null;
  let error: string | null = null;

  try {
    const saved = await cachedMetrics();
    metrics = { ...saved, computedAt: new Date(saved.computedAt) };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error("[status]", error);
  }

  return <>
        {error && (
          <div
            className="mt-8 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            role="alert"
          >
            Статистика временно недоступна. Обновите страницу позже.
          </div>
        )}

        {metrics && (
          <>
            {/* ── Главные цифры ─────────────────────────────── */}
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <StatCard
                value={formatPercent(metrics.pricedShare)}
                label="позиций получили цену"
                hint="Из всех, что прошли через сервис"
                accent
              />
              <StatCard
                value={formatPercent(metrics.deterministicShare)}
                label="сопоставлено по точным параметрам"
                hint="Соответствие по типу оборудования и размерам"
              />
              <StatCard
                value={formatMs(metrics.medianMs)}
                label="медиана обработки сметы"
                hint="От загрузки файла до результата расчёта"
              />
            </div>

            {/* ── Распределение ─────────────────────────────── */}
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                Результаты сопоставления
              </h2>
              <p className="mt-1 text-2xs leading-relaxed text-slate-500">
                Цены рассчитаны для позиций с однозначным соответствием в прайсе. Остальные строки требуют проверки или уточнения стоимости.
              </p>
              <div className="mt-4">
                <DistributionBar m={metrics} />
              </div>
            </section>

            {/* ── Вторая строка ─────────────────────────────── */}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <StatCard
                value={formatNumberRu(metrics.estimatesTotal)}
                label="смет обработано"
                hint={`${formatNumberRu(metrics.estimatesWeek)} за последние 7 дней`}
              />
              <StatCard
                value={formatNumberRu(metrics.positionsTotal)}
                label="позиций разобрано"
                hint="Каждая строка сверена с прайсом"
              />
              <StatCard
                value={formatNumberRu(metrics.orgsWithPrice)}
                label="организаций со своим прайсом"
                hint={`${formatNumberRu(metrics.priceItemsTotal)} позиций в прайсах`}
              />
              <StatCard
                value={formatNumberRu(metrics.feedbackApplied)}
                label="уточнений учтено в расчётах"
                hint="Сохранённые соответствия позиций прайса"
              />
            </div>

            {/* ── Честность ────────────────────────────────── */}
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                О показателях
              </h2>
              <dl className="mt-3 space-y-3 text-sm leading-relaxed text-slate-600">
                <div>
                  <dt className="font-medium text-slate-800">
                    Точное сопоставление
                  </dt>
                  <dd className="mt-0.5">
                    Для {formatPercent(metrics.deterministicShare)}{" "} позиций найдено соответствие по точным параметрам. Для остальных выполняется дополнительный поиск подходящих вариантов.
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-800">
                    Проверка спорных позиций
                  </dt>
                  <dd className="mt-0.5">
                    Если данных недостаточно для однозначного соответствия, строка передаётся на проверку менеджеру. Цена не подставляется до уточнения.
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-800">
                    Уточнения менеджеров
                  </dt>
                  <dd className="mt-0.5">
                    Подтверждённые соответствия сохраняются для организации и используются при обработке следующих смет.
                  </dd>
                </div>
              </dl>
            </section>

            <p className="mt-8 text-2xs text-slate-400">
              Обновлено{" "}
              {new Intl.DateTimeFormat("ru-RU", {
                dateStyle: "long",
                timeStyle: "short",
                timeZone: "Europe/Moscow",
              }).format(metrics.computedAt)}
            </p>
          </>
        )}

        {!metrics && !error && (
          <p className="mt-8 text-sm text-slate-500">Загрузка статистики…</p>
        )}
  </>;
}

export default function StatusPage() {
  return (
    <div className="min-h-screen bg-slate-50/70">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <HeaderBar>
          <HeaderBrand />
          <UserMenu />
        </HeaderBar>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex items-center gap-2.5">
          <Activity className="h-5 w-5 text-accent-600" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Статистика сервиса
          </h1>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
          Общая статистика обработки смет. Данные об отдельных клиентах, оборудовании и стоимости заказов не публикуются.
        </p>

        <Suspense fallback={<MetricsSkeleton />}>
          <StatusMetrics />
        </Suspense>
      </main>
    </div>
  );
}
