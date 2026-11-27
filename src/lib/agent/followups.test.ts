import { describe, expect, it } from "vitest";
import { splitFollowups, selectFollowups } from "./followups";
import { priceConversationId } from "./conversation";

describe("chat follow-ups", () => {
  it("separates metadata from the answer and tolerates truncated metadata", () => {
    expect(splitFollowups('Ответ.\n<follow_up_questions>["Какие размеры есть?"]</follow_up_questions>'))
      .toEqual({ answer: "Ответ.", suggestions: ["Какие размеры есть?"] });
    expect(splitFollowups('Ответ.<follow_up_questions>["Оборванный'))
      .toEqual({ answer: "Ответ.", suggestions: [] });
    expect(splitFollowups('Ответ.<follow_up_questions>{bad}</follow_up_questions>')).toEqual({ answer: "Ответ.", suggestions: [] });
    expect(splitFollowups("Обычный ответ")).toEqual({ answer: "Обычный ответ", suggestions: [] });
  });
  it("excludes asked questions, duplicates and malformed suggestions", () => {
    const questions = selectFollowups([" Какие размеры есть? ", "Какие РАЗМЕРЫ есть!", "А толщина?", "А толщина?", "x".repeat(121), "<script>"], [{ role: "user", text: "Какие размеры есть" }], false);
    expect(questions).toHaveLength(3);
    expect(questions[0]).toBe("А толщина?");
    expect(questions.join(" ")).not.toContain("смет");
    expect(questions).not.toContain("Какие размеры есть?");
  });
  it("scopes a price conversation to its user, organization and browser nonce", () => {
    const nonce = "fe21c8e0-c916-4ec9-82a0-98c25bc84324";
    const id = priceConversationId(nonce, "user-a", "org-a");
    expect(priceConversationId(nonce, "user-a", "org-a")).toBe(id);
    expect(priceConversationId(nonce, "user-b", "org-a")).not.toBe(id);
    expect(priceConversationId(nonce, "user-a", "org-b")).not.toBe(id);
    expect(() => priceConversationId(id, "user-a", "org-a")).toThrow();
    expect(() => priceConversationId("anonymous", "user-a", "org-a")).toThrow();
  });
});
