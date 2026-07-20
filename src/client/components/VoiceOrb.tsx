import type { CSSProperties } from "react";
import { Typography } from "antd";
import type { SessionState } from "../../shared/realtime-protocol";
import { useI18n } from "../i18n";

export interface VoiceOrbProps {
  inputLevel: number;
  outputLevel: number;
  sessionState: SessionState;
  listening: boolean;
}

type OrbStyle = CSSProperties & {
  "--orb-energy": number;
  "--orb-scale": number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Immersive, transcript-free feedback for hands-free conversation. */
export function VoiceOrb({
  inputLevel,
  outputLevel,
  sessionState,
  listening,
}: VoiceOrbProps) {
  const { t } = useI18n();
  const safeInput = Number.isFinite(inputLevel) ? clamp(inputLevel, 0, 1) : 0;
  const safeOutput = Number.isFinite(outputLevel)
    ? clamp(outputLevel, 0, 1)
    : 0;
  const activeLevel = sessionState === "speaking" ? safeOutput : safeInput;
  const perceivedLevel = Math.sqrt(activeLevel);
  const energy = clamp(0.18 + perceivedLevel * 1.1, 0.18, 1);
  const style: OrbStyle = {
    "--orb-energy": energy,
    // Give quiet speech a visible response and cap loud peaks so the orb never
    // collides with the surrounding status text on a narrow viewport.
    "--orb-scale": 1 + clamp(perceivedLevel * 0.34, 0, 0.18),
  };
  const status =
    sessionState === "speaking"
      ? t({ en: "AI is speaking · You can interrupt anytime", zh: "AI 正在说话 · 你可以随时打断" })
      : sessionState === "processing"
        ? t({ en: "AI is thinking · Keep talking if needed", zh: "AI 正在思考 · 你仍可继续说话" })
        : listening
          ? t({ en: "Listening · Pause when you finish", zh: "正在聆听 · 说完后自然停顿即可" })
          : t({ en: "Say something when you're ready", zh: "准备好后直接说话" });

  return (
    <section
      className="free-conversation-stage"
      aria-label={t({ en: "Free conversation mode", zh: "自由对话模式" })}
    >
      <div
        className="voice-orb-wrap"
        data-speaker={sessionState === "speaking" ? "assistant" : "user"}
        style={style}
        aria-hidden="true"
      >
        <div className="voice-orb-halo" />
        <div className="voice-orb">
          <span className="voice-orb-layer voice-orb-layer-one" />
          <span className="voice-orb-layer voice-orb-layer-two" />
          <span className="voice-orb-gloss" />
        </div>
      </div>

      <Typography.Title level={3} className="free-conversation-title">
        {t({ en: "Free conversation", zh: "自由对话" })}
      </Typography.Title>
      <Typography.Text
        type="secondary"
        className="free-conversation-status"
        role="status"
        aria-live="polite"
      >
        {status}
      </Typography.Text>
    </section>
  );
}
