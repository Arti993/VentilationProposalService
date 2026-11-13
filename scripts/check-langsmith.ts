/**
 * Проверяет ключ LangSmith и доступность API.
 *
 * Запуск: node --env-file=.env.local scripts/check-langsmith.ts
 *
 * Зачем отдельно: если ключ неверный или сеть недоступна, трейсинг молча
 * не работает — SDK проглатывает ошибки, чтобы не ломать обработку.
 * Тогда легко решить, что «трасс нет, потому что их не видно», хотя
 * на самом деле они не отправлялись вовсе.
 */
const KEY = process.env.LANGCHAIN_API_KEY ?? "";
const BASE = process.env.LANGCHAIN_ENDPOINT ?? "https://api.smith.langchain.com";

async function main() {
  console.log("=== Конфигурация ===");
  console.log(`  endpoint: ${BASE}`);
  console.log(`  ключ:     ${KEY ? `${KEY.slice(0, 12)}…${KEY.slice(-6)} (${KEY.length} симв.)` : "НЕ ЗАДАН"}`);
  console.log(`  проект:   ${process.env.LANGCHAIN_PROJECT ?? "default"}`);
  console.log(`  трейсинг: ${process.env.LANGCHAIN_TRACING_V2}`);

  if (!KEY) {
    console.log("\nКлюч не задан — проверять нечего.");
    process.exitCode = 1;
    return;
  }

  console.log("\n=== GET /info (проверка ключа) ===");
  const t = Date.now();
  try {
    const res = await fetch(`${BASE}/info`, {
      headers: { "x-api-key": KEY },
      signal: AbortSignal.timeout(20_000),
    });
    const ms = Date.now() - t;
    const body = await res.text();
    console.log(`  HTTP ${res.status} за ${ms} мс`);
    console.log(`  тело: ${body.slice(0, 300)}`);

    if (res.ok) {
      console.log("\n  ✓ ключ рабочий, API доступен");
    } else if (res.status === 401 || res.status === 403) {
      console.log("\n  ✗ ключ отклонён (401/403). Проверьте, что он от того тенанта");
      process.exitCode = 1;
    } else {
      console.log(`\n  ? неожиданный статус ${res.status}`);
      process.exitCode = 1;
    }
  } catch (e) {
    const err = e as Error;
    console.log(`  ✗ ОШИБКА за ${Date.now() - t} мс: ${err.message}`);
    if (err.name === "TimeoutError") {
      console.log("  Похоже, сеть до LangSmith недоступна (таймаут).");
      console.log("  Так же было с *.vercel.app — блокировка на уровне провайдера.");
    }
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
