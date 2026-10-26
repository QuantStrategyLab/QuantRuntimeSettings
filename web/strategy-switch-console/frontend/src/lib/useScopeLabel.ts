import { useScope } from "../app/context";
import { useT } from "../i18n";
import { useDisplayNames } from "./useDisplayNames";

/** Legend label for the account/portfolio curve: the real account name, or "Portfolio" for all scopes. */
export function useScopeLabel(scopeOverride?: string): string {
  const { scope, options } = useScope();
  const names = useDisplayNames();
  const t = useT();
  const current = scopeOverride ?? scope;
  if (!current || current === "all") return t("perf.portfolio_series");
  const option = options.find(item => `${item.platform}:${item.alias}` === current);
  if (option) return names.account(option.alias, option.platform);
  const separator = current.indexOf(":");
  return separator >= 0
    ? names.account(current.slice(separator + 1), current.slice(0, separator))
    : names.account(current);
}
