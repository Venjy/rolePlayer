import { describe, expect, it } from "vitest";
import type {
  Persona,
  PersonaPreset,
  Scenario,
} from "../../src/shared/role-play-catalog";
import {
  localizePersona,
  localizeScenario,
} from "../../src/client/catalog/catalog-localization";

const timestamp = "2026-07-18T00:00:00.000Z";

const alex: Persona = {
  id: "persona_alex",
  name: "Alex",
  gender: "unspecified",
  age: 35,
  occupation: "Operations Director",
  identity: "Buyer",
  background: "Background",
  personalityTraits: ["Pragmatic"],
  communicationStyle: "Concise",
  behaviorNotes: "Stay in character",
  motivations: [],
  concerns: [],
  voice: "longanqian",
  createdAt: timestamp,
  updatedAt: timestamp,
};

const scenario: Scenario = {
  id: "scenario_sales_discovery",
  name: "Sales discovery call",
  description: "Description",
  goals: ["Goal"],
  suggestedSkillFocus: ["Listening"],
  successCriteria: ["Criterion"],
  scoringCriteria: [],
  allowedPersonaIds: [alex.id],
  voiceBehavior: {
    interruptFrequency: "low",
    speakingPace: "normal",
    toneStyle: "Thoughtful",
  },
  createdAt: timestamp,
  updatedAt: timestamp,
};

const presets: PersonaPreset[] = [
  {
    id: "preset_identity_buyer",
    category: "identity",
    value: "采购决策者",
    valueEn: "Procurement decision-maker",
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "preset_trait_pragmatic",
    category: "personality_trait",
    value: "务实",
    valueEn: "Pragmatic",
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

describe("starter catalog localization", () => {
  it("localizes unmodified built-in content", () => {
    expect(localizePersona(alex, "zh").name).toBe("亚历克斯");
    expect(
      localizePersona(
        { ...alex, id: "persona_lin_yue", name: "林悦" },
        "en",
      ).name,
    ).toBe("Lin Yue");
    expect(localizeScenario(scenario, "zh").name).toBe("销售需求探索通话");
  });

  it("preserves the database content after an administrator edit", () => {
    const edited = { ...alex, updatedAt: "2026-07-18T01:00:00.000Z" };
    expect(localizePersona(edited, "zh")).toEqual(edited);
  });

  it("leaves user-created content unchanged", () => {
    const custom = { ...alex, id: "persona_custom", name: "自定义角色" };
    expect(localizePersona(custom, "en")).toEqual(custom);
  });

  it("maps preset snapshots to English without translating free text", () => {
    const custom: Persona = {
      ...alex,
      id: "persona_custom",
      name: "小张",
      identity: "采购决策者",
      background: "用户自己填写的背景",
      personalityTraits: ["务实", "自定义特征"],
    };

    expect(localizePersona(custom, "en", presets)).toMatchObject({
      name: "小张",
      identity: "Procurement decision-maker",
      background: "用户自己填写的背景",
      personalityTraits: ["Pragmatic", "自定义特征"],
    });
  });
});
