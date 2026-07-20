import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FeedbackGenerationError,
  QwenConversationFeedbackGenerator,
  type FeedbackGenerationInput,
} from "../../src/server/conversations/conversation-feedback-generator";

const input: FeedbackGenerationInput = {
  locale: "zh",
  personaName: "Lin Yue",
  personaNameZhCn: "林悦",
  scenarioName: "Needs discovery",
  scenarioNameZhCn: "需求发现",
  difficulty: "medium",
  goals: ["Understand customer needs"],
  goalsZhCn: ["理解客户需求"],
  skillFocus: ["Open-ended questions"],
  skillFocusZhCn: ["开放式提问"],
  criteria: [{
    position: 0,
    name: "Needs discovery",
    nameZhCn: "需求发现",
    weight: 100,
  }],
  messages: [
    {
      id: 11,
      role: "user",
      text: "你们现在最大的挑战是什么？",
      interrupted: false,
    },
    {
      id: 12,
      role: "assistant",
      text: "目前最大的挑战是销售线索转化率偏低。",
      interrupted: false,
    },
  ],
};

const threeTurnInput: FeedbackGenerationInput = {
  ...input,
  messages: [
    ...input.messages,
    {
      id: 13,
      role: "user",
      text: "这个问题每周会造成多少时间损失？",
      interrupted: false,
    },
    {
      id: 14,
      role: "assistant",
      text: "团队每周大约浪费十个小时。",
      interrupted: false,
    },
    {
      id: 15,
      role: "user",
      text: "如果能解决，下一步需要谁参与评估？",
      interrupted: false,
    },
  ],
};

function generatedFeedbackWithMoments(momentCount: number) {
  const learnerMessages = threeTurnInput.messages.filter(
    ({ role }) => role === "user",
  );
  return {
    evaluationSubject: "learner_salesperson",
    overallAssessment: "The learner used a structured discovery approach.",
    overallAssessmentZhCn: "学员采用了结构化的需求探索方式。",
    strengths: [],
    improvementAreas: [],
    coachingTips: [],
    criterionScores: [{
      criterionPosition: 0,
      score: 80,
      rationale: "The learner explored the current problem and its impact.",
      rationaleZhCn: "学员探索了当前问题及其影响。",
    }],
    moments: learnerMessages.slice(0, momentCount).map((message, index) => ({
      messageId: message.id,
      speaker: "learner_salesperson",
      evidenceQuote: message.text,
      contextMessageId: null,
      contextQuote: "",
      kind: index === 0 ? "strength" as const : "improvement" as const,
      title: `Moment ${index + 1}`,
      titleZhCn: `关键时刻 ${index + 1}`,
      assessment: `This observation is grounded in learner turn ${index + 1}.`,
      assessmentZhCn: `这项观察基于学员的第 ${index + 1} 轮发言。`,
      suggestedApproach: index === 0 ? "" : "Ask one focused follow-up.",
      suggestedApproachZhCn: index === 0 ? "" : "进行一次聚焦追问。",
    })),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QwenConversationFeedbackGenerator", () => {
  it("requests structured JSON and parses a valid coaching response", async () => {
    const generated = {
      evaluationSubject: "learner_salesperson",
      overallAssessment: "The question was clear; next, quantify the impact.",
      overallAssessmentZhCn: "提问清晰，下一步应继续量化影响。",
      strengths: [{ text: "You used an open-ended question.", textZhCn: "使用了开放式问题。" }],
      improvementAreas: [{ text: "You have not quantified the business impact.", textZhCn: "还没有量化业务影响。" }],
      coachingTips: [
        { title: "Explore impact", titleZhCn: "追问影响", advice: "Ask about time, cost, and lost opportunities.", adviceZhCn: "询问耗时、成本和机会损失。" },
        { title: "Confirm understanding", titleZhCn: "确认理解", advice: "Restate the customer problem in one sentence.", adviceZhCn: "用一句话复述客户问题。" },
      ],
      criterionScores: [
        { criterionPosition: 0, score: 82, rationale: "The question aligns with the goal.", rationaleZhCn: "问题与目标一致。" },
      ],
      moments: [{
        messageId: 11,
        speaker: "learner_salesperson",
        evidenceQuote: "你们现在最大的挑战是什么？",
        contextMessageId: null,
        contextQuote: "",
        kind: "strength" as const,
        title: "Key moment 1",
        titleZhCn: "关键时刻 1",
        assessment: "The transcript provides clear evidence.",
        assessmentZhCn: "有明确的对话证据。",
        suggestedApproach: "",
        suggestedApproachZhCn: "",
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

    await expect(generator.generate(input)).resolves.toEqual({
      overallAssessment: generated.overallAssessment,
      overallAssessmentZhCn: generated.overallAssessmentZhCn,
      strengths: generated.strengths,
      improvementAreas: generated.improvementAreas,
      coachingTips: generated.coachingTips,
      criterionScores: generated.criterionScores,
      moments: [{
        messageId: 11,
        kind: "strength",
        title: "Key moment 1",
        titleZhCn: "关键时刻 1",
        assessment: "The transcript provides clear evidence.",
        assessmentZhCn: "有明确的对话证据。",
        suggestedApproach: "",
        suggestedApproachZhCn: "",
      }],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0];
    const init = request?.[1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(request?.[0]).toBe("https://example.test/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(body).toMatchObject({
      model: "qwen-plus",
      enable_thinking: false,
      max_completion_tokens: 8_000,
      response_format: { type: "json_object" },
    });
    expect(JSON.stringify(body)).toContain("untrusted evidence");
    expect(JSON.stringify(body)).toContain("你们现在最大的挑战是什么？");
    expect(JSON.stringify(body)).toContain("allowedLearnerMessageIds");
    const prompt = JSON.parse(
      (body.messages as Array<{ content: string }>)[1]?.content ?? "{}",
    ) as {
      constraints?: {
        allowedLearnerMessageIds?: number[];
        bilingualOutput?: string;
        moments?: string;
      };
      participantContract?: Record<string, string>;
      transcript?: Array<{ messageId: number; speaker: string }>;
    };
    expect(prompt.constraints?.allowedLearnerMessageIds).toEqual([11]);
    expect(prompt.constraints?.bilingualOutput).toContain(
      "one shared evaluation",
    );
    expect(prompt.constraints?.moments).toContain("Return 0-1 highlights");
    expect(prompt.participantContract?.learner_salesperson).toContain(
      "only participant you evaluate",
    );
    expect(prompt.transcript).toEqual([
      expect.objectContaining({
        messageId: 11,
        speaker: "learner_salesperson",
      }),
      expect.objectContaining({ messageId: 12, speaker: "ai_customer" }),
    ]);
  });

  it("generates a textual assessment with no criterion scores for an empty rubric", async () => {
    const generated = {
      evaluationSubject: "learner_salesperson",
      overallAssessment: "The learner made a clear start.",
      overallAssessmentZhCn: "学员做出了清晰的开场。",
      strengths: [],
      improvementAreas: [],
      coachingTips: [],
      criterionScores: [],
      moments: [],
    };
    const fetchMock = vi.fn(async (
      _requestInput: string | URL | Request,
      _requestInit?: RequestInit,
    ) => {
      void _requestInput;
      void _requestInit;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(generated) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const generator = new QwenConversationFeedbackGenerator({
      apiKey: "test-key",
      endpoint: "https://example.test/chat/completions",
      model: "qwen-plus",
      timeoutMs: 10_000,
    });

    await expect(generator.generate({ ...input, criteria: [] })).resolves.toMatchObject({
      overallAssessment: generated.overallAssessment,
      criterionScores: [],
    });
    const requestBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { messages: Array<{ content: string }> };
    const prompt = JSON.parse(requestBody.messages[1]?.content ?? "{}") as {
      constraints?: { expectedCriterionPositions?: number[] };
    };
    expect(prompt.constraints?.expectedCriterionPositions).toEqual([]);
  });

  it("retries until a conversation with enough learner turns has at least three valid moments", async () => {
    let requestCount = 0;
    const fetchMock = vi.fn(
      async (requestInput: string | URL | Request, requestInit?: RequestInit) => {
        void requestInput;
        void requestInit;
        requestCount += 1;
        const generated = generatedFeedbackWithMoments(
          requestCount === 1 ? 2 : 3,
        );
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

    await expect(generator.generate(threeTurnInput)).resolves.toMatchObject({
      moments: expect.arrayContaining([
        expect.objectContaining({ messageId: 11 }),
        expect.objectContaining({ messageId: 13 }),
        expect.objectContaining({ messageId: 15 }),
      ]),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { messages: Array<{ content: string }> };
    const firstPrompt = JSON.parse(firstBody.messages[1]?.content ?? "{}") as {
      constraints?: { moments?: string };
    };
    expect(firstPrompt.constraints?.moments).toContain(
      "Return 3-3 valid highlights",
    );

    const retryBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as { messages: Array<{ content: string }> };
    const retryPrompt = JSON.parse(retryBody.messages[1]?.content ?? "{}") as {
      retryCorrection?: string;
    };
    expect(retryPrompt.retryCorrection).toContain(
      "at least 3 are required",
    );
  });

  it("drops an invalid highlight link without retrying or losing the core report", async () => {
    const valid = {
      evaluationSubject: "learner_salesperson",
      overallAssessment: "The question was clear.",
      overallAssessmentZhCn: "提问清晰。",
      strengths: [{ text: "The question was specific.", textZhCn: "问题明确。" }],
      improvementAreas: [{ text: "Continue probing.", textZhCn: "可以继续追问。" }],
      coachingTips: [
        { title: "Probe", titleZhCn: "追问", advice: "Explore the impact.", adviceZhCn: "追问影响。" },
        { title: "Confirm", titleZhCn: "确认", advice: "Confirm your understanding.", adviceZhCn: "确认理解。" },
      ],
      criterionScores: [
        { criterionPosition: 0, score: 80, rationale: "It aligns with the goal.", rationaleZhCn: "与目标一致。" },
      ],
      moments: [{
        messageId: 1,
        speaker: "learner_salesperson",
        evidenceQuote: "有证据",
        contextMessageId: null,
        contextQuote: "",
        kind: "improvement" as const,
        title: "Invalid reference",
        titleZhCn: "无效引用",
        assessment: "There is evidence.",
        assessmentZhCn: "有证据。",
        suggestedApproach: "Continue probing.",
        suggestedApproachZhCn: "继续追问。",
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

  it("drops a highlight whose quoted evidence belongs to the AI customer", async () => {
    const generated = {
      evaluationSubject: "learner_salesperson",
      overallAssessment: "The salesperson asked an open-ended question.",
      overallAssessmentZhCn: "销售提出了一个开放式问题。",
      strengths: [{ text: "The question had a clear direction.", textZhCn: "问题方向清晰。" }],
      improvementAreas: [],
      coachingTips: [],
      criterionScores: [
        { criterionPosition: 0, score: 75, rationale: "The salesperson began exploring needs.", rationaleZhCn: "销售开始探索需求。" },
      ],
      moments: [{
        messageId: 11,
        speaker: "learner_salesperson",
        evidenceQuote: "目前最大的挑战是销售线索转化率偏低。",
        contextMessageId: null,
        contextQuote: "",
        kind: "strength" as const,
        title: "Incorrect attribution",
        titleZhCn: "错误归因",
        assessment: "The customer quote was incorrectly attributed to the salesperson.",
        assessmentZhCn: "错误地把客户原话归给了销售。",
        suggestedApproach: "",
        suggestedApproachZhCn: "",
      }],
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

  it("drops a highlight that uses a future AI reply as learner context", async () => {
    const generated = {
      evaluationSubject: "learner_salesperson",
      overallAssessment: "The salesperson asked an open-ended question.",
      overallAssessmentZhCn: "销售提出了一个开放式问题。",
      strengths: [{ text: "The question had a clear direction.", textZhCn: "问题方向清晰。" }],
      improvementAreas: [],
      coachingTips: [],
      criterionScores: [
        { criterionPosition: 0, score: 75, rationale: "The question relates to the goal.", rationaleZhCn: "提问与目标有关。" },
      ],
      moments: [{
        messageId: 11,
        speaker: "learner_salesperson",
        evidenceQuote: "你们现在最大的挑战是什么？",
        contextMessageId: null,
        contextQuote: "",
        kind: "improvement" as const,
        title: "Incorrect use of future information",
        titleZhCn: "错误使用未来信息",
        assessment:
          "The assessment incorrectly uses message ID 12, which comes later.",
        assessmentZhCn:
          "客户在第12条已经说明销售线索转化率偏低，销售仍重复询问。",
        suggestedApproach: "Continue probing.",
        suggestedApproachZhCn: "继续追问。",
      }],
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
      moments: [],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a report that declares the AI customer as its evaluation subject", async () => {
    const generated = {
      evaluationSubject: "ai_customer",
      overallAssessment: "This incorrectly evaluates the AI customer.",
      overallAssessmentZhCn: "错误地评价了 AI 客户。",
      strengths: [],
      improvementAreas: [],
      coachingTips: [],
      criterionScores: [
        { criterionPosition: 0, score: 70, rationale: "The subject is incorrect.", rationaleZhCn: "对象错误。" },
      ],
      moments: [],
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

    await expect(generator.generate(input)).rejects.toMatchObject({
      code: "feedback_invalid_output",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects internal participant labels in user-visible feedback", async () => {
    const generated = {
      evaluationSubject: "learner_salesperson",
      overallAssessment: "learner_salesperson asked in the right direction.",
      overallAssessmentZhCn: "learner_salesperson 的提问方向正确。",
      strengths: [],
      improvementAreas: [],
      coachingTips: [],
      criterionScores: [
        { criterionPosition: 0, score: 70, rationale: "You can explore further.", rationaleZhCn: "可以继续深入。" },
      ],
      moments: [],
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

    await expect(generator.generate(input)).rejects.toMatchObject({
      code: "feedback_invalid_output",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the useful review when the optional highlights have an invalid shape", async () => {
    const generated = {
      evaluationSubject: "learner_salesperson",
      overallAssessment: "The core assessment remains valid.",
      overallAssessmentZhCn: "主体评价仍然有效。",
      strengths: [{ text: "The question was specific.", textZhCn: "问题明确。" }],
      improvementAreas: [{ text: "Continue probing.", textZhCn: "可以继续追问。" }],
      coachingTips: [
        { title: "Probe", titleZhCn: "追问", advice: "Explore the impact.", adviceZhCn: "追问影响。" },
        { title: "Confirm", titleZhCn: "确认", advice: "Confirm your understanding.", adviceZhCn: "确认理解。" },
      ],
      criterionScores: [
        { criterionPosition: 0, score: 80, rationale: "It aligns with the goal.", rationaleZhCn: "与目标一致。" },
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
