import { useDisplayNames } from "../../lib/useDisplayNames";
import { useMemo, useState } from "react";
import type { TodayRunSummary } from "../../api/contracts";
import {
  loadAccounts,
  loadCredentialMaintenance,
  loadNotificationLog,
  loadTodayRuns,
  loadRuntimeDailyBindings,
  type CredentialMaintenance,
} from "../../api/endpoints";
import { loadAuditEvents, loadDigestStatus } from "../../api/cockpit";
import { useLanguage, useT } from "../../i18n";
import { useApi, type AsyncState } from "../../lib/hooks";
import { formatDateTime } from "../../lib/format";
import { KpiCard } from "../../components/KpiCard";
import { DataTable, type Column } from "../../components/DataTable";
import {
  AsOfStamp,
  Badge,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
} from "../../components/primitives";
import { AuditTimeline, DigestStatus } from "../../components/cockpit";
import { RunGrid } from "./RunGrid";
import { runActivityCounts, runActivityLabelKey, runActivityState, todayFailures, weekendWithoutScheduledRuns } from "./status";
import { groupAccounts } from "../../lib/accountDirectory";
import { boundDailyAccounts } from "./dailySelection";
import "./health.css";

type SummaryAccount = TodayRunSummary["accounts"][number];
type CredentialPhase = CredentialMaintenance["phase"];

const ATTENTION_PHASES: readonly CredentialPhase[] = ["30", "7", "1", "expired"];

const PHASE_TONE: Record<CredentialPhase, "ok" | "warn" | "error" | "unknown"> = {
  expired: "error",
  "1": "error",
  "7": "warn",
  "30": "warn",
  not_due: "ok",
  unknown: "unknown",
};

function StatValue({ state, render }: { state: AsyncState<unknown>; render: () => string }) {
  const t = useT();
  if (state.phase === "loading") return <Skeleton height={24} width={90} />;
  if (state.phase === "error" || (state.phase === "ready" && state.data !== null
    && typeof state.data === "object" && "status" in state.data && state.data.status === "read_failed")) {
    return <span className="kpi-state">{t("state.read_failed")}</span>;
  }
  return <>{render()}</>;
}

type Loadable<T> = AsyncState<T> & { reload: () => void };

function StatStrip({
  summary,
  credential,
}: {
  summary: Loadable<TodayRunSummary>;
  credential: Loadable<CredentialMaintenance>;
}) {
  const t = useT();
  const data = summary.phase === "ready" ? summary.data : null;
  const okCount = data ? data.accounts.filter(account => account.status === "ok").length : 0;
  const failures = data ? todayFailures(data) : { count: 0, complete: false };
  const stateCounts = data ? runActivityCounts(data.accounts) : null;
  // Weekend records are absent because nothing was scheduled, not because the
  // day is degraded. Binance may still report later; the day context says so.
  const nonTrading = data ? weekendWithoutScheduledRuns(data) : false;
  const unconnectedNote = stateCounts && (stateCounts.not_connected > 0 || stateCounts.no_data > 0)
    ? t("health.kpi.today_runs_note", { not_connected: stateCounts.not_connected, no_data: stateCounts.no_data })
    : undefined;
  const credentialData = credential.phase === "ready" ? credential.data : null;
  const credentialCount = credentialData?.requires_action === true || (credentialData && ATTENTION_PHASES.includes(credentialData.phase)) ? 1 : 0;
  const credentialUnknown = !credentialData || credentialData.phase === "unknown";
  const primaryStates = ["succeeded", "failed", "read_failed", "incomplete"] as const;
  const stateEntries = stateCounts ? Object.entries(stateCounts) : [];
  const primaryCounts = stateEntries.filter(([state]) => (primaryStates as readonly string[]).includes(state));
  const secondaryCounts = stateEntries.filter(([state, count]) =>
    !(primaryStates as readonly string[]).includes(state) && count > 0);

  return (
    <>
      {/* Four KPIs only: accounts with complete data, accounts with records,
          failed accounts, credentials. Digest delivery is a separate read below. */}
      <div className="stat-strip health-kpis">
        <KpiCard
          title={t("health.kpi.today_runs")}
          value={
            <StatValue state={summary} render={() => nonTrading && (data?.counts.observed ?? 0) === 0
              ? "—"
              : t("health.account_fraction", { count: okCount, total: data?.counts.configured ?? 0 })} />
          }
          sub={nonTrading ? <span>{t("health.non_trading_day_short")}</span>
            : unconnectedNote ? <span title={t("health.kpi.today_runs_note_title")}>{unconnectedNote}</span> : undefined}
          footer={data?.as_of ? <AsOfStamp value={data.as_of} /> : undefined}
        />
        <KpiCard
          title={t("health.kpi.observed")}
          value={
            <StatValue
              state={summary}
              render={() => t("health.account_fraction", { count: data?.counts.observed ?? 0, total: data?.counts.configured ?? 0 })}
            />
          }
        />
        <KpiCard
          title={t("health.kpi.recent_failure")}
          value={<StatValue state={summary} render={() => nonTrading && failures.count === 0 ? "—"
            : failures.complete
              ? String(failures.count)
              : failures.count > 0 ? t("health.failure_at_least", { count: failures.count }) : t("state.unknown")} />}
          sub={nonTrading ? t("health.non_trading_day_short") : undefined}
        />
        <KpiCard
          title={t("health.kpi.credentials")}
          value={<StatValue state={credential} render={() => credentialUnknown ? t("state.unknown") : String(credentialCount)} />}
          sub={t("health.kpi.credentials_unit")}
        />
      </div>
      {stateCounts && (
        <div className="health-state-summary">
          <ul className="health-state-counts" aria-label={t("health.state_counts")}>
            {primaryCounts.map(([state, count]) => <li key={state}>
              {t(runActivityLabelKey(state))}: <span className="num">{count}</span>
            </li>)}
          </ul>
          {secondaryCounts.length > 0 && (
            <ul className="health-state-counts health-state-secondary">
              {secondaryCounts.map(([state, count]) => <li key={state}>
                {t(runActivityLabelKey(state))}: <span className="num">{count}</span>
              </li>)}
            </ul>
          )}
        </div>
      )}
      <p className="metric-note" title={t("health.failure_window_detail")}>
        {t("health.failure_window", { date: data?.date ?? "—" })}
        {nonTrading ? ` · ${t("health.non_trading_day_short")}` : !failures.complete && ` · ${t("health.failure_incomplete")}`}
      </p>
    </>
  );
}

function FreshnessTable({ summary }: { summary: Loadable<TodayRunSummary> }) {
  const t = useT();
  const names = useDisplayNames();
  if (summary.phase === "loading") return <Skeleton height={120} />;
  if (summary.phase === "error") return <ErrorState onRetry={summary.reload} />;
  const columns: Column<SummaryAccount>[] = [
    {
      id: "account",
      header: t("health.col.account"),
      cell: row => (
        <>
          {names.account(row.account_alias, row.platform)}
        </>
      ),
      sortValue: row => `${names.account(row.account_alias, row.platform)}:${row.account_alias}`,
    },
    {
      id: "status",
      header: t("health.col.status"),
      cell: row => row.unavailable_reason === "runtime_daily_binding_conflict"
        ? <span>{t("reason.runtime_daily_binding_conflict")}</span>
        : <StatusBadge status={row.freshness ?? (row.stale === true ? "stale" : row.fresh === true ? "fresh" : row.status)} reason={row.unavailable_reason} />,
      sortValue: row => row.status,
    },
    {
      id: "activity",
      header: t("health.activity"),
      cell: row => {
        const activityState = runActivityState(row);
        return <span data-state={activityState} title={row.run_status_reason ? t(`reason.${row.run_status_reason}`) : undefined}>
          {t(runActivityLabelKey(activityState))}
        </span>;
      },
    },
    {
      id: "run_count",
      header: t("health.run_count"),
      numeric: true,
      cell: row => (row.run_count === null ? "—" : row.run_count),
      sortValue: row => row.run_count,
    },
    {
      id: "as_of",
      header: t("health.col.as_of"),
      cell: row => <AsOfStamp value={row.as_of} prefix="common.as_of" />,
      sortValue: row => row.as_of,
    },
  ];
  const groups = groupAccounts(summary.data.accounts, names.config)
    .sort((a, b) => names.platform(a.platform).localeCompare(names.platform(b.platform)));
  return <>
    {summary.data.status === "read_failed" && <p role="alert">{t("state.read_failed")}</p>}
    {groups.map(group => <section className="health-platform-group" key={group.platform}>
      <h3>{names.platform(group.platform)}</h3>
      <DataTable columns={columns} rows={group.accounts.flatMap(account => account.rows)}
        rowKey={row => `${row.platform}/${row.account_alias}`}
        defaultSort={{ column: "account", direction: "asc" }}
        scrollHint
        caption={`${t("health.freshness_title")} · ${names.platform(group.platform)}`} />
    </section>)}
    {!groups.length && <EmptyState title={t("state.no_data")} />}
  </>;
}

function CredentialsCard({ credential }: { credential: Loadable<CredentialMaintenance> }) {
  const t = useT();
  const language = useLanguage();
  if (credential.phase === "loading") return <Skeleton height={72} />;
  if (credential.phase === "error") return <ErrorState onRetry={credential.reload} />;
  const item = credential.data;
  const columns: Column<CredentialMaintenance>[] = [
    { id: "id", header: t("health.col.credential"), cell: row => t(row.id === "ibkr_flex" ? "health.credential_ibkr_report" : "health.credential_other") },
    {
      id: "phase",
      header: t("health.col.phase"),
      cell: row => <Badge tone={PHASE_TONE[row.phase]}>{t(`health.credential_phase.${row.phase}`)}</Badge>,
    },
    {
      id: "expires",
      header: t("health.col.expires"),
      cell: row => {
        if (!row.expires_at) return "—";
        const { text, zone } = formatDateTime(row.expires_at, language, true);
        return t("health.credential_expires", { value: zone ? `${text} (${zone})` : text });
      },
      sortValue: row => row.expires_at,
    },
  ];
  return <DataTable columns={columns} rows={[item]} rowKey={row => row.id} scrollHint caption={t("health.credentials_title")} />;
}

/**
 * The grid owns its two reads. A parent refresh remounts this whole subtree
 * (`key={epoch}`) instead of re-mounting it mid-flight: keeping the reads inside
 * one component means a stale `ready` from the previous epoch can never start a
 * read on the new one, which issued every first-column request twice.
 */
function GridSection() {
  const t = useT();
  const accounts = useApi(() => loadAccounts(), []);
  const dailyBindings = useApi(() => loadRuntimeDailyBindings(), []);
  const gridAccounts = useMemo(() => accounts.phase === "ready" && dailyBindings.phase === "ready"
    ? boundDailyAccounts(accounts.data.accounts, dailyBindings.data) : [],
    [accounts.phase, accounts.data, dailyBindings.phase, dailyBindings.data]);

  return (
    <section className="card">
      <h2 className="card-title">{t("health.grid_title")}</h2>
      {(accounts.phase === "loading" || dailyBindings.phase === "loading") && <Skeleton height={160} />}
      {accounts.phase === "error" && <ErrorState onRetry={accounts.reload} />}
      {dailyBindings.phase === "error" && <ErrorState onRetry={dailyBindings.reload} />}
      {dailyBindings.phase === "ready" && dailyBindings.data.some(binding => binding.status === "read_failed") && <p role="alert">{t("state.read_failed")}</p>}
      {accounts.phase === "ready" && dailyBindings.phase === "ready"
        && (gridAccounts.length > 0 || !dailyBindings.data.some(binding => binding.status === "read_failed")) && (
        <RunGrid
          accounts={gridAccounts}
          epoch={0}
        />
      )}
    </section>
  );
}

export default function HealthPage() {
  const t = useT();
  const [epoch, setEpoch] = useState(0);
  const summary = useApi(() => loadTodayRuns(), [epoch]);
  const credential = useApi(() => loadCredentialMaintenance(), [epoch]);
  const digest = useApi(async () => loadDigestStatus(await loadNotificationLog(1), false), [epoch]);
  const activity = useApi(() => loadAuditEvents(), [epoch]);
  const digestStatus = digest.phase === "loading" ? "loading" as const
    : digest.phase === "error" ? "error" as const
      : digest.data.status === "not_ready" ? "not_ready" as const : "ready" as const;
  const digestData = digest.phase === "ready" && digest.data.status === "ready" ? digest.data.data : null;
  const activityStatus = activity.phase === "loading" ? "loading" as const
    : activity.phase === "error" ? "error" as const
      : activity.data.status === "not_ready" ? "not_ready" as const : "ready" as const;
  const activityEvents = activity.phase === "ready" && activity.data.status === "ready" ? activity.data.data : null;

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">{t("health.title")}</h1>
        <div className="page-header-actions">
          <button type="button" className="button button-secondary" onClick={() => setEpoch(value => value + 1)}>
            {t("common.refresh")}
          </button>
        </div>
      </header>

      <p className="card-note">{t("health.global_scope_note")}</p>
      {/* Business day and read time sit above the KPIs: a browser-local date must never stand in for the business day. */}
      <div className="health-day-context">
        {summary.phase === "loading" ? <Skeleton height={18} width={240} />
          : summary.phase === "error"
            ? <span className="health-business-day" data-state="read_failed">{t("state.read_failed")}</span>
            : <span className="health-business-day">{t("health.business_date", { value: `${summary.data.date} · ${summary.data.timezone}` })}</span>}
        {summary.phase === "ready" && summary.data.as_of && <AsOfStamp value={summary.data.as_of} />}
        {summary.phase === "ready" && summary.data.market_session === "weekend" && (
          <span className="health-business-day" data-state="non_trading">{t("health.non_trading_day")}</span>
        )}
      </div>
      <StatStrip summary={summary} credential={credential} />

      <GridSection key={epoch} />

      <section className="card">
        <h2 className="card-title">{t("health.freshness_title")}</h2>
        <div className="health-freshness"><FreshnessTable summary={summary} /></div>
      </section>

      <section className="card">
        <h2 className="card-title">{t("health.credentials_title")}</h2>
        <div className="health-credentials"><CredentialsCard credential={credential} /></div>
      </section>

      <section className="card health-digest">
        <DigestStatus digest={digestData} status={digestStatus} onRetry={digest.reload} />
      </section>

      <section className="card health-activity">
        <h2 className="card-title">{t("overview.latest_activity")}</h2>
        <AuditTimeline events={activityEvents} status={activityStatus} />
      </section>
    </div>
  );
}
