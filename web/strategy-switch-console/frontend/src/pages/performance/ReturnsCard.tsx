import { useState } from "react";
import type { ReactNode } from "react";
import { useScope } from "../../app/context";
import { useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { useScopeLabel } from "../../lib/useScopeLabel";
import { loadPerformanceReturns } from "../../api/endpoints";
import type { CashflowMethodMeta, Point, Range, ReturnsResponse } from "../../api/contracts";
import { AsOfStamp, EmptyState, ErrorState, MethodNote, Skeleton, StatusBadge } from "../../components/primitives";
import { LineChart, type ChartSeries } from "../../charts/LineChart";
import { renderableStatus } from "./shared";
import { DIETZ_APPROX_LABEL_KEY, UNKNOWN_METHOD_LABEL_KEY, classifyCashflowMethod, isApproximateDietz } from "./cashflowMethod";
import {
  benchmarkCurrencyAllowed,
  benchmarkPolicy,
  type BenchmarkPolicy,
} from "./benchmarkPolicy";

export interface ReturnsCardProps {
  scope: string;
  platform: string | undefined;
  range: Range;
  epoch: number;
}

type Mode = "cumulative" | "daily";
type CurrencyEntry = ReturnsResponse["per_currency"][number];
type BenchmarkAvailability = ReturnsResponse["benchmark_availability"][number];

const BENCHMARK_COLORS = ["var(--benchmark-1)", "var(--benchmark-2)", "var(--benchmark-3)", "var(--benchmark-4)"];
const BENCHMARK_LABEL_KEYS: Record<string, string> = {
  "标普500": "perf.benchmark_sp500",
  "纳斯达克100": "perf.benchmark_nasdaq100",
  "道琼斯工业平均指数": "perf.benchmark_dow",
  "罗素2000": "perf.benchmark_russell2000",
};

interface ReturnView {
  points: Point[];
  benchmarks: { id: string; points: Point[] }[];
  returnKind: string;
  method?: CashflowMethodMeta | null;
  alignedStart: string | null;
  currency: string | null;
  status: string;
  unavailableReason: string | null;
  asOf: string | null;
  disabled: BenchmarkAvailability[];
}

interface BenchmarkView {
  series: { id: string; points: Point[] }[];
  defaults: string[];
  disabled: BenchmarkAvailability[];
}

const NO_BENCHMARKS: BenchmarkView = { series: [], defaults: [], disabled: [] };

function kindLabel(returnKind: string, method?: CashflowMethodMeta | null): string {
  // The unadjusted ratio plots a percentage change that includes cash flows; it is not a balance.
  if (returnKind === "unadjusted_asset_ratio") return "perf.asset_change_tag";
  const methodClass = classifyCashflowMethod(method);
  // An explicit Modified Dietz approximation must never be labeled as an unqualified exact TWR.
  if (methodClass === "dietz_approx") return DIETZ_APPROX_LABEL_KEY;
  // Present but unsupported/inconsistent method metadata is not a qualified TWR either.
  if (methodClass === "unknown") return UNKNOWN_METHOD_LABEL_KEY;
  return "perf.return_kind_twr";
}

/** Benchmarks only overlay a qualified return in a comparable currency and market. */
function resolveBenchmarks(view: ReturnView, policy: BenchmarkPolicy): BenchmarkView {
  const eligible = policy.enabled && view.returnKind === "twr"
    && classifyCashflowMethod(view.method) !== "unknown"
    && benchmarkCurrencyAllowed(view.currency);
  if (!eligible) return NO_BENCHMARKS;
  const available = view.benchmarks.filter(item => item.points.length > 0);
  return {
    series: available,
    defaults: policy.defaults.filter(id => available.some(item => item.id === id)),
    disabled: view.disabled.filter(item => (policy.defaults as readonly string[]).includes(item.id)),
  };
}

function ReturnsChart({
  view,
  seriesLabel,
  mode,
  ariaLabel,
  benchmarks,
  disabled,
}: {
  view: ReturnView;
  seriesLabel: string;
  mode: Mode;
  ariaLabel: string;
  benchmarks: BenchmarkView;
  disabled: BenchmarkAvailability[];
}) {
  const t = useT();
  const series: ChartSeries[] = [
    { id: "main", label: seriesLabel, color: "var(--accent)", points: view.points, primary: true },
    ...benchmarks.series.map((benchmark, index) => ({
      id: benchmark.id,
      label: t(BENCHMARK_LABEL_KEYS[benchmark.id] || "perf.benchmark_unknown"),
      color: BENCHMARK_COLORS[index]!,
      points: benchmark.points,
    })),
  ];
  return (
    <div data-state={view.status} data-reason={view.unavailableReason ?? undefined}>
      <p className="card-note" style={{ marginTop: 0 }}>
        <span className="perf-kind">{t(kindLabel(view.returnKind, view.method))}</span>
        {view.currency && <span className="perf-currency"> · {view.currency}</span>}
      </p>
      <LineChart
        // A new currency/benchmark set must re-apply the default visibility instead of
        // inheriting hidden state from the previous entry.
        key={`${view.currency ?? "native"}:${benchmarks.series.map(item => item.id).join(",")}`}
        series={series}
        mode={mode}
        ariaLabel={ariaLabel}
        alignStart={view.alignedStart}
        defaultVisible={benchmarks.series.length > 0 ? benchmarks.defaults : undefined}
      />
      {disabled.length > 0 && (
        <details className="perf-benchmarks-off">
          <summary>{t("perf.benchmarks_unavailable", { count: disabled.length })}</summary>
          <div className="perf-benchmarks-off-list">
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
        </details>
      )}
    </div>
  );
}

export function ReturnsCard({ scope, platform, range, epoch }: ReturnsCardProps) {
  const t = useT();
  const { options } = useScope();
  const scopeLabel = useScopeLabel(scope);
  const [mode, setMode] = useState<Mode>("cumulative");
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const state = useApi(() => loadPerformanceReturns(scope, range, platform), [scope, platform, range, epoch]);
  const data = state.phase === "ready" ? state.data : null;
  const policy = benchmarkPolicy(scope, platform, options);

  const multi = Boolean(data && scope === "all" && data.per_currency.length > 0
    && (renderableStatus(data.status) || data.unavailable_reason === "mixed_currency"));
  const selectedEntry: CurrencyEntry | null = multi && data
    ? data.per_currency.find(entry => entry.currency === selectedCurrency)
      ?? data.per_currency.find(entry => renderableStatus(entry.status) && entry.points.length > 0)
      ?? data.per_currency[0]
      ?? null
    : null;

  let view: ReturnView | null = null;
  let benchmarks: BenchmarkView = NO_BENCHMARKS;
  let body: ReactNode;

  if (state.phase === "loading") {
    body = <Skeleton height={280} />;
  } else if (state.phase === "error") {
    body = <ErrorState onRetry={state.reload} />;
  } else {
    const returned = state.data;
    const disabled = returned.benchmark_availability.filter(item => !renderableStatus(item.status));
    if (multi && selectedEntry) {
      // Mixed-currency scope: a product currency switch, never a combined curve.
      const entry = selectedEntry;
      const switchControl = (
        <div className="perf-currency-switch">
          <div className="segmented" role="group" aria-label={t("perf.currency_switch")}>
            {returned.per_currency.map(item => (
              <button
                key={item.currency}
                type="button"
                className={`segment${item.currency === entry.currency ? " active" : ""}`}
                aria-pressed={item.currency === entry.currency}
                onClick={() => setSelectedCurrency(item.currency)}
              >
                {item.currency}
              </button>
            ))}
          </div>
        </div>
      );
      if (renderableStatus(entry.status) && entry.points.length > 0) {
        const entryView: ReturnView = {
          points: entry.points,
          benchmarks: entry.benchmarks,
          returnKind: entry.return_kind,
          method: entry,
          alignedStart: entry.aligned_start,
          currency: entry.currency,
          status: entry.status,
          unavailableReason: entry.unavailable_reason,
          asOf: entry.as_of ?? null,
          disabled,
        };
        view = entryView;
        benchmarks = resolveBenchmarks(entryView, policy);
        body = (
          <div>
            {switchControl}
            <ReturnsChart
              view={entryView}
              seriesLabel={`${scopeLabel} · ${entry.currency}`}
              mode={mode}
              ariaLabel={`${t(entry.return_kind === "unadjusted_asset_ratio"
                ? "perf.asset_change_title"
                : "perf.returns_title")} ${entry.currency}`}
              benchmarks={benchmarks}
              disabled={benchmarks.disabled}
            />
          </div>
        );
      } else {
        const stateKey = renderableStatus(entry.status) ? "no_data" : entry.status;
        body = (
          <div>
            {switchControl}
            <div data-reason={entry.unavailable_reason ?? undefined}>
              <EmptyState title={t(`state.${stateKey}`)} state={stateKey} />
            </div>
          </div>
        );
      }
    } else if (!renderableStatus(returned.status)) {
      body = (
        <div data-reason={returned.unavailable_reason ?? undefined}>
          <EmptyState title={t(`state.${returned.status}`)} state={returned.status} />
        </div>
      );
    } else if (returned.points.length === 0) {
      body = <div data-reason={returned.unavailable_reason ?? undefined}><EmptyState title={t("state.no_data")} state="no_data" /></div>;
    } else {
      const singleView: ReturnView = {
        points: returned.points,
        benchmarks: returned.no_common_date ? [] : returned.benchmarks,
        returnKind: returned.return_kind,
        method: returned,
        alignedStart: returned.aligned_start,
        currency: returned.currency ?? null,
        status: returned.status,
        unavailableReason: returned.unavailable_reason,
        asOf: returned.as_of ?? null,
        disabled,
      };
      view = singleView;
      benchmarks = returned.no_common_date ? NO_BENCHMARKS : resolveBenchmarks(singleView, policy);
      body = (
        <ReturnsChart
          view={singleView}
          seriesLabel={scopeLabel}
          mode={mode}
          ariaLabel={t(returned.return_kind === "unadjusted_asset_ratio"
            ? "perf.asset_change_title"
            : "perf.returns_title")}
          benchmarks={benchmarks}
          disabled={benchmarks.disabled}
        />
      );
    }
  }

  const assetChange = view?.returnKind === "unadjusted_asset_ratio";
  const hasBenchmarks = benchmarks.series.length > 0;
  const title = !view ? t("perf.returns_title")
    : assetChange ? t("perf.asset_change_title")
      : hasBenchmarks ? t("perf.returns_title")
        : t("perf.returns_title_plain");
  const canToggleMode = Boolean(view && !assetChange && renderableStatus(view.status) && view.points.length > 0);
  const methodBodyKey = view && assetChange ? "perf.method_body_asset_change"
    : data && [data, ...data.per_currency].some(item => classifyCashflowMethod(item) === "unknown") ? "perf.method_body_unknown"
      : data && (isApproximateDietz(data) || data.per_currency.some(isApproximateDietz)) ? "perf.method_body_dietz"
        : "perf.method_body";

  return (
    <div className="card">
      <div className="perf-card-head">
        <h2 className="card-title">{title}</h2>
        {canToggleMode && (
          <div className="perf-mode-toggle">
            <div className="segmented" role="group" aria-label={title}>
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
        )}
        <span className="perf-head-meta">
          {view && view.status !== "ok" && renderableStatus(view.status) && (
            <StatusBadge status={view.status} reason={view.unavailableReason} />
          )}
          {view && renderableStatus(view.status) && <AsOfStamp value={view.asOf} />}
        </span>
      </div>
      {body}
      <MethodNote titleKey="perf.how_calculated" bodyKey={methodBodyKey} />
    </div>
  );
}
