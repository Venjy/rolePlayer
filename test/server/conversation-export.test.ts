import { describe, expect, it } from "vitest";
import { normalizeSpeechLoudness } from "../../src/server/conversations/conversation-export";

const SAMPLE_RATE = 24_000;

describe("conversation export speech loudness", () => {
  it("brings quiet and loud speech turns to the same active RMS target", () => {
    const quiet = createTone(1_800);
    const loud = createTone(12_000);

    const quietGainDb = normalizeSpeechLoudness(quiet, SAMPLE_RATE);
    const loudGainDb = normalizeSpeechLoudness(loud, SAMPLE_RATE);

    expect(quietGainDb).toBeGreaterThan(7);
    expect(quietGainDb).toBeLessThan(9);
    expect(loudGainDb).toBeGreaterThan(-9);
    expect(loudGainDb).toBeLessThan(-7);
    expect(rmsDbfs(quiet)).toBeCloseTo(-20, 0);
    expect(rmsDbfs(loud)).toBeCloseTo(-20, 0);
  });

  it("ignores silence when measuring speech loudness", () => {
    const speech = createTone(2_300, 400);
    const withSilence = new Int16Array(SAMPLE_RATE);
    withSilence.set(speech, SAMPLE_RATE * 0.3);

    const gainDb = normalizeSpeechLoudness(withSilence, SAMPLE_RATE);

    expect(gainDb).toBeGreaterThan(5);
    expect(gainDb).toBeLessThan(8);
    expect(rmsDbfs(withSilence.subarray(SAMPLE_RATE * 0.3, SAMPLE_RATE * 0.7)))
      .toBeCloseTo(-20, 0);
  });

  it("caps gain and limits isolated peaks instead of amplifying without bound", () => {
    const samples = createTone(400);
    samples[Math.floor(samples.length / 2)] = 0x7fff;

    const gainDb = normalizeSpeechLoudness(samples, SAMPLE_RATE);
    const peak = samples.reduce(
      (highest, sample) => Math.max(highest, Math.abs(sample)),
      0,
    );

    expect(gainDb).toBe(12);
    expect(peak).toBeLessThanOrEqual(
      Math.round(0x8000 * 10 ** (-1 / 20)),
    );
  });

  it("leaves silence and sub-80ms transients unchanged", () => {
    const silence = new Int16Array(SAMPLE_RATE);
    const transient = createTone(10_000, 60);
    const originalTransient = Int16Array.from(transient);

    expect(normalizeSpeechLoudness(silence, SAMPLE_RATE)).toBe(0);
    expect(normalizeSpeechLoudness(transient, SAMPLE_RATE)).toBe(0);
    expect(transient).toEqual(originalTransient);
  });
});

function createTone(amplitude: number, durationMs = 400): Int16Array {
  const samples = new Int16Array(
    Math.round((SAMPLE_RATE * durationMs) / 1_000),
  );
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.round(
      Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE) * amplitude,
    );
  }
  return samples;
}

function rmsDbfs(samples: Int16Array): number {
  let squareSum = 0;
  for (const sample of samples) squareSum += sample * sample;
  const rms = Math.sqrt(squareSum / samples.length);
  return 20 * Math.log10(rms / 0x8000);
}
