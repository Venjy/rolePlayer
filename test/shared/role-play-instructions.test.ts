import { describe, expect, it } from "vitest";
import { compileRolePlayInstructions } from "../../src/shared/role-play-instructions";

const persona = {
  name: "小张",
  gender: "female" as const,
  age: 29,
  occupation: "外卖员",
  identity: "A time-pressed potential customer comparing mobile plans",
  background: "Works long shifts and values predictable monthly costs.",
  personalityTraits: ["务实", "谨慎"],
  communicationStyle: "直接、简短",
  behaviorNotes: "Ask for concrete prices before agreeing.",
  motivations: ["降低每月支出"],
  concerns: ["隐藏费用"],
  voice: "longanlingxin" as const,
};

const scenario = {
  name: "价格异议",
  description: "The learner must handle a prospect who thinks the offer costs too much.",
  goals: ["Understand the budget", "Explain value"],
  suggestedSkillFocus: ["Discovery", "Objection handling"],
  successCriteria: ["Confirm the real objection", "Agree on a next step"],
  scoringCriteria: [
    { name: "Discovery", weight: 40 },
    { name: "Objection handling", weight: 60 },
  ],
  allowedPersonaIds: ["persona_xiaozhang"],
  voiceBehavior: {
    interruptFrequency: "medium" as const,
    speakingPace: "fast" as const,
    toneStyle: "Skeptical but respectful",
  },
};

describe("compileRolePlayInstructions", () => {
  it("turns structured persona and scenario fields into stable instructions", () => {
    const first = compileRolePlayInstructions({
      persona,
      scenario,
      difficulty: "hard",
    });
    const second = compileRolePlayInstructions({
      persona,
      scenario,
      difficulty: "hard",
    });

    expect(first).toBe(second);
    expect(first).toContain("Name: 小张");
    expect(first).toContain("Gender: female");
    expect(first).toContain("Occupation: 外卖员");
    expect(first).toContain("Scenario: 价格异议");
    expect(first).toContain("Difficulty: hard");
    expect(first).toContain("Discovery: 40%");
    expect(first).toContain("same language the learner uses");
  });

  it("omits empty optional fields without emitting undefined values", () => {
    const instructions = compileRolePlayInstructions({
      persona: {
        ...persona,
        age: null,
        occupation: "",
        background: "",
        behaviorNotes: "",
        motivations: [],
        concerns: [],
      },
      scenario: { ...scenario, scoringCriteria: [] },
      difficulty: "easy",
    });

    expect(instructions).not.toContain("Age:");
    expect(instructions).not.toContain("Occupation:");
    expect(instructions).not.toContain("undefined");
  });
});
