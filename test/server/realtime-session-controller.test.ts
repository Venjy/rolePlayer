import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeSessionController } from "../../src/server/realtime/realtime-session-controller";
import type { QwenRealtimeClient } from "../../src/server/realtime/qwen-realtime-client";
import type { QwenConversationItem } from "../../src/server/realtime/qwen-types";
import {
  INPUT_CHUNK_BYTES,
  type ServerMessage,
} from "../../src/shared/realtime-protocol";

const RESPONSE_ID = "resp_test";
const ASSISTANT_ITEM_ID = "item_assistant";
const PREVIOUS_ITEM_ID = "item_user";
const TRANSCRIPT = "One two three four. Five six seven eight.";
const GENERATED_AUDIO_MS = 2_000;
const SAFE_PLAYED_MS = 1_500;
const PCM24_BYTES_PER_MILLISECOND = 48;

type FakeQwenOperation =
  | { type: "cancel" }
  | { type: "delete"; itemId: string }
  | {
      type: "create";
      input: { itemId: string; previousItemId?: string; text: string };
    }
  | { type: "commit" }
  | { type: "clear" };

class FakeQwenClient {
  public readonly operations: FakeQwenOperation[] = [];
  public readonly appendAudio = vi.fn((pcm: Buffer) => {
    void pcm;
  });

  public cancelResponse(): void {
    this.operations.push({ type: "cancel" });
  }

  public deleteConversationItem(itemId: string): void {
    this.operations.push({ type: "delete", itemId });
  }

  public createAssistantTextItem(input: {
    itemId: string;
    previousItemId?: string;
    text: string;
  }): void {
    this.operations.push({ type: "create", input });
  }

  public commitAudioAndCreateResponse(): void {
    this.operations.push({ type: "commit" });
  }

  public clearAudio(): void {
    this.operations.push({ type: "clear" });
  }
}

interface Harness {
  controller: RealtimeSessionController;
  qwen: FakeQwenClient;
  sent: ServerMessage[];
  closeWithError: ReturnType<typeof vi.fn>;
}

const activeControllers: RealtimeSessionController[] = [];

afterEach(() => {
  for (const controller of activeControllers.splice(0)) controller.dispose();
});

function createHarness(): Harness {
  const qwen = new FakeQwenClient();
  const sent: ServerMessage[] = [];
  const closeWithError = vi.fn();
  const controller = new RealtimeSessionController(
    qwen as unknown as QwenRealtimeClient,
    {
      send: (message) => sent.push(message),
      sendAudio: () => true,
      closeWithError,
      warn: vi.fn(),
      error: vi.fn(),
    },
  );
  activeControllers.push(controller);
  return { controller, qwen, sent, closeWithError };
}

function startResponse(controller: RealtimeSessionController): void {
  const assistantItem: QwenConversationItem = {
    id: ASSISTANT_ITEM_ID,
    type: "message",
    status: "in_progress",
    role: "assistant",
    content: [],
  };

  controller.handleQwenEvent({
    type: "response.created",
    response: { id: RESPONSE_ID },
  });
  controller.handleQwenEvent({
    type: "response.output_item.added",
    response_id: RESPONSE_ID,
    item: assistantItem,
  });
  controller.handleQwenEvent({
    type: "conversation.item.created",
    previous_item_id: PREVIOUS_ITEM_ID,
    item: assistantItem,
  });
  controller.handleQwenEvent({
    type: "response.audio_transcript.delta",
    response_id: RESPONSE_ID,
    item_id: ASSISTANT_ITEM_ID,
    delta: TRANSCRIPT,
  });
  controller.handleQwenEvent({
    type: "response.audio.delta",
    response_id: RESPONSE_ID,
    item_id: ASSISTANT_ITEM_ID,
    delta: Buffer.alloc(
      GENERATED_AUDIO_MS * PCM24_BYTES_PER_MILLISECOND,
    ).toString("base64"),
  });
}

function completeResponse(
  controller: RealtimeSessionController,
  status: "completed" | "cancelled" = "completed",
): void {
  controller.handleQwenEvent({
    type: "response.done",
    response: {
      id: RESPONSE_ID,
      status,
      output: [
        {
          id: ASSISTANT_ITEM_ID,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "audio", transcript: TRANSCRIPT }],
        },
      ],
    },
  });
}

function acknowledgeDeleteAndGetCreate(
  harness: Harness,
): Extract<FakeQwenOperation, { type: "create" }> {
  harness.controller.handleQwenEvent({
    type: "conversation.item.deleted",
    item_id: ASSISTANT_ITEM_ID,
  });

  const operation = harness.qwen.operations.at(-1);
  expect(operation?.type).toBe("create");
  if (!operation || operation.type !== "create") {
    throw new Error("Expected the controller to create a replacement item.");
  }
  return operation;
}

function acknowledgeReplacement(
  controller: RealtimeSessionController,
  operation: Extract<FakeQwenOperation, { type: "create" }>,
): void {
  controller.handleQwenEvent({
    type: "conversation.item.created",
    previous_item_id: PREVIOUS_ITEM_ID,
    item: {
      id: operation.input.itemId,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: operation.input.text }],
    },
  });
}

describe("RealtimeSessionController context reconciliation", () => {
  it("treats an interruption before any assistant output as an empty rollback", () => {
    const harness = createHarness();
    harness.controller.handleQwenEvent({
      type: "response.created",
      response: { id: RESPONSE_ID },
    });
    harness.controller.handleControl({
      type: "playback.interrupted",
      responseId: RESPONSE_ID,
      safePlayedMs: 0,
    });

    expect(harness.qwen.operations).toEqual([{ type: "cancel" }]);
    harness.controller.handleQwenEvent({
      type: "response.done",
      response: { id: RESPONSE_ID, status: "cancelled", output: [] },
    });

    expect(harness.sent).toContainEqual({
      type: "response.reconciled",
      responseId: RESPONSE_ID,
      transcript: "",
      strategy: "rollback",
      confidence: "low",
    });
    expect(
      harness.qwen.operations.some(
        (operation) => operation.type === "delete" || operation.type === "create",
      ),
    ).toBe(false);
    expect(harness.closeWithError).not.toHaveBeenCalled();
  });

  it("cancels, deletes, and rolls back a low-confidence generating interruption", () => {
    const harness = createHarness();
    startResponse(harness.controller);

    harness.controller.handleControl({
      type: "playback.interrupted",
      responseId: RESPONSE_ID,
      safePlayedMs: SAFE_PLAYED_MS,
    });

    expect(harness.qwen.operations).toEqual([{ type: "cancel" }]);
    expect(
      harness.sent.some((message) => message.type === "response.reconciled"),
    ).toBe(false);

    completeResponse(harness.controller, "cancelled");

    expect(harness.qwen.operations).toEqual([
      { type: "cancel" },
      { type: "delete", itemId: ASSISTANT_ITEM_ID },
    ]);

    harness.controller.handleQwenEvent({
      type: "conversation.item.deleted",
      item_id: ASSISTANT_ITEM_ID,
    });

    expect(harness.sent).toContainEqual({
      type: "response.reconciled",
      responseId: RESPONSE_ID,
      originalItemId: ASSISTANT_ITEM_ID,
      transcript: "",
      strategy: "rollback",
      confidence: "low",
    });
    expect(
      harness.qwen.operations.some((operation) => operation.type === "create"),
    ).toBe(false);
    expect(harness.closeWithError).not.toHaveBeenCalled();
  });

  it("repairs completed-but-still-playing output without cancelling Qwen", () => {
    const harness = createHarness();
    startResponse(harness.controller);
    completeResponse(harness.controller);

    harness.controller.handleControl({
      type: "playback.interrupted",
      responseId: RESPONSE_ID,
      safePlayedMs: SAFE_PLAYED_MS,
    });

    expect(harness.qwen.operations).toEqual([
      { type: "delete", itemId: ASSISTANT_ITEM_ID },
    ]);

    const create = acknowledgeDeleteAndGetCreate(harness);
    acknowledgeReplacement(harness.controller, create);

    expect(harness.qwen.operations.some((operation) => operation.type === "cancel"))
      .toBe(false);
    expect(harness.sent).toContainEqual(
      expect.objectContaining({
        type: "response.reconciled",
        responseId: RESPONSE_ID,
        transcript: "One two three four.",
      }),
    );
    expect(harness.closeWithError).not.toHaveBeenCalled();
  });

  it("queues input.commit during repair and flushes it only after create acknowledgement", () => {
    const harness = createHarness();
    startResponse(harness.controller);
    completeResponse(harness.controller);

    harness.controller.handleControl({
      type: "playback.interrupted",
      responseId: RESPONSE_ID,
      safePlayedMs: SAFE_PLAYED_MS,
    });
    harness.controller.handleControl({ type: "input.start" });
    harness.controller.appendAudio(Buffer.alloc(INPUT_CHUNK_BYTES));
    harness.controller.handleControl({ type: "input.commit" });

    expect(harness.qwen.operations.map((operation) => operation.type)).toEqual([
      "delete",
    ]);

    const create = acknowledgeDeleteAndGetCreate(harness);
    expect(harness.qwen.operations.map((operation) => operation.type)).toEqual([
      "delete",
      "create",
    ]);

    acknowledgeReplacement(harness.controller, create);

    expect(harness.qwen.operations.map((operation) => operation.type)).toEqual([
      "delete",
      "create",
      "commit",
    ]);
    expect(harness.closeWithError).not.toHaveBeenCalled();
  });

  it("forgets an unsolicited cancelled response instead of repairing it later", () => {
    const harness = createHarness();
    startResponse(harness.controller);
    completeResponse(harness.controller, "cancelled");

    harness.controller.handleControl({ type: "response.cancel" });

    expect(harness.qwen.operations).toEqual([]);
    expect(harness.closeWithError).not.toHaveBeenCalled();
  });
});
