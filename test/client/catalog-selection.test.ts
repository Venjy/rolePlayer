import { describe, expect, it } from "vitest";
import type {
  Persona,
  RolePlayCatalog,
  Scenario,
} from "../../src/shared/role-play-catalog";
import {
  getCompatiblePersonas,
  reconcileCatalogSelection,
  resolvePersona,
  resolveScenario,
} from "../../src/client/catalog/catalog-selection";

const timestamp = "2026-07-18T00:00:00.000Z";

function persona(id: string): Persona {
  return {
    id,
    name: id,
    gender: "unspecified",
    age: null,
    occupation: "",
    identity: "buyer",
    background: "",
    personalityTraits: ["thoughtful"],
    communicationStyle: "concise",
    behaviorNotes: "",
    motivations: [],
    concerns: [],
    voice: "longanqian",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function scenario(id: string, allowedPersonaIds: string[]): Scenario {
  return {
    id,
    name: id,
    description: "A sales call",
    goals: ["Discover needs"],
    suggestedSkillFocus: ["Discovery"],
    successCriteria: ["Ask an open question"],
    scoringCriteria: [],
    allowedPersonaIds,
    voiceBehavior: {
      interruptFrequency: "low",
      speakingPace: "normal",
      toneStyle: "neutral",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const catalog: RolePlayCatalog = {
  personaPresets: [],
  personas: [persona("alex"), persona("xiaozhang")],
  scenarios: [
    scenario("discovery", ["alex"]),
    scenario("delivery", ["xiaozhang"]),
  ],
};

describe("catalog selection", () => {
  it("keeps valid preferred selections", () => {
    const selectedScenario = resolveScenario(catalog, "delivery");

    expect(selectedScenario?.id).toBe("delivery");
    expect(resolvePersona(catalog, selectedScenario, "xiaozhang")?.id).toBe(
      "xiaozhang",
    );
  });

  it("falls back after an item is removed or becomes incompatible", () => {
    const selectedScenario = resolveScenario(catalog, "removed");

    expect(selectedScenario?.id).toBe("discovery");
    expect(resolvePersona(catalog, selectedScenario, "xiaozhang")?.id).toBe(
      "alex",
    );
    expect(getCompatiblePersonas(catalog, selectedScenario)).toHaveLength(1);
  });

  it("returns no persona when a catalog has no compatible option", () => {
    const emptyScenario = scenario("empty", ["missing"]);
    expect(resolvePersona(catalog, emptyScenario)).toBeUndefined();
  });

  it("locks in the visible fallback and clears stale preferences", () => {
    const initial = reconcileCatalogSelection(catalog, {
      scenarioId: null,
      personaId: null,
    });
    expect(initial).toEqual({ scenarioId: "discovery", personaId: "alex" });

    const withEarlierScenario: RolePlayCatalog = {
      ...catalog,
      scenarios: [scenario("a-new", ["xiaozhang"]), ...catalog.scenarios],
    };
    expect(reconcileCatalogSelection(withEarlierScenario, initial)).toEqual(
      initial,
    );

    const compatibilityChanged: RolePlayCatalog = {
      ...catalog,
      scenarios: [scenario("discovery", ["xiaozhang"])],
    };
    expect(
      reconcileCatalogSelection(compatibilityChanged, initial),
    ).toEqual({ scenarioId: "discovery", personaId: "xiaozhang" });
  });
});
