import { describe, expect, it, vi } from "vitest";
import { PressToTalkController } from "../../src/client/voice/press-to-talk-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createHarness(start: () => Promise<boolean> = async () => true) {
  const submit = vi.fn(async () => undefined);
  const cancel = vi.fn(async () => undefined);
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
});
