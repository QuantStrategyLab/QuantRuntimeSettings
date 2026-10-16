import { DISPLAY_NAMES } from "./display_names_data.js";

let buildOverrides = {};
try {
  const parsed = JSON.parse(import.meta.env?.VITE_QSL_DISPLAY_NAMES_JSON || "{}");
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) buildOverrides = parsed;
} catch { /* Invalid display configuration must not block rendering. */ }

export function displayName(kind, key, locale = "en", fallback = "", platform = "", overrides = buildOverrides) {
  const alias = overrides.strategy_aliases?.[key] || DISPLAY_NAMES.strategy_aliases?.[key] || key;
  for (const source of [overrides, DISPLAY_NAMES]) {
    const section = kind === "accounts" ? source[kind]?.[String(platform).toLowerCase()] : source[kind];
    const first = source === DISPLAY_NAMES && kind === "strategies" ? alias : key;
    const value = section?.[first] ?? (kind === "strategies" ? section?.[alias] : null);
    const text = typeof value === "object" && value ? value[String(locale).startsWith("zh") ? "zh" : "en"] || value.en : value;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return fallback || key || "";
}
