import { useContext } from "react";
import { AccountDirectoryContext } from "../app/context";
import { useLanguage, useT } from "../i18n";
import { accountOption, type AccountRef, type DirectoryConfig } from "./accountDirectory";
import { accountName, builtInAccountTitle, strategyName, laneName, domainName } from "./displayNames";

export function useDisplayNames(override?: DirectoryConfig | null) {
  const directory = useContext(AccountDirectoryContext), language = useLanguage(), t = useT();
  const config = override === undefined ? directory : override;
  return {
    config,
    account: (alias: string | null | undefined, platform?: string | null) => {
      if (!alias) return t("common.account");
      const option = platform ? accountOption(config, platform, alias) : undefined;
      // A configured single native IBKR account owns the account title. Show
      // the full identifier on the authenticated console, separate from strategy.
      const selector = platform?.toLowerCase() === "ibkr" ? option?.account_selector?.trim() : undefined;
      if (selector && /^(?:DU|U)\d{5,}$/i.test(selector)) return selector;
      // Built-in titles may arrive either as the alias or as the configured
      // label; resolve both, while arbitrary custom labels pass through.
      const builtIn = builtInAccountTitle(option?.label, language, platform) || builtInAccountTitle(alias, language, platform);
      // Keep the server-provided account name in full. When no display label
      // exists, the account key itself is the only honest name; never replace
      // it with a strategy name or a generic "Account" placeholder.
      const fallback = option?.label && option.label !== alias ? option.label : alias;
      const label = builtIn || accountName(alias, platform, language, fallback);
      return label;
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
