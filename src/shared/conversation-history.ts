import { z } from "zod";
import { databaseIdSchema } from "./database-id";
import {
  difficultySchema,
  resolvedPersonaInputSchema,
  resolvedScenarioInputSchema,
} from "./role-play-catalog";

const requiredText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);

export const conversationLocaleSchema = z.enum(["en", "zh"]);
export const conversationMessageRoleSchema = z.enum(["user", "assistant"]);

/**
 * The client submits only catalog IDs. The server resolves the authoritative
 * records before it creates immutable bilingual snapshots.
 */
export const createConversationInputSchema = z.object({
  personaId: databaseIdSchema,
  scenarioId: databaseIdSchema,
  difficulty: difficultySchema,
  locale: conversationLocaleSchema,
});

export type CreateConversationInput = z.infer<
  typeof createConversationInputSchema
>;

export const conversationMessageSchema = z.object({
  id: databaseIdSchema,
  role: conversationMessageRoleSchema,
  text: requiredText(100_000),
  interrupted: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
});

export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const conversationSummarySchema = z.object({
  id: databaseIdSchema,
  personaName: requiredText(80),
  scenarioName: requiredText(120),
  difficulty: difficultySchema,
  locale: conversationLocaleSchema,
  messageCount: z.number().int().min(0),
  lastMessagePreview: z.string().max(240).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const personaSnapshotSchema = resolvedPersonaInputSchema.extend({
  id: databaseIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type PersonaSnapshot = z.infer<typeof personaSnapshotSchema>;

export const scenarioSnapshotSchema = resolvedScenarioInputSchema.extend({
  id: databaseIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type ScenarioSnapshot = z.infer<typeof scenarioSnapshotSchema>;

export const conversationDetailSchema = conversationSummarySchema.extend({
  persona: personaSnapshotSchema,
  scenario: scenarioSnapshotSchema,
  messages: z.array(conversationMessageSchema),
});

export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const conversationListSchema = z.object({
  conversations: z.array(conversationSummarySchema),
});

export type ConversationList = z.infer<typeof conversationListSchema>;
