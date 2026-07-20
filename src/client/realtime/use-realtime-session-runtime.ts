import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  MAX_REALTIME_HISTORY_TURNS,
  type ServerMessage,
  type SessionState,
} from "../../shared/realtime-protocol";
import type { ConversationDetail } from "../../shared/conversation-history";
import { readableError, readableServerError, type UiError } from "../app/app-errors";
import { BrowserAudioEngine } from "../audio/browser-audio-engine";
import {
  pauseConversation as pauseConversationRequest,
  resumeConversation as resumeConversationRequest,
} from "../conversations/conversation-api";
import type { LocalizedText } from "../i18n";
import { RealtimeClient } from "./realtime-client";
import { selectRealtimeErrorAction } from "./realtime-error-policy";
import {
  requireSuccessfulSettlement,
  SETTLEMENT_SUCCEEDED,
  type AssistantSettlementWaiter,
  type SettlementResult,
} from "./use-realtime-settlement";
import type {
  ActiveSessionConfig,
  AssistantDraft,
  FreeConversationAudioRouting,
  LongRecordingAction,
  TranscriptTurn,
  VoiceInputMode,
} from "../session/session-types";
import { FreeConversationController } from "../voice/free-conversation-controller";

// A repair can legally spend up to 10 seconds in each persistence stage.
// Navigation waits for that server-side barrier before closing the runtime.
const RUNTIME_RECOVERY_STABILITY_MS = 5_000;
const FREE_CONVERSATION_PRE_ROLL_CHUNKS = 5;

interface RuntimeRef<T> {
  current: T;
}

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export interface AssistantRuntime {
  responseId: string;
  itemId?: string;
  streamedText: string;
  finalTranscript?: string;
  generationStatus?: "completed" | "cancelled" | "failed";
  playbackComplete: boolean;
  finalized: boolean;
  interrupted: boolean;
  startedAt: Date;
  interruptionSafePlayedMs?: number;
  interruptionReceiptSent?: boolean;
}

interface RuntimeMessageContext {
  conversationId: number;
  runtimeEpoch: number;
}

export interface RuntimeRecoveryRequest extends RuntimeMessageContext {
  error: UiError;
  notify?: boolean;
  retryLastResponse?: boolean;
}

export interface RealtimeSessionRuntimeOptions {
  activeConversationId: number | null;
  muted: boolean;
  volume: number;
  showSessionError: (error: UiError) => void;
  clearSessionError: () => void;
  refreshConversationHistory: () => Promise<void>;
  loadConversation: (conversationId: number) => Promise<ConversationDetail>;
  completeAssistantSettlement: (
    result: SettlementResult,
    responseId?: string,
    clearPendingResponse?: boolean,
  ) => void;
  waitForAssistantSettlement: (
    responseId: string,
  ) => Promise<SettlementResult>;
  completeUserCommitSettlement: (
    result: SettlementResult,
    clearPending?: boolean,
  ) => void;
  waitForUserCommitSettlement: () => Promise<SettlementResult>;
  realtimeRef: RuntimeRef<RealtimeClient | undefined>;
  audioRef: RuntimeRef<BrowserAudioEngine | undefined>;
  playbackActiveRef: RuntimeRef<boolean>;
  activeResponseIdRef: RuntimeRef<string | undefined>;
  assistantResponsesRef: RuntimeRef<Map<string, AssistantRuntime>>;
  assistantSettlementWaiterRef: RuntimeRef<
    AssistantSettlementWaiter | undefined
  >;
  pendingAssistantResponseIdRef: RuntimeRef<string | undefined>;
  userCommitPendingRef: RuntimeRef<boolean>;
  recordingRef: RuntimeRef<boolean>;
  submissionRef: RuntimeRef<boolean>;
  acceptUserTranscriptRef: RuntimeRef<boolean>;
  recordingStartedAtRef: RuntimeRef<number>;
  freeConversationAudioRef: RuntimeRef<FreeConversationAudioRouting>;
  sessionEstablishedRef: RuntimeRef<boolean>;
  pendingRuntimeRecoveryRef: RuntimeRef<RuntimeRecoveryRequest | undefined>;
  runtimeRecoveryConsumedRef: RuntimeRef<boolean>;
  conversationStartedRef: RuntimeRef<boolean>;
  runtimeEpochRef: RuntimeRef<number>;
  runtimeRecoveryStabilityTimerRef: RuntimeRef<number | undefined>;
  runPendingRuntimeRecoveryRef: RuntimeRef<() => void>;
  activeConversationIdRef: RuntimeRef<number | null>;
  synchronizeRequestedRouteRef: RuntimeRef<() => void>;
  cleanupPromiseRef: RuntimeRef<Promise<void>>;
  componentMountedRef: RuntimeRef<boolean>;
  followLatestRef: RuntimeRef<boolean>;
  transitionInProgressRef: RuntimeRef<boolean>;
  freeConversationController: FreeConversationController;
  setErrorMessage: StateSetter<UiError | null>;
  setRuntimeRecoveryFailed: StateSetter<boolean>;
  setSessionState: StateSetter<SessionState>;
  setIsReconciling: StateSetter<boolean>;
  setIsRecording: StateSetter<boolean>;
  setIsSubmitting: StateSetter<boolean>;
  setRecordingDuration: StateSetter<number>;
  setInputLevel: StateSetter<number>;
  setOutputLevel: StateSetter<number>;
  setVoiceInputMode: StateSetter<VoiceInputMode>;
  setVoiceModeMenuOpen: StateSetter<boolean>;
  setVoiceModeTransitioning: StateSetter<boolean>;
  setLongRecordingAction: StateSetter<LongRecordingAction | null>;
  setLongRecordingCancellationRequired: StateSetter<boolean>;
  setUserDraft: StateSetter<string>;
  setAssistantDraft: StateSetter<AssistantDraft | null>;
  setSessionPaused: StateSetter<boolean>;
  setSessionActive: StateSetter<boolean>;
  setActiveSessionConfig: StateSetter<ActiveSessionConfig | null>;
  setActiveConversationId: StateSetter<number | null>;
  setTurns: StateSetter<TranscriptTurn[]>;
  setSuccessSuggestionResponseId: StateSetter<string | null>;
  setIsStarting: StateSetter<boolean>;
}

/**
 * Owns the Qwen connection, browser audio runtime, server-message projection,
 * interruption reconciliation, durable settlement, and automatic recovery.
 */
export function useRealtimeSessionRuntime({
  activeConversationId,
  muted,
  volume,
  showSessionError,
  clearSessionError,
  refreshConversationHistory,
  loadConversation,
  completeAssistantSettlement,
  waitForAssistantSettlement,
  completeUserCommitSettlement,
  waitForUserCommitSettlement,
  realtimeRef,
  audioRef,
  playbackActiveRef,
  activeResponseIdRef,
  assistantResponsesRef,
  assistantSettlementWaiterRef,
  pendingAssistantResponseIdRef,
  userCommitPendingRef,
  recordingRef,
  submissionRef,
  acceptUserTranscriptRef,
  recordingStartedAtRef,
  freeConversationAudioRef,
  sessionEstablishedRef,
  pendingRuntimeRecoveryRef,
  runtimeRecoveryConsumedRef,
  conversationStartedRef,
  runtimeEpochRef,
  runtimeRecoveryStabilityTimerRef,
  runPendingRuntimeRecoveryRef,
  activeConversationIdRef,
  synchronizeRequestedRouteRef,
  cleanupPromiseRef,
  componentMountedRef,
  followLatestRef,
  transitionInProgressRef,
  freeConversationController,
  setErrorMessage,
  setRuntimeRecoveryFailed,
  setSessionState,
  setIsReconciling,
  setIsRecording,
  setIsSubmitting,
  setRecordingDuration,
  setInputLevel,
  setOutputLevel,
  setVoiceInputMode,
  setVoiceModeMenuOpen,
  setVoiceModeTransitioning,
  setLongRecordingAction,
  setLongRecordingCancellationRequired,
  setUserDraft,
  setAssistantDraft,
  setSessionPaused,
  setSessionActive,
  setActiveSessionConfig,
  setActiveConversationId,
  setTurns,
  setSuccessSuggestionResponseId,
  setIsStarting,
}: RealtimeSessionRuntimeOptions) {
  const reportContextualError = useCallback(
    (error: UiError) => {
      if (conversationStartedRef.current) {
        if (!pendingRuntimeRecoveryRef.current) showSessionError(error);
      } else {
        setErrorMessage(error);
      }
    },
    [
      conversationStartedRef,
      pendingRuntimeRecoveryRef,
      setErrorMessage,
      showSessionError,
    ],
  );
  
  const queueRuntimeRecovery = useCallback(
    (request: RuntimeRecoveryRequest): boolean => {
      const existing = pendingRuntimeRecoveryRef.current;
      if (existing?.runtimeEpoch === request.runtimeEpoch) return true;
      if (runtimeRecoveryConsumedRef.current) return false;
  
      runtimeRecoveryConsumedRef.current = true;
      pendingRuntimeRecoveryRef.current = request;
      setRuntimeRecoveryFailed(false);
      if (request.notify !== false) showSessionError(request.error);
      setSessionState("connecting");
      runPendingRuntimeRecoveryRef.current();
      return true;
    },
    [
      pendingRuntimeRecoveryRef,
      runPendingRuntimeRecoveryRef,
      runtimeRecoveryConsumedRef,
      setRuntimeRecoveryFailed,
      setSessionState,
      showSessionError,
    ],
  );
  
  
  const tryFinalizeAssistant = useCallback(
    (responseId: string) => {
      const runtime = assistantResponsesRef.current.get(responseId);
      if (
        !runtime ||
        runtime.finalized ||
        runtime.interrupted ||
        runtime.generationStatus !== "completed" ||
        !runtime.playbackComplete
      ) {
        return;
      }
  
      runtime.finalized = true;
      void waitForAssistantSettlement(responseId);
      const realtime = realtimeRef.current;
      if (realtime) {
        try {
          realtime.completePlayback(responseId);
        } catch (error) {
          completeAssistantSettlement(
            {
              ok: false,
              error:
                error instanceof Error
                  ? error
                  : new Error("Could not send the assistant playback receipt."),
            },
            responseId,
            false,
          );
          reportContextualError(readableError(error));
        }
      } else {
        completeAssistantSettlement(
          {
            ok: false,
            error: new Error("Could not send the assistant playback receipt."),
          },
          responseId,
          false,
        );
      }
      audioRef.current?.finalizePlayback(responseId);
      if (activeResponseIdRef.current === responseId) {
        activeResponseIdRef.current = undefined;
      }
      setIsReconciling(true);
      setSessionState("processing");
    },
    [
      activeResponseIdRef,
      assistantResponsesRef,
      audioRef,
      completeAssistantSettlement,
      realtimeRef,
      reportContextualError,
      setIsReconciling,
      setSessionState,
      waitForAssistantSettlement,
    ],
  );
  
  const teardownSessionRuntime = useCallback(
    (
      disconnectRealtime = true,
      preserveSessionView = false,
    ): Promise<void> => {
      const unsettledError = new Error(
        "The realtime connection closed before pending conversation data was saved.",
      );
      completeAssistantSettlement(
        { ok: false, error: unsettledError },
        undefined,
        true,
      );
      completeUserCommitSettlement({ ok: false, error: unsettledError });
      sessionEstablishedRef.current = false;
      if (runtimeRecoveryStabilityTimerRef.current !== undefined) {
        window.clearTimeout(runtimeRecoveryStabilityTimerRef.current);
        runtimeRecoveryStabilityTimerRef.current = undefined;
      }
      if (!preserveSessionView) {
        pendingRuntimeRecoveryRef.current = undefined;
        runtimeRecoveryConsumedRef.current = false;
        conversationStartedRef.current = false;
      }
      runtimeEpochRef.current += 1;
      const realtime = realtimeRef.current;
      const audio = audioRef.current;
      realtimeRef.current = undefined;
      audioRef.current = undefined;
  
      recordingRef.current = false;
      submissionRef.current = false;
      acceptUserTranscriptRef.current = false;
      playbackActiveRef.current = false;
      activeResponseIdRef.current = undefined;
      recordingStartedAtRef.current = 0;
      assistantResponsesRef.current.clear();
      freeConversationAudioRef.current = {
        enabled: false,
        turnOpen: false,
        preRoll: [],
      };
      freeConversationController.disable();
  
      if (disconnectRealtime) realtime?.disconnect();
  
      setIsRecording(false);
      setIsSubmitting(false);
      setRecordingDuration(0);
      setInputLevel(0);
      setOutputLevel(0);
      setVoiceInputMode("push-to-talk");
      setVoiceModeMenuOpen(false);
      setVoiceModeTransitioning(false);
      setLongRecordingAction(null);
      setLongRecordingCancellationRequired(false);
      setUserDraft("");
      setAssistantDraft(null);
      setIsReconciling(false);
      if (preserveSessionView) {
        setSessionState("connecting");
      } else {
        setSessionPaused(false);
        setRuntimeRecoveryFailed(false);
        clearSessionError();
        setSessionActive(false);
        setActiveSessionConfig(null);
        activeConversationIdRef.current = null;
        setActiveConversationId(null);
        setSessionState("ended");
      }
  
      const disposeAudio = audio?.dispose().catch(() => {
        // State and media tracks are cleared synchronously before AudioContext
        // close completes; a close failure must not strand the next session.
      });
      const cleanup = Promise.all([
        cleanupPromiseRef.current,
        disposeAudio,
      ]).then(() => undefined);
      cleanupPromiseRef.current = cleanup;
      return cleanup;
    },
    [
      acceptUserTranscriptRef,
      activeConversationIdRef,
      activeResponseIdRef,
      assistantResponsesRef,
      audioRef,
      cleanupPromiseRef,
      completeAssistantSettlement,
      conversationStartedRef,
      freeConversationAudioRef,
      clearSessionError,
      completeUserCommitSettlement,
      freeConversationController,
      pendingRuntimeRecoveryRef,
      playbackActiveRef,
      realtimeRef,
      recordingRef,
      recordingStartedAtRef,
      runtimeEpochRef,
      runtimeRecoveryConsumedRef,
      runtimeRecoveryStabilityTimerRef,
      sessionEstablishedRef,
      setActiveConversationId,
      setActiveSessionConfig,
      setAssistantDraft,
      setInputLevel,
      setIsReconciling,
      setIsRecording,
      setIsSubmitting,
      setLongRecordingAction,
      setLongRecordingCancellationRequired,
      setOutputLevel,
      setRecordingDuration,
      setRuntimeRecoveryFailed,
      setSessionActive,
      setSessionPaused,
      setSessionState,
      setUserDraft,
      setVoiceInputMode,
      setVoiceModeMenuOpen,
      setVoiceModeTransitioning,
      submissionRef,
    ],
  );
  
  const handleServerMessage = useCallback(
    (message: ServerMessage, context?: RuntimeMessageContext) => {
      switch (message.type) {
        case "session.state":
          if (message.state === "ready" && playbackActiveRef.current) return;
          setSessionState(message.state);
          if (message.state === "ready") {
            void refreshConversationHistory();
          }
          break;
  
        case "transcript.user.delta":
          if (!acceptUserTranscriptRef.current) break;
          setUserDraft(message.text + message.stash);
          break;
  
        case "transcript.user.done":
          if (!acceptUserTranscriptRef.current) break;
          acceptUserTranscriptRef.current = false;
          if (message.transcript.trim()) {
            setTurns((current) => [
              ...current,
              {
                id: message.itemId,
                role: "user",
                text: message.transcript,
                timestamp: new Date(),
              },
            ]);
          }
          setUserDraft("");
          completeUserCommitSettlement(SETTLEMENT_SUCCEEDED);
          void refreshConversationHistory();
          break;
  
        case "response.started": {
          const runtime: AssistantRuntime = {
            responseId: message.responseId,
            streamedText: "",
            playbackComplete: false,
            finalized: false,
            interrupted: false,
            startedAt: new Date(),
          };
          assistantResponsesRef.current.set(message.responseId, runtime);
          activeResponseIdRef.current = message.responseId;
          setIsReconciling(false);
          setAssistantDraft({ responseId: message.responseId, text: "" });
          setSessionState("processing");
          break;
        }
  
        case "transcript.assistant.delta": {
          const runtime = assistantResponsesRef.current.get(message.responseId);
          if (!runtime || runtime.interrupted) break;
          runtime.itemId = message.itemId;
          runtime.streamedText += message.delta;
          setAssistantDraft({
            responseId: message.responseId,
            text: runtime.streamedText,
          });
          break;
        }
  
        case "transcript.assistant.done": {
          const runtime = assistantResponsesRef.current.get(message.responseId);
          if (!runtime || runtime.interrupted) break;
          runtime.itemId = message.itemId;
          runtime.finalTranscript = message.transcript;
          break;
        }
  
        case "response.done": {
          if (!message.responseId) break;
          const runtime = assistantResponsesRef.current.get(message.responseId);
          if (!runtime) break;
          runtime.generationStatus = message.status;
  
          if (message.status === "completed") {
            audioRef.current?.markResponseDone(message.responseId);
            tryFinalizeAssistant(message.responseId);
          } else {
            audioRef.current?.interruptPlayback(message.responseId);
            playbackActiveRef.current = false;
            assistantResponsesRef.current.delete(message.responseId);
            if (activeResponseIdRef.current === message.responseId) {
              activeResponseIdRef.current = undefined;
            }
            setAssistantDraft((current) =>
              current?.responseId === message.responseId ? null : current,
            );
            setIsReconciling(false);
          }
          break;
        }
  
        case "scenario.success.detected":
          setSuccessSuggestionResponseId(message.responseId);
          break;
  
        case "response.persisted": {
          const runtime = assistantResponsesRef.current.get(message.responseId);
          const transcript = (
            runtime?.finalTranscript ?? runtime?.streamedText ?? ""
          ).trim();
          if (runtime && transcript) {
            setTurns((current) => [
              ...current,
              {
                id: runtime.itemId ?? `${message.responseId}:completed`,
                responseId: message.responseId,
                role: "assistant",
                text: transcript,
                timestamp: runtime.startedAt,
              },
            ]);
          }
          assistantResponsesRef.current.delete(message.responseId);
          setAssistantDraft((current) =>
            current?.responseId === message.responseId ? null : current,
          );
          setIsReconciling(false);
          completeAssistantSettlement(
            SETTLEMENT_SUCCEEDED,
            message.responseId,
            true,
          );
          runtimeRecoveryConsumedRef.current = false;
          void refreshConversationHistory();
          break;
        }
  
        case "response.reconciled": {
          const runtime = assistantResponsesRef.current.get(message.responseId);
          const transcript = message.transcript.trim();
          audioRef.current?.interruptPlayback(message.responseId);
          playbackActiveRef.current = false;
          setTurns((current) => {
            const existingIndex = current.findIndex(
              (turn) =>
                turn.role === "assistant" &&
                (turn.responseId === message.responseId ||
                  (message.originalItemId !== undefined &&
                    turn.id === message.originalItemId)),
            );
            const next = [...current];
            if (existingIndex >= 0) next.splice(existingIndex, 1);
            if (!transcript) return next;
  
            const repairedTurn: TranscriptTurn = {
              id:
                message.replacementItemId ??
                `${message.responseId}:interrupted`,
              responseId: message.responseId,
              role: "assistant",
              text: transcript,
              timestamp: runtime?.startedAt ?? new Date(),
              interrupted: true,
            };
            if (existingIndex >= 0) next.splice(existingIndex, 0, repairedTurn);
            else next.push(repairedTurn);
            return next;
          });
  
          assistantResponsesRef.current.delete(message.responseId);
          audioRef.current?.finalizePlayback(message.responseId);
          if (activeResponseIdRef.current === message.responseId) {
            activeResponseIdRef.current = undefined;
          }
          setAssistantDraft((current) =>
            current?.responseId === message.responseId ? null : current,
          );
          setIsReconciling(false);
          completeAssistantSettlement(
            SETTLEMENT_SUCCEEDED,
            message.responseId,
            true,
          );
          void refreshConversationHistory();
          break;
        }
  
        case "error": {
          const retryLastResponse =
            message.code !== "TRANSCRIPTION_FAILED" &&
            (message.code === "RESPONSE_TIMEOUT" ||
              message.code === "RESPONSE_REQUEST_REJECTED" ||
              message.code === "QWEN_SERVER_ERROR" ||
              message.code === "MALFORMED_UPSTREAM_EVENT" ||
              message.code === "UPSTREAM_CLOSED" ||
              activeResponseIdRef.current !== undefined ||
              pendingAssistantResponseIdRef.current !== undefined ||
              userCommitPendingRef.current);
          if (message.code === "PLAYBACK_BACKPRESSURE") {
            const responseId = activeResponseIdRef.current;
            if (responseId) {
              void waitForAssistantSettlement(responseId);
              const runtime = assistantResponsesRef.current.get(responseId);
              if (runtime) {
                runtime.interrupted = true;
                runtime.interruptionSafePlayedMs = 0;
                runtime.interruptionReceiptSent = true;
              }
              audioRef.current?.interruptPlayback(responseId);
              playbackActiveRef.current = false;
              setAssistantDraft(null);
              setIsReconciling(true);
            }
          }
          if (message.code === "UNKNOWN_RESPONSE") {
            completeAssistantSettlement(
              { ok: false, error: new Error(message.message) },
              undefined,
              true,
            );
          }
          if (message.code === "RECORDING_TOO_SHORT") {
            acceptUserTranscriptRef.current = false;
            setUserDraft("");
            completeUserCommitSettlement(SETTLEMENT_SUCCEEDED);
          } else if (message.code === "TRANSCRIPTION_FAILED") {
            acceptUserTranscriptRef.current = false;
            completeUserCommitSettlement({
              ok: false,
              error: new Error(message.message),
            });
          }
          const displayError = readableServerError(
            message.code,
            message.message,
          );
          const action = selectRealtimeErrorAction({
            conversationStarted: conversationStartedRef.current,
            recoverable: message.recoverable,
          });
          if (action === "show_launch_error") {
            setErrorMessage(displayError);
          } else {
            showSessionError(displayError);
          }
          if (!message.recoverable) {
            const settlementError = new Error(message.message);
            completeAssistantSettlement(
              { ok: false, error: settlementError },
              undefined,
              true,
            );
            completeUserCommitSettlement({
              ok: false,
              error: settlementError,
            });
            if (action === "reconnect_session") {
              const queued = context
                ? queueRuntimeRecovery({
                    ...context,
                    error: displayError,
                    notify: false,
                    retryLastResponse,
                  })
                : false;
              if (!queued) {
                // This conversation has already been usable, so even a failed
                // automatic rebuild must not eject the learner to the launcher.
                // Keep the durable transcript visible and offer manual retry.
                void teardownSessionRuntime(true, true);
                setRuntimeRecoveryFailed(true);
                setSessionState("ended");
              }
            } else {
              void teardownSessionRuntime();
            }
          } else if (
            message.code === "EMPTY_RESPONSE" ||
            message.code === "RESPONSE_FAILED" ||
            message.code === "NO_RESPONSE_TO_RETRY"
          ) {
            runtimeRecoveryConsumedRef.current = false;
          }
          break;
        }
  
        case "session.ready":
          conversationStartedRef.current = true;
          sessionEstablishedRef.current = true;
          setRuntimeRecoveryFailed(false);
          setSessionState("ready");
          break;
      }
    },
    [
      acceptUserTranscriptRef,
      activeResponseIdRef,
      assistantResponsesRef,
      audioRef,
      refreshConversationHistory,
      completeAssistantSettlement,
      completeUserCommitSettlement,
      conversationStartedRef,
      pendingAssistantResponseIdRef,
      playbackActiveRef,
      queueRuntimeRecovery,
      runtimeRecoveryConsumedRef,
      sessionEstablishedRef,
      setAssistantDraft,
      setErrorMessage,
      setIsReconciling,
      setRuntimeRecoveryFailed,
      setSessionState,
      setSuccessSuggestionResponseId,
      setTurns,
      setUserDraft,
      showSessionError,
      teardownSessionRuntime,
      tryFinalizeAssistant,
      userCommitPendingRef,
      waitForAssistantSettlement,
    ],
  );
  
  const interruptActivePlaybackAndWait = useCallback(
    (): Promise<SettlementResult> => {
    const responseId =
      activeResponseIdRef.current ?? pendingAssistantResponseIdRef.current;
    const existing = assistantSettlementWaiterRef.current;
    if (!responseId) {
      return existing?.promise ?? Promise.resolve(SETTLEMENT_SUCCEEDED);
    }
    if (existing?.responseId === responseId) return existing.promise;
  
    const completion = waitForAssistantSettlement(responseId);
    const runtime = assistantResponsesRef.current.get(responseId);
    if (runtime?.finalized || runtime?.interruptionReceiptSent) {
      return completion;
    }
  
    if (runtime) runtime.interrupted = true;
    const safePlayedMs =
      runtime?.interruptionSafePlayedMs ??
      audioRef.current?.interruptPlayback(responseId).safePlayedMs ??
      0;
    if (runtime) runtime.interruptionSafePlayedMs = safePlayedMs;
    playbackActiveRef.current = false;
    setAssistantDraft(null);
    setIsReconciling(true);
    setSessionState("processing");
  
    const realtime = realtimeRef.current;
    if (!realtime) {
      completeAssistantSettlement(
        {
          ok: false,
          error: new Error("Could not send the assistant playback receipt."),
        },
        responseId,
        true,
      );
      return completion;
    }
    try {
      realtime.interruptPlayback(responseId, safePlayedMs);
      if (runtime) runtime.interruptionReceiptSent = true;
    } catch (error) {
      completeAssistantSettlement(
        {
          ok: false,
          error:
            error instanceof Error
              ? error
              : new Error("Could not send the assistant playback receipt."),
        },
        responseId,
        false,
      );
      reportContextualError(readableError(error));
    }
    return completion;
    },
    [
      activeResponseIdRef,
      assistantResponsesRef,
      assistantSettlementWaiterRef,
      audioRef,
      completeAssistantSettlement,
      pendingAssistantResponseIdRef,
      playbackActiveRef,
      realtimeRef,
      reportContextualError,
      setAssistantDraft,
      setIsReconciling,
      setSessionState,
      waitForAssistantSettlement,
    ],
  );
  
  const settleSessionBeforeTransition = useCallback(async (): Promise<void> => {
    requireSuccessfulSettlement(await interruptActivePlaybackAndWait());
    requireSuccessfulSettlement(await waitForUserCommitSettlement());
    // The committed user turn can create a response while its transcript is
    // being persisted. Re-check after that user-side acknowledgement.
    requireSuccessfulSettlement(await interruptActivePlaybackAndWait());
  }, [interruptActivePlaybackAndWait, waitForUserCommitSettlement]);
  
  const stageConversationView = useCallback(
    (conversation: ConversationDetail): void => {
      setActiveSessionConfig({
        persona: conversation.persona,
        scenario: conversation.scenario,
        difficulty: conversation.difficulty,
      });
      setSuccessSuggestionResponseId(null);
      activeConversationIdRef.current = conversation.id;
      setActiveConversationId(conversation.id);
      setErrorMessage(null);
      acceptUserTranscriptRef.current = false;
      setTurns(
        conversation.messages.map((message) => ({
          id: message.id,
          role: message.role,
          text: message.text,
          timestamp: new Date(message.createdAt),
          interrupted: message.interrupted,
        })),
      );
      setUserDraft("");
      setAssistantDraft(null);
      setIsReconciling(false);
      assistantResponsesRef.current.clear();
      activeResponseIdRef.current = undefined;
      playbackActiveRef.current = false;
      followLatestRef.current = true;
    },
    [
      acceptUserTranscriptRef,
      activeConversationIdRef,
      activeResponseIdRef,
      assistantResponsesRef,
      followLatestRef,
      playbackActiveRef,
      setActiveConversationId,
      setActiveSessionConfig,
      setAssistantDraft,
      setErrorMessage,
      setIsReconciling,
      setSuccessSuggestionResponseId,
      setTurns,
      setUserDraft,
    ],
  );
  
  const showPausedConversation = useCallback(
    (conversation: ConversationDetail): void => {
      stageConversationView(conversation);
      conversationStartedRef.current = true;
      sessionEstablishedRef.current = false;
      setRuntimeRecoveryFailed(false);
      setSessionActive(true);
      setSessionPaused(true);
      setSessionState("paused");
    },
    [
      conversationStartedRef,
      sessionEstablishedRef,
      setRuntimeRecoveryFailed,
      setSessionActive,
      setSessionPaused,
      setSessionState,
      stageConversationView,
    ],
  );
  
  const activateConversation = useCallback(async (
    conversation: ConversationDetail,
  ): Promise<void> => {
    conversation = await resumeConversationRequest(conversation.id);
    if (!componentMountedRef.current) {
      throw new Error("Session activation was superseded.");
    }
    const preserveSessionViewOnFailure = conversationStartedRef.current;
    const runtimeEpoch = runtimeEpochRef.current + 1;
    runtimeEpochRef.current = runtimeEpoch;
    sessionEstablishedRef.current = false;
    const isCurrentRuntime = () =>
      componentMountedRef.current && runtimeEpochRef.current === runtimeEpoch;
    let realtime: RealtimeClient | undefined;
    const recoverAfterLocalRuntimeFailure = (
      error: UiError,
      retryLastResponse: boolean,
    ) => {
      if (!isCurrentRuntime()) return;
      if (!conversationStartedRef.current) {
        reportContextualError(error);
        return;
      }
      const queued = queueRuntimeRecovery({
        conversationId: conversation.id,
        runtimeEpoch,
        error,
        retryLastResponse,
      });
      if (!queued) {
        showSessionError(error);
        void teardownSessionRuntime(true, true);
        setRuntimeRecoveryFailed(true);
        setSessionState("ended");
      }
    };
    stageConversationView(conversation);
  
    await cleanupPromiseRef.current;
    if (!isCurrentRuntime()) {
      throw new Error("Session activation was superseded.");
    }
  
    const audio = new BrowserAudioEngine({
      onInputPcm: (buffer) => {
        if (
          !isCurrentRuntime() ||
          !realtime ||
          realtimeRef.current !== realtime
        ) {
          return;
        }
        try {
          const freeConversation = freeConversationAudioRef.current;
          if (freeConversation.enabled && !freeConversation.turnOpen) {
            freeConversation.preRoll.push(buffer);
            if (
              freeConversation.preRoll.length >
              FREE_CONVERSATION_PRE_ROLL_CHUNKS
            ) {
              freeConversation.preRoll.shift();
            }
            return;
          }
          realtime.sendAudio(buffer);
        } catch (error) {
          recoverAfterLocalRuntimeFailure(
            readableError(error),
            userCommitPendingRef.current,
          );
        }
      },
      onInputLevel: (level) => {
        if (!isCurrentRuntime()) return;
        setInputLevel(level);
        if (freeConversationAudioRef.current.enabled) {
          freeConversationController.handleLevel(
            level,
            performance.now(),
            playbackActiveRef.current,
          );
        }
      },
      onPlaybackLevel: (level) => {
        if (isCurrentRuntime()) setOutputLevel(level);
      },
      onPlaybackStarted: (responseId) => {
        if (!isCurrentRuntime()) return;
        activeResponseIdRef.current = responseId;
        playbackActiveRef.current = true;
        setSessionState("speaking");
      },
      onPlaybackDrained: (responseId) => {
        if (!isCurrentRuntime()) return;
        playbackActiveRef.current = false;
        const runtime = assistantResponsesRef.current.get(responseId);
        if (runtime) runtime.playbackComplete = true;
        tryFinalizeAssistant(responseId);
      },
      onError: (error) => {
        recoverAfterLocalRuntimeFailure(
          readableError(error),
          activeResponseIdRef.current !== undefined ||
            pendingAssistantResponseIdRef.current !== undefined ||
            userCommitPendingRef.current,
        );
      },
      onCaptureSettings: (settings) => {
        // This contains only effective processing flags/sample shape, never a
        // device label or identifier. It makes browser-specific microphone
        // behavior diagnosable without exposing private device metadata.
        console.info("[role-player] Microphone capture settings", settings);
      },
    });
    audioRef.current = audio;
  
    try {
      await audio.prepare();
      if (!isCurrentRuntime()) {
        throw new Error("Session activation was superseded.");
      }
      audio.setVolume(muted ? 0 : volume);
  
      realtime = new RealtimeClient({
        onMessage: (message) => {
          if (isCurrentRuntime() && realtimeRef.current === realtime) {
            handleServerMessage(message, {
              conversationId: conversation.id,
              runtimeEpoch,
            });
          }
        },
        onAudio: (responseId, buffer) => {
          if (!isCurrentRuntime() || realtimeRef.current !== realtime) return;
          void audio.enqueuePcm24(responseId, buffer).catch((error: unknown) => {
            recoverAfterLocalRuntimeFailure(readableError(error), true);
          });
        },
        onMalformedMessage: () => {
          if (!isCurrentRuntime() || realtimeRef.current !== realtime) return;
          recoverAfterLocalRuntimeFailure(
            {
              en: "The realtime gateway returned a malformed message.",
              zh: "实时网关返回了格式异常的消息。",
            },
            activeResponseIdRef.current !== undefined ||
              pendingAssistantResponseIdRef.current !== undefined ||
              userCommitPendingRef.current,
          );
        },
        onClose: (event) => {
          if (!isCurrentRuntime() || realtimeRef.current !== realtime) return;
          void refreshConversationHistory();
          const retryLastResponse = true;
          const closeError: LocalizedText = {
            en: `The realtime connection closed unexpectedly (${event.code}).`,
            zh: `实时连接意外关闭（${event.code}）。`,
          };
          if (conversationStartedRef.current) {
            if (sessionEstablishedRef.current) {
              const unsettledError = new Error(
                "The realtime connection closed before pending conversation data was saved.",
              );
              // Navigation and session-ending flows may already be waiting for
              // persistence acknowledgements. Wake them immediately instead of
              // leaving the UI blocked until their 32-second safety timeout.
              completeAssistantSettlement(
                { ok: false, error: unsettledError },
                undefined,
                true,
              );
              completeUserCommitSettlement({
                ok: false,
                error: unsettledError,
              });
            }
            const queued = queueRuntimeRecovery({
              conversationId: conversation.id,
              runtimeEpoch,
              error: closeError,
              retryLastResponse,
            });
            if (!queued) {
              showSessionError(closeError);
              void teardownSessionRuntime(false, true);
              setRuntimeRecoveryFailed(true);
              setSessionState("ended");
            }
          } else {
            if (event.code !== 1000) setErrorMessage(closeError);
            void teardownSessionRuntime(false);
          }
        },
      });
      realtimeRef.current = realtime;
  
      await realtime.connect({
        conversationId: conversation.id,
        maxHistoryTurns: MAX_REALTIME_HISTORY_TURNS,
      });
      if (!isCurrentRuntime() || realtimeRef.current !== realtime) {
        throw new Error("Session activation was superseded.");
      }
  
      conversationStartedRef.current = true;
      sessionEstablishedRef.current = true;
      setRuntimeRecoveryFailed(false);
      setSessionPaused(false);
      setSessionActive(true);
      setSessionState("ready");
    } catch (error) {
      if (isCurrentRuntime()) {
        await teardownSessionRuntime(true, preserveSessionViewOnFailure);
        await pauseConversationRequest(conversation.id).catch(() => undefined);
        if (preserveSessionViewOnFailure) {
          setRuntimeRecoveryFailed(true);
          setSessionState("ended");
        }
      } else {
        realtime?.disconnect();
        await audio.dispose().catch(() => undefined);
      }
      throw error;
    }
  }, [
    activeResponseIdRef,
    assistantResponsesRef,
    audioRef,
    cleanupPromiseRef,
    componentMountedRef,
    completeAssistantSettlement,
    completeUserCommitSettlement,
    conversationStartedRef,
    freeConversationAudioRef,
    freeConversationController,
    handleServerMessage,
    muted,
    pendingAssistantResponseIdRef,
    playbackActiveRef,
    queueRuntimeRecovery,
    realtimeRef,
    refreshConversationHistory,
    reportContextualError,
    runtimeEpochRef,
    sessionEstablishedRef,
    setErrorMessage,
    setInputLevel,
    setOutputLevel,
    setRuntimeRecoveryFailed,
    setSessionActive,
    setSessionPaused,
    setSessionState,
    showSessionError,
    stageConversationView,
    teardownSessionRuntime,
    tryFinalizeAssistant,
    userCommitPendingRef,
    volume,
  ]);
  
  const runPendingRuntimeRecovery = useCallback(async (): Promise<void> => {
    const request = pendingRuntimeRecoveryRef.current;
    if (!request || transitionInProgressRef.current) return;
  
    if (runtimeEpochRef.current !== request.runtimeEpoch) {
      pendingRuntimeRecoveryRef.current = undefined;
      runtimeRecoveryConsumedRef.current = false;
      clearSessionError();
      return;
    }
  
    pendingRuntimeRecoveryRef.current = undefined;
    transitionInProgressRef.current = true;
    setIsStarting(true);
    setSessionState("connecting");
    let recoveryEpoch: number | undefined;
    let activationStarted = false;
    try {
      // The failed upstream may contain a user audio item or assistant output
      // that was never authoritative. Rebuild from finalized SQLite text
      // instead of continuing with that uncertain Qwen context.
      await teardownSessionRuntime(true, true);
      recoveryEpoch = runtimeEpochRef.current;
      const conversation = await loadConversation(request.conversationId);
      const shouldRetryLastResponse =
        request.retryLastResponse === true &&
        conversation.messages.at(-1)?.role === "user";
      if (!componentMountedRef.current) return;
      if (runtimeEpochRef.current !== recoveryEpoch) {
        if (
          conversationStartedRef.current &&
          !sessionEstablishedRef.current
        ) {
          showSessionError(request.error);
          setRuntimeRecoveryFailed(true);
          setSessionState("ended");
        }
        return;
      }
      activationStarted = true;
      await activateConversation(conversation);
      if (shouldRetryLastResponse) {
        realtimeRef.current?.retryResponse();
      } else {
        const recoveredEpoch = runtimeEpochRef.current;
        runtimeRecoveryStabilityTimerRef.current = window.setTimeout(() => {
          if (
            runtimeEpochRef.current === recoveredEpoch &&
            sessionEstablishedRef.current
          ) {
            runtimeRecoveryConsumedRef.current = false;
          }
          runtimeRecoveryStabilityTimerRef.current = undefined;
        }, RUNTIME_RECOVERY_STABILITY_MS);
      }
    } catch (error) {
      if (
        !componentMountedRef.current ||
        (!activationStarted &&
          recoveryEpoch !== undefined &&
          runtimeEpochRef.current !== recoveryEpoch)
      ) {
        return;
      }
      // This conversation was already established before recovery began.
      // Preserve its durable view even when the replacement transport cannot
      // initialize; the composer offers an explicit manual retry below.
      showSessionError(readableError(error));
      setRuntimeRecoveryFailed(true);
      setSessionState("ended");
    } finally {
      transitionInProgressRef.current = false;
      if (componentMountedRef.current) setIsStarting(false);
      if (
        componentMountedRef.current &&
        pendingRuntimeRecoveryRef.current
      ) {
        runPendingRuntimeRecoveryRef.current();
      }
      synchronizeRequestedRouteRef.current();
    }
  }, [
    activateConversation,
    clearSessionError,
    componentMountedRef,
    conversationStartedRef,
    loadConversation,
    pendingRuntimeRecoveryRef,
    realtimeRef,
    runPendingRuntimeRecoveryRef,
    runtimeEpochRef,
    runtimeRecoveryConsumedRef,
    runtimeRecoveryStabilityTimerRef,
    sessionEstablishedRef,
    setIsStarting,
    setRuntimeRecoveryFailed,
    setSessionState,
    showSessionError,
    synchronizeRequestedRouteRef,
    teardownSessionRuntime,
    transitionInProgressRef,
  ]);
  useEffect(() => {
    runPendingRuntimeRecoveryRef.current = () => {
      void runPendingRuntimeRecovery();
    };
    return () => {
      runPendingRuntimeRecoveryRef.current = () => undefined;
    };
  }, [runPendingRuntimeRecovery, runPendingRuntimeRecoveryRef]);
  
  const retryRuntimeRecovery = useCallback(() => {
    if (!activeConversationId || transitionInProgressRef.current) return;
  
    runtimeRecoveryConsumedRef.current = false;
    const queued = queueRuntimeRecovery({
      conversationId: activeConversationId,
      runtimeEpoch: runtimeEpochRef.current,
      error: {
        en: "The voice connection is unavailable.",
        zh: "语音连接当前不可用。",
      },
      notify: false,
      retryLastResponse: true,
    });
    if (queued) clearSessionError();
  }, [
    activeConversationId,
    clearSessionError,
    queueRuntimeRecovery,
    runtimeEpochRef,
    runtimeRecoveryConsumedRef,
    transitionInProgressRef,
  ]);

  return {
    reportContextualError,
    teardownSessionRuntime,
    interruptActivePlaybackAndWait,
    settleSessionBeforeTransition,
    stageConversationView,
    showPausedConversation,
    activateConversation,
    retryRuntimeRecovery,
  };
}
