import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
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
  ConversationNotFoundError,
  ConversationRepository,
} from "../../src/server/conversations/conversation-repository";
import { registerConversationRoutes } from "../../src/server/conversations/conversation-routes";
import { registerDatabases } from "../../src/server/database/register-database";
import {
  localizePersona,
  localizeScenario,
} from "../../src/shared/role-play-localization";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createApp() {
  const directory = mkdtempSync(join(tmpdir(), "role-player-conversations-"));
  temporaryDirectories.push(directory);

  return createAppAtPath(join(directory, "conversations.sqlite"));
}

function createAppAtPath(path: string) {
  const app = Fastify({ logger: false });
  registerDatabases(app, {
    catalogPath: join(dirname(path), "catalog.sqlite"),
    conversationPath: path,
  });
  registerConversationRoutes(app);
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
    ({ name }) => name === "Sales discovery call",
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
        personaName: localizedInput.persona.name,
        scenarioName: localizedInput.scenario.name,
        difficulty: input.difficulty,
        locale: input.locale,
        messageCount: 0,
        lastMessagePreview: null,
        persona: localizedInput.persona,
        scenario: localizedInput.scenario,
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
      expect(restored.persona).toEqual(localizedInput.persona);
      expect(restored.scenario).toEqual(localizedInput.scenario);

      const restoredRuntime = repository.getRuntimeConversation(created.id);
      expect(restoredRuntime?.instructions).toBe(expectedInstructions);
      expect(restoredRuntime?.voice).toBe(input.persona.voice);
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
