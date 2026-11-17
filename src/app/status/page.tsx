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

import Link from "next/link";
import { ArrowLeft, Activity } from "lucide-react";
import { productMetrics, type ProductMetrics } from "@/db/repositories/metrics";
import { Logo } from "@shared/ui/Logo";

export const dynamic = "force-dynamic";

/**
 * Кэш на минуту.
 *
 * Запрос делает полный проход по `estimates` и `estimate_positions`.
 * Таблицы небольшие, но страница публичная, и без кэша её можно
 * «обдолбить» запросами, нагрузив базу. Минута — компромисс: числа
 * выглядят живыми, база дышит.
 */
export const revalidate = 60;

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
    { key: "offtopic", label: "не по теме", value: m.positionsOffTopic, color: "bg-slate-300" },
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

export default async function StatusPage() {
  /**
   * Ошибка базы не должна давать 500 на публичной странице: посетитель
   * увидит белую страницу с кодом, и решит, что сервис не работает.
   * Лучше сказать честно, что метрики временно недоступны.
   */
  let metrics: ProductMetrics | null = null;
  let error: string | null = null;

  try {
    metrics = await productMetrics();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error("[status]", error);
  }

  return (
    <div className="min-h-screen bg-slate-50/70">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            На главную
          </Link>
          <Logo />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex items-center gap-2.5">
          <Activity className="h-5 w-5 text-accent-600" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Как работает сервис
          </h1>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
          Числа считаются из тех же таблиц, что и сама работа. Здесь нет ни
          одной цены, названия позиции или суммы по клиенту — только агрегаты.
        </p>

        {error && (
          <div
            className="mt-8 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            role="alert"
          >
            Метрики временно недоступны. Работа сервиса это не затрагивает —
            сметы считаются как обычно.
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
                label="решено без модели"
                hint="Точное совпадение по типу и размерам — мгновенно и бесплатно"
              />
              <StatCard
                value={formatMs(metrics.medianMs)}
                label="медиана обработки сметы"
                hint="От файла до готового КП"
              />
            </div>

            {/* ── Распределение ─────────────────────────────── */}
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                Что происходит с позициями
              </h2>
              <p className="mt-1 text-2xs leading-relaxed text-slate-500">
                Система ставит цену только при однозначном совпадении. Если
                непонятно — позиция уходит на проверку, а не получает
                случайную цену.
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
                label="синонимов выучено от менеджеров"
                hint="Подтверждённые разборы спорных строк"
              />
            </div>

            {/* ── Честность ────────────────────────────────── */}
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                Что эти числа значат
              </h2>
              <dl className="mt-3 space-y-3 text-sm leading-relaxed text-slate-600">
                <div>
                  <dt className="font-medium text-slate-800">
                    «решено без модели» — главная метрика
                  </dt>
                  <dd className="mt-0.5">
                    Детерминированный матчинг отвечает за {formatPercent(metrics.deterministicShare)}{" "}
                    позиций. Он бесплатен, мгновенен и одинаков при каждом
                    запуске. Модель подключается только там, где точное
                    совпадение не сработало, — и никогда не назначает цену
                    сама.
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-800">
                    Почему не 100% автоматически
                  </dt>
                  <dd className="mt-0.5">
                    Это осознанный выбор. Ошибочный матч дороже отсутствия
                    матча: по отсутствующей цене менеджер пойдёт уточнять, а
                    по ошибочной — выставит счёт. Поэтому спорные строки
                    остаются человеку.
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-800">
                    Откуда берутся синонимы
                  </dt>
                  <dd className="mt-0.5">
                    Менеджер разбирает спорную строку и подтверждает, какая
                    позиция прайса имелась в виду. Из таких пар собирается
                    словарь организации: в следующий раз система найдёт цену
                    сама.
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
          <p className="mt-8 text-sm text-slate-500">Считаю метрики…</p>
        )}
      </main>
    </div>
  );
}
