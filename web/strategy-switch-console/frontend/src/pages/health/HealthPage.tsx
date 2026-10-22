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
import { RunGrid } from "./RunGrid";
import { todayFailures } from "./status";
import { runStatus, runStateCounts } from "../../../../application/console_api/run_status.js";
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
  const stateCounts = data ? runStateCounts(data.accounts) : null;
  const unconnectedNote = stateCounts && (stateCounts.not_connected > 0 || stateCounts.no_data > 0)
    ? t("health.kpi.today_runs_note", { not_connected: stateCounts.not_connected, no_data: stateCounts.no_data })
    : undefined;
  const credentialData = credential.phase === "ready" ? credential.data : null;
  const credentialCount = credentialData && ATTENTION_PHASES.includes(credentialData.phase) ? 1 : 0;
  const primaryStates = ["succeeded", "failed", "read_failed"] as const;
  const stateEntries = stateCounts ? Object.entries(stateCounts) : [];
  const primaryCounts = stateEntries.filter(([state]) => (primaryStates as readonly string[]).includes(state));
  const secondaryCounts = stateEntries.filter(([state]) => !(primaryStates as readonly string[]).includes(state));

  return (
    <>
      <div className="stat-strip">
        <KpiCard
          title={t("health.kpi.today_runs")}
          value={
            <StatValue state={summary} render={() => t("health.account_fraction", { count: okCount, total: data?.counts.configured ?? 0 })} />
          }
          sub={unconnectedNote ? <span title={t("health.kpi.today_runs_note_title")}>{unconnectedNote}</span> : undefined}
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
          title={t("health.kpi.credentials")}
          value={<StatValue state={credential} render={() => String(credentialCount)} />}
          sub={t("health.kpi.credentials_unit")}
        />
        <KpiCard
          title={t("health.kpi.recent_failure")}
          value={<StatValue state={summary} render={() => failures.complete
            ? String(failures.count)
            : failures.count > 0 ? t("health.failure_at_least", { count: failures.count }) : t("state.unknown")} />}
        />
      </div>
      {stateCounts && (
        <div className="health-state-summary">
          <ul className="health-state-counts" aria-label={t("health.state_counts")}>
            {primaryCounts.map(([state, count]) => <li key={state}>
              {t(`health.run_state.${state}`)}: <span className="num">{count}</span>
            </li>)}
          </ul>
          {secondaryCounts.length > 0 && (
            <details className="health-state-details">
              <summary>{t("health.state_details")}</summary>
              <ul className="health-state-counts">
                {secondaryCounts.map(([state, count]) => <li key={state}>
                  {t(`health.run_state.${state}`)}: <span className="num">{count}</span>
                </li>)}
              </ul>
            </details>
          )}
        </div>
      )}
      <p className="metric-note" title={t("health.failure_window_detail")}>
        {t("health.failure_window", { date: data?.date ?? "—" })}
        {!failures.complete && ` · ${t("health.failure_incomplete")}`}
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
      cell: row => <StatusBadge status={row.freshness ?? (row.stale === true ? "stale" : row.fresh === true ? "fresh" : row.status)} reason={row.unavailable_reason} />,
      sortValue: row => row.status,
    },
    {
      id: "activity",
      header: t("health.activity"),
      cell: row => <>
        {t(`health.run_state.${row.run_status || runStatus(row)}`)}
        {(row.run_status || runStatus(row)) === "blocked" && <span className="card-note"> · {t(row.run_status_reason ? `reason.${row.run_status_reason}` : "reason.unknown")}</span>}
      </>,
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
  return <DataTable columns={columns} rows={[item]} rowKey={row => row.id} caption={t("health.credentials_title")} />;
}

function NotificationsCard({ epoch }: { epoch: number }) {
  const t = useT();
  const language = useLanguage();
  const state = useApi(() => loadNotificationLog(), [epoch]);
  if (state.phase === "loading") return <Skeleton height={72} />;
  if (state.phase === "error") return <ErrorState onRetry={state.reload} />;
  const log = state.data;
  if (log.status === "not_connected" || log.read_status === "not_connected") return <EmptyState title={t("health.notifications_not_connected")} action={<StatusBadge status="not_connected" />} />;
  if (log.status === "read_failed" || log.read_status === "read_failed") return <ErrorState onRetry={state.reload} />;
  const incomplete = log.status === "partial" || log.read_status === "partial"
    || log.read_status === "unknown" || log.truncated === true;
  if (!log.items.length) return <>
    {incomplete && <p role="alert">{t("health.notifications_partial")}</p>}
    <EmptyState title={t(incomplete ? "health.notifications_empty_partial" : "health.notifications_empty")}
      body={t("health.notifications_scope")} />
  </>;
  const columns: Column<(typeof log.items)[number]>[] = [
    { id: "date", header: t("health.notification_business_day"), cell: row => row.business_day || "—", sortValue: row => row.business_day },
    { id: "status", header: t("common.status"), cell: row => <>
      {t(`health.notification.${row.status}`)}
      <span className="card-note"> · {t("health.notification_delivered")}: {t(row.delivered === null ? "state.unknown" : row.delivered ? "health.notification_yes" : "health.notification_no")}</span>
      {row.dry_run === true && <span> · {t("health.notification.dry_run")}</span>}
      {row.test_message === true && <span> · {t("health.notification.test_message")}</span>}
      {row.reason_code && <p className="card-note">{t(`health.notification_reason.${row.reason_code}`)}</p>}
    </> },
    { id: "sent", header: t("health.notification_sent_at"), cell: row => formatDateTime(row.sent_at, language).text },
    { id: "workflow_time", header: t("health.notification_workflow_time"), cell: row => formatDateTime(row.workflow_updated_at, language).text, sortValue: row => row.workflow_updated_at },
    {
      id: "source",
      header: t("health.notification_source"),
      cell: row => <details className="notification-source">
        <summary>{t("health.notification_source_summary")}</summary>
        <a href={row.source_url} target="_blank" rel="noreferrer">{t("health.notification_run", { id: row.source_run_id, attempt: row.source_run_attempt })}</a>
      </details>,
    },
  ];
  return <>
    <details className="card-details health-notes">
      <summary>{t("health.notes")}</summary>
      <p>{t("health.notifications_scope")}</p>
    </details>
    {incomplete && <p role="alert">{t("health.notifications_partial")}</p>}
    <p className="scroll-hint">{t("health.table_scroll_hint")}</p>
    <div className="health-notifications"><DataTable columns={columns} rows={log.items} rowKey={row => row.id} caption={t("health.notifications_title")} /></div>
  </>;
}

export default function HealthPage() {
  const t = useT();
  const [epoch, setEpoch] = useState(0);
  const summary = useApi(() => loadTodayRuns(), [epoch]);
  const credential = useApi(() => loadCredentialMaintenance(), [epoch]);
  const accounts = useApi(() => loadAccounts(), [epoch]);
  const dailyBindings = useApi(() => loadRuntimeDailyBindings(), [epoch]);
  const gridAccounts = useMemo(() => accounts.phase === "ready" && dailyBindings.phase === "ready"
    ? boundDailyAccounts(accounts.data.accounts, dailyBindings.data) : [],
    [accounts.phase, accounts.data, dailyBindings.phase, dailyBindings.data]);

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">{t("health.title")}</h1>
        <button type="button" className="button button-secondary health-refresh" onClick={() => setEpoch(value => value + 1)}>
          {t("common.refresh")}
        </button>
      </header>

      <p className="card-note">{t("health.global_scope_note")}</p>
      <StatStrip summary={summary} credential={credential} />

      <section className="card">
        <h2 className="card-title">{t("health.grid_title")}</h2>
        {(accounts.phase === "loading" || dailyBindings.phase === "loading") && <Skeleton height={160} />}
        {accounts.phase === "error" && <ErrorState onRetry={accounts.reload} />}
        {dailyBindings.phase === "error" && <ErrorState onRetry={dailyBindings.reload} />}
        {accounts.phase === "ready" && dailyBindings.phase === "ready" && (
          <RunGrid
            accounts={gridAccounts}
            epoch={epoch}
          />
        )}
      </section>

      <section className="card">
        <h2 className="card-title">{t("health.freshness_title")}</h2>
        <p className="scroll-hint">{t("health.table_scroll_hint")}</p>
        <div className="health-freshness"><FreshnessTable summary={summary} /></div>
      </section>

      <section className="card">
        <h2 className="card-title">{t("health.credentials_title")}</h2>
        <p className="scroll-hint">{t("health.table_scroll_hint")}</p>
        <div className="health-credentials"><CredentialsCard credential={credential} /></div>
      </section>

      <section className="card">
        <h2 className="card-title">{t("health.notifications_title")}</h2>
        <NotificationsCard epoch={epoch} />
      </section>
    </div>
  );
}
