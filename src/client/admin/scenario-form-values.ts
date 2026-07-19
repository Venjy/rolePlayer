import type {
  Scenario,
  ScenarioInput,
  ScenarioPreset,
} from "../../shared/role-play-catalog";
import { localizeScenario } from "../../shared/role-play-localization";
import type { AppLocale } from "../i18n";

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
  scoringCriteria: ScoringCriterionFormValue[];
}

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

/** Evenly distributes whole percentages and puts rounding units at the end. */
export function distributeScoringWeights(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(100 / count);
  const remainder = 100 - base * count;
  return Array.from({ length: count }, (_, index) =>
    index >= count - remainder ? base + 1 : base,
  );
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
  scenario: Scenario | undefined,
  locale: AppLocale,
): ScenarioFormValues {
  const display = scenario ? localizeScenario(scenario, locale) : undefined;
  return {
    name: display?.name ?? "",
    description: display?.description ?? "",
    trainingGoalPresetIds: scenario?.trainingGoalPresetIds ?? [],
    skillFocusPresetIds: scenario?.skillFocusPresetIds ?? [],
    successCriterionPresetIds: scenario?.successCriterionPresetIds ?? [],
    scoringCriteria:
      scenario?.scoringCriteria.map((criterion) => ({
        successCriterionPresetId: criterion.successCriterionPresetId,
        displayName:
          locale === "en"
            ? criterion.name || criterion.nameZhCn
            : criterion.nameZhCn || criterion.name,
        weight: criterion.weight,
      })) ?? [],
  };
}

export function normalizeScenarioFormValues(
  values: ScenarioFormValues,
  locale: AppLocale,
  scenario: Scenario | undefined,
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
    scoringCriteria: values.scoringCriteria.map((criterion) => ({
      successCriterionPresetId: criterion.successCriterionPresetId,
      weight: criterion.weight,
    })),
    allowedPersonaIds: scenario?.allowedPersonaIds ?? [...defaultAllowedPersonaIds],
  };
}
