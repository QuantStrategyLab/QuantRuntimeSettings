import type { AccountExecutionEvidence } from "../api/contracts";
export interface AccountOption {
  key?: string; label?: string; target_name?: string; account_selector?: string; broker_environment?: string;
}
export interface DirectoryConfig {
  accountOptions?: Record<string, AccountOption[]>;
  platformMeta?: Record<string, { label?: string }>;
  currentStrategies?: Record<string, Record<string, { execution_evidence?: AccountExecutionEvidence; strategy_profile?: string; runtime_target_enabled?: boolean; execution_mode?: string }>>;
  strategyProfiles?: { profile?: string; label?: string; label_zh?: string; label_en?: string }[];
}
export interface AccountRef { platform: string; account_alias: string }
export function accountKey(account: AccountRef): string { return `${account.platform}:${account.account_alias}`; }
export function findAccount<T extends AccountRef>(accounts: T[], selected: string | null): T | undefined {
  if (!selected) return undefined;
  const exact = accounts.find(account => accountKey(account) === selected);
  if (exact) return exact;
  const legacy = accounts.filter(account => account.account_alias === selected);
  return legacy.length === 1 ? legacy[0] : undefined;
}
export function accountOption(config: DirectoryConfig | null, platform: string, alias: string): AccountOption | undefined {
  return config?.accountOptions?.[platform]?.find(item => item.key === alias);
}
export function brokerIdentity(config: DirectoryConfig | null, account: AccountRef): string {
  const selector = accountOption(config, account.platform, account.account_alias)?.account_selector?.trim();
  return selector || account.account_alias;
}
export function groupAccounts<T extends AccountRef>(accounts: T[], config: DirectoryConfig | null) {
  const platforms = new Map<string, Map<string, T[]>>();
  for (const account of accounts) {
    let groups = platforms.get(account.platform);
    if (!groups) platforms.set(account.platform, groups = new Map());
    const identity = brokerIdentity(config, account);
    const key = identity.toUpperCase();
    const group = groups.get(key);
    if (group) group.push(account); else groups.set(key, [account]);
  }
  return [...platforms].map(([platform, groups]) => ({ platform, accounts: [...groups.values()].map(rows => ({ identity: brokerIdentity(config, rows[0]), rows })) }));
}
/** Route identity is qualified; existing API parameters retain the original alias. */
export function performanceScope(scope: string, platform?: string) {
  const separator = scope.indexOf(":");
  return separator > 0 ? { scope: scope.slice(separator + 1), platform: scope.slice(0, separator) } : { scope, platform };
}
