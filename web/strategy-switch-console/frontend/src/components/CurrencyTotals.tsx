import type { CurrencyTotal, FreshnessCounts } from "../api/contracts";
import { useT } from "../i18n";
import { AsOfStamp, Money, StatusBadge } from "./primitives";
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
    {totals.map(item => {
      const reason = item.unavailable_reason ? t(`reason.${item.unavailable_reason}`) : null;
      const status = item.total === null && item.status === "ok" ? "unavailable" : item.status;
      const showStatus = status !== "ok" && status !== "partial" && !reason;
      return <span className="currency-total" key={item.currency}>
      <span className="kpi-sub">{t(item.status === "partial" ? "perf.currency_subtotal" : "perf.currency_total", { currency: item.currency })}</span>
      <span className="num">{item.total === null ? "—" : <Money value={item.total} currency={item.currency} />}</span>
      {item.account_count > 0 && item.account_count < item.expected_account_count && <span className="kpi-sub">{t("perf.currency_accounts", { count: item.account_count })}</span>}
      {Boolean(item.excluded_account_count) && <span className="kpi-sub">{t("perf.currency_excluded_accounts", { count: item.excluded_account_count! })}</span>}
      {(showStatus || item.as_of) && <span className="kpi-foot">
        {showStatus && <StatusBadge status={status} />}
        {item.as_of && <AsOfStamp value={item.as_of} />}
      </span>}
      {reason && <span className="kpi-sub">{reason}</span>}
    </span>;
    })}
  </span>;
}
