import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("отображение демо-сессии", () => {
  it.each([null, undefined, false])("распознаёт демо-пользователя при флаге %s", async (isAnonymous) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: "demo", name: "Anonymous", email: "demo@anon.local", isAnonymous } }),
    }));
    expect((await getCurrentUser())?.isAnonymous).toBe(true);
  });

  it("сохраняет обычный аккаунт обычным", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: "user", name: "Менеджер", email: "manager@example.test", isAnonymous: false } }),
    }));
    expect((await getCurrentUser())?.isAnonymous).toBe(false);
  });
});
