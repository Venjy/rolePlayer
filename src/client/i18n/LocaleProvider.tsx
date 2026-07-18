import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  translate,
  type AppLocale,
  type LocalizedText,
  type TranslationParameters,
} from "./locale";
import { I18nContext, type I18nContextValue } from "./i18n-context";

function getBrowserInitialLocale(): AppLocale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    return readStoredLocale(window.localStorage);
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(getBrowserInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // The selected language still applies to the current page.
    }
  }, [locale]);

  const toggleLocale = useCallback(() => {
    setLocale((current) => (current === "en" ? "zh" : "en"));
  }, []);

  const t = useCallback(
    (text: LocalizedText, parameters?: TranslationParameters) =>
      translate(locale, text, parameters),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      antdLocale: locale === "zh" ? zhCN : enUS,
      setLocale,
      toggleLocale,
      t,
    }),
    [locale, t, toggleLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
