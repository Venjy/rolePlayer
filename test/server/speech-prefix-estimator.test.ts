import { describe, expect, it } from "vitest";
import { SpeechPrefixEstimator } from "../../src/server/realtime/speech-prefix-estimator";

describe("SpeechPrefixEstimator", () => {
  it("uses the current completed response and rolls back Chinese characters", () => {
    const estimator = new SpeechPrefixEstimator();
    const result = estimator.estimate({
      transcript: "一二三四五六七八九十",
      generatedAudioMs: 3_000,
      safePlayedMs: 1_800,
      generationCompleted: true,
    });

    expect(result).toMatchObject({
      transcript: "一二三四",
      strategy: "estimated_prefix",
      confidence: "high",
      language: "zh",
    });
  });

  it("never cuts an English word in half", () => {
    const estimator = new SpeechPrefixEstimator();
    const result = estimator.estimate({
      transcript: "Hello there, this is a carefully measured response.",
      generatedAudioMs: 4_000,
      safePlayedMs: 2_500,
      generationCompleted: true,
    });

    expect(result.transcript).toBe("Hello there, this is");
    expect(result.transcript.endsWith(" ")).toBe(false);
  });

  it("uses stable completed history to smooth an interrupted response", () => {
    const estimator = new SpeechPrefixEstimator();
    estimator.addCompletedSample("一二三四五六七八九十", 3_000);
    estimator.addCompletedSample("甲乙丙丁戊己庚辛壬癸", 3_100);
    estimator.addCompletedSample("春夏秋冬东南西北天地", 2_900);

    const result = estimator.estimate({
      transcript: "这是一个仍然正在生成的回答内容",
      generatedAudioMs: 4_000,
      safePlayedMs: 2_500,
      generationCompleted: false,
    });

    expect(result.strategy).toBe("estimated_prefix");
    expect(result.confidence).toBe("medium");
    expect(result.transcript.length).toBeGreaterThan(0);
    expect("这是一个仍然正在生成的回答内容".startsWith(result.transcript)).toBe(true);
  });

  it("rolls back when timing evidence is too weak", () => {
    const estimator = new SpeechPrefixEstimator();
    expect(
      estimator.estimate({
        transcript: "Too short",
        generatedAudioMs: 500,
        safePlayedMs: 200,
        generationCompleted: false,
      }),
    ).toMatchObject({ transcript: "", strategy: "rollback", confidence: "low" });
  });
});
