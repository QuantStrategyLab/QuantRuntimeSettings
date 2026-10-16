import { useContext } from "react";
import { AccountDirectoryContext } from "../app/context";
import { useLanguage, useT } from "../i18n";
import { accountOption, type AccountRef } from "./accountDirectory";
import { accountName, strategyName, laneName, domainName } from "./displayNames";

export function useDisplayNames() {
  const config = useContext(AccountDirectoryContext), language = useLanguage(), t = useT();
  return {
    config,
    account: (alias: string | null | undefined, platform?: string | null) => {
      if (!alias) return t("common.account");
      const option = platform ? accountOption(config, platform, alias) : undefined;
      const selector = option?.account_selector?.trim();
      if (platform === "ibkr" && selector && /^U\d{5,}$/i.test(selector)) return selector.toUpperCase();
      return accountName(alias, platform, language, option?.label && option.label !== alias ? option.label : t("common.account"));
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
