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

export function CurrencyTotals({ totals }: { totals: CurrencyTotal[] }) {
  const t = useT();
  return <span className="currency-totals">
    {totals.map(item => <span className="currency-total" key={item.currency}>
      <span className="kpi-sub">{t(item.status === "partial" ? "perf.currency_subtotal" : "perf.currency_total", { currency: item.currency })}</span>
      <span className="num">{item.total === null ? "—" : <Money value={item.total} currency={item.currency} />}</span>
      {item.account_count < item.expected_account_count && <span className="kpi-sub">{t("perf.currency_accounts", { count: item.account_count })}</span>}
      {Boolean(item.excluded_account_count) && <span className="kpi-sub">{t("perf.currency_excluded_accounts", { count: item.excluded_account_count! })}</span>}
      <span className="kpi-foot">
        {item.status === "partial" ? <Badge tone="warn">{t("state.partial_valuation")}</Badge> : <StatusBadge status={item.status} />}
        <AsOfStamp value={item.as_of} />
      </span>
      {item.unavailable_reason && <span className="kpi-sub">{t(`reason.${item.unavailable_reason}`)}</span>}
    </span>)}
  </span>;
}
