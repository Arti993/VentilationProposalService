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
import { Server, Shield, Wrench } from "lucide-react";
import { HeaderBar, HeaderBrand } from "@shared/ui/HeaderLayout";
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
    what: "Итоговая стоимость КП и позиции, требующие уточнения",
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
        <HeaderBar>
          <HeaderBrand />
          {/* Статическая страница получает сессию в браузере. */}
          <UserMenu />
        </HeaderBar>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex items-center gap-2.5">
          <Server className="h-5 w-5 text-accent-600" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            MCP-сервер
          </h1>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
          Подключите поиск по прайсу, сопоставление позиций и просмотр КП к клиенту с поддержкой MCP — например, Claude, ChatGPT или Cursor.
        </p>

        {/* ── Главный принцип ─────────────────────────────── */}
        <div className="mt-6 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <p className="text-sm leading-relaxed text-emerald-900">
            <strong className="font-semibold">Цены из прайса поставщика.</strong>{" "}
            При сопоставлении стоимость берётся из прайса вашей организации. Позиции без однозначного соответствия требуют проверки.
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
                1. Подготовьте токен доступа
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                Для подключения необходим токен вашей организации. Он предоставляет доступ к её прайсу и коммерческим предложениям.
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
                3. Проверьте подключение
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                Задайте вопрос о наличии оборудования или сопоставьте позицию со сметой: «Сопоставьте: воздуховод 315».
              </p>
            </li>
          </ol>
        </section>

        {/* ── Инструменты ─────────────────────────────────── */}
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-slate-500" aria-hidden />
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              Доступные операции
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
            Параметры подключения
          </h2>
          <dl className="mt-3 space-y-3 text-sm leading-relaxed text-slate-600">
            <div>
              <dt className="font-medium text-slate-800">Спецификация 2026-07-28</dt>
              <dd className="mt-0.5">
                Запросы независимы. Инициализация сессии и заголовок Mcp-Session-Id не требуются.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Транспорт</dt>
              <dd className="mt-0.5">
                Streamable HTTP. Ответы возвращаются в формате JSON.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-800">Авторизация</dt>
              <dd className="mt-0.5">
                Передайте токен организации в заголовке Authorization: Bearer &lt;токен&gt;. OAuth 2.1 не поддерживается.
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
            Статистика сервиса
          </Link>
        </div>
      </main>
    </div>
  );
}
