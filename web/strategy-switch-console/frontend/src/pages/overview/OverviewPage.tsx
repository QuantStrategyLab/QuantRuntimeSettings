import { inboxFailureState } from "../../lib/inboxFailure";
import { CurrencyTotals } from "../../components/CurrencyTotals";
import { useState } from "react";
import type { ReactNode } from "react";
import type {
  AssetsResponse,
  CalendarCell,
  CalendarResponse,
  HistoryCoverage,
  InboxItem,
  InboxResponse,
  Point,
  Reason,
  ReturnsResponse,
  Status,
  SummaryResponse,
  TodayRunSummary,
} from "../../api/contracts";
import {
  loadInbox,
  loadPerformanceAssets,
  loadPerformanceCalendar,
  loadPerformanceReturns,
  loadPerformanceSummary,
  loadTodayRuns,
} from "../../api/endpoints";
import { useApi } from "../../lib/hooks";
import type { AsyncState } from "../../lib/hooks";
import { latestAssetBalance } from "../../lib/performance";
import { renderableStatus } from "../../lib/status";
import { formatDateTime } from "../../lib/format";
import { loadAuditEvents } from "../../api/cockpit";
import { AuditTimeline, FreshnessBadge } from "../../components/cockpit";
import { useNavigate, useScope } from "../../app/context";
import { useLanguage, useT } from "../../i18n";
import { useScopeLabel } from "../../lib/useScopeLabel";
import {
  AsOfStamp,
  Badge,
  EmptyState,
  ErrorState,
  Money,
  Percent,
  Skeleton,
  StatusBadge,
} from "../../components/primitives";
import { KpiCard } from "../../components/KpiCard";
import { AreaChart } from "../../charts/AreaChart";
import { LineChart, type ChartSeries } from "../../charts/LineChart";
import { DIETZ_APPROX_LABEL_KEY, UNKNOWN_METHOD_LABEL_KEY, classifyCashflowMethod } from "../performance/cashflowMethod";
import { weekendWithoutScheduledRuns } from "../health/status";
import "./overview.css";

type Api<T> = AsyncState<T> & { reload: () => void };

const RANGE = "YTD" as const;

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Cells the API actually observed on a dated day that is not ahead of this clock. */
function datedValueCells(cells: CalendarCell[]): (CalendarCell & { date: string })[] {
  const today = localToday();
  return cells
    .filter((cell): cell is CalendarCell & { date: string } =>
      typeof cell.date === "string" && cell.date <= today && (cell.amount !== null || cell.return_percent !== null));
}

/**
 * A calendar request is one month wide, so an empty current month is a request
 * boundary rather than evidence that no daily change exists: `as_of` names the
 * cohort's newest observation whatever month was asked for. Only an earlier
 * month is returned, so the follow-up can never re-resolve to its own month.
 */
export function carryoverMonthForLatestDay(data: CalendarResponse): { year: number; month: number } | null {
  if (data.month === null || datedValueCells(data.cells).length > 0) return null;
  const latest = /^(\d{4})-(\d{2})-\d{2}$/.exec(data.as_of ?? "");
  if (!latest) return null;
  const year = Number(latest[1]);
  const month = Number(latest[2]);
  if (month < 1 || month > 12) return null;
  const requested = `${data.year}-${String(data.month).padStart(2, "0")}`;
  const target = `${year}-${String(month).padStart(2, "0")}`;
  return target < requested ? { year, month } : null;
}

const usable = renderableStatus;

/** Missing values stay quiet; nearby visible copy retains the actual state or reason. */
function KpiState({ status }: { status: string }) {
  const t = useT();
  return <span className="flat kpi-empty-value" data-state={status}>—<span className="sr-only">{t(`state.${status}`)}</span></span>;
}

function kpiLoading(title: string) {
  return <KpiCard title={title} value={<Skeleton height={28} width="70%" />} />;
}

/** A reason is one short line on the card, never an expandable audit block. */
function reasonText(t: ReturnType<typeof useT>, reason?: string | null): string | undefined {
  if (reason === "mixed_currency") return t("overview.mixed_currency_short");
  return reason ? t(`reason.${reason}`) : undefined;
}

/* ---------- KPI cards ---------- */

function AssetKpi({ state }: { state: Api<AssetsResponse> }) {
  const t = useT();
  const title = t("overview.total_assets");
  if (state.phase === "loading") return kpiLoading(title);
  if (state.phase === "error") return <KpiCard title={title} value={<KpiState status="read_failed" />} sub={t("state.read_failed")} />;
  const data = state.data;
  if (data.per_currency?.length && data.unavailable_reason !== "stored_records_unreadable") {
    return <KpiCard title={title} value={<CurrencyTotals totals={data.per_currency} freshness={data.freshness_summary} />} />;
  }
  const balance = latestAssetBalance(data);
  const status = balance === null && usable(data.status) ? "unavailable" : data.status;
  const value = balance !== null
    ? <Money value={balance} currency={data.currency} />
    : <KpiState status={status} />;
  const sub = balance === null ? reasonText(t, data.unavailable_reason) || t(`state.${status}`) : undefined;
  const footer = status !== "ok" || data.as_of ? <>
    {status !== "ok" && <StatusBadge status={status} reason={data.unavailable_reason} />}
    {data.as_of && <AsOfStamp value={data.as_of} />}
  </> : undefined;
  return <KpiCard title={title} value={value} sub={sub} footer={footer} />;
}

/** Method tag for the range-return KPI, matching the performance page cards. */
function returnMethodLabel(data: SummaryResponse, t: ReturnType<typeof useT>): string {
  const cls = classifyCashflowMethod(data);
  if (cls === "dietz_approx") return t(DIETZ_APPROX_LABEL_KEY);
  // Present but unrecognized method metadata is never shown as an unqualified TWR.
  if (cls === "unknown") return t(UNKNOWN_METHOD_LABEL_KEY);
  return t("overview.twr_tag");
}

function ReturnKpi({ state }: { state: Api<SummaryResponse> }) {
  const t = useT();
  const title = t("overview.range_return", { range: t(`perf.range.${RANGE}`) });
  if (state.phase === "loading") return kpiLoading(title);
  if (state.phase === "error") return <KpiCard title={title} value={<KpiState status="read_failed" />} sub={t("state.read_failed")} />;
  const data = state.data;
  if (!usable(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} />}
      sub={reasonText(t, data.unavailable_reason) || t(`state.${data.status}`)}
      footer={data.as_of ? <AsOfStamp value={data.as_of} /> : undefined} />;
  }
  const abnormal = data.status !== "ok";
  const reason = data.metric_reasons?.twr || data.unavailable_reason;
  const statusBadge = abnormal ? <StatusBadge status={data.status} reason={data.unavailable_reason} /> : undefined;
  const footer = statusBadge || data.as_of
    ? <>{statusBadge}{data.as_of && <AsOfStamp value={data.as_of} />}</>
    : undefined;
  if (data.twr_return_percent === null) {
    return <KpiCard title={title} value={<KpiState status="unavailable" />}
      sub={reasonText(t, reason) || t("state.unavailable")} footer={footer} />;
  }
  return <KpiCard title={title} value={<Percent value={data.twr_return_percent} />} sub={returnMethodLabel(data, t)}
    footer={footer} />;
}

/** Latest daily change, following the cohort forward one month when the asked month is empty. */
function LastDayKpi({ state, carryover, carryoverState }: {
  state: Api<CalendarResponse>;
  carryover?: { year: number; month: number } | null;
  carryoverState?: AsyncState<CalendarResponse | null>;
}) {
  const t = useT();
  const title = t("overview.last_day_change");
  // The earlier month is consulted only once it is actually requested; a failed
  // follow-up leaves the month that was asked for on screen. Anything still
  // unresolved reads as in flight, because the requested month is already known
  // to be empty and rendering it would flash an unknown value for one frame.
  let active: AsyncState<CalendarResponse> = state;
  if (carryover && carryoverState?.phase !== "error") {
    active = carryoverState?.phase === "ready" && carryoverState.data
      ? { phase: "ready", data: carryoverState.data, error: null }
      : { phase: "loading", data: null, error: null };
  }
  if (active.phase === "loading") return kpiLoading(title);
  if (active.phase === "error") return <KpiCard title={title} value={<KpiState status="read_failed" />} sub={t("state.read_failed")} />;
  const data = active.data;
  if (!usable(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} />}
      sub={reasonText(t, data.unavailable_reason) || t(`state.${data.status}`)}
      footer={data.as_of ? <AsOfStamp value={data.as_of} /> : undefined} />;
  }
  const abnormal = data.status !== "ok";
  const statusBadge = abnormal ? <StatusBadge status={data.status} reason={data.unavailable_reason} /> : undefined;
  const footer = statusBadge || data.as_of
    ? <>{statusBadge}{data.as_of && <AsOfStamp value={data.as_of} />}</>
    : undefined;
  const cell = datedValueCells(data.cells).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!cell) {
    return <KpiCard title={title} value={<span className="flat">—</span>}
      sub={reasonText(t, data.unavailable_reason) || t("state.no_data")} footer={footer} />;
  }
  const value =
    cell.amount !== null ? (
      <Money value={cell.amount} currency={cell.currency} signed />
    ) : (
      <Percent value={cell.return_percent} />
    );
  const cellKind = cell.value_kind === "pnl" ? t("perf.value_kind_pnl") : t("perf.value_kind_asset_change");
  return <KpiCard title={title} value={value} sub={cellKind} footer={footer} />;
}

function TodosKpi({ state }: { state: Api<InboxResponse> }) {
  const t = useT();
  const navigate = useNavigate();
  const open = () => navigate({ page: "decisions" });
  const title = t("overview.todos");
  if (state.phase === "loading") {
    return <KpiCard title={title} value={<Skeleton height={28} width="70%" />} onClick={open} />;
  }
  // A failed read must never render as zero pending.
  if (state.phase === "error" || state.data.status === "read_failed") {
    return <KpiCard title={title} value={<KpiState status="read_failed" />}
      sub={t(`inbox.error.${inboxFailureState(state.data, state.error)}.title`)} onClick={open} />;
  }
  const data = state.data;
  const pending = data.items.filter(item => item.status === "pending");
  const urgent = pending.filter(item => item.priority === "high").length;
  return (
    <KpiCard
      title={title}
      value={pending.length}
      sub={t("overview.todos_urgent", { count: urgent })}
      footer={data.status === "partial" ? <StatusBadge status="partial" /> : undefined}
      onClick={open}
    />
  );
}

/** Accounts with a run record on the New York day the API reports. */
function RunsKpi({ state }: { state: Api<TodayRunSummary> }) {
  const t = useT();
  const navigate = useNavigate();
  const open = () => navigate({ page: "health" });
  // "Accounts with records today" is a count of observed accounts, never a run
  // count and never a success count.
  const title = t("overview.runs_card_title");
  if (state.phase === "loading") {
    return <KpiCard title={title} value={<Skeleton height={28} width="70%" />} onClick={open} />;
  }
  if (state.phase === "error" || state.data.status === "read_failed") {
    return <KpiCard title={title} value={<KpiState status="read_failed" />} sub={t("state.read_failed")} onClick={open} />;
  }
  const data = state.data;
  const { configured, observed } = data.counts;
  // A known denominator makes 0/N an effective zero. Only an unknowable
  // denominator or count falls back to an em dash; a null run count is not
  // displayed at all, so it can never read as zero.
  const denominatorKnown = Number.isSafeInteger(configured) && configured > 0
    && Number.isSafeInteger(observed) && observed >= 0;
  const value = denominatorKnown ? `${observed}/${configured}` : <KpiState status="unknown" />;
  // Name a reason only when the account evidence actually carries it. A partial
  // summary is not by itself evidence that the run-record source is disconnected,
  // so an unexplained partial keeps the generic "partial" badge.
  const accountReasons = new Set((data.accounts ?? [])
    .map(account => account.unavailable_reason)
    .filter((reason): reason is string => typeof reason === "string" && reason !== ""));
  const reason = accountReasons.has("runtime_daily_binding_conflict") ? "runtime_daily_binding_conflict"
    : accountReasons.has("runtime_daily_not_connected") ? "runtime_daily_not_connected"
      : undefined;
  // On a weekend, absent records are the schedule, not degraded coverage.
  const nonTrading = weekendWithoutScheduledRuns(data);
  // The footer badge already names a non-trading day; the sub-line only adds the
  // missing-record reason on a normal business day. The session comes from the
  // API because a browser weekday can disagree with New York, and only an
  // explicit trading day may be called a business day: an older payload without
  // the field must not assert a trading status the API never reported.
  const dateLabelKey = data.market_session === "trading_day" ? "overview.business_date" : "overview.calendar_date";
  const sub = denominatorKnown
    ? <>{t(dateLabelKey, { value: data.date })}
        {!nonTrading && observed === 0 && <> · {t("overview.no_records_for_day")}</>}</>
    : t("state.no_data");
  return (
    <KpiCard
      title={title}
      value={value}
      sub={sub}
      footer={nonTrading ? <Badge tone="unknown">{t("overview.non_trading_day_short")}</Badge>
        : data.status === "partial" ? <StatusBadge status="partial" reason={reason} /> : undefined}
      onClick={open}
    />
  );
}

/* ---------- trend: returns first, a real asset balance as an honest fallback ---------- */

export interface AssetBalanceHistory {
  currency: string;
  status: Status;
  reason: Reason | null;
  asOf: string | null;
  partial: boolean;
  points: Point[];
}

/**
 * Asset histories that may stand in for the trend when returns cannot be drawn.
 * Currencies stay separate: one is shown at a time, never summed, converted,
 * rebased or labelled as a return. Loading and read failures never reach here.
 */
export function assetBalanceHistories(data: AssetsResponse | null): AssetBalanceHistory[] {
  if (!data) return [];
  const curveStatus = data.curve_status ?? data.status;
  const curveReason = data.curve_unavailable_reason === undefined
    ? data.unavailable_reason
    : data.curve_unavailable_reason;
  const rows: {
    currency: string;
    status: Status;
    reason: Reason | null;
    asOf: string | null;
    coverage: HistoryCoverage | null | undefined;
    points: Point[];
  }[] = data.history_per_currency?.length
    ? data.history_per_currency.map(history => ({
        currency: history.currency,
        status: history.status,
        reason: history.unavailable_reason,
        asOf: history.as_of,
        coverage: history.coverage,
        points: history.points,
      }))
    : [{
        currency: data.currency ?? "",
        status: curveStatus,
        reason: curveReason,
        asOf: data.as_of,
        coverage: data.curve_coverage,
        points: data.points,
      }];
  return rows.flatMap(row => {
    // A currency without a renderable, labelled, finite series stays out instead
    // of borrowing another currency's curve or guessing an unlabelled aggregate.
    const points: Point[] = [];
    // A non-finite balance is an unknown value, not a bridge: dropping it must
    // break the line, otherwise the area would connect straight across it.
    let breakPending = false;
    for (const point of row.points) {
      if (!Number.isFinite(point.value)) {
        breakPending = true;
        continue;
      }
      points.push(breakPending && !point.breakBefore ? { ...point, breakBefore: true } : point);
      breakPending = false;
    }
    if (!usable(row.status) || !row.currency || points.length === 0) return [];
    return [{
      currency: row.currency,
      status: row.status,
      reason: row.reason,
      asOf: row.asOf,
      points,
      partial: points.some(point => point.partial)
        || Boolean(row.coverage?.truncated)
        || Boolean(row.coverage?.read_failures?.length),
    }];
  });
}

/** The selected currency only; USD and USDT are never blended into one series. */
export function selectAssetHistory(
  histories: AssetBalanceHistory[],
  currency: string | null,
): AssetBalanceHistory | null {
  if (!histories.length) return null;
  return histories.find(history => history.currency === currency) ?? histories[0]!;
}

export function TrendCard({ returns, assets }: { returns: Api<ReturnsResponse>; assets: Api<AssetsResponse> }) {
  const t = useT();
  const navigate = useNavigate();
  const scopeLabel = useScopeLabel();
  const [currency, setCurrency] = useState<string | null>(null);
  const open = () => navigate({ page: "performance" });
  let body: ReactNode;
  let title = t("overview.equity_trend");
  let currencySwitch: ReactNode = null;
  let note: ReactNode = null;
  const drawable = returns.phase === "ready" && usable(returns.data.status) && returns.data.points.length > 0;
  if (returns.phase === "loading") {
    body = <Skeleton height={220} />;
  } else if (returns.phase === "error") {
    body = <ErrorState onRetry={returns.reload} />;
  } else if (drawable) {
    const data = returns.data;
    // An unadjusted asset ratio is a percentage change including cash flows, not
    // a balance and not TWR; use the same "asset change" wording as ReturnsCard.
    const returnQualified = data.return_kind === "twr" && classifyCashflowMethod(data) !== "unknown";
    if (!returnQualified) title = t("perf.asset_change_title");
    const series: ChartSeries[] = [
      { id: "main", label: scopeLabel, color: "var(--accent)", points: data.points, primary: true },
    ];
    body = <LineChart series={series} mode="cumulative" ariaLabel={title} alignStart={data.aligned_start} />;
    if (data.status === "partial" || data.status === "stale") {
      // One short state stays visible; the performance page holds the full reason.
      note = (
        <div className="card-note overview-trend-note">
          {data.status === "partial"
            ? <Badge tone="warn">{t("state.partial_valuation")}</Badge>
            : <StatusBadge status={data.status} />}
          {data.as_of && <AsOfStamp value={data.as_of} />}
        </div>
      );
    }
  } else {
    // Returns cannot be drawn. A completed assets read may still hold a real
    // per-currency balance, shown as a balance and never as a return.
    const histories = assetBalanceHistories(assets.phase === "ready" ? assets.data : null);
    const selected = selectAssetHistory(histories, currency);
    if (assets.phase === "loading") {
      body = <Skeleton height={220} />;
    } else if (assets.phase === "error") {
      body = <ErrorState onRetry={assets.reload} />;
    } else if (selected) {
      title = t("perf.asset_balance_title");
      if (histories.length > 1) {
        currencySwitch = (
          <div className="overview-currency-switch">
            <div className="segmented" role="group" aria-label={t("perf.currency_switch")}>
              {histories.map(history => (
                <button
                  key={history.currency}
                  type="button"
                  className={`segment${history.currency === selected.currency ? " active" : ""}`}
                  aria-pressed={history.currency === selected.currency}
                  onClick={() => setCurrency(history.currency)}
                >
                  {history.currency}
                </button>
              ))}
            </div>
          </div>
        );
      }
      body = <AreaChart points={selected.points} currency={selected.currency} ariaLabel={title} />;
      if (selected.status !== "ok" || selected.partial) {
        note = (
          <div className="card-note overview-trend-note">
            <StatusBadge status={selected.status === "ok" ? "partial" : selected.status} reason={selected.reason} />
            {selected.asOf && <AsOfStamp value={selected.asOf} />}
          </div>
        );
      }
    } else {
      // Nothing real to draw: stay quiet instead of inventing a curve.
      body = <EmptyState title={t(`state.${usable(returns.data.status) ? "no_data" : returns.data.status}`)} />;
    }
  }
  return (
    <div className="card overview-link-card overview-trend-card">
      <div className="overview-card-head">
        <h2 className="card-title">{title}</h2>
        {/* The card itself is not a button: one real link, so the currency
            buttons below can never sit inside a button or inherit its keydown. */}
        <button type="button" className="overview-trend-open" onClick={open}>
          {t("overview.open_performance")} <span aria-hidden="true">→</span>
        </button>
      </div>
      {currencySwitch}
      {body}
      {note}
    </div>
  );
}

const QUEUE_PRIORITY: Record<string, number> = { high: 0, medium: 1, normal: 2 };

/** Recovery first, then the server priority, then newest; no client urgency score. */
function queueOrder(a: InboxItem, b: InboxItem): number {
  const recovery = Number(b.category === "reconciliation_recovery") - Number(a.category === "reconciliation_recovery");
  if (recovery !== 0) return recovery;
  return (QUEUE_PRIORITY[a.priority] ?? 3) - (QUEUE_PRIORITY[b.priority] ?? 3)
    || (b.created_at || "").localeCompare(a.created_at || "");
}

function QueueRow({ item, onOpen }: { item: InboxItem; onOpen: () => void }) {
  const t = useT();
  const language = useLanguage();
  const title = t(item.title_key);
  const expires = item.expires_at ? formatDateTime(item.expires_at, language) : null;
  return (
    <li className="overview-queue-item">
      <button type="button" className="overview-queue-open" onClick={onOpen}>
        <span className="overview-queue-main">
          <span className="overview-queue-title">{title === item.title_key ? item.short_id : title}</span>
          <span className="overview-queue-meta">
            <Badge tone={item.category === "reconciliation_recovery" ? "warn" : "accent"}>{t(`category.${item.category}`)}</Badge>
            <span>{item.account_alias || t("decisions.account_unbound")}</span>
            <span>{t("decisions.ref", { id: item.short_id })}</span>
            {expires && <span>{t("overview.expires_plain", { value: expires.zone ? `${expires.text} (${expires.zone})` : expires.text })}</span>}
          </span>
        </span>
        <FreshnessBadge state={item.evidence_freshness?.status} observedAt={item.evidence_freshness?.as_of} />
      </button>
    </li>
  );
}

/**
 * Owner decisions lead the page. Counts appear only when every decision source
 * was read; a partial read lists what is known and says coverage is incomplete.
 */
function DecisionQueue({ inbox, onRetry }: { inbox: Api<InboxResponse>; onRetry: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const open = () => navigate({ page: "decisions" });
  let body: ReactNode;
  if (inbox.phase === "loading") {
    body = <Skeleton height={88} />;
  } else if (inbox.phase === "error" || (inbox.phase === "ready" && inbox.data.status === "read_failed" && inbox.data.items.length === 0)) {
    body = (
      <>
        <p className="cockpit-note error" role="status">{t("overview.queue_read_failed")}</p>
        <button type="button" className="button button-secondary button-sm" onClick={onRetry}>{t("common.retry")}</button>
      </>
    );
  } else {
    const data = inbox.data;
    const complete = data.status === "ok" && data.sources.every(source => source.status === "ok");
    const now = Date.now();
    const actionable = data.items
      .filter(item => item.status === "pending" && !(item.expires_at && Date.parse(item.expires_at) < now))
      .sort(queueOrder);
    const blocked = actionable.filter(item => !["fresh", "ready"].includes(item.evidence_freshness?.status ?? "")).length;
    const urgent = actionable.filter(item => item.priority === "high").length;
    body = (
      <>
        <p className="overview-queue-lede">
          {complete
            ? actionable.length === 0 ? t("overview.queue_complete_empty") : t("overview.needs_review", { count: actionable.length })
            : t("overview.queue_incomplete")}
        </p>
        {complete && actionable.length > 0 && (
          <p className="overview-queue-counts">
            <span>{t("overview.queue_blocked", { count: blocked })}</span>
            <span>{t("overview.queue_high_priority", { count: urgent })}</span>
          </p>
        )}
        {actionable.length > 0 && (
          <ul className="overview-queue-list">
            {actionable.slice(0, 3).map(item => <QueueRow key={item.id} item={item} onOpen={open} />)}
          </ul>
        )}
        <button type="button" className="button button-secondary button-sm" onClick={open}>
          {t("overview.queue_more")}
        </button>
      </>
    );
  }
  return (
    <section className="card overview-queue" aria-label={t("overview.decision_queue")}>
      <div className="overview-card-head">
        <h2 className="card-title">{t("overview.decision_queue")}</h2>
      </div>
      {body}
    </section>
  );
}

/* ---------- page ---------- */

export default function OverviewPage() {
  const t = useT();
  const { scope } = useScope();
  const [epoch, setEpoch] = useState(0);
  const refresh = () => setEpoch(value => value + 1);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const assets = useApi(() => loadPerformanceAssets(scope, RANGE), [scope, epoch]);
  const summary = useApi(() => loadPerformanceSummary(scope, RANGE), [scope, epoch]);
  const calendar = useApi(() => loadPerformanceCalendar(scope, RANGE, currentYear, currentMonth), [scope, epoch]);
  const latestDayCarryover = calendar.phase === "ready" ? carryoverMonthForLatestDay(calendar.data) : null;
  const calendarCarryover = useApi(
    () => (latestDayCarryover
      ? loadPerformanceCalendar(scope, RANGE, latestDayCarryover.year, latestDayCarryover.month)
      : Promise.resolve(null)),
    [scope, epoch, latestDayCarryover ? `${latestDayCarryover.year}-${latestDayCarryover.month}` : ""],
  );
  const inbox = useApi(() => loadInbox(epoch > 0), [epoch]);
  const todayRuns = useApi(() => loadTodayRuns(), [epoch]);
  const returns = useApi(() => loadPerformanceReturns(scope, RANGE), [scope, epoch]);
  const activity = useApi(() => loadAuditEvents(), [epoch]);
  const activityStatus = activity.phase === "loading" ? "loading" as const
    : activity.phase === "error" ? "error" as const
      : activity.data.status === "not_ready" ? "not_ready" as const : "ready" as const;
  const activityEvents = activity.phase === "ready" && activity.data.status === "ready" ? activity.data.data : null;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t("nav.overview")}</h1>
        <div className="page-header-actions">
          <button type="button" className="button button-secondary" onClick={refresh}>
            {t("common.refresh")}
          </button>
        </div>
      </div>
      <DecisionQueue inbox={inbox} onRetry={inbox.reload} />
      <section className="overview-summary" aria-label={t("overview.asset_summary")}>
        <div className="overview-primary-kpi"><AssetKpi state={assets} /></div>
        <div className="overview-secondary-kpis">
          <ReturnKpi state={summary} />
          <LastDayKpi state={calendar} carryover={latestDayCarryover} carryoverState={calendarCarryover} />
          <TodosKpi state={inbox} />
          <RunsKpi state={todayRuns} />
        </div>
      </section>
      <TrendCard returns={returns} assets={assets} />
      <section className="card overview-activity" aria-label={t("overview.latest_activity")}>
        <div className="overview-card-head">
          <h2 className="card-title">{t("overview.latest_activity")}</h2>
        </div>
        <AuditTimeline events={activityEvents} status={activityStatus} />
      </section>
    </div>
  );
}
