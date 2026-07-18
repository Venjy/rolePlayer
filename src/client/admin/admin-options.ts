import type {
  PersonaInput,
  ScenarioInput,
} from "../../shared/role-play-catalog";
import { translate, type AppLocale } from "../i18n/locale";

export function getGenderOptions(locale: AppLocale) {
  return [
    { value: "female", label: translate(locale, { en: "Female", zh: "女" }) },
    { value: "male", label: translate(locale, { en: "Male", zh: "男" }) },
    {
      value: "non_binary",
      label: translate(locale, { en: "Non-binary", zh: "非二元" }),
    },
    {
      value: "unspecified",
      label: translate(locale, { en: "Not specified", zh: "未指定" }),
    },
  ] satisfies Array<{ value: PersonaInput["gender"]; label: string }>;
}

export function getVoiceOptions(locale: AppLocale) {
  const names =
    locale === "zh"
      ? ["龙安芊", "龙安聆心", "龙安聆希", "龙安小新", "龙安陆风"]
      : ["Qian", "Lingxin", "Lingxi", "Xiaoxin", "Lufeng"];

  return [
    { value: "longanqian", label: `${names[0]} · longanqian` },
    { value: "longanlingxin", label: `${names[1]} · longanlingxin` },
    { value: "longanlingxi", label: `${names[2]} · longanlingxi` },
    { value: "longanxiaoxin", label: `${names[3]} · longanxiaoxin` },
    { value: "longanlufeng", label: `${names[4]} · longanlufeng` },
  ] satisfies Array<{ value: PersonaInput["voice"]; label: string }>;
}

export function getInterruptFrequencyOptions(locale: AppLocale) {
  return [
    {
      value: "low",
      label: translate(locale, {
        en: "Low · Patient, rarely challenges",
        zh: "低 · 耐心，较少挑战",
      }),
    },
    {
      value: "medium",
      label: translate(locale, {
        en: "Medium · Occasional brief interjections",
        zh: "中 · 偶尔简短插话",
      }),
    },
    {
      value: "high",
      label: translate(locale, {
        en: "High · Frequent, quick challenges",
        zh: "高 · 频繁、快速挑战",
      }),
    },
  ] satisfies Array<{
    value: ScenarioInput["voiceBehavior"]["interruptFrequency"];
    label: string;
  }>;
}

export function getSpeakingPaceOptions(locale: AppLocale) {
  return [
    { value: "slow", label: translate(locale, { en: "Slow", zh: "慢" }) },
    {
      value: "normal",
      label: translate(locale, { en: "Normal", zh: "正常" }),
    },
    { value: "fast", label: translate(locale, { en: "Fast", zh: "快" }) },
  ] satisfies Array<{
    value: ScenarioInput["voiceBehavior"]["speakingPace"];
    label: string;
  }>;
}

export function getFallbackScenario(locale: AppLocale): ScenarioInput {
  return {
    name: translate(locale, { en: "General sales conversation", zh: "通用销售沟通" }),
    description: translate(locale, {
      en: "A salesperson is exploring a customer's needs and trying to offer a suitable solution.",
      zh: "销售人员正在了解客户需求，并尝试提供合适的解决方案。",
    }),
    goals:
      locale === "zh"
        ? ["理解客户需求", "推进一次明确的下一步"]
        : ["Understand the customer's needs", "Agree on a clear next step"],
    suggestedSkillFocus:
      locale === "zh"
        ? ["需求发现", "积极倾听"]
        : ["Needs discovery", "Active listening"],
    successCriteria:
      locale === "zh"
        ? ["围绕客户真实需求展开对话"]
        : ["Keep the conversation focused on the customer's real needs"],
    scoringCriteria: [],
    allowedPersonaIds: ["preview-persona"],
    voiceBehavior: {
      interruptFrequency: "medium",
      speakingPace: "normal",
      toneStyle: translate(locale, {
        en: "Natural, realistic, and measured",
        zh: "自然、真实、克制",
      }),
    },
  };
}

export function getFallbackPersona(locale: AppLocale): PersonaInput {
  return {
    name: translate(locale, { en: "Preview persona", zh: "预览角色" }),
    gender: "unspecified",
    age: null,
    occupation: translate(locale, { en: "Prospective customer", zh: "潜在客户" }),
    identity: translate(locale, {
      en: "A prospective customer evaluating a sales proposal",
      zh: "正在评估销售方案的潜在客户",
    }),
    background: "",
    personalityTraits: [translate(locale, { en: "Rational", zh: "理性" })],
    communicationStyle: translate(locale, {
      en: "Communicates naturally and concisely",
      zh: "自然、简洁地交流",
    }),
    behaviorNotes: "",
    motivations: [],
    concerns: [],
    voice: "longanqian",
  };
}

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
