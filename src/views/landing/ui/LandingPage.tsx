import { SiteHeader } from "@widgets/site-header";
import { Hero } from "@widgets/hero";
import { HowItWorks } from "@widgets/how-it-works";
import { Features } from "@widgets/features";
import { Precision } from "@widgets/precision";
import { Faq } from "@widgets/faq";
import { CallToAction } from "@widgets/call-to-action";
import { SiteFooter } from "@widgets/site-footer";

/**
 * Главная страница — лендинг.
 *
 * Порядок блоков повторяет путь сомневающегося заказчика:
 *
 *   1. Hero         — что это и как выглядит результат
 *   2. HowItWorks   — насколько просто (снимаем страх сложности)
 *   3. Features     — что ещё умеет
 *   4. Precision    — почему можно доверять (главное возражение)
 *   5. Faq          — остальные возражения
 *   6. CallToAction — попробовать
 *
 * Секции «Стек» здесь больше нет. Заказчику, который выбирает, чем
 * посчитать смету, названия библиотек ничего не говорят: Next.js и
 * Drizzle — не аргумент в пользу цены или точности. Тем, кому это
 * действительно важно, — разработчикам и тому, кто будет проект
 * поддерживать, — это место в README, где рядом лежат команды запуска.
 *
 * Блок про точность стоит выше технических деталей: сначала снимаем
 * тревогу «а вдруг ошибётся», потом всё остальное.
 */
export function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <Precision />
        <Faq />
        <CallToAction />
      </main>
      <SiteFooter />
    </>
  );
}
