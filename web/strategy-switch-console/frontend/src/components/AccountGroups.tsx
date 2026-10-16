import { accountKey, groupAccounts, accountOption, type DirectoryConfig } from "../lib/accountDirectory";
import { useDisplayNames } from "../lib/useDisplayNames";
import { useT } from "../i18n";
import type { AccountsResponse } from "../api/contracts";
import { DateText } from "./primitives";

type Account = AccountsResponse["accounts"][number];
export function AccountGroups({ accounts, config, onSelect }: { accounts: Account[]; config: DirectoryConfig | null; onSelect: (key: string) => void }) {
  const names = useDisplayNames(config), t = useT();
  return <div className="section-stack">{groupAccounts(accounts, config).map(group => <section className="account-platform-group" key={group.platform}>
    <h2 className="account-platform-title">{names.platform(group.platform)}</h2>
    <div className="account-grid">{group.accounts.map(account => <article className="card account-group-card" key={account.identity}>
      <h3 className="account-broker-title">{names.account(account.rows[0].account_alias, group.platform)}</h3>
      {account.rows.map(row => {
        const strategy = names.currentStrategy(row);
        const option = accountOption(config, row.platform, row.account_alias);
        const lane = option?.broker_environment || config?.currentStrategies?.[row.platform]?.[row.account_alias]?.execution_mode;
        const enabled = config?.currentStrategies?.[row.platform]?.[row.account_alias]?.runtime_target_enabled;
        return <button type="button" className="account-strategy-link" key={accountKey(row)} title={accountKey(row) + (strategy ? ` / ${strategy}` : "")} onClick={() => onSelect(accountKey(row))}>
          {lane && <span className="badge badge-accent" title={lane}>{names.lane(lane)}</span>}
          <span className="account-strategy-name">{strategy ? names.strategy(strategy) : t("common.unknown")}</span>
          {typeof enabled === "boolean" && <span className="account-row"><span>{t("overview.runtime_target")}</span><span>{t(enabled ? "overview.runtime_enabled" : "overview.runtime_disabled")}</span></span>}
          <span className="account-row"><span>{t("accounts.col.drafts")}</span><span>{row.pending_draft_count}</span></span>
          <span className="account-row"><span>{t("accounts.col.todos")}</span><span>{row.pending_decision_count ?? "—"}</span></span>
          <span className="account-row"><span>{t("accounts.col.last_change")}</span><DateText value={row.last_change_at} /></span>
        </button>;
      })}
    </article>)}</div>
  </section>)}</div>;
}
