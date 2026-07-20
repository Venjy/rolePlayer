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
const RESPONSE_START_TIMEOUT_MS = 30_000;
const RESPONSE_PROGRESS_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_ATTEMPTS = 2;
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
  successAssessmentRequested?: boolean;
  timeout?: NodeJS.Timeout;
}

interface UserTurnPersistence {
  status: "pending" | "persisted";
  responseAttempts: number;
  itemId?: string;
  audio?: Buffer;
  timeout?: NodeJS.Timeout;
}

interface ResponseFailureContinuation {
  action: "retry" | "give_up";
  userTurn: UserTurnPersistence;
  code: "EMPTY_RESPONSE" | "RESPONSE_FAILED" | "RESPONSE_TIMEOUT";
  message: string;
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
  afterRepair?: ResponseFailureContinuation;
  timeout?: NodeJS.Timeout;
}

export interface RealtimeSessionControllerHandlers {
  send: (message: ServerMessage) => void;
  sendAudio: (audio: Buffer) => boolean;
  persistMessage: (message: RealtimePersistedMessage) => void;
  assessScenarioSuccess?: (response: {
    responseId: string;
    transcript: string;
  }) => void;
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
  private responseCreationTimeout?: NodeJS.Timeout;
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
      case "response.retry":
        this.retryPersistedUserResponse();
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

  public failUpstreamProtocol(message: string): void {
    this.terminateWithError("MALFORMED_UPSTREAM_EVENT", message);
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
      this.terminateWithError(
        "AUDIO_FORWARD_FAILED",
        "Could not forward microphone audio.",
      );
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
      case "response.text.delta":
        this.handleAssistantTranscriptDelta(event);
        break;

      case "response.audio_transcript.done":
        this.handleAssistantTranscriptDone(event);
        break;

      case "response.text.done":
        this.handleAssistantTextDone(event);
        break;

      case "response.audio.delta":
        this.handleAssistantAudio(event);
        break;

      case "response.audio.done":
      case "response.content_part.done":
      case "response.output_item.done":
        this.touchResponseForEvent(event);
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
    if (this.responseCreationTimeout) clearTimeout(this.responseCreationTimeout);
    if (this.pendingUserTurn?.timeout) {
      clearTimeout(this.pendingUserTurn.timeout);
    }
    if (this.inputClearTimeout) clearTimeout(this.inputClearTimeout);
    this.resetInputAudioCapture();
    for (const response of this.responses.values()) {
      if (response.timeout) clearTimeout(response.timeout);
      response.audioChunks = [];
    }
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
      try {
        this.qwen.clearAudio();
      } catch (error) {
        this.handlers.error(error, "Failed to clear a too-short user recording");
        this.terminateWithError(
          "INPUT_CLEAR_FAILED",
          "Could not clear the too-short recording from Qwen.",
        );
        return;
      }
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
      responseAttempts: 0,
      ...(userAudio ? { audio: userAudio } : {}),
    };
    this.resetInputAudioCapture();
    userTurn.timeout = setTimeout(() => {
      this.failUserTranscription(
        "Timed out while waiting for the finalized user transcript.",
      );
    }, USER_TRANSCRIPTION_TIMEOUT_MS);
    this.pendingUserTurn = userTurn;
    this.startResponseAttempt(userTurn, true);
  }

  private retryPersistedUserResponse(): void {
    if (
      this.inputActive ||
      this.pendingCommit ||
      this.pendingUserTurn ||
      this.repair ||
      this.awaitingResponseCreation ||
      this.activeGenerationResponseId ||
      this.responses.size > 0
    ) {
      this.sendError(
        "RESPONSE_RETRY_UNAVAILABLE",
        "The AI response cannot be retried while another turn is active.",
        true,
      );
      return;
    }

    // This control is accepted by the gateway only when SQLite confirms that
    // the latest durable message is an unanswered learner turn. Treat it as
    // the one remaining attempt in this new upstream session.
    this.startResponseAttempt(
      {
        status: "persisted",
        responseAttempts: MAX_RESPONSE_ATTEMPTS - 1,
      },
      false,
    );
  }

  private startResponseAttempt(
    userTurn: UserTurnPersistence,
    commitAudio: boolean,
  ): void {
    if (this.terminated) return;
    userTurn.responseAttempts += 1;
    this.responseUserTurnAwaitingCreation = userTurn;
    this.awaitingResponseCreation = true;
    try {
      if (commitAudio) this.qwen.commitAudioAndCreateResponse();
      else this.qwen.createResponse();
    } catch (error) {
      this.awaitingResponseCreation = false;
      this.responseUserTurnAwaitingCreation = undefined;
      this.handlers.error(error, "Failed to request a Qwen response");
      if (commitAudio) {
        this.failUserTranscription("Could not submit the user audio turn.");
      } else {
        this.terminateWithError(
          "RESPONSE_REQUEST_REJECTED",
          "Could not request the AI response retry.",
        );
      }
      return;
    }
    this.armResponseCreationTimeout();
    this.sendState("processing");
  }

  private armResponseCreationTimeout(): void {
    this.clearResponseCreationTimeout();
    this.responseCreationTimeout = setTimeout(() => {
      this.responseCreationTimeout = undefined;
      this.awaitingResponseCreation = false;
      this.responseUserTurnAwaitingCreation = undefined;
      this.terminateWithError(
        "RESPONSE_TIMEOUT",
        "Timed out while waiting for Qwen to start the AI response.",
      );
    }, RESPONSE_START_TIMEOUT_MS);
  }

  private clearResponseCreationTimeout(): void {
    if (this.responseCreationTimeout) clearTimeout(this.responseCreationTimeout);
    this.responseCreationTimeout = undefined;
  }

  private armResponseProgressTimeout(record: ResponseRecord): void {
    if (record.timeout) clearTimeout(record.timeout);
    record.timeout = setTimeout(() => {
      record.timeout = undefined;
      if (record.generation !== "generating") return;
      this.beginResponseFailure(
        record,
        "RESPONSE_TIMEOUT",
        "The AI response stopped making progress and timed out.",
      );
    }, RESPONSE_PROGRESS_TIMEOUT_MS);
  }

  private touchResponseProgress(record: ResponseRecord): void {
    if (record.generation === "generating" && !record.interruption) {
      this.armResponseProgressTimeout(record);
    }
  }

  private clearResponseProgressTimeout(record: ResponseRecord): void {
    if (record.timeout) clearTimeout(record.timeout);
    record.timeout = undefined;
  }

  private handleResponseCreated(event: QwenServerEvent): void {
    const responseId = event.response?.id;
    if (!responseId) {
      this.failUpstreamProtocol("Qwen response.created did not include a response ID.");
      return;
    }
    this.clearResponseCreationTimeout();
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
    this.armResponseProgressTimeout(record);

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
    this.touchResponseProgress(record);
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
    this.touchResponseProgress(record);
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
    this.touchResponseProgress(record);
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
    this.touchResponseProgress(record);
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

  private handleAssistantTextDone(event: QwenServerEvent): void {
    this.handleAssistantTranscriptDone({
      ...event,
      transcript: event.text ?? "",
    });
  }

  private handleAssistantAudio(event: QwenServerEvent): void {
    const record = this.responseForEvent(event);
    if (!record || !event.delta) return;
    this.touchResponseProgress(record);
    if (event.item_id) this.rememberItem(record, event.item_id);
    const audio = Buffer.from(event.delta, "base64");
    if (audio.length === 0 || audio.length % 2 !== 0) {
      this.beginResponseFailure(
        record,
        "RESPONSE_FAILED",
        "Qwen returned malformed PCM audio for the AI response.",
      );
      return;
    }
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
    this.clearResponseProgressTimeout(record);

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

    if (status === "failed") {
      this.beginResponseFailure(
        record,
        "RESPONSE_FAILED",
        event.response?.status_details?.error?.message ??
          "Qwen could not generate a response.",
      );
      return;
    }

    if (status === "completed" && !record.transcript.trim()) {
      this.beginResponseFailure(
        record,
        "EMPTY_RESPONSE",
        record.audioBytes > 0
          ? "Qwen completed the AI response without a transcript."
          : "Qwen completed the AI response without text or audio.",
      );
      return;
    }

    if (status === "completed" && record.audioBytes === 0) {
      this.beginResponseFailure(
        record,
        "EMPTY_RESPONSE",
        "Qwen completed the AI response without playable audio.",
      );
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

    if (status === "cancelled") {
      this.sendState(this.inputActive ? "listening" : "ready");
      this.removeResponse(record);
    } else {
      if (record.playback === "completed") {
        this.finalizeCompletedPlayback(record);
      }
      this.maybeAssessScenarioSuccess(record);
    }

    this.maybeFlushCommit();
  }

  private beginResponseFailure(
    record: ResponseRecord,
    code: ResponseFailureContinuation["code"],
    message: string,
  ): void {
    if (this.terminated || record.interruption) return;
    this.clearResponseProgressTimeout(record);
    record.suppressOutput = true;
    if (this.activeGenerationResponseId === record.responseId) {
      this.activeGenerationResponseId = undefined;
    }
    this.awaitingResponseCreation = false;
    this.handlers.send({
      type: "response.done",
      responseId: record.responseId,
      status: "failed",
      reason:
        code === "RESPONSE_TIMEOUT"
          ? "timeout"
          : code === "EMPTY_RESPONSE"
            ? "empty_response"
            : "generation_failed",
    });

    const userTurn = record.userTurn;
    if (!userTurn) {
      this.terminateWithError(code, message);
      return;
    }

    const canRetry = userTurn.responseAttempts < MAX_RESPONSE_ATTEMPTS;
    const continuation: ResponseFailureContinuation = {
      action: canRetry ? "retry" : "give_up",
      userTurn,
      code,
      message,
    };
    if (canRetry) {
      this.sendError(
        "RESPONSE_RETRYING",
        "The AI response failed or was empty. Retrying once.",
        true,
      );
    }
    this.requestInterruption(record, 0, continuation);
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

    if (event.error?.type === "server_error") {
      this.terminateWithError(
        "QWEN_SERVER_ERROR",
        event.error.message ?? "Qwen reported a server-side failure.",
      );
      return;
    }

    if (this.awaitingResponseCreation) {
      this.terminateWithError(
        "RESPONSE_REQUEST_REJECTED",
        event.error?.message ?? "Qwen rejected the AI response request.",
      );
      return;
    }

    this.sendError(
      event.error?.code ?? "QWEN_ERROR",
      event.error?.message ?? "Qwen returned an unknown error.",
      true,
    );
  }

  private maybeAssessScenarioSuccess(record: ResponseRecord): void {
    if (
      record.successAssessmentRequested ||
      record.generation !== "completed" ||
      record.userTurn?.status === "pending" ||
      !record.transcript.trim()
    ) {
      return;
    }
    record.successAssessmentRequested = true;
    this.handlers.assessScenarioSuccess?.({
      responseId: record.responseId,
      transcript: record.transcript,
    });
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
    afterRepair?: ResponseFailureContinuation,
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
    this.clearResponseProgressTimeout(record);
    record.interruption = {
      safePlayedMs,
      transcript: record.transcript,
      audioBytes: record.audioBytes,
      generationCompleted: record.generation === "completed",
    };
    this.repair = {
      responseId: record.responseId,
      stage: "waiting_terminal",
      ...(afterRepair ? { afterRepair } : {}),
    };
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
    const afterRepair = repair.afterRepair;
    this.removeResponse(record);
    this.repair = undefined;

    if (afterRepair?.action === "retry") {
      this.startResponseAttempt(afterRepair.userTurn, false);
      return;
    }

    if (afterRepair?.action === "give_up") {
      this.sendError(
        afterRepair.code,
        `${afterRepair.message} The automatic retry also failed; please speak again.`,
        true,
      );
    }
    this.sendState(
      this.inputActive ? "listening" : this.pendingCommit ? "processing" : "ready",
    );
    this.maybeFlushCommit();
  }

  private failContextRepair(message: string): void {
    this.clearRepairTimeout();
    this.terminateWithError("CONTEXT_STATE_UNCERTAIN", message);
  }

  private terminateWithError(code: string, message: string): void {
    if (this.terminated) return;
    this.terminated = true;
    this.clearResponseCreationTimeout();
    this.clearRepairTimeout();
    if (this.pendingUserTurn?.timeout) {
      clearTimeout(this.pendingUserTurn.timeout);
      this.pendingUserTurn.timeout = undefined;
    }
    if (this.inputClearTimeout) clearTimeout(this.inputClearTimeout);
    this.inputClearTimeout = undefined;
    for (const response of this.responses.values()) {
      this.clearResponseProgressTimeout(response);
    }
    this.sendError(code, message, false);
    this.sendState("ended");
    this.handlers.closeWithError(message);
  }

  private responseForEvent(event: QwenServerEvent): ResponseRecord | undefined {
    const responseId = event.response_id ?? this.activeGenerationResponseId;
    return responseId ? this.responses.get(responseId) : undefined;
  }

  private touchResponseForEvent(event: QwenServerEvent): void {
    const record = this.responseForEvent(event);
    if (record) this.touchResponseProgress(record);
  }

  private rememberItem(record: ResponseRecord, itemId: string): void {
    record.assistantItemId = itemId;
    this.responseIdByItemId.set(itemId, record.responseId);
  }

  private removeResponse(record: ResponseRecord): void {
    this.clearResponseProgressTimeout(record);
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

    for (const response of this.responses.values()) {
      if (response.userTurn === userTurn) this.maybeAssessScenarioSuccess(response);
    }

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
    this.terminateWithError("TRANSCRIPTION_FAILED", message);
  }

  private failInputClear(message: string): void {
    if (this.terminated) return;
    if (this.inputClearTimeout) clearTimeout(this.inputClearTimeout);
    this.inputClearTimeout = undefined;
    this.inputClearPending = false;
    this.terminateWithError("INPUT_CLEAR_FAILED", message);
  }

  private persistMessage(message: RealtimePersistedMessage): boolean {
    try {
      this.handlers.persistMessage(message);
      return true;
    } catch (error) {
      this.handlers.error(error, "Failed to persist authoritative conversation text");
      this.clearRepairTimeout();
      const failureMessage =
        "The authoritative conversation history could not be saved.";
      this.terminateWithError("HISTORY_PERSISTENCE_FAILED", failureMessage);
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
