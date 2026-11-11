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

/** Простейший рендер: абзацы + **жирный** + таблицы не разбираем. */
function renderText(text: string) {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, i) => {
    const lines = block.split("\n");

    // Таблица Markdown — рисуем как есть, но моноширинно
    if (lines.some((l) => l.trim().startsWith("|"))) {
      return (
        <pre
          key={i}
          className="my-2 overflow-x-auto rounded-lg bg-ink-50 p-3 text-xs leading-relaxed"
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
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-1 py-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <div className="rounded-full bg-copper-50 p-3">
              <Sparkles className="h-6 w-6 text-copper-600" />
            </div>
            <div>
              <p className="font-medium text-ink-900">Спросите про смету или прайс</p>
              <p className="text-sm text-ink-500">
                Цены берутся только из прайса — выдумывать агент не умеет
              </p>
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-3 animate-slide-up",
              m.role === "user" ? "flex-row-reverse" : "flex-row",
            )}
          >
            <div
              className={cn(
                "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                m.role === "user" ? "bg-ink-900 text-white" : "bg-copper-100 text-copper-700",
              )}
            >
              {m.role === "user" ? (
                <User className="h-4 w-4" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
            </div>

            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-ink-900 text-white"
                  : "border border-ink-200 bg-white text-ink-800",
              )}
            >
              {renderText(m.text)}
              {m.ms !== undefined && (
                <p className="mt-1.5 text-[11px] text-ink-400">{(m.ms / 1000).toFixed(1)} с</p>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-copper-100">
              <Bot className="h-4 w-4 text-copper-700" />
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
              <span className="text-sm text-ink-500">Думаю…</span>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-bad/20 bg-bad/5 px-3 py-2 text-sm text-bad">
            {error}
          </div>
        )}
      </div>

      {messages.length === 0 && suggestions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-ink-200 bg-white px-3 py-1.5
                         text-xs text-ink-600 transition-colors hover:border-ink-300 hover:bg-ink-50"
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
        className="flex items-end gap-2 border-t border-ink-200 pt-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Например: почему позиция 12 без цены?"
          rows={1}
          className="flex-1 resize-none rounded-lg border border-ink-200 bg-white px-3 py-2.5
                     text-sm placeholder:text-ink-400 focus:border-ink-400"
        />
        <button
          type="submit"
          className="btn-primary aspect-square !px-3"
          disabled={!input.trim() || busy}
          aria-label="Отправить"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
