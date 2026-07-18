import { describe, expect, it, vi } from "vitest";
import { PressToTalkController } from "../../src/client/voice/press-to-talk-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createHarness(
  start: () => Promise<boolean> = async () => true,
  handlers?: {
    submit?: () => Promise<void>;
    cancel?: () => Promise<void>;
  },
) {
  const submit = vi.fn(handlers?.submit ?? (async () => undefined));
  const cancel = vi.fn(handlers?.cancel ?? (async () => undefined));
  const states: Array<{ pressed: boolean; cancelling: boolean }> = [];
  const controller = new PressToTalkController({
    start,
    submit,
    cancel,
    onVisualState: (state) => states.push(state),
  });
  return { controller, submit, cancel, states };
}

describe("PressToTalkController", () => {
  it("submits once when a normal hold is released", async () => {
    const harness = createHarness();
    await harness.controller.press(300);
    await harness.controller.release();
    await harness.controller.release();

    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(harness.cancel).not.toHaveBeenCalled();
  });

  it("cancels when the pointer moves upward past the threshold", async () => {
    const harness = createHarness();
    await harness.controller.press(300);
    harness.controller.move(220);
    await harness.controller.release();

    expect(harness.cancel).toHaveBeenCalledTimes(1);
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.states).toContainEqual({ pressed: true, cancelling: true });
  });

  it("handles release before asynchronous microphone startup completes", async () => {
    const start = deferred<boolean>();
    const harness = createHarness(() => start.promise);
    const starting = harness.controller.press(300);
    const releasing = harness.controller.release();
    start.resolve(true);
    await Promise.all([starting, releasing]);

    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(harness.cancel).not.toHaveBeenCalled();
  });

  it("forces cancellation for pointer cancellation or lost focus", async () => {
    const harness = createHarness();
    await harness.controller.press(300);
    await harness.controller.release(true);

    expect(harness.cancel).toHaveBeenCalledTimes(1);
    expect(harness.submit).not.toHaveBeenCalled();
  });

  it("can force-cancel after release while microphone startup is still pending", async () => {
    const start = deferred<boolean>();
    const harness = createHarness(() => start.promise);
    const starting = harness.controller.press(300);
    const releasing = harness.controller.release(false);
    const cancelling = harness.controller.cancelAndWait();

    expect(harness.controller.isLifecycleActive).toBe(true);
    start.resolve(true);
    await Promise.all([starting, releasing, cancelling]);

    expect(harness.cancel).toHaveBeenCalledTimes(1);
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.controller.isLifecycleActive).toBe(false);
  });

  it("waits for an already-finishing submission without invoking cancel", async () => {
    const submission = deferred<void>();
    const harness = createHarness(undefined, {
      submit: () => submission.promise,
    });
    await harness.controller.press(300);
    const releasing = harness.controller.release(false);
    const waiting = harness.controller.cancelAndWait();
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(harness.cancel).not.toHaveBeenCalled();

    submission.resolve();
    await Promise.all([releasing, waiting]);
    expect(harness.controller.isLifecycleActive).toBe(false);
  });
});
