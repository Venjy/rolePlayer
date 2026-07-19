import type {
  Persona,
  PersonaInput,
  PersonaPreset,
  PersonaPresetCategory,
} from "../../shared/role-play-catalog";
import { localizePersona } from "../../shared/role-play-localization";
import type { AppLocale } from "../i18n";

/** Form text is localized, while every preset selection is a language-neutral ID. */
export interface PersonaFormValues {
  name: string;
  gender: PersonaInput["gender"];
  age: number | null;
  occupationPresetId?: number;
  background?: string;
  personalityTraitPresetIds?: number[];
  communicationStylePresetId?: number;
  toneStylePresetId?: number;
  behaviorNotes?: string;
  motivationPresetIds?: number[];
  concernPresetIds?: number[];
  voice: PersonaInput["voice"];
  voiceBehavior: PersonaInput["voiceBehavior"];
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

export function normalizePersonaFormValues(
  values: PersonaFormValues,
  locale: AppLocale,
  persona: Persona | undefined,
): PersonaInput {
  const name = mergeText(
    values.name,
    locale,
    persona?.name ?? "",
    persona?.nameZhCn ?? "",
  );
  const background = mergeText(
    values.background ?? "",
    locale,
    persona?.background ?? "",
    persona?.backgroundZhCn ?? "",
  );
  const behaviorNotes = mergeText(
    values.behaviorNotes ?? "",
    locale,
    persona?.behaviorNotes ?? "",
    persona?.behaviorNotesZhCn ?? "",
  );

  return {
    name: name.en,
    nameZhCn: name.zhCn,
    gender: values.gender,
    age: values.age,
    occupationPresetId: values.occupationPresetId ?? 0,
    background: background.en,
    backgroundZhCn: background.zhCn,
    personalityTraitPresetIds: values.personalityTraitPresetIds ?? [],
    communicationStylePresetId: values.communicationStylePresetId ?? 0,
    toneStylePresetId: values.toneStylePresetId ?? 0,
    behaviorNotes: behaviorNotes.en,
    behaviorNotesZhCn: behaviorNotes.zhCn,
    motivationPresetIds: values.motivationPresetIds ?? [],
    concernPresetIds: values.concernPresetIds ?? [],
    voice: values.voice,
    voiceBehavior: values.voiceBehavior,
  };
}

export function getPersonaFormInitialValues(
  persona: Persona | undefined,
  locale: AppLocale,
  presets: readonly PersonaPreset[] = [],
): PersonaFormValues {
  const display = persona ? localizePersona(persona, locale) : undefined;
  const firstId = (category: PersonaPresetCategory) =>
    presets
      .filter((preset) => preset.category === category)
      .sort((left, right) => left.position - right.position)[0]?.id;
  return {
    name: display?.name ?? "",
    gender: persona?.gender ?? "unspecified",
    age: persona?.age ?? null,
    occupationPresetId: persona?.occupationPresetId ?? firstId("occupation"),
    background: display?.background ?? "",
    personalityTraitPresetIds:
      persona?.personalityTraitPresetIds ??
      (firstId("personality_trait") ? [firstId("personality_trait")!] : []),
    communicationStylePresetId:
      persona?.communicationStylePresetId ?? firstId("communication_style"),
    toneStylePresetId: persona?.toneStylePresetId ?? firstId("tone_style"),
    behaviorNotes: display?.behaviorNotes ?? "",
    motivationPresetIds: persona?.motivationPresetIds ?? [],
    concernPresetIds: persona?.concernPresetIds ?? [],
    voice: persona?.voice ?? "longanqian",
    voiceBehavior: persona?.voiceBehavior ?? {
      interruptFrequency: "medium",
      speakingPace: "normal",
    },
  };
}
