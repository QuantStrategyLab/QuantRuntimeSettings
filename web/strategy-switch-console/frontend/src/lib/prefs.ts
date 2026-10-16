export type ThemePreference = "light" | "dark" | "system";
export type Language = "zh" | "en";
export type UpDownPreference = "green-up" | "red-up";
export type DefaultRange = "1M" | "3M" | "YTD" | "1Y" | "ALL";

export interface Preferences {
  theme: ThemePreference;
  language: Language;
  upDown: UpDownPreference;
  hideAmounts: boolean;
  defaultRange: DefaultRange;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  language: "en",
  upDown: "green-up",
  hideAmounts: false,
  defaultRange: "YTD",
};

const KEYS = {
  // Existing storage keys are retained so returning users keep their choices.
  theme: "qsl-theme-preference",
  language: "qsl-switch-lang",
  upDown: "qsl-updown-preference",
  hideAmounts: "qsl-hide-amounts",
  defaultRange: "qsl-default-range",
} as const;

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Optional preference; storage may be unavailable.
  }
}

export function normalizeTheme(value: string | null): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : DEFAULT_PREFERENCES.theme;
}

export function normalizeLanguage(value: string | null): Language {
  if (value === "zh" || value === "zh-CN") return "zh";
  if (value === "en") return "en";
  const languages = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return "zh";
    if (/^en(?:-|$)/i.test(language)) return "en";
  }
  return DEFAULT_PREFERENCES.language;
}

export function normalizeUpDown(value: string | null): UpDownPreference {
  return value === "red-up" || value === "green-up" ? value : DEFAULT_PREFERENCES.upDown;
}

export function normalizeRange(value: string | null): DefaultRange {
  return value === "1M" || value === "3M" || value === "YTD" || value === "1Y" || value === "ALL" ? value : DEFAULT_PREFERENCES.defaultRange;
}

export function loadPreferences(): Preferences {
  return {
    theme: normalizeTheme(safeGet(KEYS.theme)),
    language: normalizeLanguage(safeGet(KEYS.language)),
    upDown: normalizeUpDown(safeGet(KEYS.upDown)),
    hideAmounts: safeGet(KEYS.hideAmounts) === "1",
    defaultRange: normalizeRange(safeGet(KEYS.defaultRange)),
  };
}

export function savePreferences(prefs: Preferences): void {
  safeSet(KEYS.theme, prefs.theme);
  safeSet(KEYS.language, prefs.language);
  safeSet(KEYS.upDown, prefs.upDown);
  safeSet(KEYS.hideAmounts, prefs.hideAmounts ? "1" : "0");
  safeSet(KEYS.defaultRange, prefs.defaultRange);
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): "light" | "dark" {
  return preference === "system" ? (systemPrefersDark ? "dark" : "light") : preference;
}
