"use client";

/**
 * Страница «КП» — композиция виджетов и фич.
 *
 * Слой pages не знает, как устроены фичи внутри: он только расставляет
 * их и держит общее состояние (загруженная смета).
 */
import { useState } from "react";
import { FileSpreadsheet, MessageSquare } from "lucide-react";
import { cn } from "@shared/lib/cn";
import { UploadEstimate } from "@features/upload-estimate";
import { ChatPanel } from "@features/send-chat-message";
import { SummaryCards } from "@widgets/estimate-summary";
import { EstimateTable } from "@widgets/estimate-table";
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
    <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8">
      {/* Заголовок */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-ink-900 p-2">
              <FileSpreadsheet className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
              Коммерческое предложение
            </h1>
          </div>
          <p className="mt-1.5 text-sm text-ink-500">
            Загрузите смету клиента — сервис сопоставит позиции с прайсом.
            Цена ставится только при однозначном совпадении.
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* Левая колонка: смета. minmax(0,1fr) в сетке выше обязателен:
            без него таблица распирает колонку и появляется горизонтальный скролл. */}
        <section className="min-w-0 space-y-4">
          {!session ? (
            <div className="card p-6">
              <h2 className="mb-1 font-medium text-ink-900">Смета клиента</h2>
              <p className="mb-4 text-sm text-ink-500">
                Поддерживаются .txt и .csv — табличные и свободные форматы
              </p>
              <UploadEstimate onLoaded={setSession} />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-medium text-ink-900">{session.name}</h2>
                  <p className="text-sm text-ink-500">
                    Загружена{" "}
                    {new Date(session.loadedAt).toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <button
                  className="btn-secondary shrink-0 text-xs"
                  onClick={() => {
                    setSession(null);
                    setPendingQuestion(null);
                  }}
                >
                  Загрузить другую
                </button>
              </div>

              <SummaryCards stats={session.stats} />
              <EstimateTable positions={session.positions} onSelect={selectPosition} />
            </>
          )}
        </section>

        {/* Правая колонка: чат. На мобильном идёт после таблицы. */}
        <aside className="min-w-0 lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
          <div className="card flex h-[600px] flex-col p-4 lg:h-full">
            <div className="mb-2 flex items-center gap-2 border-b border-ink-200 pb-3">
              <MessageSquare className="h-4 w-4 text-ink-400" />
              <span className="text-sm font-medium text-ink-900">Ассистент</span>
              {session && (
                <span className="badge bg-ok/10 text-ok border border-ok/20">
                  смета загружена
                </span>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              <ChatPanel
                key={session?.id ?? "no-session"}
                sessionId={session?.id}
                suggestions={suggestions}
                initialQuestion={pendingQuestion}
                onInitialConsumed={() => setPendingQuestion(null)}
              />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
