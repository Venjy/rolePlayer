import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FeedbackGenerationError,
  QwenConversationFeedbackGenerator,
  type FeedbackGenerationInput,
} from "../../src/server/conversations/conversation-feedback-generator";

const input: FeedbackGenerationInput = {
  locale: "zh",
  personaName: "林悦",
  scenarioName: "需求发现",
  difficulty: "medium",
  goals: ["理解客户需求"],
  skillFocus: ["开放式提问"],
  criteria: [{ position: 0, name: "需求发现", weight: 100 }],
  messages: [
    {
      id: 11,
      role: "user",
      text: "你们现在最大的挑战是什么？",
      interrupted: false,
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QwenConversationFeedbackGenerator", () => {
  it("requests structured JSON and parses a valid coaching response", async () => {
    const generated = {
      overallAssessment: "提问清晰，下一步应继续量化影响。",
      strengths: ["使用了开放式问题。"],
      improvementAreas: ["还没有量化业务影响。"],
      coachingTips: [
        { title: "追问影响", advice: "询问耗时、成本和机会损失。" },
        { title: "确认理解", advice: "用一句话复述客户问题。" },
      ],
      criterionScores: [
        { criterionPosition: 0, score: 82, rationale: "问题与目标一致。" },
      ],
      moments: [{
        messageId: 11,
        kind: "strength" as const,
        title: "关键时刻 1",
        assessment: "有明确的对话证据。",
        suggestedApproach: "",
      }],
    };
    const fetchMock = vi.fn(
      async (requestInput: string | URL | Request, requestInit?: RequestInit) => {
        void requestInput;
        void requestInit;
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(generated) } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const generator = new QwenConversationFeedbackGenerator({
      apiKey: "test-key",
      endpoint: "https://example.test/chat/completions",
      model: "qwen-plus",
      timeoutMs: 10_000,
    });

    await expect(generator.generate(input)).resolves.toEqual(generated);
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0];
    const init = request?.[1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(request?.[0]).toBe("https://example.test/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(body).toMatchObject({
      model: "qwen-plus",
      enable_thinking: false,
      response_format: { type: "json_object" },
    });
    expect(JSON.stringify(body)).toContain("untrusted evidence");
    expect(JSON.stringify(body)).toContain("你们现在最大的挑战是什么？");
    expect(JSON.stringify(body)).toContain("allowedUserMessageIds");
    const prompt = JSON.parse(
      (body.messages as Array<{ content: string }>)[1]?.content ?? "{}",
    ) as {
      constraints?: {
        allowedUserMessageIds?: number[];
        moments?: string;
      };
    };
    expect(prompt.constraints?.allowedUserMessageIds).toEqual([11]);
    expect(prompt.constraints?.moments).toContain("Return 0-1 highlights");
  });

  it("drops an invalid highlight link without retrying or losing the core report", async () => {
    const valid = {
      overallAssessment: "提问清晰。",
      strengths: ["问题明确。"],
      improvementAreas: ["可以继续追问。"],
      coachingTips: [
        { title: "追问", advice: "追问影响。" },
        { title: "确认", advice: "确认理解。" },
      ],
      criterionScores: [
        { criterionPosition: 0, score: 80, rationale: "与目标一致。" },
      ],
      moments: [{
        messageId: 1,
        kind: "improvement" as const,
        title: "无效引用",
        assessment: "有证据。",
        suggestedApproach: "继续追问。",
      }],
    };
    const fetchMock = vi.fn(
      async (_requestInput: string | URL | Request, _requestInit?: RequestInit) => {
        void _requestInput;
        void _requestInit;
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(valid) } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const generator = new QwenConversationFeedbackGenerator({
      apiKey: "test-key",
      endpoint: "https://example.test/chat/completions",
      model: "qwen-plus",
      timeoutMs: 10_000,
    });

    await expect(generator.generate(input)).resolves.toMatchObject({
      overallAssessment: valid.overallAssessment,
      criterionScores: valid.criterionScores,
      moments: [],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps the useful review when the optional highlights have an invalid shape", async () => {
    const generated = {
      overallAssessment: "主体评价仍然有效。",
      strengths: ["问题明确。"],
      improvementAreas: ["可以继续追问。"],
      coachingTips: [
        { title: "追问", advice: "追问影响。" },
        { title: "确认", advice: "确认理解。" },
      ],
      criterionScores: [
        { criterionPosition: 0, score: 80, rationale: "与目标一致。" },
      ],
      moments: "not-an-array",
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(generated) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const generator = new QwenConversationFeedbackGenerator({
      apiKey: "test-key",
      endpoint: "https://example.test/chat/completions",
      model: "qwen-plus",
      timeoutMs: 10_000,
    });

    await expect(generator.generate(input)).resolves.toMatchObject({
      overallAssessment: generated.overallAssessment,
      criterionScores: generated.criterionScores,
      moments: [],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("classifies malformed model JSON as retryable invalid output", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "not-json" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const generator = new QwenConversationFeedbackGenerator({
      apiKey: "test-key",
      endpoint: "https://example.test/chat/completions",
      model: "qwen-plus",
      timeoutMs: 10_000,
    });

    await expect(generator.generate(input)).rejects.toMatchObject({
      code: "feedback_invalid_output",
      name: FeedbackGenerationError.name,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("distinguishes provider HTTP errors from invalid generated content", async () => {
    vi.stubGlobal("fetch", async () => new Response("rate limited", {
      status: 429,
      statusText: "Too Many Requests",
    }));
    const generator = new QwenConversationFeedbackGenerator({
      apiKey: "test-key",
      endpoint: "https://example.test/chat/completions",
      model: "qwen-plus",
      timeoutMs: 10_000,
    });

    await expect(generator.generate(input)).rejects.toMatchObject({
      code: "feedback_model_http_error",
      message: expect.stringContaining("HTTP 429"),
    });
  });

  it("classifies a network failure as an unreachable model", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const generator = new QwenConversationFeedbackGenerator({
      apiKey: "test-key",
      endpoint: "https://example.test/chat/completions",
      model: "qwen-plus",
      timeoutMs: 10_000,
    });

    await expect(generator.generate(input)).rejects.toMatchObject({
      code: "feedback_model_unreachable",
      message: expect.stringContaining("fetch failed"),
    });
  });

  it("classifies an aborted local deadline as a model timeout", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", async (
        _requestInput: string | URL | Request,
        requestInit?: RequestInit,
      ) => new Promise<Response>((_resolve, reject) => {
        requestInit?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }));
      const generator = new QwenConversationFeedbackGenerator({
        apiKey: "test-key",
        endpoint: "https://example.test/chat/completions",
        model: "qwen-plus",
        timeoutMs: 50,
      });

      const expectation = expect(generator.generate(input)).rejects.toMatchObject({
        code: "feedback_model_timeout",
      });
      await vi.advanceTimersByTimeAsync(51);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
