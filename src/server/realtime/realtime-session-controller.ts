import { randomUUID } from "node:crypto";
import {
  INPUT_CHUNK_BYTES,
  type ClientControlMessage,
  type ServerMessage,
  type SessionState,
} from "../../shared/realtime-protocol";
import { QwenRealtimeClient } from "./qwen-realtime-client";
import type { QwenConversationItem, QwenServerEvent } from "./qwen-types";
import {
  SpeechPrefixEstimator,
  type PrefixEstimate,
} from "./speech-prefix-estimator";

const REPAIR_TIMEOUT_MS = 10_000;
const USER_TRANSCRIPTION_TIMEOUT_MS = 30_000;
const INPUT_CLEAR_TIMEOUT_MS = 5_000;
// Keep a single long turn from consuming the process indefinitely. A turn that
// crosses this boundary remains usable in realtime, but its audio is omitted so
// the conversation cannot be advertised as a complete audio download.
const MAX_CAPTURED_MESSAGE_AUDIO_BYTES = 32 * 1024 * 1024;
const USER_AUDIO_SAMPLE_RATE = 16_000 as const;
const ASSISTANT_AUDIO_SAMPLE_RATE = 24_000 as const;
const ASSISTANT_PCM_BYTES_PER_MILLISECOND = 48;

type GenerationState =
  | "generating"
  | "cancel_requested"
  | "completed"
  | "cancelled"
  | "failed";

interface InterruptionSnapshot {
  safePlayedMs: number;
  transcript: string;
  audioBytes: number;
  generationCompleted: boolean;
}

interface ResponseRecord {
  responseId: string;
  generation: GenerationState;
  playback: "pending" | "completed" | "interrupted";
  suppressOutput: boolean;
  transcript: string;
  audioBytes: number;
  audioChunks: Buffer[];
  audioCaptureComplete: boolean;
  assistantItemId?: string;
  previousItemId?: string;
  interruption?: InterruptionSnapshot;
  userTurn?: UserTurnPersistence;
  waitingForUserPersistence?: boolean;
}

interface UserTurnPersistence {
  status: "pending" | "persisted";
  itemId?: string;
  audio?: Buffer;
  timeout?: NodeJS.Timeout;
}

interface RepairJob {
  responseId: string;
  stage:
    | "waiting_terminal"
    | "waiting_delete"
    | "waiting_create"
    | "waiting_user_persistence";
  estimate?: PrefixEstimate;
  originalItemId?: string;
  replacementItemId?: string;
  timeout?: NodeJS.Timeout;
}

export interface RealtimeSessionControllerHandlers {
  send: (message: ServerMessage) => void;
  sendAudio: (audio: Buffer) => boolean;
  persistMessage: (message: RealtimePersistedMessage) => void;
  closeWithError: (reason: string) => void;
  warn: (error: unknown, message: string) => void;
  error: (error: unknown, message: string) => void;
}

export interface RealtimePersistedMessage {
  role: "user" | "assistant";
  text: string;
  interrupted: boolean;
  sourceItemId?: string;
  responseId?: string;
  audio?: {
    sampleRate: 16_000 | 24_000;
    pcm: Buffer;
  };
}

function responseItemTranscript(item: QwenConversationItem): string | undefined {
  for (const content of item.content ?? []) {
    const text = content.transcript ?? content.text;
    if (text?.trim()) return text;
  }
  return undefined;
}

function isBenignCancellationRace(event: QwenServerEvent): boolean {
  const message = `${event.error?.code ?? ""} ${event.error?.message ?? ""}`.toLowerCase();
  const mentionsCancellation =
    message.includes("cancel") || message.includes("inference");
  const saysNothingIsActive =
    message.includes("no active") ||
    message.includes("not active") ||
    message.includes("not found") ||
    message.includes("no response") ||
    message.includes("no inference");
  return mentionsCancellation && saysNothingIsActive;
}

export class RealtimeSessionController {
  private terminated = false;
  private inputActive = false;
  private inputBytes = 0;
  private inputAudioChunks: Buffer[] = [];
  private inputAudioCaptureComplete = true;
  private inputTranscriptionItemId?: string;
  private readonly cancelledInputItemIds = new Set<string>();
  private inputClearPending = false;
  private inputClearTimeout?: NodeJS.Timeout;
  private pendingCommit = false;
  private awaitingResponseCreation = false;
  private cancelWhenResponseCreated = false;
  private activeGenerationResponseId?: string;
  private lastSentState?: SessionState;
  private repair?: RepairJob;
  private pendingUserTurn?: UserTurnPersistence;
  private responseUserTurnAwaitingCreation?: UserTurnPersistence;
  private readonly responses = new Map<string, ResponseRecord>();
  private readonly responseIdByItemId = new Map<string, string>();
  private readonly estimator = new SpeechPrefixEstimator();

  public constructor(
    private readonly qwen: QwenRealtimeClient,
    private readonly handlers: RealtimeSessionControllerHandlers,
  ) {}

  public handleControl(message: ClientControlMessage): void {
    if (this.terminated) return;
    switch (message.type) {
      case "session.configure":
        this.sendError("ALREADY_CONFIGURED", "The session is already configured.", true);
        break;
      case "input.start":
        this.startInput();
        break;
      case "input.commit":
        this.commitInput();
        break;
      case "input.clear":
        this.clearInput();
        break;
      case "response.cancel":
        this.interruptLatestResponse();
        break;
      case "playback.completed":
        this.completePlayback(message.responseId);
        break;
      case "playback.interrupted":
        this.interruptResponse(message.responseId, message.safePlayedMs);
        break;
    }
  }

  public appendAudio(pcm: Buffer): void {
    if (this.terminated) return;
    if (!this.inputActive) return;
    try {
      this.qwen.appendAudio(pcm);
      this.inputBytes += pcm.length;
      if (this.inputAudioCaptureComplete) {
        if (this.inputBytes <= MAX_CAPTURED_MESSAGE_AUDIO_BYTES) {
          this.inputAudioChunks.push(Buffer.from(pcm));
        } else {
          this.inputAudioChunks = [];
          this.inputAudioCaptureComplete = false;
          this.handlers.warn(
            undefined,
            "Skipping persistence for an oversized user audio turn",
          );
        }
      }
    } catch (error) {
      this.handlers.error(error, "Failed to forward browser audio");
      this.sendError("AUDIO_FORWARD_FAILED", "Could not forward microphone audio.", true);
    }
  }

  public handleQwenEvent(event: QwenServerEvent): void {
    if (this.terminated) return;
    switch (event.type) {
      case "conversation.item.input_audio_transcription.delta":
        this.handleUserTranscriptionDelta(event);
        break;

      case "conversation.item.input_audio_transcription.completed":
        this.completeUserTranscription(event);
        break;

      case "conversation.item.input_audio_transcription.failed":
        this.handleUserTranscriptionFailure(event);
        break;

      case "input_audio_buffer.committed":
        this.handleInputAudioCommitted(event);
        break;

      case "input_audio_buffer.cleared":
        this.handleInputAudioCleared();
        break;

      case "response.created":
        this.handleResponseCreated(event);
        break;

      case "response.output_item.added":
        this.handleOutputItemAdded(event);
        break;

      case "conversation.item.created":
        this.handleConversationItemCreated(event);
        break;

      case "conversation.item.deleted":
        this.handleConversationItemDeleted(event);
        break;

      case "response.audio_transcript.delta":
        this.handleAssistantTranscriptDelta(event);
        break;

      case "response.audio_transcript.done":
        this.handleAssistantTranscriptDone(event);
        break;

      case "response.audio.delta":
        this.handleAssistantAudio(event);
        break;

      case "response.done":
        this.handleResponseDone(event);
        break;

      case "error":
        this.handleQwenError(event);
        break;

      default:
        break;
    }
  }

  public dispose(): void {
    if (this.repair?.timeout) clearTimeout(this.repair.timeout);
    if (this.pendingUserTurn?.timeout) {
      clearTimeout(this.pendingUserTurn.timeout);
    }
    if (this.inputClearTimeout) clearTimeout(this.inputClearTimeout);
    this.resetInputAudioCapture();
    for (const response of this.responses.values()) response.audioChunks = [];
  }

  private startInput(): void {
    if (this.inputClearPending) {
      this.sendError(
        "INPUT_CLEAR_PENDING",
        "Wait for the cancelled recording to be cleared before speaking again.",
        true,
      );
      return;
    }
    if (this.inputActive || this.pendingCommit) {
      this.sendError("INPUT_ALREADY_ACTIVE", "A user turn is already active.", true);
      return;
    }
    if (this.pendingUserTurn) {
      this.sendError(
        "USER_TURN_PENDING",
        "Wait for the previous user transcript to be saved before speaking again.",
        true,
      );
      return;
    }

    this.interruptLatestResponse();
    this.inputActive = true;
    this.inputBytes = 0;
    this.inputAudioChunks = [];
    this.inputAudioCaptureComplete = true;
    this.inputTranscriptionItemId = undefined;
    this.sendState("listening");
  }

  private commitInput(): void {
    if (!this.inputActive) {
      this.sendError("NO_ACTIVE_INPUT", "No recording is active.", true);
      return;
    }

    this.inputActive = false;
    if (this.inputBytes < INPUT_CHUNK_BYTES) {
      this.qwen.clearAudio();
      this.resetInputAudioCapture();
      this.sendError(
        "RECORDING_TOO_SHORT",
        "Please speak for at least 100 ms before submitting.",
        true,
      );
      this.sendState("ready");
      return;
    }

    this.pendingCommit = true;
    this.sendState("processing");
    this.maybeFlushCommit();
  }

  private clearInput(): void {
    this.inputActive = false;
    this.pendingCommit = false;
    this.rememberCancelledInputItem(this.inputTranscriptionItemId);
    this.inputTranscriptionItemId = undefined;
    this.resetInputAudioCapture();
    this.inputClearPending = true;
    if (this.inputClearTimeout) clearTimeout(this.inputClearTimeout);
    this.inputClearTimeout = setTimeout(() => {
      this.failInputClear(
        "Timed out while waiting for Qwen to confirm the cancelled recording was cleared.",
      );
    }, INPUT_CLEAR_TIMEOUT_MS);
    try {
      this.qwen.clearAudio();
    } catch (error) {
      this.handlers.error(error, "Failed to clear cancelled user audio");
      this.failInputClear("Could not clear the cancelled recording.");
      return;
    }
    this.sendState("processing");
  }

  private maybeFlushCommit(): void {
    if (
      !this.pendingCommit ||
      this.repair ||
      this.pendingUserTurn ||
      this.activeGenerationResponseId ||
      this.awaitingResponseCreation
    ) {
      return;
    }

    this.pendingCommit = false;
    this.awaitingResponseCreation = true;
    const userAudio = this.inputAudioCaptureComplete
      ? concatenatePcmChunks(this.inputAudioChunks, this.inputBytes)
      : undefined;
    const userTurn: UserTurnPersistence = {
      status: "pending",
      ...(userAudio ? { audio: userAudio } : {}),
    };
    this.resetInputAudioCapture();
    userTurn.timeout = setTimeout(() => {
      this.failUserTranscription(
        "Timed out while waiting for the finalized user transcript.",
      );
    }, USER_TRANSCRIPTION_TIMEOUT_MS);
    this.pendingUserTurn = userTurn;
    this.responseUserTurnAwaitingCreation = userTurn;
    try {
      this.qwen.commitAudioAndCreateResponse();
    } catch (error) {
      this.handlers.error(error, "Failed to commit user audio");
      this.failUserTranscription("Could not submit the user audio turn.");
      return;
    }
    this.sendState("processing");
  }

  private handleResponseCreated(event: QwenServerEvent): void {
    const responseId = event.response?.id ?? "unknown";
    const record: ResponseRecord = {
      responseId,
      generation: "generating",
      playback: "pending",
      suppressOutput: false,
      transcript: "",
      audioBytes: 0,
      audioChunks: [],
      audioCaptureComplete: true,
      ...(this.responseUserTurnAwaitingCreation
        ? { userTurn: this.responseUserTurnAwaitingCreation }
        : {}),
    };
    this.responseUserTurnAwaitingCreation = undefined;
    this.responses.set(responseId, record);
    this.awaitingResponseCreation = false;
    this.activeGenerationResponseId = responseId;

    if (this.cancelWhenResponseCreated) {
      this.cancelWhenResponseCreated = false;
      this.requestInterruption(record, 0);
      return;
    }

    this.handlers.send({ type: "response.started", responseId });
    this.sendState("processing");
  }

  private handleOutputItemAdded(event: QwenServerEvent): void {
    const item = event.item;
    if (
      !event.response_id ||
      !item?.id ||
      item.type !== "message" ||
      item.role !== "assistant"
    ) {
      return;
    }

    const record = this.responses.get(event.response_id);
    if (!record) return;
    record.assistantItemId = item.id;
    this.responseIdByItemId.set(item.id, event.response_id);
  }

  private handleConversationItemCreated(event: QwenServerEvent): void {
    const item = event.item;
    if (!item?.id) return;

    if (
      this.repair?.stage === "waiting_create" &&
      item.id === this.repair.replacementItemId
    ) {
      this.finishRepair();
      return;
    }

    if (item.type !== "message" || item.role !== "assistant") return;
    const responseId =
      this.responseIdByItemId.get(item.id) ?? this.activeGenerationResponseId;
    if (!responseId) return;
    const record = this.responses.get(responseId);
    if (!record) return;
    record.assistantItemId = item.id;
    record.previousItemId = event.previous_item_id;
    this.responseIdByItemId.set(item.id, responseId);
  }

  private handleConversationItemDeleted(event: QwenServerEvent): void {
    const repair = this.repair;
    if (
      !repair ||
      repair.stage !== "waiting_delete" ||
      event.item_id !== repair.originalItemId
    ) {
      return;
    }

    this.clearRepairTimeout();
    const record = this.responses.get(repair.responseId);
    const estimate = repair.estimate;
    if (!record) {
      this.failContextRepair("The interrupted response disappeared during repair.");
      return;
    }
    if (!estimate?.transcript) {
      this.finishRepair();
      return;
    }

    repair.stage = "waiting_create";
    repair.replacementItemId = `item_repair_${randomUUID().replaceAll("-", "")}`;
    try {
      this.qwen.createAssistantTextItem({
        itemId: repair.replacementItemId,
        ...(record.previousItemId
          ? { previousItemId: record.previousItemId }
          : {}),
        text: estimate.transcript,
      });
    } catch (error) {
      this.handlers.error(error, "Failed to recreate interrupted assistant context");
      this.failContextRepair("Could not recreate interrupted assistant context.");
      return;
    }
    this.armRepairTimeout();
  }

  private handleAssistantTranscriptDelta(event: QwenServerEvent): void {
    const record = this.responseForEvent(event);
    if (!record) return;
    if (event.item_id) this.rememberItem(record, event.item_id);
    record.transcript += event.delta ?? "";

    if (!record.suppressOutput) {
      this.handlers.send({
        type: "transcript.assistant.delta",
        responseId: record.responseId,
        itemId: event.item_id ?? record.assistantItemId ?? "unknown",
        delta: event.delta ?? "",
      });
    }
  }

  private handleAssistantTranscriptDone(event: QwenServerEvent): void {
    const record = this.responseForEvent(event);
    if (!record) return;
    if (event.item_id) this.rememberItem(record, event.item_id);
    if (event.transcript !== undefined) record.transcript = event.transcript;

    if (!record.suppressOutput) {
      this.handlers.send({
        type: "transcript.assistant.done",
        responseId: record.responseId,
        itemId: event.item_id ?? record.assistantItemId ?? "unknown",
        transcript: event.transcript ?? record.transcript,
      });
    }
  }

  private handleAssistantAudio(event: QwenServerEvent): void {
    const record = this.responseForEvent(event);
    if (!record || !event.delta) return;
    if (event.item_id) this.rememberItem(record, event.item_id);
    const audio = Buffer.from(event.delta, "base64");
    record.audioBytes += audio.length;
    if (record.audioCaptureComplete) {
      if (record.audioBytes <= MAX_CAPTURED_MESSAGE_AUDIO_BYTES) {
        record.audioChunks.push(audio);
      } else {
        record.audioChunks = [];
        record.audioCaptureComplete = false;
        this.handlers.warn(
          undefined,
          `Skipping persistence for oversized assistant audio ${record.responseId}`,
        );
      }
    }
    if (record.suppressOutput) return;

    if (!this.handlers.sendAudio(audio)) {
      this.sendError(
        "PLAYBACK_BACKPRESSURE",
        "The browser connection is too slow for realtime playback.",
        true,
      );
      this.requestInterruption(record, 0);
      return;
    }
    this.sendState("speaking");
  }

  private handleResponseDone(event: QwenServerEvent): void {
    const responseId = event.response?.id ?? this.activeGenerationResponseId;
    if (!responseId) return;
    const record = this.responses.get(responseId);
    if (!record) return;

    for (const item of event.response?.output ?? []) {
      if (item.type === "message" && item.role === "assistant" && item.id) {
        this.rememberItem(record, item.id);
        const transcript = responseItemTranscript(item);
        if (!record.interruption && transcript) record.transcript = transcript;
      }
    }

    const status = event.response?.status ?? "failed";
    record.generation = status;
    if (this.activeGenerationResponseId === responseId) {
      this.activeGenerationResponseId = undefined;
    }
    this.awaitingResponseCreation = false;

    if (record.interruption) {
      this.startRepair(record);
      return;
    }

    this.handlers.send({
      type: "response.done",
      responseId,
      status,
      ...(event.response?.status_details?.reason
        ? { reason: event.response.status_details.reason }
        : {}),
    });

    if (status === "failed") {
      this.sendError(
        "RESPONSE_FAILED",
        event.response?.status_details?.error?.message ??
          "Qwen could not generate a response.",
        true,
      );
      this.sendState(this.inputActive ? "listening" : "ready");
    } else if (status === "cancelled") {
      this.sendState(this.inputActive ? "listening" : "ready");
    } else if (record.playback === "completed") {
      this.finalizeCompletedPlayback(record);
    }

    if (status !== "completed") {
      this.removeResponse(record);
    }

    this.maybeFlushCommit();
  }

  private handleQwenError(event: QwenServerEvent): void {
    if (this.inputClearPending) {
      this.failInputClear(
        event.error?.message ?? "Qwen rejected the cancelled recording clear.",
      );
      return;
    }
    if (
      this.repair?.stage === "waiting_terminal" &&
      isBenignCancellationRace(event)
    ) {
      this.handlers.warn(event.error, "Ignoring a cancellation race during repair");
      return;
    }

    if (this.repair) {
      this.failContextRepair(
        event.error?.message ?? "Qwen rejected a context repair operation.",
      );
      return;
    }

    const recoverable = event.error?.type !== "server_error";
    this.sendError(
      event.error?.code ?? "QWEN_ERROR",
      event.error?.message ?? "Qwen returned an unknown error.",
      recoverable,
    );
  }

  private completePlayback(responseId: string): void {
    const record = this.responses.get(responseId);
    if (!record || record.playback === "interrupted") return;
    record.playback = "completed";
    if (record.generation === "completed") {
      this.finalizeCompletedPlayback(record);
    }
  }

  private finalizeCompletedPlayback(record: ResponseRecord): void {
    if (record.userTurn?.status === "pending") {
      record.waitingForUserPersistence = true;
      return;
    }
    if (
      record.transcript.trim() &&
      !this.persistMessage({
        role: "assistant",
        text: record.transcript,
        interrupted: false,
        ...(record.assistantItemId
          ? { sourceItemId: record.assistantItemId }
          : {}),
        responseId: record.responseId,
        ...(record.audioCaptureComplete
          ? withPersistedAudio(
              ASSISTANT_AUDIO_SAMPLE_RATE,
              concatenatePcmChunks(record.audioChunks, record.audioBytes),
            )
          : {}),
      })
    ) {
      return;
    }
    if (record.transcript.trim() && record.audioBytes > 0) {
      this.estimator.addCompletedSample(record.transcript, record.audioBytes / 48);
    }
    this.handlers.send({
      type: "response.persisted",
      responseId: record.responseId,
    });
    this.removeResponse(record);
    this.sendState(this.inputActive ? "listening" : "ready");
    this.maybeFlushCommit();
  }

  private interruptLatestResponse(): void {
    if (this.repair) return;

    if (this.activeGenerationResponseId) {
      const record = this.responses.get(this.activeGenerationResponseId);
      if (record) this.requestInterruption(record, 0);
      return;
    }

    if (this.awaitingResponseCreation) {
      this.cancelWhenResponseCreated = true;
      return;
    }

    const latest = [...this.responses.values()]
      .reverse()
      .find((record) => record.playback === "pending");
    if (latest) this.requestInterruption(latest, 0);
  }

  private interruptResponse(responseId: string, safePlayedMs: number): void {
    const record = this.responses.get(responseId);
    if (!record) {
      this.sendError("UNKNOWN_RESPONSE", "The playback response is no longer active.", true);
      return;
    }
    this.requestInterruption(record, safePlayedMs);
  }

  private requestInterruption(
    record: ResponseRecord,
    safePlayedMs: number,
  ): void {
    if (record.playback === "completed") return;
    if (record.interruption) {
      record.interruption.safePlayedMs = Math.min(
        record.interruption.safePlayedMs,
        safePlayedMs,
      );
      return;
    }

    record.playback = "interrupted";
    record.suppressOutput = true;
    record.interruption = {
      safePlayedMs,
      transcript: record.transcript,
      audioBytes: record.audioBytes,
      generationCompleted: record.generation === "completed",
    };
    this.repair = { responseId: record.responseId, stage: "waiting_terminal" };
    this.armRepairTimeout();

    if (record.generation === "generating") {
      record.generation = "cancel_requested";
      try {
        this.qwen.cancelResponse();
      } catch (error) {
        this.handlers.warn(error, "Could not cancel Qwen response");
      }
      return;
    }

    if (record.generation !== "cancel_requested") this.startRepair(record);
  }

  private startRepair(record: ResponseRecord): void {
    const repair = this.repair;
    const interruption = record.interruption;
    if (!repair || repair.responseId !== record.responseId || !interruption) return;
    if (repair.stage !== "waiting_terminal") return;

    repair.estimate = this.estimator.estimate({
      transcript: interruption.transcript,
      generatedAudioMs: interruption.audioBytes / 48,
      safePlayedMs: interruption.safePlayedMs,
      generationCompleted: interruption.generationCompleted,
    });

    const itemId = record.assistantItemId;
    if (!itemId) {
      if (!interruption.transcript.trim() && interruption.audioBytes === 0) {
        this.finishRepair();
      } else {
        this.failContextRepair("Qwen did not provide an assistant item ID to repair.");
      }
      return;
    }

    repair.originalItemId = itemId;
    repair.stage = "waiting_delete";
    this.clearRepairTimeout();
    try {
      this.qwen.deleteConversationItem(itemId);
    } catch (error) {
      this.handlers.error(error, "Failed to delete interrupted assistant context");
      this.failContextRepair("Could not delete interrupted assistant context.");
      return;
    }
    this.armRepairTimeout();
  }

  private finishRepair(): void {
    const repair = this.repair;
    if (!repair?.estimate) return;
    const record = this.responses.get(repair.responseId);
    if (!record) return;

    if (record.userTurn?.status === "pending") {
      repair.stage = "waiting_user_persistence";
      this.clearRepairTimeout();
      return;
    }

    this.clearRepairTimeout();
    if (
      repair.estimate.transcript.trim() &&
      !this.persistMessage({
        role: "assistant",
        text: repair.estimate.transcript,
        interrupted: true,
        ...(repair.replacementItemId
          ? { sourceItemId: repair.replacementItemId }
          : repair.originalItemId
            ? { sourceItemId: repair.originalItemId }
            : {}),
        responseId: repair.responseId,
        ...(record.audioCaptureComplete
          ? withPersistedAudio(
              ASSISTANT_AUDIO_SAMPLE_RATE,
              concatenatePcmChunks(
                record.audioChunks,
                Math.min(
                  record.audioBytes,
                  evenPcmByteLength(
                    Math.floor(
                      (record.interruption?.safePlayedMs ?? 0) *
                        ASSISTANT_PCM_BYTES_PER_MILLISECOND,
                    ),
                  ),
                ),
              ),
            )
          : {}),
      })
    ) {
      return;
    }
    this.handlers.send({
      type: "response.reconciled",
      responseId: repair.responseId,
      ...(repair.originalItemId
        ? { originalItemId: repair.originalItemId }
        : {}),
      ...(repair.replacementItemId
        ? { replacementItemId: repair.replacementItemId }
        : {}),
      transcript: repair.estimate.transcript,
      strategy: repair.estimate.strategy,
      confidence: repair.estimate.confidence,
    });
    this.removeResponse(record);
    this.repair = undefined;
    this.sendState(
      this.inputActive ? "listening" : this.pendingCommit ? "processing" : "ready",
    );
    this.maybeFlushCommit();
  }

  private failContextRepair(message: string): void {
    this.clearRepairTimeout();
    this.terminated = true;
    this.sendError("CONTEXT_STATE_UNCERTAIN", message, false);
    this.sendState("ended");
    this.handlers.closeWithError(message);
  }

  private responseForEvent(event: QwenServerEvent): ResponseRecord | undefined {
    const responseId = event.response_id ?? this.activeGenerationResponseId;
    return responseId ? this.responses.get(responseId) : undefined;
  }

  private rememberItem(record: ResponseRecord, itemId: string): void {
    record.assistantItemId = itemId;
    this.responseIdByItemId.set(itemId, record.responseId);
  }

  private removeResponse(record: ResponseRecord): void {
    this.responses.delete(record.responseId);
    if (record.assistantItemId) this.responseIdByItemId.delete(record.assistantItemId);
  }

  private armRepairTimeout(): void {
    const repair = this.repair;
    if (!repair) return;
    this.clearRepairTimeout();
    repair.timeout = setTimeout(() => {
      this.failContextRepair(
        `Timed out while repairing interrupted response ${repair.responseId}.`,
      );
    }, REPAIR_TIMEOUT_MS);
  }

  private clearRepairTimeout(): void {
    if (this.repair?.timeout) clearTimeout(this.repair.timeout);
    if (this.repair) this.repair.timeout = undefined;
  }

  private handleUserTranscriptionDelta(event: QwenServerEvent): void {
    if (event.item_id && this.cancelledInputItemIds.has(event.item_id)) return;
    const userTurn = this.pendingUserTurn;
    if (userTurn?.itemId) {
      if (event.item_id !== userTurn.itemId) return;
    } else if (this.inputActive || this.pendingCommit) {
      if (!event.item_id || this.inputClearPending) return;
      if (
        this.inputTranscriptionItemId &&
        event.item_id !== this.inputTranscriptionItemId
      ) {
        return;
      }
      this.inputTranscriptionItemId = event.item_id;
    } else {
      return;
    }
    this.handlers.send({
      type: "transcript.user.delta",
      itemId: event.item_id ?? "unknown",
      text: event.text ?? "",
      stash: event.stash ?? "",
    });
  }

  private handleUserTranscriptionFailure(event: QwenServerEvent): void {
    const userTurn = this.pendingUserTurn;
    if (!userTurn?.itemId || event.item_id !== userTurn.itemId) return;
    this.failUserTranscription(
      event.error?.message ?? "The user audio could not be transcribed.",
    );
  }

  private handleInputAudioCommitted(event: QwenServerEvent): void {
    const userTurn = this.pendingUserTurn;
    if (!userTurn || !event.item_id) {
      this.handlers.warn(
        event,
        "Ignoring an input commit acknowledgement with no pending user turn",
      );
      return;
    }
    if (
      this.inputTranscriptionItemId &&
      event.item_id !== this.inputTranscriptionItemId
    ) {
      this.handlers.warn(
        event,
        "The committed input item did not match its streaming transcription item",
      );
    }
    userTurn.itemId = event.item_id;
    this.inputTranscriptionItemId = undefined;
  }

  private handleInputAudioCleared(): void {
    if (!this.inputClearPending) return;
    if (this.inputClearTimeout) clearTimeout(this.inputClearTimeout);
    this.inputClearTimeout = undefined;
    this.inputClearPending = false;
    this.handlers.send({ type: "input.cleared" });
    this.sendState(this.repair ? "processing" : "ready");
  }

  private completeUserTranscription(event: QwenServerEvent): void {
    const userTurn = this.pendingUserTurn;
    if (!userTurn) {
      this.handlers.warn(
        event,
        "Ignoring finalized transcription for an uncommitted or cancelled user turn",
      );
      return;
    }
    if (!userTurn.itemId || event.item_id !== userTurn.itemId) {
      this.handlers.warn(
        event,
        "Ignoring finalized transcription that does not match the committed user item",
      );
      return;
    }

    const transcript = event.transcript?.trim();
    if (!transcript) {
      this.failUserTranscription(
        "The user audio did not produce a finalized transcript.",
      );
      return;
    }

    if (userTurn?.timeout) clearTimeout(userTurn.timeout);
    if (userTurn) userTurn.timeout = undefined;
    this.pendingUserTurn = undefined;

    if (
      !this.persistMessage({
        role: "user",
        text: transcript,
        interrupted: false,
        ...(event.item_id ? { sourceItemId: event.item_id } : {}),
        ...(userTurn?.audio
          ? withPersistedAudio(USER_AUDIO_SAMPLE_RATE, userTurn.audio)
          : {}),
      })
    ) {
      return;
    }
    if (userTurn) userTurn.status = "persisted";

    this.handlers.send({
      type: "transcript.user.done",
      itemId: event.item_id ?? "unknown",
      transcript,
    });

    for (const response of this.responses.values()) {
      if (
        response.userTurn === userTurn &&
        response.waitingForUserPersistence
      ) {
        response.waitingForUserPersistence = false;
        this.finalizeCompletedPlayback(response);
        break;
      }
    }
    if (
      this.repair?.stage === "waiting_user_persistence" &&
      this.responses.get(this.repair.responseId)?.userTurn === userTurn
    ) {
      this.finishRepair();
    }
    this.maybeFlushCommit();
  }

  private failUserTranscription(message: string): void {
    if (this.terminated) return;
    if (this.pendingUserTurn?.timeout) {
      clearTimeout(this.pendingUserTurn.timeout);
    }
    this.pendingUserTurn = undefined;
    this.responseUserTurnAwaitingCreation = undefined;
    this.resetInputAudioCapture();
    this.clearRepairTimeout();
    this.terminated = true;
    this.sendError("TRANSCRIPTION_FAILED", message, false);
    this.sendState("ended");
    this.handlers.closeWithError(message);
  }

  private failInputClear(message: string): void {
    if (this.terminated) return;
    if (this.inputClearTimeout) clearTimeout(this.inputClearTimeout);
    this.inputClearTimeout = undefined;
    this.inputClearPending = false;
    this.terminated = true;
    this.sendError("INPUT_CLEAR_FAILED", message, false);
    this.sendState("ended");
    this.handlers.closeWithError(message);
  }

  private persistMessage(message: RealtimePersistedMessage): boolean {
    try {
      this.handlers.persistMessage(message);
      return true;
    } catch (error) {
      this.handlers.error(error, "Failed to persist authoritative conversation text");
      this.clearRepairTimeout();
      this.terminated = true;
      const failureMessage =
        "The authoritative conversation history could not be saved.";
      this.sendError("HISTORY_PERSISTENCE_FAILED", failureMessage, false);
      this.sendState("ended");
      this.handlers.closeWithError(failureMessage);
      return false;
    }
  }

  private resetInputAudioCapture(): void {
    this.inputBytes = 0;
    this.inputAudioChunks = [];
    this.inputAudioCaptureComplete = true;
  }

  private rememberCancelledInputItem(itemId: string | undefined): void {
    if (!itemId) return;
    this.cancelledInputItemIds.add(itemId);
    // A realtime session is short-lived, but keep the defensive tombstone set
    // bounded in case a deployment raises the session-duration limit.
    if (this.cancelledInputItemIds.size > 32) {
      const oldest = this.cancelledInputItemIds.values().next().value;
      if (oldest) this.cancelledInputItemIds.delete(oldest);
    }
  }

  private sendState(state: SessionState): void {
    if (state === this.lastSentState) return;
    this.lastSentState = state;
    this.handlers.send({ type: "session.state", state });
  }

  private sendError(code: string, message: string, recoverable: boolean): void {
    this.handlers.send({ type: "error", code, message, recoverable });
  }
}

function evenPcmByteLength(byteLength: number): number {
  return Math.max(0, byteLength - (byteLength % 2));
}

function concatenatePcmChunks(
  chunks: readonly Buffer[],
  requestedBytes: number,
): Buffer | undefined {
  const byteLength = evenPcmByteLength(requestedBytes);
  if (byteLength === 0) return undefined;
  const pcm = Buffer.concat(chunks);
  if (pcm.length < byteLength) return undefined;
  return pcm.subarray(0, byteLength);
}

function withPersistedAudio(
  sampleRate: 16_000 | 24_000,
  pcm: Buffer | undefined,
): Pick<RealtimePersistedMessage, "audio"> {
  return pcm ? { audio: { sampleRate, pcm } } : {};
}
