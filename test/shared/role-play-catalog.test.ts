import { describe, expect, it } from "vitest";
import {
  personaInputSchema,
  scenarioInputSchema,
} from "../../src/shared/role-play-catalog";

const minimalPersona = {
  name: "Taylor",
  nameZhCn: "",
  gender: "unspecified" as const,
  age: null,
  occupationPresetId: 1,
  background: "",
  backgroundZhCn: "",
  personalityTraitPresetIds: [2],
  communicationStylePresetId: 3,
  toneStylePresetId: 4,
  behaviorNotes: "",
  behaviorNotesZhCn: "",
  motivationPresetIds: [],
  concernPresetIds: [],
  voice: "longanqian" as const,
  voiceBehavior: {
    interruptFrequency: "medium" as const,
    speakingPace: "normal" as const,
  },
};

const minimalScenario = {
  name: "Discovery call",
  nameZhCn: "",
  description: "Qualify a potential customer.",
  descriptionZhCn: "",
  trainingGoalPresetIds: [1],
  skillFocusPresetIds: [2],
  successCriterionPresetIds: [3],
  scoringCriteria: [
    { successCriterionPresetId: 3, weight: 100 },
  ],
  allowedPersonaIds: [],
};

describe("role-play catalog field requirements", () => {
  it("accepts a persona with every optional field empty", () => {
    expect(personaInputSchema.safeParse(minimalPersona).success).toBe(true);
  });

  it.each([
    ["name", { name: "" }],
    ["occupation", { occupationPresetId: 0 }],
    ["personality traits", { personalityTraitPresetIds: [] }],
    ["communication style", { communicationStylePresetId: 0 }],
    ["tone style", { toneStylePresetId: 0 }],
  ])("rejects a persona without required %s", (_label, update) => {
    expect(
      personaInputSchema.safeParse({ ...minimalPersona, ...update }).success,
    ).toBe(false);
  });

  it("accepts a scenario with empty compatibility", () => {
    expect(scenarioInputSchema.safeParse(minimalScenario).success).toBe(true);
  });

  it.each([
    ["name", { name: "" }],
    ["description", { description: "" }],
    ["training goals", { trainingGoalPresetIds: [] }],
    ["focus skills", { skillFocusPresetIds: [] }],
    [
      "success criteria",
      { successCriterionPresetIds: [], scoringCriteria: [] },
    ],
  ])("rejects a scenario without required %s", (_label, update) => {
    expect(
      scenarioInputSchema.safeParse({ ...minimalScenario, ...update }).success,
    ).toBe(false);
  });
});
