import {
  type QwenVoice,
} from "../../shared/realtime-protocol";
import type { QwenVoiceDefinition } from "../../shared/role-play-catalog";
import { localizedText } from "../../shared/role-play-localization";
import type { AppLocale } from "../i18n";

export function getVoiceLabel(
  voice: QwenVoice,
  definitions: readonly QwenVoiceDefinition[],
  locale: AppLocale,
) {
  const definition = definitions.find((candidate) => candidate.voice === voice);
  if (!definition) return voice;
  const name = localizedText(definition.name, definition.nameZhCn, locale);
  return `${voice} - ${name}`;
}

export function getVoiceOptions(
  definitions: readonly QwenVoiceDefinition[],
  locale: AppLocale,
) {
  return [...definitions]
    .sort((left, right) => left.position - right.position || left.id - right.id)
    .map(({ voice }) => ({
      value: voice,
      label: getVoiceLabel(voice, definitions, locale),
    }));
}
