import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QwenConversationSuccessEvaluator,
  type SuccessEvaluationInput,
} from "../../src/server/conversations/conversation-success-evaluator";

const input: SuccessEvaluationInput = {
  locale: "zh",
  scenarioName: "需求发现",
  criteria: ["确认客户痛点", "约定下一步"],
  messages: [
    { turnIndex: 0, role: "user", text: "您现在最大的痛点是什么？" },
    { turnIndex: 1, role: "assistant", text: "线索转化效率太低。" },
    { turnIndex: 2, role: "user", text: "下周一我们一起评审改进方案。" },
    { turnIndex: 3, role: "assistant", text: "可以，我会参加。" },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function createEvaluator() {
  return new QwenConversationSuccessEvaluator({
    apiKey: "test-key",
    endpoint: "https://example.test/chat/completions",
    model: "qwen-plus",
    timeoutMs: 10_000,
  });
}

describe("QwenConversationSuccessEvaluator", () => {
  it("reports success only when every criterion has high-confidence evidence", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        criteria: [
          {
            criterionPosition: 0,
            completed: true,
            confidence: 0.97,
            evidenceTurnIndexes: [0, 1],
            rationale: "客户明确说出了痛点。",
          },
          {
            criterionPosition: 1,
            completed: true,
            confidence: 0.95,
            evidenceTurnIndexes: [2, 3],
            rationale: "双方明确约定了下一步。",
          },
        ],
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(createEvaluator().evaluate(input)).resolves.toMatchObject({
      allCriteriaCompleted: true,
      criteria: [{ completed: true }, { completed: true }],
    });
  });

  it("downgrades an uncertain criterion instead of suggesting session end", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        criteria: [
          {
            criterionPosition: 0,
            completed: true,
            confidence: 0.97,
            evidenceTurnIndexes: [0, 1],
            rationale: "客户明确说出了痛点。",
          },
          {
            criterionPosition: 1,
            completed: true,
            confidence: 0.72,
            evidenceTurnIndexes: [2],
            rationale: "用户提出了下一步，但客户尚未确认。",
          },
        ],
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(createEvaluator().evaluate(input)).resolves.toMatchObject({
      allCriteriaCompleted: false,
      criteria: [{ completed: true }, { completed: false }],
    });
  });
});
