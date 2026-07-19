import type {
  PersonaInput,
  ScenarioInput,
  ScenarioPreset,
  ScenarioPresetCategory,
} from "../../shared/role-play-catalog";
import { translate, type AppLocale } from "../i18n/locale";
export { getVoiceOptions } from "../catalog/qwen-voice-options";

export function getGenderOptions(locale: AppLocale) {
  return [
    { value: "female", label: translate(locale, { en: "Female", zh: "女" }) },
    { value: "male", label: translate(locale, { en: "Male", zh: "男" }) },
    {
      value: "non_binary",
      label: translate(locale, { en: "Non-binary", zh: "非二元" }),
    },
    {
      value: "unspecified",
      label: translate(locale, { en: "Not specified", zh: "未指定" }),
    },
  ] satisfies Array<{ value: PersonaInput["gender"]; label: string }>;
}

export function getInterruptFrequencyOptions(locale: AppLocale) {
  return [
    {
      value: "low",
      label: translate(locale, {
        en: "Low · Patient, rarely challenges",
        zh: "低 · 耐心，较少挑战",
      }),
    },
    {
      value: "medium",
      label: translate(locale, {
        en: "Medium · Occasional brief interjections",
        zh: "中 · 偶尔简短插话",
      }),
    },
    {
      value: "high",
      label: translate(locale, {
        en: "High · Frequent, quick challenges",
        zh: "高 · 频繁、快速挑战",
      }),
    },
  ] satisfies Array<{
    value: NonNullable<ScenarioInput["voiceBehavior"]["interruptFrequency"]>;
    label: string;
  }>;
}

export function getSpeakingPaceOptions(locale: AppLocale) {
  return [
    { value: "slow", label: translate(locale, { en: "Slow", zh: "慢" }) },
    {
      value: "normal",
      label: translate(locale, { en: "Normal", zh: "正常" }),
    },
    { value: "fast", label: translate(locale, { en: "Fast", zh: "快" }) },
  ] satisfies Array<{
    value: NonNullable<ScenarioInput["voiceBehavior"]["speakingPace"]>;
    label: string;
  }>;
}

export function getScenarioPresetOptions(
  presets: readonly ScenarioPreset[],
  category: ScenarioPresetCategory,
  locale: AppLocale,
) {
  return presets
    .filter((preset) => preset.category === category)
    .sort((left, right) => left.position - right.position)
    .map((preset) => {
      const value =
        locale === "en"
          ? preset.value || preset.valueZhCn
          : preset.valueZhCn || preset.value;
      return { label: value, value: preset.id };
    });
}

export function getFallbackScenario(): ScenarioInput {
  return {
    name: "",
    nameZhCn: "",
    description: "",
    descriptionZhCn: "",
    trainingGoalPresetIds: [],
    skillFocusPresetIds: [],
    successCriterionPresetIds: [],
    toneStylePresetId: undefined,
    voiceBehavior: {},
    scoringCriteria: [],
    allowedPersonaIds: [1],
  };
}

export function getFallbackPersona(): PersonaInput {
  return {
    name: "",
    nameZhCn: "",
    gender: "unspecified",
    age: null,
    occupationPresetId: 1,
    background: "",
    backgroundZhCn: "",
    personalityTraitPresetIds: [],
    communicationStylePresetId: 1,
    behaviorNotes: "",
    behaviorNotesZhCn: "",
    motivationPresetIds: [],
    concernPresetIds: [],
    voice: "longanqian",
  };
}

export function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function includesSearchText(
  query: string,
  ...values: Array<string | readonly string[] | null | undefined>
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}
