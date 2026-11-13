"use client";

/**
 * Рабочий экран сервиса.
 *
 * Композиция виджетов и фич: страница не знает, как устроены фичи
 * внутри, — она расставляет их и держит общее состояние.
 *
 * Отличие от лендинга: здесь задача не удивить, а не мешать. Плотная
 * сетка, минимум отступов между важными элементами, липкая шапка с
 * действиями. Пользователь возвращается сюда каждый день.
 */
import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileSpreadsheet,
  FileText,
  FileType2,
  MessageSquare,
  Plus,
} from "lucide-react";
import { UploadEstimate } from "@features/upload-estimate";
import { DownloadProposal } from "@features/download-proposal";
import { ChatPanel } from "@features/send-chat-message";
import { SummaryCards } from "@widgets/estimate-summary";
import { EstimateTable } from "@widgets/estimate-table";
import { Logo } from "@shared/ui/Logo";
import type { EstimateSession, EstimatePosition } from "@entities/estimate/model/types";

type Session = EstimateSession & { id: string };

export function ProposalPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<"estimate" | "chat">("estimate");

  /** Клик по позиции в таблице — подставить вопрос в чат */
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  const selectPosition = (p: EstimatePosition) => {
    setPendingQuestion(
      `Почему позиция ${p.posNo} («${p.name}») получила статус «${p.status}»?`,
    );
    setTab("chat");
  };

  const suggestions = session
    ? [
        "Какой итог по этой смете?",
        "Сколько позиций не нашлось и какие?",
        "Что требует проверки менеджера?",
        "Дай сводку для отправки клиенту",
      ]
    : [
        "Сколько стоит тройник 315/200?",
        "Какие размеры ниппелей есть в прайсе?",
        "Есть ли отвод 90 градусов на 450?",
      ];

  return (
    <div className="min-h-screen bg-slate-50/70">
      {/* ── Шапка приложения ───────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-4 px-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <Link
              href="/"
              className="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500
                         transition-colors hover:text-slate-900 sm:flex"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              На главную
            </Link>
            <span className="hidden h-5 w-px bg-slate-200 sm:block" aria-hidden />
            <Logo />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {session ? (
              <>
                <DownloadProposal
                  sessionId={session.id}
                  pricedCount={session.stats.priced}
                />
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setSession(null);
                    setPendingQuestion(null);
                    setTab("estimate");
                  }}
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Новая смета</span>
                </button>
              </>
            ) : (
              <span className="hidden text-xs text-slate-500 sm:inline">
                Шаг 1 из 2 · загрузка сметы
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-8 lg:px-8">
        {!session ? (
          /* ── Состояние загрузки ─────────────────────────── */
          <div className="mx-auto max-w-2xl py-8 lg:py-14">
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50 ring-1 ring-inset ring-accent-600/10">
                <FileSpreadsheet className="h-6 w-6 text-accent-600" />
              </div>
              <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                Загрузите смету клиента
              </h1>
              <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-slate-600">
                Сопоставим каждую позицию с прайсом и соберём готовое КП.
                Цена появится только там, где совпадение однозначное.
              </p>
            </div>

            <div className="card mt-10 animate-slide-up p-6 sm:p-8">
              <UploadEstimate onLoaded={setSession} />
            </div>

            {/* Подсказка о формате — снимает вопрос до загрузки */}
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                {
                  h: "Excel",
                  t: "Любой лист книги, шапка может быть не сверху",
                  icon: FileSpreadsheet,
                },
                {
                  h: "Word",
                  t: "Таблица из документа — количества сохранятся",
                  icon: FileType2,
                },
                {
                  h: "CSV или текст",
                  t: "Разделители и кодировку определим сами",
                  icon: FileText,
                },
              ].map((x) => (
                <div key={x.h} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <x.icon className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                    <p className="text-xs font-semibold text-slate-900">{x.h}</p>
                  </div>
                  <p className="mt-1.5 text-2xs leading-relaxed text-slate-500">{x.t}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* ── Результат ──────────────────────────────────── */
          <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xs font-medium uppercase tracking-[0.14em] text-slate-400">
                  Смета обработана
                </p>
                <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-slate-900">
                  {session.name}
                </h1>
                <p className="mt-0.5 text-sm text-slate-500">
                  Загружена{" "}
                  {new Date(session.loadedAt).toLocaleTimeString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {" · "}
                  {session.stats.total} позиций
                </p>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
              {/* Левая колонка. minmax(0,1fr) обязателен: без него
                  таблица распирает колонку и появляется горизонтальный скролл. */}
              <section className="min-w-0 space-y-4">
                <SummaryCards stats={session.stats} />
                <EstimateTable positions={session.positions} onSelect={selectPosition} />
              </section>

              {/* Правая колонка: чат. На мобильном идёт после таблицы. */}
              <aside className="min-w-0 lg:sticky lg:top-[5.5rem] lg:h-[calc(100vh-7.5rem)]">
                <div className="card flex h-[600px] flex-col lg:h-full">
                  {/* Переключатель на мобильном: две колонки не влезают */}
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                    <MessageSquare className="h-4 w-4 text-accent-600" aria-hidden />
                    <span className="text-sm font-semibold text-slate-900">Ассистент</span>
                    <span className="badge ml-auto bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
                      смета загружена
                    </span>
                  </div>
                  <div className="flex-1 overflow-hidden px-4 pb-4">
                    <ChatPanel
                      key={session.id}
                      sessionId={session.id}
                      suggestions={suggestions}
                      initialQuestion={pendingQuestion}
                      onInitialConsumed={() => setPendingQuestion(null)}
                    />
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
