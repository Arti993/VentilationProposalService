import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
 *
 * Чего здесь намеренно НЕТ:
 *
 *  - Плашки «215 позиций в прайсе · работает» с пульсирующей точкой.
 *    Приём с зелёной точкой «всё работает» уместен в статус-панели
 *    сервиса, а на витрине читается как декорация: посетителю не
 *    важно, что процесс запущен, ему важно, что он получит.
 *
 *  - Ряда из трёх цифр под кнопками. «~2 с», «0 выдуманных цен»,
 *    «215 позиций» — все три либо повторяют то, что уже сказано
 *    словами, либо не проверяемы посетителем. Цифры, которые нельзя
 *    подтвердить, работают против доверия, а не за него.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden pt-28 pb-16 sm:pt-32 lg:pt-40 lg:pb-28">
      {/* Подложка */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid mask-fade-edges" />
        <div className="absolute inset-x-0 top-0 h-[600px] bg-glow" />
      </div>

      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:px-8">
        {/* ── Левая часть: текст ─────────────────────────── */}
        <div className="max-w-xl animate-slide-up">
          <h1 className="text-[2rem] font-semibold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl lg:text-display">
            Коммерческое предложение{" "}
            <span className="text-accent-600">за минуту</span>
          </h1>

          <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-600 sm:mt-6 sm:text-lg">
            Загрузите смету клиента — сервис сопоставит каждую позицию с прайсом и
            соберёт готовый документ. Цена появляется только там, где совпадение
            однозначное.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/app" className="btn-primary btn-lg w-full sm:w-auto">
              Загрузить смету
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#how" className="btn-secondary btn-lg w-full sm:w-auto">
              Как это работает
            </a>
          </div>
        </div>

        {/* ── Правая часть: живое демо ───────────────────── */}
        <div className="relative animate-slide-up-slow lg:pl-4">
          <HeroDemo />
        </div>
      </div>
    </section>
  );
}
