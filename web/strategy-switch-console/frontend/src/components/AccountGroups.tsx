import { accountKey, groupAccounts, accountOption, type DirectoryConfig } from "../lib/accountDirectory";
import { factForAccount } from "../lib/accountFacts";
import { useDisplayNames } from "../lib/useDisplayNames";
import { useT } from "../i18n";
import type { AccountFactsAccount, AccountsResponse } from "../api/contracts";
import { DateText } from "./primitives";
import { AccountFactsAmounts, PlatformFactsSummary, type FactsPhase } from "./AccountFactsAmounts";

type Account = AccountsResponse["accounts"][number];

export interface AccountFactsView {
  rows: AccountFactsAccount[];
  phase: FactsPhase;
}

/**
 * Platform rollup input: the distinct facts rows reached through the trusted
 * platform+account_key join. Dedupe is by row reference only — two directory
 * aliases of one account return the same row and count once, while identical
 * content in distinct rows never merges them. `expected` also counts directory
 * accounts with no facts row, so coverage can never silently complete.
 */
function platformFactsUnits(accounts: { rows: Account[] }[], facts: AccountFactsAccount[]): { rows: AccountFactsAccount[]; expected: number } {
  const found = new Set<AccountFactsAccount>();
  const missing = new Set<string>();
  for (const account of accounts) {
    for (const row of account.rows) {
      const fact = factForAccount(facts, row.platform, row.account_alias);
      if (fact) found.add(fact);
      else missing.add(accountKey(row));
    }
  }
  return { rows: [...found], expected: found.size + missing.size };
}

export function AccountGroups({ accounts, config, facts, onSelect }: { accounts: Account[]; config: DirectoryConfig | null; facts?: AccountFactsView; onSelect: (key: string) => void }) {
  const names = useDisplayNames(config), t = useT();
  return <div className="section-stack">{groupAccounts(accounts, config).map(group => <section className="account-platform-group" key={group.platform}>
    <h2 className="account-platform-title">{names.platform(group.platform)}</h2>
    {facts && (() => {
      const units = platformFactsUnits(group.accounts, facts.rows);
      return <PlatformFactsSummary rows={units.rows} expected={units.expected} phase={facts.phase} />;
    })()}
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
          {row.pending_draft_count > 0 && <span className="account-row"><span>{t("accounts.col.drafts")}</span><span>{row.pending_draft_count}</span></span>}
          {row.pending_decision_count !== null && row.pending_decision_count > 0 && (
            <span className="account-row"><span>{t("accounts.col.todos")}</span><span>{row.pending_decision_count}</span></span>
          )}
          <span className="account-row"><span>{t("accounts.col.last_change")}</span><DateText value={row.last_change_at} /></span>
        </button>;
      })}
      {facts && (() => {
        // A display card is an alias/selector grouping, not a verified
        // identity. Producer-known duplicate aliases of one physical account
        // resolve to the canonical row; only several distinct canonical rows
        // under one card are unresolvable and stay an honest unverified state
        // instead of merging or picking one.
        const unique = [...new Set(account.rows
          .map(row => factForAccount(facts.rows, row.platform, row.account_alias))
          .filter((fact): fact is AccountFactsAccount => Boolean(fact)))];
        const canonical = unique.filter(fact => fact.aggregation_status !== "duplicate");
        const representative = canonical.length === 1 ? canonical[0]! : canonical.length === 0 && unique.length === 1 ? unique[0]! : null;
        return <AccountFactsAmounts fact={representative} phase={facts.phase} ambiguous={canonical.length > 1} />;
      })()}
    </article>)}</div>
  </section>)}</div>;
}
