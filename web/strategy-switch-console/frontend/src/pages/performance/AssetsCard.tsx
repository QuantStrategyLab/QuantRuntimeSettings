import { CurrencyTotals } from "../../components/CurrencyTotals";
import { useState } from "react";
import type { ReactNode } from "react";
import { useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { loadPerformanceAssets } from "../../api/endpoints";
import type { HistoryCoverage, Point, Range } from "../../api/contracts";
import { AsOfStamp, EmptyState, ErrorState, Skeleton, StatusBadge } from "../../components/primitives";
import { AreaChart } from "../../charts/AreaChart";
import { renderableStatus } from "./shared";

export interface AssetsCardProps {
  scope: string;
  platform: string | undefined;
  range: Range;
  epoch: number;
}

function HistoryNotice({ status, points, coverage, reason }: {
  status: string;
  points: Point[];
  coverage?: HistoryCoverage | null;
  reason?: string | null;
}) {
  const t = useT();
  const partial = points.some(point => point.partial) || Boolean(coverage?.truncated) || Boolean(coverage?.read_failures?.length);
  const badgeStatus = status === "ok" ? (partial ? "partial" : "ok") : status;
  if (badgeStatus === "ok") return null;
  const affected = [...new Set([
    ...points.flatMap(point => [...(point.missing_accounts || []), ...(point.forward_filled_accounts || [])]),
    ...(coverage?.missing_accounts || []), ...(coverage?.excluded_accounts || []), ...(coverage?.read_failures || []),
  ])];
  // Account identifiers stay in the API payload; only a safe count and reason
  // remain next to the short status.
  return <span className="history-notice" role="status" data-state={badgeStatus}
    data-reason={reason ?? undefined} data-affected-count={affected.length || undefined}>
    <StatusBadge status={badgeStatus} />
    {affected.length > 0 && <span className="card-note">{t("perf.history_affected_accounts", { count: affected.length })}</span>}
    {reason && <span className="card-note">{t(`reason.${reason}`)}</span>}
  </span>;
}

export function AssetsCard({ scope, platform, range, epoch }: AssetsCardProps) {
  const t = useT();
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
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
    totals = data.per_currency?.length && data.unavailable_reason !== "stored_records_unreadable"
      ? <CurrencyTotals
          totals={data.per_currency}
          freshness={data.freshness_summary}
          notes={data.per_currency.length > 1 ? t("perf.native_totals_note") : undefined}
        />
      : null;
    status = data.status;
    reason = data.unavailable_reason;
    asOf = data.as_of;
    const curveStatus = data.curve_status || data.status;
    const curveReason = data.curve_unavailable_reason === undefined ? data.unavailable_reason : data.curve_unavailable_reason;
    const histories = data.history_per_currency?.length ? data.history_per_currency : [{
      currency: data.currency, status: curveStatus, coverage: data.curve_coverage, points: data.points,
      unavailable_reason: data.curve_unavailable_reason ?? data.unavailable_reason,
    }];
    if (data.per_currency?.length && curveReason === "mixed_currency") {
      // Mixed currencies are never summed. Show one native-currency curve at a time.
      const available = histories.filter(history => history.points.length > 0);
      const selected = available.find(history => history.currency === selectedCurrency) ?? available[0];
      if (!selected) {
        body = <div data-reason="mixed_currency"><EmptyState title={t("perf.mixed_currency_title")} state="unavailable" /></div>;
      } else {
        historyNotice = <HistoryNotice status={selected.status} points={selected.points}
          coverage={selected.coverage} reason={selected.unavailable_reason} />;
        body = (
          <div>
            <div className="perf-currency-switch">
              <div className="segmented" role="group" aria-label={t("perf.currency_switch")}>
                {available.map(history => (
                  <button
                    key={history.currency || "native"}
                    type="button"
                    className={`segment${history.currency === selected.currency ? " active" : ""}`}
                    aria-pressed={history.currency === selected.currency}
                    onClick={() => setSelectedCurrency(history.currency ?? null)}
                  >
                    {history.currency || t("perf.currency_switch")}
                  </button>
                ))}
              </div>
            </div>
            <AreaChart points={selected.points} currency={selected.currency} ariaLabel={t("perf.asset_balance_title")} />
          </div>
        );
      }
    } else {
      // A read failure has no partial coverage to describe; the state below says so.
      historyNotice = renderableStatus(curveStatus) ? histories.map(history => <HistoryNotice key={history.currency || "history"}
        status={histories.length === 1 ? curveStatus : history.status}
        points={history.points} coverage={history.coverage} reason={history.unavailable_reason} />) : null;
      if (!renderableStatus(curveStatus)) {
        body = (
          <div data-reason={curveReason ?? undefined}>
            <EmptyState title={t(`state.${curveStatus}`)} state={curveStatus} body={curveReason ? t(`reason.${curveReason}`) : undefined} />
          </div>
        );
      } else if (curveReason === "mixed_currency") {
        // Native currencies are never summed into one asset curve.
        body = <div data-reason="mixed_currency"><EmptyState title={t("perf.mixed_currency_title")} state="unavailable" /></div>;
      } else if (data.points.length === 0) {
        body = <div data-reason={data.unavailable_reason ?? undefined}><EmptyState title={t("state.no_data")} state="no_data" body={curveReason ? t(`reason.${curveReason}`) : undefined} /></div>;
      } else {
        // externalFlow markers only appear when the API actually reports a flow.
        const points = data.points as (Point & { externalFlow?: number | null })[];
        body = <AreaChart points={points} currency={data.currency} ariaLabel={t("perf.asset_balance_title")} />;
      }
    }
  }

  return (
    <div className="card">
      <div className="perf-card-head">
        <h2 className="card-title">{t("perf.asset_balance_title")}</h2>
        <span className="perf-head-meta">
          {status && status !== "ok" && renderableStatus(status) && <StatusBadge status={status} reason={reason} />}
          {status && renderableStatus(status) && asOf && <AsOfStamp value={asOf} />}
        </span>
      </div>
      {totals}
      {historyNotice}
      {body}
    </div>
  );
}
