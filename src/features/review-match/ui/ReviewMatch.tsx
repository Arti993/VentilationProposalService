"use client";

/**
 * Разбор спорной позиции сметы.
 *
 * КОГДА ПОКАЗЫВАЕТСЯ
 *
 * Когда система отказалась ставить цену (`not_found`, `needs_human`). Это
 * не ошибка: так работает главное правило проекта — ошибочный матч
 * опаснее отсутствия матча. Но менеджер всё равно разбирает эти строки
 * руками, и здесь мы сохраняем его решение, чтобы в следующий раз система
 * справилась сама.
 *
 * ЧТО ПОЛУЧАЕТСЯ НА ВЫХОДЕ
 *
 * Пара «как написал клиент → код позиции прайса». Из подтверждённых пар
 * собирается словарь синонимов организации. Цена в КП при этом НЕ
 * меняется: правил ради обучения словаря, а не ради подстановки.
 *
 * ПОЧЕМУ НЕ АВТОМАТИЧЕСКИ
 *
 * Можно было бы «применять» разбор сразу, без кнопки. Но тогда одна
 * случайная ошибка менеджера навсегда переписала бы слово во всех
 * будущих сметах организации. Подтверждение стоит один клик и снимает
 * этот риск.
 */

import { useMemo, useState } from "react";
import { Check, X, Search, Loader2, Lightbulb } from "lucide-react";
import { cn } from "@shared/lib/cn";
import type { EstimatePosition } from "@entities/estimate/model/types";
import type { PriceItem } from "@features/upload-price/api/client";
import { submitFeedback } from "../api/client";

interface ReviewMatchProps {
  position: EstimatePosition;
  /** Прайс организации — чтобы предложить, из чего выбирать */
  price: PriceItem[];
  estimateId?: string;
}

/** Сколько прайса показывать до фильтрации: длинный список бесполезен. */
const VISIBLE_ITEMS = 6;

/**
 * Простое совпадение по словам — только подсказка, не решение.
 *
 * Полноценный матчинг здесь намеренно не используется: если бы подсказка
 * предлагала готовый ответ, менеджер соглашался бы не глядя, и словарь
 * заполнялся бы догадками. Здесь задача — сократить прокрутку, а выбор
 * остаётся за человеком.
 */
function suggest(price: PriceItem[], name: string): PriceItem[] {
  const words = name
    .toLowerCase()
    .replace(/[^а-яёa-z0-9\s/-]/g, " ")
    .split(/[\s/]+/)
    .filter((w) => w.length >= 4);

  const scored = price.map((p) => {
    const hay = p.rawName.toLowerCase();
    const dims = p.dims.join("/");
    let score = 0;
    for (const w of words) if (hay.includes(w)) score += 2;
    if (dims && name.includes(dims)) score += 5;
    return { p, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, VISIBLE_ITEMS)
    .map((s) => s.p);
}

export function ReviewMatch({ position, price, estimateId }: ReviewMatchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<PriceItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggested = useMemo(
    () => (open ? suggest(price, position.name) : []),
    [open, price, position.name],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suggested;
    return price
      .filter((p) => p.rawName.toLowerCase().includes(q) || p.dims.join("/").includes(q))
      .slice(0, VISIBLE_ITEMS);
  }, [query, suggested, price]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await submitFeedback({
        rawText: position.name,
        chosenCode: chosen?.id ?? null,
        estimateId: estimateId ?? null,
        posNo: position.posNo,
        // Что система предполагала: `matchedName` есть у неоднозначных,
        // у полностью ненайденных его нет.
        guessCode: null,
      });
      setDone(true);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-2xs text-emerald-700">
        <Check className="h-3 w-3" aria-hidden />
        Спасибо — учтём в следующих сметах
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 text-2xs font-medium text-accent-700 underline-offset-2 hover:underline"
      >
        <Lightbulb className="h-3 w-3" aria-hidden />
        Подсказать правильную позицию
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs font-medium text-slate-700">
          Какая позиция прайса подходит?
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-slate-400 hover:text-slate-600"
          aria-label="Закрыть"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="relative mt-2">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по названию или размеру"
          className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-accent-400 focus:ring-2 focus:ring-accent-100"
        />
      </div>

      <ul className="mt-2 space-y-1">
        {filtered.length === 0 && (
          <li className="px-1 py-2 text-2xs text-slate-500">
            Похожих позиций нет. Уточните запрос или отметьте, что позиции в прайсе нет.
          </li>
        )}
        {filtered.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setChosen(p)}
              className={cn(
                "w-full rounded-lg border px-2.5 py-1.5 text-left text-2xs transition-colors",
                chosen?.id === p.id
                  ? "border-accent-400 bg-accent-50 text-accent-900"
                  : "border-transparent bg-white hover:border-slate-200",
              )}
            >
              <span className="font-medium text-slate-800">{p.rawName}</span>
              <span className="ml-1.5 tabular text-slate-500">{p.price} ₽</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-2xs font-medium text-white disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Check className="h-3 w-3" aria-hidden />
          )}
          {chosen ? "Сохранить выбор" : "Позиции в прайсе нет"}
        </button>
        {chosen && (
          <button
            type="button"
            onClick={() => setChosen(null)}
            className="text-2xs text-slate-500 hover:text-slate-700"
          >
            Сбросить
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2 text-2xs text-rose-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
