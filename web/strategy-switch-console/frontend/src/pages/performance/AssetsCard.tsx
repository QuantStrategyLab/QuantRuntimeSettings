import { CurrencyTotals, FreshnessSummary } from "../../components/CurrencyTotals";
import type { ReactNode } from "react";
import { useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { loadPerformanceAssets } from "../../api/endpoints";
import type { Point, Range } from "../../api/contracts";
import { AsOfStamp, EmptyState, ErrorState, Skeleton, StatusBadge } from "../../components/primitives";
import { AreaChart } from "../../charts/AreaChart";
import { renderableStatus } from "./shared";

export interface AssetsCardProps {
  scope: string;
  platform: string | undefined;
  range: Range;
  epoch: number;
}

export function AssetsCard({ scope, platform, range, epoch }: AssetsCardProps) {
  const t = useT();
  const state = useApi(() => loadPerformanceAssets(scope, range, platform), [scope, platform, range, epoch]);

  let totals: ReactNode;
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
      {body}
      <p className="card-note">{t("perf.assets_note")}</p>
    </div>
  );
}
