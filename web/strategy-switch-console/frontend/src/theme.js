export const THEME_STORAGE_KEY = "qsl-theme-preference";
export const DISPLAY_STORAGE_KEY = "qsl-console-display-mode";

export function normalizeThemePreference(value) {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(preference, systemPrefersDark) {
  const normalized = normalizeThemePreference(preference);
  return normalized === "system" ? (systemPrefersDark ? "dark" : "light") : normalized;
}

export function normalizeDisplayMode(value) {
  return value === "professional" ? "professional" : "simple";
}
