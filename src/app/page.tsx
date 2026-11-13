import { LandingPage } from "@views/landing";

/**
 * Главная страница.
 *
 * app-слой только связывает роут с view: никакой логики здесь нет.
 * Так роут остаётся тонким, а страницу можно переиспользовать в
 * другом окружении — например, в сторибуке или при A/B-тесте.
 */
export default function Page() {
  return <LandingPage />;
}
