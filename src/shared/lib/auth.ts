/** Флаг может отсутствовать у старых демо-сессий; домен задан в плагине anonymous. */
export function isAnonymousUser(user: {
  isAnonymous?: boolean | null;
  email?: string | null;
}): boolean {
  return user.isAnonymous === true || (user.email ?? "").toLowerCase().endsWith("@anon.local");
}
