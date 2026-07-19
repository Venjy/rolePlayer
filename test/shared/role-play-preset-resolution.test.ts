import { describe, expect, it } from "vitest";
import type {
  PersonaInput,
  PersonaPreset,
} from "../../src/shared/role-play-catalog";
import { compilePersonaInstructions } from "../../src/shared/role-play-instructions";
import { localizePersonaInput } from "../../src/shared/role-play-localization";
import {
  PresetReferenceResolutionError,
  resolvePersonaPresetReferences,
} from "../../src/shared/role-play-preset-resolution";

const timestamp = "2026-07-19T12:00:00.000+08:00";
const presets: PersonaPreset[] = [
  [1, "occupation", "Delivery Rider", "外卖员"],
  [2, "personality_trait", "Impatient", "缺乏耐心"],
  [3, "communication_style", "Direct and concise", "直接简洁"],
  [4, "tone_style", "Professional and composed", "专业沉稳"],
].map(([id, category, value, valueZhCn], position) => ({
  id: id as number,
  category: category as PersonaPreset["category"],
  value: value as string,
  valueZhCn: valueZhCn as string,
  position,
  createdAt: timestamp,
  updatedAt: timestamp,
}));

const persona: PersonaInput = {
  name: "Zhang San",
  nameZhCn: "张三",
  gender: "male",
  age: 30,
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
  voice: "longanqian",
  voiceBehavior: { interruptFrequency: "medium", speakingPace: "normal" },
};

describe("preset reference resolution", () => {
  it("uses one ID selection for localized display and Instructions", () => {
    const resolved = resolvePersonaPresetReferences(persona, presets);
    const english = localizePersonaInput(resolved, "en");
    const chinese = localizePersonaInput(resolved, "zh");

    expect(english.personalityTraits).toEqual(["Impatient"]);
    expect(chinese.personalityTraits).toEqual(["缺乏耐心"]);
    expect(compilePersonaInstructions(english)).toContain("- Impatient");
    expect(compilePersonaInstructions(chinese)).toContain("- 缺乏耐心");
  });

  it("rejects a missing or wrong-category preset reference", () => {
    expect(() =>
      resolvePersonaPresetReferences(
        { ...persona, personalityTraitPresetIds: [1] },
        presets,
      ),
    ).toThrow(PresetReferenceResolutionError);
  });
});
