import type {
  PersonaPreset,
  PersonaPresetCategory,
} from "../../shared/role-play-catalog";
import type { AppLocale } from "../i18n";

export interface PersonaPresetSelectOption {
  label: string;
  value: number;
}

export type PersonaPresetOptions = Record<
  PersonaPresetCategory,
  PersonaPresetSelectOption[]
>;

const PRESET_CATEGORIES: PersonaPresetCategory[] = [
  "occupation",
  "personality_trait",
  "communication_style",
  "motivation",
  "concern",
];

/** Select values are stable database IDs; only their labels are localized. */
export function buildPersonaPresetOptions(
  presets: readonly PersonaPreset[],
  locale: AppLocale,
): PersonaPresetOptions {
  return Object.fromEntries(
    PRESET_CATEGORIES.map((category) => [
      category,
      presets
        .filter((preset) => preset.category === category)
        .sort((left, right) => left.position - right.position || left.id - right.id)
        .map((preset) => ({
          label:
            locale === "en"
              ? preset.value || preset.valueZhCn
              : preset.valueZhCn || preset.value,
          value: preset.id,
        })),
    ]),
  ) as PersonaPresetOptions;
}
