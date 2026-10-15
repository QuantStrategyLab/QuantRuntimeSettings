import { useState } from "react";
import type { TodayRunSummary } from "../../api/contracts";
import {
  loadAccounts,
  loadCredentialMaintenance,
  loadNotificationLog,
  loadTodayRuns,
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
  DataBlock,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
} from "../../components/primitives";
import { RunGrid } from "./RunGrid";
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
  const failureCount = data
    ? data.accounts.filter(account => account.status === "read_failed" || account.activity === "failed").length
    : 0;
  const credentialData = credential.phase === "ready" ? credential.data : null;
  const credentialCount = credentialData && ATTENTION_PHASES.includes(credentialData.phase) ? 1 : 0;

  return (
    <div className="stat-strip">
      <KpiCard
        title={t("health.kpi.today_runs")}
        value={
          <StatValue state={summary} render={() => t("health.stat.today_runs", { ok: okCount, total: data?.counts.configured ?? 0 })} />
        }
        footer={data?.as_of ? <AsOfStamp value={data.as_of} /> : undefined}
      />
      <KpiCard
        title={t("health.kpi.observed")}
        value={
          <StatValue
            state={summary}
            render={() => t("health.stat.observed", { observed: data?.counts.observed ?? 0, configured: data?.counts.configured ?? 0 })}
          />
        }
      />
      <KpiCard
        title={t("health.kpi.credentials")}
        value={<StatValue state={credential} render={() => t("health.stat.credentials", { count: credentialCount })} />}
      />
      <KpiCard
        title={t("health.kpi.recent_failure")}
        value={<StatValue state={summary} render={() => t("health.stat.recent_failure", { count: failureCount })} />}
      />
    </div>
  );
}

function FreshnessTable({ summary }: { summary: Loadable<TodayRunSummary> }) {
  const t = useT();
  if (summary.phase === "loading") return <Skeleton height={120} />;
  if (summary.phase === "error") return <ErrorState onRetry={summary.reload} />;
  const columns: Column<SummaryAccount>[] = [
    {
      id: "account",
      header: t("health.col.account"),
      cell: row => (
        <>
          {row.account_alias} <span className="card-note">{row.platform}</span>
        </>
      ),
      sortValue: row => row.account_alias,
    },
    {
      id: "status",
      header: t("health.col.status"),
      cell: row => <StatusBadge status={row.status} reason={row.unavailable_reason} />,
      sortValue: row => row.status,
    },
    {
      id: "activity",
      header: t("health.activity"),
      cell: row => row.activity === "no_signal" ? t("state.no_signal") : row.activity || "—",
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
  return (
    <DataBlock status={summary.data.status}>
      <DataTable
        columns={columns}
        rows={summary.data.accounts}
        rowKey={row => `${row.platform}/${row.account_alias}`}
        defaultSort={{ column: "account", direction: "asc" }}
        caption={t("health.freshness_title")}
      />
    </DataBlock>
  );
}

function CredentialsCard({ credential }: { credential: Loadable<CredentialMaintenance> }) {
  const t = useT();
  const language = useLanguage();
  if (credential.phase === "loading") return <Skeleton height={72} />;
  if (credential.phase === "error") return <ErrorState onRetry={credential.reload} />;
  const item = credential.data;
  const columns: Column<CredentialMaintenance>[] = [
    { id: "id", header: t("health.col.credential"), cell: row => row.id },
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
        return t("health.credential_expires", { value: formatDateTime(row.expires_at, language).text });
      },
      sortValue: row => row.expires_at,
    },
  ];
  return <DataTable columns={columns} rows={[item]} rowKey={row => row.id} caption={t("health.credentials_title")} />;
}

interface NotificationItem {
  sent_at?: string | null;
  channel?: string | null;
  status?: string | null;
  summary?: string | null;
}

function NotificationsCard({ epoch }: { epoch: number }) {
  const t = useT();
  const language = useLanguage();
  const state = useApi(() => loadNotificationLog(), [epoch]);
  if (state.phase === "loading") return <Skeleton height={72} />;
  if (state.phase === "error") return <ErrorState onRetry={state.reload} />;
  const log = state.data;
  const items = (log.items ?? []) as unknown as NotificationItem[];
  if (log.status === "not_connected" || items.length === 0) {
    return (
      <EmptyState
        title={t("health.notifications_not_connected")}
        action={<StatusBadge status="not_connected" />}
      />
    );
  }
  const columns: Column<NotificationItem>[] = [
    {
      id: "sent_at",
      header: t("common.time"),
      cell: row => formatDateTime(row.sent_at ?? null, language).text,
      sortValue: row => row.sent_at ?? null,
    },
    { id: "channel", header: t("health.col.channel"), cell: row => row.channel || "—" },
    {
      id: "status",
      header: t("common.status"),
      cell: row => <StatusBadge status={row.status} />,
    },
    { id: "summary", header: t("health.col.summary"), cell: row => row.summary || "—" },
  ];
  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={row => `${row.sent_at ?? ""}/${row.channel ?? ""}/${row.summary ?? ""}`}
      caption={t("health.notifications_title")}
    />
  );
}

export default function HealthPage() {
  const t = useT();
  const [epoch, setEpoch] = useState(0);
  const summary = useApi(() => loadTodayRuns(), [epoch]);
  const credential = useApi(() => loadCredentialMaintenance(), [epoch]);
  const accounts = useApi(() => loadAccounts(), [epoch]);

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">{t("health.title")}</h1>
        <button type="button" className="button button-secondary health-refresh" onClick={() => setEpoch(value => value + 1)}>
          {t("common.refresh")}
        </button>
      </header>

      <StatStrip summary={summary} credential={credential} />

      <section className="card">
        <h2 className="card-title">{t("health.grid_title")}</h2>
        {accounts.phase === "loading" && <Skeleton height={160} />}
        {accounts.phase === "error" && <ErrorState onRetry={accounts.reload} />}
        {accounts.phase === "ready" && (
          <RunGrid
            accounts={accounts.data.accounts.map(account => ({
              account_alias: account.account_alias,
              platform: account.platform,
            }))}
            epoch={epoch}
          />
        )}
      </section>

      <section className="card">
        <h2 className="card-title">{t("health.freshness_title")}</h2>
        <FreshnessTable summary={summary} />
      </section>

      <section className="card">
        <h2 className="card-title">{t("health.credentials_title")}</h2>
        <CredentialsCard credential={credential} />
      </section>

      <section className="card">
        <h2 className="card-title">{t("health.notifications_title")}</h2>
        <NotificationsCard epoch={epoch} />
      </section>
    </div>
  );
}
