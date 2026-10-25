import type { ReactNode } from "react";
import type { CurrencyTotal, FreshnessCounts } from "../api/contracts";
import { useT } from "../i18n";
import { AsOfStamp, Badge, Money, StatusBadge } from "./primitives";
import "./currency-totals.css";

/** Stale counts stay only as safe attributes when some account is stale. */
export function FreshnessSummary({ counts }: { counts?: FreshnessCounts }) {
  if (!counts || counts.stale <= 0) return null;
  return <span hidden data-state="stale" data-stale-count={counts.stale} />;
}

/**
 * Native-currency totals. Each row keeps amount, coverage, source time and one
 * short status; reasons and excluded/stale counts stay in non-sensitive data
 * attributes instead of visible audit copy.
 */
export function CurrencyTotals({ totals, freshness, notes }: {
  totals: CurrencyTotal[];
  freshness?: FreshnessCounts;
  notes?: ReactNode;
}) {
  const t = useT();
  const stale = freshness?.stale ?? 0;
  return <div className="currency-totals" data-stale-count={stale > 0 ? stale : undefined}>
    {totals.map(item => {
      const status = item.total === null && item.status === "ok" ? "unavailable" : item.status;
      const coverage = item.account_count > 0 && item.account_count < item.expected_account_count ? item : null;
      return <div className="currency-total" key={item.currency} data-state={status}
        data-reason={item.unavailable_reason ?? undefined}
        data-excluded-count={item.excluded_account_count || undefined}>
        <span className="currency-total-head">
          <span className="kpi-sub">{t(item.status === "partial" ? "perf.currency_subtotal" : "perf.currency_total", { currency: item.currency })}</span>
          <span className="num">{item.total === null ? "—" : <Money value={item.total} currency={item.currency} />}</span>
        </span>
        <span className="currency-meta">
          {coverage && <span className="kpi-sub">{t("facts.coverage", { covered: coverage.account_count, expected: coverage.expected_account_count })}</span>}
          {item.as_of && <AsOfStamp value={item.as_of} />}
          {/* The coverage count already states the short partial status. The
              badge is only needed when no count can carry that meaning. */}
          {status === "partial"
            ? !coverage && <Badge tone="warn">{t("perf.partial_accounts")}</Badge>
            : status !== "ok" && <StatusBadge status={status} />}
        </span>
      </div>;
    })}
    {notes && <p className="card-note currency-note">{notes}</p>}
  </div>;
}
