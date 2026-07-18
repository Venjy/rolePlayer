import type {
  PersonaInput,
  ScenarioInput,
} from "../../shared/role-play-catalog";

export const GENDER_OPTIONS = [
  { value: "female", label: "女" },
  { value: "male", label: "男" },
  { value: "non_binary", label: "非二元" },
  { value: "unspecified", label: "未指定" },
] satisfies Array<{ value: PersonaInput["gender"]; label: string }>;

export const VOICE_OPTIONS = [
  { value: "longanqian", label: "龙安芊 · longanqian" },
  { value: "longanlingxin", label: "龙安聆心 · longanlingxin" },
  { value: "longanlingxi", label: "龙安聆希 · longanlingxi" },
  { value: "longanxiaoxin", label: "龙安小新 · longanxiaoxin" },
  { value: "longanlufeng", label: "龙安陆风 · longanlufeng" },
] satisfies Array<{ value: PersonaInput["voice"]; label: string }>;

export const INTERRUPT_FREQUENCY_OPTIONS = [
  { value: "low", label: "低 · 耐心，较少挑战" },
  { value: "medium", label: "中 · 偶尔简短插话" },
  { value: "high", label: "高 · 频繁、快速挑战" },
] satisfies Array<{
  value: ScenarioInput["voiceBehavior"]["interruptFrequency"];
  label: string;
}>;

export const SPEAKING_PACE_OPTIONS = [
  { value: "slow", label: "慢" },
  { value: "normal", label: "正常" },
  { value: "fast", label: "快" },
] satisfies Array<{
  value: ScenarioInput["voiceBehavior"]["speakingPace"];
  label: string;
}>;

export const FALLBACK_SCENARIO: ScenarioInput = {
  name: "通用销售沟通",
  description: "销售人员正在了解客户需求，并尝试提供合适的解决方案。",
  goals: ["理解客户需求", "推进一次明确的下一步"],
  suggestedSkillFocus: ["需求发现", "积极倾听"],
  successCriteria: ["围绕客户真实需求展开对话"],
  scoringCriteria: [],
  allowedPersonaIds: ["preview-persona"],
  voiceBehavior: {
    interruptFrequency: "medium",
    speakingPace: "normal",
    toneStyle: "自然、真实、克制",
  },
};

export const FALLBACK_PERSONA: PersonaInput = {
  name: "预览角色",
  gender: "unspecified",
  age: null,
  occupation: "潜在客户",
  identity: "正在评估销售方案的潜在客户",
  background: "",
  personalityTraits: ["理性"],
  communicationStyle: "自然、简洁地交流",
  behaviorNotes: "",
  motivations: [],
  concerns: [],
  voice: "longanqian",
};

export function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function includesSearchText(
  query: string,
  ...values: Array<string | readonly string[] | null | undefined>
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}
