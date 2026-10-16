import { CurrencyTotals, FreshnessSummary } from "../../components/CurrencyTotals";
import type { ReactNode } from "react";
import { useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { loadPerformanceAssets } from "../../api/endpoints";
import type { AccountFreshness, HistoryCoverage, Point, Range } from "../../api/contracts";
import { AsOfStamp, Badge, EmptyState, ErrorState, Skeleton, StatusBadge } from "../../components/primitives";
import { AreaChart } from "../../charts/AreaChart";
import { useDisplayNames } from "../../lib/useDisplayNames";
import { renderableStatus } from "./shared";

export interface AssetsCardProps {
  scope: string;
  platform: string | undefined;
  range: Range;
  epoch: number;
}

function HistoryNotice({ status, points, coverage, currency, accounts = [] }: {
  status: string;
  points: Point[];
  coverage?: HistoryCoverage | null;
  currency?: string | null;
  accounts?: AccountFreshness[];
}) {
  const t = useT();
  const names = useDisplayNames();
  if (status === "ok" && !points.some(point => point.partial) && !coverage?.truncated) return null;
  const affected = [...new Set([
    ...points.flatMap(point => [...(point.missing_accounts || []), ...(point.forward_filled_accounts || [])]),
    ...(coverage?.missing_accounts || []), ...(coverage?.excluded_accounts || []), ...(coverage?.read_failures || []),
  ])];
  const labels = [...new Set(affected.map(id => {
    const account = accounts.find(item => id === item.account_alias || id === item.account_ref ||
      id === `${item.platform}:${item.account_alias}:${currency}`);
    return names.account(account?.account_alias, account?.platform);
  }))];
  return <div className="card-note" role="status">
    <Badge tone="warn">{currency ? `${currency} · ` : ""}{t(status === "stale" ? "perf.history_stale" : "perf.history_incomplete")}</Badge>
    <p>{t("perf.history_coverage_note")}</p>
    {labels.length > 0 && <p>{t("perf.history_affected_accounts", { accounts: labels.join(" · ") })}</p>}
  </div>;
}

export function AssetsCard({ scope, platform, range, epoch }: AssetsCardProps) {
  const t = useT();
  const state = useApi(() => loadPerformanceAssets(scope, range, platform), [scope, platform, range, epoch]);

  let totals: ReactNode;
  let historyNotice: ReactNode;
  let body: ReactNode;
  let status: string | null = null;
  let reason: string | null = null;
  let asOf: string | null = null;
  if (state.phase === "loading") {
    body = <Skeleton height={220} />;
  } else if (state.phase === "error") {
    body = <ErrorState onRetry={state.reload} />;
  } else {
    const data = state.data;
    totals = data.per_currency?.length && data.unavailable_reason !== "stored_records_unreadable" ? <>
      <CurrencyTotals totals={data.per_currency} />
      <p className="card-note">{t("perf.native_totals_note")}</p>
      <p className="card-note"><FreshnessSummary counts={data.freshness_summary} /></p>
    </> : null;
    status = data.status;
    reason = data.unavailable_reason;
    asOf = data.as_of;
    const curveStatus = data.curve_status || data.status;
    const curveReason = data.curve_unavailable_reason === undefined ? data.unavailable_reason : data.curve_unavailable_reason;
    const histories = data.history_per_currency?.length ? data.history_per_currency : [{
      currency: data.currency, status: curveStatus, coverage: data.curve_coverage, points: data.points,
    }];
    historyNotice = histories.map(history => <HistoryNotice key={history.currency || "history"}
      {...history} status={histories.length === 1 ? curveStatus : history.status} accounts={data.account_freshness} />);
    if (data.per_currency?.length && curveReason === "mixed_currency") {
      body = null;
    } else if (!renderableStatus(curveStatus)) {
      body = (
        <EmptyState
          title={t(`state.${curveStatus}`)}
          body={curveReason ? t(`reason.${curveReason}`) : undefined}
        />
      );
    } else if (curveReason === "mixed_currency") {
      // Native currencies are never summed into one asset curve.
      body = <EmptyState title={t("perf.mixed_currency_title")} body={t("reason.mixed_currency")} />;
    } else if (data.points.length === 0) {
      body = <EmptyState title={t("state.no_data")} />;
    } else {
      // externalFlow markers only appear when the API actually reports a flow.
      const points = data.points as (Point & { externalFlow?: number | null })[];
      body = <AreaChart points={points} currency={data.currency} ariaLabel={t("perf.assets_title")} />;
    }
  }

  return (
    <div className="card">
      <div className="perf-card-head">
        <h2 className="card-title">{t("perf.assets_title")}</h2>
        <span className="perf-head-meta">
          {status && status !== "ok" && renderableStatus(status) && <StatusBadge status={status} reason={reason} />}
          {status && renderableStatus(status) && <AsOfStamp value={asOf} />}
        </span>
      </div>
      {totals}
      {historyNotice}
      {body}
      <p className="card-note">{t("perf.assets_note")}</p>
    </div>
  );
}
