import { describe, expect, it } from "vitest";
import {
  compilePersonaInstructions,
  compileRolePlayInstructions,
  compileScenarioInstructions,
} from "../../src/shared/role-play-instructions";

const persona = {
  name: "Xiao Zhang",
  nameZhCn: "小张",
  gender: "female" as const,
  age: 29,
  occupation: "Delivery Rider",
  occupationZhCn: "外卖员",
  background: "Works long shifts.",
  backgroundZhCn: "每天工作时间很长。",
  personalityTraits: ["Pragmatic"],
  personalityTraitsZhCn: ["务实"],
  communicationStyle: "Direct and concise",
  communicationStyleZhCn: "直接简洁",
  behaviorNotes: "Ask for concrete prices.",
  behaviorNotesZhCn: "追问具体价格。",
  motivations: ["Save costs"],
  motivationsZhCn: ["节省成本"],
  concerns: ["Hidden fees"],
  concernsZhCn: ["隐藏费用"],
  voice: "longanlingxin" as const,
};

const scenario = {
  name: "Price objection",
  nameZhCn: "价格异议",
  description: "Handle a prospect who thinks the offer costs too much.",
  descriptionZhCn: "处理客户认为报价过高的情况。",
  goals: ["Understand the budget", "Explain value"],
  goalsZhCn: ["了解预算", "解释价值"],
  suggestedSkillFocus: ["Discovery", "Objection handling"],
  suggestedSkillFocusZhCn: ["需求发现", "异议处理"],
  successCriteria: ["Confirm the objection", "Agree on a next step"],
  successCriteriaZhCn: ["确认异议", "明确下一步"],
  toneStyle: "Firm but respectful",
  toneStyleZhCn: "坚定但尊重",
  voiceBehavior: {
    interruptFrequency: "medium" as const,
    speakingPace: "fast" as const,
  },
  scoringCriteria: [
    { name: "Confirm the objection", nameZhCn: "确认异议", weight: 50 },
    { name: "Agree on a next step", nameZhCn: "明确下一步", weight: 50 },
  ],
  allowedPersonaIds: ["persona_xiaozhang"],
};

describe("role-play Instructions", () => {
  it("deterministically combines standalone persona and scenario sections", () => {
    const first = compileRolePlayInstructions({
      persona,
      scenario,
      difficulty: "hard",
      locale: "en",
    });
    const second = compileRolePlayInstructions({
      persona,
      scenario,
      difficulty: "hard",
      locale: "en",
    });

    expect(first).toBe(second);
    expect(first).toContain("Name: Xiao Zhang");
    expect(first).toContain("Occupation: Delivery Rider");
    expect(first).toContain("Scenario: Price objection");
    expect(first).toContain("Confirm the objection: 50%");
    expect(first).toContain("Tone style: Firm but respectful");
    expect(first).toContain("Speak briskly");
    expect(first).toContain("Difficulty: hard");
  });

  it("keeps editor previews independent", () => {
    expect(compilePersonaInstructions(persona, "en")).not.toContain("Price objection");
    expect(compilePersonaInstructions(persona, "en")).not.toContain("Tone style:");
    expect(compileScenarioInstructions(scenario, "en")).not.toContain("Xiao Zhang");
    expect(compileScenarioInstructions(scenario, "en")).toContain("Tone style:");
  });

  it("uses the selected locale for every template label and rule", () => {
    const instructions = compileRolePlayInstructions({
      persona: {
        ...persona,
        name: persona.nameZhCn,
        occupation: persona.occupationZhCn,
        background: persona.backgroundZhCn,
        personalityTraits: persona.personalityTraitsZhCn,
        communicationStyle: persona.communicationStyleZhCn,
        behaviorNotes: persona.behaviorNotesZhCn,
        motivations: persona.motivationsZhCn,
        concerns: persona.concernsZhCn,
      },
      scenario: {
        ...scenario,
        name: scenario.nameZhCn,
        description: scenario.descriptionZhCn,
        goals: scenario.goalsZhCn,
        suggestedSkillFocus: scenario.suggestedSkillFocusZhCn,
        successCriteria: scenario.successCriteriaZhCn,
        toneStyle: scenario.toneStyleZhCn,
        scoringCriteria: scenario.scoringCriteria.map((criterion) => ({
          ...criterion,
          name: criterion.nameZhCn,
        })),
      },
      difficulty: "hard",
      locale: "zh",
    });

    expect(instructions).toContain("[客户角色]");
    expect(instructions).toContain("姓名: 小张");
    expect(instructions).toContain("性别: 女");
    expect(instructions).toContain("[销售训练场景]");
    expect(instructions).toContain("隐藏的评分权重:\n- 确认异议: 50%\n- 明确下一步: 50%");
    expect(instructions).toContain("难度: 困难");
    expect(instructions).toContain("[不可违反的规则]");
    expect(instructions).not.toContain("[CUSTOMER PERSONA]");
    expect(instructions).not.toContain("Difficulty:");
  });

  it("omits the optional scenario voice section when it is not configured", () => {
    expect(
      compileScenarioInstructions({
        ...scenario,
        toneStyle: "",
        toneStyleZhCn: "",
        voiceBehavior: {},
      }, "en"),
    ).not.toContain("SCENARIO VOICE BEHAVIOR");
  });

  it("omits empty optional persona fields instead of emitting empty labels", () => {
    const instructions = compilePersonaInstructions({
      ...persona,
      age: null,
      background: "   ",
      behaviorNotes: "",
      motivations: ["", "   "],
      concerns: [],
    }, "en");

    expect(instructions).not.toContain("Age:");
    expect(instructions).not.toContain("Background:");
    expect(instructions).not.toContain("Behavior notes:");
    expect(instructions).not.toContain("Motivations:");
    expect(instructions).not.toContain("Concerns and likely objections:");
  });

  it("omits blank list values and scoring names from scenario Instructions", () => {
    const instructions = compileScenarioInstructions({
      ...scenario,
      suggestedSkillFocus: ["", "  Discovery  ", "   "],
      scoringCriteria: [
        { name: "", nameZhCn: "", weight: 50 },
        { name: "  Agree on a next step  ", nameZhCn: "", weight: 50 },
      ],
    }, "en");

    expect(instructions).toContain("Suggested skill focus:\n- Discovery");
    expect(instructions).toContain("Hidden scoring weights:\n- Agree on a next step: 50%");
    expect(instructions).not.toContain("\n- : 50%");
  });
});
