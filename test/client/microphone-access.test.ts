import { describe, expect, it, vi } from "vitest";
import {
  MICROPHONE_INPUT_CONSTRAINTS,
  verifyMicrophoneAccess,
} from "../../src/client/audio/browser-audio-engine";

describe("microphone access preflight", () => {
  it("stops the temporary stream after access is granted", async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop }],
    }) as unknown as MediaStream);

    await verifyMicrophoneAccess({ getUserMedia });

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: MICROPHONE_INPUT_CONSTRAINTS,
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("preserves the browser permission error", async () => {
    const permissionError = new DOMException(
      "Permission denied",
      "NotAllowedError",
    );
    const getUserMedia = vi.fn().mockRejectedValue(permissionError);

    await expect(verifyMicrophoneAccess({ getUserMedia })).rejects.toBe(
      permissionError,
    );
  });
});
