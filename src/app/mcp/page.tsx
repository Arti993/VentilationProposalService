/**
 * `/mcp` — как подключить сервис к Claude, ChatGPT или Cursor.
 *
 * ЗАЧЕМ СТРАНИЦА
 *
 * MCP-сервер бесполезен, если никто не знает, как его подключить.
 * Читателю (работодателю, менеджеру) нужны три вещи: адрес, токен и
 * готовый кусок конфигурации, который можно скопировать целиком.
 *
 * ПОЧЕМУ КОНФИГУРАЦИЯ ДЛЯ КАЖДОГО ХОСТА ОТДЕЛЬНО
 *
 * Формат `mcpServers` пришёл из Claude Desktop, но раскладка отличается:
 * Cursor ждёт файл в проекте или в настройках, ChatGPT подключает
 * удалённые серверы через интерфейс, а не через JSON. Один «универсальный»
 * пример не сработал бы нигде.
 */
import Link from "next/link";
import { ArrowLeft, Server, Shield, Wrench } from "lucide-react";
import { Logo } from "@shared/ui/Logo";
import { UserMenu } from "@widgets/user-menu";

/**
 * Адрес сервера берётся из окружения, а не зашит строкой.
 *
 * Когда появится свой домен, достаточно поменять `NEXT_PUBLIC_SITE_URL`,
 * и инструкция обновится вместе с ним. Зашитый адрес пришлось бы искать
 * по файлам.
 */
const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ventilation-proposal-service.vercel.app";
const MCP_URL = `${BASE}/api/mcp`;

/** Инструменты — те же, что в `src/lib/mcp/server.ts`. */
const TOOLS = [
  {
    name: "search_price",
    what: "Ищет позиции в прайсе по смыслу",
    example: "«что есть по отводам 250?»",
  },
  {
    name: "match_line",
    what: "Сопоставляет одну строку сметы с прайсом",
    example: "«сопоставь: воздуховод 315»",
  },
  {
    name: "explain_position",
    what: "Объясняет, почему строка КП получила такой статус",
    example: "«почему № 14 без цены?»",
  },
  {
    name: "get_proposal",
    what: "Сводка готового КП: сколько позиций, где проблемы",
    example: "«покажи итоги сметы»",
  },
  {
    name: "list_proposals",
    what: "Журнал отправленных КП по стадиям",
    example: "«что отправляли на этой неделе?»",
  },
  {
    name: "sales_funnel",
    what: "Воронка сделок: сколько на каждом этапе и на какую сумму",
    example: "«как дела с воронкой?»",
  },
];

/** JSON-конфигурация для Claude Desktop и Cursor. */
const CONFIG_SNIPPET = `{
  "mcpServers": {
    "kp-service": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer ВАШ_ТОКЕН"
      }
    }
  }
}`;

function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
      {label && (
        <div className="border-b border-white/10 px-4 py-2 text-2xs font-medium uppercase tracking-wider text-slate-400">
          {label}
        </div>
      )}
      {/* overflow-x-auto: длинные строки не должны растягивать страницу на телефоне */}
      <pre className="overflow-x-auto px-4 py-3.5 text-xs leading-relaxed text-slate-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function McpPage() {
  return (
    <div className="min-h-screen bg-slate-50/70">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            На главную
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block">
              <Logo />
            </span>
            {/*
              Страница статическая, поэтому сессию спрашивает сам `UserMenu`
              в браузере. До ответа — заглушка того же размера.
            */}
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex items-center gap-2.5">
          <Server className="h-5 w-5 text-accent-600" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            MCP-сервер
          </h1>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
          Сервис работает внутри Claude, ChatGPT и Cursor по протоколу MCP.
          Кидаете смету в чат и пишете «сделай КП» — ассистент сам разбирает
          строки и достаёт цены из прайса.
        </p>

        {/* ── Главный принцип ─────────────────────────────── */}
        <div className="mt-6 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <p className="text-sm leading-relaxed text-emerald-900">
            <strong className="font-semibold">Цену по-прежнему ставит код.</strong>{" "}
            Инструмента «назначь цену» не существует — ни для модели, ни для
            кого-либо ещё. Ассистент может только сопоставить строку с
            существующей позицией прайса.
          </p>
        </div>

        {/* ── Подключение ─────────────────────────────────── */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Подключение
          </h2>

          <ol className="mt-4 space-y-5">
            <li>
              <p className="text-sm font-medium text-slate-800">
                1. Возьмите токен в кабинете
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                Токен привязан к организации: по нему сервер понимает, чей
                прайс и чьи сметы показывать. Один токен — одна организация.
              </p>
            </li>

            <li>
              <p className="text-sm font-medium text-slate-800">
                2. Добавьте сервер в конфигурацию
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                Claude Desktop: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">claude_desktop_config.json</code>.
                Cursor: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">.cursor/mcp.json</code>.
              </p>
              <div className="mt-2.5">
                <CodeBlock code={CONFIG_SNIPPET} label="JSON" />
              </div>
            </li>

            <li>
              <p className="text-sm font-medium text-slate-800">
                3. Спросите что-нибудь про прайс
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                «Что есть по отводам 250?» или «Сопоставь: воздуховод 315».
                Ассистент вызовет нужный инструмент и покажет ответ.
              </p>
            </li>
          </ol>
        </section>

        {/* ── Инструменты ─────────────────────────────────── */}
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-slate-500" aria-hidden />
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              Что умеет
            </h2>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-wider text-slate-500">
                    Инструмент
                  </th>
                  <th className="px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-wider text-slate-500">
                    Что делает
                  </th>
                  <th className="hidden px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">
                    Пример вопроса
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {TOOLS.map((t) => (
                  <tr key={t.name}>
                    <td className="px-4 py-3 align-top">
                      <code className="text-xs font-medium text-accent-700">{t.name}</code>
                    </td>
                    <td className="px-4 py-3 align-top text-xs leading-relaxed text-slate-600">
                      {t.what}
                    </td>
                    <td className="hidden px-4 py-3 align-top text-xs leading-relaxed text-slate-500 sm:table-cell">
                      {t.example}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Технические детали ──────────────────────────── */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Как устроено
          </h2>
          <dl className="mt-3 space-y-3 text-sm leading-relaxed text-slate-600">
            <div>
              <dt className="font-medium text-slate-800">Спецификация 2026-07-28</dt>
              <dd className="mt-0.5">
                Протокол stateless: нет handshake <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">initialize</code> и
                заголовка <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">Mcp-Session-Id</code>.
                Для serverless это то, что нужно — каждый вызов может попасть
                на любой экземпляр функции.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Транспорт</dt>
              <dd className="mt-0.5">
                Streamable HTTP, ответы в JSON. Один route handler Next.js,
                без отдельного сервиса.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Ограничение</dt>
              <dd className="mt-0.5">
                Авторизация — Bearer-токен, а не полный OAuth 2.1 с
                регистрацией клиентов. Для внутреннего инструмента этого
                достаточно; OAuth — следующий шаг.
              </dd>
            </div>
          </dl>
        </section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/app"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700"
          >
            Открыть приложение
          </Link>
          <Link
            href="/status"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400"
          >
            Метрики сервиса
          </Link>
        </div>
      </main>
    </div>
  );
}
