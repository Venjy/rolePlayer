export const THEME_STORAGE_KEY = "role-player:color-mode";

export type ColorMode = "light" | "dark";

export function getInitialColorMode(): ColorMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage can be unavailable in strict privacy modes; system preference remains usable.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
