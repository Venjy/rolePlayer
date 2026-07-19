import type {
  ResolvedPersonaInput,
  RolePlayCatalog,
  ResolvedScenarioInput,
} from "./role-play-catalog";

export type CatalogLocale = "en" | "zh";

export function localizedText(
  english: string,
  chinese: string,
  locale: CatalogLocale,
): string {
  return locale === "en" ? english || chinese : chinese || english;
}

export function localizedList(
  english: readonly string[],
  chinese: readonly string[],
  locale: CatalogLocale,
): string[] {
  const preferred = locale === "en" ? english : chinese;
  const fallback = locale === "en" ? chinese : english;
  return [...(preferred.length > 0 ? preferred : fallback)];
}

/** Projects one locale for display/prompt compilation without losing source fields. */
export function localizePersonaInput(
  persona: ResolvedPersonaInput,
  locale: CatalogLocale,
): ResolvedPersonaInput {
  return {
    ...persona,
    name: localizedText(persona.name, persona.nameZhCn, locale),
    occupation: localizedText(
      persona.occupation,
      persona.occupationZhCn,
      locale,
    ),
    background: localizedText(
      persona.background,
      persona.backgroundZhCn,
      locale,
    ),
    personalityTraits: localizedList(
      persona.personalityTraits,
      persona.personalityTraitsZhCn,
      locale,
    ),
    communicationStyle: localizedText(
      persona.communicationStyle,
      persona.communicationStyleZhCn,
      locale,
    ),
    behaviorNotes: localizedText(
      persona.behaviorNotes,
      persona.behaviorNotesZhCn,
      locale,
    ),
    motivations: localizedList(
      persona.motivations,
      persona.motivationsZhCn,
      locale,
    ),
    concerns: localizedList(persona.concerns, persona.concernsZhCn, locale),
  };
}

export function localizePersona<T extends ResolvedPersonaInput>(
  persona: T,
  locale: CatalogLocale,
): T {
  return { ...persona, ...localizePersonaInput(persona, locale) };
}

export function localizeScenarioInput(
  scenario: ResolvedScenarioInput,
  locale: CatalogLocale,
): ResolvedScenarioInput {
  return {
    ...scenario,
    name: localizedText(scenario.name, scenario.nameZhCn, locale),
    description: localizedText(
      scenario.description,
      scenario.descriptionZhCn,
      locale,
    ),
    goals: localizedList(scenario.goals, scenario.goalsZhCn, locale),
    suggestedSkillFocus: localizedList(
      scenario.suggestedSkillFocus,
      scenario.suggestedSkillFocusZhCn,
      locale,
    ),
    successCriteria: localizedList(
      scenario.successCriteria,
      scenario.successCriteriaZhCn,
      locale,
    ),
    toneStyle: localizedText(
      scenario.toneStyle,
      scenario.toneStyleZhCn,
      locale,
    ),
    scoringCriteria: scenario.scoringCriteria.map((criterion) => ({
      ...criterion,
      name: localizedText(criterion.name, criterion.nameZhCn, locale),
    })),
  };
}

export function localizeScenario<T extends ResolvedScenarioInput>(
  scenario: T,
  locale: CatalogLocale,
): T {
  return { ...scenario, ...localizeScenarioInput(scenario, locale) };
}

export function localizeCatalog(
  catalog: RolePlayCatalog,
  locale: CatalogLocale,
): RolePlayCatalog {
  return {
    ...catalog,
    personas: catalog.personas.map((persona) =>
      localizePersona(persona, locale),
    ),
    scenarios: catalog.scenarios.map((scenario) =>
      localizeScenario(scenario, locale),
    ),
  };
}
