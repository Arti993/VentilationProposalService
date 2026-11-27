import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { getActor, type Actor } from "@/lib/auth/guard";
import LoginPage from "./page";

vi.mock("@/lib/auth/guard", () => ({ getActor: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }) }));

beforeEach(() => vi.clearAllMocks());

describe("вход после демонстрационного расчёта", () => {
  it("открывает форму для анонимной сессии", async () => {
    vi.mocked(getActor).mockResolvedValue({ userId: "demo", isAnonymous: true } as Actor);
    expect(await LoginPage()).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("открывает форму для гостя без сессии", async () => {
    vi.mocked(getActor).mockResolvedValue(null);
    expect(await LoginPage()).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("отправляет вошедшего пользователя к смете", async () => {
    vi.mocked(getActor).mockResolvedValue({ userId: "user", isAnonymous: false } as Actor);
    await expect(LoginPage()).rejects.toThrow("redirect:/app");
    expect(redirect).toHaveBeenCalledWith("/app");
  });
});
