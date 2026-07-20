import { describe, expect, it } from "vitest";
import type {
  Scenario,
  ScenarioInput,
  ScenarioPreset,
} from "../../src/shared/role-play-catalog";
import {
  buildScoringCriteriaForSuccessCriteria,
  buildScenarioDraftGenerationContext,
  distributeScoringWeights,
  getScenarioFormInitialValues,
  normalizeScenarioFormValues,
  type ScenarioFormValues,
} from "../../src/client/admin/scenario-form-values";

const timestamp = "2026-07-18T00:00:00.000Z";
const presets: ScenarioPreset[] = [1, 2, 3].map((id) => ({
  id,
  category: "success_criterion",
  value: `Criterion ${id}`,
  valueZhCn: `标准 ${id}`,
  position: id - 1,
  createdAt: timestamp,
  updatedAt: timestamp,
}));
function chineseValues(): ScenarioFormValues {
  return {
    name: "价格异议处理",
    description: "客户认为报价超出预算。",
    trainingGoalPresetIds: [4],
    skillFocusPresetIds: [5],
    successCriterionPresetIds: [1],
    toneStylePresetId: 6,
    voiceBehavior: { interruptFrequency: "medium", speakingPace: "normal" },
    scoringEnabled: true,
    scoringCriteria: [
      { successCriterionPresetId: 1, displayName: "标准 1", weight: 100 },
    ],
  };
}
const chineseScenario: Scenario = {
  ...normalizeScenarioFormValues(chineseValues(), "zh", undefined, [1]),
  goals: ["Clarify the objection"],
  goalsZhCn: ["澄清真实异议"],
  suggestedSkillFocus: ["Objection handling"],
  suggestedSkillFocusZhCn: ["异议处理"],
  successCriteria: ["Criterion 1"],
  successCriteriaZhCn: ["标准 1"],
  toneStyle: "Professional and composed",
  toneStyleZhCn: "专业沉稳",
  scoringCriteria: [{
    successCriterionPresetId: 1,
    name: "Criterion 1",
    nameZhCn: "标准 1",
    weight: 100,
  }],
  id: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("scenario form values", () => {
  it("omits a fully blank partial draft from random generation", () => {
    expect(
      buildScenarioDraftGenerationContext(
        {
          name: " ",
          description: "",
          trainingGoalPresetIds: [],
          skillFocusPresetIds: [],
          successCriterionPresetIds: [],
          voiceBehavior: {},
        },
        "en",
      ),
    ).toBeUndefined();
  });

  it("writes localized free text and stores preset IDs", () => {
    expect(normalizeScenarioFormValues(chineseValues(), "zh", undefined, [1]))
      .toMatchObject({
        name: "",
        nameZhCn: "价格异议处理",
        trainingGoalPresetIds: [4],
        successCriterionPresetIds: [1],
        scoringCriteria: [{ successCriterionPresetId: 1, weight: 100 }],
        allowedPersonaIds: [1],
      });
  });

  it("keeps selected success criteria while omitting optional scoring weights", () => {
    const normalized = normalizeScenarioFormValues(
      { ...chineseValues(), scoringEnabled: false },
      "zh",
      undefined,
      [1],
    );
    expect(normalized).toMatchObject({
      successCriterionPresetIds: [1],
      scoringCriteria: [],
    });
  });

  it("starts a blank scenario with scoring disabled", () => {
    expect(getScenarioFormInitialValues(undefined, "zh", presets)).toMatchObject({
      trainingGoalPresetIds: [],
      skillFocusPresetIds: [],
      successCriterionPresetIds: [],
      scoringEnabled: false,
      scoringCriteria: [],
    });
  });

  it("preserves Chinese while adding English", () => {
    const englishForm = getScenarioFormInitialValues(chineseScenario, "en");
    const updated = normalizeScenarioFormValues(
      { ...englishForm, name: "Handling a price objection" },
      "en",
      chineseScenario,
    );
    expect(updated).toMatchObject({
      name: "Handling a price objection",
      nameZhCn: "价格异议处理",
      trainingGoalPresetIds: [4],
    });
  });

  it("distributes integer weights evenly and always totals 100", () => {
    expect(distributeScoringWeights(3)).toEqual([33, 33, 34]);
    expect(distributeScoringWeights(6)).toEqual([16, 16, 17, 17, 17, 17]);
    const criteria = buildScoringCriteriaForSuccessCriteria([1, 2, 3], presets, "en");
    expect(criteria.map(({ weight }) => weight)).toEqual([33, 33, 34]);
  });

  it("preserves both model-generated languages when the visible draft is saved", () => {
    const generated: ScenarioInput = {
      ...normalizeScenarioFormValues(chineseValues(), "zh", undefined, [1]),
      name: "Price objection review",
      nameZhCn: "价格异议评估",
      description: "The customer is comparing a lower-priced competitor.",
      descriptionZhCn: "客户正在比较一家价格更低的竞争对手。",
    };
    const visibleChinese = getScenarioFormInitialValues(
      generated,
      "zh",
      presets,
    );
    const saved = normalizeScenarioFormValues(
      { ...visibleChinese, description: "客户预算比报价低百分之二十。" },
      "zh",
      generated,
    );
    expect(saved).toMatchObject({
      name: "Price objection review",
      nameZhCn: "价格异议评估",
      description: "The customer is comparing a lower-priced competitor.",
      descriptionZhCn: "客户预算比报价低百分之二十。",
    });
  });
});
