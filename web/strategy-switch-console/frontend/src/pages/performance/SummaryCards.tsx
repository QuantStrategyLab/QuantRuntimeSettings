import type { ReactNode } from "react";
import { useLanguage, useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { formatDate, formatPercentagePoints } from "../../lib/format";
import { loadPerformanceSummary } from "../../api/endpoints";
import type { Range, SummaryResponse } from "../../api/contracts";
import { AsOfStamp, Money, Percent, Skeleton, StatusBadge } from "../../components/primitives";
import { KpiCard } from "../../components/KpiCard";
import { renderableStatus } from "./shared";

export interface SummaryCardsProps {
  scope: string;
  platform: string | undefined;
  range: Range;
  epoch: number;
}

/** Status text replaces the main value when the block cannot support a number. */
function KpiState({ status, reason }: { status: string; reason?: string | null }) {
  const t = useT();
  const statusText = t(`state.${status}`);
  const reasonText = reason ? t(`reason.${reason}`) : null;
  return <span className="flat">{reasonText ? `${statusText} · ${reasonText}` : statusText}</span>;
}

function cardFooter(data: SummaryResponse) {
  return (
    <>
      <StatusBadge status={data.status} reason={data.unavailable_reason} />
      <AsOfStamp value={data.as_of} />
    </>
  );
}

function TwrCard({ data }: { data: SummaryResponse }) {
  const t = useT();
  const title = t("perf.card.twr");
  const footer = cardFooter(data);
  if (!renderableStatus(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} reason={data.unavailable_reason} />} footer={footer} />;
  }
  // asset_change scopes have no qualified TWR; the reason line explains the blank instead of a fake 0.
  if (data.twr_return_percent === null) {
    const sub = data.unavailable_reason ? t(`reason.${data.unavailable_reason}`) : undefined;
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={sub} footer={footer} />;
  }
  return <KpiCard title={title} value={<Percent value={data.twr_return_percent} />} footer={footer} />;
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
    const sub = data.unavailable_reason ? t(`reason.${data.unavailable_reason}`) : undefined;
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={sub} footer={footer} />;
  }
  return <KpiCard title={title} value={<Money value={data.amount} currency={data.currency} signed />} footer={footer} />;
}

function DrawdownCard({ data }: { data: SummaryResponse }) {
  const t = useT();
  const language = useLanguage();
  const title = t("perf.card.max_drawdown");
  const footer = cardFooter(data);
  if (!renderableStatus(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} reason={data.unavailable_reason} />} footer={footer} />;
  }
  const dd = data.max_drawdown;
  if (dd.percent === null) {
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={dd.unavailable_reason ? t(`reason.${dd.unavailable_reason}`) : undefined} footer={footer} />;
  }
  const sub =
    dd.peak_date && dd.trough_date
      ? t("perf.card.max_drawdown_dates", { peak: formatDate(dd.peak_date, language), trough: formatDate(dd.trough_date, language) })
      : undefined;
  return <KpiCard title={title} value={<Percent value={dd.percent} />} sub={sub} footer={footer} />;
}

function ExcessCard({ data }: { data: SummaryResponse }) {
  const t = useT();
  const language = useLanguage();
  const title = t("perf.card.excess");
  const footer = cardFooter(data);
  if (!renderableStatus(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} reason={data.unavailable_reason} />} footer={footer} />;
  }
  const primary = data.excess_returns.find(item => item.percentage_points !== null);
  if (!primary || primary.percentage_points === null) {
    const reason = data.excess_returns.find(item => item.unavailable_reason)?.unavailable_reason;
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={reason ? t(`reason.${reason}`) : undefined} footer={footer} />;
  }
  const pp = primary.percentage_points;
  const rest = data.excess_returns.filter(item => item !== primary);
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
    return <KpiCard title={title} value={<KpiState status={data.status} reason={data.unavailable_reason} />} footer={footer} />;
  }
  const day = data[field];
  if (!day || !renderableStatus(day.status)) {
    const reason = day?.unavailable_reason;
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={reason ? t(`reason.${reason}`) : undefined} footer={footer} />;
  }
  const value: ReactNode =
    day.amount !== null ? <Money value={day.amount} currency={data.currency} signed /> : <Percent value={day.return_percent} />;
  const kind = day.value_kind === "asset_change" ? ` · ${t("perf.value_kind_asset_change")}` : "";
  return <KpiCard title={title} value={value} sub={`${day.date}${kind}`} footer={footer} />;
}

export function SummaryCards({ scope, platform, range, epoch }: SummaryCardsProps) {
  const t = useT();
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
    <div className="perf-kpi-grid">
      <TwrCard data={data} />
      <AmountCard data={data} />
      <DrawdownCard data={data} />
      <ExcessCard data={data} />
      <DayCard data={data} field="best_day" titleKey="perf.card.best_day" />
      <DayCard data={data} field="worst_day" titleKey="perf.card.worst_day" />
    </div>
  );
}
