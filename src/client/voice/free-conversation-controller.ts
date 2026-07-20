export type FreeConversationPhase =
  | "inactive"
  | "listening"
  | "starting"
  | "recording"
  | "submitting";

export interface FreeConversationControllerHandlers {
  startTurn: () => Promise<boolean>;
  submitTurn: () => Promise<void>;
  onPhaseChange: (phase: FreeConversationPhase) => void;
}

export interface FreeConversationDetectorOptions {
  speechThreshold: number;
  playbackSpeechThreshold: number;
  silenceThreshold: number;
  speechConfirmationMs: number;
  silenceDurationMs: number;
  minimumTurnMs: number;
  maximumTurnMs: number;
}

export const DEFAULT_FREE_CONVERSATION_OPTIONS = {
  // Worklet levels are RMS values. These defaults are deliberately
  // conservative so ordinary room noise does not create empty turns.
  speechThreshold: 0.011,
  // Browser echo cancellation already removes most speaker output. Keep a
  // modest additional margin during playback, but not one so large that a
  // quiet learner cannot barge in while AGC is intentionally disabled.
  playbackSpeechThreshold: 0.02,
  silenceThreshold: 0.007,
  speechConfirmationMs: 120,
  silenceDurationMs: 900,
  minimumTurnMs: 450,
  maximumTurnMs: 2 * 60 * 1_000,
} as const satisfies FreeConversationDetectorOptions;

const DEFAULT_HANDLERS: FreeConversationControllerHandlers = {
  startTurn: async () => false,
  submitTurn: async () => undefined,
  onPhaseChange: () => undefined,
};

/**
 * Converts microphone RMS samples into hands-free user turns.
 *
 * Audio routing remains outside this class: the caller owns a short pre-roll,
 * opens the realtime input before flushing it, and continuously captures the
 * microphone. Keeping the detector independent from React makes the threshold,
 * silence, and async-start races deterministic and testable.
 */
export class FreeConversationController {
  private phase: FreeConversationPhase = "inactive";
  private enabled = false;
  private blocked = false;
  private speechCandidateSince?: number;
  private silenceSince?: number;
  private turnStartedAt?: number;
  private lifecycleTask: Promise<void> = Promise.resolve();

  public constructor(
    private handlers: FreeConversationControllerHandlers = DEFAULT_HANDLERS,
    private readonly options: FreeConversationDetectorOptions =
      DEFAULT_FREE_CONVERSATION_OPTIONS,
  ) {}

  public updateHandlers(handlers: FreeConversationControllerHandlers): void {
    this.handlers = handlers;
  }

  public get currentPhase(): FreeConversationPhase {
    return this.phase;
  }

  public enable(): void {
    this.enabled = true;
    this.resetDetection();
    this.setPhase("listening");
  }

  public disable(): void {
    this.enabled = false;
    this.resetDetection();
    this.setPhase("inactive");
  }

  public setBlocked(blocked: boolean): void {
    this.blocked = blocked;
    if (blocked) this.speechCandidateSince = undefined;
  }

  public handleLevel(
    rawLevel: number,
    nowMs: number,
    playbackActive: boolean,
  ): void {
    if (!this.enabled || this.blocked || !Number.isFinite(rawLevel)) return;
    const level = Math.max(0, rawLevel);

    if (this.phase === "listening") {
      const threshold = playbackActive
        ? this.options.playbackSpeechThreshold
        : this.options.speechThreshold;
      if (level < threshold) {
        this.speechCandidateSince = undefined;
        return;
      }
      this.speechCandidateSince ??= nowMs;
      if (
        nowMs - this.speechCandidateSince >=
        this.options.speechConfirmationMs
      ) {
        this.speechCandidateSince = undefined;
        this.beginTurn(nowMs);
      }
      return;
    }

    if (this.phase !== "recording" || this.turnStartedAt === undefined) return;
    if (nowMs - this.turnStartedAt >= this.options.maximumTurnMs) {
      this.finishTurn();
      return;
    }
    if (level > this.options.silenceThreshold) {
      this.silenceSince = undefined;
      return;
    }
    this.silenceSince ??= nowMs;
    if (
      nowMs - this.turnStartedAt >= this.options.minimumTurnMs &&
      nowMs - this.silenceSince >= this.options.silenceDurationMs
    ) {
      this.finishTurn();
    }
  }

  public waitForLifecycle(): Promise<void> {
    return this.lifecycleTask;
  }

  private beginTurn(nowMs: number): void {
    if (this.phase !== "listening") return;
    this.setPhase("starting");
    const task = (async () => {
      const started = await this.handlers.startTurn();
      if (!this.enabled) return;
      if (!started) {
        this.resetDetection();
        this.setPhase("listening");
        return;
      }
      this.turnStartedAt = nowMs;
      this.silenceSince = undefined;
      this.setPhase("recording");
    })().catch(() => {
      if (!this.enabled) return;
      this.resetDetection();
      this.setPhase("listening");
    });
    this.lifecycleTask = task;
  }

  private finishTurn(): void {
    if (this.phase !== "recording") return;
    this.setPhase("submitting");
    const task = (async () => {
      await this.handlers.submitTurn();
      if (!this.enabled) return;
      this.resetDetection();
      this.setPhase("listening");
    })().catch(() => {
      if (!this.enabled) return;
      this.resetDetection();
      this.setPhase("listening");
    });
    this.lifecycleTask = task;
  }

  private resetDetection(): void {
    this.speechCandidateSince = undefined;
    this.silenceSince = undefined;
    this.turnStartedAt = undefined;
  }

  private setPhase(phase: FreeConversationPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.handlers.onPhaseChange(phase);
  }
}
