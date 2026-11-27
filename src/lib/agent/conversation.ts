import { createHash } from "node:crypto";

/** Scope price-only conversations to the authenticated user and organization.
 * The client nonce is never a database conversation ID or an ownership claim.
 */
export function priceConversationId(nonce: string, userId: string, orgId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce)) {
    throw new Error("Некорректный идентификатор диалога.");
  }
  return "price:" + createHash("sha256").update(JSON.stringify([userId, orgId, nonce])).digest("hex");
}
