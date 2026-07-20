import { describe, expect, it } from "vitest";
import type {
  Persona,
  PersonaInput,
  PersonaPreset,
} from "../../src/shared/role-play-catalog";
import {
  buildPersonaDraftGenerationContext,
  getPersonaFormInitialValues,
  normalizePersonaFormValues,
  type PersonaFormValues,
} from "../../src/client/admin/persona-form-values";

const timestamp = "2026-07-18T00:00:00.000Z";
function formValues(name: string): PersonaFormValues {
  return {
    name,
    gender: "unspecified",
    age: null,
    occupationPresetId: 1,
    personalityTraitPresetIds: [2],
    communicationStylePresetId: 3,
    concernPresetIds: [5],
    voice: "longanqian",
  };
}
const chinesePersona: Persona = {
  ...normalizePersonaFormValues(formValues("张三"), "zh", undefined),
  occupation: "Delivery Rider",
  occupationZhCn: "外卖员",
  personalityTraits: ["Pragmatic"],
  personalityTraitsZhCn: ["务实"],
  communicationStyle: "Direct and concise",
  communicationStyleZhCn: "直接简洁",
  motivations: [],
  motivationsZhCn: [],
  concerns: ["Price and budget"],
  concernsZhCn: ["价格与预算"],
  id: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("persona form localization", () => {
  it("does not preselect a personality trait for a new persona", () => {
    const pragmaticPreset: PersonaPreset = {
      id: 2,
      category: "personality_trait",
      value: "Pragmatic",
      valueZhCn: "务实",
      position: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    expect(
      getPersonaFormInitialValues(undefined, "zh", [pragmaticPreset])
        .personalityTraitPresetIds,
    ).toEqual([]);
  });

  it("omits a fully blank partial draft from random generation", () => {
    expect(
      buildPersonaDraftGenerationContext(
        {
          name: "   ",
          personalityTraitPresetIds: [],
          motivationPresetIds: [],
          concernPresetIds: [],
        },
        "zh",
      ),
    ).toBeUndefined();
  });

  it("writes localized free text but keeps preset selections as IDs", () => {
    expect(normalizePersonaFormValues(formValues("张三"), "zh", undefined)).toMatchObject({
      name: "",
      nameZhCn: "张三",
      occupationPresetId: 1,
      personalityTraitPresetIds: [2],
      concernPresetIds: [5],
    });
  });

  it("shows fallback text without persisting it to English", () => {
    const englishForm = getPersonaFormInitialValues(chinesePersona, "en");
    expect(englishForm.name).toBe("张三");
    const unchanged = normalizePersonaFormValues(englishForm, "en", chinesePersona);
    expect(unchanged.name).toBe("");
    expect(unchanged.nameZhCn).toBe("张三");
  });

  it("edits English without overwriting Chinese or preset IDs", () => {
    const englishForm = getPersonaFormInitialValues(chinesePersona, "en");
    const updated = normalizePersonaFormValues(
      { ...englishForm, name: "Zhang San", occupationPresetId: 6 },
      "en",
      chinesePersona,
    );
    expect(updated).toMatchObject({
      name: "Zhang San",
      nameZhCn: "张三",
      occupationPresetId: 6,
    });
  });

  it("preserves both model-generated languages when the visible draft is saved", () => {
    const generated: PersonaInput = {
      ...normalizePersonaFormValues(formValues("Jordan Lee"), "en", undefined),
      nameZhCn: "李乔丹",
      background: "English background",
      backgroundZhCn: "中文背景",
      behaviorNotes: "English behavior",
      behaviorNotesZhCn: "中文行为说明",
      motivationPresetIds: [4],
    };
    const visibleChinese = getPersonaFormInitialValues(generated, "zh");
    const saved = normalizePersonaFormValues(
      { ...visibleChinese, background: "修改后的中文背景" },
      "zh",
      generated,
    );
    expect(saved).toMatchObject({
      name: "Jordan Lee",
      nameZhCn: "李乔丹",
      background: "English background",
      backgroundZhCn: "修改后的中文背景",
      behaviorNotes: "English behavior",
      behaviorNotesZhCn: "中文行为说明",
    });
  });
});
