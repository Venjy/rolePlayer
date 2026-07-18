import { describe, expect, it } from "vitest";
import {
  normalizePersonaFormValues,
  type PersonaFormValues,
} from "../../src/client/admin/persona-form-values";

describe("persona form normalization", () => {
  it("normalizes cleared optional controls without throwing", () => {
    const values: PersonaFormValues = {
      name: "测试角色",
      gender: "unspecified",
      age: null,
      occupation: undefined,
      identity: "业务部门的最终决策者",
      background: undefined,
      personalityTraits: [" 务实 ", ""],
      communicationStyle: "简洁直接",
      behaviorNotes: undefined,
      motivations: undefined,
      concerns: [" 投入产出比 "],
      voice: "longanqian",
      previewScenarioId: "scenario-preview-only",
    };

    expect(normalizePersonaFormValues(values)).toEqual({
      name: "测试角色",
      gender: "unspecified",
      age: null,
      occupation: "",
      identity: "业务部门的最终决策者",
      background: "",
      personalityTraits: ["务实"],
      communicationStyle: "简洁直接",
      behaviorNotes: "",
      motivations: [],
      concerns: ["投入产出比"],
      voice: "longanqian",
    });
  });
});
