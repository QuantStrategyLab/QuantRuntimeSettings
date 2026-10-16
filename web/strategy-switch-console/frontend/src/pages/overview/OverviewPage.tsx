import { InboxReadFailed } from "../../components/InboxReadFailed";
import { inboxFailureState } from "../../lib/inboxFailure";
import { CurrencyTotals, FreshnessSummary } from "../../components/CurrencyTotals";
import { AccountGroups } from "../../components/AccountGroups";
import type { DirectoryConfig } from "../../lib/accountDirectory";
import { useState } from "react";
import type { ReactNode } from "react";
import { getJson } from "../../api/client";
import type {
  AccountsResponse,
  AssetsResponse,
  CalendarResponse,
  InboxResponse,
  ReturnsResponse,
  SummaryResponse,
  TodayRunSummary,
} from "../../api/contracts";
import {
  loadAccounts,
  loadInbox,
  loadPerformanceAssets,
  loadPerformanceCalendar,
  loadPerformanceReturns,
  loadPerformanceSummary,
  loadTodayRuns,
} from "../../api/endpoints";
import { useApi } from "../../lib/hooks";
import type { AsyncState } from "../../lib/hooks";
import { relativeFreshness } from "../../lib/format";
import { latestAssetBalance } from "../../lib/performance";
import { renderableStatus } from "../../lib/status";
import { useNavigate, useScope } from "../../app/context";
import { useLanguage, useT } from "../../i18n";
import {
  AsOfStamp,
  DateText,
  EmptyState,
  ErrorState,
  Money,
  Percent,
  Skeleton,
  StatusBadge,
} from "../../components/primitives";
import { KpiCard } from "../../components/KpiCard";
import { LineChart, type ChartSeries } from "../../charts/LineChart";
import "./overview.css";

type Api<T> = AsyncState<T> & { reload: () => void };

/** Best-effort legacy config: strategy names, paper flag, runtime target state. */
type LegacyConfig = DirectoryConfig;

const RANGE = "YTD" as const;

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

const usable = renderableStatus;

/** State text replaces the main value when the status is not usable. */
function KpiState({ status, reason }: { status: string; reason?: string | null }) {
  const t = useT();
  return <span className="kpi-state" title={reason ? t(`reason.${reason}`) : undefined}>{t(`state.${status}`)}</span>;
}

function kpiLoading(title: string) {
  return <KpiCard title={title} value={<Skeleton height={28} width="70%" />} />;
}

/* ---------- KPI cards ---------- */

function AssetKpi({ state }: { state: Api<AssetsResponse> }) {
  const t = useT();
  const title = t("overview.total_assets");
  if (state.phase === "loading") return kpiLoading(title);
  if (state.phase === "error") return <KpiCard title={title} value={<KpiState status="read_failed" />} />;
  const data = state.data;
  if (data.per_currency?.length && data.unavailable_reason !== "stored_records_unreadable") {
    return <KpiCard title={title} value={<CurrencyTotals totals={data.per_currency} />}
      sub={t("perf.native_totals_note")} footer={<FreshnessSummary counts={data.freshness_summary} />} />;
  }
  const balance = latestAssetBalance(data);
  const status = balance === null && usable(data.status) ? "unavailable" : data.status;
  const footer = <><StatusBadge status={status} reason={data.unavailable_reason} /><AsOfStamp value={data.as_of} /></>;
  const value = balance !== null
    ? <Money value={balance} currency={data.currency} />
    : <KpiState status={status} reason={data.unavailable_reason} />;
  return <KpiCard title={title} value={value} sub={data.unavailable_reason ? t(`reason.${data.unavailable_reason}`) : undefined} footer={footer} />;
}

function ReturnKpi({ state }: { state: Api<SummaryResponse> }) {
  const t = useT();
  const title = t("overview.range_return", { range: t(`perf.range.${RANGE}`) });
  if (state.phase === "loading") return kpiLoading(title);
  if (state.phase === "error") return <KpiCard title={title} value={<KpiState status="read_failed" />} />;
  const data = state.data;
  const footer = (
    <>
      <StatusBadge status={data.status} reason={data.unavailable_reason} />
      <AsOfStamp value={data.as_of} />
    </>
  );
  if (!usable(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} reason={data.unavailable_reason} />} sub={t("overview.twr_tag")} footer={footer} />;
  }
  const value = data.twr_return_percent === null ? <span className="flat">—</span> : <Percent value={data.twr_return_percent} />;
  return <KpiCard title={title} value={value} sub={data.twr_return_percent === null && data.metric_reasons?.twr ? t(`reason.${data.metric_reasons.twr}`) : t("overview.twr_tag")} footer={footer} />;
}

function LastDayKpi({ state }: { state: Api<CalendarResponse> }) {
  const t = useT();
  const title = t("overview.last_day_change");
  if (state.phase === "loading") return kpiLoading(title);
  if (state.phase === "error") return <KpiCard title={title} value={<KpiState status="read_failed" />} />;
  const data = state.data;
  const kindLabel = data.value_kind === "pnl" ? t("perf.value_kind_pnl") : t("perf.value_kind_asset_change");
  const footer = (
    <>
      <StatusBadge status={data.status} reason={data.unavailable_reason} />
      <AsOfStamp value={data.as_of} />
    </>
  );
  if (!usable(data.status)) {
    return <KpiCard title={title} value={<KpiState status={data.status} reason={data.unavailable_reason} />} sub={kindLabel} footer={footer} />;
  }
  const today = localToday();
  const cell = data.cells
    .filter((item): item is typeof item & { date: string } => Boolean(item.date) && item.date! <= today && (item.amount !== null || item.return_percent !== null))
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!cell) {
    return <KpiCard title={title} value={<span className="flat">—</span>} sub={kindLabel} footer={footer} />;
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
    return <KpiCard title={title} value={<span className="kpi-state">{t(`inbox.error.${inboxFailureState(state.data, state.error)}.title`)}</span>} onClick={open} />;
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

function RunsKpi({ state }: { state: Api<TodayRunSummary> }) {
  const t = useT();
  const navigate = useNavigate();
  const open = () => navigate({ page: "health" });
  const title = t("nav.health");
  if (state.phase === "loading") {
    return <KpiCard title={title} value={<Skeleton height={28} width="70%" />} onClick={open} />;
  }
  if (state.phase === "error" || state.data.status === "read_failed") {
    return <KpiCard title={title} value={<KpiState status="read_failed" />} onClick={open} />;
  }
  const data = state.data;
  const { configured, observed, runs } = data.counts;
  const value = runs === null ? <span className="flat">—</span> : <>{observed}/{configured}</>;
  return (
    <KpiCard
      title={title}
      value={value}
      sub={<DateText value={data.date} />}
      footer={data.status === "partial" ? <StatusBadge status="partial" /> : undefined}
      onClick={open}
    />
  );
}

/* ---------- return trend mini chart ---------- */

function TrendCard({ state }: { state: Api<ReturnsResponse> }) {
  const t = useT();
  const navigate = useNavigate();
  const open = () => navigate({ page: "performance" });
  let body: ReactNode;
  let note: ReactNode = null;
  if (state.phase === "loading") {
    body = <Skeleton height={220} />;
  } else if (state.phase === "error") {
    body = <ErrorState onRetry={state.reload} />;
  } else {
    const data = state.data;
    if (usable(data.status) && data.points.length > 0) {
      const series: ChartSeries[] = [
        { id: "main", label: t("perf.returns_main_series"), color: "var(--accent)", points: data.points, primary: true },
      ];
      body = <LineChart series={series} mode="cumulative" ariaLabel={t("overview.equity_trend")} />;
    } else {
      body = (
        <EmptyState
          title={t(`state.${usable(data.status) ? "no_data" : data.status}`)}
          body={data.unavailable_reason ? t(`reason.${data.unavailable_reason}`) : undefined}
        />
      );
    }
    if (data.status === "partial" || data.status === "stale") {
      note = (
        <p className="card-note">
          <StatusBadge status={data.status} reason={data.unavailable_reason} /> <AsOfStamp value={data.as_of} />
        </p>
      );
    }
  }
  return (
    <div
      className="card overview-link-card"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
    >
      <div className="overview-card-head">
        <h2 className="card-title">{t("overview.equity_trend")}</h2>
        <span className="card-note">{t("overview.open_performance")} →</span>
      </div>
      {body}
      {note}
    </div>
  );
}

/* ---------- todo preview ---------- */

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, normal: 2 };

function TodoPreviewCard({ state }: { state: Api<InboxResponse> }) {
  const t = useT();
  const language = useLanguage();
  const navigate = useNavigate();
  const open = () => navigate({ page: "decisions" });
  let body: ReactNode;
  if (state.phase === "loading") {
    body = (
      <div className="inbox-list">
        <Skeleton height={56} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </div>
    );
  } else if (state.phase === "error" || state.data.status === "read_failed") {
    body = <InboxReadFailed data={state.data} error={state.error} onRetry={state.reload} />;
  } else {
    const pending = state.data.items
      .filter(item => item.status === "pending")
      .sort((a, b) => {
        const rank = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
        if (rank !== 0) return rank;
        return (b.created_at || "").localeCompare(a.created_at || "");
      })
      .slice(0, 3);
    if (pending.length === 0) {
      body = <EmptyState title={t("decisions.empty_pending")} />;
    } else {
      body = (
        <div className="inbox-list">
          {pending.map(item => {
            const translated = t(item.title_key);
            const title = translated === item.title_key ? item.short_id : translated;
            const fresh = relativeFreshness(item.created_at, language);
            return (
              <button key={item.id} type="button" className="inbox-item" onClick={open}>
                <span className={`priority-dot priority-${item.priority}`} aria-hidden="true" />
                <span className="item-main">
                  <span className="item-title">{title}</span>
                  <span className="item-meta">
                    <span>{item.account_alias || t("decisions.account_global")}</span>
                    {fresh && <span>{fresh}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      );
    }
  }
  return (
    <div className="card">
      <div className="overview-card-head">
        <h2 className="card-title">{t("overview.todo_preview")}</h2>
        <button type="button" className="button button-secondary" onClick={open}>{t("common.view_all")}</button>
      </div>
      {body}
    </div>
  );
}

/* ---------- my accounts ---------- */

function AccountsCard({ accounts, config }: { accounts: Api<AccountsResponse>; config: Api<LegacyConfig | null> }) {
  const t = useT();
  const navigate = useNavigate();
  let body: ReactNode;
  if (accounts.phase === "loading") {
    body = (
      <div className="account-grid">
        <Skeleton height={120} />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </div>
    );
  } else if (accounts.phase === "error") {
    body = <ErrorState onRetry={accounts.reload} />;
  } else if (accounts.data.accounts.length === 0) {
    body = <EmptyState title={t("overview.no_accounts")} />;
  } else {
    const cfg = config.phase === "ready" ? config.data : null;
    body = <AccountGroups accounts={accounts.data.accounts} config={cfg} onSelect={key => navigate({ page: "accounts", account: key })} />;
  }
  return (
    <div className="card">
      <h2 className="card-title">{t("overview.my_accounts")}</h2>
      {body}
    </div>
  );
}

/* ---------- page ---------- */

export default function OverviewPage() {
  const t = useT();
  const { scope } = useScope();
  const [epoch, setEpoch] = useState(0);
  const refresh = () => setEpoch(value => value + 1);

  const now = new Date();
  const assets = useApi(() => loadPerformanceAssets(scope, RANGE), [scope, epoch]);
  const summary = useApi(() => loadPerformanceSummary(scope, RANGE), [scope, epoch]);
  const calendar = useApi(() => loadPerformanceCalendar(scope, RANGE, now.getFullYear(), now.getMonth() + 1), [scope, epoch]);
  const inbox = useApi(() => loadInbox(epoch > 0), [epoch]);
  const todayRuns = useApi(() => loadTodayRuns(), [epoch]);
  const returns = useApi(() => loadPerformanceReturns(scope, RANGE), [scope, epoch]);
  const accounts = useApi(() => loadAccounts(), [epoch]);
  const config = useApi(() => getJson<LegacyConfig>("/api/config").catch(() => null), [epoch]);
  const metricReasons = [...new Set([assets, summary, calendar].flatMap(state =>
    state.phase === "ready" && state.data.unavailable_reason ? [state.data.unavailable_reason] : []))];

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t("nav.overview")}</h1>
        <button type="button" className="button button-secondary overview-refresh" onClick={refresh}>
          {t("common.refresh")}
        </button>
      </div>
      <div className="kpi-grid">
        <AssetKpi state={assets} />
        <ReturnKpi state={summary} />
        <LastDayKpi state={calendar} />
        <TodosKpi state={inbox} />
        <RunsKpi state={todayRuns} />
      </div>
      {metricReasons.length > 0 && <p className="metric-note">{metricReasons.map(reason => t(`reason.${reason}`)).join(" · ")}</p>}
      <div className="grid-2">
        <TrendCard state={returns} />
        <TodoPreviewCard state={inbox} />
      </div>
      <AccountsCard accounts={accounts} config={config} />
    </div>
  );
}
