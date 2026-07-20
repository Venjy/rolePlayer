import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PersonaInput,
  RolePlayCatalog,
} from "../../src/shared/role-play-catalog";
import {
  CatalogDraftGenerationError,
  QwenCatalogDraftGenerator,
} from "../../src/server/catalog/catalog-draft-generator";
import { initializeCatalogData } from "../../src/server/catalog/catalog-initializer";
import { CatalogRepository } from "../../src/server/catalog/catalog-repository";
import { ApplicationDatabase } from "../../src/server/database/database";
import { CATALOG_DATABASE_MIGRATIONS } from "../../src/server/database/split-database-migrations";

afterEach(() => {
  vi.unstubAllGlobals();
});

function createCatalog(): RolePlayCatalog {
  const database = new ApplicationDatabase({
    path: ":memory:",
    migrations: CATALOG_DATABASE_MIGRATIONS,
  });
  database.open();
  try {
    initializeCatalogData(database);
    return new CatalogRepository(database).listCatalog();
  } finally {
    database.close();
  }
}

function optionId(
  catalog: RolePlayCatalog,
  category: string,
  index = 0,
): number {
  const option = [...catalog.personaPresets, ...catalog.scenarioPresets]
    .filter((candidate) => candidate.category === category)[index];
  if (!option) throw new Error(`Missing ${category} test option at ${index}.`);
  return option.id;
}

function validPersona(catalog: RolePlayCatalog): PersonaInput {
  return {
    name: "Jordan Lee",
    nameZhCn: "李乔丹",
    gender: "female",
    age: 37,
    occupationPresetId: optionId(catalog, "occupation", 3),
    background:
      "Jordan leads finance at a multi-site services business. Reporting is fragmented and month-end close takes too long. A prior transformation missed its adoption target, so she needs a credible business case and rollout plan before approving another investment.",
    backgroundZhCn:
      "李乔丹负责一家多网点服务企业的财务工作。目前报表数据分散，月末结账耗时过长。此前一次转型没有达到使用率目标，因此她需要看到可信的商业论证和上线计划，才会批准新的投入。",
    personalityTraitPresetIds: [
      optionId(catalog, "personality_trait", 0),
      optionId(catalog, "personality_trait", 4),
    ],
    communicationStylePresetId: optionId(
      catalog,
      "communication_style",
      0,
    ),
    behaviorNotes:
      "Ask for baseline metrics when claims are vague. Reveal the failed project only after focused follow-up questions. Become more cooperative when risks, owners, and milestones are explicit.",
    behaviorNotesZhCn:
      "当说法含糊时会追问现状基线。只有经过有针对性的追问才透露失败项目。若风险、责任人和里程碑明确，则会更愿意合作。",
    motivationPresetIds: [
      optionId(catalog, "motivation", 0),
      optionId(catalog, "motivation", 2),
    ],
    concernPresetIds: [
      optionId(catalog, "concern", 1),
      optionId(catalog, "concern", 2),
    ],
    voice: "longanlingxin",
  };
}

function validScenarioModelOutput(catalog: RolePlayCatalog) {
  return {
    name: "Implementation risk review",
    nameZhCn: "实施风险评估",
    description:
      "The buyer needs to replace a fragmented process before peak season. A previous rollout was delayed and adoption remained low. Operations and IT disagree about ownership, while finance requires a measurable payback case. The learner must uncover the implementation constraints, align stakeholders, and agree on a controlled next step.",
    descriptionZhCn:
      "客户需要在旺季前替换割裂的业务流程。此前一次上线曾经延期，最终使用率也很低。运营和 IT 对责任归属存在分歧，同时财务要求提供可量化的回报依据。学员需要发现实施限制、推动相关方对齐，并达成一个可控的下一步。",
    trainingGoalPresetIds: [optionId(catalog, "training_goal", 0)],
    skillFocusPresetIds: [
      optionId(catalog, "skill_focus", 0),
      optionId(catalog, "skill_focus", 1),
    ],
    successCriterionPresetIds: [0, 1, 2].map((index) =>
      optionId(catalog, "success_criterion", index),
    ),
    toneStylePresetId: optionId(catalog, "tone_style", 0),
    voiceBehavior: {
      interruptFrequency: "medium" as const,
      speakingPace: "normal" as const,
    },
  };
}

function configuredGenerator(): QwenCatalogDraftGenerator {
  return new QwenCatalogDraftGenerator({
    apiKey: "test-key",
    endpoint: "https://example.test/chat/completions",
    model: "qwen-plus",
    timeoutMs: 10_000,
  });
}

function completion(value: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("QwenCatalogDraftGenerator", () => {
  it("sends every bilingual persona option and returns a validated draft", async () => {
    const catalog = createCatalog();
    const generated = validPersona(catalog);
    const fetchMock = vi.fn(async (
      _requestInput: string | URL | Request,
      _requestInit?: RequestInit,
    ) => {
      void _requestInput;
      void _requestInit;
      return completion(generated);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(configuredGenerator().generatePersona(catalog)).resolves.toEqual(
      generated,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { temperature: number; messages: Array<{ content: string }> };
    const prompt = requestBody.messages[1]?.content ?? "";
    const promptObject = JSON.parse(prompt) as {
      creativeVariation?: {
        token?: number;
        appliesOnlyTo?: string[];
      };
      rules?: string[];
    };
    expect(requestBody.temperature).toBe(0.9);
    expect(Number.isInteger(promptObject.creativeVariation?.token)).toBe(true);
    expect(promptObject.creativeVariation?.appliesOnlyTo).toEqual([
      "name",
      "nameZhCn",
      "background",
      "backgroundZhCn",
    ]);
    expect(promptObject.rules?.join(" ")).toContain(
      "strong creative variation only for name",
    );
    expect(promptObject.rules?.join(" ")).toContain(
      "keep the existing coherence-first selection behavior",
    );
    expect(prompt).toContain("Restaurant Owner");
    expect(prompt).toContain("餐馆老板");
    expect(prompt).toContain("longanlingxin");
    expect(prompt).toContain("Simplified Chinese");
  });

  it("does not send a blank persona draft to the model", async () => {
    const catalog = createCatalog();
    const fetchMock = vi.fn(async (
      _requestInput: string | URL | Request,
      _requestInit?: RequestInit,
    ) => {
      void _requestInput;
      void _requestInit;
      return completion(validPersona(catalog));
    });
    vi.stubGlobal("fetch", fetchMock);

    await configuredGenerator().generatePersona(catalog, {
      name: " ",
      gender: "unspecified",
      age: null,
      personalityTraitPresetIds: [],
      motivationPresetIds: [],
    });

    const requestBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { messages: Array<{ content: string }> };
    const prompt = JSON.parse(requestBody.messages[1]?.content ?? "{}") as {
      currentDraft?: unknown;
    };
    expect(prompt.currentDraft).toBeUndefined();
  });

  it("retries when gender and voice are inconsistent", async () => {
    const catalog = createCatalog();
    const valid = { ...validPersona(catalog), gender: "male" as const, voice: "longanlufeng" as const };
    const invalid = { ...valid, voice: "longanlingxin" as const };
    let call = 0;
    const fetchMock = vi.fn(async (
      _requestInput: string | URL | Request,
      _requestInit?: RequestInit,
    ) => {
      void _requestInput;
      void _requestInit;
      return completion(call++ === 0 ? invalid : valid);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(configuredGenerator().generatePersona(catalog)).resolves.toEqual(
      valid,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as { messages: Array<{ content: string }> };
    const firstBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { messages: Array<{ content: string }> };
    const firstPrompt = JSON.parse(firstBody.messages[1]?.content ?? "{}") as {
      creativeVariation?: { token?: number };
    };
    const retryPrompt = JSON.parse(retryBody.messages[1]?.content ?? "{}") as {
      creativeVariation?: { token?: number };
    };
    expect(retryPrompt.creativeVariation?.token).toBe(
      firstPrompt.creativeVariation?.token,
    );
    expect(retryBody.messages[1]?.content).toContain("supports female");
  });

  it("excludes persisted and current persona names and backgrounds", async () => {
    const catalog = createCatalog();
    const valid = validPersona(catalog);
    const currentDraft = {
      ...valid,
      name: "Morgan Chen",
      nameZhCn: "陈墨",
      background:
        "Morgan owns revenue operations at a software distributor with a stalled CRM consolidation project.",
      backgroundZhCn:
        "陈墨负责一家软件分销商的营收运营，目前 CRM 整合项目陷入停滞。",
    };
    const duplicateName = {
      ...valid,
      name: currentDraft.name,
      nameZhCn: "李乔丹",
    };
    const duplicateBackground = {
      ...valid,
      background: currentDraft.background,
    };
    let call = 0;
    const fetchMock = vi.fn(async (
      _requestInput: string | URL | Request,
      _requestInit?: RequestInit,
    ) => {
      void _requestInput;
      void _requestInit;
      return completion([duplicateName, duplicateBackground, valid][call++]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      configuredGenerator().generatePersona(catalog, currentDraft),
    ).resolves.toEqual(valid);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstRequest = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { messages: Array<{ content: string }> };
    const prompt = firstRequest.messages[1]?.content ?? "";
    expect(prompt).toContain(catalog.personas[0]?.background);
    expect(prompt).toContain(currentDraft.name);
    expect(prompt).toContain(currentDraft.background);
    const thirdRequest = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body),
    ) as { messages: Array<{ content: string }> };
    expect(thirdRequest.messages[1]?.content).toContain(
      "persona background duplicates",
    );
  });

  it("builds scenario weights itself and never asks the model to bind personas", async () => {
    const catalog = createCatalog();
    const generated = validScenarioModelOutput(catalog);
    const criteria = generated.successCriterionPresetIds;
    const fetchMock = vi.fn(async (
      _requestInput: string | URL | Request,
      _requestInit?: RequestInit,
    ) => {
      void _requestInput;
      void _requestInit;
      return completion(generated);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(configuredGenerator().generateScenario(catalog)).resolves.toMatchObject({
      ...generated,
      scoringCriteria: [
        { successCriterionPresetId: criteria[0], weight: 33 },
        { successCriterionPresetId: criteria[1], weight: 33 },
        { successCriterionPresetId: criteria[2], weight: 34 },
      ],
      allowedPersonaIds: catalog.personas.map(({ id }) => id),
    });
    const requestBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { temperature: number; messages: Array<{ content: string }> };
    const prompt = requestBody.messages[1]?.content ?? "{}";
    const promptObject = JSON.parse(prompt) as {
      creativeVariation?: {
        token?: number;
        appliesOnlyTo?: string[];
      };
      rules?: string[];
    };
    expect(requestBody.temperature).toBe(0.9);
    expect(Number.isInteger(promptObject.creativeVariation?.token)).toBe(true);
    expect(promptObject.creativeVariation?.appliesOnlyTo).toEqual([
      "name",
      "nameZhCn",
      "description",
      "descriptionZhCn",
    ]);
    expect(promptObject.rules?.join(" ")).toContain(
      "strong creative variation only for name",
    );
    expect(promptObject.rules?.join(" ")).toContain(
      "keep the existing coherence-first selection behavior",
    );
    expect(prompt).toContain("Do not create a persona");
  });

  it("does not send a blank scenario draft to the model", async () => {
    const catalog = createCatalog();
    const fetchMock = vi.fn(async (
      _requestInput: string | URL | Request,
      _requestInit?: RequestInit,
    ) => {
      void _requestInput;
      void _requestInit;
      return completion(validScenarioModelOutput(catalog));
    });
    vi.stubGlobal("fetch", fetchMock);

    await configuredGenerator().generateScenario(catalog, {
      name: "",
      description: " ",
      trainingGoalPresetIds: [],
      skillFocusPresetIds: [],
      successCriterionPresetIds: [],
      voiceBehavior: {},
    });

    const requestBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { messages: Array<{ content: string }> };
    const prompt = JSON.parse(requestBody.messages[1]?.content ?? "{}") as {
      currentDraft?: unknown;
    };
    expect(prompt.currentDraft).toBeUndefined();
  });

  it("excludes persisted and current scenario names and descriptions", async () => {
    const catalog = createCatalog();
    const valid = validScenarioModelOutput(catalog);
    const currentDraft = {
      ...valid,
      name: "Security review escalation",
      nameZhCn: "安全评审升级",
      description:
        "The buyer has paused procurement after security requested a new data-residency review and evidence from two reference customers.",
      descriptionZhCn:
        "安全团队要求重新评估数据驻留并补充两家客户案例后，客户暂停了采购流程。",
    };
    const duplicateDescription = {
      ...valid,
      descriptionZhCn: currentDraft.descriptionZhCn,
    };
    let call = 0;
    const fetchMock = vi.fn(async (
      _requestInput: string | URL | Request,
      _requestInit?: RequestInit,
    ) => {
      void _requestInput;
      void _requestInit;
      return completion(call++ === 0 ? duplicateDescription : valid);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      configuredGenerator().generateScenario(catalog, currentDraft),
    ).resolves.toMatchObject(valid);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { messages: Array<{ content: string }> };
    const prompt = firstRequest.messages[1]?.content ?? "";
    expect(prompt).toContain(catalog.scenarios[0]?.description);
    expect(prompt).toContain(currentDraft.name);
    expect(prompt).toContain(currentDraft.descriptionZhCn);
    const retryRequest = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as { messages: Array<{ content: string }> };
    expect(retryRequest.messages[1]?.content).toContain(
      "scenario description duplicates",
    );
  });

  it("rejects invented preset IDs after exhausting validation retries", async () => {
    const catalog = createCatalog();
    const invalid = { ...validPersona(catalog), occupationPresetId: 999_999 };
    const fetchMock = vi.fn(async (
      _requestInput: string | URL | Request,
      _requestInit?: RequestInit,
    ) => {
      void _requestInput;
      void _requestInit;
      return completion(invalid);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(configuredGenerator().generatePersona(catalog)).rejects.toMatchObject({
      code: "catalog_generation_invalid_output",
      name: CatalogDraftGenerationError.name,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
