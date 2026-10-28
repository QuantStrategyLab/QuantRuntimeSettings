import { FreshnessSummary } from "../../components/CurrencyTotals";
import { useDisplayNames } from "../../lib/useDisplayNames";
import { useState } from "react";
import type { ReactNode } from "react";
import { usePrefs } from "../../app/context";
import { useLanguage, useT } from "../../i18n";
import { useApi } from "../../lib/hooks";
import type { AsyncState } from "../../lib/hooks";
import { formatQuantity, maskedAmount } from "../../lib/format";
import { loadPerformanceHoldings, loadPerformanceTrades } from "../../api/endpoints";
import type { ExecutionsResponse, HoldingsResponse, Range } from "../../api/contracts";
import { AsOfStamp, EmptyState, ErrorState, Money, Skeleton, StatusBadge } from "../../components/primitives";
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
  // Each field renders its own broker-reported value; a row that is only partial
  // (e.g. missing avg_cost) keeps its known quantity and market value. A row whose
  // status is not renderable shows no financial value even if numbers linger.
  const columns: Column<HoldingRow>[] = [
    { id: "account", header: t("perf.col.account"), cell: row => names.account(row.account_alias, row.platform), sortValue: row => row.account_alias },
    { id: "symbol", header: t("perf.col.symbol"), cell: row => <span className="holding-symbol">{row.symbol}</span>, sortValue: row => row.symbol },
    {
      id: "quantity",
      header: t("perf.col.quantity"),
      numeric: true,
      cell: row => (renderableStatus(row.status) ? <QuantityValue value={row.quantity} /> : "—"),
      sortValue: row => row.quantity,
    },
    {
      id: "market_value",
      header: `${t("perf.col.market_value")} (${t("perf.col.currency")})`,
      numeric: true,
      cell: row => (renderableStatus(row.status) ? <Money value={row.market_value} currency={row.currency} /> : "—"),
      sortValue: row => row.market_value,
    },
    {
      id: "avg_cost",
      header: t("perf.col.cost_basis"),
      numeric: true,
      cell: row => !renderableStatus(row.status) ? "—"
        : row.avg_cost !== null && Number.isFinite(row.avg_cost) ? <Money value={row.avg_cost} currency={row.currency} />
          : brokerCostOf(row) !== null ? <div className="holding-broker-cost"><DecimalText value={brokerCostOf(row)} currency={row.currency} /><small>{t("perf.broker_cost_label")}</small></div>
            : "—",
      sortValue: row => row.avg_cost,
    },
    {
      id: "unrealized_pnl",
      header: t("perf.col.unrealized_pnl"),
      numeric: true,
      cell: row => (renderableStatus(row.status) ? <Money value={row.unrealized_pnl} currency={row.currency} signed /> : "—"),
      sortValue: row => row.unrealized_pnl,
    },
    {
      id: "status",
      header: t("common.status"),
      cell: row => <div className="holding-status">
        {row.status !== "ok" && <StatusBadge status={row.status} reason={row.unavailable_reason} />}
        {renderableStatus(row.status) && ["quantity", "market_value", "avg_cost", "unrealized_pnl"].some(field => row[field as keyof HoldingRow] === null) && <small>{t("perf.fields_not_provided", { fields: (["quantity", "market_value", "avg_cost", "unrealized_pnl"] as const).filter(field => row[field] === null).map(field => t(field === "avg_cost" ? "perf.average_cost_field" : `perf.col.${field}`)).join(" / ") })}</small>}
      </div>,
    },
  ];
  const coverage = data.coverage;
  const coverageCount = Array.isArray(coverage) ? coverage.length
    : coverage && typeof coverage === "object" && Array.isArray(coverage.account_aliases) ? coverage.account_aliases.length
      : undefined;
  return (
    <div className="holdings-view" data-state={data.status} data-reason={data.unavailable_reason ?? undefined} data-coverage-count={coverageCount}>
      <p className="card-note" style={{ marginTop: 0 }}>
        {t(data.label_key)}
        {data.status !== "ok" && <> · <StatusBadge status={data.status} /></>}
      </p>
      {data.rows.some(row => renderableStatus(row.status) && [row.market_value, row.avg_cost, row.unrealized_pnl].some(value => value === null)) && <p className="card-note">{t("perf.holdings_missing_fields")}</p>}
      <p className="card-note holdings-scroll-hint">{t("perf.holdings_scroll_hint")}</p>
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

interface RankableHolding {
  row: HoldingRow;
  id: string;
  symbol: string;
  /** Null when the source did not provide a usable currency; such a row is never ranked. */
  currency: string | null;
  pnl: number;
  value: number;
}

interface CurrencyRanking {
  currency: string;
  winners: BarListItem[];
  losers: BarListItem[];
}

function rankableHolding(row: HoldingRow): RankableHolding | null {
  if (!renderableStatus(row.status)) return null;
  const { quantity, avg_cost, unrealized_pnl } = row;
  // Bars show P/L relative to cost basis; both inputs come from the same row, nothing is estimated.
  if (!Number.isFinite(unrealized_pnl) || !Number.isFinite(avg_cost) || !Number.isFinite(quantity)) return null;
  if (unrealized_pnl === null || avg_cost === null || quantity === null || !(avg_cost * quantity > 0)) return null;
  const currency = typeof row.currency === "string" && row.currency.trim() ? row.currency.trim() : null;
  return {
    row,
    id: `${row.platform}:${row.account_alias}|${row.symbol}`,
    symbol: row.symbol,
    currency,
    pnl: unrealized_pnl,
    value: (unrealized_pnl / (avg_cost * quantity)) * 100,
  };
}

/**
 * Rank native unrealized P/L inside each currency. Amounts are never compared
 * or converted across currencies; a row without a currency is excluded rather
 * than folded into a known one. Duplicate symbols stay distinguishable through
 * the caller-provided account label.
 */
function rankHoldingsByCurrency(
  rows: readonly HoldingRow[],
  accountLabel: (row: HoldingRow) => string,
): { groups: CurrencyRanking[]; rankedCount: number; missingCurrencyCount: number } {
  const rankable = rows.map(rankableHolding).filter((item): item is RankableHolding => item !== null);
  const missingCurrencyCount = rankable.filter(item => item.currency === null).length;
  const buckets = new Map<string, RankableHolding[]>();
  for (const item of rankable) {
    if (item.currency === null) continue;
    const bucket = buckets.get(item.currency);
    if (bucket) bucket.push(item);
    else buckets.set(item.currency, [item]);
  }
  const groups = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, items]): CurrencyRanking => {
      const toItem = (item: RankableHolding): BarListItem => ({
        id: item.id,
        label: `${item.symbol} · ${accountLabel(item.row)}`,
        value: item.value,
      });
      return {
        currency,
        winners: items.filter(item => item.pnl > 0).sort((a, b) => b.pnl - a.pnl).slice(0, RANKING_SIZE).map(toItem),
        losers: items.filter(item => item.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, RANKING_SIZE).map(toItem),
      };
    })
    .filter(group => group.winners.length > 0 || group.losers.length > 0);
  return { groups, rankedCount: rankable.length - missingCurrencyCount, missingCurrencyCount };
}

function RankingTab({ state }: { state: Api<HoldingsResponse> }) {
  const t = useT();
  const names = useDisplayNames();
  if (state.phase === "loading") return <Skeleton height={160} />;
  if (state.phase === "error") return <ErrorState onRetry={state.reload} />;
  const data = state.data;
  if (!renderableStatus(data.status)) {
    return <EmptyState title={t(`state.${data.status}`)} state={data.status} />;
  }
  const { groups, rankedCount, missingCurrencyCount } = rankHoldingsByCurrency(
    data.rows,
    row => names.account(row.account_alias, row.platform),
  );
  if (!groups.length) {
    const body = missingCurrencyCount > 0
      ? t("perf.ranking_missing_currency")
      : rankedCount > 0
        ? undefined
        : data.rows.length > 0
          ? t("perf.ranking_missing_fields")
          : data.unavailable_reason ? t(`reason.${data.unavailable_reason}`) : t("reason.positions_not_connected");
    return <EmptyState title={t(rankedCount > 0 ? "perf.ranking_no_movement" : "perf.ranking_unavailable")} body={body} />;
  }
  return (
    <div>
      {groups.map(group => (
        <section className="perf-ranking-currency" key={group.currency} data-currency={group.currency}>
          <h3 className="perf-ranking-heading perf-ranking-currency-heading">{group.currency}</h3>
          {group.winners.length > 0 && (
            <div className="perf-ranking-section">
              <h4 className="perf-ranking-heading">{t("perf.ranking_winners")}</h4>
              <BarList items={group.winners} />
            </div>
          )}
          {group.losers.length > 0 && (
            <div className="perf-ranking-section">
              <h4 className="perf-ranking-heading">{t("perf.ranking_losers")}</h4>
              <BarList items={group.losers} />
            </div>
          )}
        </section>
      ))}
      {missingCurrencyCount > 0 && <p className="card-note">{t("perf.ranking_missing_currency")}</p>}
      <p className="card-note">{t("perf.native_totals_note")}</p>
      <p className="card-note">{t("perf.ranking_note")}</p>
    </div>
  );
}

type ExecutionRow = ExecutionsResponse["rows"][number];

const DECIMAL_TEXT = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** A broker-setting-dependent cost is display evidence, never an average cost or ranking input. */
function brokerCostOf(row: HoldingRow): string | null {
  return row.platform === "longbridge" && row.broker_cost_method === "broker_configured"
    && typeof row.broker_cost_price === "string" && DECIMAL_TEXT.test(row.broker_cost_price)
    ? row.broker_cost_price : null;
}

/** Exact decimal-text rendering: group the integer part and keep every fraction digit. */
function formatDecimalText(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

/** Broker decimal strings never pass through Number; hideAmounts still masks them. */
function DecimalText({ value, currency }: { value: string | null; currency?: string | null }) {
  const { prefs } = usePrefs();
  // Validate first so an unknown value stays an em dash instead of a mask.
  if (typeof value !== "string" || !DECIMAL_TEXT.test(value)) return <span className="flat">—</span>;
  if (prefs.hideAmounts) return <span className="money">{maskedAmount(value)}</span>;
  return <span className="num" title={value}>{formatDecimalText(value)}{currency ? ` ${currency}` : ""}</span>;
}

function TradesTab({ scope, platform, range, epoch }: PerformanceTabsProps) {
  const t = useT();
  const names = useDisplayNames();
  const state = useApi(() => loadPerformanceTrades(scope, range, platform), [scope, platform, range, epoch]);
  if (state.phase === "loading") return <Skeleton height={48} />;
  if (state.phase === "error") return <ErrorState onRetry={state.reload} />;
  const data = state.data;
  // A payload without a rows array is a broken response, not an empty result:
  // keep the retry path so a read failure never looks like a successful empty list.
  if (!data || !Array.isArray(data.rows)) return <ErrorState onRetry={state.reload} />;
  const rows = data.rows;
  if (!rows.length && data.status === "not_connected") {
    return <EmptyState title={t("state.not_connected")} body={t("reason.fills_not_connected")} state="not_connected" />;
  }
  // Table and cards read the same rows in the same order; nothing is derived or recomputed.
  const ordered = [...rows].sort((a, b) => String(b.trade_date ?? "").localeCompare(String(a.trade_date ?? "")));
  const sideOf = (row: ExecutionRow) => row.side === "BUY" ? t("perf.side.buy")
    : row.side === "SELL" ? t("perf.side.sell") : "—";
  const columns: Column<ExecutionRow>[] = [
    {
      id: "trade_date",
      header: t("perf.col.date"),
      cell: row => <>
        {/* STK and the execution hash stay as debug attributes only, never as visible columns. */}
        <span className="num" data-asset-category={row.asset_category} data-execution-ref={row.execution_ref}>{row.trade_date}</span>
        {row.local_time && <small className="trade-time">{row.local_time.slice(11)}{row.time_zone ? ` · ${row.time_zone}` : ""}</small>}
      </>,
      sortValue: row => row.trade_date,
    },
    {
      id: "account",
      header: t("perf.col.account"),
      cell: row => <>
        {names.account(row.account_alias, row.platform)}
        <small className="trade-time">{names.platform(row.platform)}</small>
      </>,
      sortValue: row => `${row.platform}:${row.account_alias}`,
    },
    { id: "symbol", header: t("perf.col.symbol"), cell: row => row.symbol, sortValue: row => row.symbol },
    { id: "side", header: t("perf.col.side"), cell: sideOf },
    { id: "quantity", header: t("perf.col.quantity"), numeric: true, cell: row => <DecimalText value={row.quantity} /> },
    { id: "price", header: t("perf.col.price"), numeric: true, cell: row => <DecimalText value={row.price} currency={row.currency} /> },
    { id: "commission", header: t("perf.col.commission"), numeric: true, cell: row => <DecimalText value={row.commission} currency={row.commission_currency} /> },
    { id: "taxes", header: t("perf.col.taxes"), numeric: true, cell: row => <DecimalText value={row.taxes} currency={row.currency} /> },
  ];
  const count = data.reported_execution_count ?? rows.length;
  const emptyStatus = data.status === "partial" || data.status === "ok" ? "no_data" : data.status;
  const emptyBody = data.status === "partial"
    ? t("perf.executions_empty_partial")
    : data.status === "ok"
      ? undefined
      : data.unavailable_reason ? t(`reason.${data.unavailable_reason}`) : undefined;
  return <div className="trade-view" data-state={data.status} data-reason={data.unavailable_reason ?? undefined}>
    <div className="trade-summary">
      {count > 0 && <span className="card-note">{t("perf.executions_count", { count })}</span>}
      {data.status === "partial" && (
        <span className="state-short" title={t("perf.executions_partial")}>{t("perf.executions_partial_short")}</span>
      )}
      {data.as_of && <AsOfStamp value={data.as_of} />}
    </div>
    {ordered.length
      ? <>
          <div className="trade-table">
            <DataTable
              columns={columns}
              rows={ordered}
              rowKey={row => `${row.platform}:${row.account_alias}:${row.execution_ref}`}
              defaultSort={{ column: "trade_date", direction: "desc" }}
              caption={t("perf.trades_title")}
            />
          </div>
          <ul className="trade-cards" aria-label={t("perf.trades_title")}>
            {ordered.map(row => (
              <li
                key={`${row.platform}:${row.account_alias}:${row.execution_ref}`}
                className="trade-card"
                data-asset-category={row.asset_category}
                data-execution-ref={row.execution_ref}
              >
                <div className="trade-card-head">
                  <span className="trade-card-date num">{row.trade_date}</span>
                  <span className="trade-card-symbol">{row.symbol}</span>
                  <span className="trade-side">{sideOf(row)}</span>
                  {row.local_time && (
                    <span className="trade-card-time">{row.local_time.slice(11)}{row.time_zone ? ` · ${row.time_zone}` : ""}</span>
                  )}
                </div>
                <div className="trade-card-account">{names.account(row.account_alias, row.platform)}</div>
                <dl className="trade-card-figures">
                  <div className="trade-figure">
                    <dt>{t("perf.col.quantity")}</dt>
                    <dd><DecimalText value={row.quantity} /></dd>
                  </div>
                  <div className="trade-figure">
                    <dt>{t("perf.col.price")}</dt>
                    <dd><DecimalText value={row.price} currency={row.currency} /></dd>
                  </div>
                  <div className="trade-figure">
                    <dt>{t("perf.col.commission")}</dt>
                    <dd><DecimalText value={row.commission} currency={row.commission_currency} /></dd>
                  </div>
                  <div className="trade-figure">
                    <dt>{t("perf.col.taxes")}</dt>
                    <dd><DecimalText value={row.taxes} currency={row.currency} /></dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      : <EmptyState title={t(`state.${emptyStatus}`)} body={emptyBody} state={emptyStatus} />}
  </div>;
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
