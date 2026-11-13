"use client";

/**
 * Фича: чат с агентом.
 *
 * Агент помнит смету через sessionId: браузер передаёт только ID,
 * данные берутся на сервере. Поэтому подменить цены в запросе нельзя.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, Sparkles, Bot, User } from "lucide-react";
import { cn } from "@shared/lib/cn";
import { askAgent, type ChatTurn } from "@shared/api/client";

interface ChatPanelProps {
  sessionId?: string;
  /** Подсказки-вопросы, зависящие от состояния сметы */
  suggestions?: string[];
  /** Вопрос, который нужно задать сразу (например, клик по позиции в таблице) */
  initialQuestion?: string | null;
  /** Вызывается после того, как вопрос задан — чтобы сбросить его в родителе */
  onInitialConsumed?: () => void;
}

/** Простейший рендер: абзацы + **жирный** + таблицы отдельным блоком. */
function renderText(text: string) {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, i) => {
    const lines = block.split("\n");

    // Таблица Markdown — рисуем как есть, но моноширинно
    if (lines.some((l) => l.trim().startsWith("|"))) {
      return (
        <pre
          key={i}
          className="my-2 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs leading-relaxed ring-1 ring-slate-200"
        >
          {block}
        </pre>
      );
    }

    return (
      <p key={i} className="whitespace-pre-wrap">
        {lines.map((line, j) => {
          const parts = line.split(/(\*\*[^*]+\*\*)/g);
          return (
            <span key={j}>
              {parts.map((p, k) =>
                p.startsWith("**") && p.endsWith("**") ? (
                  <strong key={k} className="font-semibold">
                    {p.slice(2, -2)}
                  </strong>
                ) : (
                  p
                ),
              )}
              {j < lines.length - 1 && "\n"}
            </span>
          );
        })}
      </p>
    );
  });
}

interface Message {
  role: "user" | "assistant";
  text: string;
  ms?: number;
}

export function ChatPanel({
  sessionId,
  suggestions = [],
  initialQuestion,
  onInitialConsumed,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;

      setError(null);
      setInput("");
      setMessages((m) => [...m, { role: "user", text: q }]);
      setBusy(true);

      try {
        const history: ChatTurn[] = messages.map((m) => ({ role: m.role, text: m.text }));
        const res = await askAgent(q, history, sessionId);
        setMessages((m) => [...m, { role: "assistant", text: res.answer, ms: res.ms }]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка чата");
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, sessionId],
  );

  // Внешний вопрос (клик по позиции в таблице) — задаём один раз
  useEffect(() => {
    if (initialQuestion) {
      onInitialConsumed?.();
      void send(initialQuestion);
      // send меняется при каждом сообщении, поэтому подписка намеренно
      // зависит только от initialQuestion: иначе был бы бесконечный цикл
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto py-4 pr-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-4 px-2 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-50 ring-1 ring-inset ring-accent-600/10">
              <Sparkles className="h-5 w-5 text-accent-600" />
            </div>
            <div>
              <p className="font-medium text-slate-900">Спросите про смету или прайс</p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                Цены берутся только из прайса — выдумывать агент не умеет
              </p>
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-2.5 animate-slide-up",
              m.role === "user" ? "flex-row-reverse" : "flex-row",
            )}
          >
            <div
              className={cn(
                "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                m.role === "user"
                  ? "bg-slate-900 text-white"
                  : "bg-accent-50 text-accent-600 ring-1 ring-inset ring-accent-600/10",
              )}
            >
              {m.role === "user" ? (
                <User className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Bot className="h-3.5 w-3.5" aria-hidden />
              )}
            </div>

            <div
              className={cn(
                "max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                m.role === "user"
                  ? "rounded-tr-sm bg-slate-900 text-white"
                  : "rounded-tl-sm border border-slate-200 bg-white text-slate-800 shadow-sm",
              )}
            >
              {renderText(m.text)}
              {m.ms !== undefined && (
                <p
                  className={cn(
                    "mt-2 text-2xs",
                    m.role === "user" ? "text-slate-400" : "text-slate-400",
                  )}
                >
                  {(m.ms / 1000).toFixed(1)} с
                </p>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-accent-50 ring-1 ring-inset ring-accent-600/10">
              <Bot className="h-3.5 w-3.5 text-accent-600" aria-hidden />
            </div>
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-500" />
              <span className="text-sm text-slate-500">Думаю…</span>
            </div>
          </div>
        )}

        {error && (
          <div
            className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
            role="alert"
          >
            {error}
          </div>
        )}
      </div>

      {messages.length === 0 && suggestions.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs
                         text-slate-600 transition-all hover:border-accent-300
                         hover:bg-accent-50/50 hover:text-accent-700"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-end gap-2 border-t border-slate-100 pt-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Например: почему позиция 12 без цены?"
          className="field !rounded-xl !py-2.5 !text-sm"
          aria-label="Вопрос ассистенту"
        />
        <button
          type="submit"
          className="btn-primary !px-3 !py-2.5"
          disabled={!input.trim() || busy}
          aria-label="Отправить"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
