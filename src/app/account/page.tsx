import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/guard";
import { isDemoOrg } from "@/lib/auth/org";
import { countPrice } from "@/db/repositories/price";
import { getPriceMeta } from "@/db/repositories/priceMeta";
import { AccountPage } from "@views/account";

/**
 * Кабинет доступен только вошедшим.
 *
 * Гостю здесь нечего делать: ни имени, ни аватара, ни своего прайса у него
 * нет. `redirect`, а не пустая страница с приглашением — после входа
 * человек вернётся туда, куда шёл.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Аккаунт",
  description: "Имя, аватар и загруженный прайс организации.",
};

export default async function AccountRoute() {
  const actor = await getActor();
  if (!actor || actor.isAnonymous) redirect("/login");

  const orgId = actor.orgId;
  const [total, meta] = await Promise.all([
    orgId ? countPrice(orgId) : Promise.resolve(0),
    orgId ? getPriceMeta(orgId) : Promise.resolve(null),
  ]);

  /**
   * «Свой прайс» = не демо и есть позиции.
   *
   * Та же формула, что в `/api/price/upload`: расчёт по демо-прайсу — это
   * не «прайс загружен», хотя позиций там 215.
   */
  const hasOwnPrice = Boolean(orgId) && !isDemoOrg(orgId) && total > 0;

  return (
    <AccountPage
      user={{
        name: actor.name || actor.email || "Без имени",
        email: actor.email ?? "",
        image: actor.image,
      }}
      price={{
        hasOwnPrice,
        fileName: meta?.fileName ?? null,
        itemCount: meta?.itemCount ?? null,
        uploadedAt: meta?.uploadedAt?.toISOString() ?? null,
        total,
      }}
    />
  );
}