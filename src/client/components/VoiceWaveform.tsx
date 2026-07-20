import type { CSSProperties } from "react";
import { useI18n } from "../i18n";
import styles from "./VoiceWaveform.module.css";

const BAR_WEIGHTS = [0.38, 0.58, 0.82, 1, 0.9, 0.68, 0.46, 0.72, 0.42];

export interface VoiceWaveformProps {
  /**
   * Current microphone RMS level. Values outside the normalized 0–1 range are
   * clamped, so the raw value from BrowserAudioEngine can be passed directly.
   */
  level: number;
  /** Controls whether the recording overlay is rendered. */
  recording: boolean;
  /** Changes the visual state and release instruction to cancellation. */
  cancelling?: boolean;
  /** Elapsed recording time in milliseconds. */
  durationMs: number;
  /** Continuous recording ends with a button instead of gesture release. */
  interaction?: "hold" | "continuous";
  /** Optional class name for layout positioning by the parent. */
  className?: string;
}

type WaveBarStyle = CSSProperties & { "--voice-bar-scale": number };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, durationMs) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  }

  return [minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

/**
 * Compact, dependency-free recording feedback for a press-to-talk overlay.
 *
 * The waveform is intentionally decorative: screen readers receive only the
 * stable recording instruction, rather than rapidly changing level and timer
 * announcements.
 */
export function VoiceWaveform({
  level,
  recording,
  cancelling = false,
  durationMs,
  interaction = "hold",
  className,
}: VoiceWaveformProps) {
  const { t } = useI18n();
  if (!recording) return null;

  const safeLevel = Number.isFinite(level) ? clamp(level, 0, 1) : 0;
  // RMS values are usually small, so a square-root curve keeps quiet speech
  // visible without making loud input exceed the component bounds.
  const perceivedLevel = Math.sqrt(safeLevel);
  const duration = formatDuration(durationMs);
  const instruction = cancelling
    ? t({ en: "Release to cancel", zh: "松开取消" })
    : interaction === "continuous"
      ? t({
          en: "End speaking to send, or cancel to discard",
          zh: "结束发言即可发送，取消则放弃本次录音",
        })
      : t({ en: "Release to send", zh: "松开发送" });
  const rootClassName = [
    styles.root,
    cancelling ? styles.cancelling : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={rootClassName}
      aria-label={t({ en: "Recording", zh: "正在录音" })}
    >
      <div className={styles.waveform} aria-hidden="true">
        {BAR_WEIGHTS.map((weight, index) => {
          const restingScale = 0.14 + weight * 0.08;
          const activeScale = perceivedLevel * (0.3 + weight * 0.7);
          const style: WaveBarStyle = {
            "--voice-bar-scale": clamp(restingScale + activeScale, 0.14, 1),
          };

          return <span className={styles.bar} style={style} key={index} />;
        })}
      </div>

      <time
        className={styles.timer}
        dateTime={`PT${Math.floor(Math.max(0, durationMs) / 1_000)}S`}
        aria-hidden="true"
      >
        {duration}
      </time>

      <span className={styles.instruction} role="status" aria-live="polite">
        {instruction}
      </span>
    </section>
  );
}
