import type { ReactNode } from "react";
import type { CurrencyTotal, FreshnessCounts } from "../api/contracts";
import { useT } from "../i18n";
import { AsOfStamp, Badge, Money, StatusBadge } from "./primitives";
import "./currency-totals.css";

/** Freshness is surfaced only when some account is actually stale. */
export function FreshnessSummary({ counts }: { counts?: FreshnessCounts }) {
  const t = useT();
  if (!counts || counts.stale <= 0) return null;
  return <span title={t("perf.freshness_threshold", { hours: counts.threshold_hours })}>
    {t("perf.freshness_counts", { fresh: counts.fresh, stale: counts.stale, unknown: counts.unknown })}
  </span>;
}

/**
 * Native-currency totals. Each row keeps amount, coverage, source time and one
 * short status; a missing or excluded balance is stated once per currency
 * instead of behind a repeated data-notes disclosure.
 */
export function CurrencyTotals({ totals, freshness, notes }: {
  totals: CurrencyTotal[];
  freshness?: FreshnessCounts;
  notes?: ReactNode;
}) {
  const t = useT();
  const stale = freshness?.stale ?? 0;
  return <div className="currency-totals">
    {totals.map(item => {
      const status = item.total === null && item.status === "ok" ? "unavailable" : item.status;
      const coverage = item.account_count > 0 && item.account_count < item.expected_account_count ? item : null;
      return <div className="currency-total" key={item.currency} data-state={status}>
        <span className="kpi-sub">{t(item.status === "partial" ? "perf.currency_subtotal" : "perf.currency_total", { currency: item.currency })}</span>
        <span className="num">{item.total === null ? "—" : <Money value={item.total} currency={item.currency} />}</span>
        <span className="currency-meta">
          {coverage && <span className="kpi-sub">{t("facts.coverage", { covered: coverage.account_count, expected: coverage.expected_account_count })}</span>}
          {item.as_of && <AsOfStamp value={item.as_of} />}
          {/* The coverage count already states the short partial status. The
              badge is only needed when no count can carry that meaning. */}
          {status === "partial"
            ? !coverage && <Badge tone="warn">{t("perf.partial_accounts")}</Badge>
            : status !== "ok" && <StatusBadge status={status} />}
          {item.unavailable_reason && <span className="state-short">{t(`reason.${item.unavailable_reason}`)}</span>}
          {item.excluded_account_count ? (
            <span className="state-short">{t("perf.currency_excluded_accounts", { count: item.excluded_account_count })}</span>
          ) : null}
        </span>
      </div>;
    })}
    {stale > 0 && <span className="currency-status">{t("perf.data_may_be_stale")}</span>}
    {notes && <p className="card-note currency-note">{notes}</p>}
  </div>;
}
