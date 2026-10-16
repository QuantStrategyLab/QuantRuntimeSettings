import { useState } from "react";
import type { ReactNode } from "react";
import { useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { loadPerformanceReturns } from "../../api/endpoints";
import type { Point, Range, ReturnsResponse } from "../../api/contracts";
import { AsOfStamp, EmptyState, ErrorState, MethodNote, Skeleton, StatusBadge } from "../../components/primitives";
import { LineChart, type ChartSeries } from "../../charts/LineChart";
import { renderableStatus } from "./shared";

export interface ReturnsCardProps {
  scope: string;
  platform: string | undefined;
  range: Range;
  epoch: number;
}

type Mode = "cumulative" | "daily";

const BENCHMARK_COLORS = ["var(--benchmark-1)", "var(--benchmark-2)", "var(--benchmark-3)", "var(--benchmark-4)"];
const BENCHMARK_LABEL_KEYS: Record<string, string> = {
  "标普500": "perf.benchmark_sp500",
  "纳斯达克100": "perf.benchmark_nasdaq100",
  "道琼斯工业平均指数": "perf.benchmark_dow",
  "罗素2000": "perf.benchmark_russell2000",
};

function kindLabel(returnKind: string): string {
  return returnKind === "unadjusted_asset_ratio" ? "perf.return_kind_unadjusted" : "perf.return_kind_twr";
}

function ReturnsChart({
  points,
  benchmarks,
  returnKind,
  mode,
  ariaLabel,
  disabled,
}: {
  points: Point[];
  benchmarks: { id: string; points: Point[] }[];
  returnKind: string;
  mode: Mode;
  ariaLabel: string;
  disabled?: { id: string; status: string; unavailable_reason: string | null }[];
}) {
  const t = useT();
  const series: ChartSeries[] = [
    { id: "main", label: t("perf.returns_main_series"), color: "var(--accent)", points, primary: true },
    ...benchmarks.slice(0, 4).map((benchmark, index) => ({
      id: benchmark.id,
      label: t(BENCHMARK_LABEL_KEYS[benchmark.id] || "perf.benchmark_unknown"),
      color: BENCHMARK_COLORS[index]!,
      points: benchmark.points,
    })),
  ];
  return (
    <div>
      <p className="card-note" style={{ marginTop: 0 }}>
        <span className="perf-kind">{t(kindLabel(returnKind))}</span>
      </p>
      <LineChart series={series} mode={mode} ariaLabel={ariaLabel} />
      {disabled && disabled.length > 0 && (
        <div className="perf-benchmarks-off">
          {disabled.map(item => (
            <span
              key={item.id}
              className="perf-benchmark-off"
              title={item.unavailable_reason ? t(`reason.${item.unavailable_reason}`) : undefined}
            >
              {t(BENCHMARK_LABEL_KEYS[item.id] || "perf.benchmark_unknown")} · {t(`state.${item.status}`)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReturnsCard({ scope, platform, range, epoch }: ReturnsCardProps) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("cumulative");
  const state = useApi(() => loadPerformanceReturns(scope, range, platform), [scope, platform, range, epoch]);

  let body: ReactNode;
  let meta: ReturnsResponse | null = null;
  if (state.phase === "loading") {
    body = <Skeleton height={280} />;
  } else if (state.phase === "error") {
    body = <ErrorState onRetry={state.reload} />;
  } else {
    const data = state.data;
    meta = data;
    if (scope === "all" && data.per_currency.length > 0
      && (renderableStatus(data.status) || data.unavailable_reason === "mixed_currency")) {
      // Mixed-currency scope: one independently aligned curve per currency, never a combined one.
      body = (
        <div>
          <p className="card-note" style={{ marginTop: 0 }}>{t("perf.per_currency_note")}</p>
          {data.per_currency.map(entry => (
            <div className="perf-currency-block" key={entry.currency}>
              <h3 className="perf-currency-title">{entry.currency}</h3>
              {renderableStatus(entry.status) && entry.points.length > 0 ? (
                <ReturnsChart
                  points={entry.points}
                  benchmarks={entry.benchmarks}
                  returnKind={entry.return_kind}
                  mode={mode}
                  ariaLabel={`${t("perf.returns_title")} ${entry.currency}`}
                />
              ) : (
                <EmptyState
                  title={t(`state.${renderableStatus(entry.status) ? "no_data" : entry.status}`)}
                  body={entry.unavailable_reason ? t(`reason.${entry.unavailable_reason}`) : undefined}
                />
              )}
            </div>
          ))}
        </div>
      );
    } else if (!renderableStatus(data.status)) {
      body = (
        <EmptyState
          title={t(`state.${data.status}`)}
          body={data.unavailable_reason ? t(`reason.${data.unavailable_reason}`) : undefined}
        />
      );
    } else if (data.no_common_date) {
      body = <EmptyState title={t("state.unavailable")} body={t("reason.no_common_date")} />;
    } else if (data.points.length === 0) {
      body = <EmptyState title={t("state.no_data")} body={data.unavailable_reason ? t(`reason.${data.unavailable_reason}`) : undefined} />;
    } else {
      body = (
        <ReturnsChart
          points={data.points}
          benchmarks={data.benchmarks}
          returnKind={data.return_kind}
          mode={mode}
          ariaLabel={t("perf.returns_title")}
          disabled={data.benchmark_availability.filter(item => !renderableStatus(item.status))}
        />
      );
    }
  }

  return (
    <div className="card">
      <div className="perf-card-head">
        <h2 className="card-title">{t("perf.returns_title")}</h2>
        <div className="perf-mode-toggle">
          <div className="segmented" role="group" aria-label={t("perf.returns_title")}>
            <button
              type="button"
              className={`segment${mode === "cumulative" ? " active" : ""}`}
              aria-pressed={mode === "cumulative"}
              onClick={() => setMode("cumulative")}
            >
              {t("perf.returns_cumulative")}
            </button>
            <button
              type="button"
              className={`segment${mode === "daily" ? " active" : ""}`}
              aria-pressed={mode === "daily"}
              onClick={() => setMode("daily")}
            >
              {t("perf.returns_daily")}
            </button>
          </div>
        </div>
        <span className="perf-head-meta">
          {meta && meta.status !== "ok" && renderableStatus(meta.status) && (
            <StatusBadge status={meta.status} reason={meta.unavailable_reason} />
          )}
          {meta && renderableStatus(meta.status) && <AsOfStamp value={meta.as_of} />}
        </span>
      </div>
      {body}
      <MethodNote titleKey="perf.how_calculated" bodyKey="perf.method_body" />
    </div>
  );
}
