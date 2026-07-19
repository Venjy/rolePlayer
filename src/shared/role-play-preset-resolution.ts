import type {
  PersonaInput,
  PersonaPreset,
  PersonaPresetCategory,
  ResolvedPersonaInput,
  ResolvedScenarioInput,
  ScenarioInput,
  ScenarioPreset,
  ScenarioPresetCategory,
} from "./role-play-catalog";

export type ResolvedPersonaDraft = PersonaInput & ResolvedPersonaInput;
export type ResolvedScenarioDraft = ScenarioInput & ResolvedScenarioInput;

export class PresetReferenceResolutionError extends Error {
  public constructor(
    public readonly category: PersonaPresetCategory | ScenarioPresetCategory,
    public readonly presetId: number,
  ) {
    super(`Preset ${presetId} does not exist in category "${category}".`);
    this.name = "PresetReferenceResolutionError";
  }
}

/** Resolves ID-only persona references into bilingual values for display/prompts. */
export function resolvePersonaPresetReferences(
  persona: PersonaInput,
  presets: readonly PersonaPreset[],
): ResolvedPersonaDraft {
  const occupation = requirePersonaPreset(
    presets,
    "occupation",
    persona.occupationPresetId,
  );
  const traits = persona.personalityTraitPresetIds.map((id) =>
    requirePersonaPreset(presets, "personality_trait", id),
  );
  const communicationStyle = requirePersonaPreset(
    presets,
    "communication_style",
    persona.communicationStylePresetId,
  );
  const motivations = persona.motivationPresetIds.map((id) =>
    requirePersonaPreset(presets, "motivation", id),
  );
  const concerns = persona.concernPresetIds.map((id) =>
    requirePersonaPreset(presets, "concern", id),
  );

  return {
    ...persona,
    occupation: occupation.value,
    occupationZhCn: occupation.valueZhCn,
    personalityTraits: traits.map(({ value }) => value),
    personalityTraitsZhCn: traits.map(({ valueZhCn }) => valueZhCn),
    communicationStyle: communicationStyle.value,
    communicationStyleZhCn: communicationStyle.valueZhCn,
    motivations: motivations.map(({ value }) => value),
    motivationsZhCn: motivations.map(({ valueZhCn }) => valueZhCn),
    concerns: concerns.map(({ value }) => value),
    concernsZhCn: concerns.map(({ valueZhCn }) => valueZhCn),
  };
}

/** Resolves ID-only scenario references into bilingual values for display/prompts. */
export function resolveScenarioPresetReferences(
  scenario: ScenarioInput,
  presets: readonly ScenarioPreset[],
): ResolvedScenarioDraft {
  const goals = scenario.trainingGoalPresetIds.map((id) =>
    requireScenarioPreset(presets, "training_goal", id),
  );
  const skills = scenario.skillFocusPresetIds.map((id) =>
    requireScenarioPreset(presets, "skill_focus", id),
  );
  const successCriteria = scenario.successCriterionPresetIds.map((id) =>
    requireScenarioPreset(presets, "success_criterion", id),
  );
  const toneStyle = scenario.toneStylePresetId === undefined
    ? undefined
    : requireScenarioPreset(presets, "tone_style", scenario.toneStylePresetId);

  return {
    ...scenario,
    goals: goals.map(({ value }) => value),
    goalsZhCn: goals.map(({ valueZhCn }) => valueZhCn),
    suggestedSkillFocus: skills.map(({ value }) => value),
    suggestedSkillFocusZhCn: skills.map(({ valueZhCn }) => valueZhCn),
    successCriteria: successCriteria.map(({ value }) => value),
    successCriteriaZhCn: successCriteria.map(({ valueZhCn }) => valueZhCn),
    toneStyle: toneStyle?.value ?? "",
    toneStyleZhCn: toneStyle?.valueZhCn ?? "",
    scoringCriteria: scenario.scoringCriteria.map((criterion) => {
      const preset = requireScenarioPreset(
        presets,
        "success_criterion",
        criterion.successCriterionPresetId,
      );
      return {
        ...criterion,
        name: preset.value,
        nameZhCn: preset.valueZhCn,
      };
    }),
  };
}

function requirePersonaPreset(
  presets: readonly PersonaPreset[],
  category: PersonaPresetCategory,
  id: number,
): PersonaPreset {
  const preset = presets.find(
    (candidate) => candidate.id === id && candidate.category === category,
  );
  if (!preset) throw new PresetReferenceResolutionError(category, id);
  return preset;
}

function requireScenarioPreset(
  presets: readonly ScenarioPreset[],
  category: ScenarioPresetCategory,
  id: number,
): ScenarioPreset {
  const preset = presets.find(
    (candidate) => candidate.id === id && candidate.category === category,
  );
  if (!preset) throw new PresetReferenceResolutionError(category, id);
  return preset;
}
