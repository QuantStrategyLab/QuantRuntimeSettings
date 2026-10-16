import { displayName } from "../../../display_names.js";

export function accountName(alias: string | null | undefined, platform?: string | null): string {
  return displayName("accounts", alias || "", "en", alias || "", platform || "");
}
export function strategyName(profile: string, locale: string, fallback = ""): string {
  return displayName("strategies", profile, locale, fallback);
}
