import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import type { SessionState } from "../../shared/realtime-protocol";
import { readableError, type UiError } from "../app/app-errors";
import type { BrowserAudioEngine } from "../audio/browser-audio-engine";
import type { RealtimeClient } from "../realtime/realtime-client";
import type {
  AssistantDraft,
  FreeConversationAudioRouting,
  LongRecordingAction,
  VoiceInputMode,
} from "../session/session-types";
import {
  FreeConversationController,
  type FreeConversationPhase,
} from "./free-conversation-controller";
import { usePressToTalk } from "./use-press-to-talk";

interface RuntimeRef<T> {
  current: T;
}

type StateSetter<T> = Dispatch<SetStateAction<T>>;
type SettlementResult =
  | { ok: true }
  | { ok: false; error: Error };

export interface VoiceInputControllerOptions {
  sessionActive: boolean;
  sessionPaused: boolean;
  isStarting: boolean;
  isSubmitting: boolean;
  isUserCommitPending: boolean;
  runtimeRecoveryFailed: boolean;
  isReconciling: boolean;
  voiceInputMode: VoiceInputMode;
  voiceModeTransitioning: boolean;
  longRecordingCancellationRequired: boolean;
  audioRef: RuntimeRef<BrowserAudioEngine | undefined>;
  realtimeRef: RuntimeRef<RealtimeClient | undefined>;
  runtimeEpochRef: RuntimeRef<number>;
  transitionInProgressRef: RuntimeRef<boolean>;
  userCommitPendingRef: RuntimeRef<boolean>;
  recordingRef: RuntimeRef<boolean>;
  submissionRef: RuntimeRef<boolean>;
  submissionCompletionRef: RuntimeRef<Promise<void>>;
  recordingStartedAtRef: RuntimeRef<number>;
  runtimeRecoveryConsumedRef: RuntimeRef<boolean>;
  runtimeRecoveryStabilityTimerRef: RuntimeRef<number | undefined>;
  activeResponseIdRef: RuntimeRef<string | undefined>;
  pendingAssistantResponseIdRef: RuntimeRef<string | undefined>;
  assistantSettlementWaiterRef: RuntimeRef<unknown | undefined>;
  acceptUserTranscriptRef: RuntimeRef<boolean>;
  componentMountedRef: RuntimeRef<boolean>;
  freeConversationAudioRef: RuntimeRef<FreeConversationAudioRouting>;
  freeConversationController: FreeConversationController;
  interruptActivePlaybackAndWait: () => Promise<unknown>;
  createUserCommitSettlement: () => Promise<unknown>;
  completeUserCommitSettlement: (
    result: SettlementResult,
    reportFailure?: boolean,
  ) => void;
  reportContextualError: (error: UiError) => void;
  setErrorMessage: StateSetter<UiError | null>;
  setUserDraft: StateSetter<string>;
  setAssistantDraft: StateSetter<AssistantDraft | null>;
  setIsRecording: StateSetter<boolean>;
  setIsSubmitting: StateSetter<boolean>;
  setRecordingDuration: StateSetter<number>;
  setInputLevel: StateSetter<number>;
  setSessionState: StateSetter<SessionState>;
  setIsReconciling: StateSetter<boolean>;
  setVoiceInputMode: StateSetter<VoiceInputMode>;
  setVoiceModeMenuOpen: StateSetter<boolean>;
  setVoiceModeTransitioning: StateSetter<boolean>;
  setLongRecordingAction: StateSetter<LongRecordingAction | null>;
  setLongRecordingCancellationRequired: StateSetter<boolean>;
  setFreeConversationPhase: StateSetter<FreeConversationPhase>;
}

/**
 * Coordinates every learner voice-input mode against the current audio and
 * realtime runtime. Runtime refs keep async continuations scoped to the epoch
 * that created them, preserving the existing cancellation and commit ordering.
 */
export function useVoiceInputController({
  sessionActive,
  sessionPaused,
  isStarting,
  isSubmitting,
  isUserCommitPending,
  runtimeRecoveryFailed,
  isReconciling,
  voiceInputMode,
  voiceModeTransitioning,
  longRecordingCancellationRequired,
  audioRef,
  realtimeRef,
  runtimeEpochRef,
  transitionInProgressRef,
  userCommitPendingRef,
  recordingRef,
  submissionRef,
  submissionCompletionRef,
  recordingStartedAtRef,
  runtimeRecoveryConsumedRef,
  runtimeRecoveryStabilityTimerRef,
  activeResponseIdRef,
  pendingAssistantResponseIdRef,
  assistantSettlementWaiterRef,
  acceptUserTranscriptRef,
  componentMountedRef,
  freeConversationAudioRef,
  freeConversationController,
  interruptActivePlaybackAndWait,
  createUserCommitSettlement,
  completeUserCommitSettlement,
  reportContextualError,
  setErrorMessage,
  setUserDraft,
  setAssistantDraft,
  setIsRecording,
  setIsSubmitting,
  setRecordingDuration,
  setInputLevel,
  setSessionState,
  setIsReconciling,
  setVoiceInputMode,
  setVoiceModeMenuOpen,
  setVoiceModeTransitioning,
  setLongRecordingAction,
  setLongRecordingCancellationRequired,
  setFreeConversationPhase,
}: VoiceInputControllerOptions) {
  const beginRecording = useCallback(async (): Promise<boolean> => {
    const runtimeEpoch = runtimeEpochRef.current;
    const audio = audioRef.current;
    const realtime = realtimeRef.current;
    const isCurrentRuntime = () =>
      runtimeEpochRef.current === runtimeEpoch &&
      audioRef.current === audio &&
      realtimeRef.current === realtime;
    if (
      !sessionActive ||
      transitionInProgressRef.current ||
      userCommitPendingRef.current ||
      recordingRef.current ||
      submissionRef.current ||
      !audio ||
      !realtime
    ) {
      return false;
    }
    runtimeRecoveryConsumedRef.current = false;
    if (runtimeRecoveryStabilityTimerRef.current !== undefined) {
      window.clearTimeout(runtimeRecoveryStabilityTimerRef.current);
      runtimeRecoveryStabilityTimerRef.current = undefined;
    }
    setErrorMessage(null);
  
    const activeResponseId = activeResponseIdRef.current;
    if (activeResponseId) {
      void interruptActivePlaybackAndWait();
    }
  
    let inputStarted = false;
    try {
      acceptUserTranscriptRef.current = true;
      realtime.startInput();
      inputStarted = true;
      await audio.startCapture();
      if (!isCurrentRuntime()) {
        await audio.cancelCapture().catch(() => undefined);
        try {
          void realtime.clearInput().catch(() => undefined);
        } catch {
          // A superseded realtime connection is usually already closed.
        }
        return false;
      }
      recordingRef.current = true;
      recordingStartedAtRef.current = performance.now();
      setRecordingDuration(0);
      setIsRecording(true);
      setSessionState("listening");
      return true;
    } catch (error) {
      if (inputStarted) {
        try {
          await realtime.clearInput();
        } catch {
          // The realtime connection may close while microphone setup fails.
        }
      }
      if (isCurrentRuntime()) {
        acceptUserTranscriptRef.current = false;
        setUserDraft("");
        reportContextualError(readableError(error));
      }
      return false;
    }
  }, [
    acceptUserTranscriptRef,
    activeResponseIdRef,
    audioRef,
    interruptActivePlaybackAndWait,
    realtimeRef,
    recordingRef,
    recordingStartedAtRef,
    reportContextualError,
    runtimeEpochRef,
    runtimeRecoveryConsumedRef,
    runtimeRecoveryStabilityTimerRef,
    sessionActive,
    setErrorMessage,
    setIsRecording,
    setRecordingDuration,
    setSessionState,
    setUserDraft,
    submissionRef,
    transitionInProgressRef,
    userCommitPendingRef,
  ]);
  
  const submitRecording = useCallback(async (): Promise<void> => {
    const runtimeEpoch = runtimeEpochRef.current;
    const audio = audioRef.current;
    const realtime = realtimeRef.current;
    const isCurrentRuntime = () =>
      runtimeEpochRef.current === runtimeEpoch &&
      audioRef.current === audio &&
      realtimeRef.current === realtime;
    if (
      !recordingRef.current ||
      submissionRef.current ||
      !audio ||
      !realtime
    ) {
      return;
    }
    submissionRef.current = true;
    setIsSubmitting(true);
    let completeSubmission: () => void = () => undefined;
    submissionCompletionRef.current = new Promise<void>((resolve) => {
      completeSubmission = resolve;
    });
  
    try {
      await audio.finishCapture();
      if (!isCurrentRuntime()) {
        try {
          void realtime.clearInput().catch(() => undefined);
        } catch {
          // A superseded realtime connection is usually already closed.
        }
        return;
      }
      recordingRef.current = false;
      setIsRecording(false);
      setRecordingDuration(0);
      setInputLevel(0);
      void createUserCommitSettlement();
      try {
        realtime.commitInput();
      } catch (error) {
        acceptUserTranscriptRef.current = false;
        setUserDraft("");
        completeUserCommitSettlement(
          {
            ok: false,
            error:
              error instanceof Error
                ? error
                : new Error("Realtime WebSocket is not open."),
          },
          true,
        );
        throw error;
      }
      setSessionState("processing");
    } catch (error) {
      try {
        await realtime.clearInput();
      } catch {
        // Cleanup is best effort if the realtime connection already failed.
      }
      if (isCurrentRuntime()) {
        acceptUserTranscriptRef.current = false;
        setUserDraft("");
        recordingRef.current = false;
        setIsRecording(false);
        setInputLevel(0);
        reportContextualError(readableError(error));
      }
    } finally {
      if (isCurrentRuntime()) {
        submissionRef.current = false;
        setIsSubmitting(false);
      }
      completeSubmission();
    }
  }, [
    acceptUserTranscriptRef,
    audioRef,
    completeUserCommitSettlement,
    createUserCommitSettlement,
    realtimeRef,
    recordingRef,
    reportContextualError,
    runtimeEpochRef,
    setInputLevel,
    setIsRecording,
    setIsSubmitting,
    setRecordingDuration,
    setSessionState,
    setUserDraft,
    submissionCompletionRef,
    submissionRef,
  ]);
  
  const cancelRecording = useCallback(async (): Promise<void> => {
    const runtimeEpoch = runtimeEpochRef.current;
    const audio = audioRef.current;
    const realtime = realtimeRef.current;
    const isCurrentRuntime = () =>
      runtimeEpochRef.current === runtimeEpoch &&
      audioRef.current === audio &&
      realtimeRef.current === realtime;
    if (
      !recordingRef.current ||
      submissionRef.current ||
      !audio ||
      !realtime
    ) {
      return;
    }
    submissionRef.current = true;
    setIsSubmitting(true);
    acceptUserTranscriptRef.current = false;
    setUserDraft("");
  
    try {
      let captureCancellationError: unknown;
      try {
        await audio.cancelCapture();
      } catch (error) {
        // Clearing the upstream buffer is still mandatory even when the local
        // Worklet fails to acknowledge its stop request. Never leave recorded
        // bytes eligible for a later commit merely because local cleanup erred.
        captureCancellationError = error;
      }
      if (!isCurrentRuntime()) {
        try {
          void realtime.clearInput().catch(() => undefined);
        } catch {
          // A superseded realtime connection is usually already closed.
        }
        return;
      }
      await realtime.clearInput();
      recordingRef.current = false;
      setIsRecording(false);
      setRecordingDuration(0);
      setInputLevel(0);
      setSessionState(isReconciling ? "processing" : "ready");
      if (captureCancellationError !== undefined) {
        reportContextualError(readableError(captureCancellationError));
      }
    } catch (error) {
      if (isCurrentRuntime()) reportContextualError(readableError(error));
    } finally {
      if (isCurrentRuntime()) {
        submissionRef.current = false;
        setIsSubmitting(false);
      }
    }
  }, [
    acceptUserTranscriptRef,
    audioRef,
    isReconciling,
    realtimeRef,
    recordingRef,
    reportContextualError,
    runtimeEpochRef,
    setInputLevel,
    setIsRecording,
    setIsSubmitting,
    setRecordingDuration,
    setSessionState,
    setUserDraft,
    submissionRef,
  ]);
  
  const beginFreeConversationTurn = useCallback(async (): Promise<boolean> => {
    const runtimeEpoch = runtimeEpochRef.current;
    const realtime = realtimeRef.current;
    const freeConversation = freeConversationAudioRef.current;
    const isCurrentRuntime = () =>
      runtimeEpochRef.current === runtimeEpoch &&
      realtimeRef.current === realtime &&
      freeConversationAudioRef.current === freeConversation &&
      freeConversation.enabled;
    if (
      !sessionActive ||
      transitionInProgressRef.current ||
      userCommitPendingRef.current ||
      recordingRef.current ||
      submissionRef.current ||
      !realtime ||
      !freeConversation.enabled
    ) {
      return false;
    }
  
    setErrorMessage(null);
    const activeResponseId = activeResponseIdRef.current;
    if (activeResponseId) void interruptActivePlaybackAndWait();
  
    let inputStarted = false;
    try {
      acceptUserTranscriptRef.current = true;
      realtime.startInput();
      inputStarted = true;
      freeConversation.turnOpen = true;
      const preRoll = freeConversation.preRoll.splice(0);
      for (const buffer of preRoll) realtime.sendAudio(buffer);
      if (!isCurrentRuntime()) return false;
  
      recordingRef.current = true;
      recordingStartedAtRef.current = performance.now();
      setRecordingDuration(0);
      setIsRecording(true);
      setSessionState("listening");
      return true;
    } catch (error) {
      freeConversation.turnOpen = false;
      freeConversation.preRoll = [];
      if (inputStarted) {
        await realtime.clearInput().catch(() => undefined);
      }
      if (isCurrentRuntime()) {
        acceptUserTranscriptRef.current = false;
        recordingRef.current = false;
        setIsRecording(false);
        setUserDraft("");
        reportContextualError(readableError(error));
      }
      return false;
    }
  }, [
    acceptUserTranscriptRef,
    activeResponseIdRef,
    freeConversationAudioRef,
    interruptActivePlaybackAndWait,
    realtimeRef,
    recordingRef,
    recordingStartedAtRef,
    reportContextualError,
    runtimeEpochRef,
    sessionActive,
    setErrorMessage,
    setIsRecording,
    setRecordingDuration,
    setSessionState,
    setUserDraft,
    submissionRef,
    transitionInProgressRef,
    userCommitPendingRef,
  ]);
  
  const submitFreeConversationTurn = useCallback(async (): Promise<void> => {
    const runtimeEpoch = runtimeEpochRef.current;
    const realtime = realtimeRef.current;
    const freeConversation = freeConversationAudioRef.current;
    const isCurrentRuntime = () =>
      runtimeEpochRef.current === runtimeEpoch &&
      realtimeRef.current === realtime &&
      freeConversationAudioRef.current === freeConversation;
    if (
      !freeConversation.turnOpen ||
      !recordingRef.current ||
      submissionRef.current ||
      !realtime
    ) {
      return;
    }
  
    submissionRef.current = true;
    freeConversation.turnOpen = false;
    setIsSubmitting(true);
    let completeSubmission: () => void = () => undefined;
    submissionCompletionRef.current = new Promise<void>((resolve) => {
      completeSubmission = resolve;
    });
  
    try {
      if (!isCurrentRuntime()) return;
      recordingRef.current = false;
      setIsRecording(false);
      setRecordingDuration(0);
      void createUserCommitSettlement();
      freeConversationController.setBlocked(true);
      try {
        realtime.commitInput();
      } catch (error) {
        acceptUserTranscriptRef.current = false;
        setUserDraft("");
        completeUserCommitSettlement(
          {
            ok: false,
            error:
              error instanceof Error
                ? error
                : new Error("Realtime WebSocket is not open."),
          },
          true,
        );
        throw error;
      }
      setSessionState("processing");
    } catch (error) {
      await realtime.clearInput().catch(() => undefined);
      if (isCurrentRuntime()) {
        acceptUserTranscriptRef.current = false;
        setUserDraft("");
        recordingRef.current = false;
        setIsRecording(false);
        reportContextualError(readableError(error));
      }
    } finally {
      if (isCurrentRuntime()) {
        submissionRef.current = false;
        setIsSubmitting(false);
      }
      completeSubmission();
    }
  }, [
    acceptUserTranscriptRef,
    completeUserCommitSettlement,
    createUserCommitSettlement,
    freeConversationAudioRef,
    freeConversationController,
    realtimeRef,
    recordingRef,
    reportContextualError,
    runtimeEpochRef,
    setIsRecording,
    setIsSubmitting,
    setRecordingDuration,
    setSessionState,
    setUserDraft,
    submissionCompletionRef,
    submissionRef,
  ]);
  
  useEffect(() => {
    freeConversationController.updateHandlers({
      startTurn: beginFreeConversationTurn,
      submitTurn: submitFreeConversationTurn,
      onPhaseChange: setFreeConversationPhase,
    });
  }, [
    beginFreeConversationTurn,
    freeConversationController,
    setFreeConversationPhase,
    submitFreeConversationTurn,
  ]);
  
  const stopResponse = useCallback(() => {
    const responseId = activeResponseIdRef.current;
    if (
      responseId ||
      pendingAssistantResponseIdRef.current ||
      assistantSettlementWaiterRef.current
    ) {
      void interruptActivePlaybackAndWait();
    } else {
      audioRef.current?.clearPlayback();
      realtimeRef.current?.cancelResponse();
      setIsReconciling(true);
    }
    setAssistantDraft(null);
    setSessionState("processing");
  }, [
    activeResponseIdRef,
    assistantSettlementWaiterRef,
    audioRef,
    interruptActivePlaybackAndWait,
    pendingAssistantResponseIdRef,
    realtimeRef,
    setAssistantDraft,
    setIsReconciling,
    setSessionState,
  ]);
  
  const pressToTalk = usePressToTalk({
    enabled:
      voiceInputMode === "push-to-talk" &&
      sessionActive &&
      !sessionPaused &&
      !isSubmitting &&
      !isStarting &&
      !isUserCommitPending &&
      !runtimeRecoveryFailed,
    start: beginRecording,
    submit: submitRecording,
    cancel: cancelRecording,
  });
  
  const startLongRecording = useCallback(async () => {
    if (voiceModeTransitioning) return;
    setVoiceModeMenuOpen(false);
    setVoiceModeTransitioning(true);
    setLongRecordingAction("starting");
    setLongRecordingCancellationRequired(false);
    try {
      await pressToTalk.cancelActiveGesture();
      setVoiceInputMode("long-recording");
      const started = await beginRecording();
      if (!started) setVoiceInputMode("push-to-talk");
    } finally {
      if (componentMountedRef.current) {
        setLongRecordingAction(null);
        setVoiceModeTransitioning(false);
      }
    }
  }, [
    beginRecording,
    componentMountedRef,
    pressToTalk,
    setLongRecordingAction,
    setLongRecordingCancellationRequired,
    setVoiceInputMode,
    setVoiceModeMenuOpen,
    setVoiceModeTransitioning,
    voiceModeTransitioning,
  ]);
  
  const finishLongRecording = useCallback(async () => {
    if (voiceModeTransitioning || longRecordingCancellationRequired) return;
    setVoiceModeTransitioning(true);
    setLongRecordingAction("submitting");
    try {
      await submitRecording();
      setVoiceInputMode("push-to-talk");
    } finally {
      if (componentMountedRef.current) {
        setLongRecordingAction(null);
        setVoiceModeTransitioning(false);
      }
    }
  }, [
    longRecordingCancellationRequired,
    componentMountedRef,
    setLongRecordingAction,
    setVoiceInputMode,
    setVoiceModeTransitioning,
    submitRecording,
    voiceModeTransitioning,
  ]);
  
  const cancelLongRecording = useCallback(async () => {
    if (voiceModeTransitioning) return;
    setVoiceModeTransitioning(true);
    setLongRecordingAction("cancelling");
    setLongRecordingCancellationRequired(true);
    // Cancellation intent should be visible immediately. The authoritative
    // recording ref remains set until Qwen confirms that its buffer is clear.
    setIsRecording(false);
    setRecordingDuration(0);
    setInputLevel(0);
    try {
      await cancelRecording();
      // Keep the long-recording controls available when the upstream clear
      // acknowledgement fails, so the learner can retry instead of leaving an
      // uncertain input buffer behind a normal push-to-talk surface.
      if (!recordingRef.current) {
        setLongRecordingCancellationRequired(false);
        setVoiceInputMode("push-to-talk");
      }
    } finally {
      if (componentMountedRef.current) {
        setLongRecordingAction(null);
        setVoiceModeTransitioning(false);
      }
    }
  }, [
    cancelRecording,
    componentMountedRef,
    recordingRef,
    setInputLevel,
    setIsRecording,
    setLongRecordingAction,
    setLongRecordingCancellationRequired,
    setRecordingDuration,
    setVoiceInputMode,
    setVoiceModeTransitioning,
    voiceModeTransitioning,
  ]);
  
  const enterFreeConversation = useCallback(async () => {
    if (voiceModeTransitioning) return;
    const audio = audioRef.current;
    if (!audio) return;
    setVoiceModeMenuOpen(false);
    setVoiceModeTransitioning(true);
    try {
      await pressToTalk.cancelActiveGesture();
      if (recordingRef.current) await cancelRecording();
      const freeConversation = freeConversationAudioRef.current;
      freeConversation.enabled = true;
      freeConversation.turnOpen = false;
      freeConversation.preRoll = [];
      freeConversationController.enable();
      // The controller was blocked while push-to-talk owned the composer.
      // A repeat entry can restart capture before React's mode-change effect
      // runs, so unblock synchronously to avoid losing an immediate first word.
      freeConversationController.setBlocked(false);
      setVoiceInputMode("free-conversation");
      await audio.startCapture();
    } catch (error) {
      freeConversationAudioRef.current = {
        enabled: false,
        turnOpen: false,
        preRoll: [],
      };
      freeConversationController.disable();
      setVoiceInputMode("push-to-talk");
      reportContextualError(readableError(error));
    } finally {
      if (componentMountedRef.current) setVoiceModeTransitioning(false);
    }
  }, [
    audioRef,
    cancelRecording,
    componentMountedRef,
    freeConversationAudioRef,
    freeConversationController,
    pressToTalk,
    recordingRef,
    reportContextualError,
    setVoiceInputMode,
    setVoiceModeMenuOpen,
    setVoiceModeTransitioning,
    voiceModeTransitioning,
  ]);
  
  const exitFreeConversation = useCallback(async () => {
    if (voiceModeTransitioning) return;
    const audio = audioRef.current;
    const freeConversation = freeConversationAudioRef.current;
    setVoiceModeTransitioning(true);
    freeConversationController.disable();
    freeConversation.enabled = false;
    try {
      await freeConversationController.waitForLifecycle();
      if (freeConversation.turnOpen && recordingRef.current && audio) {
        // Flush the worklet's final partial frame before committing the words
        // spoken immediately before the learner exits hands-free mode.
        await audio.finishCapture();
        await submitFreeConversationTurn();
      } else {
        await submissionCompletionRef.current;
        await audio?.cancelCapture();
      }
      freeConversation.preRoll = [];
      setInputLevel(0);
      setVoiceInputMode("push-to-talk");
    } catch (error) {
      reportContextualError(readableError(error));
    } finally {
      if (componentMountedRef.current) setVoiceModeTransitioning(false);
    }
  }, [
    audioRef,
    componentMountedRef,
    freeConversationAudioRef,
    freeConversationController,
    recordingRef,
    reportContextualError,
    setInputLevel,
    setVoiceInputMode,
    setVoiceModeTransitioning,
    submitFreeConversationTurn,
    submissionCompletionRef,
    voiceModeTransitioning,
  ]);
  
  return {
    pressToTalk,
    stopResponse,
    cancelRecording,
    startLongRecording,
    finishLongRecording,
    cancelLongRecording,
    enterFreeConversation,
    exitFreeConversation,
  };
}
