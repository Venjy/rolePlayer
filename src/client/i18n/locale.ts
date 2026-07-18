export const LOCALE_STORAGE_KEY = "role-player:locale";

export type AppLocale = "en" | "zh";

export interface LocalizedText {
  en: string;
  zh: string;
}

export type TranslationParameters = Readonly<
  Record<string, string | number>
>;

export const DEFAULT_LOCALE: AppLocale = "en";

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "en" || value === "zh";
}

export function readStoredLocale(
  storage?: Pick<Storage, "getItem">,
): AppLocale {
  if (!storage) return DEFAULT_LOCALE;

  try {
    const storedLocale = storage.getItem(LOCALE_STORAGE_KEY);
    return isAppLocale(storedLocale) ? storedLocale : DEFAULT_LOCALE;
  } catch {
    // Browsers may deny access in strict privacy modes.
    return DEFAULT_LOCALE;
  }
}

export function translate(
  locale: AppLocale,
  text: LocalizedText,
  parameters: TranslationParameters = {},
): string {
  return text[locale].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = parameters[name];
    return value === undefined ? placeholder : String(value);
  });
}

