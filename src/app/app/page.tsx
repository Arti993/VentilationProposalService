import { ProposalPage } from "@views/proposal";

export const metadata = {
  title: "Приложение — КП по смете",
  description: "Загрузите смету клиента и получите коммерческое предложение.",
};

// Форма не содержит приватных данных и доступна сразу из статической страницы.
// Сессию для меню читает UserMenu; API отдельно проверяют доступ к данным.
export default function AppPage() {
  return <ProposalPage />;
}
