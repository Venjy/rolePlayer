import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  translate,
} from "../../src/client/i18n/locale";

describe("locale preferences", () => {
  it("defaults to English when no preference exists", () => {
    expect(readStoredLocale({ getItem: () => null })).toBe(DEFAULT_LOCALE);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("restores a supported language from storage", () => {
    expect(
      readStoredLocale({
        getItem: (key) => (key === LOCALE_STORAGE_KEY ? "zh" : null),
      }),
    ).toBe("zh");
  });

  it("falls back safely for invalid or inaccessible storage", () => {
    expect(readStoredLocale({ getItem: () => "fr" })).toBe("en");
    expect(
      readStoredLocale({
        getItem: () => {
          throw new DOMException("denied");
        },
      }),
    ).toBe("en");
  });

  it("selects and interpolates localized text", () => {
    const text = { en: "Hello, {name}", zh: "你好，{name}" };
    expect(translate("en", text, { name: "Alex" })).toBe("Hello, Alex");
    expect(translate("zh", text, { name: "小张" })).toBe("你好，小张");
  });
});

