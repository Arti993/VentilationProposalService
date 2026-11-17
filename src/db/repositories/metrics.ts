/**
 * Продуктовые метрики для публичной страницы `/status`.
 *
 * ЗАЧЕМ ПУБЛИЧНО
 *
 * «Работает хорошо» — это не аргумент. Аргумент — «92% позиций получают
 * цену автоматически, медиана обработки сметы 3.4 секунды, из 412
 * загруженных смет 380 ушли клиенту». Такие числа невозможно подделать,
 * не соврав, а соврать в них легко — поэтому они считаются из тех же
 * таблиц, что и сама работа.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ
 *
 * **Никаких цен и названий.** Метрики агрегированы до чисел: сколько
 * смет, какой процент, сколько секунд. Названия позиций и суммы по
 * конкретным клиентам — это их данные, и публичная страница их не
 * показывает. Даже сумма «всего выставлено на 4.2 млн ₽» раскрывает
 * масштаб бизнеса клиента, поэтому её нет.
 *
 * **Ничего про отдельных пользователей.** Только итоги по всей системе.
 *
 * ПОЧЕМУ ОДИН БОЛЬШОЙ ЗАПРОС, А НЕ ПЯТЬ
 *
 * Каждый round-trip до пулера Neon — десятки миллисекунд, а страница
 * открывается часто и должна быть быстрой. Поэтому агрегаты собираются
 * одним запросом с несколькими CTE, а не пятью отдельными.
 *
 * Запрос тяжёлый (полный проход по `estimates` и `estimate_positions`),
 * но таблицы небольшие, а страница кэшируется на минуту — этого
 * достаточно, чтобы не нагружать базу.
 */
import { withRetry } from "../connection.ts";

export interface ProductMetrics {
  /** Сколько смет обработано всего */
  estimatesTotal: number;
  /** Сколько смет за последние 7 дней */
  estimatesWeek: number;

  /** Сколько позиций прошло через систему */
  positionsTotal: number;
  /** Позиции с ценой */
  positionsPriced: number;
  /** Не нашлись в прайсе */
  positionsNotFound: number;
  /** Требуют решения менеджера */
  positionsNeedsHuman: number;
  /** Не про оборудование (вопросы, мусор) */
  positionsOffTopic: number;

  /**
   * Доля позиций, получивших цену автоматически.
   * Считается по ПОЗИЦИЯМ, а не по сметам: смета из 100 строк с одной
   * ненайденной — это 99% работы, а не «смета с проблемой».
   */
  pricedShare: number;

  /**
   * Сколько позиций решено БЕЗ модели.
   *
   * Это главная метрика архитектуры: детерминированный матчинг бесплатен
   * и мгновенен, LLM стоит денег и секунд. Чем выше доля, тем дешевле
   * система в работе.
   */
  deterministicShare: number;

  /** Медиана и p90 времени обработки сметы, мс */
  medianMs: number | null;
  p90Ms: number | null;

  /** Сколько организаций с загруженным прайсом */
  orgsWithPrice: number;
  /** Сколько позиций в прайсах всего */
  priceItemsTotal: number;

  /** Разборы менеджеров: всего и подтверждённых в словарь */
  feedbackTotal: number;
  feedbackApplied: number;

  /** Когда считалось — чтобы страница честно показывала актуальность */
  computedAt: Date;
}

/** Сырая строка агрегата. Имена в snake_case, как отдаёт Postgres. */
interface RawMetrics {
  estimates_total: number;
  estimates_week: number;
  positions_total: number;
  positions_priced: number;
  positions_not_found: number;
  positions_needs_human: number;
  positions_off_topic: number;
  deterministic_total: number;
  median_ms: number | null;
  p90_ms: number | null;
  orgs_with_price: number;
  price_items_total: number;
  feedback_total: number;
  feedback_applied: number;
}

/**
 * Собирает все метрики.
 *
 * ВРЕМЯ ОБРАБОТКИ — ИЗ `parse_ms`, А НЕ ИЗ РАЗНИЦЫ ДАТ
 *
 * Первая версия считала медиану как `notified_at - created_at`. На живой
 * базе это дало «4 017 377 мс» — 67 минут. Причина: `notified_at` это
 * когда смету забрал n8n, а не когда её разобрали. Метрика врала в
 * тысячу раз, и заметить это можно было только глазами.
 *
 * Теперь время пишется в `parse_ms` в момент разбора (миграция 0007).
 * `null` у старых строк — медиана считается по тем, где значение есть:
 * меньше данных честнее подставленных нулей.
 */
export async function productMetrics(): Promise<ProductMetrics> {
  const rows = await withRetry(
    (sql) =>
      sql<RawMetrics[]>`
        with est as (
          select id, created_at, parse_ms
            from estimates
        ),
        pos as (
          select p.status, p.source, p.estimate_id
            from estimate_positions p
        ),
        price as (
          select org_id, count(*)::int as n
            from price_items
           group by org_id
        ),
        fb as (
          select status from match_feedback
        )
        select
          (select count(*)::int from est) as estimates_total,
          (select count(*)::int from est where created_at > now() - interval '7 days') as estimates_week,
          (select count(*)::int from pos) as positions_total,
          (select count(*)::int from pos where status = 'priced') as positions_priced,
          (select count(*)::int from pos where status = 'not_found') as positions_not_found,
          (select count(*)::int from pos where status = 'needs_human') as positions_needs_human,
          (select count(*)::int from pos where status = 'off_topic') as positions_off_topic,
          (select count(*)::int from pos where source = 'deterministic') as deterministic_total,
          (
            select percentile_cont(0.5) within group (order by parse_ms)::int
              from est
             where parse_ms is not null
          ) as median_ms,
          (
            select percentile_cont(0.9) within group (order by parse_ms)::int
              from est
             where parse_ms is not null
          ) as p90_ms,
          (select count(*)::int from price) as orgs_with_price,
          (select coalesce(sum(n), 0)::int from price) as price_items_total,
          (select count(*)::int from fb) as feedback_total,
          (select count(*)::int from fb where status = 'applied') as feedback_applied
      `,
    { label: "продуктовые метрики", heavy: true, timeoutMs: 30_000 },
  );

  const r = rows[0];
  if (!r) {
    // Пустая база — это не ошибка: на свежей установке метрик просто нет
    return {
      estimatesTotal: 0,
      estimatesWeek: 0,
      positionsTotal: 0,
      positionsPriced: 0,
      positionsNotFound: 0,
      positionsNeedsHuman: 0,
      positionsOffTopic: 0,
      pricedShare: 0,
      deterministicShare: 0,
      medianMs: null,
      p90Ms: null,
      orgsWithPrice: 0,
      priceItemsTotal: 0,
      feedbackTotal: 0,
      feedbackApplied: 0,
      computedAt: new Date(),
    };
  }

  /** Доля с защитой от деления на ноль: на пустой базе позиций 0. */
  const share = (part: number, total: number) => (total > 0 ? part / total : 0);

  return {
    estimatesTotal: r.estimates_total,
    estimatesWeek: r.estimates_week,
    positionsTotal: r.positions_total,
    positionsPriced: r.positions_priced,
    positionsNotFound: r.positions_not_found,
    positionsNeedsHuman: r.positions_needs_human,
    positionsOffTopic: r.positions_off_topic,
    pricedShare: share(r.positions_priced, r.positions_total),
    deterministicShare: share(r.deterministic_total, r.positions_total),
    medianMs: r.median_ms,
    p90Ms: r.p90_ms,
    orgsWithPrice: r.orgs_with_price,
    priceItemsTotal: r.price_items_total,
    feedbackTotal: r.feedback_total,
    feedbackApplied: r.feedback_applied,
    computedAt: new Date(),
  };
}
