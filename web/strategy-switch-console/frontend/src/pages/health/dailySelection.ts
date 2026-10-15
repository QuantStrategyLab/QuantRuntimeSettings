import type { RuntimeDailyBinding } from "../../api/endpoints";

export interface GridAccount {
  account_alias: string;
  platform: string;
}

/** Read eligibility comes from server bindings, never a platform or alias convention. */
export function boundDailyAccounts(accounts: GridAccount[], bindings: RuntimeDailyBinding[]): GridAccount[] {
  return accounts.filter(account => {
    const matches = bindings.filter(binding => binding.platform === account.platform
      && binding.account_key === account.account_alias);
    return matches.length === 1 && matches[0].status === "bound" && !!matches[0].target_key;
  });
}
