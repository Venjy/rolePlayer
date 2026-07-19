import type { Persona } from "../../shared/role-play-catalog";
import type { AppLocale, LocalizedText } from "../i18n";
import { translate } from "../i18n/locale";

const QWEN_VOICE_LABELS: Record<Persona["voice"], LocalizedText> = {
  longanqian: { en: "Natural default voice", zh: "自然默认音" },
  longanlingxin: { en: "Warm and caring voice", zh: "知心温暖音" },
  longanlingxi: { en: "Cute and sweet voice", zh: "可爱甜美音" },
  longanxiaoxin: { en: "Friendly and lively voice", zh: "亲切活泼音" },
  longanlufeng: { en: "Bright and cheerful voice", zh: "明亮开朗音" },
};

export function getVoiceLabel(voice: Persona["voice"], locale: AppLocale) {
  return translate(locale, QWEN_VOICE_LABELS[voice]);
}

export function getVoiceOptions(locale: AppLocale) {
  return Object.keys(QWEN_VOICE_LABELS).map((voice) => ({
    value: voice as Persona["voice"],
    label: getVoiceLabel(voice as Persona["voice"], locale),
  }));
}
