import { describe, expect, it } from "vitest";
import {
  getVoiceLabel,
  getVoiceOptions,
} from "../../src/client/catalog/qwen-voice-options";
import type { QwenVoiceDefinition } from "../../src/shared/role-play-catalog";

const timestamp = "2026-07-19T12:00:00.000+08:00";
const voiceNames = [
  ["longanqian", "female", "Natural female voice", "自然女声"],
  ["longanlingxin", "female", "Sophisticated female voice", "知性女声"],
  ["longanlingxi", "female", "Lively female voice", "活泼女声"],
  ["longanxiaoxin", "female", "Emotional female voice", "感性女声"],
  ["longanlufeng", "male", "Cheerful male voice", "开朗男声"],
] as const satisfies ReadonlyArray<
  readonly [
    QwenVoiceDefinition["voice"],
    QwenVoiceDefinition["gender"],
    string,
    string,
  ]
>;
const voices: QwenVoiceDefinition[] = voiceNames.map(
  ([voice, gender, name, nameZhCn], index) => ({
  id: index + 1,
  voice,
  gender,
  name,
  nameZhCn,
  position: index,
  createdAt: timestamp,
  updatedAt: timestamp,
  }),
);

describe("Qwen voice options", () => {
  it("combines provider IDs with database-backed localized names", () => {
    expect(getVoiceOptions(voices, "zh")).toEqual([
      { value: "longanqian", label: "longanqian - 自然女声" },
      { value: "longanlingxin", label: "longanlingxin - 知性女声" },
      { value: "longanlingxi", label: "longanlingxi - 活泼女声" },
      { value: "longanxiaoxin", label: "longanxiaoxin - 感性女声" },
      { value: "longanlufeng", label: "longanlufeng - 开朗男声" },
    ]);
    expect(getVoiceLabel("longanqian", voices, "en")).toBe(
      "longanqian - Natural female voice",
    );
  });

  it("falls back to the provider ID if catalog initialization is missing", () => {
    expect(getVoiceLabel("longanqian", [], "zh")).toBe("longanqian");
  });
});
