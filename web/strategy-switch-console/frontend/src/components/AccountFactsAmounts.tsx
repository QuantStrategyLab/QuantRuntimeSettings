import type {
  AccountFactsAccount,
  AccountFactsAssetCoverage,
  ManagementEvidenceState,
  ManagementStatusCode,
} from "../api/contracts";
import { useLanguage, useT } from "../i18n";
import { usePrefs } from "../app/context";
import {
  accountFactDisplay,
  decidePlatformCohortFromRows,
  factEnvironment,
  formatMoneyText,
  isPaperFact,
  isReadableFact,
  platformCurrencyTotals,
  rowManagementDisposition,
  type PlatformCohortDecision,
} from "../lib/accountFacts";
import { managementEvidenceText, managementStatusText } from "../lib/accountManagementText";
import { maskedAmount } from "../lib/format";
import { AsOfStamp, Badge, Skeleton } from "./primitives";
import "./account-facts.css";

export type FactsPhase = "loading" | "error" | "ready";

export type AccountEnvironment = "paper" | "live";

/** Explicit live/paper badge; nothing is inferred when the source is unknown. */
export function EnvironmentBadge({ environment }: { environment: AccountEnvironment | null }) {
  const t = useT();
  if (!environment) return null;
  return <Badge tone={environment === "paper" ? "accent" : "warn"}>
    {t(environment === "paper" ? "common.paper_badge" : "strategies.execution.live")}
  </Badge>;
}

/**
 * One explicit environment for a card, or null when rows disagree / stay
 * unknown. Only an empty row set may fall back to another explicit source; a
 * facts row with no environment never borrows a label from its neighbours.
 */
export function environmentOfFacts(
  rows: AccountFactsAccount[],
  fallback: AccountEnvironment | null = null,
): AccountEnvironment | null {
  if (!rows.length) return fallback;
  const environments = rows.map(factEnvironment);
  const known = new Set(environments.filter((value): value is AccountEnvironment => value !== null));
  return environments.every(value => value !== null) && known.size === 1 ? [...known][0]! : null;
}

const SHORT_STATE = new Set([
  "state.read_failed",
  "state.not_connected",
  "state.no_data",
  "state.unknown_status",
  "facts.platform_management_unknown",
  "facts.platform_no_managed_accounts",
]);

/** Compact management membership badge for account cards using pinned bilingual text. */
export function ManagementStatusBadge({
  status,
  evidenceState = "known",
}: {
  status: ManagementStatusCode;
  evidenceState?: ManagementEvidenceState;
}) {
  const language = useLanguage();
  const statusLabel = managementStatusText(status, language);
  const evidenceLabel = managementEvidenceText(evidenceState, language);
  const tone = evidenceState === "conflict"
    ? "error"
    : status === "managed"
      ? (evidenceState === "stale" ? "warn" : "ok")
      : status === "management_disabled"
        ? "warn"
        : "unknown";
  return (
    <span className="management-badges" data-management-status={status} data-evidence-state={evidenceState}>
      <Badge tone={tone}>{statusLabel}</Badge>
      {evidenceLabel && (
        <Badge tone={evidenceState === "conflict" ? "error" : evidenceState === "stale" ? "warn" : "unknown"}>
          {evidenceLabel}
        </Badge>
      )}
    </span>
  );
}

/** Cohort coverage banner for `account_facts.asset_coverage.management_*`. */
export function AccountFactsManagementCoverageBar({ coverage }: { coverage?: AccountFactsAssetCoverage | null }) {
  const t = useT();
  if (!coverage?.management_scope || !coverage.management_counts) return null;
  const counts = coverage.management_counts;
  const complete = coverage.management_coverage_status === "complete";
  return (
    <div
      className="card management-coverage-bar"
      role="region"
      aria-label={t("facts.management_coverage.title")}
      data-management-coverage={coverage.management_coverage_status ?? "incomplete"}
    >
      <div className="management-coverage-head">
        <strong>{t("facts.management_coverage.title")}</strong>
        <Badge tone={complete ? "ok" : "warn"}>
          {t(complete ? "facts.management_coverage.complete" : "facts.management_coverage.incomplete")}
        </Badge>
      </div>
      <p className="card-note">
        {t("facts.management_coverage.counts", {
          managed: counts.managed_non_paper,
          disabled: counts.management_disabled_non_paper,
          outside: counts.not_under_management_non_paper,
          unknown: counts.unknown_non_paper,
          paper: counts.paper_excluded,
          duplicates: counts.duplicate_deployments,
          unresolved: counts.unresolved_deployments,
        })}
      </p>
      {coverage.totals_status === "unavailable" && (coverage.totals_reason === "management_status_unknown" || coverage.totals_reason === "no_managed_non_paper_accounts") && (
        <p className="accounts-inline-note error" data-state={`facts.${coverage.totals_reason}`}>
          {t(coverage.totals_reason === "management_status_unknown"
            ? "facts.platform_management_unknown"
            : "facts.platform_no_managed_accounts")}
        </p>
      )}
      <p className="card-note">{t("facts.management_coverage.raw_preserved")}</p>
    </div>
  );
}

/**
 * One short state plus an em dash. Exact conflict/identity state is exposed as
 * a non-sensitive data-state attribute, never as an expandable audit block.
 * A read failure is never rendered as missing data.
 */
export function FactsStateRow({ label, stateKey }: {
  label: string;
  stateKey: string;
}) {
  const t = useT();
  const short = SHORT_STATE.has(stateKey);
  return (
    <div className="account-facts account-facts-state" data-state={stateKey}>
      <span className="account-row">
        <span>{label}</span>
        <span className="account-facts-state-value">
          <span className="money flat">—</span>
          <span className="account-state-label">{t(short ? stateKey : "facts.amount_unavailable")}</span>
        </span>
      </span>
    </div>
  );
}

/**
 * Exact decimal-text money rendering for broker-reported facts: the validated
 * string is grouped and displayed without any float conversion, so no legal
 * amount is re-rounded. Unknown values stay an em dash; hideAmounts still masks.
 */
function MoneyText({ value, currency }: { value: string | null; currency?: string | null }) {
  const { prefs } = usePrefs();
  // A missing value is unknown, not a masked amount, so it stays an em dash.
  if (value === null) return <span className="money flat">—</span>;
  if (prefs.hideAmounts) return <span className="money">{maskedAmount(value)}</span>;
  return <span className="money flat">{formatMoneyText(value, currency ?? null)}</span>;
}

/**
 * Broker-reported assets and cash for one account, per currency. Read failures,
 * missing bindings, unknown enums and unavailable snapshots stay honest states;
 * a reported 0 is a real zero and missing values render as an em dash, never as
 * zero. Cash balances and LongBridge available cash have separate labels;
 * neither is buying power or margin. `conflict` means one trusted identity produced disagreeing
 * observations; `ambiguous` means a display group holds several distinct
 * verified accounts, so no single amount can be attributed to it.
 */
export function AccountFactsAmounts({ fact, phase, conflict = false, ambiguous = false }: {
  fact: AccountFactsAccount | null;
  phase: FactsPhase;
  conflict?: boolean;
  ambiguous?: boolean;
}) {
  const t = useT();
  if (phase === "loading") return <div className="account-facts"><Skeleton height={14} /></div>;
  if (phase === "error") return <FactsStateRow label={t("facts.assets")} stateKey="state.read_failed" />;
  if (conflict) return <FactsStateRow label={t("facts.assets")} stateKey="facts.observation_conflict" />;
  if (ambiguous) return <FactsStateRow label={t("facts.assets")} stateKey="facts.identity_unverified" />;
  const display = accountFactDisplay(fact);
  if (display.kind === "not_connected") return <FactsStateRow label={t("facts.assets")} stateKey="state.not_connected" />;
  if (display.kind === "identity_unverified") return <FactsStateRow label={t("facts.assets")} stateKey="facts.identity_unverified" />;
  if (display.kind === "unknown") return <FactsStateRow label={t("facts.assets")} stateKey="state.unknown_status" />;
  if (display.kind === "no_data") return <FactsStateRow label={t("facts.assets")} stateKey="state.no_data" />;
  if (!display.balances.length && !display.cash.length) return <FactsStateRow label={t("facts.assets")} stateKey="state.no_data" />;
  return (
    <div className="account-facts">
      {display.balances.map(row => (
        <span className="account-row account-facts-assets" key={`assets-${row.currency}`}>
          <span>{t("facts.assets")} · {row.currency}</span>
          <MoneyText value={row.netAssets} currency={row.currency} />
        </span>
      ))}
      {display.cash.map(row => (
        <span className="account-row account-facts-cash" key={`cash-${row.available ? "available-" : ""}${row.currency}`}>
          <span>{t(row.available ? "facts.available_cash" : "facts.cash")} · {row.currency}</span>
          <MoneyText value={row.cashBalance} currency={row.currency} />
        </span>
      ))}
      {(display.asOf || display.stale) && <div className="kpi-foot account-facts-freshness">
        {display.asOf
          ? <AsOfStamp value={display.asOf} prefix={display.stale ? "facts.as_of_stale" : "common.as_of"} />
          : <span className="asof">{t("facts.stale_pending")}</span>}
      </div>}
    </div>
  );
}

/**
 * Platform-level rollup over the accounts of one platform. `rows` are the
 * distinct facts rows reached through the trusted platform+account_key join
 * (one row per physical account candidate, deduplicated by reference, never by
 * content or display alias); `expected` counts every distinct account in the
 * scope, including unconnected ones. Only rows the producer marked
 * aggregation_status "included" join a sum, and only for the latest common
 * valuation date — everything else stays an observed subtotal or an honest
 * state, never a complete platform total.
 */
export function PlatformFactsSummary({ rows, expected, phase, cohort }: {
  rows: AccountFactsAccount[];
  expected: number;
  phase: FactsPhase;
  cohort?: PlatformCohortDecision;
}) {
  const t = useT();
  if (phase === "loading") return <div className="account-facts"><Skeleton height={14} /></div>;
  if (phase === "error") return <FactsStateRow label={t("facts.platform_total_live")} stateKey="state.read_failed" />;
  const decision = cohort ?? decidePlatformCohortFromRows(rows, expected);
  const totals = decision.managementUnknown || decision.allExcludedByManagement
    ? []
    : platformCurrencyTotals(rows, expected, decision);
  if (!totals.length) {
    // Empty totals in the live口径: paper-only scopes are an honest no-data,
    // while readable non-paper rows without any verified identity are an
    // identity problem, never a sum. Full-cohort disposition decides both
    // unknown veto and known-empty before checking matched facts rows.
    const entries = rows.map(row => ({ row, disposition: rowManagementDisposition(row) }));
    const hasStamped = decision.hasStamped;
    const anyManagementUnknown = decision.managementUnknown;
    const allExcludedByManagement = decision.allExcludedByManagement;
    const nonPaper = hasStamped
      ? entries.filter(entry => entry.disposition !== "paper").map(entry => entry.row)
      : rows.filter(row => !isPaperFact(row));
    const anyVerified = nonPaper.some(row => isReadableFact(row) && row.aggregation_status === "included");
    const anyReadable = nonPaper.some(isReadableFact);
    const stateKey = !rows.length && !anyManagementUnknown
      ? "state.not_connected"
      : anyManagementUnknown
        ? "facts.platform_management_unknown"
        : allExcludedByManagement
          ? "facts.platform_no_managed_accounts"
          : anyVerified
            ? "state.no_data"
            : anyReadable
              ? "facts.platform_identity_unverified"
              : "state.no_data";
    // The full verification workflow stays available on the Accounts page; the
    // summary itself only reports the unresolved identity state.
    return <FactsStateRow label={t("facts.platform_total_live")} stateKey={stateKey} />;
  }
  return (
    <div className="account-facts account-facts-platform">
      {totals.map(total => (
        <div className="account-facts-currency" key={total.currency}>
          <span className="account-row account-facts-assets">
            <span title={t("facts.platform_scope_note")}>
              {t(total.complete ? "facts.platform_total_live" : "facts.platform_subtotal_live")} · {total.currency}
            </span>
            <MoneyText value={total.netAssets} currency={total.currency} />
          </span>
          <span className="account-row account-facts-cash">
            <span>{t("facts.cash")} · {total.currency}</span>
            <MoneyText value={total.cashBalance} currency={total.currency} />
          </span>
          <div className="kpi-foot account-facts-freshness">
            {total.covered < total.expected && <span className="asof">{t("facts.coverage", { covered: total.covered, expected: total.expected })}</span>}
            {total.observationDate
              ? <span className="asof">{t(total.stale ? "facts.as_of_stale" : "common.as_of", { value: total.observationDate })}</span>
              : total.stale && <span className="asof">{t("facts.stale_pending")}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
