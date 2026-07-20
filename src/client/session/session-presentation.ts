import type { SessionState } from "../../shared/realtime-protocol";
import type { LocalizedText } from "../i18n";

export const STATE_LABELS: Record<
  Exclude<SessionState, "speaking">,
  LocalizedText
> = {
  connecting: { en: "Connecting", zh: "连接中" },
  ready: { en: "Ready to talk", zh: "可以说话" },
  listening: { en: "Listening", zh: "正在聆听" },
  processing: { en: "Thinking", zh: "思考中" },
  paused: { en: "Paused", zh: "已暂停" },
  ended: { en: "Ended", zh: "已结束" },
};

export const STATE_BADGE_STATUS = {
  connecting: "processing",
  ready: "success",
  listening: "processing",
  processing: "warning",
  speaking: "processing",
  paused: "warning",
  ended: "default",
} as const satisfies Record<
  SessionState,
  "default" | "processing" | "success" | "warning"
>;
