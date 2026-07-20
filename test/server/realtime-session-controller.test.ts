import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RealtimeSessionController,
  type RealtimePersistedMessage,
} from "../../src/server/realtime/realtime-session-controller";
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
  | { type: "retry" }
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

  public createResponse(): void {
    this.operations.push({ type: "retry" });
  }

  public clearAudio(): void {
    this.operations.push({ type: "clear" });
  }
}

interface Harness {
  controller: RealtimeSessionController;
  qwen: FakeQwenClient;
  sent: ServerMessage[];
  persisted: RealtimePersistedMessage[];
  persistMessage: ReturnType<typeof vi.fn>;
  assessScenarioSuccess: ReturnType<typeof vi.fn>;
  closeWithError: ReturnType<typeof vi.fn>;
}

const activeControllers: RealtimeSessionController[] = [];

afterEach(() => {
  for (const controller of activeControllers.splice(0)) controller.dispose();
  vi.useRealTimers();
});

function createHarness(options?: {
  persistMessage?: (message: RealtimePersistedMessage) => void;
}): Harness {
  const qwen = new FakeQwenClient();
  const sent: ServerMessage[] = [];
  const persisted: RealtimePersistedMessage[] = [];
  const persistMessage = vi.fn((message: RealtimePersistedMessage) => {
    if (options?.persistMessage) options.persistMessage(message);
    persisted.push(message);
  });
  const closeWithError = vi.fn();
  const assessScenarioSuccess = vi.fn();
  const controller = new RealtimeSessionController(
    qwen as unknown as QwenRealtimeClient,
    {
      send: (message) => sent.push(message),
      sendAudio: () => true,
      persistMessage,
      assessScenarioSuccess,
      closeWithError,
      warn: vi.fn(),
      error: vi.fn(),
    },
  );
  activeControllers.push(controller);
  return {
    controller,
    qwen,
    sent,
    persisted,
    persistMessage,
    assessScenarioSuccess,
    closeWithError,
  };
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

function commitAndPersistUserTurn(
  harness: Harness,
  itemId = PREVIOUS_ITEM_ID,
): void {
  harness.controller.handleControl({ type: "input.start" });
  harness.controller.appendAudio(Buffer.alloc(INPUT_CHUNK_BYTES));
  harness.controller.handleControl({ type: "input.commit" });
  harness.controller.handleQwenEvent({
    type: "input_audio_buffer.committed",
    item_id: itemId,
  });
  harness.controller.handleQwenEvent({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: itemId,
    transcript: "I need help handling this objection.",
  });
}

function startEmptyResponse(
  controller: RealtimeSessionController,
  responseId: string,
  itemId: string,
): void {
  const item: QwenConversationItem = {
    id: itemId,
    type: "message",
    status: "in_progress",
    role: "assistant",
    content: [],
  };
  controller.handleQwenEvent({
    type: "response.created",
    response: { id: responseId },
  });
  controller.handleQwenEvent({
    type: "response.output_item.added",
    response_id: responseId,
    item,
  });
  controller.handleQwenEvent({
    type: "conversation.item.created",
    previous_item_id: PREVIOUS_ITEM_ID,
    item,
  });
  controller.handleQwenEvent({
    type: "response.done",
    response: {
      id: responseId,
      status: "completed",
      output: [
        {
          ...item,
          status: "completed",
          content: [],
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

describe("RealtimeSessionController response resilience", () => {
  it("fails the uncertain session when response creation times out", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    commitAndPersistUserTurn(harness);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(harness.sent).toContainEqual({
      type: "error",
      code: "RESPONSE_TIMEOUT",
      message: "Timed out while waiting for Qwen to start the AI response.",
      recoverable: false,
    });
    expect(harness.closeWithError).toHaveBeenCalledOnce();
  });

  it("cancels a stalled response, repairs it, and retries once", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    commitAndPersistUserTurn(harness);
    harness.controller.handleQwenEvent({
      type: "response.created",
      response: { id: "resp_stalled" },
    });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(harness.qwen.operations.at(-1)).toEqual({ type: "cancel" });
    expect(harness.sent).toContainEqual(
      expect.objectContaining({
        type: "error",
        code: "RESPONSE_RETRYING",
        recoverable: true,
      }),
    );

    harness.controller.handleQwenEvent({
      type: "response.done",
      response: { id: "resp_stalled", status: "cancelled", output: [] },
    });

    expect(harness.qwen.operations.at(-1)).toEqual({ type: "retry" });
    expect(harness.closeWithError).not.toHaveBeenCalled();
  });

  it("retries an empty response once, then returns ready with a helpful error", () => {
    const harness = createHarness();
    commitAndPersistUserTurn(harness);

    startEmptyResponse(harness.controller, "resp_empty_1", "item_empty_1");
    expect(harness.qwen.operations.at(-1)).toEqual({
      type: "delete",
      itemId: "item_empty_1",
    });
    harness.controller.handleQwenEvent({
      type: "conversation.item.deleted",
      item_id: "item_empty_1",
    });
    expect(harness.qwen.operations.at(-1)).toEqual({ type: "retry" });

    startEmptyResponse(harness.controller, "resp_empty_2", "item_empty_2");
    expect(harness.qwen.operations.at(-1)).toEqual({
      type: "delete",
      itemId: "item_empty_2",
    });
    harness.controller.handleQwenEvent({
      type: "conversation.item.deleted",
      item_id: "item_empty_2",
    });

    expect(
      harness.qwen.operations.filter(({ type }) => type === "retry"),
    ).toHaveLength(1);
    expect(harness.sent).toContainEqual(
      expect.objectContaining({
        type: "error",
        code: "EMPTY_RESPONSE",
        recoverable: true,
      }),
    );
    expect(harness.sent.at(-1)).toEqual({
      type: "session.state",
      state: "ready",
    });
    expect(harness.closeWithError).not.toHaveBeenCalled();
  });

  it("retries an explicit Qwen response.failed event", () => {
    const harness = createHarness();
    commitAndPersistUserTurn(harness);
    harness.controller.handleQwenEvent({
      type: "response.created",
      response: { id: "resp_failed" },
    });

    harness.controller.handleQwenEvent({
      type: "response.done",
      response: {
        id: "resp_failed",
        status: "failed",
        status_details: {
          type: "failed",
          error: { message: "TTS unavailable" },
        },
        output: [],
      },
    });

    expect(harness.qwen.operations.at(-1)).toEqual({ type: "retry" });
    expect(harness.sent).toContainEqual(
      expect.objectContaining({
        type: "error",
        code: "RESPONSE_RETRYING",
        recoverable: true,
      }),
    );
  });

  it("treats a Qwen server_error as a fatal service failure", () => {
    const harness = createHarness();

    harness.controller.handleQwenEvent({
      type: "error",
      error: {
        type: "server_error",
        code: "service_unavailable",
        message: "LLM connection failed",
      },
    });

    expect(harness.sent).toContainEqual({
      type: "error",
      code: "QWEN_SERVER_ERROR",
      message: "LLM connection failed",
      recoverable: false,
    });
    expect(harness.closeWithError).toHaveBeenCalledOnce();
  });

  it("starts one final attempt for a gateway-approved saved user turn", () => {
    const harness = createHarness();

    harness.controller.handleControl({ type: "response.retry" });

    expect(harness.qwen.operations).toEqual([{ type: "retry" }]);
    expect(harness.sent.at(-1)).toEqual({
      type: "session.state",
      state: "processing",
    });
  });
});

describe("RealtimeSessionController authoritative history persistence", () => {
  it("requests conservative scenario assessment when generation finishes, before playback", () => {
    const harness = createHarness();
    startResponse(harness.controller);

    completeResponse(harness.controller);

    expect(harness.assessScenarioSuccess).toHaveBeenCalledOnce();
    expect(harness.assessScenarioSuccess).toHaveBeenCalledWith({
      responseId: RESPONSE_ID,
      transcript: TRANSCRIPT,
    });
    expect(harness.persisted).toEqual([]);
  });

  it("waits for clear acknowledgement and ignores late transcription from a cancelled turn", () => {
    const harness = createHarness();
    harness.controller.handleControl({ type: "input.start" });
    harness.controller.appendAudio(Buffer.alloc(INPUT_CHUNK_BYTES));
    harness.controller.handleQwenEvent({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item_cancelled",
      text: "This draft must disappear",
      stash: "",
    });
    expect(harness.sent).toContainEqual({
      type: "transcript.user.delta",
      itemId: "item_cancelled",
      text: "This draft must disappear",
      stash: "",
    });

    harness.controller.handleControl({ type: "input.clear" });
    expect(harness.qwen.operations.at(-1)).toEqual({ type: "clear" });
    expect(harness.sent.at(-1)).toEqual({
      type: "session.state",
      state: "processing",
    });

    harness.controller.handleQwenEvent({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item_cancelled",
      text: "Late cancelled draft",
      stash: "",
    });
    harness.controller.handleQwenEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_cancelled",
      transcript: "Late cancelled final transcript.",
    });
    expect(harness.persisted).toEqual([]);
    expect(harness.sent).not.toContainEqual(
      expect.objectContaining({
        type: "transcript.user.done",
        itemId: "item_cancelled",
      }),
    );

    harness.controller.handleQwenEvent({ type: "input_audio_buffer.cleared" });
    expect(harness.sent).toContainEqual({ type: "input.cleared" });
    expect(harness.sent.at(-1)).toEqual({
      type: "session.state",
      state: "ready",
    });

    const sentCount = harness.sent.length;
    harness.controller.handleControl({ type: "input.start" });
    harness.controller.handleQwenEvent({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item_cancelled",
      text: "Still late after the next turn started",
      stash: "",
    });
    expect(harness.sent).toHaveLength(sentCount + 1);
    expect(harness.sent.at(-1)).toEqual({
      type: "session.state",
      state: "listening",
    });
  });

  it("ignores a finalized transcript that does not match the committed user item", () => {
    const harness = createHarness();
    harness.controller.handleControl({ type: "input.start" });
    harness.controller.appendAudio(Buffer.alloc(INPUT_CHUNK_BYTES));
    harness.controller.handleControl({ type: "input.commit" });
    harness.controller.handleQwenEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_expected",
      transcript: "This arrived before the commit acknowledgement.",
    });
    expect(harness.persisted).toEqual([]);
    harness.controller.handleQwenEvent({
      type: "input_audio_buffer.committed",
      item_id: "item_expected",
    });

    harness.controller.handleQwenEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_cancelled_old",
      transcript: "This belongs to an older cancelled turn.",
    });
    expect(harness.persisted).toEqual([]);

    harness.controller.handleQwenEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_expected",
      transcript: "This is the committed turn.",
    });
    expect(harness.persisted).toHaveLength(1);
    expect(harness.persisted[0]).toMatchObject({
      text: "This is the committed turn.",
      sourceItemId: "item_expected",
      audio: { sampleRate: 16_000 },
    });
  });

  it("rejects a second input while the previous user transcript is pending", () => {
    const harness = createHarness();
    harness.controller.handleControl({ type: "input.start" });
    harness.controller.appendAudio(Buffer.alloc(INPUT_CHUNK_BYTES));
    harness.controller.handleControl({ type: "input.commit" });

    harness.controller.handleControl({ type: "input.start" });

    expect(harness.sent).toContainEqual({
      type: "error",
      code: "USER_TURN_PENDING",
      message:
        "Wait for the previous user transcript to be saved before speaking again.",
      recoverable: true,
    });
    expect(harness.qwen.operations.map(({ type }) => type)).toEqual(["commit"]);

    harness.controller.handleQwenEvent({
      type: "input_audio_buffer.committed",
      item_id: "item_user_saved",
    });
    harness.controller.handleQwenEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_user_saved",
      transcript: "The first turn is now durable.",
    });
    harness.controller.handleControl({ type: "input.start" });

    expect(harness.sent.at(-1)).toEqual({
      type: "session.state",
      state: "listening",
    });
  });

  it("persists a final user transcript before publishing transcript.user.done", () => {
    const harness = createHarness();
    harness.controller.handleControl({ type: "input.start" });
    harness.controller.appendAudio(Buffer.alloc(INPUT_CHUNK_BYTES));
    harness.controller.handleControl({ type: "input.commit" });
    harness.controller.handleQwenEvent({
      type: "input_audio_buffer.committed",
      item_id: "item_user_final",
    });

    harness.controller.handleQwenEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_user_final",
      transcript: "I need a faster qualification workflow.",
    });

    expect(harness.persisted).toHaveLength(1);
    expect(harness.persisted[0]).toMatchObject({
      role: "user",
      text: "I need a faster qualification workflow.",
      interrupted: false,
      sourceItemId: "item_user_final",
      audio: { sampleRate: 16_000 },
    });
    expect(harness.sent).toContainEqual({
      type: "transcript.user.done",
      itemId: "item_user_final",
      transcript: "I need a faster qualification workflow.",
    });
  });

  it("persists a complete assistant turn only after generation and playback complete", () => {
    const harness = createHarness();
    startResponse(harness.controller);

    harness.controller.handleControl({
      type: "playback.completed",
      responseId: RESPONSE_ID,
    });
    expect(harness.persisted).toEqual([]);

    completeResponse(harness.controller);

    expect(harness.persisted).toHaveLength(1);
    expect(harness.persisted[0]).toMatchObject({
      role: "assistant",
      text: TRANSCRIPT,
      interrupted: false,
      sourceItemId: ASSISTANT_ITEM_ID,
      responseId: RESPONSE_ID,
      audio: { sampleRate: 24_000 },
    });
    expect(harness.persisted[0]?.audio?.pcm).toHaveLength(
      GENERATED_AUDIO_MS * PCM24_BYTES_PER_MILLISECOND,
    );
    expect(harness.sent).toContainEqual({
      type: "response.persisted",
      responseId: RESPONSE_ID,
    });
  });

  it("holds assistant persistence until its user transcript is durable", () => {
    const harness = createHarness();
    harness.controller.handleControl({ type: "input.start" });
    harness.controller.appendAudio(Buffer.alloc(INPUT_CHUNK_BYTES));
    harness.controller.handleControl({ type: "input.commit" });
    startResponse(harness.controller);
    harness.controller.handleControl({
      type: "playback.completed",
      responseId: RESPONSE_ID,
    });
    completeResponse(harness.controller);

    expect(harness.persisted).toEqual([]);
    expect(
      harness.sent.some((message) => message.type === "response.persisted"),
    ).toBe(false);

    harness.controller.handleQwenEvent({
      type: "input_audio_buffer.committed",
      item_id: "item_user_slow_asr",
    });
    harness.controller.handleQwenEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_user_slow_asr",
      transcript: "This transcript arrived after the assistant finished.",
    });

    expect(harness.persisted).toHaveLength(2);
    expect(harness.persisted[0]).toMatchObject({
      role: "user",
      text: "This transcript arrived after the assistant finished.",
      interrupted: false,
      sourceItemId: "item_user_slow_asr",
      audio: { sampleRate: 16_000 },
    });
    expect(harness.persisted[0]?.audio?.pcm).toHaveLength(INPUT_CHUNK_BYTES);
    expect(harness.persisted[1]).toMatchObject({
      role: "assistant",
      text: TRANSCRIPT,
      interrupted: false,
      sourceItemId: ASSISTANT_ITEM_ID,
      responseId: RESPONSE_ID,
      audio: { sampleRate: 24_000 },
    });
    expect(harness.sent).toContainEqual({
      type: "response.persisted",
      responseId: RESPONSE_ID,
    });
  });

  it("persists only the retained interrupted prefix after replacement acknowledgement", () => {
    const harness = createHarness();
    startResponse(harness.controller);
    completeResponse(harness.controller);
    harness.controller.handleControl({
      type: "playback.interrupted",
      responseId: RESPONSE_ID,
      safePlayedMs: SAFE_PLAYED_MS,
    });

    expect(harness.persisted).toEqual([]);
    const create = acknowledgeDeleteAndGetCreate(harness);
    expect(harness.persisted).toEqual([]);

    acknowledgeReplacement(harness.controller, create);

    expect(harness.persisted).toHaveLength(1);
    expect(harness.persisted[0]).toMatchObject({
      role: "assistant",
      text: "One two three four.",
      interrupted: true,
      sourceItemId: create.input.itemId,
      responseId: RESPONSE_ID,
      audio: { sampleRate: 24_000 },
    });
    expect(harness.persisted[0]?.audio?.pcm).toHaveLength(
      SAFE_PLAYED_MS * PCM24_BYTES_PER_MILLISECOND,
    );
  });

  it("persists neither text nor audio when a completed response is interrupted at zero safe playback", () => {
    const harness = createHarness();
    startResponse(harness.controller);
    completeResponse(harness.controller);

    harness.controller.handleControl({
      type: "playback.interrupted",
      responseId: RESPONSE_ID,
      safePlayedMs: 0,
    });
    harness.controller.handleQwenEvent({
      type: "conversation.item.deleted",
      item_id: ASSISTANT_ITEM_ID,
    });

    expect(harness.persisted).toEqual([]);
    expect(harness.sent).toContainEqual({
      type: "response.reconciled",
      responseId: RESPONSE_ID,
      originalItemId: ASSISTANT_ITEM_ID,
      transcript: "",
      strategy: "rollback",
      confidence: "low",
    });
  });

  it("ends the session immediately when authoritative persistence fails", () => {
    const persistenceError = new Error("disk full");
    const harness = createHarness({
      persistMessage: () => {
        throw persistenceError;
      },
    });

    harness.controller.handleControl({ type: "input.start" });
    harness.controller.appendAudio(Buffer.alloc(INPUT_CHUNK_BYTES));
    harness.controller.handleControl({ type: "input.commit" });
    harness.controller.handleQwenEvent({
      type: "input_audio_buffer.committed",
      item_id: "item_user_failed",
    });

    harness.controller.handleQwenEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_user_failed",
      transcript: "This must be durable.",
    });

    expect(harness.sent.slice(-2)).toEqual([
      {
        type: "error",
        code: "HISTORY_PERSISTENCE_FAILED",
        message: "The authoritative conversation history could not be saved.",
        recoverable: false,
      },
      { type: "session.state", state: "ended" },
    ]);
    expect(harness.closeWithError).toHaveBeenCalledOnce();
    const sentCount = harness.sent.length;

    harness.controller.handleQwenEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_after_failure",
      transcript: "Must be ignored.",
    });
    harness.controller.handleControl({ type: "input.start" });
    expect(harness.persistMessage).toHaveBeenCalledOnce();
    expect(harness.sent).toHaveLength(sentCount);
  });

  it.each([
    {
      name: "failed ASR",
      event: {
        type: "conversation.item.input_audio_transcription.failed" as const,
        item_id: "item_failed",
        error: { message: "ASR unavailable" },
      },
    },
    {
      name: "empty final ASR",
      event: {
        type: "conversation.item.input_audio_transcription.completed" as const,
        item_id: "item_empty",
        transcript: "   ",
      },
    },
  ])("closes without orphaning an assistant after $name", ({ event }) => {
    const harness = createHarness();
    harness.controller.handleControl({ type: "input.start" });
    harness.controller.appendAudio(Buffer.alloc(INPUT_CHUNK_BYTES));
    harness.controller.handleControl({ type: "input.commit" });
    harness.controller.handleQwenEvent({
      type: "input_audio_buffer.committed",
      item_id: event.item_id,
    });
    startResponse(harness.controller);

    harness.controller.handleQwenEvent(event);
    completeResponse(harness.controller);
    harness.controller.handleControl({
      type: "playback.completed",
      responseId: RESPONSE_ID,
    });

    expect(harness.persisted).toEqual([]);
    expect(harness.sent).toContainEqual(
      expect.objectContaining({
        type: "error",
        code: "TRANSCRIPTION_FAILED",
        recoverable: false,
      }),
    );
    expect(harness.closeWithError).toHaveBeenCalledOnce();
  });
});
