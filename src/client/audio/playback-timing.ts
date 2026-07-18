const PLAYBACK_SAFETY_SECONDS = 0.3;

export interface PlaybackInterval {
  startAt: number;
  endAt: number;
}

export interface SafePlaybackInput {
  completedSeconds: number;
  totalAudioSeconds: number;
  activeIntervals: PlaybackInterval[];
  currentTime: number;
  outputLatencySeconds: number;
  audibilityCompromised: boolean;
}

export function calculateSafePlayedMs(input: SafePlaybackInput): number {
  if (input.audibilityCompromised) return 0;

  let renderedSeconds = Math.max(0, input.completedSeconds);
  for (const interval of input.activeIntervals) {
    renderedSeconds += Math.max(
      0,
      Math.min(input.currentTime, interval.endAt) - interval.startAt,
    );
  }

  const safeSeconds = Math.max(
    0,
    Math.min(renderedSeconds, Math.max(0, input.totalAudioSeconds)) -
      Math.max(0, input.outputLatencySeconds) -
      PLAYBACK_SAFETY_SECONDS,
  );
  return Math.round(safeSeconds * 1_000);
}
