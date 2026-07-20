import {
  AudioFilled,
  CloseOutlined,
  PhoneOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Button, Popover, Tooltip, Typography } from "antd";
import type { SessionState } from "../../shared/realtime-protocol";
import { VoiceWaveform } from "../components/VoiceWaveform";
import { useI18n } from "../i18n";
import type { PressToTalkVisualState } from "../voice/press-to-talk-controller";
import type { PressToTalkBindings } from "../voice/use-press-to-talk";
import type {
  LongRecordingAction,
  SessionControlAction,
  VoiceInputMode,
} from "./session-types";

export interface VoiceComposerProps {
  sessionActive: boolean;
  sessionPaused: boolean;
  sessionState: SessionState;
  sessionControlsLocked: boolean;
  sessionControlAction: SessionControlAction | null;
  voiceInputMode: VoiceInputMode;
  voiceModeMenuOpen: boolean;
  voiceModeTransitioning: boolean;
  isSubmitting: boolean;
  isStarting: boolean;
  isUserCommitPending: boolean;
  isRecording: boolean;
  runtimeRecoveryFailed: boolean;
  longRecordingAction: LongRecordingAction | null;
  longRecordingCancellationRequired: boolean;
  inputLevel: number;
  recordingDuration: number;
  pressToTalkVisualState: PressToTalkVisualState;
  pressToTalkBindings: PressToTalkBindings;
  onVoiceModeMenuOpenChange: (open: boolean) => void;
  onContinueSession: () => Promise<void>;
  onExitFreeConversation: () => Promise<void>;
  onRetryRuntimeRecovery: () => void;
  onFinishLongRecording: () => Promise<void>;
  onCancelLongRecording: () => Promise<void>;
  onStartLongRecording: () => Promise<void>;
  onEnterFreeConversation: () => Promise<void>;
}

export function VoiceComposer({
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
  pressToTalkVisualState,
  pressToTalkBindings,
  onVoiceModeMenuOpenChange,
  onContinueSession,
  onExitFreeConversation,
  onRetryRuntimeRecovery,
  onFinishLongRecording,
  onCancelLongRecording,
  onStartLongRecording,
  onEnterFreeConversation,
}: VoiceComposerProps) {
  const { locale, t } = useI18n();
  const gestureActive = pressToTalkVisualState.pressed || isRecording;
  const isRecoveringConnection =
    sessionActive && isStarting && sessionState === "connecting";
  const holdButtonLabel =
    voiceInputMode === "long-recording"
      ? isSubmitting || longRecordingAction === "submitting"
        ? t({ en: "Sending…", zh: "正在发送…" })
        : longRecordingAction === "starting" && !isRecording
          ? t({ en: "Starting recording…", zh: "正在开始录音…" })
          : longRecordingCancellationRequired
            ? t({ en: "Cancellation pending", zh: "等待取消确认" })
            : t({ en: "End speaking", zh: "结束发言" })
      : runtimeRecoveryFailed
        ? t({ en: "Retry voice connection", zh: "重试语音连接" })
        : isRecoveringConnection
          ? t({ en: "Reconnecting…", zh: "正在重新连接…" })
          : isUserCommitPending
            ? t({ en: "Saving your transcript…", zh: "正在保存语音转写…" })
            : pressToTalkVisualState.cancelling
              ? t({ en: "Release to cancel", zh: "松开取消" })
              : gestureActive
                ? t({ en: "Release to send", zh: "松开发送" })
                : sessionState === "speaking"
                  ? t({
                      en: "Hold to interrupt and talk",
                      zh: "按住打断并说话",
                    })
                  : t({ en: "Hold to talk", zh: "按住说话" });
  const cancelLongRecordingLabel =
    longRecordingCancellationRequired &&
    longRecordingAction !== "cancelling"
      ? t({ en: "Retry cancellation", zh: "重试取消录音" })
      : t({ en: "Cancel recording", zh: "取消本次录音" });
  const voiceModeOptionsDisabled =
    !sessionActive ||
    sessionPaused ||
    isSubmitting ||
    isStarting ||
    isUserCommitPending ||
    runtimeRecoveryFailed ||
    voiceModeTransitioning ||
    voiceInputMode !== "push-to-talk";
  const voiceModeOptions = (
    <div className="voice-mode-popover" role="menu">
      <Tooltip
        placement="left"
        mouseEnterDelay={0.25}
        title={t({
          en: "Click once to record a longer message without holding the button, then click End speaking to send it.",
          zh: "点击一次即可持续录音，无需一直按住；说完后点击“结束发言”发送。",
        })}
      >
        <Button
          type="text"
          block
          role="menuitem"
          icon={<AudioFilled />}
          disabled={voiceModeOptionsDisabled}
          onClick={() => void onStartLongRecording()}
        >
          {t({ en: "Start recording", zh: "开始录音" })}
        </Button>
      </Tooltip>
      <Tooltip
        placement="left"
        mouseEnterDelay={0.25}
        title={t({
          en: "Talk hands-free like a phone call. Pauses send your turn automatically, and speaking interrupts the AI.",
          zh: "像打电话一样免提交谈；停顿后自动发送，说话时可以随时打断 AI。",
        })}
      >
        <Button
          type="text"
          block
          role="menuitem"
          icon={<PhoneOutlined />}
          disabled={voiceModeOptionsDisabled}
          onClick={() => void onEnterFreeConversation()}
        >
          {t({ en: "Free conversation", zh: "自由对话" })}
        </Button>
      </Tooltip>
    </div>
  );

  return (
    <footer className="voice-composer">
      {sessionPaused ? (
        <Button
          className="continue-session-button"
          type="primary"
          size="large"
          block
          icon={<PlayCircleOutlined />}
          loading={
            sessionControlAction === "resuming" ||
            sessionControlAction === "restarting"
          }
          disabled={sessionControlsLocked}
          onClick={() => void onContinueSession()}
        >
          {sessionControlAction === "restarting"
            ? t({ en: "Restarting session…", zh: "正在重启会话…" })
            : sessionControlAction === "resuming"
              ? t({ en: "Continuing session…", zh: "正在继续会话…" })
              : t({ en: "Continue session", zh: "继续对话" })}
        </Button>
      ) : voiceInputMode === "free-conversation" ? (
        <Button
          className="exit-free-conversation-button"
          size="large"
          block
          icon={<PhoneOutlined />}
          loading={voiceModeTransitioning}
          onClick={() => void onExitFreeConversation()}
        >
          {t({
            en: "Exit free conversation mode",
            zh: "退出自由对话模式",
          })}
        </Button>
      ) : (
        <>
          <VoiceWaveform
            className="recording-waveform"
            level={inputLevel}
            recording={gestureActive}
            cancelling={
              voiceInputMode === "push-to-talk" &&
              pressToTalkVisualState.cancelling
            }
            durationMs={recordingDuration}
            interaction={
              voiceInputMode === "long-recording" ? "continuous" : "hold"
            }
          />

          <div
            className={`voice-composer-controls${
              voiceInputMode === "long-recording" ? " is-long-recording" : ""
            }`}
          >
            <Button
              className="hold-to-talk-button"
              type="primary"
              size="large"
              block
              danger={
                voiceInputMode === "push-to-talk" &&
                pressToTalkVisualState.cancelling
              }
              icon={
                runtimeRecoveryFailed || isRecoveringConnection ? (
                  <ReloadOutlined />
                ) : (
                  <AudioFilled />
                )
              }
              loading={
                isSubmitting ||
                isRecoveringConnection ||
                longRecordingAction === "starting" ||
                longRecordingAction === "submitting"
              }
              disabled={
                !sessionActive ||
                isSubmitting ||
                isStarting ||
                isUserCommitPending ||
                longRecordingCancellationRequired ||
                voiceModeTransitioning
              }
              aria-label={holdButtonLabel}
              aria-pressed={gestureActive}
              data-speaking={sessionState === "speaking" || undefined}
              {...(voiceInputMode === "push-to-talk"
                ? pressToTalkBindings
                : {})}
              onClick={
                runtimeRecoveryFailed
                  ? onRetryRuntimeRecovery
                  : voiceInputMode === "long-recording"
                    ? () => void onFinishLongRecording()
                    : undefined
              }
            >
              {holdButtonLabel}
            </Button>
            {voiceInputMode === "long-recording" ? (
              <Tooltip
                title={t({
                  en: "Discard this recording without sending it.",
                  zh: "放弃本次录音，不发送任何内容。",
                })}
              >
                <Button
                  className="cancel-long-recording-button"
                  size="large"
                  danger
                  icon={<CloseOutlined />}
                  loading={longRecordingAction === "cancelling"}
                  disabled={
                    isSubmitting ||
                    isStarting ||
                    isUserCommitPending ||
                    (voiceModeTransitioning &&
                      longRecordingAction !== "cancelling")
                  }
                  aria-label={cancelLongRecordingLabel}
                  onClick={() => void onCancelLongRecording()}
                >
                  {cancelLongRecordingLabel}
                </Button>
              </Tooltip>
            ) : (
              <Popover
                key={locale}
                content={voiceModeOptions}
                trigger="click"
                placement="topRight"
                open={voiceModeMenuOpen}
                onOpenChange={onVoiceModeMenuOpenChange}
              >
                <Tooltip
                  title={t({
                    en: "More speaking modes",
                    zh: "更多说话模式",
                  })}
                >
                  <span className="voice-mode-trigger-anchor">
                    <Button
                      className="voice-mode-trigger"
                      size="large"
                      shape="circle"
                      icon={<PlusOutlined />}
                      loading={voiceModeTransitioning}
                      disabled={voiceModeOptionsDisabled}
                      aria-label={t({
                        en: "More speaking modes",
                        zh: "更多说话模式",
                      })}
                    />
                  </span>
                </Tooltip>
              </Popover>
            )}
          </div>
          <Typography.Text type="secondary" className="gesture-hint">
            {voiceInputMode === "long-recording"
              ? longRecordingCancellationRequired
                ? t({
                    en: "Cancellation was not confirmed · Retry cancellation before continuing",
                    zh: "尚未确认取消 · 请重试取消录音后再继续",
                  })
                : t({
                    en: "Tap End speaking to send · Cancel recording to discard",
                    zh: "点击结束发言即可发送 · 点击取消本次录音即可放弃",
                  })
              : runtimeRecoveryFailed
                ? t({
                    en: "The conversation is kept. Retry to continue speaking.",
                    zh: "当前会话已保留，重试连接后可继续交谈。",
                  })
                : t({
                    en: "Hold to record · Release to send · Slide up to cancel",
                    zh: "按住录音 · 松开发送 · 上滑取消",
                  })}
          </Typography.Text>
        </>
      )}
    </footer>
  );
}
