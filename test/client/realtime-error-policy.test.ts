import { describe, expect, it } from "vitest";
import { selectRealtimeErrorAction } from "../../src/client/realtime/realtime-error-policy";

describe("selectRealtimeErrorAction", () => {
  it("routes errors for a conversation that has never been ready to the launcher", () => {
    expect(
      selectRealtimeErrorAction({
        conversationStarted: false,
        recoverable: true,
      }),
    ).toBe("show_launch_error");
    expect(
      selectRealtimeErrorAction({
        conversationStarted: false,
        recoverable: false,
      }),
    ).toBe("show_launch_error");
  });

  it("keeps a recoverable turn error inside the active session", () => {
    expect(
      selectRealtimeErrorAction({
        conversationStarted: true,
        recoverable: true,
      }),
    ).toBe("show_session_message");
  });

  it("rebuilds a started conversation even if its replacement transport is not ready", () => {
    expect(
      selectRealtimeErrorAction({
        conversationStarted: true,
        recoverable: false,
      }),
    ).toBe("reconnect_session");
  });
});
