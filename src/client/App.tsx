import {
  AudioFilled,
  AudioMutedOutlined,
  CustomerServiceOutlined,
  MoonOutlined,
  PoweroffOutlined,
  SoundOutlined,
  StopOutlined,
  SunOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Avatar,
  Badge,
  Button,
  ConfigProvider,
  Empty,
  Flex,
  Popconfirm,
  Popover,
  Slider,
  theme as antdTheme,
  Tooltip,
  Typography,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ServerMessage,
  SessionState,
} from "../shared/realtime-protocol";
import { MAX_REALTIME_INSTRUCTIONS_LENGTH } from "../shared/realtime-protocol";
import type {
  Difficulty,
  Persona,
  RolePlayCatalog,
  Scenario,
} from "../shared/role-play-catalog";
import { compileRolePlayInstructions } from "../shared/role-play-instructions";
import { AdminConsole } from "./admin";
import { BrowserAudioEngine } from "./audio/browser-audio-engine";
import {
  reconcileCatalogSelection,
  resolvePersona,
  resolveScenario,
} from "./catalog/catalog-selection";
import { useRolePlayCatalog } from "./catalog/use-role-play-catalog";
import { ConversationMessage } from "./components/ConversationMessage";
import { VoiceWaveform } from "./components/VoiceWaveform";
import { LearnerLaunchPanel } from "./learner";
import { RealtimeClient } from "./realtime/realtime-client";
import { usePressToTalk } from "./voice/use-press-to-talk";

const THEME_STORAGE_KEY = "role-player:color-mode";

type ColorMode = "light" | "dark";
type UiPreviewMode = "session" | "recording" | null;
type AppMode = "learner" | "admin";

interface ActiveSessionConfig {
  persona: Persona;
  scenario: Scenario;
  difficulty: Difficulty;
}

interface TranscriptTurn {
  id: string;
  responseId?: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
  interrupted?: boolean;
}

interface AssistantDraft {
  responseId: string;
  text: string;
}

interface UiPreviewFixture {
  mode: Exclude<UiPreviewMode, null>;
  turns: TranscriptTurn[];
  assistantDraft: AssistantDraft | null;
}

interface AssistantRuntime {
  responseId: string;
  itemId?: string;
  streamedText: string;
  finalTranscript?: string;
  generationStatus?: "completed" | "cancelled" | "failed";
  playbackComplete: boolean;
  finalized: boolean;
  interrupted: boolean;
  startedAt: Date;
}

const STATE_LABELS: Record<Exclude<SessionState, "speaking">, string> = {
  connecting: "连接中",
  ready: "可以说话",
  listening: "正在聆听",
  processing: "思考中",
  ended: "已结束",
};

const STATE_BADGE_STATUS = {
  connecting: "processing",
  ready: "success",
  listening: "processing",
  processing: "warning",
  speaking: "processing",
  ended: "default",
} as const satisfies Record<
  SessionState,
  "default" | "processing" | "success" | "warning"
>;

function getInitialColorMode(): ColorMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage can be unavailable in strict privacy modes; system preference remains usable.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readableError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "麦克风权限被拒绝。请在浏览器的网站设置中允许麦克风，然后重新开始会话。";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "没有找到可用的麦克风，请连接输入设备后重试。";
  }
  return error instanceof Error ? error.message : "发生了未知错误，请重试。";
}

function getUiPreviewMode(): UiPreviewMode {
  const preview = new URLSearchParams(window.location.search).get("preview");
  return preview === "session" || preview === "recording" ? preview : null;
}

function createPreviewTurns(): TranscriptTurn[] {
  const now = Date.now();
  return [
    {
      id: "preview-user-1",
      role: "user",
      text: "你好 Alex，我想先了解一下你们目前筛选销售线索的方式。",
      timestamp: new Date(now - 82_000),
    },
    {
      id: "preview-assistant-1",
      role: "assistant",
      text: "我们主要还是依靠销售自己判断。你们的方案具体能解决什么问题？",
      timestamp: new Date(now - 64_000),
    },
    {
      id: "preview-user-2",
      role: "user",
      text: "它可以根据客户画像和历史互动自动排序，让团队先跟进最有机会的客户。",
      timestamp: new Date(now - 38_000),
    },
  ];
}

function createUiPreviewFixture(): UiPreviewFixture | null {
  const mode = getUiPreviewMode();
  if (!mode) return null;
  return {
    mode,
    turns: createPreviewTurns(),
    assistantDraft:
      mode === "session"
        ? {
            responseId: "preview-response",
            text: "听起来能节省不少时间。不过我们的数据分散在几个系统里，",
          }
        : null,
  };
}

const UI_PREVIEW_FIXTURE = import.meta.env.DEV
  ? createUiPreviewFixture()
  : null;

export function App() {
  const uiPreviewMode = UI_PREVIEW_FIXTURE?.mode ?? null;
  const sessionUiPreview = uiPreviewMode !== null;
  const recordingUiPreview = uiPreviewMode === "recording";
  const [catalogSelection, setCatalogSelection] = useState({
    scenarioId: null as string | null,
    personaId: null as string | null,
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
  const [colorMode, setColorMode] = useState<ColorMode>(getInitialColorMode);
  const [appMode, setAppMode] = useState<AppMode>("learner");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [activeSessionConfig, setActiveSessionConfig] =
    useState<ActiveSessionConfig | null>(null);
  const [qwenConfigured, setQwenConfigured] = useState<boolean | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [sessionActive, setSessionActive] = useState(sessionUiPreview);
  const [sessionState, setSessionState] = useState<SessionState>(
    recordingUiPreview ? "listening" : sessionUiPreview ? "speaking" : "ended",
  );
  const [isStarting, setIsStarting] = useState(false);
  const [isRecording, setIsRecording] = useState(recordingUiPreview);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [inputLevel, setInputLevel] = useState(recordingUiPreview ? 0.68 : 0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>(
    UI_PREVIEW_FIXTURE?.turns ?? [],
  );
  const [userDraft, setUserDraft] = useState("");
  const [assistantDraft, setAssistantDraft] = useState<AssistantDraft | null>(
    UI_PREVIEW_FIXTURE?.assistantDraft ?? null,
  );
  const [isReconciling, setIsReconciling] = useState(false);

  const realtimeRef = useRef<RealtimeClient | undefined>(undefined);
  const audioRef = useRef<BrowserAudioEngine | undefined>(undefined);
  const recordingStartedAtRef = useRef(0);
  const recordingRef = useRef(false);
  const submissionRef = useRef(false);
  const playbackActiveRef = useRef(false);
  const activeResponseIdRef = useRef<string | undefined>(undefined);
  const assistantResponsesRef = useRef(new Map<string, AssistantRuntime>());
  const cleanupPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const conversationViewportRef = useRef<HTMLDivElement | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);

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
  const personaName =
    activeSessionConfig?.persona.name ?? selectedPersona?.name ?? "Alex";

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
          setHealthError("无法确认语音服务状态，请检查本地服务后重试。");
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
    if (!sessionActive || !followLatestRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      conversationEndRef.current?.scrollIntoView({ block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [assistantDraft?.text, sessionActive, sessionState, turns, userDraft]);

  useEffect(
    () => () => {
      realtimeRef.current?.disconnect();
      void audioRef.current?.dispose();
    },
    [],
  );

  const tryFinalizeAssistant = useCallback((responseId: string) => {
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
    const transcript = (runtime.finalTranscript ?? runtime.streamedText).trim();
    if (transcript) {
      setTurns((current) => [
        ...current,
        {
          id: runtime.itemId ?? `${responseId}:completed`,
          responseId,
          role: "assistant",
          text: transcript,
          timestamp: runtime.startedAt,
        },
      ]);
    }

    setAssistantDraft((current) =>
      current?.responseId === responseId ? null : current,
    );
    realtimeRef.current?.completePlayback(responseId);
    audioRef.current?.finalizePlayback(responseId);
    assistantResponsesRef.current.delete(responseId);
    if (activeResponseIdRef.current === responseId) {
      activeResponseIdRef.current = undefined;
    }
  }, []);

  const teardownSessionRuntime = useCallback(
    (disconnectRealtime = true): Promise<void> => {
      const realtime = realtimeRef.current;
      const audio = audioRef.current;
      realtimeRef.current = undefined;
      audioRef.current = undefined;

      recordingRef.current = false;
      submissionRef.current = false;
      playbackActiveRef.current = false;
      activeResponseIdRef.current = undefined;
      recordingStartedAtRef.current = 0;
      assistantResponsesRef.current.clear();

      if (disconnectRealtime) realtime?.disconnect();

      setIsRecording(false);
      setIsSubmitting(false);
      setRecordingDuration(0);
      setInputLevel(0);
      setUserDraft("");
      setAssistantDraft(null);
      setIsReconciling(false);
      setSessionActive(false);
      setActiveSessionConfig(null);
      setSessionState("ended");

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
    [],
  );

  const handleServerMessage = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case "session.state":
          if (message.state === "ready" && playbackActiveRef.current) return;
          setSessionState(message.state);
          break;

        case "transcript.user.delta":
          setUserDraft(message.text + message.stash);
          break;

        case "transcript.user.done":
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
          break;
        }

        case "error":
          if (message.code === "PLAYBACK_BACKPRESSURE") {
            const responseId = activeResponseIdRef.current;
            if (responseId) {
              const runtime = assistantResponsesRef.current.get(responseId);
              if (runtime) runtime.interrupted = true;
              audioRef.current?.interruptPlayback(responseId);
              playbackActiveRef.current = false;
              setAssistantDraft(null);
              setIsReconciling(true);
            }
          }
          setErrorMessage(message.message);
          if (!message.recoverable) {
            void teardownSessionRuntime();
          }
          break;

        case "session.ready":
          setSessionState("ready");
          break;
      }
    },
    [teardownSessionRuntime, tryFinalizeAssistant],
  );

  const startSession = async () => {
    if (!selectedPersona || !selectedScenario) {
      setErrorMessage("请先选择一个场景和与之兼容的角色。");
      return;
    }

    const sessionConfig: ActiveSessionConfig = {
      persona: selectedPersona,
      scenario: selectedScenario,
      difficulty,
    };
    const instructions = compileRolePlayInstructions(sessionConfig);
    if (instructions.length > MAX_REALTIME_INSTRUCTIONS_LENGTH) {
      setErrorMessage(
        `当前角色与场景生成的 Instructions 过长（${instructions.length}/${MAX_REALTIME_INSTRUCTIONS_LENGTH} 字符），请在管理控制台精简配置。`,
      );
      return;
    }
    setIsStarting(true);
    setActiveSessionConfig(sessionConfig);
    setErrorMessage(null);
    setTurns([]);
    setUserDraft("");
    setAssistantDraft(null);
    setIsReconciling(false);
    assistantResponsesRef.current.clear();
    activeResponseIdRef.current = undefined;
    playbackActiveRef.current = false;
    followLatestRef.current = true;

    await cleanupPromiseRef.current;

    const audio = new BrowserAudioEngine({
      onInputPcm: (buffer) => {
        try {
          realtimeRef.current?.sendAudio(buffer);
        } catch (error) {
          setErrorMessage(readableError(error));
          void audioRef.current?.cancelCapture();
          recordingRef.current = false;
          setIsRecording(false);
        }
      },
      onInputLevel: (level) => setInputLevel(level),
      onPlaybackStarted: (responseId) => {
        activeResponseIdRef.current = responseId;
        playbackActiveRef.current = true;
        setSessionState("speaking");
      },
      onPlaybackDrained: (responseId) => {
        playbackActiveRef.current = false;
        const runtime = assistantResponsesRef.current.get(responseId);
        if (runtime) runtime.playbackComplete = true;
        tryFinalizeAssistant(responseId);
      },
      onError: (error) => setErrorMessage(readableError(error)),
    });
    audioRef.current = audio;

    try {
      await audio.prepare();
      audio.setVolume(muted ? 0 : volume);

      const realtime = new RealtimeClient({
        onMessage: handleServerMessage,
        onAudio: (responseId, buffer) => {
          void audio.enqueuePcm24(responseId, buffer).catch((error: unknown) => {
            setErrorMessage(readableError(error));
          });
        },
        onMalformedMessage: () => {
          setErrorMessage("服务端返回了无法识别的实时消息。");
        },
        onClose: (event) => {
          void teardownSessionRuntime(false);
          if (event.code !== 1000) {
            setErrorMessage(`实时连接意外关闭（${event.code}）。`);
          }
        },
      });
      realtimeRef.current = realtime;

      await realtime.connect({
        instructions,
        voice: sessionConfig.persona.voice,
        maxHistoryTurns: 20,
      });

      setSessionActive(true);
      setSessionState("ready");
    } catch (error) {
      await teardownSessionRuntime();
      setErrorMessage(readableError(error));
    } finally {
      setIsStarting(false);
    }
  };

  const beginRecording = useCallback(async (): Promise<boolean> => {
    if (
      !sessionActive ||
      recordingRef.current ||
      submissionRef.current ||
      !audioRef.current ||
      !realtimeRef.current
    ) {
      return false;
    }
    setErrorMessage(null);

    const activeResponseId = activeResponseIdRef.current;
    if (activeResponseId) {
      const runtime = assistantResponsesRef.current.get(activeResponseId);
      if (runtime) runtime.interrupted = true;
      const interruption = audioRef.current.interruptPlayback(activeResponseId);
      playbackActiveRef.current = false;
      realtimeRef.current.interruptPlayback(
        activeResponseId,
        interruption.safePlayedMs,
      );
      setAssistantDraft(null);
      setIsReconciling(true);
    }

    let inputStarted = false;
    try {
      realtimeRef.current.startInput();
      inputStarted = true;
      await audioRef.current.startCapture();
      recordingRef.current = true;
      recordingStartedAtRef.current = performance.now();
      setRecordingDuration(0);
      setIsRecording(true);
      setSessionState("listening");
      return true;
    } catch (error) {
      if (inputStarted) {
        try {
          realtimeRef.current?.clearInput();
        } catch {
          // The realtime connection may close while microphone setup fails.
        }
      }
      setErrorMessage(readableError(error));
      return false;
    }
  }, [sessionActive]);

  const submitRecording = useCallback(async (): Promise<void> => {
    if (!recordingRef.current || submissionRef.current) return;
    submissionRef.current = true;
    setIsSubmitting(true);

    try {
      await audioRef.current?.finishCapture();
      recordingRef.current = false;
      setIsRecording(false);
      setRecordingDuration(0);
      setInputLevel(0);
      realtimeRef.current?.commitInput();
      setSessionState("processing");
    } catch (error) {
      recordingRef.current = false;
      setIsRecording(false);
      setInputLevel(0);
      try {
        realtimeRef.current?.clearInput();
      } catch {
        // Cleanup is best effort if the realtime connection already failed.
      }
      setErrorMessage(readableError(error));
    } finally {
      submissionRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  const cancelRecording = useCallback(async (): Promise<void> => {
    if (!recordingRef.current || submissionRef.current) return;
    submissionRef.current = true;
    setIsSubmitting(true);

    try {
      await audioRef.current?.cancelCapture();
      realtimeRef.current?.clearInput();
      recordingRef.current = false;
      setIsRecording(false);
      setRecordingDuration(0);
      setUserDraft("");
      setInputLevel(0);
      setSessionState(isReconciling ? "processing" : "ready");
    } catch (error) {
      setErrorMessage(readableError(error));
    } finally {
      submissionRef.current = false;
      setIsSubmitting(false);
    }
  }, [isReconciling]);

  const stopResponse = useCallback(() => {
    const responseId = activeResponseIdRef.current;
    if (responseId) {
      const runtime = assistantResponsesRef.current.get(responseId);
      if (runtime) runtime.interrupted = true;
      const interruption = audioRef.current?.interruptPlayback(responseId) ?? {
        responseId,
        safePlayedMs: 0,
      };
      playbackActiveRef.current = false;
      realtimeRef.current?.interruptPlayback(
        responseId,
        interruption.safePlayedMs,
      );
      setIsReconciling(true);
    } else {
      audioRef.current?.clearPlayback();
      realtimeRef.current?.cancelResponse();
      setIsReconciling(true);
    }
    setAssistantDraft(null);
    setSessionState("processing");
  }, []);

  const pressToTalk = usePressToTalk({
    enabled: sessionActive && !isSubmitting,
    start: beginRecording,
    submit: submitRecording,
    cancel: cancelRecording,
  });

  const endSession = async () => {
    await pressToTalk.cancelActiveGesture();
    if (recordingRef.current) await cancelRecording();

    await teardownSessionRuntime();
  };

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

  const handleScenarioSelection = (scenarioId: string) => {
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
    !isReconciling &&
    (sessionState === "processing" || sessionState === "speaking");
  const gestureActive = pressToTalk.visualState.pressed || isRecording;
  const holdButtonLabel = pressToTalk.visualState.cancelling
    ? "松开取消"
    : gestureActive
      ? "松开发送"
      : sessionState === "speaking"
        ? "按住打断并说话"
        : "按住说话";
  const launchError =
    errorMessage ??
    rolePlayCatalog.loadError ??
    healthError ??
    (qwenConfigured === false
      ? "语音服务尚未就绪，请检查服务端的 Qwen 凭据配置。"
      : null);
  const sessionStateLabel =
    sessionState === "speaking"
      ? `${personaName} 正在说话`
      : STATE_LABELS[sessionState];

  const playbackControls = (
    <div className="playback-popover">
      <Typography.Text strong>播放控制</Typography.Text>
      <Flex align="center" gap={10}>
        <Tooltip title={muted ? "取消静音" : "静音"}>
          <Button
            type="text"
            shape="circle"
            icon={muted ? <AudioMutedOutlined /> : <SoundOutlined />}
            aria-label={muted ? "取消静音" : "静音"}
            onClick={() => setMuted((current) => !current)}
          />
        </Tooltip>
        <Slider
          className="volume-slider"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          tooltip={{ formatter: (value) => `${value ?? 0}%` }}
          aria-label="AI 语音音量"
          onChange={(value) => {
            setVolume(value / 100);
            if (value > 0) setMuted(false);
          }}
        />
      </Flex>
      <Button
        block
        icon={<StopOutlined />}
        disabled={!canStopResponse}
        onClick={stopResponse}
      >
        停止当前 AI 语音
      </Button>
    </div>
  );

  const themeButton = (
    <Tooltip title={isDark ? "切换到浅色主题" : "切换到深色主题"}>
      <Button
        type="text"
        shape="circle"
        icon={isDark ? <SunOutlined /> : <MoonOutlined />}
        aria-label={isDark ? "切换到浅色主题" : "切换到深色主题"}
        onClick={toggleColorMode}
      />
    </Tooltip>
  );

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark
          ? antdTheme.darkAlgorithm
          : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: "#18a779",
          borderRadius: 12,
          fontFamily:
            'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
      }}
    >
      <AntApp className="application-root">
        {!sessionActive ? (
          appMode === "admin" ? (
            <AdminConsole
              catalog={rolePlayCatalog.catalog}
              busy={rolePlayCatalog.busy}
              error={
                rolePlayCatalog.mutationError ??
                rolePlayCatalog.loadError ??
                undefined
              }
              themeButton={themeButton}
              onExit={() => setAppMode("learner")}
              onCreatePersona={rolePlayCatalog.createPersona}
              onUpdatePersona={rolePlayCatalog.updatePersona}
              onDeletePersona={rolePlayCatalog.deletePersona}
              onCreateScenario={rolePlayCatalog.createScenario}
              onUpdateScenario={rolePlayCatalog.updateScenario}
              onDeleteScenario={rolePlayCatalog.deleteScenario}
            />
          ) : (
            <LearnerLaunchPanel
              catalog={rolePlayCatalog.catalog}
              loading={rolePlayCatalog.loading}
              error={launchError}
              selectedScenarioId={selectedScenario?.id ?? null}
              selectedPersonaId={selectedPersona?.id ?? null}
              difficulty={difficulty}
              onScenarioChange={handleScenarioSelection}
              onPersonaChange={(personaId) =>
                setCatalogSelection((current) => ({
                  ...current,
                  personaId,
                }))
              }
              onDifficultyChange={setDifficulty}
              onStart={startSession}
              isStarting={isStarting}
              startDisabled={!canStart}
              themeButton={themeButton}
              onOpenAdmin={() => setAppMode("admin")}
            />
          )
        ) : (
          <main className="chat-shell">
            <header className="chat-header">
              <div className="persona-summary">
                <Avatar
                  size={42}
                  icon={<CustomerServiceOutlined />}
                  className="persona-avatar"
                />
                <div>
                  <Flex align="center" gap={7}>
                    <Typography.Text strong>{personaName}</Typography.Text>
                    {sessionState === "speaking" && (
                      <span className="speaking-equalizer" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </Flex>
                  <Badge
                    status={STATE_BADGE_STATUS[sessionState]}
                    text={sessionStateLabel}
                  />
                </div>
              </div>

              <Flex align="center" gap={2} className="header-actions">
                <Popover
                  content={playbackControls}
                  trigger="click"
                  placement="bottomRight"
                >
                  <Tooltip title="播放控制">
                    <Button
                      type="text"
                      shape="circle"
                      icon={muted ? <AudioMutedOutlined /> : <SoundOutlined />}
                      aria-label="打开播放控制"
                    />
                  </Tooltip>
                </Popover>
                <Popconfirm
                  title="结束本次对练？"
                  description="当前实时连接会被关闭。"
                  okText="结束"
                  cancelText="继续对练"
                  okButtonProps={{ danger: true }}
                  onConfirm={endSession}
                >
                  <Tooltip title="结束会话">
                    <Button
                      type="text"
                      danger
                      shape="circle"
                      icon={<PoweroffOutlined />}
                      aria-label="结束会话"
                    />
                  </Tooltip>
                </Popconfirm>
                {themeButton}
              </Flex>
            </header>

            <section
              className="conversation-viewport"
              ref={conversationViewportRef}
              onScroll={handleConversationScroll}
              role="log"
              aria-live="polite"
              aria-label="对话记录"
            >
              <div className="conversation-list">
                {errorMessage && (
                  <Alert
                    className="session-alert"
                    type="error"
                    showIcon
                    closable
                    title={errorMessage}
                    onClose={() => setErrorMessage(null)}
                  />
                )}

                {turns.length === 0 && !userDraft && !assistantDraft && (
                  <Empty
                    className="empty-conversation"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={`按住下方按钮，向 ${personaName} 说出你的第一句话`}
                  />
                )}

                {turns.map((turn) => (
                  <ConversationMessage
                    key={turn.id}
                    role={turn.role}
                    text={turn.text}
                    timestamp={turn.timestamp}
                    interrupted={turn.interrupted}
                    personaName={personaName}
                  />
                ))}

                {userDraft && (
                  <ConversationMessage
                    role="user"
                    text={userDraft}
                    personaName={personaName}
                    draft
                  />
                )}

                {assistantDraft && (
                  <ConversationMessage
                    role="assistant"
                    text={assistantDraft.text}
                    personaName={personaName}
                    draft
                  />
                )}

                {gestureActive && (
                  <div className="recording-overlay-spacer" aria-hidden="true" />
                )}
                <div ref={conversationEndRef} aria-hidden="true" />
              </div>
            </section>

            <footer className="voice-composer">
              <VoiceWaveform
                className="recording-waveform"
                level={inputLevel}
                recording={gestureActive}
                cancelling={pressToTalk.visualState.cancelling}
                durationMs={recordingDuration}
              />

              <Button
                className="hold-to-talk-button"
                type="primary"
                size="large"
                block
                danger={pressToTalk.visualState.cancelling}
                icon={<AudioFilled />}
                loading={isSubmitting}
                disabled={!sessionActive || isSubmitting}
                aria-label={holdButtonLabel}
                aria-pressed={gestureActive}
                data-speaking={sessionState === "speaking" || undefined}
                {...pressToTalk.bindings}
              >
                {holdButtonLabel}
              </Button>
              <Typography.Text type="secondary" className="gesture-hint">
                按住录音 · 松开发送 · 上滑取消
              </Typography.Text>
            </footer>
          </main>
        )}
      </AntApp>
    </ConfigProvider>
  );
}
