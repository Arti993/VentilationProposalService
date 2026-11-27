import { expect, it, vi } from "vitest";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../llm/client.ts", () => ({ DEFAULT_AGENT_MODEL: "test", createChatModel: () => ({ bindTools: () => ({ invoke: mock.invoke }) }) }));
import { createAgent, finalText } from "./graph";

it("generates context-aware follow-ups in the existing answer call with genuine history roles", async () => {
  mock.invoke.mockResolvedValue(new AIMessage('Ответ.<follow_up_questions>["Какая толщина доступна?"]</follow_up_questions>'));
  const agent = createAgent({ getPrice: async () => [], useLlm: false }, { suggestFollowups: true });
  const result = await agent.invoke({ messages: [new HumanMessage("Какие отводы есть?"), new AIMessage("Есть отводы 90 градусов."), new HumanMessage("А размеры?")] });
  expect(mock.invoke).toHaveBeenCalledTimes(1);
  const messages = mock.invoke.mock.calls[0][0];
  expect(messages[0].content).toContain("ПОДСКАЗКИ ПРОДОЛЖЕНИЯ");
  expect(messages.slice(1).map((m: HumanMessage) => m.content)).toEqual(["Какие отводы есть?", "Есть отводы 90 градусов.", "А размеры?"]);
  expect(messages[2].getType()).toBe("ai");
  expect(finalText(result)).toContain("Какая толщина доступна?");
});
