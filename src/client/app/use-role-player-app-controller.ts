import { message as antMessage } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type SessionState,
} from "../../shared/realtime-protocol";
import type {
  Difficulty,
  RolePlayCatalog,
} from "../../shared/role-play-catalog";
import type {
  ConversationDownloadFormat,
} from "../../shared/conversation-history";
import type { AppRouteContentProps } from "./AppRouteContent";
import { readableError, type UiError } from "./app-errors";
import {
  getInitialColorMode,
  THEME_STORAGE_KEY,
  type ColorMode,
} from "./theme-preference";
import { UI_PREVIEW_FIXTURE } from "./ui-preview";
import { BrowserAudioEngine } from "../audio/browser-audio-engine";
import {
  localizePersona,
  localizeScenario,
} from "../catalog/catalog-localization";
import {
  reconcileCatalogSelection,
  resolvePersona,
  resolveScenario,
} from "../catalog/catalog-selection";
import { useRolePlayCatalog } from "../catalog/use-role-play-catalog";
import {
  downloadConversation,
  useConversationHistory,
} from "../conversations";
import { useI18n } from "../i18n";
import {
  RealtimeClient,
} from "../realtime/realtime-client";
import {
  ADMIN_ROUTE,
  HOME_ROUTE,
  useAppRoute,
} from "../routing";
import { useVoiceInputController } from "../voice/use-voice-input-controller";
import {
  FreeConversationController,
  type FreeConversationPhase,
} from "../voice/free-conversation-controller";
import type {
  ActiveSessionConfig,
  AssistantDraft,
  FreeConversationAudioRouting,
  LongRecordingAction,
  SessionControlAction,
  TranscriptTurn,
  VoiceInputMode,
} from "../session/session-types";
import { useConversationLifecycle } from "../session/use-conversation-lifecycle";
import {
  useRealtimeSettlement,
} from "../realtime/use-realtime-settlement";
import {
  useRealtimeSessionRuntime,
  type AssistantRuntime,
  type RuntimeRecoveryRequest,
} from "../realtime/use-realtime-session-runtime";

const SESSION_ERROR_MESSAGE_KEY = "session-error";

export function useRolePlayerAppController() {
  const { locale, antdLocale, t } = useI18n();
  const { route, routeRef: requestedRouteRef, navigate } = useAppRoute();
  const [messageApi, messageContextHolder] = antMessage.useMessage();
  const uiPreviewMode = UI_PREVIEW_FIXTURE?.mode ?? null;
  const sessionUiPreview = uiPreviewMode !== null;
  const recordingUiPreview =
    uiPreviewMode === "recording" || uiPreviewMode === "long";
  const longRecordingUiPreview = uiPreviewMode === "long";
  const freeConversationUiPreview = uiPreviewMode === "free";
  const [catalogSelection, setCatalogSelection] = useState({
    scenarioId: null as number | null,
    personaId: null as number | null,
  });
  const reconcileSelection = useCallback(
    (catalog: RolePlayCatalog) => {
      setCatalogSelection((current) =>
        reconcileCatalogSelection(catalog, current),
      );
    },
    [],
  );
  const rolePlayCatalog = useRolePlayCatalog(reconcileSelection);
  const conversationHistory = useConversationHistory();
  const loadConversation = conversationHistory.load;
  const refreshConversationHistorySilently =
    conversationHistory.refreshSilently;
  const [colorMode, setColorMode] = useState<ColorMode>(getInitialColorMode);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [activeSessionConfig, setActiveSessionConfig] =
    useState<ActiveSessionConfig | null>(null);
  const [qwenConfigured, setQwenConfigured] = useState<boolean | null>(null);
  const [healthError, setHealthError] = useState<UiError | null>(null);
  const [sessionActive, setSessionActive] = useState(sessionUiPreview);
  const [sessionPaused, setSessionPaused] = useState(
    uiPreviewMode === "paused",
  );
  const [sessionControlAction, setSessionControlAction] =
    useState<SessionControlAction | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>(
    uiPreviewMode === "paused"
      ? "paused"
      : recordingUiPreview
        ? "listening"
        : sessionUiPreview
          ? "speaking"
          : "ended",
  );
  const [isStarting, setIsStarting] = useState(
    route.page === "chat" && !sessionUiPreview,
  );
  const [isRecording, setIsRecording] = useState(recordingUiPreview);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [inputLevel, setInputLevel] = useState(recordingUiPreview ? 0.68 : 0);
  const [outputLevel, setOutputLevel] = useState(
    freeConversationUiPreview ? 0.42 : 0,
  );
  const [voiceInputMode, setVoiceInputMode] =
    useState<VoiceInputMode>(
      freeConversationUiPreview
        ? "free-conversation"
        : longRecordingUiPreview
          ? "long-recording"
          : "push-to-talk",
    );
  const [voiceModeMenuOpen, setVoiceModeMenuOpen] = useState(false);
  const [voiceModeTransitioning, setVoiceModeTransitioning] = useState(false);
  const [longRecordingAction, setLongRecordingAction] =
    useState<LongRecordingAction | null>(null);
  const [
    longRecordingCancellationRequired,
    setLongRecordingCancellationRequired,
  ] = useState(false);
  const [freeConversationPhase, setFreeConversationPhase] =
    useState<FreeConversationPhase>(
      freeConversationUiPreview ? "listening" : "inactive",
    );
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<UiError | null>(null);
  const [runtimeRecoveryFailed, setRuntimeRecoveryFailed] = useState(false);
  const [turns, setTurns] = useState<TranscriptTurn[]>(
    UI_PREVIEW_FIXTURE?.turns ?? [],
  );
  const [userDraft, setUserDraft] = useState("");
  const [assistantDraft, setAssistantDraft] = useState<AssistantDraft | null>(
    UI_PREVIEW_FIXTURE?.assistantDraft ?? null,
  );
  const [isReconciling, setIsReconciling] = useState(false);
  const [isUserCommitPending, setIsUserCommitPending] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<
    number | null
  >(null);
  const [historyMobileOpen, setHistoryMobileOpen] = useState(false);
  const [downloadInProgress, setDownloadInProgress] = useState(false);
  const [successSuggestionResponseId, setSuccessSuggestionResponseId] =
    useState<string | null>(null);

  const realtimeRef = useRef<RealtimeClient | undefined>(undefined);
  const audioRef = useRef<BrowserAudioEngine | undefined>(undefined);
  const recordingStartedAtRef = useRef(0);
  const recordingRef = useRef(false);
  const submissionRef = useRef(false);
  const submissionCompletionRef = useRef<Promise<void>>(Promise.resolve());
  const playbackActiveRef = useRef(false);
  const activeResponseIdRef = useRef<string | undefined>(undefined);
  const assistantResponsesRef = useRef(new Map<string, AssistantRuntime>());
  const acceptUserTranscriptRef = useRef(false);
  const transitionInProgressRef = useRef(false);
  const runtimeEpochRef = useRef(0);
  const componentMountedRef = useRef(true);
  const conversationStartedRef = useRef(sessionUiPreview);
  const sessionEstablishedRef = useRef(sessionUiPreview);
  const pendingRuntimeRecoveryRef = useRef<
    RuntimeRecoveryRequest | undefined
  >(undefined);
  const activeConversationIdRef = useRef<number | null>(null);
  const synchronizeRequestedRouteRef = useRef<() => void>(() => undefined);
  const runtimeRecoveryConsumedRef = useRef(false);
  const runtimeRecoveryStabilityTimerRef = useRef<number | undefined>(
    undefined,
  );
  const runPendingRuntimeRecoveryRef = useRef<() => void>(() => undefined);
  const cleanupPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const conversationViewportRef = useRef<HTMLDivElement | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);
  const freeConversationAudioRef = useRef<FreeConversationAudioRouting>({
    enabled: false,
    turnOpen: false,
    preRoll: [],
  });
  const [freeConversationController] = useState(
    () => new FreeConversationController(),
  );
  const {
    assistantSettlementWaiterRef,
    pendingAssistantResponseIdRef,
    userCommitPendingRef,
    completeAssistantSettlement,
    waitForAssistantSettlement,
    createUserCommitSettlement,
    completeUserCommitSettlement,
    waitForUserCommitSettlement,
  } = useRealtimeSettlement(setIsUserCommitPending);

  const isDark = colorMode === "dark";
  const selectedScenario = resolveScenario(
    rolePlayCatalog.catalog,
    catalogSelection.scenarioId ?? undefined,
  );
  const selectedPersona = resolvePersona(
    rolePlayCatalog.catalog,
    selectedScenario,
    catalogSelection.personaId ?? undefined,
  );
  const activeLocalizedPersona = activeSessionConfig
    ? localizePersona(activeSessionConfig.persona, locale)
    : null;
  const activeLocalizedScenario = activeSessionConfig
    ? localizeScenario(activeSessionConfig.scenario, locale)
    : null;
  const selectedLocalizedPersona = selectedPersona
    ? localizePersona(selectedPersona, locale)
    : null;
  const personaName =
    activeLocalizedPersona?.name ??
    selectedLocalizedPersona?.name ??
    t({ en: "Alex", zh: "亚历克斯" });
  const personaOccupation =
    activeLocalizedPersona?.occupation ??
    selectedLocalizedPersona?.occupation ??
    "";
  const resolveUiError = useCallback(
    (error: UiError | null | undefined): string | null => {
      if (!error) return null;
      return typeof error === "string" ? error : t(error);
    },
    [t],
  );
  const showSessionError = useCallback(
    (error: UiError) => {
      void messageApi.open({
        key: SESSION_ERROR_MESSAGE_KEY,
        type: "error",
        content: typeof error === "string" ? error : t(error),
        duration: 5,
      });
    },
    [messageApi, t],
  );
  const clearSessionError = useCallback(() => {
    messageApi.destroy(SESSION_ERROR_MESSAGE_KEY);
  }, [messageApi]);
  const downloadActiveConversation = useCallback(
    async (format: ConversationDownloadFormat): Promise<void> => {
      const conversationId = activeConversationIdRef.current;
      if (!conversationId || downloadInProgress) return;
      setDownloadInProgress(true);
      try {
        await downloadConversation(conversationId, format);
      } catch (error) {
        const detail = readableError(error);
        showSessionError(
          locale === "zh"
            ? `下载会话失败：${detail}`
            : `Conversation download failed: ${detail}`,
        );
      } finally {
        if (componentMountedRef.current) setDownloadInProgress(false);
      }
    },
    [downloadInProgress, locale, showSessionError],
  );
  useEffect(() => {
    document.documentElement.dataset.theme = colorMode;
    document.documentElement.style.colorScheme = colorMode;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, colorMode);
    } catch {
      // Theme still works for the current page when persistence is unavailable.
    }
  }, [colorMode]);

  useEffect(() => {
    if (sessionUiPreview) return;
    const controller = new AbortController();
    void fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Health check failed with HTTP ${response.status}.`);
        }
        const health = (await response.json()) as unknown;
        if (
          typeof health !== "object" ||
          health === null ||
          !("qwenConfigured" in health) ||
          typeof health.qwenConfigured !== "boolean"
        ) {
          throw new Error("Health check returned an invalid response.");
        }
        return health.qwenConfigured;
      })
      .then((configured) => {
        setQwenConfigured(configured);
        setHealthError(null);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setQwenConfigured(false);
          setHealthError({
            en: "The voice service status could not be confirmed. Check the local service and try again.",
            zh: "无法确认语音服务状态，请检查本地服务后重试。",
          });
        }
      });
    return () => controller.abort();
  }, [sessionUiPreview]);

  useEffect(() => {
    if (!isRecording) return;
    if (recordingStartedAtRef.current === 0) {
      recordingStartedAtRef.current = performance.now();
    }
    const update = () => {
      setRecordingDuration(performance.now() - recordingStartedAtRef.current);
    };
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    audioRef.current?.setVolume(muted ? 0 : volume);
  }, [muted, volume]);

  useEffect(() => {
    freeConversationController.setBlocked(
      voiceInputMode !== "free-conversation" ||
        sessionPaused ||
        isSubmitting ||
        isStarting ||
        isUserCommitPending ||
        runtimeRecoveryFailed,
    );
  }, [
    freeConversationController,
    isStarting,
    isSubmitting,
    isUserCommitPending,
    runtimeRecoveryFailed,
    sessionPaused,
    voiceInputMode,
  ]);

  useEffect(() => {
    if (!sessionActive || !followLatestRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      conversationEndRef.current?.scrollIntoView({ block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [assistantDraft?.text, sessionActive, sessionState, turns, userDraft]);

  useEffect(() => {
    const stabilityTimerRef = runtimeRecoveryStabilityTimerRef;
    const currentRealtimeRef = realtimeRef;
    const currentAudioRef = audioRef;
    componentMountedRef.current = true;
    return () => {
      componentMountedRef.current = false;
      const error = new Error(
        "The realtime connection closed before pending conversation data was saved.",
      );
      completeAssistantSettlement({ ok: false, error }, undefined, true);
      completeUserCommitSettlement({ ok: false, error });
      conversationStartedRef.current = false;
      sessionEstablishedRef.current = false;
      pendingRuntimeRecoveryRef.current = undefined;
      freeConversationAudioRef.current = {
        enabled: false,
        turnOpen: false,
        preRoll: [],
      };
      freeConversationController.disable();
      if (stabilityTimerRef.current !== undefined) {
        window.clearTimeout(stabilityTimerRef.current);
      }
      runtimeEpochRef.current += 1;
      currentRealtimeRef.current?.disconnect();
      void currentAudioRef.current?.dispose();
    };
  }, [
    completeAssistantSettlement,
    completeUserCommitSettlement,
    freeConversationController,
  ]);

  const {
    reportContextualError,
    teardownSessionRuntime,
    interruptActivePlaybackAndWait,
    settleSessionBeforeTransition,
    showPausedConversation,
    activateConversation,
    retryRuntimeRecovery,
  } = useRealtimeSessionRuntime({
    activeConversationId,
    muted,
    volume,
    showSessionError,
    clearSessionError,
    refreshConversationHistory: refreshConversationHistorySilently,
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
  });
  const {
    pressToTalk,
    stopResponse,
    cancelRecording,
    startLongRecording,
    finishLongRecording,
    cancelLongRecording,
    enterFreeConversation,
    exitFreeConversation,
  } = useVoiceInputController({
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
  });
  const {
    startSession,
    tryConversationAgain,
    deleteReviewedConversation,
    resumeConversation,
    showNewConversation,
    pauseSession,
    continueSession,
    restartSession,
    endSession,
  } = useConversationLifecycle({
    selectedPersona,
    selectedScenario,
    difficulty,
    locale,
    route,
    sessionUiPreview,
    sessionActive,
    sessionPaused,
    activeConversationId,
    createConversation: conversationHistory.create,
    loadConversation: conversationHistory.load,
    removeConversation: conversationHistory.remove,
    refreshConversationHistory: refreshConversationHistorySilently,
    activateConversation,
    showPausedConversation,
    settleSessionBeforeTransition,
    teardownSessionRuntime,
    cancelActiveGesture: pressToTalk.cancelActiveGesture,
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
  });
  const handleConversationScroll = () => {
    const viewport = conversationViewportRef.current;
    if (!viewport) return;
    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    followLatestRef.current = distanceFromBottom < 120;
  };

  const toggleColorMode = () => {
    setColorMode((current) => (current === "dark" ? "light" : "dark"));
  };

  const handleScenarioSelection = (scenarioId: number) => {
    const scenario = rolePlayCatalog.catalog.scenarios.find(
      (candidate) => candidate.id === scenarioId,
    );
    const persona = resolvePersona(
      rolePlayCatalog.catalog,
      scenario,
      catalogSelection.personaId ?? undefined,
    );
    setCatalogSelection({
      scenarioId,
      personaId: persona?.id ?? null,
    });
  };

  const canStart =
    qwenConfigured === true &&
    !rolePlayCatalog.loading &&
    selectedScenario !== undefined &&
    selectedPersona !== undefined &&
    !isStarting;
  const canStopResponse =
    !sessionPaused &&
    !isReconciling &&
    (sessionState === "processing" || sessionState === "speaking");
  const gestureActive = pressToTalk.visualState.pressed || isRecording;
  const sessionControlsLocked =
    isStarting || sessionControlAction !== null;
  const errorMessageText = resolveUiError(errorMessage);
  const launchError =
    errorMessageText ??
    rolePlayCatalog.loadError ??
    resolveUiError(healthError) ??
    (qwenConfigured === false
      ? t({
          en: "The voice service isn't ready. Check the server's Qwen credentials.",
          zh: "语音服务尚未就绪，请检查服务端的 Qwen 凭据配置。",
        })
      : null);
  const restoringConversationRoute =
    route.page === "chat" && !sessionActive && !sessionUiPreview;
  const displayedConversationId =
    route.page === "feedback" ? route.conversationId : activeConversationId;
  const activeConversationSummary = conversationHistory.conversations.find(
    ({ id }) => id === activeConversationId,
  );
  const activeScenarioGoals = activeLocalizedScenario?.goals ?? [];

  const routeContent = {
    route,
    sessionActive,
    restoringConversationRoute,
    admin: {
      catalog: rolePlayCatalog.catalog,
      busy: rolePlayCatalog.busy,
      error:
        rolePlayCatalog.mutationError ??
        rolePlayCatalog.loadError ??
        undefined,
      onExit: () => navigate(HOME_ROUTE),
      onCreatePersona: rolePlayCatalog.createPersona,
      onUpdatePersona: rolePlayCatalog.updatePersona,
      onDeletePersona: rolePlayCatalog.deletePersona,
      onCreateScenario: rolePlayCatalog.createScenario,
      onUpdateScenario: rolePlayCatalog.updateScenario,
      onDeleteScenario: rolePlayCatalog.deleteScenario,
    },
    history: {
      conversations: conversationHistory.conversations,
      activeConversationId: displayedConversationId,
      loading: conversationHistory.loading,
      busy: conversationHistory.busy || isStarting,
      error: conversationHistory.error,
      mobileOpen: historyMobileOpen,
      onMobileClose: () => setHistoryMobileOpen(false),
      onSelect: resumeConversation,
      onNew: showNewConversation,
      onRetry: conversationHistory.refresh,
    },
    feedback: {
      onFeedbackSettled: refreshConversationHistorySilently,
      onDeleteConversation: deleteReviewedConversation,
      onTryAgain: tryConversationAgain,
    },
    launcher: {
      catalog: rolePlayCatalog.catalog,
      loading: rolePlayCatalog.loading,
      error: launchError,
      selectedScenarioId: selectedScenario?.id ?? null,
      selectedPersonaId: selectedPersona?.id ?? null,
      difficulty,
      onScenarioChange: handleScenarioSelection,
      onPersonaChange: (personaId: number) =>
        setCatalogSelection((current) => ({
          ...current,
          personaId,
        })),
      onDifficultyChange: setDifficulty,
      onStart: startSession,
      isStarting,
      startDisabled: !canStart,
      onOpenAdmin: () => navigate(ADMIN_ROUTE),
    },
    sessionHeader: {
      personaName,
      personaOccupation,
      sessionState,
      paused: sessionPaused,
      controlsLocked: sessionControlsLocked,
      controlAction: sessionControlAction,
      muted,
      volume,
      canStopResponse,
      conversationId: activeConversationId,
      messageCount: activeConversationSummary?.messageCount ?? 0,
      audioMessageCount:
        activeConversationSummary?.audioMessageCount ?? 0,
      audioAvailable: activeConversationSummary?.audioAvailable === true,
      downloadInProgress,
      onOpenHistory: () => setHistoryMobileOpen(true),
      onMutedChange: setMuted,
      onVolumeChange: setVolume,
      onStopResponse: stopResponse,
      onDownload: (format: ConversationDownloadFormat) =>
        void downloadActiveConversation(format),
      onPause: () => void pauseSession(),
      onRestart: restartSession,
      onEnd: endSession,
    },
    voiceComposer: {
      sessionActive,
      sessionPaused,
      sessionState,
      sessionControlsLocked,
      sessionControlAction,
      voiceInputMode,
      voiceModeMenuOpen,
      voiceModeTransitioning,
      isSubmitting,
      isStarting,
      isUserCommitPending,
      isRecording,
      runtimeRecoveryFailed,
      longRecordingAction,
      longRecordingCancellationRequired,
      inputLevel,
      recordingDuration,
      pressToTalkVisualState: pressToTalk.visualState,
      pressToTalkBindings: pressToTalk.bindings,
      onVoiceModeMenuOpenChange: setVoiceModeMenuOpen,
      onContinueSession: continueSession,
      onExitFreeConversation: exitFreeConversation,
      onRetryRuntimeRecovery: retryRuntimeRecovery,
      onFinishLongRecording: finishLongRecording,
      onCancelLongRecording: cancelLongRecording,
      onStartLongRecording: startLongRecording,
      onEnterFreeConversation: enterFreeConversation,
    },
    activeSession: {
      goals: activeScenarioGoals,
      personaName,
      turns,
      userDraft,
      assistantDraft,
      gestureActive,
      freeConversation:
        voiceInputMode === "free-conversation"
          ? {
              inputLevel,
              outputLevel,
              sessionState,
              listening: freeConversationPhase === "recording",
            }
          : null,
      conversationViewportRef,
      conversationEndRef,
      onConversationScroll: handleConversationScroll,
    },
    onOpenHistory: () => setHistoryMobileOpen(true),
  } satisfies AppRouteContentProps;

  return {
    antdLocale,
    isDark,
    messageContextHolder,
    globalHeader: {
      adminVisible: route.page !== "admin",
      busy: isStarting,
      darkMode: isDark,
      onHome: () => navigate(HOME_ROUTE),
      onOpenAdmin: () => navigate(ADMIN_ROUTE),
      onToggleTheme: toggleColorMode,
    },
    goalSuggestion: {
      open: sessionActive && successSuggestionResponseId !== null,
      title: t({
        en: "Scenario goals achieved",
        zh: "场景目标已达成",
      }),
      okText: t({ en: "End and review", zh: "结束并查看复盘" }),
      cancelText: t({ en: "Keep practicing", zh: "继续对练" }),
      description: t({
        en: "AI detected clear evidence that every success criterion for this scenario has been completed. Would you like to end the conversation now?",
        zh: "AI 检测到当前场景的每一项成功标准都已有明确完成证据。是否现在结束对话？",
      }),
      onCancel: () => setSuccessSuggestionResponseId(null),
      onConfirm: async () => {
        await endSession();
        setSuccessSuggestionResponseId(null);
      },
    },
    routeContent,
  };
}
