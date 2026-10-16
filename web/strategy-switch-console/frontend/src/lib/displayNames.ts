import { displayName } from "../../../display_names.js";

export function accountName(alias: string | null | undefined, platform?: string | null, locale = "en", fallback = ""): string {
  return displayName("accounts", alias || "", locale, fallback || alias || "", platform || "");
}
export function strategyName(profile: string, locale: string, fallback = ""): string {
  return displayName("strategies", profile, locale, fallback || (locale.startsWith("zh") ? "未命名策略" : "Unnamed strategy"));
}
export function laneName(lane: string, locale: string): string { return displayName("lanes", lane, locale, locale.startsWith("zh") ? "未知" : "Unknown"); }
export function domainName(domain: string, locale: string): string { return displayName("domains", domain, locale, locale.startsWith("zh") ? "未知市场" : "Unknown market"); }
