import {
  AudioMutedOutlined,
  CustomerServiceOutlined,
  DownloadOutlined,
  HistoryOutlined,
  PauseCircleOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  SoundOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Flex,
  Popconfirm,
  Popover,
  Slider,
  Tooltip,
  Typography,
} from "antd";
import type { SessionState } from "../../shared/realtime-protocol";
import type { ConversationDownloadFormat } from "../../shared/conversation-history";
import { useI18n } from "../i18n";
import { STATE_BADGE_STATUS, STATE_LABELS } from "./session-presentation";
import type { SessionControlAction } from "./session-types";

export interface SessionHeaderProps {
  personaName: string;
  sessionState: SessionState;
  paused: boolean;
  controlsLocked: boolean;
  controlAction: SessionControlAction | null;
  muted: boolean;
  volume: number;
  canStopResponse: boolean;
  conversationId: number | null;
  messageCount: number;
  audioMessageCount: number;
  audioAvailable: boolean;
  downloadInProgress: boolean;
  onOpenHistory: () => void;
  onMutedChange: (muted: boolean) => void;
  onVolumeChange: (volume: number) => void;
  onStopResponse: () => void;
  onDownload: (format: ConversationDownloadFormat) => void;
  onPause: () => void;
  onRestart: () => Promise<void>;
  onEnd: () => Promise<void>;
}

export function SessionHeader({
  personaName,
  sessionState,
  paused,
  controlsLocked,
  controlAction,
  muted,
  volume,
  canStopResponse,
  conversationId,
  messageCount,
  audioMessageCount,
  audioAvailable,
  downloadInProgress,
  onOpenHistory,
  onMutedChange,
  onVolumeChange,
  onStopResponse,
  onDownload,
  onPause,
  onRestart,
  onEnd,
}: SessionHeaderProps) {
  const { t } = useI18n();
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
  const hasMessages = messageCount > 0;
  const missingAudioMessageCount = messageCount - audioMessageCount;
  const audioUnavailableReason =
    messageCount === 0
      ? t({ en: "no spoken messages yet", zh: "还没有已完成的语音消息" })
      : missingAudioMessageCount > 0
        ? t(
            {
              en: "{count} message(s) have no audio",
              zh: "有 {count} 条消息缺少音频",
            },
            { count: missingAudioMessageCount },
          )
        : t({ en: "audio is not ready", zh: "音频尚未就绪" });
  const downloadMenu = {
    items: [
      {
        key: "audio",
        label: audioAvailable
          ? t({ en: "Download audio (.mp3)", zh: "下载音频（.mp3）" })
          : `${t({ en: "Download audio", zh: "下载音频" })} — ${audioUnavailableReason}`,
        disabled: !audioAvailable,
      },
      {
        key: "text",
        label: t({ en: "Download transcript (.txt)", zh: "下载文字（.txt）" }),
      },
      {
        key: "both",
        label: audioAvailable
          ? t({ en: "Download both (.zip)", zh: "音频和文字（.zip）" })
          : `${t({ en: "Download both", zh: "音频和文字" })} — ${audioUnavailableReason}`,
        disabled: !audioAvailable,
      },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "audio" || key === "text" || key === "both") {
        onDownload(key);
      }
    },
  };
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
            onClick={() => onMutedChange(!muted)}
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
            onVolumeChange(value / 100);
            if (value > 0) onMutedChange(false);
          }}
        />
      </Flex>
      <Button
        block
        icon={<StopOutlined />}
        disabled={!canStopResponse}
        onClick={onStopResponse}
      >
        {t({ en: "Stop current AI speech", zh: "停止当前 AI 语音" })}
      </Button>
    </div>
  );

  return (
    <header className="chat-header">
      <div className="persona-summary">
        <Tooltip
          title={t({ en: "Open conversation history", zh: "打开历史会话" })}
        >
          <Button
            className="mobile-history-trigger"
            type="text"
            shape="circle"
            icon={<HistoryOutlined />}
            aria-label={t({
              en: "Open conversation history",
              zh: "打开历史会话",
            })}
            onClick={onOpenHistory}
          />
        </Tooltip>
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
          <Tooltip title={t({ en: "Playback controls", zh: "播放控制" })}>
            <Button
              type="text"
              shape="circle"
              disabled={paused || controlsLocked}
              icon={muted ? <AudioMutedOutlined /> : <SoundOutlined />}
              aria-label={t({
                en: "Open playback controls",
                zh: "打开播放控制",
              })}
            />
          </Tooltip>
        </Popover>
        <Tooltip
          title={hasMessages
            ? t({ en: "Download conversation", zh: "下载会话" })
            : t({
                en: "There are no completed messages to download yet",
                zh: "还没有可下载的已完成对话",
              })}
        >
          <span className="disabled-tooltip-anchor">
            <Dropdown
              menu={downloadMenu}
              trigger={["click"]}
              disabled={
                !conversationId ||
                !hasMessages ||
                downloadInProgress ||
                controlsLocked
              }
              placement="bottomRight"
            >
              <Button
                type="text"
                shape="circle"
                loading={downloadInProgress}
                disabled={!conversationId || !hasMessages || controlsLocked}
                icon={<DownloadOutlined />}
                aria-label={t({
                  en: "Download conversation",
                  zh: "下载会话",
                })}
              />
            </Dropdown>
          </span>
        </Tooltip>
        {!paused && (
          <Tooltip title={t({ en: "Pause session", zh: "暂停会话" })}>
            <Button
              type="text"
              shape="circle"
              loading={controlAction === "pausing"}
              disabled={controlsLocked}
              icon={<PauseCircleOutlined />}
              aria-label={t({ en: "Pause session", zh: "暂停会话" })}
              onClick={onPause}
            />
          </Tooltip>
        )}
        <Popconfirm
          title={t({
            en: "Restart this role-play?",
            zh: "重新开始本次对练？",
          })}
          description={t({
            en: "All transcript and audio in this session will be cleared. The scenario, role, difficulty, and other settings stay the same.",
            zh: "本次会话的文字和音频记录都会清空，场景、角色、难度及其他配置保持不变。",
          })}
          okText={t({ en: "Restart", zh: "重新开始" })}
          cancelText={t({ en: "Cancel", zh: "取消" })}
          disabled={controlsLocked}
          onConfirm={onRestart}
        >
          <Tooltip title={t({ en: "Restart session", zh: "重启会话" })}>
            <Button
              type="text"
              shape="circle"
              loading={controlAction === "restarting"}
              disabled={controlsLocked}
              icon={<ReloadOutlined />}
              aria-label={t({ en: "Restart session", zh: "重启会话" })}
            />
          </Tooltip>
        </Popconfirm>
        <Popconfirm
          title={t({
            en: "End this role-play?",
            zh: "结束本次对练？",
          })}
          description={t({
            en: "This session cannot be continued after ending. Coaching feedback will be generated next.",
            zh: "结束后将无法继续本次会话，系统随后会生成对练复盘。",
          })}
          okText={t({ en: "End", zh: "结束" })}
          cancelText={t({ en: "Keep practicing", zh: "继续对练" })}
          okButtonProps={{ danger: true }}
          disabled={controlsLocked}
          onConfirm={onEnd}
        >
          <Tooltip title={t({ en: "End session", zh: "结束会话" })}>
            <Button
              type="text"
              danger
              shape="circle"
              disabled={controlsLocked}
              icon={<PoweroffOutlined />}
              aria-label={t({ en: "End session", zh: "结束会话" })}
            />
          </Tooltip>
        </Popconfirm>
      </Flex>
    </header>
  );
}
