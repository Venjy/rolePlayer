import { z } from "zod";
import { databaseIdSchema } from "./database-id";
import { qwenVoiceSchema } from "./realtime-protocol";

const requiredText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);
const optionalText = (maximum: number) => z.string().trim().max(maximum);
const shortTextList = (maximumItems: number) =>
  z.array(requiredText(160)).max(maximumItems);
const uniqueIdList = (maximumItems: number, minimumItems = 0) =>
  z
    .array(databaseIdSchema)
    .min(minimumItems)
    .max(maximumItems)
    .superRefine((ids, context) => {
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: "custom",
          message: "Preset references must be unique.",
        });
      }
    });

export const personaGenderSchema = z.enum([
  "female",
  "male",
  "non_binary",
  "unspecified",
]);
export type PersonaGender = z.infer<typeof personaGenderSchema>;

export const difficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof difficultySchema>;

export const MAX_SCENARIO_PERSONAS = 100;

/**
 * English is the unsuffixed catalog language. Simplified Chinese fields use
 * the explicit `ZhCn` suffix; neither language is treated as optional metadata.
 */
export const personaPresetCategorySchema = z.enum([
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
  id: databaseIdSchema,
  category: personaPresetCategorySchema,
  value: optionalText(500),
  valueZhCn: optionalText(500),
  position: z.number().int().min(0),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).superRefine((value, context) => {
  if (!value.value && !value.valueZhCn) {
    context.addIssue({
      code: "custom",
      path: ["value"],
      message: "At least one localized preset value is required.",
    });
  }
});

export type PersonaPreset = z.infer<typeof personaPresetSchema>;

export const scenarioPresetCategorySchema = z.enum([
  "training_goal",
  "skill_focus",
  "success_criterion",
  "tone_style",
]);

export type ScenarioPresetCategory = z.infer<
  typeof scenarioPresetCategorySchema
>;

export const scenarioPresetSchema = z.object({
  id: databaseIdSchema,
  category: scenarioPresetCategorySchema,
  value: optionalText(500),
  valueZhCn: optionalText(500),
  position: z.number().int().min(0),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).superRefine((value, context) => {
  if (!value.value && !value.valueZhCn) {
    context.addIssue({
      code: "custom",
      path: ["value"],
      message: "At least one localized preset value is required.",
    });
  }
});

export type ScenarioPreset = z.infer<typeof scenarioPresetSchema>;

export const interruptFrequencySchema = z.enum(["low", "medium", "high"]);
export const speakingPaceSchema = z.enum(["slow", "normal", "fast"]);
export const voiceBehaviorSchema = z.object({
  interruptFrequency: interruptFrequencySchema,
  speakingPace: speakingPaceSchema,
});

/** Database-backed display metadata for a provider-owned Qwen voice ID. */
export const qwenVoiceGenderSchema = z.enum(["female", "male"]);
export const qwenVoiceDefinitionSchema = z.object({
  id: databaseIdSchema,
  voice: qwenVoiceSchema,
  gender: qwenVoiceGenderSchema,
  name: requiredText(120),
  nameZhCn: requiredText(120),
  position: z.number().int().min(0),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type QwenVoiceDefinition = z.infer<typeof qwenVoiceDefinitionSchema>;

const personaInputObjectSchema = z.object({
  name: optionalText(80),
  nameZhCn: optionalText(80),
  gender: personaGenderSchema,
  age: z.number().int().min(1).max(120).nullable(),
  occupationPresetId: databaseIdSchema,
  background: optionalText(2_000),
  backgroundZhCn: optionalText(2_000),
  personalityTraitPresetIds: uniqueIdList(12, 1),
  communicationStylePresetId: databaseIdSchema,
  behaviorNotes: optionalText(2_000),
  behaviorNotesZhCn: optionalText(2_000),
  motivationPresetIds: uniqueIdList(10),
  concernPresetIds: uniqueIdList(10),
  voice: qwenVoiceSchema,
});

function addRequiredPersonaInputIssues(
  value: z.infer<typeof personaInputObjectSchema>,
  context: z.RefinementCtx,
): void {
  if (!value.name && !value.nameZhCn) {
    context.addIssue({
      code: "custom",
      path: ["name"],
      message: "At least one localized name is required.",
    });
  }
}

export const personaInputSchema = personaInputObjectSchema.superRefine(
  addRequiredPersonaInputIssues,
);
export type PersonaInput = z.infer<typeof personaInputSchema>;

/**
 * A create drawer may be only partially filled. The current values are sent as
 * an exclusion hint, so generation must not require an otherwise savable row.
 */
export const personaDraftGenerationContextSchema = z.object({
  name: optionalText(80).optional(),
  nameZhCn: optionalText(80).optional(),
  gender: personaGenderSchema.optional(),
  age: z.number().int().min(1).max(120).nullable().optional(),
  occupationPresetId: databaseIdSchema.optional(),
  background: optionalText(2_000).optional(),
  backgroundZhCn: optionalText(2_000).optional(),
  personalityTraitPresetIds: uniqueIdList(12).optional(),
  communicationStylePresetId: databaseIdSchema.optional(),
  behaviorNotes: optionalText(2_000).optional(),
  behaviorNotesZhCn: optionalText(2_000).optional(),
  motivationPresetIds: uniqueIdList(10).optional(),
  concernPresetIds: uniqueIdList(10).optional(),
  voice: qwenVoiceSchema.optional(),
});
export type PersonaDraftGenerationContext = z.infer<
  typeof personaDraftGenerationContextSchema
>;

/**
 * Removes blank form values before a partial draft is used as an exclusion.
 * An entirely blank form is represented by no `currentDraft` at all.
 */
export function compactPersonaDraftGenerationContext(
  draft?: PersonaDraftGenerationContext,
): PersonaDraftGenerationContext | undefined {
  if (!draft) return undefined;
  const compacted: PersonaDraftGenerationContext = {
    ...compactLocalizedText("name", draft.name, draft.nameZhCn),
    ...(draft.gender && draft.gender !== "unspecified"
      ? { gender: draft.gender }
      : {}),
    ...(typeof draft.age === "number" ? { age: draft.age } : {}),
    ...compactId("occupationPresetId", draft.occupationPresetId),
    ...compactLocalizedText(
      "background",
      draft.background,
      draft.backgroundZhCn,
    ),
    ...compactIds(
      "personalityTraitPresetIds",
      draft.personalityTraitPresetIds,
    ),
    ...compactId(
      "communicationStylePresetId",
      draft.communicationStylePresetId,
    ),
    ...compactLocalizedText(
      "behaviorNotes",
      draft.behaviorNotes,
      draft.behaviorNotesZhCn,
    ),
    ...compactIds("motivationPresetIds", draft.motivationPresetIds),
    ...compactIds("concernPresetIds", draft.concernPresetIds),
    ...(draft.voice ? { voice: draft.voice } : {}),
  };
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

export const personaDraftGenerationRequestSchema = z.object({
  currentDraft: personaDraftGenerationContextSchema.optional(),
});
export type PersonaDraftGenerationRequest = z.infer<
  typeof personaDraftGenerationRequestSchema
>;

const resolvedPersonaPresetFieldsSchema = z.object({
  occupation: optionalText(500),
  occupationZhCn: optionalText(500),
  personalityTraits: shortTextList(12),
  personalityTraitsZhCn: shortTextList(12),
  communicationStyle: optionalText(500),
  communicationStyleZhCn: optionalText(500),
  motivations: shortTextList(10),
  motivationsZhCn: shortTextList(10),
  concerns: shortTextList(10),
  concernsZhCn: shortTextList(10),
});

export const resolvedPersonaInputSchema = personaInputObjectSchema
  .omit({
    occupationPresetId: true,
    personalityTraitPresetIds: true,
    communicationStylePresetId: true,
    motivationPresetIds: true,
    concernPresetIds: true,
  })
  .extend(resolvedPersonaPresetFieldsSchema.shape)
  .superRefine((value, context) => {
    if (!value.name && !value.nameZhCn) {
      context.addIssue({
        code: "custom",
        path: ["name"],
        message: "At least one localized name is required.",
      });
    }
  });
export type ResolvedPersonaInput = z.infer<typeof resolvedPersonaInputSchema>;

export const personaSchema = personaInputObjectSchema
  .extend(resolvedPersonaPresetFieldsSchema.shape)
  .extend({
    id: databaseIdSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((value, context) => {
    addRequiredPersonaInputIssues(value, context);
    for (const [field, english, chinese] of [
      ["occupation", value.occupation, value.occupationZhCn],
      [
        "communicationStyle",
        value.communicationStyle,
        value.communicationStyleZhCn,
      ],
    ] as const) {
      if (!english && !chinese) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "The referenced preset needs a localized value.",
        });
      }
    }
  });
export type Persona = z.infer<typeof personaSchema>;

const scoringCriterionInputSchema = z.object({
  successCriterionPresetId: databaseIdSchema,
  weight: z.number().int().min(0).max(100),
});

const localizedScoringCriterionSchema = z.object({
  name: optionalText(160),
  nameZhCn: optionalText(160),
  weight: z.number().int().min(0).max(100),
});

export const scoringCriterionSchema = scoringCriterionInputSchema
  .extend(localizedScoringCriterionSchema.shape)
  .superRefine((value, context) => {
    if (!value.name && !value.nameZhCn) {
      context.addIssue({
        code: "custom",
        path: ["name"],
        message: "At least one localized scoring name is required.",
      });
    }
  });

export const scenarioInputSchema = z
  .object({
    name: optionalText(120),
    nameZhCn: optionalText(120),
    description: optionalText(2_000),
    descriptionZhCn: optionalText(2_000),
    trainingGoalPresetIds: uniqueIdList(10),
    skillFocusPresetIds: uniqueIdList(10),
    successCriterionPresetIds: uniqueIdList(12),
    toneStylePresetId: databaseIdSchema.optional(),
    voiceBehavior: voiceBehaviorSchema.partial().default({}),
    scoringCriteria: z.array(scoringCriterionInputSchema).max(12),
    // Compatibility is managed separately from scenario content editing.
    allowedPersonaIds: z.array(databaseIdSchema).max(MAX_SCENARIO_PERSONAS),
  })
  .superRefine((value, context) => {
    const requiredTextPairs = [
      ["name", value.name, value.nameZhCn],
      ["description", value.description, value.descriptionZhCn],
    ] as const;
    for (const [field, english, chinese] of requiredTextPairs) {
      if (!english && !chinese) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "At least one localized value is required.",
        });
      }
    }
    if (new Set(value.allowedPersonaIds).size !== value.allowedPersonaIds.length) {
      context.addIssue({
        code: "custom",
        path: ["allowedPersonaIds"],
        message: "Persona compatibility entries must be unique.",
      });
    }

    if (
      value.scoringCriteria.length > 0 &&
      value.scoringCriteria.length !== value.successCriterionPresetIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["scoringCriteria"],
        message: "Scoring criteria must match the selected success criteria.",
      });
    }
    value.scoringCriteria.forEach((criterion, index) => {
      if (
        criterion.successCriterionPresetId !==
        value.successCriterionPresetIds[index]
      ) {
        context.addIssue({
          code: "custom",
          path: ["scoringCriteria", index, "successCriterionPresetId"],
          message: "Scoring references must match the selected success criteria.",
        });
      }
    });
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

export const scenarioDraftGenerationContextSchema = z.object({
  name: optionalText(120).optional(),
  nameZhCn: optionalText(120).optional(),
  description: optionalText(2_000).optional(),
  descriptionZhCn: optionalText(2_000).optional(),
  trainingGoalPresetIds: uniqueIdList(10).optional(),
  skillFocusPresetIds: uniqueIdList(10).optional(),
  successCriterionPresetIds: uniqueIdList(12).optional(),
  toneStylePresetId: databaseIdSchema.optional(),
  voiceBehavior: voiceBehaviorSchema.partial().optional(),
});
export type ScenarioDraftGenerationContext = z.infer<
  typeof scenarioDraftGenerationContextSchema
>;

/** Scenario equivalent of `compactPersonaDraftGenerationContext`. */
export function compactScenarioDraftGenerationContext(
  draft?: ScenarioDraftGenerationContext,
): ScenarioDraftGenerationContext | undefined {
  if (!draft) return undefined;
  const voiceBehavior = {
    ...(draft.voiceBehavior?.interruptFrequency
      ? { interruptFrequency: draft.voiceBehavior.interruptFrequency }
      : {}),
    ...(draft.voiceBehavior?.speakingPace
      ? { speakingPace: draft.voiceBehavior.speakingPace }
      : {}),
  };
  const compacted: ScenarioDraftGenerationContext = {
    ...compactLocalizedText("name", draft.name, draft.nameZhCn),
    ...compactLocalizedText(
      "description",
      draft.description,
      draft.descriptionZhCn,
    ),
    ...compactIds("trainingGoalPresetIds", draft.trainingGoalPresetIds),
    ...compactIds("skillFocusPresetIds", draft.skillFocusPresetIds),
    ...compactIds(
      "successCriterionPresetIds",
      draft.successCriterionPresetIds,
    ),
    ...compactId("toneStylePresetId", draft.toneStylePresetId),
    ...(Object.keys(voiceBehavior).length > 0 ? { voiceBehavior } : {}),
  };
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

export const scenarioDraftGenerationRequestSchema = z.object({
  currentDraft: scenarioDraftGenerationContextSchema.optional(),
});
export type ScenarioDraftGenerationRequest = z.infer<
  typeof scenarioDraftGenerationRequestSchema
>;

export const scenarioSchema = scenarioInputSchema.safeExtend({
  goals: shortTextList(10),
  goalsZhCn: shortTextList(10),
  suggestedSkillFocus: shortTextList(10),
  suggestedSkillFocusZhCn: shortTextList(10),
  successCriteria: shortTextList(12),
  successCriteriaZhCn: shortTextList(12),
  toneStyle: optionalText(500),
  toneStyleZhCn: optionalText(500),
  scoringCriteria: z.array(scoringCriterionSchema).max(12),
  id: databaseIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Scenario = z.infer<typeof scenarioSchema>;

export const resolvedScenarioInputSchema = z.object({
  name: optionalText(120),
  nameZhCn: optionalText(120),
  description: optionalText(2_000),
  descriptionZhCn: optionalText(2_000),
  goals: shortTextList(10),
  goalsZhCn: shortTextList(10),
  suggestedSkillFocus: shortTextList(10),
  suggestedSkillFocusZhCn: shortTextList(10),
  successCriteria: shortTextList(12),
  successCriteriaZhCn: shortTextList(12),
  toneStyle: optionalText(500),
  toneStyleZhCn: optionalText(500),
  voiceBehavior: voiceBehaviorSchema.partial(),
  scoringCriteria: z.array(localizedScoringCriterionSchema).max(12),
  allowedPersonaIds: z.array(databaseIdSchema).max(MAX_SCENARIO_PERSONAS),
});
export type ResolvedScenarioInput = z.infer<typeof resolvedScenarioInputSchema>;

export const rolePlayCatalogSchema = z.object({
  qwenVoices: z.array(qwenVoiceDefinitionSchema),
  personaPresets: z.array(personaPresetSchema),
  scenarioPresets: z.array(scenarioPresetSchema),
  personas: z.array(personaSchema),
  scenarios: z.array(scenarioSchema),
});
export type RolePlayCatalog = z.infer<typeof rolePlayCatalogSchema>;

function compactText(value: string | undefined): string | undefined {
  const compacted = value?.trim();
  return compacted ? compacted : undefined;
}

function compactLocalizedText<TEnglish extends string>(
  englishKey: TEnglish,
  englishValue: string | undefined,
  chineseValue: string | undefined,
): Partial<Record<TEnglish | `${TEnglish}ZhCn`, string>> {
  const english = compactText(englishValue);
  const chinese = compactText(chineseValue);
  return {
    ...(english ? { [englishKey]: english } : {}),
    ...(chinese ? { [`${englishKey}ZhCn`]: chinese } : {}),
  } as Partial<Record<TEnglish | `${TEnglish}ZhCn`, string>>;
}

function compactId<TKey extends string>(
  key: TKey,
  value: number | undefined,
): Partial<Record<TKey, number>> {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? ({ [key]: value } as Record<TKey, number>)
    : {};
}

function compactIds<TKey extends string>(
  key: TKey,
  values: number[] | undefined,
): Partial<Record<TKey, number[]>> {
  const compacted = values?.filter(
    (value) => Number.isSafeInteger(value) && value > 0,
  );
  return compacted && compacted.length > 0
    ? ({ [key]: compacted } as Record<TKey, number[]>)
    : {};
}
