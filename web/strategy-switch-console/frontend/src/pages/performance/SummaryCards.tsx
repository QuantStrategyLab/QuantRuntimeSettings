import type { ReactNode } from "react";
import { useScope } from "../../app/context";
import { useLanguage, useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { formatDate, formatPercentagePoints } from "../../lib/format";
import { loadPerformanceSummary } from "../../api/endpoints";
import type { Range, SummaryResponse } from "../../api/contracts";
import { AsOfStamp, Money, Percent, Skeleton, StatusBadge } from "../../components/primitives";
import { KpiCard } from "../../components/KpiCard";
import { renderableStatus } from "./shared";
import { DIETZ_APPROX_LABEL_KEY, UNKNOWN_METHOD_LABEL_KEY, classifyCashflowMethod } from "./cashflowMethod";
import { benchmarkPolicy, type BenchmarkPolicy } from "./benchmarkPolicy";

export interface SummaryCardsProps {
  scope: string;
  platform: string | undefined;
  range: Range;
  epoch: number;
}

/** Status text replaces the main value when the block cannot support a number. */
function KpiState({ status, reason }: { status: string; reason?: string | null }) {
  const t = useT();
  return <span className="kpi-state" title={reason ? t(`reason.${reason}`) : undefined}>{t(`state.${status}`)}</span>;
}

/** Inline per-metric reason; skipped when the shared note above the grid already carries the same reason. */
function MetricReason({ reason, shared }: { reason?: string | null; shared?: string | null }) {
  const t = useT();
  if (!reason || reason === shared) return null;
  return <span className="kpi-reason">{t(`reason.${reason}`)}</span>;
}

function cardFooter(data: SummaryResponse, metricReason?: string | null) {
  return (
    <>
      <StatusBadge status={data.status} reason={data.unavailable_reason} />
      <AsOfStamp value={data.as_of} />
      <MetricReason reason={metricReason} shared={data.unavailable_reason} />
    </>
  );
}

function TwrCard({ data }: { data: SummaryResponse }) {
  const t = useT();
  const methodClass = classifyCashflowMethod(data);
  // An unrecognized method must not keep an unqualified TWR title.
  const title = t(methodClass === "unknown" ? "perf.card.return_value" : "perf.card.twr");
  if (!renderableStatus(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} reason={data.unavailable_reason} />} footer={cardFooter(data, data.metric_reasons?.twr)} />;
  }
  // asset_change scopes have no qualified TWR; a stated reason explains the blank instead of a fake 0.
  if (data.twr_return_percent === null) {
    const reason = data.metric_reasons?.twr || data.unavailable_reason;
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={t(`reason.${reason || "unknown"}`)} footer={cardFooter(data)} />;
  }
  const sub = methodClass === "dietz_approx" ? t(DIETZ_APPROX_LABEL_KEY)
    : methodClass === "unknown" ? t(UNKNOWN_METHOD_LABEL_KEY) : undefined;
  return <KpiCard title={title} value={<Percent value={data.twr_return_percent} />} sub={sub} footer={cardFooter(data)} />;
}

function AmountCard({ data }: { data: SummaryResponse }) {
  const t = useT();
  const title = data.value_kind === "pnl" ? t("perf.card.amount") : t("perf.card.amount_asset_change");
  const footer = cardFooter(data);
  if (!renderableStatus(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} reason={data.unavailable_reason} />} footer={footer} />;
  }
  // Mixed native currencies are never summed; the reason replaces the amount.
  if (data.unavailable_reason === "mixed_currency" || data.amount === null) {
    return <KpiCard title={title} value={<span className="flat">—</span>} footer={footer} />;
  }
  return <KpiCard title={title} value={<Money value={data.amount} currency={data.currency} signed />} footer={footer} />;
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
  const footer = cardFooter(data);
  if (data.per_currency?.length && data.unavailable_reason !== "stored_records_unreadable") {
    // One shared status line keeps every KPI card the same height; per-currency detail stays in a tooltip.
    const reasons = [...new Set(data.per_currency.map(item => item.max_drawdown.unavailable_reason))]
      .filter((value): value is NonNullable<typeof value> => value != null);
    return <KpiCard title={title} value={<span className="currency-totals">
      {data.per_currency.map(item => {
        const dd = item.max_drawdown;
        const tag = methodTag(item, t);
        return <span className="currency-total" key={item.currency}>
          <span className="kpi-sub">{item.currency}</span>
          {tag && <span className="kpi-sub">{tag}</span>}
          {dd.percent === null ? <span className="flat">—</span> : <Percent value={-dd.percent || 0} />}
          <span className="kpi-sub">{dd.peak_date && dd.trough_date
            ? t("perf.card.max_drawdown_dates", { peak: formatDate(dd.peak_date, language), trough: formatDate(dd.trough_date, language) })
            : null}</span>
        </span>;
      })}
      {reasons.length > 0 && <span className="kpi-sub" title={reasons.map(reason => t(`reason.${reason}`)).join(" · ")}>
        {t(`reason.${reasons[0]}`)}
      </span>}
    </span>} />;
  }
  if (!renderableStatus(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} reason={data.unavailable_reason} />} footer={cardFooter(data, data.max_drawdown?.unavailable_reason)} />;
  }
  const dd = data.max_drawdown;
  if (dd.percent === null) {
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={dd.unavailable_reason ? t(`reason.${dd.unavailable_reason}`) : undefined} footer={footer} />;
  }
  const sub =
    dd.peak_date && dd.trough_date
      ? t("perf.card.max_drawdown_dates", { peak: formatDate(dd.peak_date, language), trough: formatDate(dd.trough_date, language) })
      : undefined;
  const methodLabel = methodTag(data, t);
  const combinedSub = [methodLabel, sub].filter(Boolean).join(" · ") || undefined;
  return <KpiCard title={title} value={<Percent value={-dd.percent || 0} />} sub={combinedSub} footer={footer} />;
}

function ExcessCard({ data, policy }: { data: SummaryResponse; policy: BenchmarkPolicy }) {
  const t = useT();
  const language = useLanguage();
  const title = t("perf.card.excess");
  const footer = cardFooter(data);
  if (!renderableStatus(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} reason={data.unavailable_reason} />}
      footer={cardFooter(data, data.excess_returns?.find(item => item.unavailable_reason)?.unavailable_reason)} />;
  }
  // Crypto and mixed scopes have no single relevant market index; never fall back to an unrelated one.
  if (!policy.enabled) {
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={t("perf.benchmark_not_applicable")} footer={footer} />;
  }
  const eligible = policy.defaults.flatMap(id => data.excess_returns.filter(item => item.benchmark === id));
  const primary = eligible.find(item => item.percentage_points !== null);
  if (!primary || primary.percentage_points === null) {
    const reason = eligible.find(item => item.unavailable_reason)?.unavailable_reason;
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={reason && reason !== data.unavailable_reason ? t(`reason.${reason}`) : undefined} footer={footer} />;
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
      footer={footer}
    />
  );
}

function DayCard({ data, field, titleKey }: { data: SummaryResponse; field: "best_day" | "worst_day"; titleKey: string }) {
  const t = useT();
  const title = t(titleKey);
  const footer = cardFooter(data);
  if (!renderableStatus(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} reason={data.unavailable_reason} />}
      footer={cardFooter(data, data[field]?.unavailable_reason)} />;
  }
  const day = data[field];
  if (!day || !renderableStatus(day.status)) {
    const reason = day?.unavailable_reason;
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={reason && reason !== data.unavailable_reason ? t(`reason.${reason}`) : undefined} footer={footer} />;
  }
  const value: ReactNode =
    day.amount !== null ? <Money value={day.amount} currency={data.currency} signed /> : <Percent value={day.return_percent} />;
  const kind = day.value_kind === "asset_change" ? ` · ${t("perf.value_kind_asset_change")}` : "";
  return <KpiCard title={title} value={value} sub={`${day.date}${kind}`} footer={footer} />;
}

export function SummaryCards({ scope, platform, range, epoch }: SummaryCardsProps) {
  const t = useT();
  const { options } = useScope();
  const policy = benchmarkPolicy(scope, platform, options);
  const state = useApi(() => loadPerformanceSummary(scope, range, platform), [scope, platform, range, epoch]);

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
    const titles = ["perf.card.twr", "perf.card.amount", "perf.card.max_drawdown", "perf.card.excess", "perf.card.best_day", "perf.card.worst_day"];
    return (
      <div className="perf-kpi-grid">
        {titles.map((key, index) => (
          <KpiCard
            key={key}
            title={t(key)}
            value={<KpiState status="read_failed" />}
            footer={
              index === 0 ? (
                <button type="button" className="button button-secondary button-sm" onClick={state.reload}>
                  {t("common.retry")}
                </button>
              ) : undefined
            }
          />
        ))}
      </div>
    );
  }
  const data = state.data;
  return (
    <div className="section-stack">
      {data.unavailable_reason && <p className="metric-note">{t(`reason.${data.unavailable_reason}`)}</p>}
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
