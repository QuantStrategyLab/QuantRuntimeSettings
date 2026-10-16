import type { CurrencyTotal, FreshnessCounts } from "../api/contracts";
import { useT } from "../i18n";
import { AsOfStamp, Money, StatusBadge } from "./primitives";
import "./currency-totals.css";

export function FreshnessSummary({ counts }: { counts?: FreshnessCounts }) {
  const t = useT();
  if (!counts) return null;
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
      <span className="kpi-sub">{t("perf.currency_accounts", { count: item.account_count, expected: item.expected_account_count })}</span>
      {Boolean(item.excluded_account_count) && <span className="kpi-sub">{t("perf.currency_excluded_accounts", { count: item.excluded_account_count! })}</span>}
      <span className="kpi-foot"><StatusBadge status={item.status} /><AsOfStamp value={item.as_of} /></span>
      {item.unavailable_reason && <span className="kpi-sub">{t(`reason.${item.unavailable_reason}`)}</span>}
    </span>)}
  </span>;
}
