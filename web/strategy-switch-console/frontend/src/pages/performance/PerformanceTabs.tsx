import { FreshnessSummary } from "../../components/CurrencyTotals";
import { useDisplayNames } from "../../lib/useDisplayNames";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLanguage, useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import type { AsyncState } from "../../lib/hooks";
import { formatQuantity } from "../../lib/format";
import { loadPerformanceHoldings, loadPerformanceTrades } from "../../api/endpoints";
import type { HoldingsResponse, Range } from "../../api/contracts";
import { EmptyState, ErrorState, Money, Skeleton, StatusBadge } from "../../components/primitives";
import { DataTable, type Column } from "../../components/DataTable";
import { Tabs } from "../../components/Tabs";
import { BarList, type BarListItem } from "../../charts/BarList";
import { renderableStatus } from "./shared";

export interface PerformanceTabsProps {
  scope: string;
  platform: string | undefined;
  range: Range;
  epoch: number;
}

type Api<T> = AsyncState<T> & { reload: () => void };

type HoldingRow = HoldingsResponse["rows"][number];

const RANKING_SIZE = 5;

function QuantityValue({ value }: { value: number | null }) {
  const language = useLanguage();
  return <span className="num">{formatQuantity(value, language)}</span>;
}

function HoldingsTab({ state }: { state: Api<HoldingsResponse> }) {
  const t = useT();
  const names = useDisplayNames();
  if (state.phase === "loading") {
    return (
      <div className="section-stack">
        <Skeleton height={32} />
        <Skeleton height={32} />
        <Skeleton height={32} />
      </div>
    );
  }
  if (state.phase === "error") return <ErrorState onRetry={state.reload} />;
  const data = state.data;
  if (!renderableStatus(data.status)) {
    return <EmptyState title={t(`state.${data.status}`)} state={data.status} />;
  }
  const columns: Column<HoldingRow>[] = [
    { id: "account", header: t("perf.col.account"), cell: row => names.account(row.account_alias, row.platform), sortValue: row => row.account_alias },
    { id: "symbol", header: t("perf.col.symbol"), cell: row => row.symbol, sortValue: row => row.symbol },
    {
      id: "quantity",
      header: t("perf.col.quantity"),
      numeric: true,
      cell: row => (row.status !== "ok" ? "—" : <QuantityValue value={row.quantity} />),
      sortValue: row => row.quantity,
    },
    {
      id: "market_value",
      header: `${t("perf.col.market_value")} (${t("perf.col.currency")})`,
      numeric: true,
      cell: row => (row.status !== "ok" ? "—" : <Money value={row.market_value} currency={row.currency} />),
      sortValue: row => row.market_value,
    },
    {
      id: "avg_cost",
      header: t("perf.col.avg_cost"),
      numeric: true,
      cell: row => (row.status !== "ok" ? "—" : <Money value={row.avg_cost} currency={row.currency} />),
      sortValue: row => row.avg_cost,
    },
    {
      id: "unrealized_pnl",
      header: t("perf.col.unrealized_pnl"),
      numeric: true,
      cell: row => (row.status !== "ok" ? "—" : <Money value={row.unrealized_pnl} currency={row.currency} signed />),
      sortValue: row => row.unrealized_pnl,
    },
    {
      id: "status",
      header: t("common.status"),
      cell: row => (row.status !== "ok" ? <StatusBadge status={row.status} reason={row.unavailable_reason} /> : null),
    },
  ];
  const coverage = data.coverage;
  const coverageCount = Array.isArray(coverage) ? coverage.length
    : coverage && typeof coverage === "object" && Array.isArray(coverage.account_aliases) ? coverage.account_aliases.length
      : undefined;
  return (
    <div data-state={data.status} data-reason={data.unavailable_reason ?? undefined} data-coverage-count={coverageCount}>
      <p className="card-note" style={{ marginTop: 0 }}>
        {t(data.label_key)}
        {data.status !== "ok" && <> · <StatusBadge status={data.status} /></>}
      </p>
      <DataTable
        columns={columns}
        rows={data.rows}
        rowKey={row => `${row.platform}:${row.account_alias}|${row.symbol}`}
        defaultSort={{ column: "market_value", direction: "desc" }}
        caption={t("perf.holdings_title")}
      />
    </div>
  );
}

function RankingTab({ state }: { state: Api<HoldingsResponse> }) {
  const t = useT();
  const { winners, losers } = useMemo(() => {
    if (state.phase !== "ready" || !renderableStatus(state.data.status)) return { winners: [], losers: [] };
    // Bars show P/L relative to cost basis; both inputs come from the same row, nothing is estimated.
    const ranked = state.data.rows
      .filter(row => row.unrealized_pnl !== null && row.avg_cost !== null && row.quantity !== null && row.avg_cost * row.quantity > 0)
      .map(row => ({
        id: `${row.platform}:${row.account_alias}|${row.symbol}`,
        label: row.symbol,
        pnl: row.unrealized_pnl!,
        value: (row.unrealized_pnl! / (row.avg_cost! * row.quantity!)) * 100,
      }));
    const winners = ranked
      .filter(item => item.pnl > 0)
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, RANKING_SIZE)
      .map(({ id, label, value }): BarListItem => ({ id, label, value }));
    const losers = ranked
      .filter(item => item.pnl < 0)
      .sort((a, b) => a.pnl - b.pnl)
      .slice(0, RANKING_SIZE)
      .map(({ id, label, value }): BarListItem => ({ id, label, value }));
    return { winners, losers };
  }, [state]);

  if (state.phase === "loading") return <Skeleton height={160} />;
  if (state.phase === "error") return <ErrorState onRetry={state.reload} />;
  if (!renderableStatus(state.data.status)) {
    return <EmptyState title={t(`state.${state.data.status}`)} state={state.data.status} />;
  }
  if (!winners.length && !losers.length) return <EmptyState title={t("state.no_data")} />;
  return (
    <div>
      {winners.length > 0 && (
        <div className="perf-ranking-section">
          <h3 className="perf-ranking-heading">{t("perf.ranking_winners")}</h3>
          <BarList items={winners} />
        </div>
      )}
      {losers.length > 0 && (
        <div className="perf-ranking-section">
          <h3 className="perf-ranking-heading">{t("perf.ranking_losers")}</h3>
          <BarList items={losers} />
        </div>
      )}
      <p className="card-note">{t("perf.ranking_note")}</p>
    </div>
  );
}

function TradesTab({ scope, platform, range, epoch }: PerformanceTabsProps) {
  const t = useT();
  const state = useApi(() => loadPerformanceTrades(scope, range, platform), [scope, platform, range, epoch]);
  if (state.phase === "loading") return <Skeleton height={48} />;
  if (state.phase === "error") return <ErrorState onRetry={state.reload} />;
  const data = state.data;
  if (data.status === "not_connected") {
    return <EmptyState title={t("state.not_connected")} state="not_connected" />;
  }
  // No fills reader exists: never manufacture zero trades or a performance statistic.
  // A successful but empty read is no data, not a "normal" trades state.
  const stateKey = data.status === "ok" ? "no_data" : data.status;
  return <EmptyState title={t(`state.${stateKey}`)} state={stateKey} />;
}

export function PerformanceTabs({ scope, platform, range, epoch }: PerformanceTabsProps) {
  const t = useT();
  const [tab, setTab] = useState("holdings");
  const holdings = useApi(() => loadPerformanceHoldings(scope, range, platform), [scope, platform, range, epoch]);

  let body: ReactNode;
  if (tab === "holdings") body = <HoldingsTab state={holdings} />;
  else if (tab === "ranking") body = <RankingTab state={holdings} />;
  else body = <TradesTab scope={scope} platform={platform} range={range} epoch={epoch} />;

  return (
    <div className="card">
      <Tabs
        id="performance"
        items={[
          { id: "holdings", label: t("perf.holdings_title") },
          { id: "ranking", label: t("perf.ranking_title") },
          { id: "trades", label: t("perf.trades_title") },
        ]}
        active={tab}
        onChange={setTab}
        ariaLabel={t("nav.performance")}
      />
      <div id="performance-panel" className="perf-tab-body" role="tabpanel" aria-labelledby={`performance-tab-${tab}`} tabIndex={0}>
        {tab !== "trades" && holdings.phase === "ready" && <p className="card-note">
          <FreshnessSummary counts={holdings.data.freshness_summary} />
        </p>}
        {body}
      </div>
    </div>
  );
}
