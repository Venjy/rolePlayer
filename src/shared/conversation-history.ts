import { z } from "zod";
import {
  difficultySchema,
  personaSchema,
  scenarioSchema,
} from "./role-play-catalog";

const requiredText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);

export const conversationLocaleSchema = z.enum(["en", "zh"]);
export const conversationMessageRoleSchema = z.enum(["user", "assistant"]);

/**
 * Creates an application-owned conversation before the realtime connection is
 * opened. Persona and scenario values are snapshots, so later catalog edits do
 * not silently change an existing conversation or its restored Instructions.
 */
export const createConversationInputSchema = z
  .object({
    persona: personaSchema,
    scenario: scenarioSchema,
    difficulty: difficultySchema,
    locale: conversationLocaleSchema,
  })
  .superRefine((value, context) => {
    if (!value.scenario.allowedPersonaIds.includes(value.persona.id)) {
      context.addIssue({
        code: "custom",
        path: ["persona", "id"],
        message: "The persona is not compatible with the selected scenario.",
      });
    }
  });

export type CreateConversationInput = z.infer<
  typeof createConversationInputSchema
>;

export const conversationMessageSchema = z.object({
  id: requiredText(100),
  role: conversationMessageRoleSchema,
  text: requiredText(100_000),
  interrupted: z.boolean(),
  createdAt: z.string().datetime(),
});

export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const conversationSummarySchema = z.object({
  id: requiredText(100),
  personaName: requiredText(80),
  scenarioName: requiredText(120),
  difficulty: difficultySchema,
  locale: conversationLocaleSchema,
  messageCount: z.number().int().min(0),
  lastMessagePreview: z.string().max(240).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationDetailSchema = conversationSummarySchema.extend({
  persona: personaSchema,
  scenario: scenarioSchema,
  messages: z.array(conversationMessageSchema),
});

export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const conversationListSchema = z.object({
  conversations: z.array(conversationSummarySchema),
});

export type ConversationList = z.infer<typeof conversationListSchema>;
