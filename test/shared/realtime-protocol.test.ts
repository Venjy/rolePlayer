import { describe, expect, it } from "vitest";
import {
  clientControlMessageSchema,
  MAX_REALTIME_INSTRUCTIONS_LENGTH,
  serverMessageSchema,
} from "../../src/shared/realtime-protocol";

describe("realtime protocol", () => {
  it("accepts a valid Qwen session configuration", () => {
    expect(
      clientControlMessageSchema.parse({
        type: "session.configure",
        instructions: "Stay in character.",
        voice: "longanqian",
        maxHistoryTurns: 20,
      }),
    ).toMatchObject({ type: "session.configure", voice: "longanqian" });
  });

  it("rejects invalid history limits", () => {
    expect(() =>
      clientControlMessageSchema.parse({
        type: "session.configure",
        instructions: "Stay in character.",
        voice: "longanqian",
        maxHistoryTurns: 51,
      }),
    ).toThrow();
  });

  it("enforces the shared Instructions length limit", () => {
    const baseConfiguration = {
      type: "session.configure" as const,
      voice: "longanqian" as const,
      maxHistoryTurns: 20,
    };

    expect(
      clientControlMessageSchema.safeParse({
        ...baseConfiguration,
        instructions: "x".repeat(MAX_REALTIME_INSTRUCTIONS_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      clientControlMessageSchema.safeParse({
        ...baseConfiguration,
        instructions: "x".repeat(MAX_REALTIME_INSTRUCTIONS_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("accepts stable gateway response events", () => {
    expect(
      serverMessageSchema.parse({
        type: "transcript.user.delta",
        itemId: "item_1",
        text: "Hello ",
        stash: "there",
      }),
    ).toMatchObject({ type: "transcript.user.delta" });
  });

  it("validates playback receipts and reconciliation events", () => {
    expect(
      clientControlMessageSchema.parse({
        type: "playback.interrupted",
        responseId: "resp_1",
        safePlayedMs: 1_250,
      }),
    ).toMatchObject({ type: "playback.interrupted", safePlayedMs: 1_250 });

    expect(
      serverMessageSchema.parse({
        type: "response.reconciled",
        responseId: "resp_1",
        originalItemId: "item_1",
        replacementItemId: "item_rebuilt_1",
        transcript: "Hello there",
        strategy: "estimated_prefix",
        confidence: "medium",
      }),
    ).toMatchObject({ type: "response.reconciled" });

    expect(
      serverMessageSchema.parse({
        type: "response.reconciled",
        responseId: "resp_early",
        transcript: "",
        strategy: "rollback",
        confidence: "low",
      }),
    ).toMatchObject({ type: "response.reconciled", transcript: "" });
  });
});
