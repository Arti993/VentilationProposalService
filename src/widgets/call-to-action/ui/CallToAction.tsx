import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Финальный призыв.
 *
 * Последний блок перед футером: синяя плашка во всю ширину. Единственное
 * место с насыщенным синим фоном — так он работает как акцент, а не как
 * фон. Если залить синим три секции подряд, перестаёт выделяться любая.
 */
export function CallToAction() {
  return (
    <section className="px-5 pb-24 lg:px-8 lg:pb-32">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-4xl bg-accent-600 px-8 py-16 shadow-lift sm:px-14 lg:py-20">
        {/* Сетка на синем: та же текстура, что на первом экране, но инвертированная */}
        <div className="pointer-events-none absolute inset-0 bg-grid-dark opacity-60 mask-fade-edges" aria-hidden />

        {/* Свечение в углу добавляет объём, чтобы плашка не выглядела плоской */}
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-3xl"
          aria-hidden
        />

        <div className="relative flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center">
          <div className="max-w-xl">
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Проверьте на своей смете
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-accent-50/90">
              Загрузите файл и получите КП за пару секунд. Без регистрации,
              без настройки — демонстрационные сметы уже готовы.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-3">
            <Link href="/app" className="btn-inverse btn-lg">
              Открыть приложение
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
