"use client";

/**
 * Рабочий экран сервиса.
 *
 * Композиция виджетов и фич: страница не знает, как устроены фичи
 * внутри, — она расставляет их и держит общее состояние.
 *
 * Отличие от лендинга: здесь задача не удивить, а не мешать. Плотная
 * сетка, минимум отступов, липкая шапка с действиями. Пользователь
 * возвращается сюда каждый день.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileSpreadsheet, FileText, FileType2, Plus } from "lucide-react";
import { UploadEstimate } from "@features/upload-estimate";
import { UploadPrice, fetchPriceInfo, fetchPriceItems } from "@features/upload-price";
import type { PriceInfo, PriceItem } from "@features/upload-price/api/client";
import { DownloadProposal } from "@features/download-proposal";
import { ChatPanel } from "@features/send-chat-message";
import { UserMenu } from "@widgets/user-menu";
import { SummaryCards } from "@widgets/estimate-summary";
import { EstimateTable } from "@widgets/estimate-table";
import { Logo } from "@shared/ui/Logo";
import type { EstimateSession, EstimatePosition } from "@entities/estimate/model/types";

type Session = EstimateSession & { id: string };

export interface ProposalPageProps {
  /**
   * Кто пришёл — известно на сервере (`/app` читает сессию).
   *
   * `null` — гость. Передаётся пропсом, а не запрашивается в браузере:
   * иначе шапка показывала бы «Войти» вошедшему человеку, пока идёт
   * запрос.
   */
  user: { name: string; email: string; image: string | null } | null;
}

export function ProposalPage({ user }: ProposalPageProps) {
  const [session, setSession] = useState<Session | null>(null);

  /**
   * Состояние прайса организации.
   *
   * `null` — ещё не знаем. Нужно, чтобы отличить «своего прайса нет,
   * считаем по тестовому» от «прайс есть»: по позициям этого не понять,
   * демо-прайс тоже даёт 215 позиций.
   */
  const [priceInfo, setPriceInfo] = useState<PriceInfo | null>(null);

  /**
   * Прайс, загруженный только что, в этой сессии.
   *
   * После загрузки блок предупреждения исчезает, и без этой записи
   * человек не увидел бы подтверждения: он нажал «Загрузить», экран
   * дёрнулся — и всё. На перезагрузке страницы подтверждение уже не
   * нужно, потому что блок просто не появится.
   */
  const [justUploaded, setJustUploaded] = useState<{
    fileName: string;
    inserted: number;
  } | null>(null);

  /**
   * Прайс для разбора спорных строк.
   *
   * Грузится один раз при появлении сметы, а не заранее: до загрузки КП
   * страницу открывают ради самой загрузки, и 40 КБ прайса там ни к чему.
   * Ошибка загрузки не ломает экран — разбор просто не появится.
   */
  const [price, setPrice] = useState<PriceItem[]>([]);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    void fetchPriceItems().then((items) => {
      if (alive) setPrice(items);
    });
    return () => {
      alive = false;
    };
  }, [session]);

  /**
   * Состояние прайса спрашиваем сразу при открытии страницы, а не после
   * загрузки сметы.
   *
   * Предупреждение «считаем по тестовому прайсу» нужно ДО того, как
   * человек увидит цены: иначе он сначала поверит демонстрационным
   * суммам, а потом прочитает, что они тестовые.
   */
  useEffect(() => {
    let alive = true;
    void fetchPriceInfo().then((info) => {
      if (alive) setPriceInfo(info);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** Перечитать состояние прайса после загрузки. */
  const refreshPriceInfo = async () => {
    setPriceInfo(await fetchPriceInfo());
  };

  /** Клик по позиции в таблице — подставить вопрос в чат */
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  const selectPosition = (p: EstimatePosition) => {
    setPendingQuestion(
      `Почему позиция ${p.posNo} («${p.name}») получила статус «${p.status}»?`,
    );
    // На телефоне чат ниже таблицы: без прокрутки человек нажимает
    // строку и не видит, что что-то произошло
    if (window.matchMedia("(max-width: 1023px)").matches) {
      document.getElementById("assistant")?.scrollIntoView({ behavior: "smooth" });
    }
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
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-3 px-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Link
              href="/"
              className="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500
                         transition-colors hover:text-slate-900 sm:flex"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              На главную
            </Link>
            <span className="hidden h-5 w-px bg-slate-200 sm:block" aria-hidden />
            <span className="min-w-0">
              <span className="sm:hidden">
                <Logo withWordmark={false} />
              </span>
              <span className="hidden sm:block">
                <Logo />
              </span>
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {session ? (
              <>
                <DownloadProposal
                  sessionId={session.id}
                  pricedCount={session.stats.priced}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setSession(null);
                    setPendingQuestion(null);
                  }}
                  aria-label="Загрузить новую смету"
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Новая смета</span>
                </button>
              </>
            ) : (
              // этого из приложения некуда уйти, кроме кнопки браузера
              <Link href="/" className="btn-ghost !px-2.5 sm:hidden">
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">На главную</span>
              </Link>
            )}

            {/*
              Вход и состояние пользователя — ВСЕГДА справа.

              Раньше страница /login существовала, но ссылки на неё не было
              нигде: человек получал «Войдите или зарегистрируйтесь» при
              попытке загрузить свой прайс и не мог найти, где это сделать.
              Кнопка стоит вне ветки `session` намеренно — вход нужен и до
              загрузки сметы, и после.
            */}
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-6 sm:py-8 lg:px-8">
        {!session ? (
          /* ── Состояние загрузки ─────────────────────────── */
          <div className="mx-auto max-w-2xl py-4 sm:py-8 lg:py-14">
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50 ring-1 ring-inset ring-accent-600/10">
                <FileSpreadsheet className="h-6 w-6 text-accent-600" aria-hidden />
              </div>
              <h1 className="mt-6 text-[1.375rem] font-semibold tracking-tight text-slate-900 sm:text-3xl">
                Загрузите смету клиента
              </h1>
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-600 sm:text-base">
                Сопоставим каждую позицию с прайсом и соберём готовое КП.
                Цена появится только там, где совпадение однозначное.
              </p>
            </div>

            <div className="card mt-8 animate-slide-up p-4 sm:mt-10 sm:p-8">
              <UploadEstimate onLoaded={setSession} />
            </div>

            {/*
              Прайс — только если своего ещё нет.

              Раньше здесь всегда висела карточка «Свой прайс» с загрузкой,
              и после загрузки она выглядела точно так же: человек не мог
              понять, применился файл или нет. Хуже того, рядом с ежедневной
              работой постоянно стояла кнопка, заменяющая рабочий прайс.
              
              Теперь блок говорит ровно одно: «считаем по тестовому» — и
              уходит, как только появился свой. Замена прайса живёт в
              кабинете, где её не нажмут случайно.
            */}
            {priceInfo && !priceInfo.hasOwnPrice && !justUploaded && (
              <div className="mt-4">
                <UploadPrice
                  variant="notice"
                  onUploaded={async (info) => {
                    setJustUploaded(info);
                    await refreshPriceInfo();
                  }}
                />
              </div>
            )}

            {/*
              Подтверждение после загрузки: блок уже убран, и без него
              человек не увидел бы, что файл принят.
            */}
            {justUploaded && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                  Прайс загружен: {justUploaded.inserted} позиций
                </p>
                <p className="mt-1 text-sm leading-relaxed text-slate-700">
                  Файл «{justUploaded.fileName}» принят. Дальше сметы считаются
                  по вашим ценам. Заменить файл можно в{" "}
                  <Link href="/account" className="font-medium text-accent-700 hover:underline">
                    настройках аккаунта
                  </Link>
                  .
                </p>
              </div>
            )}

            {/* Подсказка о форматах — снимает вопрос до загрузки */}
            <div className="mt-5 grid gap-3 sm:mt-6 sm:grid-cols-3">
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
                    <x.icon className="h-3.5 w-3.5 text-slate-500" aria-hidden />
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
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
              <div className="min-w-0">
                <p className="text-2xs font-medium uppercase tracking-[0.14em] text-slate-500">
                  Смета
                </p>
                <h1 className="mt-1 truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                  {session.name}
                </h1>
                <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
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

            <div className="grid gap-5 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
              {/* Левая колонка. minmax(0,1fr) обязателен: без него
                  таблица распирает колонку и появляется горизонтальный скролл. */}
              <section className="min-w-0 space-y-4">
                <SummaryCards stats={session.stats} />
                <EstimateTable
                  positions={session.positions}
                  onSelect={selectPosition}
                  price={price}
                  estimateId={session.id}
                />
              </section>

              {/* Правая колонка: чат. На мобильном идёт после таблицы. */}
              <aside
                id="assistant"
                className="min-w-0 scroll-mt-20 lg:sticky lg:top-[5.5rem] lg:h-[calc(100vh-7.5rem)]"
              >
                <div className="card flex h-[70vh] min-h-[420px] flex-col sm:h-[560px] lg:h-full">
                  {/* Заголовок чата. Бейджа «смета загружена» здесь нет:
                      он дублировал то, что и так видно над чатом —
                      название сметы и число позиций. */}
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                    <span className="text-sm font-semibold text-slate-900">Ассистент</span>
                    <span className="ml-auto text-2xs text-slate-500">
                      по загруженной смете
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
