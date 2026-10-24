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
 * Native-currency totals. The main view keeps amount, currency, source time and
 * one short coverage/freshness status; repeated counts, exclusion reasons and
 * the as-of/refresh distinction stay in one expandable data-notes entry.
 */
export function CurrencyTotals({ totals, freshness, notes }: {
  totals: CurrencyTotal[];
  freshness?: FreshnessCounts;
  notes?: ReactNode;
}) {
  const t = useT();
  const stale = freshness?.stale ?? 0;
  const notices = totals.filter(item => item.unavailable_reason || item.excluded_account_count);
  const hasAsOf = totals.some(item => Boolean(item.as_of));
  const hasDetails = notices.length > 0 || stale > 0 || hasAsOf || Boolean(notes);
  return <div className="currency-totals">
    {totals.map(item => {
      const status = item.total === null && item.status === "ok" ? "unavailable" : item.status;
      const coverage = item.account_count > 0 && item.account_count < item.expected_account_count ? item : null;
      return <div className="currency-total" key={item.currency}>
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
        </span>
      </div>;
    })}
    {stale > 0 && <span className="currency-status">{t("perf.data_may_be_stale")}</span>}
    {hasDetails && <details className="currency-details">
      <summary>{t("perf.data_notes")}</summary>
      {notices.map(item => <p key={item.currency}>
        <span className="currency-detail-name">{item.currency}</span>
        {item.unavailable_reason ? ` · ${t(`reason.${item.unavailable_reason}`)}` : ""}
        {item.excluded_account_count ? ` · ${t("perf.currency_excluded_accounts", { count: item.excluded_account_count })}` : ""}
      </p>)}
      {stale > 0 && freshness && <p>{t("perf.freshness_counts", { fresh: freshness.fresh, stale: freshness.stale, unknown: freshness.unknown })}</p>}
      {freshness && <p>{t("perf.freshness_threshold", { hours: freshness.threshold_hours })}</p>}
      {hasAsOf && <p>{t("perf.as_of_not_refresh")}</p>}
      {notes}
    </details>}
  </div>;
}
