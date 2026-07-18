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
  localizePersona,
  localizeScenario,
} from "./catalog/catalog-localization";
import {
  reconcileCatalogSelection,
  resolvePersona,
  resolveScenario,
} from "./catalog/catalog-selection";
import { useRolePlayCatalog } from "./catalog/use-role-play-catalog";
import { ConversationMessage } from "./components/ConversationMessage";
import { VoiceWaveform } from "./components/VoiceWaveform";
import {
  LanguageToggleButton,
  useI18n,
  type LocalizedText,
} from "./i18n";
import { LearnerLaunchPanel } from "./learner";
import { RealtimeClient } from "./realtime/realtime-client";
import { usePressToTalk } from "./voice/use-press-to-talk";

const THEME_STORAGE_KEY = "role-player:color-mode";

type ColorMode = "light" | "dark";
type UiPreviewMode = "session" | "recording" | null;
type AppMode = "learner" | "admin";
type UiError = string | LocalizedText;

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

const STATE_LABELS: Record<
  Exclude<SessionState, "speaking">,
  LocalizedText
> = {
  connecting: { en: "Connecting", zh: "连接中" },
  ready: { en: "Ready to talk", zh: "可以说话" },
  listening: { en: "Listening", zh: "正在聆听" },
  processing: { en: "Thinking", zh: "思考中" },
  ended: { en: "Ended", zh: "已结束" },
};

const KNOWN_CLIENT_ERRORS: Readonly<Record<string, LocalizedText>> = {
  "Realtime client is already connected.": {
    en: "The realtime client is already connected.",
    zh: "实时客户端已经连接。",
  },
  "Timed out while starting the realtime session.": {
    en: "Timed out while starting the realtime session.",
    zh: "启动实时会话超时。",
  },
  "Could not connect to the local realtime gateway.": {
    en: "Could not connect to the local realtime gateway.",
    zh: "无法连接本地实时网关。",
  },
  "Realtime WebSocket is not open.": {
    en: "The realtime connection is not open.",
    zh: "实时连接尚未打开。",
  },
  "The connection is too slow to stream microphone audio.": {
    en: "The connection is too slow to stream microphone audio.",
    zh: "连接速度过慢，无法传输麦克风音频。",
  },
  "This browser does not support microphone capture.": {
    en: "This browser does not support microphone capture.",
    zh: "当前浏览器不支持麦克风录音。",
  },
  "Audio engine is not prepared.": {
    en: "The audio engine is not ready.",
    zh: "音频引擎尚未就绪。",
  },
  "Received overlapping realtime audio responses.": {
    en: "Overlapping realtime audio responses were received.",
    zh: "收到了重叠的实时音频回应。",
  },
  "Audio engine was disposed.": {
    en: "The audio engine was closed.",
    zh: "音频引擎已关闭。",
  },
  "Timed out while flushing microphone audio.": {
    en: "Timed out while finishing the microphone recording.",
    zh: "结束麦克风录音时超时。",
  },
};

const SERVER_ERROR_LABELS: Readonly<Record<string, LocalizedText>> = {
  ALREADY_CONFIGURED: {
    en: "The session is already configured.",
    zh: "会话已经完成配置。",
  },
  AUDIO_FORWARD_FAILED: {
    en: "Could not forward microphone audio.",
    zh: "无法转发麦克风音频。",
  },
  TRANSCRIPTION_FAILED: {
    en: "The user audio could not be transcribed.",
    zh: "无法识别用户语音。",
  },
  INPUT_ALREADY_ACTIVE: {
    en: "A user turn is already active.",
    zh: "当前已有一轮用户输入正在进行。",
  },
  NO_ACTIVE_INPUT: {
    en: "No recording is active.",
    zh: "当前没有正在进行的录音。",
  },
  RECORDING_TOO_SHORT: {
    en: "Please speak for at least 100 ms before submitting.",
    zh: "请至少说话 100 毫秒后再发送。",
  },
  PLAYBACK_BACKPRESSURE: {
    en: "The browser connection is too slow for realtime playback.",
    zh: "浏览器连接速度过慢，无法实时播放。",
  },
  RESPONSE_FAILED: {
    en: "The AI customer could not generate a response.",
    zh: "AI 客户无法生成回复。",
  },
  UNKNOWN_RESPONSE: {
    en: "The playback response is no longer active.",
    zh: "要播放的回应已不再活动。",
  },
  CONTEXT_STATE_UNCERTAIN: {
    en: "Conversation context repair failed.",
    zh: "对话上下文修复失败。",
  },
  UPSTREAM_CLOSED: {
    en: "The Qwen connection closed unexpectedly.",
    zh: "Qwen 连接意外关闭。",
  },
  SESSION_CONFIGURATION_FAILED: {
    en: "The realtime session could not be configured.",
    zh: "无法配置实时会话。",
  },
  SESSION_NOT_READY: {
    en: "The realtime session is not ready yet.",
    zh: "实时会话尚未就绪。",
  },
  GATEWAY_ERROR: {
    en: "The realtime gateway could not process the request.",
    zh: "实时网关无法处理该请求。",
  },
  INVALID_AUDIO_FRAME: {
    en: "An invalid microphone audio frame was received.",
    zh: "收到了无效的麦克风音频帧。",
  },
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

function readableError(error: unknown): UiError {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return {
      en: "Microphone permission was denied. Allow microphone access in your browser's site settings, then start the session again.",
      zh: "麦克风权限被拒绝。请在浏览器的网站设置中允许麦克风，然后重新开始会话。",
    };
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return {
      en: "No microphone was found. Connect an input device and try again.",
      zh: "没有找到可用的麦克风，请连接输入设备后重试。",
    };
  }
  return error instanceof Error
    ? (KNOWN_CLIENT_ERRORS[error.message] ?? error.message)
    : {
        en: "An unknown error occurred. Please try again.",
        zh: "发生了未知错误，请重试。",
      };
}

function readableServerError(code: string, message: string): UiError {
  const knownError = SERVER_ERROR_LABELS[code];
  return knownError ? { en: message || knownError.en, zh: knownError.zh } : message;
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
  const { locale, antdLocale, t } = useI18n();
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
  const [healthError, setHealthError] = useState<UiError | null>(null);
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
  const [errorMessage, setErrorMessage] = useState<UiError | null>(null);
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
    activeSessionConfig?.persona.name ??
    (selectedPersona ? localizePersona(selectedPersona, locale).name : null) ??
    t({ en: "Alex", zh: "亚历克斯" });
  const resolveUiError = useCallback(
    (error: UiError | null | undefined): string | null => {
      if (!error) return null;
      return typeof error === "string" ? error : t(error);
    },
    [t],
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
          setErrorMessage(readableServerError(message.code, message.message));
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
      setErrorMessage({
        en: "Choose a scenario and one of its compatible roles first.",
        zh: "请先选择一个场景和与之兼容的角色。",
      });
      return;
    }

    const sessionConfig: ActiveSessionConfig = {
      persona: localizePersona(
        selectedPersona,
        locale,
        rolePlayCatalog.catalog.personaPresets,
      ),
      scenario: localizeScenario(selectedScenario, locale),
      difficulty,
    };
    const instructions = compileRolePlayInstructions(sessionConfig);
    if (instructions.length > MAX_REALTIME_INSTRUCTIONS_LENGTH) {
      setErrorMessage({
        en: `The Instructions generated for this role and scenario are too long (${instructions.length}/${MAX_REALTIME_INSTRUCTIONS_LENGTH} characters). Simplify the configuration in Admin Console.`,
        zh: `当前角色与场景生成的 Instructions 过长（${instructions.length}/${MAX_REALTIME_INSTRUCTIONS_LENGTH} 字符），请在管理控制台精简配置。`,
      });
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
          setErrorMessage({
            en: "The server returned an unrecognized realtime message.",
            zh: "服务端返回了无法识别的实时消息。",
          });
        },
        onClose: (event) => {
          void teardownSessionRuntime(false);
          if (event.code !== 1000) {
            setErrorMessage({
              en: `The realtime connection closed unexpectedly (${event.code}).`,
              zh: `实时连接意外关闭（${event.code}）。`,
            });
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
    ? t({ en: "Release to cancel", zh: "松开取消" })
    : gestureActive
      ? t({ en: "Release to send", zh: "松开发送" })
      : sessionState === "speaking"
        ? t({
            en: "Hold to interrupt and talk",
            zh: "按住打断并说话",
          })
        : t({ en: "Hold to talk", zh: "按住说话" });
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
  const sessionStateLabel =
    sessionState === "speaking"
      ? t(
          { en: "{name} is speaking", zh: "{name} 正在说话" },
          { name: personaName },
        )
      : t(STATE_LABELS[sessionState]);
  const muteLabel = muted
    ? t({ en: "Unmute", zh: "取消静音" })
    : t({ en: "Mute", zh: "静音" });
  const themeToggleLabel = isDark
    ? t({ en: "Switch to light theme", zh: "切换到浅色主题" })
    : t({ en: "Switch to dark theme", zh: "切换到深色主题" });

  const playbackControls = (
    <div className="playback-popover">
      <Typography.Text strong>
        {t({ en: "Playback controls", zh: "播放控制" })}
      </Typography.Text>
      <Flex align="center" gap={10}>
        <Tooltip title={muteLabel}>
          <Button
            type="text"
            shape="circle"
            icon={muted ? <AudioMutedOutlined /> : <SoundOutlined />}
            aria-label={muteLabel}
            onClick={() => setMuted((current) => !current)}
          />
        </Tooltip>
        <Slider
          className="volume-slider"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          tooltip={{ formatter: (value) => `${value ?? 0}%` }}
          aria-label={t({ en: "AI voice volume", zh: "AI 语音音量" })}
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
        {t({ en: "Stop current AI speech", zh: "停止当前 AI 语音" })}
      </Button>
    </div>
  );

  const themeButton = (
    <Tooltip title={themeToggleLabel}>
      <Button
        type="text"
        shape="circle"
        icon={isDark ? <SunOutlined /> : <MoonOutlined />}
        aria-label={themeToggleLabel}
        onClick={toggleColorMode}
      />
    </Tooltip>
  );

  return (
    <ConfigProvider
      locale={antdLocale}
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
                  <Tooltip
                    title={t({ en: "Playback controls", zh: "播放控制" })}
                  >
                    <Button
                      type="text"
                      shape="circle"
                      icon={muted ? <AudioMutedOutlined /> : <SoundOutlined />}
                      aria-label={t({
                        en: "Open playback controls",
                        zh: "打开播放控制",
                      })}
                    />
                  </Tooltip>
                </Popover>
                <Popconfirm
                  title={t({
                    en: "End this role-play?",
                    zh: "结束本次对练？",
                  })}
                  description={t({
                    en: "The current realtime connection will be closed.",
                    zh: "当前实时连接会被关闭。",
                  })}
                  okText={t({ en: "End", zh: "结束" })}
                  cancelText={t({ en: "Keep practicing", zh: "继续对练" })}
                  okButtonProps={{ danger: true }}
                  onConfirm={endSession}
                >
                  <Tooltip title={t({ en: "End session", zh: "结束会话" })}>
                    <Button
                      type="text"
                      danger
                      shape="circle"
                      icon={<PoweroffOutlined />}
                      aria-label={t({ en: "End session", zh: "结束会话" })}
                    />
                  </Tooltip>
                </Popconfirm>
                <span className="header-language-toggle">
                  <LanguageToggleButton />
                </span>
                {themeButton}
              </Flex>
            </header>

            <section
              className="conversation-viewport"
              ref={conversationViewportRef}
              onScroll={handleConversationScroll}
              role="log"
              aria-live="polite"
              aria-label={t({ en: "Conversation history", zh: "对话记录" })}
            >
              <div className="conversation-list">
                {errorMessageText && (
                  <Alert
                    className="session-alert"
                    type="error"
                    showIcon
                    closable
                    title={errorMessageText}
                    onClose={() => setErrorMessage(null)}
                  />
                )}

                {turns.length === 0 && !userDraft && !assistantDraft && (
                  <Empty
                    className="empty-conversation"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t(
                      {
                        en: "Hold the button below and say your first sentence to {name}",
                        zh: "按住下方按钮，向 {name} 说出你的第一句话",
                      },
                      { name: personaName },
                    )}
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
                {t({
                  en: "Hold to record · Release to send · Slide up to cancel",
                  zh: "按住录音 · 松开发送 · 上滑取消",
                })}
              </Typography.Text>
            </footer>
          </main>
        )}
      </AntApp>
    </ConfigProvider>
  );
}
