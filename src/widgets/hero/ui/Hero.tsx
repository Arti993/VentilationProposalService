import Link from "next/link";
import { ArrowRight, Sparkles, ShieldCheck, Zap } from "lucide-react";
import { HeroDemo } from "./HeroDemo";

/**
 * Первый экран.
 *
 * Устроен как «тезис + доказательство»: слева обещание в одну строку,
 * справа — живой результат на реальной смете. Заказчик не читает
 * описание, он смотрит на правую половину и понимает, что получит.
 *
 * Фон: сетка под маской и мягкое свечение. Без картинок — они весят
 * мегабайты и устаревают, а сетка даёт глубину и «инженерность».
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-20 sm:pt-36 lg:pt-40 lg:pb-28">
      {/* Подложка */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid mask-fade-edges" />
        <div className="absolute inset-x-0 top-0 h-[600px] bg-glow" />
      </div>

      <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:px-8">
        {/* ── Левая часть: текст ─────────────────────────── */}
        <div className="max-w-xl animate-slide-up">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 shadow-sm">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-emerald-500" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-medium text-slate-600">
              215 позиций в прайсе · работает
            </span>
          </div>

          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl lg:text-display">
            Коммерческое
            <br />
            предложение
            <span className="relative whitespace-nowrap text-accent-600">
              {" "}
              за минуту
            </span>
          </h1>

          <p className="mt-6 max-w-lg text-lg leading-relaxed text-slate-600">
            Загрузите смету клиента — сервис сопоставит каждую позицию с прайсом и
            соберёт готовый документ. Цена появляется только там, где совпадение
            однозначное.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/app" className="btn-primary btn-lg">
              Загрузить смету
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#how" className="btn-secondary btn-lg">
              Как это работает
            </a>
          </div>

          {/* Три коротких доказательства вместо длинного списка */}
          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-slate-200 pt-8">
            {[
              { icon: Zap, value: "~2 с", label: "на смету" },
              { icon: ShieldCheck, value: "0", label: "выдуманных цен" },
              { icon: Sparkles, value: "215", label: "позиций прайса" },
            ].map(({ icon: Icon, value, label }) => (
              <div key={label}>
                <Icon className="h-4 w-4 text-accent-600" aria-hidden />
                <dt className="mt-2.5 text-2xl font-semibold tracking-tight text-slate-900">
                  {value}
                </dt>
                <dd className="mt-0.5 text-xs text-slate-500">{label}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* ── Правая часть: живое демо ───────────────────── */}
        <div className="relative animate-slide-up-slow lg:pl-4">
          <HeroDemo />
        </div>
      </div>
    </section>
  );
}
