import { describe, expect, it, vi } from "vitest";
import {
  FreeConversationController,
  type FreeConversationPhase,
} from "../../src/client/voice/free-conversation-controller";

function createHarness() {
  const startTurn = vi.fn(async () => true);
  const submitTurn = vi.fn(async () => undefined);
  const phases: FreeConversationPhase[] = [];
  const controller = new FreeConversationController({
    startTurn,
    submitTurn,
    onPhaseChange: (phase) => phases.push(phase),
  });
  controller.enable();
  return { controller, startTurn, submitTurn, phases };
}

describe("FreeConversationController", () => {
  it("starts after confirmed speech and submits after sustained silence", async () => {
    const { controller, startTurn, submitTurn, phases } = createHarness();

    controller.handleLevel(0.03, 0, false);
    controller.handleLevel(0.03, 170, false);
    await controller.waitForLifecycle();

    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(controller.currentPhase).toBe("recording");

    controller.handleLevel(0.004, 600, false);
    controller.handleLevel(0.004, 1_510, false);
    await controller.waitForLifecycle();

    expect(submitTurn).toHaveBeenCalledTimes(1);
    expect(controller.currentPhase).toBe("listening");
    expect(phases).toEqual([
      "listening",
      "starting",
      "recording",
      "submitting",
      "listening",
    ]);
  });

  it("uses a higher start threshold while assistant playback is active", async () => {
    const { controller, startTurn } = createHarness();

    controller.handleLevel(0.018, 0, true);
    controller.handleLevel(0.018, 250, true);
    expect(startTurn).not.toHaveBeenCalled();

    controller.handleLevel(0.024, 300, true);
    controller.handleLevel(0.024, 430, true);
    await controller.waitForLifecycle();
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("detects speech immediately after being disabled and re-enabled", async () => {
    const { controller, startTurn } = createHarness();
    controller.setBlocked(true);
    controller.disable();

    controller.enable();
    controller.setBlocked(false);
    controller.handleLevel(0.025, 1_000, false);
    controller.handleLevel(0.025, 1_130, false);
    await controller.waitForLifecycle();

    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(controller.currentPhase).toBe("recording");
  });

  it("does not open another turn while blocked by persistence", async () => {
    const { controller, startTurn } = createHarness();
    controller.setBlocked(true);
    controller.handleLevel(0.08, 0, false);
    controller.handleLevel(0.08, 300, false);
    expect(startTurn).not.toHaveBeenCalled();

    controller.setBlocked(false);
    controller.handleLevel(0.08, 400, false);
    controller.handleLevel(0.08, 570, false);
    await controller.waitForLifecycle();
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("submits a continuous turn at the maximum duration", async () => {
    const { controller, submitTurn } = createHarness();
    controller.handleLevel(0.06, 0, false);
    controller.handleLevel(0.06, 170, false);
    await controller.waitForLifecycle();

    controller.handleLevel(0.06, 120_171, false);
    await controller.waitForLifecycle();
    expect(submitTurn).toHaveBeenCalledTimes(1);
  });
});
