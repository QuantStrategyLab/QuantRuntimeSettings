import { useState } from "react";
import type { ReactNode } from "react";
import { useScope } from "../../app/context";
import { useT } from "../../i18n";
import type { AsyncState } from "../../lib/hooks";
import { useDisplayNames } from "../../lib/useDisplayNames";
import { useScopeLabel } from "../../lib/useScopeLabel";
import type { CashflowMethodMeta, PerformanceCoverage, Point, ReturnsResponse } from "../../api/contracts";
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
  state: AsyncState<ReturnsResponse> & { reload: () => void };
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

interface AccountDailySeries {
  key: string;
  platform: string;
  accountAlias: string;
  currency: string | null;
  points: Point[];
}

const NO_BENCHMARKS: BenchmarkView = { series: [], defaults: [], disabled: [] };

/**
 * Single-account native returns arrive as real per-day percentages with `breakBefore` gaps.
 * Only an explicit coverage flag pins the chart to daily mode; a plain `partial` status must not.
 */
function isNativeDailyOnly(response: ReturnsResponse | null): boolean {
  if (!response) return false;
  const coverage = response.coverage;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return false;
  return (coverage as PerformanceCoverage).native_daily_only === true;
}

function dayTime(date: string): number | null {
  if (typeof date !== "string" || date === "") return null;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
}

/**
 * Broker daily returns are already real percentages, so 0 and negative days are kept as-is.
 * A missing or unusable day is dropped and the line breaks; the cumulative value is never
 * compounded to fill it, and duplicate dates are left out rather than merged.
 */
export function accountDailyPoints(points: Point[]): Point[] {
  const kept: Point[] = [];
  const counts = new Map<string, number>();
  for (const point of points) counts.set(point.date, (counts.get(point.date) ?? 0) + 1);
  let interrupted = false;
  for (const point of points) {
    const native = point.daily_return_percent;
    if (dayTime(point.date) === null || counts.get(point.date) !== 1 || typeof native !== "number" || !Number.isFinite(native) || native < -100) {
      // Dropping a day must not bridge it: the next kept point starts a new segment.
      interrupted = true;
      continue;
    }
    kept.push({
      date: point.date,
      value: point.value,
      daily_return_percent: native,
      breakBefore: point.breakBefore === true || interrupted,
    });
    interrupted = false;
  }
  return kept;
}

function chartLabelKey(view: ReturnView, nativeDailyOnly: boolean): string {
  if (nativeDailyOnly) return "perf.native_daily_title";
  return view.returnKind === "unadjusted_asset_ratio" ? "perf.asset_change_title" : "perf.returns_title";
}

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
  nativeDailyOnly,
}: {
  view: ReturnView;
  seriesLabel: string;
  mode: Mode;
  ariaLabel: string;
  benchmarks: BenchmarkView;
  disabled: BenchmarkAvailability[];
  nativeDailyOnly: boolean;
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
        {nativeDailyOnly && <span className="perf-kind" data-native-daily-tag="true"> · {t("perf.native_daily_tag")}</span>}
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
      {nativeDailyOnly && (
        <p className="card-note" data-native-daily-only="true">{t("perf.native_daily_note")}</p>
      )}
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

export function ReturnsCard({ scope, platform, state }: ReturnsCardProps) {
  const t = useT();
  const { options } = useScope();
  const scopeLabel = useScopeLabel(scope);
  const names = useDisplayNames();
  const [mode, setMode] = useState<Mode>("cumulative");
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const data = state.phase === "ready" ? state.data : null;
  // Only an explicit coverage flag pins the chart to daily mode; `partial` alone must not.
  const nativeDailyOnly = isNativeDailyOnly(data);
  const effectiveMode: Mode = nativeDailyOnly ? "daily" : mode;
  const policy = benchmarkPolicy(scope, platform, options);
  const nativeAccounts = data?.per_account?.filter(account => renderableStatus(account.status) && account.return_kind === "twr" && account.points.length > 0) ?? [];

  // All scope: every verified account keeps its own independent daily series. Nothing is
  // merged across accounts or currencies, and no account is restated as a portfolio value.
  const accountSeries: AccountDailySeries[] = [];
  if (scope === "all" && data?.per_account) {
    for (const account of data.per_account) {
      if (!renderableStatus(account.status) || account.return_kind !== "twr") continue;
      const points = accountDailyPoints(account.points);
      if (points.length === 0) continue;
      accountSeries.push({
        key: `${account.platform}:${account.account_alias}`,
        platform: account.platform,
        accountAlias: account.account_alias,
        currency: account.currency ?? null,
        points,
      });
    }
  }
  const chartedAccounts = new Set(accountSeries.map(item => item.key));
  const unchartedNativeAccounts = nativeAccounts.filter(account => !chartedAccounts.has(`${account.platform}:${account.account_alias}`));

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
        benchmarks = nativeDailyOnly ? NO_BENCHMARKS : resolveBenchmarks(entryView, policy);
        body = (
          <div>
            {switchControl}
            <ReturnsChart
              view={entryView}
              seriesLabel={`${scopeLabel} · ${entry.currency}`}
              mode={effectiveMode}
              ariaLabel={`${t(chartLabelKey(entryView, nativeDailyOnly))} ${entry.currency}`}
              benchmarks={benchmarks}
              disabled={benchmarks.disabled}
              nativeDailyOnly={nativeDailyOnly}
            />
          </div>
        );
      } else {
        const stateKey = renderableStatus(entry.status) ? "no_data" : entry.status;
        body = (
          <div>
            {switchControl}
            <div data-reason={entry.unavailable_reason ?? undefined}>
              <EmptyState title={t(stateKey === "no_data" && entry.unavailable_reason === "external_cashflow_required"
                ? "perf.missing_cashflow_records" : `state.${stateKey}`)} state={stateKey} body={entry.unavailable_reason ? t(`reason.${entry.unavailable_reason}`) : undefined} />
            </div>
          </div>
        );
      }
    } else if (!renderableStatus(returned.status)) {
      body = (
        <div data-reason={returned.unavailable_reason ?? undefined}>
          <EmptyState title={t(`state.${returned.status}`)} state={returned.status} body={returned.unavailable_reason ? t(`reason.${returned.unavailable_reason}`) : undefined} />
        </div>
      );
    } else if (returned.points.length === 0) {
      body = (
        <div data-reason={returned.unavailable_reason ?? undefined}>
          <EmptyState title={t(returned.unavailable_reason === "external_cashflow_required"
            ? "perf.missing_cashflow_records" : "state.no_data")} state="no_data" body={returned.unavailable_reason ? t(`reason.${returned.unavailable_reason}`) : undefined} />
        </div>
      );
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
      benchmarks = nativeDailyOnly || returned.no_common_date ? NO_BENCHMARKS : resolveBenchmarks(singleView, policy);
      body = (
        <ReturnsChart
          view={singleView}
          seriesLabel={scopeLabel}
          mode={effectiveMode}
          ariaLabel={t(chartLabelKey(singleView, nativeDailyOnly))}
          benchmarks={benchmarks}
          disabled={benchmarks.disabled}
          nativeDailyOnly={nativeDailyOnly}
        />
      );
    }
  }

  const assetChange = view?.returnKind === "unadjusted_asset_ratio";
  const hasBenchmarks = benchmarks.series.length > 0;
  const title = !view ? t("perf.returns_title")
    : nativeDailyOnly ? t("perf.native_daily_title")
      : assetChange ? t("perf.asset_change_title")
        : hasBenchmarks ? t("perf.returns_title")
          : t("perf.returns_title_plain");
  const canToggleMode = Boolean(view && !nativeDailyOnly && !assetChange && renderableStatus(view.status) && view.points.length > 0);
  const methodBodyKey = nativeDailyOnly ? "perf.method_body_native_daily"
    : view && assetChange ? "perf.method_body_asset_change"
    : data && [data, ...data.per_currency].some(item => classifyCashflowMethod(item) === "unknown") ? "perf.method_body_unknown"
      : data && (isApproximateDietz(data) || data.per_currency.some(isApproximateDietz)) ? "perf.method_body_dietz"
        : "perf.method_body";

  // When the combined series cannot be drawn, the per-account native returns
  // move above the combined empty state instead of sitting below a large blank.
  const combinedDrawn = Boolean(view && renderableStatus(view.status) && view.points.length > 0);
  const accountDaily = accountSeries.length > 0 ? (
    <section className="perf-account-daily" data-account-daily-count={accountSeries.length}>
      <div className="perf-card-head">
        <h3 className="card-title">{t("perf.per_account_daily_title")}</h3>
      </div>
      <p className="card-note">{t("perf.per_account_daily_note")}</p>
      {accountSeries.map(account => {
        const label = `${names.platform(account.platform)} · ${names.account(account.accountAlias, account.platform)}`;
        return (
          <div key={account.key} className="perf-account-daily-item" data-account={account.accountAlias}>
            <p className="card-note">
              <span className="perf-kind">{label}</span>
              {account.currency && <span className="perf-currency"> · {account.currency}</span>}
            </p>
            <LineChart
              series={[{ id: "main", label, color: "var(--accent)", points: account.points, primary: true }]}
              mode="daily"
              ariaLabel={`${t("perf.per_account_daily_title")} · ${label}`}
            />
          </div>
        );
      })}
    </section>
  ) : null;

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
      {!combinedDrawn && accountDaily}
      {body}
      {combinedDrawn && accountDaily}
      {unchartedNativeAccounts.length > 0 ? <p className="card-note" data-native-return-accounts={unchartedNativeAccounts.length}>{t("perf.native_return_accounts", { accounts: unchartedNativeAccounts.map(account => `${names.platform(account.platform)} · ${names.account(account.account_alias, account.platform)}`).join("、") })}</p> : null}
      <MethodNote titleKey="perf.how_calculated" bodyKey={methodBodyKey} />
    </div>
  );
}
