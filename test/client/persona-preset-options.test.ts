import { describe, expect, it } from "vitest";
import { buildPersonaPresetOptions } from "../../src/client/admin/persona-preset-options";
import type { PersonaPreset } from "../../src/shared/role-play-catalog";

const timestamp = "2026-07-18T00:00:00.000Z";
function preset(
  id: number,
  category: PersonaPreset["category"],
  value: string,
  position: number,
  valueZhCn = value,
): PersonaPreset {
  return { id, category, value, valueZhCn, position, createdAt: timestamp, updatedAt: timestamp };
}

describe("persona preset options", () => {
  it("localizes labels while preserving numeric IDs", () => {
    const presets = [
      preset(2, "personality_trait", "Direct", 2, "直接"),
      preset(3, "occupation", "Founder", 1, "创始人"),
      preset(1, "personality_trait", "Thoughtful", 1, "周到"),
    ];
    expect(buildPersonaPresetOptions(presets, "zh").personality_trait).toEqual([
      { label: "周到", value: 1 },
      { label: "直接", value: 2 },
    ]);
    expect(buildPersonaPresetOptions(presets, "en").personality_trait).toEqual([
      { label: "Thoughtful", value: 1 },
      { label: "Direct", value: 2 },
    ]);
  });
});
