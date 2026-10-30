import type { ReactNode } from "react";
import { useScope } from "../../app/context";
import { useLanguage, useT, type MessageKey } from "../../i18n";
import type { AsyncState } from "../../lib/hooks";
import { formatDate, formatPercentagePoints } from "../../lib/format";
import type { SummaryResponse } from "../../api/contracts";
import { AsOfStamp, ErrorState, Money, Percent, Skeleton, StatusBadge } from "../../components/primitives";
import { KpiCard } from "../../components/KpiCard";
import { renderableStatus } from "./shared";
import { DIETZ_APPROX_LABEL_KEY, UNKNOWN_METHOD_LABEL_KEY, classifyCashflowMethod } from "./cashflowMethod";
import { benchmarkPolicy, type BenchmarkPolicy } from "./benchmarkPolicy";

export type SummaryState = AsyncState<SummaryResponse> & { reload: () => void };

export interface SummaryCardsProps {
  scope: string;
  platform: string | undefined;
  /** The page owns the single summary read; cards never fetch their own copy. */
  state: SummaryState;
  chartAvailable: boolean;
}

function summaryIsBlank(data: SummaryResponse): boolean {
  return data.twr_return_percent === null && data.amount === null && data.max_drawdown.percent === null
    && (data.per_currency ?? []).every(currency => currency.max_drawdown.percent === null)
    && data.excess_returns.every(item => item.percentage_points === null)
    && data.best_day === null && data.worst_day === null;
}

/** The shared summary carries the state once; unavailable values themselves stay compact. */
function KpiState({ status }: { status: string }) {
  const t = useT();
  return <span className="flat kpi-empty-value" data-state={status}>—<span className="sr-only">{t(`state.${status}`)}</span></span>;
}

function TwrCard({ data }: { data: SummaryResponse }) {
  const t = useT();
  const methodClass = classifyCashflowMethod(data);
  // An unrecognized method must not keep an unqualified TWR title.
  const title = t(methodClass === "unknown" ? "perf.card.return_value" : "perf.card.twr");
  if (!renderableStatus(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} />} />;
  }
  // asset_change scopes have no qualified TWR; one short reason explains the
  // blank instead of a fake 0, without an expandable audit block.
  if (data.twr_return_percent === null) {
    // The specific metric reason stays available to assistive checks but never
    // turns an uncomputable TWR into a longer, qualified-looking card.
    const metricReason = data.metric_reasons?.twr ?? data.unavailable_reason;
    return <KpiCard title={title}
      value={<span className="flat" data-state="unavailable" data-reason={metricReason ?? undefined}>—</span>}
      sub={t("state.unavailable")} />;
  }
  const sub = methodClass === "dietz_approx" ? t(DIETZ_APPROX_LABEL_KEY)
    : methodClass === "unknown" ? t(UNKNOWN_METHOD_LABEL_KEY) : undefined;
  return <KpiCard title={title} value={<Percent value={data.twr_return_percent} />} sub={sub} />;
}

function AmountCard({ data }: { data: SummaryResponse }) {
  const t = useT();
  const title = data.value_kind === "pnl" ? t("perf.card.amount") : t("perf.card.amount_asset_change");
  if (!renderableStatus(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} />} />;
  }
  // Mixed native currencies are never summed; the reason replaces the amount.
  if (data.unavailable_reason === "mixed_currency" || data.amount === null) {
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={t("state.unavailable")} />;
  }
  return <KpiCard title={title} value={<Money value={data.amount} currency={data.currency} signed />} />;
}

/** Method tag for return-derived figures; null when the figure is a qualified exact TWR or a legacy response. */
function methodTag(data: Parameters<typeof classifyCashflowMethod>[0], t: ReturnType<typeof useT>): string | null {
  const cls = classifyCashflowMethod(data);
  if (cls === "dietz_approx") return t(DIETZ_APPROX_LABEL_KEY);
  if (cls === "unknown") return t(UNKNOWN_METHOD_LABEL_KEY);
  return null;
}

function DrawdownCard({ data }: { data: SummaryResponse }) {
  const t = useT();
  const language = useLanguage();
  // Drawdown derives from the same return series; an unrecognized method must not keep a TWR title.
  const title = t(classifyCashflowMethod(data) === "unknown" ? "perf.drawdown_plain_title" : "perf.drawdown_twr_title");
  if (data.per_currency?.length && data.unavailable_reason !== "stored_records_unreadable") {
    // Each currency keeps its own label, method, value, dates and safe state.
    return <KpiCard title={title} value={<span className="currency-totals">
      {data.per_currency.map(item => {
        const dd = item.max_drawdown;
        const percent = dd.percent;
        // A method label explains how a figure was derived, so it only belongs
        // next to a figure. A missing drawdown shows the dash plus its own
        // localized reason instead; the code itself stays diagnostic in
        // data-reason and never becomes user-facing text.
        const hasValue = percent !== null;
        const tag = hasValue ? methodTag(item, t) : null;
        const reason = hasValue ? null
          : dd.unavailable_reason ? t(`reason.${dd.unavailable_reason}` as MessageKey) : t("state.unavailable");
        // No dates are invented: a missing figure carries no peak/trough pair.
        const dates = hasValue && dd.peak_date && dd.trough_date
          ? t("perf.card.max_drawdown_dates", { peak: formatDate(dd.peak_date, language), trough: formatDate(dd.trough_date, language) })
          : null;
        return <span className="currency-total" key={item.currency} data-state={dd.unavailable_reason || undefined}>
          <span className="kpi-sub">{item.currency}</span>
          {tag && <span className="kpi-sub">{tag}</span>}
          {percent === null
            ? <span className="flat" data-reason={dd.unavailable_reason ?? undefined}>—</span>
            : <Percent value={-percent || 0} />}
          {reason && <span className="kpi-sub">{reason}</span>}
          {dates && <span className="kpi-sub">{dates}</span>}
        </span>;
      })}
    </span>} />;
  }
  if (!renderableStatus(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} />} />;
  }
  const dd = data.max_drawdown;
  if (dd.percent === null) {
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={t("state.unavailable")} />;
  }
  const sub =
    dd.peak_date && dd.trough_date
      ? t("perf.card.max_drawdown_dates", { peak: formatDate(dd.peak_date, language), trough: formatDate(dd.trough_date, language) })
      : undefined;
  const methodLabel = methodTag(data, t);
  const combinedSub = [methodLabel, sub].filter(Boolean).join(" · ") || undefined;
  return <KpiCard title={title} value={<Percent value={-dd.percent || 0} />} sub={combinedSub} />;
}

function ExcessCard({ data, policy }: { data: SummaryResponse; policy: BenchmarkPolicy }) {
  const t = useT();
  const language = useLanguage();
  const title = t("perf.card.excess");
  if (!renderableStatus(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} />} />;
  }
  // Crypto and mixed scopes have no single relevant market index; never fall back to an unrelated one.
  if (!policy.enabled) {
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={t("perf.benchmark_not_applicable")} />;
  }
  const eligible = policy.defaults.flatMap(id => data.excess_returns.filter(item => item.benchmark === id));
  const primary = eligible.find(item => item.percentage_points !== null);
  if (!primary || primary.percentage_points === null) {
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={t("state.unavailable")} />;
  }
  const pp = primary.percentage_points;
  const rest = eligible.filter(item => item !== primary && item.percentage_points !== null);
  const sub = rest.length ? (
    <span className="perf-excess-list">
      {rest.map(item => (
        <span key={item.benchmark}>
          {item.benchmark} {formatPercentagePoints(item.percentage_points, language)}
        </span>
      ))}
    </span>
  ) : (
    primary.benchmark
  );
  return (
    <KpiCard
      title={title}
      value={<span className={pp > 0 ? "up" : pp < 0 ? "down" : "flat"}>{formatPercentagePoints(pp, language)}</span>}
      sub={sub}
    />
  );
}

function DayCard({ data, field, titleKey }: { data: SummaryResponse; field: "best_day" | "worst_day"; titleKey: string }) {
  const t = useT();
  const title = t(titleKey);
  if (!renderableStatus(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} />} />;
  }
  const day = data[field];
  if (!day || !renderableStatus(day.status)) {
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={t("state.no_data")} />;
  }
  const value: ReactNode =
    day.amount !== null ? <Money value={day.amount} currency={data.currency} signed /> : <Percent value={day.return_percent} />;
  const kind = day.value_kind === "asset_change" ? ` · ${t("perf.value_kind_asset_change")}` : "";
  return <KpiCard title={title} value={value} sub={`${day.date}${kind}`} />;
}

export function SummaryCards({ scope, platform, state, chartAvailable }: SummaryCardsProps) {
  const t = useT();
  const { options } = useScope();
  const policy = benchmarkPolicy(scope, platform, options);

  if (state.phase === "loading") {
    const titles = ["perf.card.twr", "perf.card.amount", "perf.card.max_drawdown", "perf.card.excess", "perf.card.best_day", "perf.card.worst_day"];
    return (
      <div className="perf-kpi-grid">
        {titles.map(key => (
          <KpiCard key={key} title={t(key)} value={<Skeleton height={28} width="70%" />} />
        ))}
      </div>
    );
  }
  if (state.phase === "error") {
    // One honest failure state; never six cards pretending each metric returned nothing.
    return <ErrorState onRetry={state.reload} />;
  }
  const data = state.data;
  const blank = summaryIsBlank(data);
  // Only a mixed-currency scope gets an explained sentence, and only that scope.
  // Other reasons stay diagnostic (data-reason) so the short state is not
  // repeated as body copy; no FX rate is ever inferred here.
  const coverage = data.coverage;
  const fxNotApplied = !!coverage && !Array.isArray(coverage) && coverage !== "fills_not_connected"
    && coverage.fx === "not_applied";
  const inPlaceReason = data.unavailable_reason === "mixed_currency"
    ? t(fxNotApplied ? "perf.mixed_currency_unavailable" : "perf.mixed_currency_native")
    : blank && chartAvailable ? t("perf.combined_metrics_unavailable") : null;
  return (
    <div className="section-stack">
      {(data.status !== "ok" || data.unavailable_reason || data.as_of || inPlaceReason) && (
        <div className="metric-note perf-summary-note" data-state={data.status}
          data-reason={data.unavailable_reason ?? undefined}>
          {data.status !== "ok" && <StatusBadge status={data.status} />}
          {inPlaceReason && <span className="state-short">{inPlaceReason}</span>}
          {data.as_of && <AsOfStamp value={data.as_of} />}
        </div>
      )}
      <div className="perf-kpi-grid">
        <TwrCard data={data} />
        <AmountCard data={data} />
        <DrawdownCard data={data} />
        <ExcessCard data={data} policy={policy} />
        <DayCard data={data} field="best_day" titleKey="perf.card.best_day" />
        <DayCard data={data} field="worst_day" titleKey="perf.card.worst_day" />
      </div>
    </div>
  );
}
