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
    status = data.status;
    reason = data.unavailable_reason;
    asOf = data.as_of;
    if (!renderableStatus(data.status)) {
      body = (
        <EmptyState
          title={t(`state.${data.status}`)}
          body={data.unavailable_reason ? t(`reason.${data.unavailable_reason}`) : undefined}
        />
      );
    } else if (data.unavailable_reason === "mixed_currency") {
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
      {body}
      <p className="card-note">{t("perf.assets_note")}</p>
    </div>
  );
}
