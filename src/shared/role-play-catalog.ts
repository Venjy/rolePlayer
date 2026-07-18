import { z } from "zod";
import { qwenVoiceSchema } from "./realtime-protocol";

const requiredText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);
const optionalText = (maximum: number) => z.string().trim().max(maximum);
const shortTextList = (maximumItems: number) =>
  z.array(requiredText(160)).max(maximumItems);

export const personaGenderSchema = z.enum([
  "female",
  "male",
  "non_binary",
  "unspecified",
]);

export const difficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof difficultySchema>;

export const MAX_SCENARIO_PERSONAS = 100;

/**
 * Database-backed choices used by the persona editor. Personas intentionally
 * store the selected text as a snapshot instead of referencing these rows, so
 * changing the available choices never rewrites an existing character.
 */
export const personaPresetCategorySchema = z.enum([
  "identity",
  "occupation",
  "personality_trait",
  "communication_style",
  "motivation",
  "concern",
]);

export type PersonaPresetCategory = z.infer<
  typeof personaPresetCategorySchema
>;

export const personaPresetSchema = z.object({
  id: requiredText(100),
  category: personaPresetCategorySchema,
  /** Stable Chinese snapshot value stored on personas. */
  value: requiredText(500),
  /** English display value; legacy/custom rows may leave it empty for UI fallback. */
  valueEn: optionalText(500),
  position: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PersonaPreset = z.infer<typeof personaPresetSchema>;

export const interruptFrequencySchema = z.enum(["low", "medium", "high"]);
export const speakingPaceSchema = z.enum(["slow", "normal", "fast"]);

export const personaInputSchema = z.object({
  name: requiredText(80),
  gender: personaGenderSchema,
  age: z.number().int().min(1).max(120).nullable(),
  occupation: optionalText(120),
  identity: requiredText(240),
  background: optionalText(2_000),
  personalityTraits: shortTextList(12).min(1),
  communicationStyle: requiredText(500),
  behaviorNotes: optionalText(2_000),
  motivations: shortTextList(10),
  concerns: shortTextList(10),
  voice: qwenVoiceSchema,
});

export type PersonaInput = z.infer<typeof personaInputSchema>;

export const personaSchema = personaInputSchema.extend({
  id: requiredText(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Persona = z.infer<typeof personaSchema>;

export const scoringCriterionSchema = z.object({
  name: requiredText(100),
  weight: z.number().int().min(0).max(100),
});

export const voiceBehaviorSchema = z.object({
  interruptFrequency: interruptFrequencySchema,
  speakingPace: speakingPaceSchema,
  toneStyle: requiredText(160),
});

export const scenarioInputSchema = z
  .object({
    name: requiredText(120),
    description: requiredText(2_000),
    goals: shortTextList(10).min(1),
    suggestedSkillFocus: shortTextList(10).min(1),
    successCriteria: shortTextList(12).min(1),
    scoringCriteria: z.array(scoringCriterionSchema).max(12),
    allowedPersonaIds: z
      .array(requiredText(100))
      .max(MAX_SCENARIO_PERSONAS)
      .min(1),
    voiceBehavior: voiceBehaviorSchema,
  })
  .superRefine((value, context) => {
    const personaIds = new Set(value.allowedPersonaIds);
    if (personaIds.size !== value.allowedPersonaIds.length) {
      context.addIssue({
        code: "custom",
        path: ["allowedPersonaIds"],
        message: "Persona compatibility entries must be unique.",
      });
    }

    const scoringNames = new Set(
      value.scoringCriteria.map(({ name }) => name.toLocaleLowerCase()),
    );
    if (scoringNames.size !== value.scoringCriteria.length) {
      context.addIssue({
        code: "custom",
        path: ["scoringCriteria"],
        message: "Scoring criterion names must be unique.",
      });
    }

    const totalWeight = value.scoringCriteria.reduce(
      (total, criterion) => total + criterion.weight,
      0,
    );
    if (value.scoringCriteria.length > 0 && totalWeight !== 100) {
      context.addIssue({
        code: "custom",
        path: ["scoringCriteria"],
        message: "Scoring weights must add up to 100.",
      });
    }
  });

export type ScenarioInput = z.infer<typeof scenarioInputSchema>;

export const scenarioSchema = scenarioInputSchema.extend({
  id: requiredText(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Scenario = z.infer<typeof scenarioSchema>;

export const rolePlayCatalogSchema = z.object({
  personaPresets: z.array(personaPresetSchema),
  personas: z.array(personaSchema),
  scenarios: z.array(scenarioSchema),
});

export type RolePlayCatalog = z.infer<typeof rolePlayCatalogSchema>;
