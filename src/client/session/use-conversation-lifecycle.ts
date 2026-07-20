import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { SessionState } from "../../shared/realtime-protocol";
import type {
  ConversationDetail,
  CreateConversationInput,
} from "../../shared/conversation-history";
import type {
  Difficulty,
  Persona,
  Scenario,
} from "../../shared/role-play-catalog";
import {
  endConversation,
  pauseConversation as pauseConversationRequest,
  restartConversation as restartConversationRequest,
  resumeConversation as resumeConversationRequest,
} from "../conversations/conversation-api";
import type {
  AppLocale,
  LocalizedText,
} from "../i18n";
import type { TranslationParameters } from "../i18n/locale";
import {
  HOME_ROUTE,
  type AppRoute,
  useAppRoute,
} from "../routing";
import type {
  SessionControlAction,
  TranscriptTurn,
} from "./session-types";
import { readableError, type UiError } from "../app/app-errors";

interface RuntimeRef<T> {
  current: T;
}

type StateSetter<T> = Dispatch<SetStateAction<T>>;
type Navigate = ReturnType<typeof useAppRoute>["navigate"];
type Translate = (
  text: LocalizedText,
  parameters?: TranslationParameters,
) => string;

export interface ConversationLifecycleOptions {
  selectedPersona: Persona | undefined;
  selectedScenario: Scenario | undefined;
  difficulty: Difficulty;
  locale: AppLocale;
  route: AppRoute;
  sessionUiPreview: boolean;
  sessionActive: boolean;
  sessionPaused: boolean;
  activeConversationId: number | null;
  createConversation: (
    input: CreateConversationInput,
  ) => Promise<ConversationDetail>;
  loadConversation: (conversationId: number) => Promise<ConversationDetail>;
  removeConversation: (conversationId: number) => Promise<void>;
  refreshConversationHistory: () => Promise<void>;
  activateConversation: (
    conversation: ConversationDetail,
  ) => Promise<void>;
  showPausedConversation: (conversation: ConversationDetail) => void;
  settleSessionBeforeTransition: () => Promise<void>;
  teardownSessionRuntime: (
    disconnectRealtime?: boolean,
    preserveSessionView?: boolean,
  ) => Promise<void>;
  cancelActiveGesture: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  reportContextualError: (error: UiError) => void;
  clearSessionError: () => void;
  t: Translate;
  navigate: Navigate;
  requestedRouteRef: RuntimeRef<AppRoute>;
  transitionInProgressRef: RuntimeRef<boolean>;
  runPendingRuntimeRecoveryRef: RuntimeRef<() => void>;
  synchronizeRequestedRouteRef: RuntimeRef<() => void>;
  activeConversationIdRef: RuntimeRef<number | null>;
  conversationStartedRef: RuntimeRef<boolean>;
  submissionCompletionRef: RuntimeRef<Promise<void>>;
  recordingRef: RuntimeRef<boolean>;
  setIsStarting: StateSetter<boolean>;
  setErrorMessage: StateSetter<UiError | null>;
  setTurns: StateSetter<TranscriptTurn[]>;
  setHistoryMobileOpen: StateSetter<boolean>;
  setSessionControlAction: StateSetter<SessionControlAction | null>;
  setSuccessSuggestionResponseId: StateSetter<string | null>;
  setSessionPaused: StateSetter<boolean>;
  setSessionState: StateSetter<SessionState>;
  setRuntimeRecoveryFailed: StateSetter<boolean>;
}

/**
 * Serializes every route and session lifecycle transition around the same
 * durable settlement barrier used by the realtime controller.
 */
export function useConversationLifecycle({
  selectedPersona,
  selectedScenario,
  difficulty,
  locale,
  route,
  sessionUiPreview,
  sessionActive,
  sessionPaused,
  activeConversationId,
  createConversation,
  loadConversation,
  removeConversation,
  refreshConversationHistory,
  activateConversation,
  showPausedConversation,
  settleSessionBeforeTransition,
  teardownSessionRuntime,
  cancelActiveGesture,
  cancelRecording,
  reportContextualError,
  clearSessionError,
  t,
  navigate,
  requestedRouteRef,
  transitionInProgressRef,
  runPendingRuntimeRecoveryRef,
  synchronizeRequestedRouteRef,
  activeConversationIdRef,
  conversationStartedRef,
  submissionCompletionRef,
  recordingRef,
  setIsStarting,
  setErrorMessage,
  setTurns,
  setHistoryMobileOpen,
  setSessionControlAction,
  setSuccessSuggestionResponseId,
  setSessionPaused,
  setSessionState,
  setRuntimeRecoveryFailed,
}: ConversationLifecycleOptions) {
  const startSession = async () => {
    if (!selectedPersona || !selectedScenario) {
      setErrorMessage({
        en: "Choose a scenario and one of its compatible roles first.",
        zh: "请先选择一个场景和与之兼容的角色。",
      });
      return;
    }
  
    if (transitionInProgressRef.current) return;
  
    transitionInProgressRef.current = true;
    setIsStarting(true);
    clearSessionError();
    try {
      const conversation = await createConversation({
        personaId: selectedPersona.id,
        scenarioId: selectedScenario.id,
        difficulty,
        locale,
      });
      await activateConversation(conversation);
      if (requestedRouteRef.current.page === "home") {
        navigate({ page: "chat", conversationId: conversation.id });
      }
    } catch (error) {
      reportContextualError(readableError(error));
    } finally {
      transitionInProgressRef.current = false;
      setIsStarting(false);
      runPendingRuntimeRecoveryRef.current();
      synchronizeRequestedRouteRef.current();
    }
  };
  
  const tryConversationAgain = async (
    source: ConversationDetail,
  ): Promise<void> => {
    if (transitionInProgressRef.current) {
      throw new Error(t({
        en: "Another conversation action is still in progress.",
        zh: "另一项会话操作仍在进行中。",
      }));
    }
  
    transitionInProgressRef.current = true;
    setIsStarting(true);
    setErrorMessage(null);
    clearSessionError();
    try {
      const conversation = await createConversation({
        personaId: source.persona.id,
        scenarioId: source.scenario.id,
        difficulty: source.difficulty,
        locale,
      });
      await activateConversation(conversation);
      navigate({ page: "chat", conversationId: conversation.id });
    } finally {
      transitionInProgressRef.current = false;
      setIsStarting(false);
      runPendingRuntimeRecoveryRef.current();
      synchronizeRequestedRouteRef.current();
    }
  };
  
  const deleteReviewedConversation = async (
    conversationId: number,
  ): Promise<void> => {
    if (transitionInProgressRef.current) {
      throw new Error(t({
        en: "Another conversation action is still in progress.",
        zh: "另一项会话操作仍在进行中。",
      }));
    }
  
    transitionInProgressRef.current = true;
    setIsStarting(true);
    try {
      await removeConversation(conversationId);
      setTurns([]);
      setErrorMessage(null);
      navigate(HOME_ROUTE, { replace: true });
    } finally {
      transitionInProgressRef.current = false;
      setIsStarting(false);
      synchronizeRequestedRouteRef.current();
    }
  };
  
  const resumeConversation = async (
    conversationId: number,
    synchronizeUrl = true,
  ) => {
    setHistoryMobileOpen(false);
    if (sessionActive && conversationId === activeConversationId) return;
    if (transitionInProgressRef.current) return;
  
    transitionInProgressRef.current = true;
    setIsStarting(true);
    setErrorMessage(null);
    clearSessionError();
    try {
      if (sessionActive) {
        await cancelActiveGesture();
        await submissionCompletionRef.current;
        if (recordingRef.current) await cancelRecording();
        await settleSessionBeforeTransition();
        await teardownSessionRuntime();
      }
      const conversation = await loadConversation(conversationId);
      if (conversation.status === "ended") {
        navigate(
          { page: "feedback", conversationId: conversation.id },
          synchronizeUrl ? undefined : { replace: true },
        );
        return;
      }
      if (conversation.pausedAt) {
        showPausedConversation(conversation);
      } else {
        await activateConversation(conversation);
      }
      if (synchronizeUrl) {
        navigate({ page: "chat", conversationId: conversation.id });
      }
    } catch (error) {
      reportContextualError(readableError(error));
      const currentConversationId = activeConversationIdRef.current;
      if (conversationStartedRef.current && currentConversationId !== null) {
        navigate(
          { page: "chat", conversationId: currentConversationId },
          { replace: true },
        );
      } else {
        navigate(HOME_ROUTE, { replace: true });
      }
    } finally {
      transitionInProgressRef.current = false;
      setIsStarting(false);
      runPendingRuntimeRecoveryRef.current();
      synchronizeRequestedRouteRef.current();
    }
  };
  
  const showNewConversation = async (synchronizeUrl = true) => {
    setHistoryMobileOpen(false);
    if (transitionInProgressRef.current) return;
    transitionInProgressRef.current = true;
    setIsStarting(true);
    clearSessionError();
    try {
      if (sessionActive) {
        await cancelActiveGesture();
        await submissionCompletionRef.current;
        if (recordingRef.current) await cancelRecording();
        await settleSessionBeforeTransition();
        await teardownSessionRuntime();
      }
      await refreshConversationHistory();
      setErrorMessage(null);
      setTurns([]);
      if (synchronizeUrl) navigate(HOME_ROUTE);
    } catch (error) {
      reportContextualError(readableError(error));
      const currentConversationId = activeConversationIdRef.current;
      if (conversationStartedRef.current && currentConversationId !== null) {
        navigate(
          { page: "chat", conversationId: currentConversationId },
          { replace: true },
        );
      }
    } finally {
      transitionInProgressRef.current = false;
      setIsStarting(false);
      runPendingRuntimeRecoveryRef.current();
      synchronizeRequestedRouteRef.current();
    }
  };
  
  
  const settleVoiceBeforeSessionControl = async (): Promise<void> => {
    await cancelActiveGesture();
    await submissionCompletionRef.current;
    if (recordingRef.current) await cancelRecording();
    await settleSessionBeforeTransition();
  };
  
  const pauseSession = async () => {
    if (
      sessionPaused ||
      transitionInProgressRef.current ||
      !activeConversationIdRef.current
    ) {
      return;
    }
    const conversationId = activeConversationIdRef.current;
    transitionInProgressRef.current = true;
    setSessionControlAction("pausing");
    setIsStarting(true);
    setSuccessSuggestionResponseId(null);
    let runtimeStopped = false;
    try {
      await settleVoiceBeforeSessionControl();
      await teardownSessionRuntime(true, true);
      runtimeStopped = true;
      setSessionPaused(true);
      setSessionState("paused");
      await pauseConversationRequest(conversationId);
      await refreshConversationHistory();
    } catch (error) {
      reportContextualError(readableError(error));
      if (runtimeStopped) {
        setSessionPaused(true);
        setSessionState("paused");
      }
    } finally {
      transitionInProgressRef.current = false;
      setSessionControlAction(null);
      setIsStarting(false);
      runPendingRuntimeRecoveryRef.current();
      synchronizeRequestedRouteRef.current();
    }
  };
  
  const continueSession = async () => {
    if (
      !sessionPaused ||
      transitionInProgressRef.current ||
      !activeConversationIdRef.current
    ) {
      return;
    }
    const conversationId = activeConversationIdRef.current;
    transitionInProgressRef.current = true;
    setSessionControlAction("resuming");
    setIsStarting(true);
    setSessionState("connecting");
    try {
      const conversation = await resumeConversationRequest(conversationId);
      await activateConversation(conversation);
      await refreshConversationHistory();
    } catch (error) {
      await pauseConversationRequest(conversationId).catch(() => undefined);
      setRuntimeRecoveryFailed(false);
      setSessionPaused(true);
      setSessionState("paused");
      reportContextualError(readableError(error));
    } finally {
      transitionInProgressRef.current = false;
      setSessionControlAction(null);
      setIsStarting(false);
      runPendingRuntimeRecoveryRef.current();
      synchronizeRequestedRouteRef.current();
    }
  };
  
  const restartSession = async () => {
    if (
      transitionInProgressRef.current ||
      !activeConversationIdRef.current
    ) {
      return;
    }
    const conversationId = activeConversationIdRef.current;
    transitionInProgressRef.current = true;
    setSessionControlAction("restarting");
    setIsStarting(true);
    setSuccessSuggestionResponseId(null);
    try {
      if (!sessionPaused) await settleVoiceBeforeSessionControl();
      await teardownSessionRuntime(true, true);
      setSessionPaused(true);
      setSessionState("paused");
      const restarted = await restartConversationRequest(conversationId);
      await activateConversation(restarted);
      await refreshConversationHistory();
    } catch (error) {
      await pauseConversationRequest(conversationId).catch(() => undefined);
      setRuntimeRecoveryFailed(false);
      setSessionPaused(true);
      setSessionState("paused");
      reportContextualError(readableError(error));
    } finally {
      transitionInProgressRef.current = false;
      setSessionControlAction(null);
      setIsStarting(false);
      runPendingRuntimeRecoveryRef.current();
      synchronizeRequestedRouteRef.current();
    }
  };
  
  const endSession = async () => {
    if (transitionInProgressRef.current) return;
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) return;
    transitionInProgressRef.current = true;
    setIsStarting(true);
    let durablyEnded = false;
    try {
      await settleVoiceBeforeSessionControl();
      await endConversation(conversationId);
      durablyEnded = true;
      await teardownSessionRuntime();
      await refreshConversationHistory();
      navigate({ page: "feedback", conversationId });
    } catch (error) {
      reportContextualError(readableError(error));
      if (durablyEnded) {
        await teardownSessionRuntime().catch(() => undefined);
        navigate({ page: "feedback", conversationId }, { replace: true });
      } else if (conversationStartedRef.current) {
        navigate(
          { page: "chat", conversationId },
          { replace: true },
        );
      }
    } finally {
      transitionInProgressRef.current = false;
      setIsStarting(false);
      runPendingRuntimeRecoveryRef.current();
      synchronizeRequestedRouteRef.current();
    }
  };
  
  useEffect(() => {
    synchronizeRequestedRouteRef.current = () => {
      if (sessionUiPreview || transitionInProgressRef.current) return;
  
      const requestedRoute = requestedRouteRef.current;
      if (requestedRoute.page === "not_found") {
        navigate(HOME_ROUTE, { replace: true });
        return;
      }
  
      if (requestedRoute.page === "chat") {
        if (
          activeConversationIdRef.current === requestedRoute.conversationId &&
          conversationStartedRef.current
        ) {
          return;
        }
        void resumeConversation(requestedRoute.conversationId, false);
        return;
      }
  
      if (requestedRoute.page === "feedback") {
        if (
          activeConversationIdRef.current !== null ||
          conversationStartedRef.current
        ) {
          void showNewConversation(false);
        }
        return;
      }
  
      if (
        activeConversationIdRef.current !== null ||
        conversationStartedRef.current
      ) {
        void showNewConversation(false);
      }
    };
  });
  
  useEffect(() => {
    synchronizeRequestedRouteRef.current();
  }, [route, synchronizeRequestedRouteRef]);
  
  return {
    startSession,
    tryConversationAgain,
    deleteReviewedConversation,
    resumeConversation,
    showNewConversation,
    pauseSession,
    continueSession,
    restartSession,
    endSession,
  };
}
