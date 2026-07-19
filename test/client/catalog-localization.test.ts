import { describe, expect, it } from "vitest";
import type { Persona, Scenario } from "../../src/shared/role-play-catalog";
import { localizePersona, localizeScenario } from "../../src/client/catalog/catalog-localization";

const timestamp = "2026-07-18T00:00:00.000Z";
const persona: Persona = {
  id: 1,
  name: "Lin Yue", nameZhCn: "林悦", gender: "female", age: 35,
  occupationPresetId: 1,
  occupation: "Marketing Director", occupationZhCn: "市场总监",
  background: "Responsible for growth.", backgroundZhCn: "负责企业增长。",
  personalityTraits: ["Pragmatic"], personalityTraitsZhCn: ["务实"],
  personalityTraitPresetIds: [2],
  communicationStyle: "Concise", communicationStyleZhCn: "简洁",
  communicationStylePresetId: 3,
  toneStyle: "Professional", toneStyleZhCn: "专业",
  toneStylePresetId: 4,
  behaviorNotes: "Asks for data.", behaviorNotesZhCn: "追问数据。",
  motivations: ["Growth"], motivationsZhCn: ["增长"],
  motivationPresetIds: [5],
  concerns: ["ROI"], concernsZhCn: ["投入产出比"],
  concernPresetIds: [6],
  voice: "longanqian",
  voiceBehavior: { interruptFrequency: "low", speakingPace: "normal" },
  createdAt: timestamp, updatedAt: timestamp,
};
const scenario: Scenario = {
  id: 1,
  name: "Discovery", nameZhCn: "需求探索",
  description: "Discover needs.", descriptionZhCn: "发现需求。",
  trainingGoalPresetIds: [1],
  goals: ["Understand context"], goalsZhCn: ["了解背景"],
  skillFocusPresetIds: [2],
  suggestedSkillFocus: ["Discovery"], suggestedSkillFocusZhCn: ["需求发现"],
  successCriterionPresetIds: [3],
  successCriteria: ["Agree on a next step"], successCriteriaZhCn: ["确认下一步"],
  scoringCriteria: [{ successCriterionPresetId: 3, name: "Agree on a next step", nameZhCn: "确认下一步", weight: 100 }],
  allowedPersonaIds: [persona.id], createdAt: timestamp, updatedAt: timestamp,
};

describe("catalog localization", () => {
  it("projects English and Chinese from explicit fields", () => {
    expect(localizePersona(persona, "zh")).toMatchObject({ name: "林悦", occupation: "市场总监" });
    expect(localizeScenario(scenario, "en")).toMatchObject({ name: "Discovery", goals: ["Understand context"] });
  });

  it("falls back without copying the fallback into storage", () => {
    const chineseOnly = { ...persona, name: "", nameZhCn: "张三" };
    expect(localizePersona(chineseOnly, "en").name).toBe("张三");
    expect(chineseOnly.name).toBe("");
  });
});
