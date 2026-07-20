import { describe, expect, it } from "vitest";
import {
  readableError,
  readableServerError,
} from "../../src/client/app/app-errors";
import { RealtimeServerError } from "../../src/client/realtime/realtime-client";

describe("application error presentation", () => {
  it("keeps the server detail in English while using the localized known label", () => {
    expect(
      readableError(
        new RealtimeServerError(
          "RECORDING_TOO_SHORT",
          "Provider-specific short recording detail.",
          true,
        ),
      ),
    ).toEqual({
      en: "Provider-specific short recording detail.",
      zh: "请至少说话 100 毫秒后再发送。",
    });
  });

  it("falls back to the original detail for an unknown server code", () => {
    expect(readableServerError("FUTURE_ERROR", "Future detail")).toBe(
      "Future detail",
    );
  });

  it("localizes known client lifecycle errors", () => {
    expect(
      readableError(
        new Error("Timed out while saving the assistant response."),
      ),
    ).toEqual({
      en: "Timed out while saving the AI response. The session was kept open to avoid silently losing history.",
      zh: "保存 AI 回复超时。为避免静默丢失历史，当前会话仍保持打开。",
    });
  });
});
