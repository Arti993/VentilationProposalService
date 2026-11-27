import { expect, it, vi } from "vitest";
import { askAgent } from "./client";
it("carries follow-up questions through fragmented SSE along with the answer", async () => {
  const frame = 'event: done\ndata: ' + JSON.stringify({ answer: "Ответ", suggestions: ["А размеры?"], ms: 15, tokens: 20, toolCalls: 1 }) + "\n\n";
  const bytes = new TextEncoder().encode(frame);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 27)); c.enqueue(bytes.slice(27)); c.close(); } }), { headers: { "Content-Type": "text/event-stream" } })));
  try {
    const result = await askAgent("Вопрос", { conversationId: "id" });
    expect(result.suggestions).toEqual(["А размеры?"]);
    expect(result.answer).toBe("Ответ");
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toEqual({ question: "Вопрос", conversationId: "id" });
  } finally { vi.unstubAllGlobals(); }
});
