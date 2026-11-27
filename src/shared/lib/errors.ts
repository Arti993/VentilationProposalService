/** Сетевые ошибки браузера и ошибки чтения ответа заменяем понятным сообщением. */
export function requestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof TypeError || error instanceof SyntaxError) return fallback;
  return error instanceof Error ? error.message : fallback;
}
