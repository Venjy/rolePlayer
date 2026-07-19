import type {
  Persona,
  RolePlayCatalog,
  Scenario,
} from "../../shared/role-play-catalog";

export interface CatalogSelection {
  scenarioId: number | null;
  personaId: number | null;
}

export function resolveScenario(
  catalog: RolePlayCatalog,
  preferredId?: number,
): Scenario | undefined {
  return (
    catalog.scenarios.find((scenario) => scenario.id === preferredId) ??
    catalog.scenarios[0]
  );
}

export function getCompatiblePersonas(
  catalog: RolePlayCatalog,
  scenario?: Scenario,
): Persona[] {
  if (!scenario) return [];
  const allowedIds = new Set(scenario.allowedPersonaIds);
  return catalog.personas.filter((persona) => allowedIds.has(persona.id));
}

export function resolvePersona(
  catalog: RolePlayCatalog,
  scenario: Scenario | undefined,
  preferredId?: number,
): Persona | undefined {
  const compatiblePersonas = getCompatiblePersonas(catalog, scenario);
  return (
    compatiblePersonas.find((persona) => persona.id === preferredId) ??
    compatiblePersonas[0]
  );
}

export function reconcileCatalogSelection(
  catalog: RolePlayCatalog,
  current: CatalogSelection,
): CatalogSelection {
  const scenario = resolveScenario(catalog, current.scenarioId ?? undefined);
  const persona = resolvePersona(
    catalog,
    scenario,
    current.personaId ?? undefined,
  );
  return {
    scenarioId: scenario?.id ?? null,
    personaId: persona?.id ?? null,
  };
}
