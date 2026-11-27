/**
 * Кабинет: настройки аккаунта и состояние прайса.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ СТРАНИЦА
 *
 * Раньше в шапке стояли почта и «Выйти», а прайс можно было загрузить
 * только на экране расчёта — то есть настройка лежала поверх ежедневной
 * работы. Кабинет разделяет их: расчёт остаётся расчётом, а «как меня
 * видят» и «какой прайс используется» живут здесь.
 *
 * Композиция, а не своя логика: страница ничего не знает о полях и
 * загрузке файла, она только расставляет блоки. Так у неё нет причин
 * меняться, когда меняется форма.
 */
import { UserRound } from "lucide-react";
import { HeaderBar, HeaderBrand } from "@shared/ui/HeaderLayout";
import { UserMenu } from "@widgets/user-menu";
import { AccountSettings, PriceCard } from "@features/account-settings";

export interface AccountPageProps {
  user: { name: string; email: string; image: string | null };
  price: {
    hasOwnPrice: boolean;
    fileName: string | null;
    itemCount: number | null;
    uploadedAt: string | null;
    total: number;
  };
}

export function AccountPage({ user, price }: AccountPageProps) {
  return (
    <div className="min-h-screen bg-slate-50/70">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <HeaderBar>
          <HeaderBrand />
          <UserMenu user={user} />
        </HeaderBar>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-center gap-2.5">
          <UserRound className="h-5 w-5 text-accent-600" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Аккаунт</h1>
        </div>


        <div className="mt-8 space-y-6">
          <AccountSettings
            initialName={user.name}
            initialImage={user.image}
            email={user.email}
          />
          <PriceCard
            hasOwnPrice={price.hasOwnPrice}
            fileName={price.fileName}
            itemCount={price.itemCount}
            uploadedAt={price.uploadedAt}
            total={price.total}
          />
        </div>
      </main>
    </div>
  );
}