import { createContext, useContext } from "react";
import type enUS from "antd/locale/en_US";
import type {
  AppLocale,
  LocalizedText,
  TranslationParameters,
} from "./locale";

export interface I18nContextValue {
  locale: AppLocale;
  antdLocale: typeof enUS;
  setLocale: (locale: AppLocale) => void;
  toggleLocale: () => void;
  t: (text: LocalizedText, parameters?: TranslationParameters) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within LocaleProvider.");
  }
  return context;
}

