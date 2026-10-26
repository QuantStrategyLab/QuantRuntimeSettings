import { displayName } from "../../../display_names.js";

/**
 * Known built-in IBKR display titles only. These are product-defined labels, not
 * user aliases; any other alias or custom label stays exactly as configured.
 */
const BUILT_IN_ACCOUNT_TITLES: Record<string, { zh: string; en: string }> = {
  "Global ETF": { en: "Global ETF", zh: "全球ETF" },
  "Russell Top 50": { en: "Russell Top 50", zh: "罗素Top50" },
};

export function builtInAccountTitle(value: string | null | undefined, locale = "en", platform?: string | null): string | null {
  if (!value || (platform && platform.toLowerCase() !== "ibkr")) return null;
  const title = BUILT_IN_ACCOUNT_TITLES[value.trim()];
  return title ? title[locale.startsWith("zh") ? "zh" : "en"] : null;
}

export function accountName(alias: string | null | undefined, platform?: string | null, locale = "en", fallback = ""): string {
  return displayName("accounts", alias || "", locale, displayName("account_aliases", alias || "", locale, fallback || alias || ""), platform || "");
}
export function strategyName(profile: string, locale: string, fallback = ""): string {
  return displayName("strategies", profile, locale, fallback || (locale.startsWith("zh") ? "未命名策略" : "Unnamed strategy"));
}
export function laneName(lane: string, locale: string): string { return displayName("lanes", lane, locale, locale.startsWith("zh") ? "未知" : "Unknown"); }
export function domainName(domain: string, locale: string): string { return displayName("domains", domain, locale, locale.startsWith("zh") ? "未知市场" : "Unknown market"); }
