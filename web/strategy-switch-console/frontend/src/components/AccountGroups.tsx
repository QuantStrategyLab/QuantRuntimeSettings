import { ExecutionEvidence } from "./ExecutionEvidence";
import { accountKey, groupAccounts, type DirectoryConfig } from "../lib/accountDirectory";
import { factForAccount } from "../lib/accountFacts";
import { useDisplayNames } from "../lib/useDisplayNames";
import { useT } from "../i18n";
import type { AccountFactsAccount, AccountsResponse } from "../api/contracts";
import { DateText } from "./primitives";
import {
  AccountFactsAmounts,
  EnvironmentBadge,
  PlatformFactsSummary,
  environmentOfFacts,
  type AccountEnvironment,
  type FactsPhase,
} from "./AccountFactsAmounts";

type Account = AccountsResponse["accounts"][number];
type EnvironmentSection = AccountEnvironment | "unknown";

const ENVIRONMENT_ORDER: readonly EnvironmentSection[] = ["live", "paper", "unknown"];

function evidenceEnvironment(evidence: { broker_environment?: "live" | "paper" | null } | undefined): AccountEnvironment | null {
  return evidence?.broker_environment === "paper" || evidence?.broker_environment === "live"
    ? evidence.broker_environment
    : null;
}

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

function sectionOf(environment: AccountEnvironment | null): EnvironmentSection {
  return environment ?? "unknown";
}

export function AccountGroups({ accounts, config, facts, onSelect }: { accounts: Account[]; config: DirectoryConfig | null; facts?: AccountFactsView; onSelect: (key: string) => void }) {
  const names = useDisplayNames(config), t = useT();
  return <div className="section-stack account-groups">{groupAccounts(accounts, config).map(group => {
    // One rollup per platform keeps the producer's live scope intact (paper is
    // excluded inside platformCurrencyTotals; unconfirmed rows stay in the
    // denominator). The live total is only attached to the live section below.
    const units = facts ? platformFactsUnits(group.accounts, facts.rows) : null;
    const cards = group.accounts.map(account => {
      // A display card is an alias/selector grouping, not a verified
      // identity. Producer-known duplicate aliases of one physical account
      // resolve to the canonical row; only several distinct canonical rows
      // under one card are unresolvable and stay an honest unverified state
      // instead of merging or picking one.
      const unique = [...new Set(account.rows
        .map(row => factForAccount(facts?.rows ?? [], row.platform, row.account_alias))
        .filter((fact): fact is AccountFactsAccount => Boolean(fact)))];
      const canonical = unique.filter(fact => fact.aggregation_status !== "duplicate");
      const representative = canonical.length === 1 ? canonical[0]! : canonical.length === 0 && unique.length === 1 ? unique[0]! : null;
      const evidenceEnvironments = new Set(account.rows
        .map(row => evidenceEnvironment(config?.currentStrategies?.[row.platform]?.[row.account_alias]?.execution_evidence))
        .filter((value): value is AccountEnvironment => value !== null));
      const environment = environmentOfFacts(
        unique,
        evidenceEnvironments.size === 1 ? [...evidenceEnvironments][0]! : null,
      );
      return { account, canonical, representative, environment };
    });
    const sections = ENVIRONMENT_ORDER
      .map(environment => ({ environment, cards: cards.filter(card => sectionOf(card.environment) === environment) }))
      .filter(section => section.cards.length > 0);
    return <section className="account-platform-group" key={group.platform}>
      <div className="account-platform-head">
        <h2 className="account-platform-title">{names.platform(group.platform)}</h2>
      </div>
      {sections.map(section => <section className="account-environment-section" data-environment={section.environment} key={section.environment}>
        <div className="account-environment-head">
          <h3 className="account-environment-title">{t(`accounts.environment.${section.environment}`)}</h3>
          <span className="card-note">{t("accounts.environment_count", { count: section.cards.length })}</span>
          {section.environment === "live" && facts && units
            ? <div className="account-platform-summary"><PlatformFactsSummary rows={units.rows} expected={units.expected} phase={facts.phase} /></div>
            : null}
        </div>
        {section.environment !== "live" && <p className="card-note account-environment-note">{t(`accounts.environment.${section.environment}_note`)}</p>}
        <div className="account-grid">{section.cards.map(({ account, canonical, representative, environment }) => <article className="card account-group-card" key={account.identity}>
          <div className="account-card-head">
            <h3 className="account-broker-title">{names.account(account.rows[0].account_alias, group.platform)}</h3>
            <EnvironmentBadge environment={environment} />
          </div>
          {facts && <div className="account-card-facts">
            <AccountFactsAmounts fact={representative} phase={facts.phase} ambiguous={canonical.length > 1} />
          </div>}
          {account.rows.map(row => {
            const strategy = names.currentStrategy(row);
            const evidence = config?.currentStrategies?.[row.platform]?.[row.account_alias]?.execution_evidence;
            const enabled = config?.currentStrategies?.[row.platform]?.[row.account_alias]?.runtime_target_enabled;
            return <div className="account-strategy-block" key={accountKey(row)}>
              <button type="button" className="account-strategy-link" onClick={() => onSelect(accountKey(row))}>
                <span className="account-strategy-name">{strategy ? names.strategy(strategy) : t("common.unknown")}</span>
                {typeof enabled === "boolean" && <span className="account-row"><span title={t("accounts.execution.runtime_target_note")}>{t("accounts.activation_setting")}</span><span>{t(enabled ? "overview.runtime_enabled" : "overview.runtime_disabled")}</span></span>}
                {row.pending_draft_count > 0 && <span className="account-row"><span>{t("accounts.col.drafts")}</span><span>{row.pending_draft_count}</span></span>}
                {row.pending_decision_count !== null && row.pending_decision_count > 0 && (
                  <span className="account-row"><span>{t("accounts.col.todos")}</span><span>{row.pending_decision_count}</span></span>
                )}
                <span className="account-row"><span>{t("accounts.col.last_change")}</span><DateText value={row.last_change_at} /></span>
              </button>
              <ExecutionEvidence evidence={evidence} compact />
            </div>;
          })}
        </article>)}</div>
      </section>)}
    </section>;
  })}
  </div>;
}
