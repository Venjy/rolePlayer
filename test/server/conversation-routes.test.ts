import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  conversationFeedbackViewSchema,
} from "../../src/shared/conversation-feedback";
import {
  conversationDetailSchema,
  conversationListSchema,
  type CreateConversationInput,
  type PersonaSnapshot,
  type ScenarioSnapshot,
} from "../../src/shared/conversation-history";
import type { Persona, Scenario } from "../../src/shared/role-play-catalog";
import { compileRolePlayInstructions } from "../../src/shared/role-play-instructions";
import { CatalogRepository } from "../../src/server/catalog/catalog-repository";
import { initializeCatalogData } from "../../src/server/catalog/catalog-initializer";
import {
  ConversationEndedError,
  ConversationNotFoundError,
  ConversationPausedError,
  ConversationRepository,
} from "../../src/server/conversations/conversation-repository";
import type {
  ConversationFeedbackGenerator,
  FeedbackGenerationInput,
} from "../../src/server/conversations/conversation-feedback-generator";
import {
  registerConversationRoutes,
  type ConversationRouteOptions,
} from "../../src/server/conversations/conversation-routes";
import { FEEDBACK_PROMPT_VERSION } from "../../src/server/conversations/conversation-feedback-service";
import { registerDatabases } from "../../src/server/database/register-database";
import {
  localizePersona,
  localizeScenario,
} from "../../src/shared/role-play-localization";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createApp(options?: ConversationRouteOptions) {
  const directory = mkdtempSync(join(tmpdir(), "role-player-conversations-"));
  temporaryDirectories.push(directory);

  return createAppAtPath(join(directory, "conversations.sqlite"), options);
}

function createAppAtPath(path: string, options?: ConversationRouteOptions) {
  const app = Fastify({ logger: false });
  registerDatabases(app, {
    catalogPath: join(dirname(path), "catalog.sqlite"),
    conversationPath: path,
  });
  registerConversationRoutes(app, options);
  return app;
}

type TestCreateInput = CreateConversationInput & {
  persona: Persona;
  scenario: Scenario;
};

function getCreateInput(app: ReturnType<typeof createApp>): TestCreateInput {
  initializeCatalogData(app.catalogDatabase);
  const catalog = new CatalogRepository(app.catalogDatabase);
  const initialized = catalog.listCatalog();
  const persona = initialized.personas.find(({ name }) => name === "Alex");
  const scenario = initialized.scenarios.find(
    ({ name }) => name === "Business needs discovery",
  );
  if (!persona || !scenario) {
    throw new Error("The initialized starter catalog is missing.");
  }

  return {
    personaId: persona.id,
    scenarioId: scenario.id,
    persona,
    scenario,
    difficulty: "hard",
    locale: "en",
  };
}

function toPersonaSnapshot(persona: Persona): PersonaSnapshot {
  return {
    id: persona.id,
    name: persona.name,
    nameZhCn: persona.nameZhCn,
    gender: persona.gender,
    age: persona.age,
    occupation: persona.occupation,
    occupationZhCn: persona.occupationZhCn,
    background: persona.background,
    backgroundZhCn: persona.backgroundZhCn,
    personalityTraits: persona.personalityTraits,
    personalityTraitsZhCn: persona.personalityTraitsZhCn,
    communicationStyle: persona.communicationStyle,
    communicationStyleZhCn: persona.communicationStyleZhCn,
    behaviorNotes: persona.behaviorNotes,
    behaviorNotesZhCn: persona.behaviorNotesZhCn,
    motivations: persona.motivations,
    motivationsZhCn: persona.motivationsZhCn,
    concerns: persona.concerns,
    concernsZhCn: persona.concernsZhCn,
    voice: persona.voice,
    createdAt: persona.createdAt,
    updatedAt: persona.updatedAt,
  };
}

function toScenarioSnapshot(scenario: Scenario): ScenarioSnapshot {
  return {
    id: scenario.id,
    name: scenario.name,
    nameZhCn: scenario.nameZhCn,
    description: scenario.description,
    descriptionZhCn: scenario.descriptionZhCn,
    goals: scenario.goals,
    goalsZhCn: scenario.goalsZhCn,
    suggestedSkillFocus: scenario.suggestedSkillFocus,
    suggestedSkillFocusZhCn: scenario.suggestedSkillFocusZhCn,
    successCriteria: scenario.successCriteria,
    successCriteriaZhCn: scenario.successCriteriaZhCn,
    toneStyle: scenario.toneStyle,
    toneStyleZhCn: scenario.toneStyleZhCn,
    voiceBehavior: scenario.voiceBehavior,
    scoringCriteria: scenario.scoringCriteria.map((criterion) => ({
      name: criterion.name,
      nameZhCn: criterion.nameZhCn,
      weight: criterion.weight,
    })),
    allowedPersonaIds: scenario.allowedPersonaIds,
    createdAt: scenario.createdAt,
    updatedAt: scenario.updatedAt,
  };
}

describe("conversation history routes", () => {
  it("excludes paused periods from the durable session duration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T01:00:00.000Z"));
    const app = createApp();
    try {
      await app.ready();
      const repository = new ConversationRepository(app.conversationDatabase);
      const conversation = repository.createConversation(getCreateInput(app));

      vi.advanceTimersByTime(5_000);
      const pausedResponse = await app.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/pause`,
      });
      expect(pausedResponse.statusCode).toBe(200);
      expect(conversationDetailSchema.parse(pausedResponse.json())).toMatchObject({
        id: conversation.id,
        activeDurationMs: 5_000,
        pausedAt: expect.any(String),
      });
      expect(() => repository.getRuntimeConversation(conversation.id)).toThrow(
        ConversationPausedError,
      );

      vi.advanceTimersByTime(60_000);
      expect(repository.getConversation(conversation.id)?.activeDurationMs).toBe(
        5_000,
      );

      const resumedResponse = await app.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/resume`,
      });
      expect(resumedResponse.statusCode).toBe(200);
      expect(conversationDetailSchema.parse(resumedResponse.json()).pausedAt)
        .toBeNull();

      vi.advanceTimersByTime(7_000);
      const ended = repository.endConversation(conversation.id);
      expect(ended.activeDurationMs).toBe(12_000);
      expect(ended.pausedAt).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("restarts an active conversation in place with its snapshot and no history", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T02:00:00.000Z"));
    const app = createApp();
    try {
      await app.ready();
      const repository = new ConversationRepository(app.conversationDatabase);
      const conversation = repository.createConversation(getCreateInput(app));
      repository.appendMessage({
        conversationId: conversation.id,
        role: "user",
        text: "Discard this attempt.",
        interrupted: false,
        sourceItemId: "restart-discarded-user",
        audio: {
          sampleRate: 16_000,
          pcm: createTonePcm(16_000, 120, 220),
        },
      });
      vi.advanceTimersByTime(3_000);
      repository.pauseConversation(conversation.id);
      vi.advanceTimersByTime(30_000);

      const response = await app.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/restart`,
      });
      expect(response.statusCode).toBe(200);
      const restarted = conversationDetailSchema.parse(response.json());
      expect(restarted).toMatchObject({
        id: conversation.id,
        persona: conversation.persona,
        scenario: conversation.scenario,
        difficulty: conversation.difficulty,
        messages: [],
        messageCount: 0,
        audioMessageCount: 0,
        activeDurationMs: 0,
        pausedAt: null,
        endedAt: null,
      });
      expect(restarted.createdAt).not.toBe(conversation.createdAt);
      expect(
        app.conversationDatabase.raw
          .prepare("SELECT COUNT(*) AS count FROM message_audio")
          .get(),
      ).toMatchObject({ count: 0 });

      repository.endConversation(conversation.id);
      const rejected = await app.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/restart`,
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json()).toMatchObject({
        error: { code: "conversation_ended" },
      });
    } finally {
      await app.close();
    }
  });

  it("restores conversations and messages after the database is reopened", async () => {
    const directory = mkdtempSync(join(tmpdir(), "role-player-reopen-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "conversations.sqlite");
    const firstApp = createAppAtPath(databasePath);
    let conversationId = 0;
    try {
      await firstApp.ready();
      const repository = new ConversationRepository(
        firstApp.conversationDatabase,
      );
      const conversation = repository.createConversation(
        getCreateInput(firstApp),
      );
      conversationId = conversation.id;
      repository.appendMessage({
        conversationId,
        role: "user",
        text: "Please keep this turn after restart.",
        interrupted: false,
        sourceItemId: "item_restart_user",
      });
    } finally {
      await firstApp.close();
    }

    const reopenedApp = createAppAtPath(databasePath);
    try {
      await reopenedApp.ready();
      const restored = new ConversationRepository(
        reopenedApp.conversationDatabase,
      ).getConversation(conversationId);
      expect(restored).toMatchObject({
        id: conversationId,
        messageCount: 1,
        messages: [
          {
            role: "user",
            text: "Please keep this turn after restart.",
            interrupted: false,
          },
        ],
      });
    } finally {
      await reopenedApp.close();
    }
  });

  it("creates an immutable catalog snapshot and compiles its runtime configuration", async () => {
    const app = createApp();
    try {
      await app.ready();
      const input = getCreateInput(app);
      const localizedInput = {
        ...input,
        persona: toPersonaSnapshot(localizePersona(input.persona, input.locale)),
        scenario: toScenarioSnapshot(localizeScenario(input.scenario, input.locale)),
      };
      const expectedInstructions = compileRolePlayInstructions(localizedInput);

      const response = await app.inject({
        method: "POST",
        url: "/api/conversations",
        payload: input,
      });

      expect(response.statusCode).toBe(201);
      const created = conversationDetailSchema.parse(response.json());
      expect(created).toMatchObject({
        personaName: input.persona.name,
        personaNameZhCn: input.persona.nameZhCn,
        scenarioName: input.scenario.name,
        scenarioNameZhCn: input.scenario.nameZhCn,
        difficulty: input.difficulty,
        locale: input.locale,
        messageCount: 0,
        lastMessagePreview: null,
        persona: toPersonaSnapshot(input.persona),
        scenario: toScenarioSnapshot(input.scenario),
        messages: [],
      });
      expect(created.createdAt).toBe(created.updatedAt);
      expect(created.createdAt).toMatch(/\+08:00$/);
      expect(app.conversationDatabase.raw.prepare(
        `SELECT name, name_zh_cn, occupation, occupation_zh_cn
         FROM persona_snapshots
         WHERE conversation_id = ?`,
      ).get(created.id)).toEqual({
        name: input.persona.name,
        name_zh_cn: input.persona.nameZhCn,
        occupation: input.persona.occupation,
        occupation_zh_cn: input.persona.occupationZhCn,
      });
      expect(app.conversationDatabase.raw.prepare(
        `SELECT name, name_zh_cn, description, description_zh_cn
         FROM scenario_snapshots
         WHERE conversation_id = ?`,
      ).get(created.id)).toEqual({
        name: input.scenario.name,
        name_zh_cn: input.scenario.nameZhCn,
        description: input.scenario.description,
        description_zh_cn: input.scenario.descriptionZhCn,
      });

      const repository = new ConversationRepository(app.conversationDatabase);
      const runtime = repository.getRuntimeConversation(created.id);
      if (!runtime) throw new Error("Created conversation was not persisted.");
      expect(runtime).toMatchObject({
        id: created.id,
        persona: localizedInput.persona,
        scenario: localizedInput.scenario,
        difficulty: input.difficulty,
        locale: input.locale,
        instructions: expectedInstructions,
        voice: input.persona.voice,
        messages: [],
      });

      app.catalogDatabase.raw
        .prepare(
          `UPDATE personas
           SET name = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          "Changed catalog persona",
          "2030-01-01T00:00:00.000Z",
          input.persona.id,
        );
      app.catalogDatabase.raw
        .prepare(
          `UPDATE persona_occupation_presets
           SET occupation = ?
           WHERE id = ?`,
        )
        .run(
          "A catalog occupation edited after the conversation started",
          input.persona.occupationPresetId,
        );
      app.catalogDatabase.raw
        .prepare(
          `UPDATE scenarios
           SET name = ?, description = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          "Changed catalog scenario",
          "A catalog scenario edited after the conversation started.",
          "2030-01-01T00:00:00.000Z",
          input.scenario.id,
        );

      const detailResponse = await app.inject({
        method: "GET",
        url: `/api/conversations/${created.id}`,
      });
      expect(detailResponse.statusCode).toBe(200);
      const restored = conversationDetailSchema.parse(detailResponse.json());
      expect(restored.persona).toEqual(toPersonaSnapshot(input.persona));
      expect(restored.scenario).toEqual(toScenarioSnapshot(input.scenario));

      const restoredRuntime = repository.getRuntimeConversation(created.id);
      expect(restoredRuntime?.instructions).toBe(expectedInstructions);
      expect(restoredRuntime?.voice).toBe(input.persona.voice);
    } finally {
      await app.close();
    }
  });

  it("compiles and stores the template selected by the submitted locale", async () => {
    const app = createApp();
    try {
      await app.ready();
      const input = { ...getCreateInput(app), locale: "zh" as const };
      const response = await app.inject({
        method: "POST",
        url: "/api/conversations",
        payload: input,
      });

      expect(response.statusCode).toBe(201);
      const created = conversationDetailSchema.parse(response.json());
      const runtime = new ConversationRepository(
        app.conversationDatabase,
      ).getRuntimeConversation(created.id);

      expect(created.locale).toBe("zh");
      expect(created.personaName).toBe(input.persona.name);
      expect(created.personaNameZhCn).toBe(input.persona.nameZhCn);
      expect(runtime?.instructions).toContain("[客户角色]");
      expect(runtime?.instructions).toContain("[销售训练场景]");
      expect(runtime?.instructions).toContain("难度: 困难");
      expect(runtime?.instructions).not.toContain("[CUSTOMER PERSONA]");
    } finally {
      await app.close();
    }
  });

  it("lists by latest activity and returns ordered, idempotently appended messages", async () => {
    const app = createApp();
    try {
      await app.ready();
      const input = getCreateInput(app);
      const firstResponse = await app.inject({
        method: "POST",
        url: "/api/conversations",
        payload: input,
      });
      const secondResponse = await app.inject({
        method: "POST",
        url: "/api/conversations",
        payload: { ...input, difficulty: "easy", locale: "zh" },
      });
      const first = conversationDetailSchema.parse(firstResponse.json());
      const second = conversationDetailSchema.parse(secondResponse.json());
      const repository = new ConversationRepository(app.conversationDatabase);

      const userMessage = repository.appendMessage({
        conversationId: first.id,
        role: "user",
        text: "What would make this worthwhile for your team?",
        interrupted: false,
        sourceItemId: "user-item-1",
      });
      const duplicateUserMessage = repository.appendMessage({
        conversationId: first.id,
        role: "user",
        text: "This retry must not replace the original transcript.",
        interrupted: true,
        sourceItemId: "user-item-1",
      });
      expect(duplicateUserMessage).toEqual(userMessage);

      const assistantMessage = repository.appendMessage({
        conversationId: first.id,
        role: "assistant",
        text: "Less manual qualification work would help, but adoption is a concern.",
        interrupted: true,
        responseId: "response-1",
      });
      const duplicateAssistantMessage = repository.appendMessage({
        conversationId: first.id,
        role: "assistant",
        text: "This response retry must not create another message.",
        interrupted: false,
        sourceItemId: "assistant-item-1",
        responseId: "response-1",
      });
      expect(duplicateAssistantMessage).toEqual(assistantMessage);
      expect(
        repository.appendMessage({
          conversationId: first.id,
          role: "assistant",
          text: "A later item-only retry must remain idempotent.",
          interrupted: false,
          sourceItemId: "assistant-item-1",
        }),
      ).toEqual(assistantMessage);

      const detailResponse = await app.inject({
        method: "GET",
        url: `/api/conversations/${first.id}`,
      });
      expect(detailResponse.statusCode).toBe(200);
      const detail = conversationDetailSchema.parse(detailResponse.json());
      expect(detail.messages).toEqual([userMessage, assistantMessage]);
      expect(detail.messages.every(({ createdAt }) => createdAt.endsWith("+08:00")))
        .toBe(true);
      expect(detail.messages[1]?.interrupted).toBe(true);
      expect(detail.messageCount).toBe(2);
      expect(detail.audioAvailable).toBe(false);
      expect(detail.lastMessagePreview).toBe(assistantMessage.text);

      app.conversationDatabase.raw
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run("2099-01-01T00:00:00.000Z", first.id);
      app.conversationDatabase.raw
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run("2000-01-01T00:00:00.000Z", second.id);

      const listResponse = await app.inject({
        method: "GET",
        url: "/api/conversations",
      });
      expect(listResponse.statusCode).toBe(200);
      const list = conversationListSchema.parse(listResponse.json());
      expect(list.conversations.map(({ id }) => id)).toEqual([
        first.id,
        second.id,
      ]);
      expect(list.conversations[0]).toMatchObject({
        id: first.id,
        messageCount: 2,
        lastMessagePreview: assistantMessage.text,
        updatedAt: "2099-01-01T00:00:00.000Z",
      });
      expect(list.conversations[1]).toMatchObject({
        id: second.id,
        difficulty: "easy",
        locale: "zh",
        messageCount: 0,
        lastMessagePreview: null,
      });
    } finally {
      await app.close();
    }
  });

  it("downloads one MP3 timeline, a transcript, or both files in a ZIP", async () => {
    const app = createApp();
    try {
      await app.ready();
      const repository = new ConversationRepository(app.conversationDatabase);
      const conversation = repository.createConversation(getCreateInput(app));
      repository.appendMessage({
        conversationId: conversation.id,
        role: "user",
        text: "Could this remove manual qualification work?",
        interrupted: false,
        sourceItemId: "download-user",
        audio: {
          sampleRate: 16_000,
          pcm: createTonePcm(16_000, 140, 220),
        },
      });
      repository.appendMessage({
        conversationId: conversation.id,
        role: "assistant",
        text: "Possibly, but adoption is my main concern.",
        interrupted: false,
        sourceItemId: "download-assistant",
        responseId: "download-response",
        audio: {
          sampleRate: 24_000,
          pcm: createTonePcm(24_000, 180, 330),
        },
      });

      expect(repository.getConversation(conversation.id)?.audioAvailable).toBe(true);
      expect(repository.listConversations()).toContainEqual(
        expect.objectContaining({
          id: conversation.id,
          audioAvailable: true,
          messageCount: 2,
        }),
      );

      const textResponse = await app.inject({
        method: "GET",
        url: `/api/conversations/${conversation.id}/download?format=text`,
      });
      expect(textResponse.statusCode).toBe(200);
      expect(textResponse.headers["content-type"]).toContain("text/plain");
      expect(textResponse.headers["content-disposition"]).toBe(
        `attachment; filename="conversation-${conversation.id}.txt"`,
      );
      expect(textResponse.body).toContain("Could this remove manual qualification work?");
      expect(textResponse.body).toContain(
        "Possibly, but adoption is my main concern.",
      );

      const audioResponse = await app.inject({
        method: "GET",
        url: `/api/conversations/${conversation.id}/download?format=audio`,
      });
      expect(audioResponse.statusCode).toBe(200);
      expect(audioResponse.headers["content-type"]).toContain("audio/mpeg");
      expect(audioResponse.rawPayload.length).toBeGreaterThan(1_000);

      const bothResponse = await app.inject({
        method: "GET",
        url: `/api/conversations/${conversation.id}/download?format=both`,
      });
      expect(bothResponse.statusCode).toBe(200);
      expect(bothResponse.headers["content-type"]).toContain("application/zip");
      const archive = unzipSync(new Uint8Array(bothResponse.rawPayload));
      const transcript = archive[`conversation-${conversation.id}.txt`];
      const mp3 = archive[`conversation-${conversation.id}.mp3`];
      expect(transcript).toBeDefined();
      expect(mp3).toBeDefined();
      expect(strFromU8(transcript!)).toContain("Transcript");
      expect(mp3!.length).toBe(audioResponse.rawPayload.length);
    } finally {
      await app.close();
    }
  });

  it("keeps text export available when historical messages have no audio", async () => {
    const app = createApp();
    try {
      await app.ready();
      const repository = new ConversationRepository(app.conversationDatabase);
      const conversation = repository.createConversation(getCreateInput(app));
      repository.appendMessage({
        conversationId: conversation.id,
        role: "user",
        text: "This old message has text only.",
        interrupted: false,
        sourceItemId: "text-only-user",
      });

      const audioResponse = await app.inject({
        method: "GET",
        url: `/api/conversations/${conversation.id}/download?format=audio`,
      });
      expect(audioResponse.statusCode).toBe(409);
      expect(audioResponse.json()).toMatchObject({
        error: { code: "conversation_audio_unavailable" },
      });

      const textResponse = await app.inject({
        method: "GET",
        url: `/api/conversations/${conversation.id}/download?format=text`,
      });
      expect(textResponse.statusCode).toBe(200);
      expect(textResponse.body).toContain("This old message has text only.");
    } finally {
      await app.close();
    }
  });

  it("rejects invalid creation and reports missing conversations", async () => {
    const app = createApp();
    try {
      await app.ready();
      const input = getCreateInput(app);
      const invalidResponse = await app.inject({
        method: "POST",
        url: "/api/conversations",
        payload: {
          ...input,
          personaId: "persona_not_compatible",
        },
      });
      expect(invalidResponse.statusCode).toBe(400);
      expect(invalidResponse.json()).toMatchObject({
        error: { code: "invalid_request" },
      });

      const forgedCatalogResponse = await app.inject({
        method: "POST",
        url: "/api/conversations",
        payload: {
          ...input,
          persona: {
            ...input.persona,
            name: "Forged client persona",
          },
        },
      });
      expect(forgedCatalogResponse.statusCode).toBe(201);
      expect(conversationDetailSchema.parse(forgedCatalogResponse.json()).persona.name)
        .toBe(input.persona.name);

      const missingResponse = await app.inject({
        method: "GET",
        url: "/api/conversations/999999",
      });
      expect(missingResponse.statusCode).toBe(404);
      expect(missingResponse.json()).toMatchObject({
        error: { code: "conversation_not_found" },
      });

      const repository = new ConversationRepository(app.conversationDatabase);
      expect(() =>
        repository.appendMessage({
          conversationId: 999_999,
          role: "user",
          text: "This message has no owning conversation.",
          interrupted: false,
          sourceItemId: "missing-user-item",
        }),
      ).toThrow(ConversationNotFoundError);
    } finally {
      await app.close();
    }
  });

  it("loads only the requested recent user turns for realtime restoration", async () => {
    const app = createApp();
    try {
      await app.ready();
      const repository = new ConversationRepository(app.conversationDatabase);
      const conversation = repository.createConversation(getCreateInput(app));

      for (let turn = 1; turn <= 4; turn += 1) {
        repository.appendMessage({
          conversationId: conversation.id,
          role: "user",
          text: `Question ${turn}`,
          interrupted: false,
          sourceItemId: `user-${turn}`,
        });
        repository.appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          text: `Answer ${turn}`,
          interrupted: false,
          sourceItemId: `assistant-${turn}`,
          responseId: `response-${turn}`,
        });
      }

      expect(
        repository
          .getRuntimeConversation(conversation.id, 2)
          ?.messages.map(({ role, text }) => ({ role, text })),
      ).toEqual([
        { role: "user", text: "Question 3" },
        { role: "assistant", text: "Answer 3" },
        { role: "user", text: "Question 4" },
        { role: "assistant", text: "Answer 4" },
      ]);
      expect(repository.getConversation(conversation.id)?.messages).toHaveLength(
        8,
      );
    } finally {
      await app.close();
    }
  });

  it("ends a conversation, locks it, and persists weighted coaching feedback", async () => {
    let receivedInput: FeedbackGenerationInput | undefined;
    const feedbackGenerator: ConversationFeedbackGenerator = {
      model: "test-coach",
      generate: async (input) => {
        receivedInput = input;
        const highlightedMessages = input.messages
          .filter(({ role }) => role === "user")
          .slice(0, 3);
        if (highlightedMessages.length < 3) {
          throw new Error("Expected at least three learner messages.");
        }
        return {
          overallAssessment: "A focused discovery conversation.",
          overallAssessmentZhCn: "这是一次聚焦的需求探索对话。",
          strengths: [{
            text: "Asked a useful diagnostic question.",
            textZhCn: "提出了有用的诊断性问题。",
          }],
          improvementAreas: [{
            text: "Confirm the business impact more explicitly.",
            textZhCn: "需要更明确地确认业务影响。",
          }],
          coachingTips: [
            {
              title: "Quantify impact",
              titleZhCn: "量化影响",
              advice: "Ask for a measurable baseline.",
              adviceZhCn: "询问可衡量的现状基线。",
            },
            {
              title: "Confirm next step",
              titleZhCn: "确认下一步",
              advice: "Close with a specific action.",
              adviceZhCn: "以明确行动结束对话。",
            },
          ],
          criterionScores: input.criteria.map((criterion, index) => ({
            criterionPosition: criterion.position,
            score: 80 + index,
            rationale: `Evidence for ${criterion.name}.`,
            rationaleZhCn: `关于${criterion.nameZhCn}的证据。`,
          })),
          moments: highlightedMessages.map((highlightedMessage, index) => ({
            messageId: highlightedMessage.id,
            kind: index === 0 ? "strength" as const : "improvement" as const,
            title: `Moment ${index + 1}`,
            titleZhCn: `关键时刻 ${index + 1}`,
            assessment: "A transcript-grounded observation.",
            assessmentZhCn: "这是一项有对话依据的观察。",
            suggestedApproach: index === 0 ? "" : "Use one concise follow-up.",
            suggestedApproachZhCn: index === 0 ? "" : "使用一句简洁的追问。",
          })),
        };
      },
    };
    const app = createApp({ feedbackGenerator });
    try {
      await app.ready();
      const repository = new ConversationRepository(app.conversationDatabase);
      const createInput = { ...getCreateInput(app), locale: "zh" as const };
      const conversation = repository.createConversation(createInput);
      const userMessages = [];
      for (let turn = 1; turn <= 3; turn += 1) {
        userMessages.push(repository.appendMessage({
          conversationId: conversation.id,
          role: "user",
          text: turn === 1
            ? "How much time does manual qualification take today?"
            : `What measurable impact should we explore in follow-up ${turn}?`,
          interrupted: false,
          sourceItemId: `feedback-user-${turn}`,
        }));
        repository.appendMessage({
          conversationId: conversation.id,
          role: "assistant",
          text: `Customer answer ${turn}.`,
          interrupted: false,
          sourceItemId: `feedback-assistant-${turn}`,
          responseId: `feedback-response-${turn}`,
        });
      }
      const userMessage = userMessages[0];
      if (!userMessage) throw new Error("Expected the first learner message.");

      const endResponse = await app.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/end`,
      });
      expect([200, 202]).toContain(endResponse.statusCode);
      expect(conversationFeedbackViewSchema.parse(endResponse.json()).conversation)
        .toMatchObject({ status: "ended", id: conversation.id });

      let feedbackView = conversationFeedbackViewSchema.parse(endResponse.json());
      for (let attempt = 0; attempt < 5 && feedbackView.feedback.status !== "completed"; attempt += 1) {
        const response = await app.inject({
          method: "GET",
          url: `/api/conversations/${conversation.id}/feedback`,
        });
        feedbackView = conversationFeedbackViewSchema.parse(response.json());
      }

      expect(receivedInput?.messages[0]).toMatchObject({
        id: userMessage.id,
        text: userMessage.text,
      });
      expect(receivedInput?.locale).toBe("zh");
      expect(receivedInput?.criteria.map(({ name }) => name)).toEqual(
        createInput.scenario.scoringCriteria.map(
          ({ name, nameZhCn }) => name || nameZhCn,
        ),
      );
      expect(receivedInput?.criteria.map(({ nameZhCn }) => nameZhCn)).toEqual(
        createInput.scenario.scoringCriteria.map(
          ({ name, nameZhCn }) => nameZhCn || name,
        ),
      );
      expect(feedbackView.feedback).toMatchObject({
        status: "completed",
        model: "test-coach",
        overallAssessment: "A focused discovery conversation.",
        overallAssessmentZhCn: "这是一次聚焦的需求探索对话。",
        strengths: [{
          position: 0,
          text: "Asked a useful diagnostic question.",
          textZhCn: "提出了有用的诊断性问题。",
        }],
      });
      expect(feedbackView.feedback.criterionScores[0]).toMatchObject({
        name: createInput.scenario.scoringCriteria[0]?.name,
        nameZhCn: createInput.scenario.scoringCriteria[0]?.nameZhCn,
      });
      const expectedScore = Math.round(
        feedbackView.feedback.criterionScores.reduce(
          (total, criterion) => total + criterion.score * criterion.weight / 100,
          0,
        ),
      );
      expect(feedbackView.feedback.overallScore).toBe(expectedScore);
      expect(feedbackView.feedback.moments).toHaveLength(3);
      expect(feedbackView.conversation.endedAt).toMatch(/\+08:00$/);
      expect(() => repository.getRuntimeConversation(conversation.id))
        .toThrow(ConversationEndedError);
      expect(() => repository.appendMessage({
        conversationId: conversation.id,
        role: "user",
        text: "This must not be appended.",
        interrupted: false,
      })).toThrow(ConversationEndedError);
      expect(repository.listConversations()).toContainEqual(
        expect.objectContaining({
          id: conversation.id,
          status: "ended",
          feedbackStatus: "completed",
        }),
      );
    } finally {
      await app.close();
    }
  });

  it("regenerates an opened report created by an older coaching prompt", async () => {
    let generationCount = 0;
    const feedbackGenerator: ConversationFeedbackGenerator = {
      model: "versioned-test-coach",
      generate: async (input) => {
        generationCount += 1;
        return {
          overallAssessment: `Learner-only review ${generationCount}.`,
          overallAssessmentZhCn: `仅针对学员的复盘 ${generationCount}。`,
          strengths: [{
            text: `Learner strength ${generationCount}.`,
            textZhCn: `学员亮点 ${generationCount}。`,
          }],
          improvementAreas: [],
          coachingTips: [],
          criterionScores: input.criteria.map((criterion) => ({
            criterionPosition: criterion.position,
            score: 80,
            rationale: "The learner's message supports this score.",
            rationaleZhCn: "学员的发言支持这一评分。",
          })),
          moments: [],
        };
      },
    };
    const app = createApp({ feedbackGenerator });
    try {
      await app.ready();
      const repository = new ConversationRepository(app.conversationDatabase);
      const conversation = repository.createConversation(getCreateInput(app));
      repository.appendMessage({
        conversationId: conversation.id,
        role: "user",
        text: "What business outcome would make this project worthwhile?",
        interrupted: false,
        sourceItemId: "versioned-feedback-user",
      });

      await app.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/end`,
      });
      let feedbackView:
        | ReturnType<typeof conversationFeedbackViewSchema.parse>
        | undefined;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await app.inject({
          method: "GET",
          url: `/api/conversations/${conversation.id}/feedback`,
        });
        feedbackView = conversationFeedbackViewSchema.parse(response.json());
        if (feedbackView.feedback.status === "completed") break;
      }
      expect(feedbackView?.feedback).toMatchObject({
        status: "completed",
        overallAssessment: "Learner-only review 1.",
      });

      app.conversationDatabase.raw
        .prepare(
          `UPDATE feedback_reports
           SET prompt_version = 'sales-coach-v2'
           WHERE conversation_id = ?`,
        )
        .run(conversation.id);

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await app.inject({
          method: "GET",
          url: `/api/conversations/${conversation.id}/feedback`,
        });
        feedbackView = conversationFeedbackViewSchema.parse(response.json());
        if (
          feedbackView.feedback.status === "completed" &&
          feedbackView.feedback.promptVersion === FEEDBACK_PROMPT_VERSION
        ) {
          break;
        }
      }

      expect(generationCount).toBe(2);
      expect(feedbackView?.feedback).toMatchObject({
        status: "completed",
        promptVersion: FEEDBACK_PROMPT_VERSION,
        overallAssessment: "Learner-only review 2.",
        overallAssessmentZhCn: "仅针对学员的复盘 2。",
        strengths: [{
          position: 0,
          text: "Learner strength 2.",
          textZhCn: "学员亮点 2。",
        }],
      });
    } finally {
      await app.close();
    }
  });

  it("deletes only ended conversations and cancels in-flight feedback before cascading data", async () => {
    let generatorAborted = false;
    const feedbackGenerator: ConversationFeedbackGenerator = {
      model: "slow-test-coach",
      generate: async (_input, signal) => new Promise((resolve, reject) => {
        void resolve;
        const abort = () => {
          generatorAborted = true;
          reject(new Error("Feedback generation aborted for deletion."));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      }),
    };
    const app = createApp({ feedbackGenerator });
    try {
      await app.ready();
      const repository = new ConversationRepository(app.conversationDatabase);
      const conversation = repository.createConversation(getCreateInput(app));
      repository.appendMessage({
        conversationId: conversation.id,
        role: "user",
        text: "This record and its audio should be deleted.",
        interrupted: false,
        sourceItemId: "delete-user",
        audio: {
          sampleRate: 16_000,
          pcm: createTonePcm(16_000, 100, 220),
        },
      });

      const activeDelete = await app.inject({
        method: "DELETE",
        url: `/api/conversations/${conversation.id}`,
      });
      expect(activeDelete.statusCode).toBe(409);
      expect(repository.getConversation(conversation.id)).not.toBeNull();

      const endResponse = await app.inject({
        method: "POST",
        url: `/api/conversations/${conversation.id}/end`,
      });
      expect(endResponse.statusCode).toBe(202);

      const deleteResponse = await app.inject({
        method: "DELETE",
        url: `/api/conversations/${conversation.id}`,
      });
      expect(deleteResponse.statusCode).toBe(204);
      expect(deleteResponse.body).toBe("");
      expect(generatorAborted).toBe(true);
      expect(repository.getConversation(conversation.id)).toBeNull();
      expect(repository.listConversations()).toEqual([]);

      for (const table of [
        "sessions",
        "persona_snapshots",
        "scenario_snapshots",
        "scenario_scoring_criteria",
        "scenario_personas",
        "messages",
        "message_audio",
        "feedback_reports",
        "feedback_strengths",
        "feedback_improvement_areas",
        "feedback_coaching_tips",
        "feedback_criterion_scores",
        "feedback_moments",
      ]) {
        const row = app.conversationDatabase.raw
          .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
          .get() as unknown as { count: number };
        expect(row.count, table).toBe(0);
      }
    } finally {
      await app.close();
    }
  });
});

function createTonePcm(
  sampleRate: 16_000 | 24_000,
  durationMs: number,
  frequency: number,
): Buffer {
  const sampleCount = Math.round((sampleRate * durationMs) / 1_000);
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 8_000,
    );
    pcm.writeInt16LE(sample, index * 2);
  }
  return pcm;
}
