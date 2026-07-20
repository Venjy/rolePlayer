import {
  compactScenarioDraftGenerationContext,
  type ScenarioDraftGenerationContext,
  type Scenario,
  type ScenarioInput,
  type ScenarioPreset,
} from "../../shared/role-play-catalog";
import { distributeScoringWeights } from "../../shared/scoring-weights";
import type { AppLocale } from "../i18n";

export { distributeScoringWeights } from "../../shared/scoring-weights";

interface ScoringCriterionFormValue {
  successCriterionPresetId: number;
  displayName: string;
  weight: number;
}

export interface ScenarioFormValues {
  name: string;
  description: string;
  trainingGoalPresetIds: number[];
  skillFocusPresetIds: number[];
  successCriterionPresetIds: number[];
  toneStylePresetId?: number;
  voiceBehavior: ScenarioInput["voiceBehavior"];
  scoringEnabled: boolean;
  scoringCriteria: ScoringCriterionFormValue[];
}

type ScenarioFormSource = Scenario | ScenarioInput;

function mergeText(
  value: string,
  locale: AppLocale,
  english: string,
  chinese: string,
): { en: string; zhCn: string } {
  const normalized = value.trim();
  const displayed = locale === "en" ? english || chinese : chinese || english;
  if (normalized === displayed) return { en: english, zhCn: chinese };
  return locale === "en"
    ? { en: normalized, zhCn: chinese }
    : { en: english, zhCn: normalized };
}

export function buildScoringCriteriaForSuccessCriteria(
  successCriterionPresetIds: readonly number[],
  presets: readonly ScenarioPreset[],
  locale: AppLocale,
): ScoringCriterionFormValue[] {
  const defaultWeights = distributeScoringWeights(successCriterionPresetIds.length);
  return successCriterionPresetIds.map((presetId, index) => {
    const preset = presets.find(
      (candidate) =>
        candidate.id === presetId && candidate.category === "success_criterion",
    );
    return {
      successCriterionPresetId: presetId,
      displayName:
        locale === "en"
          ? preset?.value || preset?.valueZhCn || ""
          : preset?.valueZhCn || preset?.value || "",
      weight: defaultWeights[index] ?? 0,
    };
  });
}

export function getScenarioFormInitialValues(
  scenario: ScenarioFormSource | undefined,
  locale: AppLocale,
  presets: readonly ScenarioPreset[] = [],
): ScenarioFormValues {
  const localized = (english: string | undefined, chinese: string | undefined) =>
    locale === "en" ? english || chinese || "" : chinese || english || "";
  return {
    name: localized(scenario?.name, scenario?.nameZhCn),
    description: localized(scenario?.description, scenario?.descriptionZhCn),
    trainingGoalPresetIds: scenario?.trainingGoalPresetIds ?? [],
    skillFocusPresetIds: scenario?.skillFocusPresetIds ?? [],
    successCriterionPresetIds: scenario?.successCriterionPresetIds ?? [],
    toneStylePresetId: scenario?.toneStylePresetId,
    voiceBehavior: scenario?.voiceBehavior ?? {},
    scoringEnabled: Boolean(scenario?.scoringCriteria.length),
    scoringCriteria:
      scenario?.scoringCriteria.map((criterion) => {
        const resolved = presets.find(
          (preset) =>
            preset.id === criterion.successCriterionPresetId &&
            preset.category === "success_criterion",
        );
        const english = "name" in criterion ? criterion.name : resolved?.value;
        const chinese =
          "nameZhCn" in criterion ? criterion.nameZhCn : resolved?.valueZhCn;
        return {
          successCriterionPresetId: criterion.successCriterionPresetId,
          displayName: localized(english, chinese),
          weight: criterion.weight,
        };
      }) ?? [],
  };
}

export function normalizeScenarioFormValues(
  values: ScenarioFormValues,
  locale: AppLocale,
  scenario: ScenarioFormSource | undefined,
  defaultAllowedPersonaIds: readonly number[] = [],
): ScenarioInput {
  const name = mergeText(
    values.name,
    locale,
    scenario?.name ?? "",
    scenario?.nameZhCn ?? "",
  );
  const description = mergeText(
    values.description,
    locale,
    scenario?.description ?? "",
    scenario?.descriptionZhCn ?? "",
  );
  return {
    name: name.en,
    nameZhCn: name.zhCn,
    description: description.en,
    descriptionZhCn: description.zhCn,
    trainingGoalPresetIds: values.trainingGoalPresetIds,
    skillFocusPresetIds: values.skillFocusPresetIds,
    successCriterionPresetIds: values.successCriterionPresetIds,
    toneStylePresetId: values.toneStylePresetId,
    voiceBehavior: values.voiceBehavior ?? {},
    scoringCriteria: values.scoringEnabled
      ? values.scoringCriteria.map((criterion) => ({
          successCriterionPresetId: criterion.successCriterionPresetId,
          weight: criterion.weight,
        }))
      : [],
    allowedPersonaIds: scenario?.allowedPersonaIds ?? [...defaultAllowedPersonaIds],
  };
}

/** Builds an exclusion hint from only the fields the operator actually touched. */
export function buildScenarioDraftGenerationContext(
  values: Partial<ScenarioFormValues>,
  locale: AppLocale,
): ScenarioDraftGenerationContext | undefined {
  const name = values.name?.trim();
  const description = values.description?.trim();
  return compactScenarioDraftGenerationContext({
    ...(name
      ? locale === "en"
        ? { name }
        : { nameZhCn: name }
      : {}),
    ...(description
      ? locale === "en"
        ? { description }
        : { descriptionZhCn: description }
      : {}),
    trainingGoalPresetIds: values.trainingGoalPresetIds,
    skillFocusPresetIds: values.skillFocusPresetIds,
    successCriterionPresetIds: values.successCriterionPresetIds,
    toneStylePresetId: values.toneStylePresetId,
    voiceBehavior: values.voiceBehavior,
  });
}
