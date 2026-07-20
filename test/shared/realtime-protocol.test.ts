import { describe, expect, it } from "vitest";
import {
  clientControlMessageSchema,
  serverMessageSchema,
} from "../../src/shared/realtime-protocol";

describe("realtime protocol", () => {
  it("accepts a persisted conversation session configuration", () => {
    expect(
      clientControlMessageSchema.parse({
        type: "session.configure",
        conversationId: 123,
        maxHistoryTurns: 20,
      }),
    ).toMatchObject({
      type: "session.configure",
      conversationId: 123,
    });
  });

  it("rejects invalid history limits", () => {
    expect(() =>
      clientControlMessageSchema.parse({
        type: "session.configure",
        conversationId: 123,
        maxHistoryTurns: 51,
      }),
    ).toThrow();
  });

  it("requires a positive integer conversation ID and rejects browser prompt fields", () => {
    expect(
      clientControlMessageSchema.safeParse({
        type: "session.configure",
        conversationId: 1,
        maxHistoryTurns: 20,
      }).success,
    ).toBe(true);
    expect(
      clientControlMessageSchema.safeParse({
        type: "session.configure",
        conversationId: 0,
        maxHistoryTurns: 20,
      }).success,
    ).toBe(false);
    expect(() =>
      clientControlMessageSchema.parse({
        type: "session.configure",
        conversationId: 123,
        maxHistoryTurns: 20,
        instructions: "Browser-controlled prompt",
        voice: "longanqian",
      }),
    ).toThrow();
  });

  it("accepts stable gateway response events", () => {
    expect(
      serverMessageSchema.parse({
        type: "session.ready",
        sessionId: "sess_1",
        conversationId: 123,
      }),
    ).toMatchObject({ type: "session.ready" });

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
      clientControlMessageSchema.parse({ type: "response.retry" }),
    ).toEqual({ type: "response.retry" });

    expect(
      clientControlMessageSchema.parse({
        type: "playback.interrupted",
        responseId: "resp_1",
        safePlayedMs: 1_250,
      }),
    ).toMatchObject({ type: "playback.interrupted", safePlayedMs: 1_250 });

    expect(
      serverMessageSchema.parse({
        type: "response.persisted",
        responseId: "resp_1",
      }),
    ).toMatchObject({ type: "response.persisted", responseId: "resp_1" });

    expect(
      serverMessageSchema.parse({
        type: "scenario.success.detected",
        responseId: "resp_1",
      }),
    ).toMatchObject({ type: "scenario.success.detected" });

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
