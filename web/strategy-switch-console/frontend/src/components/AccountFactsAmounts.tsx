import type { AccountFactsAccount } from "../api/contracts";
import { useT } from "../i18n";
import { useNavigate, usePrefs } from "../app/context";
import {
  accountFactDisplay,
  formatMoneyText,
  isPaperFact,
  isReadableFact,
  platformCurrencyTotals,
} from "../lib/accountFacts";
import { AsOfStamp, Skeleton } from "./primitives";
import "./account-facts.css";

export type FactsPhase = "loading" | "error" | "ready";

/** Single honest state line; read failure is never rendered as missing data. */
export function FactsStateRow({ label, stateKey }: { label: string; stateKey: string }) {
  const t = useT();
  return (
    <div className="account-facts">
      <span className="account-row"><span>{label}</span><span>{t(stateKey)}</span></span>
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
  if (prefs.hideAmounts) return <span className="money">•••</span>;
  if (value === null) return <span className="money flat">—</span>;
  return <span className="money flat">{formatMoneyText(value, currency ?? null)}</span>;
}

/**
 * Broker-reported assets and cash for one account, per currency. Read failures,
 * missing bindings, unknown enums and unavailable snapshots stay honest states;
 * a reported 0 is a real zero and missing values render as an em dash, never as
 * zero. Cash is labeled cash only — never buying power, available funds, or
 * margin. `conflict` means one trusted identity produced disagreeing
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
        <span className="account-row account-facts-cash" key={`cash-${row.currency}`} title={t("facts.cash_semantics")}>
          <span>{t("facts.cash")} · {row.currency}</span>
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
export function PlatformFactsSummary({ rows, expected, phase }: {
  rows: AccountFactsAccount[];
  expected: number;
  phase: FactsPhase;
}) {
  const t = useT();
  const navigate = useNavigate();
  if (phase === "loading") return <div className="account-facts"><Skeleton height={14} /></div>;
  if (phase === "error") return <FactsStateRow label={t("facts.platform_total")} stateKey="state.read_failed" />;
  const totals = platformCurrencyTotals(rows, expected);
  if (!totals.length) {
    // Empty totals in the live口径: paper-only scopes are an honest no-data,
    // while readable non-paper rows without any verified identity are an
    // identity problem, never a sum.
    const nonPaper = rows.filter(row => !isPaperFact(row));
    const anyVerified = nonPaper.some(row => isReadableFact(row) && row.aggregation_status === "included");
    const anyReadable = nonPaper.some(isReadableFact);
    const stateKey = !rows.length
      ? "state.not_connected"
      : anyVerified
        ? "state.no_data"
        : anyReadable
          ? "facts.platform_identity_unverified"
          : "state.no_data";
    if (stateKey === "facts.platform_identity_unverified") {
      return (
        <div className="account-facts account-facts-platform-state">
          <span className="account-row"><span>{t("facts.platform_total")}</span><span>{t(stateKey)}</span></span>
          <button type="button" className="button button-secondary button-sm" onClick={() => navigate({ page: "accounts" })}>
            {t("facts.identity_action")}
          </button>
        </div>
      );
    }
    return <FactsStateRow label={t("facts.platform_total")} stateKey={stateKey} />;
  }
  return (
    <div className="account-facts account-facts-platform">
      {totals.map(total => (
        <div className="account-facts-currency" key={total.currency}>
          <span className="account-row account-facts-assets">
            <span>{t(total.complete ? "facts.platform_total" : "facts.platform_subtotal")} · {total.currency}</span>
            <MoneyText value={total.netAssets} currency={total.currency} />
          </span>
          <span className="account-row account-facts-cash" title={t("facts.cash_semantics")}>
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
      {totals.some(total => !total.complete) && <details className="account-facts-notes account-platform-notes">
        <summary>{t("accounts.data_notes")}</summary>
        <p>{t("facts.platform_subtotal_note")}</p>
        <p>{t("facts.cash_semantics")}</p>
      </details>}
    </div>
  );
}
