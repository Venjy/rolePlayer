import type {
  Persona,
  PersonaPreset,
  PersonaPresetCategory,
} from "../../shared/role-play-catalog";
import type { AppLocale } from "../i18n";

export interface PersonaPresetSelectOption {
  label: string;
  value: string;
}

export type PersonaPresetOptions = Record<
  PersonaPresetCategory,
  PersonaPresetSelectOption[]
>;

const PRESET_CATEGORIES: PersonaPresetCategory[] = [
  "identity",
  "occupation",
  "personality_trait",
  "communication_style",
  "motivation",
  "concern",
];

function existingValuesByCategory(
  persona?: Persona,
): Record<PersonaPresetCategory, string[]> {
  return {
    identity: persona?.identity ? [persona.identity] : [],
    occupation: persona?.occupation ? [persona.occupation] : [],
    personality_trait: persona?.personalityTraits ?? [],
    communication_style: persona?.communicationStyle
      ? [persona.communicationStyle]
      : [],
    motivation: persona?.motivations ?? [],
    concern: persona?.concerns ?? [],
  };
}

/**
 * Keeps database ordering stable while making old/custom persona values
 * selectable. Presets are choices, not foreign keys, so an edited persona can
 * legitimately contain a value that is no longer offered for new personas.
 */
export function buildPersonaPresetOptions(
  presets: PersonaPreset[],
  locale: AppLocale,
  persona?: Persona,
): PersonaPresetOptions {
  const existingValues = existingValuesByCategory(persona);

  return Object.fromEntries(
    PRESET_CATEGORIES.map((category) => {
      const options = presets
        .filter((preset) => preset.category === category)
        .sort(
          (left, right) =>
            left.position - right.position ||
            left.value.localeCompare(right.value, "zh-CN"),
        )
        .map(({ value, valueEn }) => ({
          label: locale === "en" ? valueEn || value : value,
          value,
        }));
      const knownValues = new Set(options.map(({ value }) => value));

      for (const value of existingValues[category]) {
        if (!value || knownValues.has(value)) continue;
        options.push({
          label:
            locale === "en"
              ? `${value} (Existing value)`
              : `${value}（现有值）`,
          value,
        });
        knownValues.add(value);
      }

      return [category, options];
    }),
  ) as PersonaPresetOptions;
}
