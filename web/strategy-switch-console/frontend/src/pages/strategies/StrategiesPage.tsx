import { accountKey } from "../../lib/accountDirectory";
import { useDisplayNames } from "../../lib/useDisplayNames";
import { useState } from "react";
import { getJson } from "../../api/client";
import { loadStrategySummary } from "../../api/endpoints";
import type { M0ResearchDashboard, StrategySummary } from "../../api/contracts";
import { useNavigate } from "../../app/context";
import { useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { AsOfStamp, Badge, EmptyState, ErrorState, Skeleton, StatusBadge } from "../../components/primitives";
import { Tabs } from "../../components/Tabs";
import "./strategies.css";

type Strategy = StrategySummary["strategies"][number];
type StrategiesTab = "catalog" | "research";

function AccountAliases({ accounts }: { accounts: Strategy["configured_accounts"] }) {
  const t = useT();
  const names = useDisplayNames();
  const navigate = useNavigate();
  if (accounts.length === 0) return <>{t("common.none")}</>;
  return (
    <span className="strategy-accounts">
      {accounts.map(account => (
        <button
          key={accountKey(account)}
          type="button"
          className="strategy-account-link" title={accountKey(account)}
          onClick={() => navigate({ page: "accounts", account: accountKey(account) })}
        >
          {names.platform(account.platform)} · {names.account(account.account_alias, account.platform)}
        </button>
      ))}
    </span>
  );
}

function HealthValue({ strategy }: { strategy: Strategy }) {
  const t = useT();
  return (
    <>
      <StatusBadge status={strategy.health_status} />
      {strategy.health_score !== null && (
        <span className="num">{t("strategies.health_score", { value: strategy.health_score })}</span>
      )}
    </>
  );
}

function AccountExecution({ accounts }: { accounts: Strategy["configured_accounts"] }) {
  const t = useT();
  const names = useDisplayNames();
  if (accounts.length === 0) return null;
  const hasLiveTarget = accounts.some(account => account.execution_mode === "live");
  return (
    <div className="strategy-execution">
      <div className="strategy-execution-title">{t("strategies.account_execution")}</div>
      {accounts.map(account => {
        const live = account.execution_mode === "live" && account.live_status === "configured_live";
        const key = live ? account.continuation_reason === "legacy_live_continuation" ? "legacy_live" : "live"
          : account.execution_mode === "live" ? "live_unknown"
          : account.execution_mode === "paper" || account.execution_mode === "dry_run" ? account.execution_mode : "unknown";
        return (
          <div className="strategy-execution-account" key={accountKey(account)}>
            <span>{names.platform(account.platform)} · {names.account(account.account_alias, account.platform)}</span>
            <Badge tone={account.execution_mode === "live" ? "warn" : "unknown"}>{t(`strategies.execution.${key}`)}</Badge>
          </div>
        );
      })}
      {hasLiveTarget && <p className="strategy-execution-note">{t("strategies.live_exposure")}</p>}
      <p className="strategy-execution-note">{t("strategies.execution_source")}</p>
    </div>
  );
}

function StrategyCard({ strategy, summaryAsOf }: { strategy: Strategy; summaryAsOf: string | null }) {
  const t = useT();
  const names = useDisplayNames();
  const modes = strategy.allowed_execution_modes.length > 0 ? strategy.allowed_execution_modes.map(names.lane).join(" · ") : t("common.na");
  const accountNames = strategy.configured_accounts.length > 0
    ? strategy.configured_accounts.map(account => `${names.platform(account.platform)} · ${names.account(account.account_alias, account.platform)}`).join(" · ")
    : t("common.none");
  return (
    <article className="card strategy-card">
      <div className="strategy-card-head">
        <h3 className="strategy-card-title">{names.strategy(strategy.profile)}</h3>
        <StatusBadge status={strategy.health_status} />
      </div>
      <dl className="strategy-rows">
        <div className="strategy-row">
          <dt>{t("strategies.domain")}</dt>
          <dd>{names.domain(strategy.domain)}</dd>
        </div>
        <div className="strategy-row">
          <dt>{t("strategies.modes")}</dt>
          <dd>{modes}</dd>
        </div>
        <div className="strategy-row">
          <dt>{t("strategies.accounts_using")}</dt>
          <dd><AccountAliases accounts={strategy.configured_accounts} /></dd>
        </div>
        <div className="strategy-row">
          <dt>{t("strategies.health")}</dt>
          <dd><HealthValue strategy={strategy} /></dd>
        </div>
      </dl>
      <AccountExecution accounts={strategy.configured_accounts} />
      {strategy.status !== "ok" && (
        <div className="strategy-card-foot">
          <StatusBadge status={strategy.status} reason={strategy.unavailable_reason} />
        </div>
      )}
      <details className="strategy-details">
        <summary>{t("strategies.details")}</summary>
        <div className="strategy-details-body">
          <dl className="strategy-rows">
            <div className="strategy-row">
              <dt>{t("strategies.modes")}</dt>
              <dd>{modes}</dd>
            </div>
            <div className="strategy-row">
              <dt>{t("strategies.accounts_using")}</dt>
              <dd>{accountNames}</dd>
            </div>
            <div className="strategy-row">
              <dt>{t("strategies.health")}</dt>
              <dd><HealthValue strategy={strategy} /></dd>
            </div>
          </dl>
          <AsOfStamp value={summaryAsOf} />
        </div>
      </details>
    </article>
  );
}

function CatalogTab({ refreshEpoch }: { refreshEpoch: number }) {
  const t = useT();
  const state = useApi(loadStrategySummary, [refreshEpoch]);
  if (state.phase === "loading") {
    return (
      <div className="strategy-grid" aria-busy="true">
        {[0, 1, 2].map(index => (
          <div className="card strategy-card" key={index}>
            <Skeleton height={18} width="55%" />
            <Skeleton height={12} />
            <Skeleton height={12} />
            <Skeleton height={12} width="70%" />
          </div>
        ))}
      </div>
    );
  }
  if (state.phase === "error") return <ErrorState onRetry={state.reload} />;
  const summary = state.data;
  if (summary.status === "read_failed") return <ErrorState onRetry={state.reload} />;
  if (summary.strategies.length === 0) {
    if (summary.status === "not_connected") {
      return <EmptyState title={t("state.not_connected")} body={t("reason.strategy_health_not_connected")} />;
    }
    return <EmptyState title={t("strategies.empty")} />;
  }
  return (
    <section className="section-stack">
      <div className="catalog-meta">
        {summary.status !== "ok" && <StatusBadge status={summary.status} />}
        <AsOfStamp value={summary.as_of} />
      </div>
      <div className="strategy-grid">
        {summary.strategies.map(strategy => (
          <StrategyCard key={strategy.profile} strategy={strategy} summaryAsOf={summary.as_of} />
        ))}
      </div>
    </section>
  );
}

/* ---------- M0 research dashboard (read-only) ---------- */

type ResearchLeads =
  | { status: "read_failed" }
  | { status: "unavailable" }
  | { status: "ready" | "stale"; dashboard: M0ResearchDashboard };

function parseResearchLeads(payload: unknown): ResearchLeads {
  if (!payload || typeof payload !== "object") return { status: "read_failed" };
  const data = payload as M0ResearchDashboard;
  if (data.schema_version !== "qsl_m0_research_dashboard.v1"
    || !["ready", "stale", "unavailable"].includes(data.data_status)
    || !Array.isArray(data.subjects) || !Array.isArray(data.errors)) return { status: "read_failed" };
  if (data.errors.some(error => typeof error !== "string" || /failed|unreadable|invalid/.test(error))) {
    return { status: "read_failed" };
  }
  if (data.data_status === "unavailable") return { status: "unavailable" };
  // Check the fields rendered below; malformed input must not become a successful empty view.
  if (!data.subjects.every(entry => entry?.subject && typeof entry.subject.identifier === "string"
    && Array.isArray(entry.observations) && entry.observations.every(observation =>
      observation && Array.isArray(observation.source_ids) && observation.source_ids.every(id => typeof id === "string")
      && typeof observation.generated_at === "string" && typeof observation.expires_at === "string"
      && typeof observation.as_of === "string" && typeof observation.research_context?.state === "string"
      && typeof observation.freshness?.status === "string"))) return { status: "read_failed" };
  return { status: data.data_status, dashboard: data };
}

async function loadResearchLeads(): Promise<ResearchLeads> {
  return parseResearchLeads(await getJson<unknown>("/api/m0-research"));
}

function ResearchTab({ refreshEpoch }: { refreshEpoch: number }) {
  const t = useT();
  const state = useApi(loadResearchLeads, [refreshEpoch]);
  if (state.phase === "loading") {
    return (
      <div className="section-stack" aria-busy="true">
        <Skeleton height={72} />
        <Skeleton height={72} />
      </div>
    );
  }
  if (state.phase === "error" || state.data.status === "read_failed") {
    return <ErrorState onRetry={state.reload} />;
  }
  if (state.data.status === "unavailable") {
    return <EmptyState title={t("strategies.research_unavailable")} />;
  }
  const dashboard = state.data.dashboard;
  if (dashboard.subjects.length === 0) return <EmptyState title={t("strategies.research_empty")} />;
  return (
    <section className="section-stack">
      <div className="catalog-meta">
        <Badge tone="accent">{t("strategies.research_only")}</Badge>
        {state.data.status === "stale" && <StatusBadge status="stale" />}
        <AsOfStamp value={dashboard.source_generated_at} />
      </div>
      <div className="research-list">
        {dashboard.subjects.map((entry, index) => (
          <article className="card research-item" key={`${entry.subject.kind}/${entry.subject.identifier}/${index}`}>
            <div className="research-item-head">
              <span className="research-item-title">{entry.subject.identifier}</span>
              <Badge tone="accent">{t("strategies.research_only")}</Badge>
            </div>
            {entry.observations.map((observation, observationIndex) => (
              <div className="section-stack" key={observationIndex}>
                <div className="catalog-meta">
                  <StatusBadge status={observation.freshness.status} />
                  <Badge tone="accent">{t(`research.state.${observation.research_context.state}`)}</Badge>
                </div>
                <p className="research-item-summary">{t("strategies.research_sources", { value: observation.source_ids.join(" · ") || t("common.unknown") })}</p>
                <p className="research-item-summary">{t("strategies.research_as_of", { value: observation.as_of })}</p>
                <AsOfStamp value={observation.generated_at} />
                <AsOfStamp value={observation.expires_at} prefix="strategies.research_expires" />
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}

export default function StrategiesPage() {
  const t = useT();
  const [tab, setTab] = useState<StrategiesTab>("catalog");
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">{t("strategies.title")}</h1>
        <span className="page-header-spacer" />
        <button
          type="button"
          className="button button-secondary button-sm"
          onClick={() => setRefreshEpoch(value => value + 1)}
        >
          {t("common.refresh")}
        </button>
      </header>
      <Tabs
        id="strategies"
        items={[
          { id: "catalog", label: t("strategies.tab.catalog") },
          { id: "research", label: t("strategies.tab.research") },
        ]}
        active={tab}
        onChange={id => setTab(id as StrategiesTab)}
        ariaLabel={t("strategies.title")}
      />
      <div id="strategies-panel" role="tabpanel" aria-labelledby={`strategies-tab-${tab}`} tabIndex={0}>
        {tab === "catalog" ? <CatalogTab refreshEpoch={refreshEpoch} /> : <ResearchTab refreshEpoch={refreshEpoch} />}
      </div>
    </div>
  );
}
