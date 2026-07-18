export const DEFAULT_CANCEL_DISTANCE_PX = 72;

export interface PressToTalkVisualState {
  pressed: boolean;
  cancelling: boolean;
}

export interface PressToTalkControllerHandlers {
  start: () => Promise<boolean>;
  submit: () => Promise<void>;
  cancel: () => Promise<void>;
  onVisualState: (state: PressToTalkVisualState) => void;
}

type GesturePhase = "idle" | "starting" | "recording" | "finishing";

/**
 * Coordinates the asynchronous microphone start with a synchronous hold
 * gesture. Keeping this state machine outside React makes the quick
 * press/release race deterministic and directly testable.
 */
export class PressToTalkController {
  private phase: GesturePhase = "idle";
  private activePress = false;
  private cancelling = false;
  private originY = 0;
  private startTask?: Promise<void>;

  public constructor(
    private handlers: PressToTalkControllerHandlers,
    private readonly cancelDistancePx = DEFAULT_CANCEL_DISTANCE_PX,
  ) {}

  public updateHandlers(handlers: PressToTalkControllerHandlers): void {
    this.handlers = handlers;
  }

  public get isActivePress(): boolean {
    return this.activePress;
  }

  public press(originY: number): Promise<void> {
    if (this.phase !== "idle") return this.startTask ?? Promise.resolve();

    this.phase = "starting";
    this.activePress = true;
    this.cancelling = false;
    this.originY = originY;
    this.emitVisualState();

    const task = this.startLifecycle();
    this.startTask = task;
    return task;
  }

  public move(currentY: number): void {
    if (!this.activePress || this.phase === "idle" || this.phase === "finishing") {
      return;
    }

    const nextCancelling = this.originY - currentY >= this.cancelDistancePx;
    if (nextCancelling === this.cancelling) return;
    this.cancelling = nextCancelling;
    this.emitVisualState();
  }

  public release(forceCancel = false): Promise<void> {
    if (this.phase === "idle") return Promise.resolve();
    this.activePress = false;
    if (forceCancel) this.cancelling = true;
    this.emitVisualState();

    if (this.phase === "recording") {
      return this.finish(this.cancelling);
    }
    return this.startTask ?? Promise.resolve();
  }

  private async startLifecycle(): Promise<void> {
    try {
      const started = await this.handlers.start();
      if (!started) {
        this.reset();
        return;
      }

      this.phase = "recording";
      if (!this.activePress) {
        await this.finish(this.cancelling);
      }
    } catch {
      this.reset();
    }
  }

  private async finish(cancel: boolean): Promise<void> {
    if (this.phase !== "recording") return;
    this.phase = "finishing";
    try {
      if (cancel) await this.handlers.cancel();
      else await this.handlers.submit();
    } finally {
      this.reset();
    }
  }

  private reset(): void {
    this.phase = "idle";
    this.activePress = false;
    this.cancelling = false;
    this.startTask = undefined;
    this.emitVisualState();
  }

  private emitVisualState(): void {
    this.handlers.onVisualState({
      pressed: this.phase !== "idle" && this.phase !== "finishing",
      cancelling: this.cancelling,
    });
  }
}
