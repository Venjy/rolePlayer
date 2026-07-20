import { describe, expect, it } from "vitest";
import {
  formatFeedbackDuration,
  getFeedbackFailurePresentation,
} from "../../src/client/conversations/feedback-presentation";

describe("feedback presentation", () => {
  it("formats the same duration in both supported locales", () => {
    expect(formatFeedbackDuration(533, "en")).toBe("8m 53s");
    expect(formatFeedbackDuration(533, "zh")).toBe("8 分 53 秒");
  });

  it("preserves the technical detail for a categorized model failure", () => {
    expect(
      getFeedbackFailurePresentation(
        "feedback_model_timeout",
        "The feedback model request timed out.",
        "en",
        4,
      ),
    ).toEqual({
      title: "Feedback model timed out",
      description:
        "The model did not respond within the configured time. Check service latency or increase the timeout, then retry.",
      retryable: true,
      technicalDetail: "The feedback model request timed out.",
    });
  });

  it("keeps an empty learner transcript non-retryable", () => {
    expect(
      getFeedbackFailurePresentation(
        "feedback_insufficient_conversation",
        null,
        "zh",
        0,
      ),
    ).toMatchObject({
      title: "对话内容不足",
      retryable: false,
    });
  });
});
