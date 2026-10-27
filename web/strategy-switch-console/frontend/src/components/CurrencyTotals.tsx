import type { ReactNode } from "react";
import type { CurrencyTotal, FreshnessCounts } from "../api/contracts";
import { useDisplayNames } from "../lib/useDisplayNames";
import { useT } from "../i18n";
import { AsOfStamp, Badge, Money, StatusBadge } from "./primitives";
import "./currency-totals.css";

/** Account freshness is source time, independent of page refresh. */
export function FreshnessSummary({ counts }: { counts?: FreshnessCounts }) {
  if (!counts || counts.stale <= 0) return null;
  return <span data-state="stale" data-stale-count={counts.stale}><StatusBadge status="stale" /></span>;
}

/**
 * Native-currency totals. Each row keeps amount, coverage, source time and one
 * short status; the account breakdown explains exclusions without inventing balances.
 */
export function CurrencyTotals({ totals, freshness, notes }: {
  totals: CurrencyTotal[];
  freshness?: FreshnessCounts;
  notes?: ReactNode;
}) {
  const t = useT();
  const names = useDisplayNames();
  const stale = freshness?.stale ?? 0;
  return <div className="currency-totals" data-stale-count={stale > 0 ? stale : undefined}>
    {totals.map(item => {
      const status = item.total === null && item.status === "ok" ? "unavailable" : item.status;
      const latestBalance = item.latest_as_of !== undefined;
      const coverage = item.expected_account_count > 0 && (latestBalance || item.account_count < item.expected_account_count) ? item : null;
      const sourceRange = Boolean(item.as_of && item.latest_as_of && item.as_of !== item.latest_as_of);
      return <div className="currency-total" key={item.currency} data-state={status}
        data-reason={item.unavailable_reason ?? undefined}
        data-excluded-count={item.excluded_account_count || undefined}>
        <span className="currency-total-head">
          <span className="kpi-sub">{t(latestBalance
            ? item.status === "partial" ? "perf.latest_balance_subtotal" : "perf.latest_balance_total"
            : item.status === "partial" ? "perf.currency_subtotal" : "perf.currency_total", { currency: item.currency })}</span>
          <span className="num">{item.total === null ? "—" : <Money value={item.total} currency={item.currency} />}</span>
        </span>
        <span className="currency-meta">
          {coverage && <span className="kpi-sub">{t("facts.coverage", { covered: coverage.account_count, expected: coverage.expected_account_count })}</span>}
          {item.as_of && (latestBalance ? <span className="currency-observation-time">
            <AsOfStamp value={item.as_of} prefix={sourceRange ? "perf.balance_oldest_time" : "perf.balance_source_time"} />
            {sourceRange && <AsOfStamp value={item.latest_as_of} prefix="perf.balance_latest_time" />}
          </span> : <AsOfStamp value={item.as_of} />)}
          {item.stale && status !== "stale" && <StatusBadge status="stale" />}
          {/* The coverage count already states the short partial status. The
              badge is only needed when no count can carry that meaning. */}
          {status === "partial"
            ? !coverage && <Badge tone="warn">{t("perf.partial_accounts")}</Badge>
            : status !== "ok" && <StatusBadge status={status} />}
        </span>
        {item.account_coverage?.length ? <details className="currency-details">
          <summary>{t("perf.coverage_details")}</summary>
          <ul className="currency-coverage-list">{item.account_coverage.map(account => <li key={`${account.platform}:${account.account_alias}`}>
            <span className="currency-detail-name">{account.platform ? `${names.platform(account.platform)} · ` : ""}{names.account(account.account_alias, account.platform)}</span>
            <span>{t(account.included ? "perf.account_included" : "perf.account_excluded")}{account.unavailable_reason ? ` · ${t(`reason.${account.unavailable_reason}`)}` : ""}</span>
            <span>{account.observation_date ? t("perf.valuation_date", { date: account.observation_date }) : t("reason.no_snapshot")}</span>
            {account.as_of && <AsOfStamp value={account.as_of} />}
            {(latestBalance || account.freshness !== "fresh") && <StatusBadge status={account.freshness || "unknown"} />}
          </li>)}</ul>
        </details> : item.unavailable_reason && status !== "ok" ? <p className="card-note">{t(`reason.${item.unavailable_reason}`)}</p> : null}
      </div>;
    })}
    {notes && <p className="card-note currency-note">{notes}</p>}
  </div>;
}
