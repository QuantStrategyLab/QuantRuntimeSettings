import { useContext } from "react";
import { AccountDirectoryContext } from "../app/context";
import { useLanguage, useT } from "../i18n";
import { accountOption, ibkrAccountName, type AccountRef, type DirectoryConfig } from "./accountDirectory";
import { strategyName, laneName, domainName } from "./displayNames";

export function useDisplayNames(override?: DirectoryConfig | null) {
  const directory = useContext(AccountDirectoryContext), language = useLanguage(), t = useT();
  const config = override === undefined ? directory : override;
  return {
    config,
    account: (alias: string | null | undefined, platform?: string | null) => {
      if (!alias) return t("common.account");
      const option = platform ? accountOption(config, platform, alias) : undefined;
      // An IBKR account is named only by its validated broker ID; keys, labels and
      // target names are strategy-derived and never stand in for it.
      if (platform?.toLowerCase() === "ibkr") return ibkrAccountName(option) ?? t("common.account_id_unavailable");
      for (const value of [option?.label, option?.key, option?.target_name]) {
        const label = safeAccountLabel(value);
        if (label) return label;
      }
      const label = safeAccountLabel(alias);
      if (label) return label;
      // Raw broker identities may supply only the last two digits as fallback.
      const selector = option?.account_selector?.trim();
      for (const value of [selector, alias]) {
        if (value && /^(?:D?U\d{5,16}|(?:Account )?\d[\d .-]{4,24}\d)$/i.test(value)) {
          return "***" + value.slice(-2);
        }
      }
      return t("common.account");
    },
    strategy: (profile: string) => {
      const item = config?.strategyProfiles?.find(item => item.profile === profile);
      return strategyName(profile, language, language === "zh" ? item?.label_zh : item?.label_en);
    },
    currentStrategy: (account: AccountRef) => config?.currentStrategies?.[account.platform]?.[account.account_alias]?.strategy_profile,
    platform: (platform: string) => displayPlatform(config?.platformMeta?.[platform]?.label, platform),
    lane: (lane: string) => laneName(lane, language),
    domain: (domain: string) => domainName(domain, language),
  };
}
function displayPlatform(label: string | undefined, platform: string) { return label || platform; }

/** Display-only config labels; selectors and grouping identities stay private. */
function safeAccountLabel(value: unknown): string {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)) return "";
  const label = value.trim();
  if (!label || label.length > 70 || label.includes("://")
      || /D?U\d{5,}|\d(?:[\s.-]*\d){4,}|^[0-9a-f-]{12,}$/i.test(label)) return "";
  return label;
}
