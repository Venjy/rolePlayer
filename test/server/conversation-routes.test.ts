import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  conversationDetailSchema,
  conversationListSchema,
  type CreateConversationInput,
} from "../../src/shared/conversation-history";
import { compileRolePlayInstructions } from "../../src/shared/role-play-instructions";
import { CatalogRepository } from "../../src/server/catalog/catalog-repository";
import {
  ConversationNotFoundError,
  ConversationRepository,
} from "../../src/server/conversations/conversation-repository";
import { registerConversationRoutes } from "../../src/server/conversations/conversation-routes";
import { registerDatabase } from "../../src/server/database/register-database";

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
  registerDatabase(app, { path });
  registerConversationRoutes(app);
  return app;
}

function getCreateInput(app: ReturnType<typeof createApp>): CreateConversationInput {
  const catalog = new CatalogRepository(app.database);
  const persona = catalog.getPersona("persona_alex");
  const scenario = catalog.getScenario("scenario_sales_discovery");
  if (!persona || !scenario) {
    throw new Error("The migration-owned starter catalog is missing.");
  }

  return {
    persona,
    scenario,
    difficulty: "hard",
    locale: "en",
  };
}

describe("conversation history routes", () => {
  it("restores conversations and messages after the database is reopened", async () => {
    const directory = mkdtempSync(join(tmpdir(), "role-player-reopen-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "conversations.sqlite");
    const firstApp = createAppAtPath(databasePath);
    let conversationId = "";
    try {
      await firstApp.ready();
      const repository = new ConversationRepository(firstApp.database);
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
        reopenedApp.database,
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
      const expectedInstructions = compileRolePlayInstructions(input);

      const response = await app.inject({
        method: "POST",
        url: "/api/conversations",
        payload: input,
      });

      expect(response.statusCode).toBe(201);
      const created = conversationDetailSchema.parse(response.json());
      expect(created).toMatchObject({
        personaName: input.persona.name,
        scenarioName: input.scenario.name,
        difficulty: input.difficulty,
        locale: input.locale,
        messageCount: 0,
        lastMessagePreview: null,
        persona: input.persona,
        scenario: input.scenario,
        messages: [],
      });
      expect(created.createdAt).toBe(created.updatedAt);

      const repository = new ConversationRepository(app.database);
      const runtime = repository.getRuntimeConversation(created.id);
      if (!runtime) throw new Error("Created conversation was not persisted.");
      expect(runtime).toMatchObject({
        id: created.id,
        persona: input.persona,
        scenario: input.scenario,
        difficulty: input.difficulty,
        locale: input.locale,
        instructions: expectedInstructions,
        voice: input.persona.voice,
        messages: [],
      });

      app.database.raw
        .prepare(
          `UPDATE personas
           SET name = ?, identity = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          "Changed catalog persona",
          "A catalog identity edited after the conversation started",
          "2030-01-01T00:00:00.000Z",
          input.persona.id,
        );
      app.database.raw
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
      expect(restored.persona).toEqual(input.persona);
      expect(restored.scenario).toEqual(input.scenario);

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
      const repository = new ConversationRepository(app.database);

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
      expect(detail.messages[1]?.interrupted).toBe(true);
      expect(detail.messageCount).toBe(2);
      expect(detail.lastMessagePreview).toBe(assistantMessage.text);

      app.database.raw
        .prepare("UPDATE conversation_sessions SET updated_at = ? WHERE id = ?")
        .run("2099-01-01T00:00:00.000Z", first.id);
      app.database.raw
        .prepare("UPDATE conversation_sessions SET updated_at = ? WHERE id = ?")
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
          scenario: {
            ...input.scenario,
            allowedPersonaIds: ["persona_not_compatible"],
          },
        },
      });
      expect(invalidResponse.statusCode).toBe(400);
      expect(invalidResponse.json()).toMatchObject({
        error: { code: "invalid_request" },
      });

      const maximumText = "x".repeat(160);
      const overBudgetResponse = await app.inject({
        method: "POST",
        url: "/api/conversations",
        payload: {
          ...input,
          persona: {
            ...input.persona,
            background: "x".repeat(2_000),
            personalityTraits: Array.from({ length: 12 }, () => maximumText),
            communicationStyle: "x".repeat(500),
            behaviorNotes: "x".repeat(2_000),
            motivations: Array.from({ length: 10 }, () => maximumText),
            concerns: Array.from({ length: 10 }, () => maximumText),
          },
          scenario: {
            ...input.scenario,
            description: "x".repeat(2_000),
            goals: Array.from({ length: 10 }, () => maximumText),
            suggestedSkillFocus: Array.from(
              { length: 10 },
              () => maximumText,
            ),
            successCriteria: Array.from(
              { length: 12 },
              () => maximumText,
            ),
          },
        },
      });
      expect(overBudgetResponse.statusCode).toBe(400);
      expect(overBudgetResponse.json()).toMatchObject({
        error: {
          code: "instructions_too_long",
          maximumLength: 12_000,
        },
      });

      const missingResponse = await app.inject({
        method: "GET",
        url: "/api/conversations/conversation_missing",
      });
      expect(missingResponse.statusCode).toBe(404);
      expect(missingResponse.json()).toMatchObject({
        error: { code: "conversation_not_found" },
      });

      const repository = new ConversationRepository(app.database);
      expect(() =>
        repository.appendMessage({
          conversationId: "conversation_missing",
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
      const repository = new ConversationRepository(app.database);
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
