import { describe, expect, it } from "vitest";
import { buildPersonaPresetOptions } from "../../src/client/admin/persona-preset-options";
import type {
  Persona,
  PersonaPreset,
} from "../../src/shared/role-play-catalog";

const timestamp = "2026-07-18T00:00:00.000Z";

function preset(
  id: string,
  category: PersonaPreset["category"],
  value: string,
  position: number,
): PersonaPreset {
  return {
    id,
    category,
    value,
    position,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const legacyPersona: Persona = {
  id: "legacy-persona",
  name: "Legacy",
  gender: "unspecified",
  age: null,
  occupation: "Legacy occupation",
  identity: "Legacy identity",
  background: "",
  personalityTraits: ["Thoughtful", "Legacy trait"],
  communicationStyle: "Legacy communication style",
  behaviorNotes: "",
  motivations: ["Legacy motivation"],
  concerns: ["Legacy concern"],
  voice: "longanqian",
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("persona preset options", () => {
  it("sorts database choices by position within each category", () => {
    const result = buildPersonaPresetOptions([
      preset("trait-2", "personality_trait", "Direct", 2),
      preset("occupation-1", "occupation", "Founder", 1),
      preset("trait-1", "personality_trait", "Thoughtful", 1),
    ]);

    expect(result.personality_trait).toEqual([
      { label: "Thoughtful", value: "Thoughtful" },
      { label: "Direct", value: "Direct" },
    ]);
    expect(result.occupation).toEqual([
      { label: "Founder", value: "Founder" },
    ]);
  });

  it("retains historical values without duplicating active presets", () => {
    const result = buildPersonaPresetOptions(
      [
        preset("trait-1", "personality_trait", "Thoughtful", 0),
        preset("identity-1", "identity", "Buyer", 0),
      ],
      legacyPersona,
    );

    expect(result.personality_trait).toEqual([
      { label: "Thoughtful", value: "Thoughtful" },
      { label: "Legacy trait（现有值）", value: "Legacy trait" },
    ]);
    expect(result.identity).toContainEqual({
      label: "Legacy identity（现有值）",
      value: "Legacy identity",
    });
    expect(result.occupation).toEqual([
      {
        label: "Legacy occupation（现有值）",
        value: "Legacy occupation",
      },
    ]);
  });
});
