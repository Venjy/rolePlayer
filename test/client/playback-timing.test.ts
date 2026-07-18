import { describe, expect, it } from "vitest";
import { calculateSafePlayedMs } from "../../src/client/audio/playback-timing";

describe("calculateSafePlayedMs", () => {
  it("counts completed and currently rendered audio but excludes future sources", () => {
    expect(
      calculateSafePlayedMs({
        completedSeconds: 0.4,
        totalAudioSeconds: 2.4,
        activeIntervals: [
          { startAt: 1, endAt: 2 },
          { startAt: 2, endAt: 3 },
        ],
        currentTime: 1.6,
        outputLatencySeconds: 0.1,
        audibilityCompromised: false,
      }),
    ).toBe(600);
  });

  it("returns zero while every source is still prebuffered", () => {
    expect(
      calculateSafePlayedMs({
        completedSeconds: 0,
        totalAudioSeconds: 1,
        activeIntervals: [{ startAt: 1, endAt: 2 }],
        currentTime: 0.9,
        outputLatencySeconds: 0,
        audibilityCompromised: false,
      }),
    ).toBe(0);
  });

  it("does not count a scheduling gap as spoken audio", () => {
    expect(
      calculateSafePlayedMs({
        completedSeconds: 1,
        totalAudioSeconds: 2,
        activeIntervals: [{ startAt: 2, endAt: 3 }],
        currentTime: 2.5,
        outputLatencySeconds: 0,
        audibilityCompromised: false,
      }),
    ).toBe(1_200);
  });

  it("returns zero when application audibility was compromised", () => {
    expect(
      calculateSafePlayedMs({
        completedSeconds: 4,
        totalAudioSeconds: 5,
        activeIntervals: [],
        currentTime: 5,
        outputLatencySeconds: 0,
        audibilityCompromised: true,
      }),
    ).toBe(0);
  });
});
