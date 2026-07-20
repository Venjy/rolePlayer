import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteConversation,
  endConversation,
  pauseConversation,
  restartConversation,
  resumeConversation,
  retryConversationFeedback,
} from "../../src/client/conversations/conversation-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("conversation API requests", () => {
  it("deletes a conversation without trying to parse the empty 204 body", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteConversation(7)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversations/7",
      { method: "DELETE" },
    );
  });

  it.each([
    ["end", () => endConversation(7)],
    ["pause", () => pauseConversation(7)],
    ["resume", () => resumeConversation(7)],
    ["restart", () => restartConversation(7)],
    ["feedback retry", () => retryConversationFeedback(7)],
  ])("does not advertise JSON for an empty %s POST", async (label, request) => {
    void label;
    const fetchMock = vi.fn(
      async (requestInput: string | URL | Request, requestInit?: RequestInit) => {
        void requestInput;
        void requestInit;
        return new Response(JSON.stringify({ message: "Synthetic failure" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(request()).rejects.toThrow("Synthetic failure");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });
});
