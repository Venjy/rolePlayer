import { z } from "zod";
import { databaseIdSchema } from "./database-id";
import {
  conversationDetailSchema,
  conversationLocaleSchema,
} from "./conversation-history";

export const feedbackStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
]);
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>;

export const feedbackMomentKindSchema = z.enum(["strength", "improvement"]);

const feedbackStrengthSchema = z.object({
  position: z.number().int().min(0),
  text: z.string().trim().min(1).max(1_000),
  textZhCn: z.string().trim().min(1).max(1_000),
});

const feedbackCoachingTipSchema = z.object({
  position: z.number().int().min(0),
  title: z.string().trim().min(1).max(200),
  titleZhCn: z.string().trim().min(1).max(200),
  advice: z.string().trim().min(1).max(1_500),
  adviceZhCn: z.string().trim().min(1).max(1_500),
});

const feedbackCriterionScoreSchema = z
  .object({
    criterionPosition: z.number().int().min(0),
    name: z.string().trim().max(160),
    nameZhCn: z.string().trim().max(160),
    weight: z.number().int().min(0).max(100),
    score: z.number().int().min(0).max(100),
    rationale: z.string().trim().min(1).max(1_500),
    rationaleZhCn: z.string().trim().min(1).max(1_500),
  })
  .superRefine((value, context) => {
    if (!value.name && !value.nameZhCn) {
      context.addIssue({
        code: "custom",
        path: ["name"],
        message: "At least one localized criterion name is required.",
      });
    }
  });

const feedbackMomentSchema = z.object({
  position: z.number().int().min(0),
  messageId: databaseIdSchema,
  kind: feedbackMomentKindSchema,
  title: z.string().trim().min(1).max(200),
  titleZhCn: z.string().trim().min(1).max(200),
  assessment: z.string().trim().min(1).max(1_500),
  assessmentZhCn: z.string().trim().min(1).max(1_500),
  suggestedApproach: z.string().trim().max(1_500),
  suggestedApproachZhCn: z.string().trim().max(1_500),
});

export const conversationFeedbackSchema = z.object({
  conversationId: databaseIdSchema,
  status: feedbackStatusSchema,
  locale: conversationLocaleSchema,
  overallAssessment: z.string().trim().max(2_000).nullable(),
  overallAssessmentZhCn: z.string().trim().max(2_000).nullable(),
  overallScore: z.number().int().min(0).max(100).nullable(),
  model: z.string().trim().max(200).nullable(),
  promptVersion: z.string().trim().min(1).max(100),
  errorCode: z.string().trim().max(100).nullable(),
  errorMessage: z.string().trim().max(2_000).nullable(),
  strengths: z.array(feedbackStrengthSchema).max(8),
  improvementAreas: z.array(feedbackStrengthSchema).max(8),
  coachingTips: z.array(feedbackCoachingTipSchema).max(8),
  criterionScores: z.array(feedbackCriterionScoreSchema).max(12),
  moments: z.array(feedbackMomentSchema).max(8),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).nullable(),
});
export type ConversationFeedback = z.infer<typeof conversationFeedbackSchema>;

export const conversationFeedbackViewSchema = z.object({
  conversation: conversationDetailSchema,
  feedback: conversationFeedbackSchema,
});
export type ConversationFeedbackView = z.infer<
  typeof conversationFeedbackViewSchema
>;
