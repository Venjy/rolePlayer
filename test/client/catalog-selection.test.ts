import { describe, expect, it } from "vitest";
import type { Persona, RolePlayCatalog, Scenario } from "../../src/shared/role-play-catalog";
import { getCompatiblePersonas, reconcileCatalogSelection, resolvePersona, resolveScenario } from "../../src/client/catalog/catalog-selection";

const timestamp = "2026-07-18T00:00:00.000Z";
function persona(id: number): Persona {
  return {
    id, name: `Persona ${id}`, nameZhCn: "", gender: "unspecified", age: null,
    occupationPresetId: 1,
    occupation: "Buyer", occupationZhCn: "", background: "", backgroundZhCn: "",
    personalityTraits: ["Thoughtful"], personalityTraitsZhCn: [],
    personalityTraitPresetIds: [2],
    communicationStyle: "Concise", communicationStyleZhCn: "",
    communicationStylePresetId: 3,
    behaviorNotes: "", behaviorNotesZhCn: "",
    motivations: [], motivationsZhCn: [], motivationPresetIds: [],
    concerns: [], concernsZhCn: [], concernPresetIds: [],
    voice: "longanqian",
    createdAt: timestamp, updatedAt: timestamp,
  };
}
function scenario(id: number, allowedPersonaIds: number[]): Scenario {
  return {
    id, name: `Scenario ${id}`, nameZhCn: "", description: "Sales call", descriptionZhCn: "",
    trainingGoalPresetIds: [1],
    goals: ["Discover needs"], goalsZhCn: [], suggestedSkillFocus: ["Discovery"], suggestedSkillFocusZhCn: [],
    skillFocusPresetIds: [2],
    successCriterionPresetIds: [3],
    successCriteria: ["Ask a question"], successCriteriaZhCn: [],
    toneStyle: "Neutral", toneStyleZhCn: "", toneStylePresetId: 4,
    voiceBehavior: { interruptFrequency: "low", speakingPace: "normal" },
    scoringCriteria: [{ successCriterionPresetId: 3, name: "Ask a question", nameZhCn: "", weight: 100 }],
    allowedPersonaIds, createdAt: timestamp, updatedAt: timestamp,
  };
}
const catalog: RolePlayCatalog = {
  qwenVoices: [],
  personaPresets: [], scenarioPresets: [], personas: [persona(1), persona(2)],
  scenarios: [scenario(1, [1]), scenario(2, [2])],
};

describe("catalog selection", () => {
  it("keeps valid selections and falls back from invalid ones", () => {
    expect(resolveScenario(catalog, 2)?.id).toBe(2);
    const fallback = resolveScenario(catalog, 999);
    expect(resolvePersona(catalog, fallback, 2)?.id).toBe(1);
    expect(getCompatiblePersonas(catalog, fallback)).toHaveLength(1);
  });

  it("reconciles changed compatibility", () => {
    const initial = reconcileCatalogSelection(catalog, { scenarioId: null, personaId: null });
    expect(initial).toEqual({ scenarioId: 1, personaId: 1 });
    expect(reconcileCatalogSelection({ ...catalog, scenarios: [scenario(1, [2])] }, initial))
      .toEqual({ scenarioId: 1, personaId: 2 });
  });
});
