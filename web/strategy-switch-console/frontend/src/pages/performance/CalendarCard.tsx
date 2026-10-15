import { useState } from "react";
import type { ReactNode } from "react";
import { useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { loadPerformanceCalendar } from "../../api/endpoints";
import type { Range } from "../../api/contracts";
import { AsOfStamp, Badge, EmptyState, ErrorState, Skeleton, StatusBadge } from "../../components/primitives";
import { CalendarHeatmap } from "../../charts/CalendarHeatmap";
import { renderableStatus } from "./shared";

export interface CalendarCardProps {
  scope: string;
  platform: string | undefined;
  range: Range;
  epoch: number;
}

export function CalendarCard({ scope, platform, range, epoch }: CalendarCardProps) {
  const t = useT();
  const now = new Date();
  const [view, setView] = useState<{ year: number; month: number | null }>({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
  const state = useApi(
    () => loadPerformanceCalendar(scope, range, view.year, view.month, platform),
    [scope, platform, range, view.year, view.month, epoch],
  );

  let body: ReactNode;
  let status: string | null = null;
  let reason: string | null = null;
  let asOf: string | null = null;
  let assetChange = false;
  let hasFlowDays = false;
  if (state.phase === "loading") {
    body = <Skeleton height={220} />;
  } else if (state.phase === "error") {
    body = <ErrorState onRetry={state.reload} />;
  } else {
    const data = state.data;
    status = data.status;
    reason = data.unavailable_reason;
    asOf = data.as_of;
    assetChange = data.value_kind === "asset_change";
    hasFlowDays = data.cells.some(cell => cell.observed_amount !== null && cell.observed_amount !== undefined);
    if (!renderableStatus(data.status)) {
      body = (
        <EmptyState
          title={t(`state.${data.status}`)}
          body={data.unavailable_reason ? t(`reason.${data.unavailable_reason}`) : undefined}
        />
      );
    } else if (data.cells.length === 0) {
      body = <EmptyState title={t("state.no_data")} />;
    } else {
      body = <CalendarHeatmap year={data.year} month={data.month} cells={data.cells} onNavigate={(year, month) => setView({ year, month })} />;
    }
  }

  return (
    <div className="card">
      <div className="perf-card-head">
        <h2 className="card-title">{t("perf.calendar_title")}</h2>
        {assetChange && <Badge tone="accent">{t("perf.value_kind_asset_change")}</Badge>}
        <div className="segmented" role="group" aria-label={t("perf.calendar_title")}>
          <button
            type="button"
            className={`segment${view.month !== null ? " active" : ""}`}
            aria-pressed={view.month !== null}
            onClick={() => setView(current => ({ ...current, month: current.month ?? new Date().getMonth() + 1 }))}
          >
            {t("perf.calendar_month")}
          </button>
          <button
            type="button"
            className={`segment${view.month === null ? " active" : ""}`}
            aria-pressed={view.month === null}
            onClick={() => setView(current => ({ ...current, month: null }))}
          >
            {t("perf.calendar_year")}
          </button>
        </div>
        <span className="perf-head-meta">
          {status && status !== "ok" && renderableStatus(status) && <StatusBadge status={status} reason={reason} />}
          {status && renderableStatus(status) && <AsOfStamp value={asOf} />}
        </span>
      </div>
      {body}
      {hasFlowDays && <p className="card-note">{t("perf.calendar_deposit_note")}</p>}
    </div>
  );
}
