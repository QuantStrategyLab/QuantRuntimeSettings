import { useEffect, useRef, useState } from "react";
import { loadAccountFactsHistory, loadBinanceWalletHistory, loadRuntimeDaily } from "./api";
import type { LifecycleRecord } from "./api";
import { useT, useLocale } from "./locales";
import { statusTone } from "./statusTone";
import {
  CHART_RANGE_OPTIONS,
  DEFAULT_CHART_RANGE,
  buildAssetChartGeometry,
  buildBinanceWalletHistoryChartGeometry,
  formatBinanceNativeQuantity,
  formatBinanceWalletAmount,
  chartRangeEmptyNote,
  chartUnavailable,
  filterAssetHistoryByRange,
  formatOverviewInstant,
  formatOverviewShortInstant,
  accountNativeReadout,
  overviewRuntimeHealth,
  runtimeDeploymentReadout,
  brokerAccountType,
  RETURN_INDEX_LEGEND,
  presentRuntimeDaily,
  runtimeDailySelectionEligible,
  runtimeDailySnapshotMatchesSelection,
  runtimeDateBounds,
  runtimeDateSelectable,
  presentBinanceWalletValuation,
  presentBinanceWalletValuationForAccount,
  binanceWalletStatusDetail,
  presentBinancePrivateScope,
  scheduleBinancePrivateScopeExpiry,
  type ChartMode,
  type ChartRange,
  type RuntimeDailySnapshot,
  type RuntimeDailyBinding,
} from "./presentation";
import {
  cashFieldForPlatform,
  verifiedCurrentAccountAssets,
  accountFactsDetail,
  accountFactsDisplayReady,
  accountFactsForDisplay,
  accountFactsUpdatedAt,
  binanceProviderProductTypeForDisplay,
  formatAccountFactAmounts,
  hasNonzeroNegativeAccountFactAmount,
  longBridgeCashDetails,
  longBridgeFinancingDetails,
  longBridgeRiskLevelLabel,
  summarizeCurrentAccountFacts,
  type AccountFactsAccount,
  type AccountFactsHistorySnapshot,
  type AccountFactsSnapshot,
  type BinanceWalletHistorySnapshot,
} from "./types";

export type OverviewAccount = {
  id: string;
  platformKey: string;
  accountKey: string;
  runtimeDailyBinding: RuntimeDailyBinding;
  title: string;
  platform: string;
  environment: string;
  brokerEnvironment: string | null;
  environmentSource: string;
  strategy: string;
  statusLabel: string;
  statusDetail: string;
  activation: string;
  runtimeTargetEnabled?: boolean | null;
  preference: string | null;
  facts: AccountFactsAccount | null;
  runtime?: LifecycleRecord | null;
};

type RuntimeDailyRequestState = { value: RuntimeDailySnapshot | null; error: string | null; loading: boolean };

function runtimeDailyRequestKey(platform: string, accountKey: string, binding: RuntimeDailyBinding, date: string): string {
  return JSON.stringify([platform, accountKey, binding, date]);
}

function amountOrDash(value: string | null | undefined): string {
  return value && value.length ? value : "—";
}

function BinanceQuantity({ amount, originalLabel }: { amount: string; originalLabel: string }) {
  const display = formatBinanceNativeQuantity(amount);
  return <details className="overview-wallet-quantity">
    <summary title={amount} aria-label={`${display}; ${originalLabel} ${amount}`}>{display}</summary>
    <span><em>{originalLabel}</em>{amount}</span>
  </details>;
}

function BinanceWalletDetails({
  summary, scope, amount, currency, observedAt, formattedObservedAt, scopeLabel, valueLabel, timeLabel,
}: {
  summary: string;
  scope: string;
  amount?: string;
  currency?: string;
  observedAt: string;
  formattedObservedAt: string | null;
  scopeLabel: string;
  valueLabel: string;
  timeLabel: string;
}) {
  return <details className="overview-wallet-details">
    <summary>{summary}</summary>
    <dl>
      <div><dt>{scopeLabel}</dt><dd>{scope}</dd></div>
      {amount !== undefined ? <div><dt>{valueLabel}</dt><dd><code>{amount}{currency ? ` ${currency}` : ""}</code></dd></div> : null}
      <div><dt>{timeLabel}</dt><dd>
        {formattedObservedAt ? <time dateTime={observedAt}>{formattedObservedAt}</time> : null}
        <code>{observedAt}</code>
      </dd></div>
    </dl>
  </details>;
}

function cashLabelForPlatform(platform: string): "现金余额" | "可用现金" {
  return cashFieldForPlatform(platform) === "cash_balance" ? "现金余额" : "可用现金";
}

function negativeCashStatusForPlatform(platform: string): "现金余额为负，融资状态待确认" | "可用现金为负，融资状态待确认" {
  return cashFieldForPlatform(platform) === "cash_balance"
    ? "现金余额为负，融资状态待确认"
    : "可用现金为负，融资状态待确认";
}

const CHART_MODES: Array<{ id: ChartMode; label: "收益率" | "总资产" }> = [
  { id: "return", label: "收益率" },
  { id: "assets", label: "总资产" },
];

export function OverviewPage({ accounts, accountFacts, accountOptionsRevision, onOpenAccount, isAdmin, privateScope, binanceFacts, readModelRefreshVersion = 0 }: {
  accounts: OverviewAccount[];
  accountFacts?: AccountFactsSnapshot | null;
  accountOptionsRevision?: number | null;
  isAdmin?: boolean;
  privateScope?: { value: Record<string, any> | null; error: string | null } | null;
  binanceFacts?: { value: Record<string, any> | null; error: string | null } | null;
  readModelRefreshVersion?: number;
  onOpenAccount: (id: string) => void;
}) {
  const t = useT();
  const language = useLocale();
  const formatInstant = (value: string | null | undefined) => formatOverviewInstant(value, language);
  const formatShortInstant = (value: string | null | undefined) => formatOverviewShortInstant(value, language);
  const [accountId, setAccountId] = useState("all");
  const [walletNow, setWalletNow] = useState(() => Date.now());
  const wallet = binanceFacts?.error ? null : binanceFacts?.value?.report;
  const walletAccount = wallet ? accounts.find(account => account.platformKey === "binance" && account.accountKey === wallet.account_key) : null;
  const showWallet = Boolean(walletAccount && (accountId === "all" || accountId === walletAccount.id)
    && walletNow - Date.parse(wallet.observed_finished_at) <= 36 * 60 * 60 * 1000
    && walletNow - Date.parse(wallet.observed_finished_at) >= -60_000);
  const walletValuation = showWallet ? presentBinanceWalletValuation(wallet, walletNow) : null;
  useEffect(() => {
    setWalletNow(Date.now());
    const now = Date.now();
    const updateWalletNow = () => setWalletNow(Date.now());
    const cancelReportExpiry = scheduleBinancePrivateScopeExpiry(wallet?.observed_finished_at,
      updateWalletNow, now, window, 36 * 60 * 60 * 1000);
    const cancelValuationExpiry = scheduleBinancePrivateScopeExpiry(walletValuation?.observed_at,
      updateWalletNow, now, window, 36 * 60 * 60 * 1000);
    return () => {
      cancelReportExpiry();
      cancelValuationExpiry();
    };
  }, [wallet?.observed_finished_at, walletValuation?.observed_at]);
  const [chart, setChart] = useState<ChartMode>("assets");
  const [range, setRange] = useState<ChartRange>(DEFAULT_CHART_RANGE);
  const [currencyChoice, setCurrencyChoice] = useState({ accountId: "", value: "" });
  const [historyKey, setHistoryKey] = useState("");
  const [history, setHistory] = useState<AccountFactsHistorySnapshot | null>(null);
  const [walletHistory, setWalletHistory] = useState<BinanceWalletHistorySnapshot | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [benchmarkFrameWidth, setBenchmarkFrameWidth] = useState(0);
  const [benchmarkExpanded, setBenchmarkExpanded] = useState(false);
  const benchmarkFrameContainer = useRef<HTMLDivElement | null>(null);
  const [runtimeNow, setRuntimeNow] = useState(() => Date.now());
  const factsNow = Math.max(runtimeNow, Date.now());
  const displayAccounts = accounts.map(account => ({ ...account, facts: accountFactsForDisplay(account.facts, factsNow) || null }));
  const currentFactRows = displayAccounts.map(account => ({
    id: account.id,
    platform: account.platformKey,
    brokerEnvironment: account.brokerEnvironment,
    facts: account.facts,
    walletValuation: account.id === walletAccount?.id ? walletValuation : null,
  }));
  const currentFactsSummary = summarizeCurrentAccountFacts(currentFactRows);
  const verifiedAssets = verifiedCurrentAccountAssets(accountFacts, currentFactRows, factsNow, accountOptionsRevision);
  const runtimeBounds = runtimeDateBounds(runtimeNow);
  const runtimeToday = runtimeBounds.max;
  const runtimeDateLabel = "业务日期（纽约业务日，America/New_York）";
  const [selectedRuntimeDate, setSelectedRuntimeDate] = useState<string | null>(null);
  const runtimeDate = selectedRuntimeDate || runtimeToday;
  const [runtimeDaily, setRuntimeDaily] = useState<Record<string, RuntimeDailyRequestState>>({});
  const [privateScopeNow, setPrivateScopeNow] = useState(() => Date.now());
  const historyEpoch = useRef(0);
  const emptyNote = chartRangeEmptyNote(range);
  const visible = accountId === "all" ? displayAccounts : displayAccounts.filter(account => account.id === accountId);
  const visibleFactsSummary = summarizeCurrentAccountFacts(visible.map(account => ({
    id: account.id,
    platform: account.platformKey,
    brokerEnvironment: account.brokerEnvironment,
    facts: account.facts,
    walletValuation: account.id === walletAccount?.id ? walletValuation : null,
  })), accountId !== "all");
  const optionLabel = (account: OverviewAccount) => {
    const duplicates = accounts.filter(item => item.title === account.title);
    if (duplicates.length < 2 || !account.environment) return account.title;
    return `${account.title} · ${account.environment}`;
  };
  const activationText = (label: string) => label === "已启用" || label === "已停用" ? label : "待确认";
  const selectedAccount = accountId === "all" ? null : (visible[0] || null);
  const selectedWalletValuation = selectedAccount?.platformKey === "binance"
    && selectedAccount.id === walletAccount?.id ? walletValuation : null;
  const chartAccount = selectedAccount;
  useEffect(() => {
    if (accountId !== "all" && !accounts.some(account => account.id === accountId)) setAccountId("all");
  }, [accountId, accounts]);
  useEffect(() => {
    const tick = () => setRuntimeNow(Date.now());
    const timer = window.setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", tick); };
  }, []);
  const privateScopeObservedAt = privateScope?.value?.report?.observed_at;
  useEffect(() => {
    setPrivateScopeNow(Date.now());
    return scheduleBinancePrivateScopeExpiry(
      privateScopeObservedAt,
      () => setPrivateScopeNow(Date.now()),
    );
  }, [privateScopeObservedAt]);
  useEffect(() => {
    const refreshAfterForeground = () => {
      if (document.visibilityState === "visible") {
        setPrivateScopeNow(Date.now());
        setWalletNow(Date.now());
      }
    };
    document.addEventListener("visibilitychange", refreshAfterForeground);
    return () => document.removeEventListener("visibilitychange", refreshAfterForeground);
  }, []);
  useEffect(() => {
    if (chart !== "return" || !benchmarkExpanded) {
      setBenchmarkFrameWidth(0);
      return;
    }
    const container = benchmarkFrameContainer.current;
    if (!container) return;
    let resizeTimer: number | undefined;
    const measure = () => {
      const width = Math.min(670, Math.floor(container.getBoundingClientRect().width));
      if (width > 0) setBenchmarkFrameWidth((current) => current === width ? current : width);
    };
    if (typeof ResizeObserver === "undefined") {
      measure();
      return;
    }
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(measure, 150);
    });
    observer.observe(container);
    measure();
    return () => {
      observer.disconnect();
      window.clearTimeout(resizeTimer);
    };
  }, [chart, benchmarkExpanded]);
  const binancePrivateScope = presentBinancePrivateScope(
    privateScope?.error ? null : privateScope?.value,
    { admin: isAdmin === true, allAccounts: accountId === "all", now: privateScopeNow },
  );
  const selectedFacts = selectedAccount?.facts || null;
  const chartFacts = chartAccount?.facts || null;
  const walletChartSelected = chartAccount?.platformKey === "binance";
  const accountHistory = history?.account_key === chartAccount?.accountKey && history?.platform === chartAccount?.platformKey ? history : null;
  const currencyOptions = walletChartSelected ? ["USDT"] : Array.from(new Set([
    ...(chartFacts?.balances || []).map((row) => row.currency).filter(Boolean),
    ...(accountHistory?.series.points || []).map((row) => row.currency).filter(Boolean),
  ]));
  const currency = currencyChoice.accountId === chartAccount?.id && currencyOptions.includes(currencyChoice.value)
    ? currencyChoice.value : currencyOptions[0] || "";
  const requestedHistoryKey = chartAccount ? `${chartAccount.id}:${currency}:${chartFacts?.observed_finished_at || ""}:${walletChartSelected ? wallet?.observed_finished_at || "" : ""}` : "";
  useEffect(() => {
    const epoch = ++historyEpoch.current;
    const cancel = () => { if (historyEpoch.current === epoch) historyEpoch.current += 1; };
    if (!chartAccount || chart !== "assets" || !currency || (walletChartSelected && currency !== "USDT")) {
      setHistory(null);
      setWalletHistory(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return cancel;
    }
    setHistory(null);
    setWalletHistory(null);
    setHistoryError(null);
    setHistoryLoading(true);
    setHistoryKey(requestedHistoryKey);
    if (walletChartSelected) {
      setHistory(null);
      void loadBinanceWalletHistory(chartAccount.accountKey)
        .then((payload) => {
          if (historyEpoch.current !== epoch) return;
          setWalletHistory(payload);
          setHistoryLoading(false);
        })
        .catch((error) => {
          if (historyEpoch.current !== epoch) return;
          setWalletHistory(null);
          setHistoryError(error instanceof Error ? error.message : "request_failed");
          setHistoryLoading(false);
        });
      return cancel;
    }
    setWalletHistory(null);
    void loadAccountFactsHistory(chartAccount.platformKey, chartAccount.accountKey, currency)
      .then((payload) => {
        if (historyEpoch.current !== epoch) return;
        setHistory(payload);
        setHistoryLoading(false);
      })
      .catch((error) => {
        if (historyEpoch.current !== epoch) return;
        setHistory(null);
        setHistoryError(error instanceof Error ? error.message : "request_failed");
        setHistoryLoading(false);
      });
    return cancel;
  }, [chartAccount?.id, chartAccount?.platformKey, chartAccount?.accountKey, chartFacts?.observed_finished_at,
    binanceFacts?.value?.report?.observed_finished_at, walletChartSelected, currency, chart, readModelRefreshVersion]);
  useEffect(() => {
    let active = true;
    const todayAccounts = accounts.filter(account => runtimeDailySelectionEligible({ platform: account.platformKey, accountKey: account.accountKey, dailyBinding: account.runtimeDailyBinding }));
    const selectedAccounts = runtimeDateSelectable(runtimeDate, runtimeNow) && runtimeDate !== runtimeToday
      ? visible.filter(account => runtimeDailySelectionEligible({ platform: account.platformKey, accountKey: account.accountKey, dailyBinding: account.runtimeDailyBinding }))
      : [];
    const requests = new Map<string, { account: OverviewAccount; date: string }>();
    for (const account of todayAccounts) requests.set(runtimeDailyRequestKey(account.platformKey, account.accountKey, account.runtimeDailyBinding, runtimeToday), { account, date: runtimeToday });
    for (const account of selectedAccounts) requests.set(runtimeDailyRequestKey(account.platformKey, account.accountKey, account.runtimeDailyBinding, runtimeDate), { account, date: runtimeDate });
    if (requests.size === 0) {
      setRuntimeDaily({});
      return () => { active = false; };
    }
    setRuntimeDaily(Object.fromEntries(Array.from(requests.keys(), key => [key, { value: null, error: null, loading: true }])));
    for (const [key, { account, date }] of requests) {
      const selection = { platform: account.platformKey, accountKey: account.accountKey, dailyBinding: account.runtimeDailyBinding };
      void loadRuntimeDaily(date, account.platformKey, account.accountKey)
        .then((payload) => {
          if (!active) return;
          const value = runtimeDailySnapshotMatchesSelection(payload, selection, date) ? payload : null;
          setRuntimeDaily(current => ({ ...current, [key]: { value, error: value ? null : "runtime_daily_selection_mismatch", loading: false } }));
        })
        .catch((error) => {
          if (!active) return;
          setRuntimeDaily(current => ({ ...current, [key]: { value: null, error: error instanceof Error ? error.message : "request_failed", loading: false } }));
        });
    }
    return () => { active = false; };
    // A New York business-day rollover reloads current data; a manually selected historical date remains pinned.
  }, [accounts.map(account => JSON.stringify([account.platformKey, account.accountKey, account.runtimeDailyBinding])).join("|"),
    visible.map(account => JSON.stringify([account.platformKey, account.accountKey, account.runtimeDailyBinding])).join("|"), runtimeDate, runtimeToday,
    readModelRefreshVersion]);
  useEffect(() => {
    const now = Date.now();
    const deadlines = accounts.flatMap(account => {
      const runtime = account.runtime;
      const ttl = runtime?.evidence_valid_for_seconds;
      return typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0
        ? [runtime?.observed_at, runtime?.target.deployment?.observed_at].map(at => Date.parse(at || "") + ttl * 1000)
        : [];
    });
    for (const account of accounts) {
      const entry = runtimeDaily[runtimeDailyRequestKey(account.platformKey, account.accountKey, account.runtimeDailyBinding, runtimeToday)];
      const schedule = entry?.value?.record?.schedule;
      deadlines.push(Date.parse(schedule?.next_due_at || ""), Date.parse(schedule?.grace_ends_at || ""));
    }
    const next = Math.min(...deadlines.filter(deadline => Number.isFinite(deadline) && deadline > now));
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(() => setRuntimeNow(Date.now()), Math.min(next - now + 1, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [accounts, runtimeDaily, runtimeToday, runtimeNow]);
  const formatCurrentAmounts = (rows: Array<{ currency: string; amount: string }>) => rows.length
    ? rows.map(row => `${row.currency} ${row.amount}`).join(" · ") : "—";
  const aggregateAssetGroups = [
    { key: "live", label: "配置为实盘", group: currentFactsSummary.live },
    { key: "unknown", label: "环境待确认", group: currentFactsSummary.unknown },
    { key: "paper", label: "配置为模拟（单列，不计入实盘汇总）", group: currentFactsSummary.paper },
  ].filter(item => item.group.accounts > 0);
  const aggregateCashGroups = [
    { key: "live", label: "配置为实盘", group: currentFactsSummary.live },
    { key: "unknown", label: "环境待确认", group: currentFactsSummary.unknown },
    { key: "paper", label: "配置为模拟（单列，不计入实盘汇总）", group: currentFactsSummary.paper },
  ].filter(item => item.group.cashAccounts > 0);
  const aggregateCashLines = aggregateCashGroups.flatMap(item => [
    { key: `${item.key}:balance`, environmentLabel: item.label, label: "现金余额", values: item.group.cashBalance },
    { key: `${item.key}:available`, environmentLabel: item.label, label: "可用现金", values: item.group.availableCash },
  ]).filter(line => line.values.length > 0);
  const aggregateCashTotals = [
    { key: "balance", label: "现金余额", values: currentFactsSummary.excludingPaper.cashBalance },
    { key: "available", label: "可用现金", values: currentFactsSummary.excludingPaper.availableCash },
  ].filter(line => line.values.length > 0);
  // Single-account metrics use that account's own source semantics; all-account
  // metrics below summarize only current snapshots and preserve every currency.
  const totalAssets = accountId === "all"
    ? null
    : selectedWalletValuation
      ? formatBinanceWalletAmount(selectedWalletValuation.amount)
      : formatAccountFactAmounts(accountFactsDisplayReady(selectedFacts) ? selectedFacts!.balances : null, "net_assets");
  const totalCash = accountId === "all"
    ? null
    : formatAccountFactAmounts(
      accountFactsDisplayReady(selectedFacts) ? selectedFacts!.cash : null,
      selectedAccount ? cashFieldForPlatform(selectedAccount.platformKey) || "available_cash" : "available_cash",
    );
  const selectedCashField = selectedAccount ? cashFieldForPlatform(selectedAccount.platformKey) : "available_cash";
  const selectedCashRows = selectedFacts?.data_status === "fresh"
    && selectedFacts.binding_status === "bound" && selectedFacts.identity_mismatch !== true
    ? selectedFacts.cash : null;
  const selectedNegativeCash = selectedCashField !== null && hasNonzeroNegativeAccountFactAmount(selectedCashRows, selectedCashField);
  const showSelectedCashMetric = !selectedWalletValuation || totalCash !== null;
  const assetsDetail = accountId === "all"
    ? "按配置账户当前快照求和，不代表已核实的物理账户组合资产。"
    : selectedAccount?.platformKey === "binance" ? binanceWalletStatusDetail(binanceFacts?.error
      ? { error: binanceFacts.error } : binanceFacts?.value, walletNow) : accountFactsDetail(selectedFacts);
  const cashDetail = accountId === "all"
    ? "按配置账户当前快照求和；现金余额与可用现金分开，不代表已核实的物理账户组合现金。"
    : accountFactsDetail(selectedFacts);
  const selectedUpdatedAt = accountId === "all" ? null : accountFactsUpdatedAt(selectedFacts);
  const assetsMetricLabel = accountId === "all" ? "账户最新估值（按币种）" : selectedWalletValuation ? "钱包总资产" : "总资产";
  const selectedCashLabel = accountId === "all" ? "账户现金（按来源语义和币种）" : selectedAccount ? cashLabelForPlatform(selectedAccount.platformKey) : "可用现金";
  const filteredWalletPoints = walletChartSelected
    ? filterAssetHistoryByRange(historyKey === requestedHistoryKey ? walletHistory?.points || [] : [], range) : [];
  const filteredAccountPoints = walletChartSelected
    ? [] : filterAssetHistoryByRange(historyKey === requestedHistoryKey && accountHistory?.identity_mismatch !== true && accountHistory?.series.currency === currency
      ? (accountHistory?.series.points || []).filter(point => point.currency === currency) : [], range);
  const geometry = walletChartSelected
    ? buildBinanceWalletHistoryChartGeometry(filteredWalletPoints)
    : buildAssetChartGeometry(filteredAccountPoints);
  const hasChart = chart === "assets" && Boolean(chartAccount) && geometry.dots.length > 0;
  const chartEmptyTitle = chart === "assets" && accountId === "all" ? "暂无组合历史" : chartUnavailable(chart);
  const chartEmptyDetail = chart === "return"
    ? "暂不可用"
    : historyLoading
        ? "加载中…"
        : historyError || history?.identity_mismatch
          ? "暂不可用"
          : accountId === "all" && !chartAccount
            ? "全部账户只显示最新分币种估值；历史变化需选择单个账户。"
          : emptyNote.key === "{range}内暂无资产记录"
            ? emptyNote.key
            : "暂无资产记录";
  const detailLine = (label: string, updatedAt: string | null) => {
    const formatted = formatInstant(updatedAt);
    if (!label && !formatted) return null;
    if (label && formatted) return `${t(label)} · ${t("上次更新")} ${formatted}`;
    if (label) return t(label);
    return `${t("上次更新")} ${formatted}`;
  };
  const selectedUpdatedTime = formatInstant(selectedUpdatedAt);
  return <div className="daily-page overview-layout">
    <div className="daily-heading overview-head">
      <div><h1>{t("账户总览")}</h1>{selectedUpdatedTime ? <small className="overview-updated">{t("上次更新")} {selectedUpdatedTime}</small> : null}</div>
      <select className="account-filter" aria-label={t("全部账户")} value={accountId} onChange={event => setAccountId(event.target.value)}>
        <option value="all">{t("全部账户")}</option>
        {accounts.map(account => <option key={account.id} value={account.id}>{optionLabel(account)}</option>)}
      </select>
    </div>
    <section className={`metric-row overview-metrics${accountId === "all" ? " overview-metrics-all" : ""}${selectedWalletValuation ? " overview-metrics-wallet" : ""}`} aria-label={t("账户总览")}>
      <div><span>{t(assetsMetricLabel)}</span>
        {accountId === "all" ? <div className="overview-aggregate-values">
          <div className="overview-aggregate-primary">
            <span>{t(verifiedAssets ? "账户资产合计（已去重，不含模拟账户）" : "已取得资产合计（不含已标记模拟账户）")}</span>
            <strong>{formatCurrentAmounts(verifiedAssets || currentFactsSummary.excludingPaper.assets)}</strong>
            {verifiedAssets ? null : <small>{t("含环境待确认账户，账户身份未全部核实；缺资料不按零计。")}</small>}
            <small>{t("估值覆盖 {covered}/{total} 个非模拟配置账户；未绑定 {unbound}，其他缺估值 {missing}。", {
              covered: currentFactsSummary.excludingPaper.covered,
              total: currentFactsSummary.excludingPaper.accounts,
              unbound: currentFactsSummary.excludingPaper.unbound,
              missing: Math.max(0, currentFactsSummary.excludingPaper.missing - currentFactsSummary.excludingPaper.unbound),
            })}</small>
            {currentFactsSummary.duplicateConfigurationKeys > 0 ? <small>{t("重复账户配置键 {count} 组已去重；资料冲突的 {conflicts} 组不计金额。", {
              count: currentFactsSummary.duplicateConfigurationKeys,
              conflicts: currentFactsSummary.duplicateConfigurationConflicts,
            })}</small> : null}
          </div>
          {aggregateAssetGroups.length ? <details className="overview-aggregate-breakdown">
            <summary>{t("按配置环境查看资产明细")}</summary>
            {aggregateAssetGroups.map(item => <div key={item.key}>
            <span>{t(item.label)} · {item.group.covered}/{item.group.accounts}</span>
            <strong>{formatCurrentAmounts(item.group.assets)}</strong>
            <small>{t("估值覆盖 {covered}/{total} 个配置账户；未绑定 {unbound}，其他缺估值 {missing}（未知不按零计）。", {
              covered: item.group.covered, total: item.group.accounts, unbound: item.group.unbound,
              missing: Math.max(0, item.group.missing - item.group.unbound),
            })}</small>
            </div>)}
          </details> : <small>{t("尚无合格账户估值")}</small>}
          <small>{t(assetsDetail)}</small>
        </div> : <>
          <strong>{amountOrDash(totalAssets)}</strong>
          {selectedWalletValuation
            ? <small>{selectedWalletValuation.currency} · {t("观察")} {formatShortInstant(selectedWalletValuation.observed_at) || "—"}</small>
            : detailLine(assetsDetail, null) ? <small>{detailLine(assetsDetail, null)}</small> : null}
        </>}</div>
      {showSelectedCashMetric ? <div><span>{t(selectedCashLabel)}</span>
        {accountId === "all" ? <div className="overview-aggregate-values">
          {aggregateCashTotals.length ? aggregateCashTotals.map(line => <div className="overview-aggregate-primary" key={line.key}>
            <span>{t("已取得现金合计（不含已标记模拟账户）")} · {t(line.label)}</span>
            <strong>{formatCurrentAmounts(line.values)}</strong>
            {verifiedAssets ? null : <small>{t("含环境待确认账户，账户身份未全部核实；缺资料不按零计。")}</small>}
          </div>) : <small>{t("尚无合格现金资料")}</small>}
          <small>{t("现金资料覆盖 {covered}/{total} 个非模拟且支持现金字段的配置账户；未绑定 {unbound}，其他缺现金资料 {missing}。", {
            covered: currentFactsSummary.excludingPaper.cashCovered,
            total: currentFactsSummary.excludingPaper.cashAccounts,
            unbound: currentFactsSummary.excludingPaper.cashUnbound,
            missing: Math.max(0, currentFactsSummary.excludingPaper.cashMissing - currentFactsSummary.excludingPaper.cashUnbound),
          })}</small>
          <small>{t(cashDetail)}</small>
          {aggregateCashLines.length || aggregateCashGroups.length ? <details className="overview-aggregate-breakdown">
            <summary>{t("按配置环境查看现金明细")}</summary>
            {aggregateCashLines.map(line => <div key={line.key}>
            <span>{t(line.environmentLabel)} · {t(line.label)}</span><strong>{formatCurrentAmounts(line.values)}</strong>
            </div>)}
            {aggregateCashGroups.map(item => <small key={`${item.key}:cash-coverage`}>{t("现金资料覆盖 {covered}/{total} 个支持现金字段的配置账户；未绑定 {unbound}，其他缺现金资料 {missing}。", {
            covered: item.group.cashCovered, total: item.group.cashAccounts, unbound: item.group.cashUnbound,
            missing: Math.max(0, item.group.cashMissing - item.group.cashUnbound),
            })}</small>)}
          </details> : <small>{t("尚无合格现金资料")}</small>}
        </div> : <>
          <strong>{amountOrDash(totalCash)}</strong>
          {selectedNegativeCash ? <small className="negative-cash-note">{t(negativeCashStatusForPlatform(selectedAccount!.platformKey))}</small> : null}
          {detailLine(cashDetail, null) ? <small>{detailLine(cashDetail, null)}</small> : null}
        </>}</div> : null}
    </section>
    {showWallet && !walletValuation ? <section id="binance-account-facts-board" className="overview-private-scope" aria-label={t("现货与活期理财")}>
      <div className="overview-private-scope-head">
        <h2>{t("现货与活期理财")}</h2>
        <small>{t("上次更新")} {formatShortInstant(wallet.observed_finished_at) || "—"}</small>
      </div>
      <div className="overview-wallet-list">
          <div className="overview-wallet-row overview-private-scope-labels"><span>{t("资产")}</span><span>{t("可用数量")}</span><span>{t("冻结数量")}</span><span>{t("活期理财数量")}</span></div>
          {wallet.assets.map((item: { asset: string; spot_free: string; spot_locked: string; flexible_earn: string }) => <div className="overview-wallet-row" key={item.asset}>
            <strong>{item.asset}</strong>
            <BinanceQuantity amount={item.spot_free} originalLabel={t("原始值")} />
            <BinanceQuantity amount={item.spot_locked} originalLabel={t("原始值")} />
            <BinanceQuantity amount={item.flexible_earn} originalLabel={t("原始值")} />
          </div>)}
          {!wallet.assets.length ? <small>{t("暂无非零资产")}</small> : null}
      </div>
      <BinanceWalletDetails
        summary={t("钱包数据详情")}
        scope={t("资产按原生数量显示；其他钱包未覆盖")}
        observedAt={wallet.observed_finished_at}
        formattedObservedAt={formatInstant(wallet.observed_finished_at)}
        scopeLabel={t("数据范围")}
        valueLabel={t("原始估值")}
        timeLabel={t("完整观察时间")}
      />
    </section> : null}
    {binancePrivateScope?.assets.length ? <section id="binance-private-scope-board" className="overview-private-scope" aria-label={t("Binance非策略现货资产")}>
      <div className="overview-private-scope-head">
        <h2>{t("Binance非策略现货资产")}</h2>
        <small>{t("观察")} {formatShortInstant(binancePrivateScope.observed_at) || "—"}</small>
      </div>
      <BinanceWalletDetails
        summary={t("数据范围与时间")}
        scope={t("Binance非策略现货资产")}
        observedAt={binancePrivateScope.observed_at}
        formattedObservedAt={formatInstant(binancePrivateScope.observed_at)}
        scopeLabel={t("数据范围")}
        valueLabel={t("原始估值")}
        timeLabel={t("完整观察时间")}
      />
      <div className="overview-private-scope-list">
        <div className="overview-private-scope-row overview-private-scope-labels"><span>{t("资产")}</span><span>{t("可用数量")}</span><span>{t("冻结数量")}</span></div>
        {binancePrivateScope.assets.map((item) => <div className="overview-private-scope-row" key={item.asset}>
          <strong>{item.asset}</strong>
          <BinanceQuantity amount={item.free} originalLabel={t("原始值")} />
          <BinanceQuantity amount={item.locked} originalLabel={t("原始值")} />
        </div>)}
      </div>
    </section> : null}
    <section className="chart-panel overview-chart">
      {walletChartSelected && chart === "assets" ? <h2>{t("钱包总资产变化（USDT）")}</h2> : null}
      <div className="chart-toolbar">
        <div className="chart-switch" role="tablist" aria-label={t("图表")}>
          {CHART_MODES.map(mode => <button key={mode.id} type="button" role="tab" aria-selected={chart === mode.id} className={chart === mode.id ? "active" : ""} onClick={() => setChart(mode.id)}>{t(mode.label)}</button>)}
        </div>
        {chart === "assets" ? <div className="chart-range" role="tablist" aria-label={t("图表范围")}>
          {CHART_RANGE_OPTIONS.map(option => <button key={option.id} type="button" role="tab" aria-selected={range === option.id} className={range === option.id ? "active" : ""} onClick={() => setRange(option.id)}>{t(option.label)}</button>)}
        </div> : null}
      </div>
      {chart === "assets" ? <div className="chart-currency">
        {chartAccount ? <span>{`${chartAccount.title} · ${chartAccount.environment} · ${chartAccount.platform}`}</span> : null}
        {chartAccount ? <label>
          <span>{t("币种")}</span>
          <select aria-label={t("币种")} value={currency} onChange={event => setCurrencyChoice({ accountId: chartAccount.id, value: event.target.value })} disabled={!currencyOptions.length}>
            {!currencyOptions.length ? <option value="">{t("暂无币种")}</option> : null}
            {currencyOptions.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label> : null}
        {chartAccount ? walletChartSelected
          ? <details className="overview-wallet-details"><summary>{t("数据范围")}</summary><small>{t("按 Binance 返回的钱包范围")}</small></details>
          : <small>{t("仅显示单个账户的资产变化")}{chartAccount.brokerEnvironment === "paper" || chartFacts?.account_scope === "paper" ? ` · ${t("模拟账户图表不计入总额")}` : ""}</small> : null}
      </div> : null}
      {chart === "return" ? <div className="overview-benchmark">
        <h2>{t("账户与基准收益率比较")}</h2>
        <p>{t("暂无可比较收益率；账户需要完整估值、资金进出和费用记录。")}</p>
        <ul className="overview-return-coverage" aria-label={t("账户收益覆盖")}>
          {visible.map(account => <li key={account.id}><strong>{optionLabel(account)}</strong><span>{t("收益率暂不可用")}</span><small>{t("缺少完整估值、资金进出和费用记录")}</small></li>)}
          {!visible.length ? <li>{t("暂无账户")}</li> : null}
        </ul>
        <ul className="overview-return-coverage" aria-label={t("基准收益覆盖")}>
          {RETURN_INDEX_LEGEND.map(name => <li key={name}><strong>{t(name)}</strong><span>{t("比较序列未取得")}</span><small>{t(name === "标普500" ? "FRED SP500：日收盘价格，不含股息" : "暂无数据")}</small></li>)}
        </ul>
        <details className="overview-benchmark-source"><summary>{t("收益率口径")}</summary><p>{t("比较需完整外部资金流、费用和原币种估值，共同起止区间以可信首点归零；多账户汇总还需可信汇率与加权口径。")}</p></details>
        <details className="overview-price-reference" onToggle={event => setBenchmarkExpanded(event.currentTarget.open)}>
        <summary>{t("价格指数参考")}</summary>
        <div className="overview-benchmark-heading">
          <h2>{t("标普500价格指数")}</h2>
          <p>{t("日收盘价，不含股息；此参考图与账户收益率不作同轴比较。")}</p>
        </div>
        <div className="overview-benchmark-frame-container" ref={benchmarkFrameContainer}>
          {benchmarkFrameWidth > 0 ? <iframe
            className="overview-benchmark-frame"
            title={t("标普500价格指数图表")}
            src={`https://fred.stlouisfed.org/graph/graph-landing.php?g=1ZeSU&width=${benchmarkFrameWidth}&height=475`}
            width={benchmarkFrameWidth}
            height="525"
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
          /> : null}
        </div>
        <details className="overview-benchmark-source">
          <summary>{t("指数来源详情")}</summary>
          <dl>
            <div><dt>{t("数据系列")}</dt><dd>{t("S&P 500 (SP500)，日收盘价格指数，不含股息")}</dd></div>
            <div><dt>{t("时间范围")}</dt><dd>{t("最近5年")}</dd></div>
            <div><dt>{t("图表署名")}</dt><dd>{t("S&P Dow Jones Indices LLC via FRED")}</dd></div>
            <div><dt>{t("来源")}</dt><dd><a href="https://fred.stlouisfed.org/series/SP500" rel="noreferrer" referrerPolicy="no-referrer">{t("FRED 官方数据页")}</a></dd></div>
          </dl>
        </details>
        </details>
      </div> : hasChart ? <div className="asset-chart">
        <svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="img" aria-label={t(walletChartSelected ? "钱包总资产变化（USDT）" : "资产变化")}>
          {geometry.segments.map((path, index) => <path key={index} d={path} className="asset-chart-line" fill="none" />)}
          {geometry.dots.map((dot) => <circle key={`${dot.date}:${dot.amount}`} cx={dot.x} cy={dot.y} r={geometry.dots.length === 1 ? 4 : 2.5} className="asset-chart-dot">
            <title>{`${dot.date} · ${currency} ${dot.amount}`}</title>
          </circle>)}
        </svg>
        <div className="asset-chart-meta">
          <span>{geometry.dots[0]?.date} → {geometry.dots[geometry.dots.length - 1]?.date}</span>
          <span>{currency} {geometry.minLabel} – {geometry.maxLabel}</span>
        </div>
      </div> : <div className="chart-empty">
        <strong>{t(chartEmptyTitle)}</strong>
        <p>{chartEmptyDetail === "{range}内暂无资产记录"
          ? t(chartEmptyDetail, { range: t(emptyNote.rangeLabel) })
          : t(chartEmptyDetail)}</p>
      </div>}
    </section>
    <section className="overview-runtime" aria-label={t("每日运行记录")}>
      <div className="overview-runtime-head">
        <h2>{t("每日运行记录")}</h2>
        <label>
          <span>{t(runtimeDateLabel)}</span>
          <input type="date" aria-label={t(runtimeDateLabel)} value={runtimeDate} min={runtimeBounds.min} max={runtimeToday} onChange={event => setSelectedRuntimeDate(event.target.value === runtimeToday ? null : event.target.value)} />
        </label>
      </div>
      {!runtimeDateSelectable(runtimeDate, runtimeNow) ? <p>{t("请选择最近90天内的有效日期")}</p> : visible.map(account => {
        const selection = { platform: account.platformKey, accountKey: account.accountKey, dailyBinding: account.runtimeDailyBinding };
        const eligible = runtimeDailySelectionEligible(selection);
        const dailyEntry = runtimeDaily[runtimeDailyRequestKey(account.platformKey, account.accountKey, account.runtimeDailyBinding, runtimeDate)];
        const runtimeError = dailyEntry?.error;
        const runtimeLoading = dailyEntry?.loading;
        const view = presentRuntimeDaily(runtimeError ? null : dailyEntry?.value, selection, runtimeDate);
        const runTime = [formatInstant(view.runStartedAt), formatInstant(view.runFinishedAt)].filter(Boolean).join(" → ") || "—";
        return <article className="overview-runtime-account" key={account.id}>
        <h3>{optionLabel(account)}</h3>
        {runtimeLoading && eligible ? <p className="overview-runtime-state">{t("正在读取该日记录…")}</p> : runtimeError && eligible ? <p className="overview-runtime-state"><strong>{t("读取失败")}</strong>{t("运行记录读取失败；不能据此判断是否运行。")}</p> : !view.accountMatched || !dailyEntry?.value?.record ? <p className="overview-runtime-state"><strong data-tone={statusTone(view.statusLabel)}>{t(view.statusLabel)}</strong><span>{view.statusDetails.map(item => t(item)).join(" ")}</span>{view.dataStatusLabel !== "—" ? <small>{t(view.dataStatusLabel)}</small> : null}</p> : <>
        <div className="overview-runtime-grid">
          <div><span>{t("运行状态")}</span><strong data-tone={statusTone(view.statusLabel)}>{t(view.statusLabel)}</strong>{view.statusDetails.length ? <small>{view.statusDetails.map(item => t(item)).join(" ")}</small> : null}</div>
          <div><span>{t("运行时间")}</span><strong>{runTime}</strong>{view.dataStatusLabel !== "—" ? <small>{t(view.dataStatusLabel)}</small> : null}</div>
          <div><span>{t("成交明细")}</span><strong>{t(view.fillsLabel)}</strong></div>
        </div>
        {view.dryRun ? <p className="overview-runtime-flag">{t("只读演练")}</p> : null}
        </>}
        {view.historyDays > 0 ? <p className="overview-runtime-history">
          {t("历史数据范围")}：{t("{from} 至 {through}", { from: view.historyFrom || "—", through: view.historyThrough || "—" })}（{t("{count} 个记录日", { count: view.historyDays })}）
          {view.historyTruncated || (view.historyFrom !== null && view.historyFrom < runtimeBounds.min) ? <small>{t("当前视图未覆盖全部记录，不代表完整历史")}</small> : null}
        </p> : null}
        </article>;
      })}
      {!visible.length ? <p>{t("无记录")}</p> : null}
    </section>
    <aside className="overview-accounts">
      <h2>{t("我的账户")}</h2>
      <p className="section-note overview-account-coverage">{t("当前列表资料覆盖：估值 {covered}/{total} 项，未绑定 {unbound}，其他缺估值 {missing}；支持现金字段 {cashCovered}/{cashTotal} 项有值，现金资料缺项 {cashMissing}（含未绑定）。", {
        covered: visibleFactsSummary.excludingPaper.covered + visibleFactsSummary.paper.covered,
        total: visibleFactsSummary.excludingPaper.accounts + visibleFactsSummary.paper.accounts,
        unbound: visibleFactsSummary.excludingPaper.unbound + visibleFactsSummary.paper.unbound,
        missing: Math.max(0, visibleFactsSummary.excludingPaper.missing + visibleFactsSummary.paper.missing
          - visibleFactsSummary.excludingPaper.unbound - visibleFactsSummary.paper.unbound),
        cashCovered: visibleFactsSummary.excludingPaper.cashCovered + visibleFactsSummary.paper.cashCovered,
        cashTotal: visibleFactsSummary.excludingPaper.cashAccounts + visibleFactsSummary.paper.cashAccounts,
        cashMissing: visibleFactsSummary.excludingPaper.cashMissing + visibleFactsSummary.paper.cashMissing,
      })}</p>
      <div className="overview-account-list">
        {visible.map(account => {
          const native = accountNativeReadout(account.platformKey, account.accountKey, account.facts,
            walletAccount?.id === account.id ? wallet : null, factsNow);
          const walletCardValuation = presentBinanceWalletValuationForAccount(
            account.id,
            walletAccount?.id,
            showWallet ? wallet : null,
            walletNow,
          );
          const providerProductType = binanceProviderProductTypeForDisplay(
            wallet,
            showWallet && walletAccount?.id === account.id && native.nativeType === "SPOT",
          );
          const assets = walletCardValuation
            ? formatBinanceWalletAmount(walletCardValuation.amount)
            : formatAccountFactAmounts(accountFactsDisplayReady(account.facts) ? account.facts!.balances : null, "net_assets");
          const freshCashRows = accountFactsDisplayReady(account.facts) ? account.facts!.cash : null;
          const cashField = cashFieldForPlatform(account.platformKey) || "available_cash";
          const cash = formatAccountFactAmounts(
            freshCashRows,
            cashField,
          );
          const verifiedFreshCashRows = account.facts?.data_status === "fresh"
            && account.facts.binding_status === "bound" && account.facts.identity_mismatch !== true
            ? freshCashRows : null;
          const negativeCash = hasNonzeroNegativeAccountFactAmount(verifiedFreshCashRows, cashField);
          const factDetail = account.platformKey === "binance" ? binanceWalletStatusDetail(binanceFacts?.error
            ? { error: binanceFacts.error } : binanceFacts?.value, walletNow) : accountFactsDetail(account.facts);
          const updatedAt = accountFactsUpdatedAt(account.facts);
          const longBridgeCash = longBridgeCashDetails(account.facts);
          const longBridgeFinancing = longBridgeFinancingDetails(account.facts);
          const health = overviewRuntimeHealth(account.runtime, runtimeDaily[runtimeDailyRequestKey(account.platformKey, account.accountKey, account.runtimeDailyBinding, runtimeToday)]?.value,
            { platform: account.platformKey, accountKey: account.accountKey, dailyBinding: account.runtimeDailyBinding }, account.facts?.identity_mismatch === true, Math.max(runtimeNow, Date.now()));
          const deployment = runtimeDeploymentReadout(account.runtime, account.facts?.identity_mismatch === true, Math.max(runtimeNow, Date.now()));
          const cardDetail = walletCardValuation
            ? `${t("观察")} ${formatShortInstant(walletCardValuation.observed_at) || "—"}`
            : detailLine(factDetail, formatInstant(updatedAt) === selectedUpdatedTime ? null : updatedAt);
          const paperConfigured = account.brokerEnvironment === "paper";
          const accountTypeLabel = paperConfigured
            ? t("模拟账户")
            : providerProductType
              ? t("API账户类型：现货")
              : native.nativeType
                ? `${t("账户类型")}: ${native.nativeType}`
                : t("账户类型待确认");
          return <div key={account.id} className="overview-account-entry">
            <button type="button" className="overview-account" onClick={() => onOpenAccount(account.id)}>
            <strong>{account.title}</strong>
            <small>{t(brokerAccountType(account.brokerEnvironment))}</small>
            <small>{accountTypeLabel}</small>
            {paperConfigured && providerProductType ? <small>{t("API账户类型：现货")}</small> : null}
            <small>{account.strategy}</small>
            <span className={`overview-figures${walletCardValuation ? " overview-figures-wallet" : ""}`}>
              {walletCardValuation
                ? <span className="wallet-card-valuation">
                  <em>{t("钱包总资产")}</em>
                  <strong title={walletCardValuation.amount} aria-label={`${walletCardValuation.amount} ${walletCardValuation.currency}`}>
                    {amountOrDash(assets)}
                  </strong>
                  <small aria-hidden="true">{walletCardValuation.currency}</small>
                </span>
                : <span><em>{t("账户资产")}</em>{amountOrDash(assets)}</span>}
              {!walletCardValuation ? <span>
                <em>{t(cashLabelForPlatform(account.platformKey))}</em>{amountOrDash(cash)}
                {negativeCash ? <small className="negative-cash-note">{t(negativeCashStatusForPlatform(account.platformKey))}</small> : null}
              </span> : null}
            </span>
            <span className="overview-marks"><span data-tone={statusTone(health.label)}><em>{t("运行监测")}</em>{t(health.label)}</span><span data-tone={statusTone(activationText(account.activation))}><em>{t("启用")}</em>{t(activationText(account.activation))}</span></span>
            <small>{t(health.detail === "今日周期记录未取得" ? "今日周期记录未取得，不能据此确认周期结果。" : health.detail)}</small>
            {account.runtimeTargetEnabled === true && (account.activation === "待确认" || account.activation === "—")
              ? <small>{t("配置开关已启用，实际运行待确认。")}</small> : null}
            {cardDetail ? <small>{cardDetail}</small> : null}
            </button>
            <details className="overview-wallet-details"><summary>{t("运行状态依据")}</summary><dl>
              <div><dt>{t("定时触发")}</dt><dd>{t(deployment.scheduler)}</dd></div>
              <div><dt>{t("运行开关")}</dt><dd>{t(deployment.runtimeSwitch)}</dd></div>
              <div><dt>{t("开关观察时间")}</dt><dd>{formatInstant(deployment.observedAt) || t("未取得")}</dd></div>
              <div><dt>{t("证据观察时间")}</dt><dd>{formatInstant(health.observedAt) || t("未取得")}</dd></div>
              <div><dt>{t("下次运行时间")}</dt><dd>{formatInstant(health.nextDueAt) || t("未取得")}</dd></div>
              <div><dt>{t("最近完整周期")}</dt><dd>{formatInstant(health.lastSuccessAt) || t("未取得")}</dd></div>
            </dl><small>{t("定时触发、运行开关和周期结果分别核对；启用不代表已下单。")}</small></details>
            {walletCardValuation ? <BinanceWalletDetails
              summary={t("钱包数据详情")}
              scope={t("按 Binance 返回的钱包范围")}
              amount={walletCardValuation.amount}
              currency={walletCardValuation.currency}
              observedAt={walletCardValuation.observed_at}
              formattedObservedAt={formatInstant(walletCardValuation.observed_at)}
              scopeLabel={t("数据范围")}
              valueLabel={t("原始估值")}
              timeLabel={t("完整观察时间")}
            /> : null}
            {providerProductType ? <details className="overview-wallet-details">
              <summary>{t("账户类型来源详情")}</summary>
              <dl>
                <div><dt>{t("原始接口")}</dt><dd>{providerProductType.source}</dd></div>
                <div><dt>{t("完整观察时间")}</dt><dd><time dateTime={providerProductType.observed_at}>{formatInstant(providerProductType.observed_at) || providerProductType.observed_at}</time></dd></div>
              </dl>
            </details> : null}
            {longBridgeCash ? <details className="overview-wallet-details overview-cash-details">
              <summary>{t("现金详情")}</summary>
              <p>{t("完整观察时间")} <time dateTime={account.facts!.observed_finished_at!} title={account.facts!.observed_finished_at!}>{formatInstant(account.facts!.observed_finished_at!) || account.facts!.observed_finished_at}</time></p>
              {longBridgeCash.map((row) => <dl key={row.currency}>
                <div><dt>{t("币种")}</dt><dd>{row.currency}</dd></div>
                {row.total_cash !== undefined ? <div><dt>{t("现金余额")}</dt><dd><code>{row.total_cash} {row.currency}</code></dd></div> : null}
                {row.available_cash !== undefined ? <div><dt>{t("可用现金")}</dt><dd><code>{row.available_cash} {row.currency}</code></dd></div> : null}
                {row.frozen_cash !== undefined ? <div><dt>{t("冻结现金")}</dt><dd><code>{row.frozen_cash} {row.currency}</code></dd></div> : null}
                {row.settling_cash !== undefined ? <div><dt>{t("待结算现金")}</dt><dd><code>{row.settling_cash} {row.currency}</code></dd></div> : null}
              </dl>)}</details> : null}
            {longBridgeFinancing ? <details className="overview-wallet-details overview-financing-details">
              <summary>{t("融资详情")}</summary>
              <p>{t("完整观察时间")} <time dateTime={account.facts!.observed_finished_at!} title={account.facts!.observed_finished_at!}>{formatInstant(account.facts!.observed_finished_at!) || account.facts!.observed_finished_at}</time></p>
              {longBridgeFinancing.map((row) => <dl key={row.currency}>
                <div><dt>{t("币种")}</dt><dd>{row.currency}</dd></div>
                {row.max_finance_amount !== undefined ? <div><dt>{t("最大融资金额")}</dt><dd><code>{row.max_finance_amount} {row.currency}</code></dd></div> : null}
                {row.remaining_finance_amount !== undefined ? <div><dt>{t("剩余融资金额")}</dt><dd><code>{row.remaining_finance_amount} {row.currency}</code></dd></div> : null}
                {row.init_margin !== undefined ? <div><dt>{t("初始保证金")}</dt><dd><code>{row.init_margin} {row.currency}</code></dd></div> : null}
                {row.maintenance_margin !== undefined ? <div><dt>{t("维持保证金")}</dt><dd><code>{row.maintenance_margin} {row.currency}</code></dd></div> : null}
                {row.margin_call !== undefined ? <div><dt>{t("追缴保证金")}</dt><dd><code>{row.margin_call} {row.currency}</code></dd></div> : null}
                {row.buy_power !== undefined ? <div><dt>{t("购买力")}</dt><dd><code>{row.buy_power} {row.currency}</code></dd></div> : null}
                {row.risk_level !== undefined ? <div><dt>{t("风险等级")}</dt><dd>{t(longBridgeRiskLevelLabel(row.risk_level))}</dd></div> : null}
              </dl>)}</details> : null}
          </div>;
        })}
      </div>
    </aside>
  </div>;
}
