import { SiteHeader } from "@widgets/site-header";
import { Hero } from "@widgets/hero";
import { HowItWorks } from "@widgets/how-it-works";
import { Features } from "@widgets/features";
import { Precision } from "@widgets/precision";
import { Stack } from "@widgets/stack";
import { Faq } from "@widgets/faq";
import { CallToAction } from "@widgets/call-to-action";
import { SiteFooter } from "@widgets/site-footer";

/**
 * Главная страница — лендинг.
 *
 * Порядок блоков неслучаен и повторяет путь сомневающегося заказчика:
 *
 *   1. Hero        — что это и как выглядит результат (доказательство сразу)
 *   2. HowItWorks  — насколько это просто (снимаем страх сложности)
 *   3. Features    — что ещё умеет (расширяем ценность)
 *   4. Precision   — почему можно доверять (главное возражение)
 *   5. Stack       — на чём сделано (для технического директора)
 *   6. Faq         — остальные возражения
 *   7. CallToAction— попробовать
 *
 * Возражение «а вдруг ошибётся» стоит выше технических деталей: сначала
 * снимаем тревогу, потом показываем глубину.
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
        <Stack />
        <Faq />
        <CallToAction />
      </main>
      <SiteFooter />
    </>
  );
}
