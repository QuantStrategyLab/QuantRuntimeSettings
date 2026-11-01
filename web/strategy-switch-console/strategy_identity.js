// Generated aliases are configuration, not permission: resolve identity only.
import { DISPLAY_NAMES } from "./display_names_data.js";

export function canonicalStrategyProfile(value) {
  const lookup = String(value || "").trim().toLowerCase().replaceAll("-", "_");
  return (DISPLAY_NAMES.strategy_aliases || {})[lookup] || lookup;
}

export function sameStrategyProfile(left, right) {
  return canonicalStrategyProfile(left) === canonicalStrategyProfile(right);
}
