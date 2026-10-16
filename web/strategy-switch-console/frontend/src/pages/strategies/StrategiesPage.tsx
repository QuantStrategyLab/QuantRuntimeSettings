import { accountName, strategyName } from "../../lib/displayNames";
import { useState } from "react";
import { getJson } from "../../api/client";
import { loadStrategySummary } from "../../api/endpoints";
import type { StrategySummary } from "../../api/contracts";
import { useNavigate } from "../../app/context";
import { useT, useLanguage, type Translate } from "../../i18n";
import { useApi } from "../../lib/hooks";
import { AsOfStamp, Badge, EmptyState, ErrorState, Skeleton, StatusBadge } from "../../components/primitives";
import { Tabs } from "../../components/Tabs";
import "./strategies.css";

type Strategy = StrategySummary["strategies"][number];
type StrategiesTab = "catalog" | "research";

const KNOWN_STATES = new Set(["healthy", "ok", "partial", "stale", "no_data", "not_connected", "unavailable", "read_failed"]);

/** Map free-form status strings to a renderable state key; anything unrecognized becomes "unknown". */
function knownState(status: string | null | undefined): string {
  return status && KNOWN_STATES.has(status) ? status : "unknown";
}

/** Only pass reasons that exist in the dictionary; otherwise the raw key would leak into the tooltip. */
function knownReason(t: Translate, reason: string | null | undefined): string | null {
  if (!reason) return null;
  const key = `reason.${reason}`;
  return t(key) === key ? null : reason;
}

function AccountAliases({ accounts }: { accounts: Strategy["configured_accounts"] }) {
  const t = useT();
  const navigate = useNavigate();
  if (accounts.length === 0) return <>{t("common.none")}</>;
  return (
    <span className="strategy-accounts">
      {accounts.map(account => (
        <button
          key={account.account_alias}
          type="button"
          className="strategy-account-link"
          onClick={() => navigate({ page: "accounts", account: account.account_alias })}
        >
          {accountName(account.account_alias, account.platform)}
        </button>
      ))}
    </span>
  );
}

function HealthValue({ strategy }: { strategy: Strategy }) {
  const t = useT();
  return (
    <>
      <StatusBadge status={knownState(strategy.health_status)} />
      {strategy.health_score !== null && (
        <span className="num">{t("strategies.health_score", { value: strategy.health_score })}</span>
      )}
    </>
  );
}

function StrategyCard({ strategy, summaryAsOf }: { strategy: Strategy; summaryAsOf: string | null }) {
  const t = useT();
  const language = useLanguage();
  const reason = knownReason(t, strategy.unavailable_reason);
  const modes = strategy.allowed_execution_modes.length > 0 ? strategy.allowed_execution_modes.join(" · ") : t("common.na");
  const accountNames = strategy.configured_accounts.length > 0
    ? strategy.configured_accounts.map(account => accountName(account.account_alias, account.platform)).join(" · ")
    : t("common.none");
  return (
    <article className="card strategy-card">
      <div className="strategy-card-head">
        <h3 className="strategy-card-title">{strategyName(strategy.profile, language)}</h3>
        <StatusBadge status={knownState(strategy.health_status)} />
      </div>
      <dl className="strategy-rows">
        <div className="strategy-row">
          <dt>{t("strategies.domain")}</dt>
          <dd>{strategy.domain}</dd>
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
      {strategy.status !== "ok" && (
        <div className="strategy-card-foot">
          <StatusBadge status={strategy.status} reason={reason} />
        </div>
      )}
      <details className="strategy-details">
        <summary>{t("strategies.params_summary")}</summary>
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

/* ---------- research leads (legacy read-only endpoint) ---------- */

interface ResearchLead {
  title: string | null;
  summary: string | null;
  status: string | null;
}

interface ResearchLeads {
  connected: boolean;
  items: ResearchLead[];
}

const RESEARCH_LIST_KEYS = ["items", "records", "entries"] as const;

function pickString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function toResearchLead(value: unknown): ResearchLead | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const lead: ResearchLead = {
    title: pickString(record, ["title", "name"]),
    summary: pickString(record, ["summary", "description"]),
    status: pickString(record, ["status", "state"]),
  };
  return lead.title || lead.summary ? lead : null;
}

function parseResearchLeads(payload: unknown): ResearchLeads {
  if (typeof payload !== "object" || payload === null) return { connected: false, items: [] };
  const record = payload as Record<string, unknown>;
  if (record.ok === false || typeof record.error === "string") return { connected: false, items: [] };
  if (typeof record.status === "string" && record.status !== "ok") return { connected: false, items: [] };
  for (const key of RESEARCH_LIST_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) {
      return { connected: true, items: value.map(toResearchLead).filter((lead): lead is ResearchLead => lead !== null) };
    }
  }
  return { connected: false, items: [] };
}

/** Legacy read: any HTTP error or unrecognized shape is reported as not connected. */
async function loadResearchLeads(): Promise<ResearchLeads> {
  try {
    return parseResearchLeads(await getJson<unknown>("/api/m0-research"));
  } catch {
    return { connected: false, items: [] };
  }
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
  if (state.phase === "error" || !state.data.connected) {
    return <EmptyState title={t("strategies.research_not_connected")} />;
  }
  const leads = state.data.items;
  if (leads.length === 0) return <EmptyState title={t("strategies.research_empty")} />;
  return (
    <div className="research-list">
      {leads.map((lead, index) => (
        <article className="card research-item" key={index}>
          <div className="research-item-head">
            <span className="research-item-title">{lead.title || t("common.unknown")}</span>
            <Badge tone="accent">{t("strategies.research_only")}</Badge>
          </div>
          {lead.summary && <p className="research-item-summary">{lead.summary}</p>}
          {lead.status && KNOWN_STATES.has(lead.status) && (
            <div>
              <StatusBadge status={lead.status} />
            </div>
          )}
        </article>
      ))}
    </div>
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
        items={[
          { id: "catalog", label: t("strategies.tab.catalog") },
          { id: "research", label: t("strategies.tab.research") },
        ]}
        active={tab}
        onChange={id => setTab(id as StrategiesTab)}
        ariaLabel={t("strategies.title")}
      />
      {tab === "catalog" ? <CatalogTab refreshEpoch={refreshEpoch} /> : <ResearchTab refreshEpoch={refreshEpoch} />}
    </div>
  );
}
