import type {
  Persona,
  PersonaInput,
  PersonaPreset,
  PersonaPresetCategory,
} from "../../shared/role-play-catalog";
import type { AppLocale } from "../i18n";

type PersonaFormSource = Persona | PersonaInput;

/** Form text is localized, while every preset selection is a language-neutral ID. */
export interface PersonaFormValues {
  name: string;
  gender: PersonaInput["gender"];
  age: number | null;
  occupationPresetId?: number;
  background?: string;
  personalityTraitPresetIds?: number[];
  communicationStylePresetId?: number;
  behaviorNotes?: string;
  motivationPresetIds?: number[];
  concernPresetIds?: number[];
  voice: PersonaInput["voice"];
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
  persona: PersonaFormSource | undefined,
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
    behaviorNotes: behaviorNotes.en,
    behaviorNotesZhCn: behaviorNotes.zhCn,
    motivationPresetIds: values.motivationPresetIds ?? [],
    concernPresetIds: values.concernPresetIds ?? [],
    voice: values.voice,
  };
}

export function getPersonaFormInitialValues(
  persona: PersonaFormSource | undefined,
  locale: AppLocale,
  presets: readonly PersonaPreset[] = [],
): PersonaFormValues {
  const localized = (english: string | undefined, chinese: string | undefined) =>
    locale === "en" ? english || chinese || "" : chinese || english || "";
  const firstId = (category: PersonaPresetCategory) =>
    presets
      .filter((preset) => preset.category === category)
      .sort((left, right) => left.position - right.position)[0]?.id;
  return {
    name: localized(persona?.name, persona?.nameZhCn),
    gender: persona?.gender ?? "unspecified",
    age: persona?.age ?? null,
    occupationPresetId: persona?.occupationPresetId ?? firstId("occupation"),
    background: localized(persona?.background, persona?.backgroundZhCn),
    personalityTraitPresetIds:
      persona?.personalityTraitPresetIds ??
      (firstId("personality_trait") ? [firstId("personality_trait")!] : []),
    communicationStylePresetId:
      persona?.communicationStylePresetId ?? firstId("communication_style"),
    behaviorNotes: localized(persona?.behaviorNotes, persona?.behaviorNotesZhCn),
    motivationPresetIds: persona?.motivationPresetIds ?? [],
    concernPresetIds: persona?.concernPresetIds ?? [],
    voice: persona?.voice ?? "longanqian",
  };
}
