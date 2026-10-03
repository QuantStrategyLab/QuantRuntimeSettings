import { useEffect, useRef, useState } from "react";
import { loadAccountFactsHistory, loadBinanceWalletHistory, loadRuntimeDaily } from "./api";
import { useT, useLocale } from "./locales";
import {
  CHART_RANGE_OPTIONS,
  DEFAULT_CHART_RANGE,
  buildAssetChartGeometry,
  buildBinanceWalletHistoryChartGeometry,
  formatBinanceNativeQuantity,
  formatBinanceWalletAmount,
  chartRangeEmptyNote,
  chartUnavailable,
  defaultOverviewChartAccountId,
  filterAssetHistoryByRange,
  formatOverviewInstant,
  formatOverviewShortInstant,
  overviewAccountTypeLabel,
  overviewCardStatusDetail,
  overviewFigures,
  presentRuntimeDaily,
  runtimeBusinessDate,
  runtimeDailySelectionEligible,
  verifiedSchwabAccountTypeToken,
  presentBinanceWalletValuation,
  presentBinanceWalletValuationForAccount,
  presentBinancePrivateScope,
  resolveOverviewChartAccount,
  scheduleBinancePrivateScopeExpiry,
  type ChartMode,
  type ChartRange,
  type RuntimeDailySnapshot,
} from "./presentation";
import {
  accountFactsDetail,
  accountFactsUpdatedAt,
  binanceProviderProductTypeForDisplay,
  formatAccountFactAmounts,
  hasNonzeroNegativeAccountFactAmount,
  longBridgeCashDetails,
  type AccountFactsAccount,
  type AccountFactsHistorySnapshot,
  type AccountFactsSnapshot,
  type BinanceWalletHistorySnapshot,
} from "./types";

export type OverviewAccount = {
  id: string;
  platformKey: string;
  accountKey: string;
  title: string;
  platform: string;
  environment: string;
  brokerEnvironment: string | null;
  environmentSource: string;
  strategy: string;
  statusLabel: string;
  statusDetail: string;
  activation: string;
  preference: string | null;
  facts: AccountFactsAccount | null;
};

function preferenceLabel(value: string | null, t: (key: string) => string): string {
  const labels: Record<string, string> = { CAPITAL_PRESERVATION: "保守", BALANCED_COMPOUNDING: "均衡", GROWTH_COMPOUNDING: "增长" };
  return value && labels[value] ? t(labels[value]) : "—";
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

function cashFieldForPlatform(platform: string): "cash_balance" | "available_cash" {
  return platform === "ibkr" || platform === "schwab" ? "cash_balance" : "available_cash";
}

function cashLabelForPlatform(platform: string): "现金余额" | "可用现金" {
  return platform === "ibkr" || platform === "schwab" ? "现金余额" : "可用现金";
}

function negativeCashStatusForPlatform(platform: string): "现金余额为负，融资状态待确认" | "可用现金为负，融资状态待确认" {
  return platform === "ibkr" || platform === "schwab"
    ? "现金余额为负，融资状态待确认"
    : "可用现金为负，融资状态待确认";
}

const CHART_MODES: Array<{ id: ChartMode; label: "收益率" | "总资产" }> = [
  { id: "return", label: "收益率" },
  { id: "assets", label: "总资产" },
];

export function OverviewPage({ accounts, onOpenAccount, isAdmin, privateScope, binanceFacts, readModelRefreshVersion = 0 }: {
  accounts: OverviewAccount[];
  accountFacts?: AccountFactsSnapshot | null;
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
  const [chartAccountId, setChartAccountId] = useState<string | null>(null);
  const [range, setRange] = useState<ChartRange>(DEFAULT_CHART_RANGE);
  const [currency, setCurrency] = useState<string>("");
  const [history, setHistory] = useState<AccountFactsHistorySnapshot | null>(null);
  const [walletHistory, setWalletHistory] = useState<BinanceWalletHistorySnapshot | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [benchmarkFrameWidth, setBenchmarkFrameWidth] = useState(0);
  const benchmarkFrameContainer = useRef<HTMLDivElement | null>(null);
  const runtimeToday = runtimeBusinessDate();
  const [runtimeDate, setRuntimeDate] = useState(runtimeToday);
  const [runtimeDaily, setRuntimeDaily] = useState<RuntimeDailySnapshot | null>(null);
  const [privateScopeNow, setPrivateScopeNow] = useState(() => Date.now());
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const historyEpoch = useRef(0);
  const runtimeEpoch = useRef(0);
  const emptyNote = chartRangeEmptyNote(range);
  const visible = accountId === "all" ? accounts : accounts.filter(account => account.id === accountId);
  const figures = overviewFigures(accounts.length ? visible.length : null, visible.map(account => account.preference));
  const optionLabel = (account: OverviewAccount) => {
    const duplicates = accounts.filter(item => item.title === account.title);
    if (duplicates.length < 2 || !account.environment) return account.title;
    return `${account.title} · ${account.environment}`;
  };
  const healthText = (label: string) => label === "已停用" || label === "监测正常" || label === "异常" || label === "等待周期" ? label : "待确认";
  const activationText = (label: string) => label === "已启用" || label === "已停用" ? label : "待确认";
  const selectedAccount = accountId === "all" ? null : (visible[0] || null);
  const selectedWalletValuation = selectedAccount?.platformKey === "binance"
    && selectedAccount.id === walletAccount?.id ? walletValuation : null;
  useEffect(() => {
    if (accountId !== "all") return;
    if (chartAccountId && accounts.some((account) => account.id === chartAccountId)) return;
    setChartAccountId(defaultOverviewChartAccountId(accounts));
  }, [accountId, chartAccountId, accounts]);
  const chartAccount = resolveOverviewChartAccount(accounts, accountId, chartAccountId);
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
    if (chart !== "return") {
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
  }, [chart]);
  const binancePrivateScope = presentBinancePrivateScope(
    privateScope?.error ? null : privateScope?.value,
    { admin: isAdmin === true, allAccounts: accountId === "all", now: privateScopeNow },
  );
  const selectedFacts = selectedAccount?.facts || null;
  const chartFacts = chartAccount?.facts || null;
  const walletChartSelected = chartAccount?.platformKey === "binance";
  const currencyOptions = walletChartSelected ? ["USDT"] : Array.from(new Set([
    ...(chartFacts?.balances || []).map((row) => row.currency).filter(Boolean),
    ...(history?.series.points || []).map((row) => row.currency).filter(Boolean),
  ]));
  useEffect(() => {
    if (walletChartSelected) {
      if (currency !== "USDT") setCurrency("USDT");
      return;
    }
    if (!chartFacts) {
      setCurrency("");
      return;
    }
    const next = currencyOptions.includes(currency) ? currency : (currencyOptions[0] || "");
    if (next !== currency) setCurrency(next);
  }, [chartAccount?.id, walletChartSelected, chartFacts?.data_status, currencyOptions.join("|")]);
  useEffect(() => {
    const epoch = ++historyEpoch.current;
    if (!chartAccount || chart !== "assets" || !currency || (walletChartSelected && currency !== "USDT")) {
      setHistory(null);
      setWalletHistory(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    setHistory(null);
    setWalletHistory(null);
    setHistoryError(null);
    setHistoryLoading(true);
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
      return;
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
  }, [chartAccount?.id, chartAccount?.platformKey, chartAccount?.accountKey, chartFacts?.observed_finished_at,
    binanceFacts?.value?.report?.observed_finished_at, walletChartSelected, currency, chart]);
  useEffect(() => {
    const epoch = ++runtimeEpoch.current;
    const selection = selectedAccount
      ? { platform: selectedAccount.platformKey, accountKey: selectedAccount.accountKey }
      : null;
    if (!selectedAccount || !/^\d{4}-\d{2}-\d{2}$/.test(runtimeDate) || !runtimeDailySelectionEligible(selection)) {
      setRuntimeDaily(null);
      setRuntimeError(null);
      setRuntimeLoading(false);
      return;
    }
    setRuntimeDaily(null);
    setRuntimeError(null);
    setRuntimeLoading(true);
    void loadRuntimeDaily(runtimeDate)
      .then((payload) => {
        if (runtimeEpoch.current !== epoch) return;
        setRuntimeDaily(payload);
        setRuntimeLoading(false);
      })
      .catch((error) => {
        if (runtimeEpoch.current !== epoch) return;
        setRuntimeDaily(null);
        setRuntimeError(error instanceof Error ? error.message : "request_failed");
        setRuntimeLoading(false);
      });
  }, [selectedAccount?.id, selectedAccount?.platformKey, selectedAccount?.accountKey, runtimeDate, runtimeDate === runtimeToday ? readModelRefreshVersion : 0]);
  // All-account totals stay unavailable under partial broker identity. Only a
  // single selected account may show its own per-currency facts.
  const totalAssets = accountId === "all"
    ? null
    : selectedWalletValuation
      ? formatBinanceWalletAmount(selectedWalletValuation.amount)
      : formatAccountFactAmounts(selectedFacts?.data_status === "fresh" ? selectedFacts.balances : null, "net_assets");
  const totalCash = accountId === "all"
    ? null
    : formatAccountFactAmounts(
      selectedFacts?.data_status === "fresh" ? selectedFacts.cash : null,
      selectedAccount ? cashFieldForPlatform(selectedAccount.platformKey) : "available_cash",
    );
  const selectedCashField = selectedAccount ? cashFieldForPlatform(selectedAccount.platformKey) : "available_cash";
  const selectedCashRows = selectedFacts?.data_status === "fresh"
    && selectedFacts.binding_status === "bound" && selectedFacts.identity_mismatch !== true
    ? selectedFacts.cash : null;
  const selectedNegativeCash = hasNonzeroNegativeAccountFactAmount(selectedCashRows, selectedCashField);
  const showSelectedCashMetric = !selectedWalletValuation || totalCash !== null;
  const assetsDetail = accountId === "all"
    ? "请选择账户"
    : accountFactsDetail(selectedFacts);
  const cashDetail = accountId === "all"
    ? "请选择账户"
    : accountFactsDetail(selectedFacts);
  const selectedUpdatedAt = accountId === "all" ? null : accountFactsUpdatedAt(selectedFacts);
  const assetsMetricLabel = accountId === "all" ? "全部账户总额" : selectedWalletValuation ? "钱包总资产" : "总资产";
  const selectedCashLabel = selectedAccount ? cashLabelForPlatform(selectedAccount.platformKey) : "可用现金";
  const filteredWalletPoints = walletChartSelected
    ? filterAssetHistoryByRange(walletHistory?.points || [], range) : [];
  const filteredAccountPoints = walletChartSelected
    ? [] : filterAssetHistoryByRange(history?.series.points || [], range);
  const geometry = walletChartSelected
    ? buildBinanceWalletHistoryChartGeometry(filteredWalletPoints)
    : buildAssetChartGeometry(filteredAccountPoints);
  const hasChart = chart === "assets" && Boolean(chartAccount) && geometry.dots.length > 0;
  const runtimeView = presentRuntimeDaily(
    runtimeError ? null : runtimeDaily,
    selectedAccount
      ? { platform: selectedAccount.platformKey, accountKey: selectedAccount.accountKey }
      : null,
  );
  const chartEmptyTitle = chartUnavailable(chart);
  const chartEmptyDetail = chart === "return"
    ? "暂不可用"
    : historyLoading
        ? "加载中…"
        : historyError || history?.identity_mismatch
          ? "暂不可用"
          : accountId === "all" && !chartAccount
            ? "请选择图表账户"
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
  const runtimeRunTime = [formatInstant(runtimeView.runStartedAt), formatInstant(runtimeView.runFinishedAt)].filter(Boolean).join(" → ") || "—";
  const runtimeUpdated = formatInstant(runtimeView.updatedAt);
  const selectedUpdatedTime = formatInstant(selectedUpdatedAt);
  return <div className="daily-page overview-layout">
    <div className="daily-heading overview-head">
      <div><h1>{t("账户总览")}</h1>{selectedUpdatedTime ? <small className="overview-updated">{t("上次更新")} {selectedUpdatedTime}</small> : null}</div>
      <select className="account-filter" aria-label={t("全部账户")} value={accountId} onChange={event => setAccountId(event.target.value)}>
        <option value="all">{t("全部账户")}</option>
        {accounts.map(account => <option key={account.id} value={account.id}>{optionLabel(account)}</option>)}
      </select>
    </div>
    <section className={`metric-row overview-metrics${selectedWalletValuation ? " overview-metrics-wallet" : ""}`} aria-label={t("账户总览")}>
      <div><span>{t(assetsMetricLabel)}</span><strong>{amountOrDash(totalAssets)}</strong>
        {selectedWalletValuation
          ? <small>{selectedWalletValuation.currency} · {t("观察")} {formatShortInstant(selectedWalletValuation.observed_at) || "—"}</small>
          : detailLine(assetsDetail, null) ? <small>{detailLine(assetsDetail, null)}</small> : null}</div>
      {showSelectedCashMetric ? <div><span>{t(selectedCashLabel)}</span><strong>{amountOrDash(totalCash)}</strong>
        {selectedNegativeCash ? <small className="negative-cash-note">{t(negativeCashStatusForPlatform(selectedAccount!.platformKey))}</small> : null}
        {detailLine(cashDetail, null) ? <small>{detailLine(cashDetail, null)}</small> : null}</div> : null}
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
        {accountId === "all" ? <label>
          <span>{t("图表账户")}</span>
          <select aria-label={t("图表账户")} value={chartAccount?.id || ""} onChange={event => setChartAccountId(event.target.value || null)}>
            {!chartAccount ? <option value="">{t("请选择图表账户")}</option> : null}
            {accounts.map((account) => <option key={account.id} value={account.id}>{`${account.title} · ${account.environment} · ${account.platform}`}</option>)}
          </select>
        </label> : chartAccount ? <span>{`${chartAccount.title} · ${chartAccount.environment} · ${chartAccount.platform}`}</span> : null}
        {chartAccount ? <label>
          <span>{t("币种")}</span>
          <select aria-label={t("币种")} value={currency} onChange={event => setCurrency(event.target.value)} disabled={!currencyOptions.length}>
            {!currencyOptions.length ? <option value="">{t("暂无币种")}</option> : null}
            {currencyOptions.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label> : null}
        {chartAccount ? walletChartSelected
          ? <details className="overview-wallet-details"><summary>{t("数据范围")}</summary><small>{t("按 Binance 返回的钱包范围")}</small></details>
          : <small>{t("仅显示单个账户的资产变化")}{chartAccount.brokerEnvironment === "paper" || chartFacts?.account_scope === "paper" ? ` · ${t("模拟账户图表不计入总额")}` : ""}</small> : null}
      </div> : null}
      {chart === "return" ? <div className="overview-benchmark">
        <div className="overview-benchmark-heading">
          <h2>{t("标普500价格指数")}</h2>
          <p>{t("日收盘价，不含股息；市场基准不代表账户收益。")}</p>
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
        <div className="overview-account-return-empty">
          <strong>{t("暂无账户收益数据")}</strong>
          <p>{t("账户收益需要完整估值和资金进出记录。")}</p>
        </div>
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
    <section className="metric-row compact overview-stats">
      <div><span>{t("年化收益")}</span><strong>—</strong><small>{t("暂不可用")}</small></div>
      <div><span>{t("最大回撤")}</span><strong>—</strong><small>{t("暂不可用")}</small></div>
      <div><span>{t("风险偏好")}</span><strong>{preferenceLabel(figures.riskPreference, t)}</strong></div>
    </section>
    <section className="overview-runtime" aria-label={t("每日运行记录")}>
      <div className="overview-runtime-head">
        <h2>{t(runtimeView.title)}</h2>
        <label>
          <span>{t("业务日期")}</span>
          <input type="date" value={runtimeDate} max={runtimeToday} onChange={event => setRuntimeDate(event.target.value)} disabled={!selectedAccount} />
        </label>
      </div>
      {!selectedAccount ? <p>{t("请选择账户")}</p> : (runtimeLoading ? <p>{t("加载中…")}</p> : <>
        <div className="overview-runtime-grid">
          <div><span>{t("运行状态")}</span><strong>{t(runtimeView.statusLabel)}</strong>{runtimeView.statusDetails.length ? <small>{runtimeView.statusDetails.map((item) => t(item)).join(" ")}</small> : null}</div>
          <div><span>{t("运行时间")}</span><strong>{runtimeRunTime}</strong>{runtimeView.dataStatusLabel !== "—" ? <small>{runtimeUpdated && runtimeUpdated !== selectedUpdatedTime ? `${t(runtimeView.dataStatusLabel)} · ${t("上次更新")} ${runtimeUpdated}` : t(runtimeView.dataStatusLabel)}</small> : null}</div>
          <div><span>{t("成交明细")}</span><strong>{t(runtimeView.fillsLabel)}</strong></div>
        </div>
        {runtimeView.dryRun ? <p className="overview-runtime-flag">{t("只读演练")}</p> : null}
        {runtimeError ? <p>{t("暂不可用")}</p> : null}
      </>)}
    </section>
    <aside className="overview-accounts">
      <h2>{t("我的账户")}</h2>
      <div className="overview-account-list">
        {visible.map(account => {
          const walletCardValuation = presentBinanceWalletValuationForAccount(
            account.id,
            walletAccount?.id,
            showWallet ? wallet : null,
            walletNow,
          );
          const providerProductType = binanceProviderProductTypeForDisplay(
            wallet,
            showWallet && walletAccount?.id === account.id,
          );
          const assets = walletCardValuation
            ? formatBinanceWalletAmount(walletCardValuation.amount)
            : formatAccountFactAmounts(account.facts?.data_status === "fresh" ? account.facts.balances : null, "net_assets");
          const freshCashRows = account.facts?.data_status === "fresh" ? account.facts.cash : null;
          const cashField = cashFieldForPlatform(account.platformKey);
          const cash = formatAccountFactAmounts(
            freshCashRows,
            cashField,
          );
          const verifiedFreshCashRows = account.facts?.data_status === "fresh"
            && account.facts.binding_status === "bound" && account.facts.identity_mismatch !== true
            ? freshCashRows : null;
          const negativeCash = hasNonzeroNegativeAccountFactAmount(verifiedFreshCashRows, cashField);
          const factDetail = accountFactsDetail(account.facts);
          const updatedAt = accountFactsUpdatedAt(account.facts);
          const longBridgeCash = longBridgeCashDetails(account.facts);
          const statusNote = overviewCardStatusDetail(account.statusDetail);
          const cardDetail = walletCardValuation
            ? accountId === "all" ? `${t("观察")} ${formatShortInstant(walletCardValuation.observed_at) || "—"}` : null
            : detailLine(factDetail, formatInstant(updatedAt) === selectedUpdatedTime ? null : updatedAt);
          const paperConfigured = account.brokerEnvironment === "paper";
          const schwabType = verifiedSchwabAccountTypeToken(
            account.platformKey,
            account.facts?.data_status,
            account.facts?.broker_account_type,
          );
          const accountTypeLabel = paperConfigured
            ? t("模拟账户")
            : providerProductType
              ? t("API账户类型：现货")
              : schwabType
              ? `${t("账户类型")}: ${schwabType}`
              : t(overviewAccountTypeLabel());
          return <div key={account.id} className="overview-account-entry">
            <button type="button" className="overview-account" onClick={() => onOpenAccount(account.id)}>
            <strong>{account.title}</strong>
            <small>{accountTypeLabel}</small>
            {paperConfigured && providerProductType ? <small>{t("API账户类型：现货")}</small> : null}
            <small>{account.strategy}</small>
            {!walletCardValuation || accountId === "all" ? <span className={`overview-figures${walletCardValuation ? " overview-figures-wallet" : ""}`}>
              {walletCardValuation
                ? <span className="wallet-card-valuation">
                  <em>{t("钱包总资产")}</em>
                  <strong title={walletCardValuation.amount} aria-label={`${walletCardValuation.amount} ${walletCardValuation.currency}`}>
                    {amountOrDash(assets)}
                  </strong>
                  <small>{walletCardValuation.currency}</small>
                </span>
                : <span><em>{t("账户资产")}</em>{amountOrDash(assets)}</span>}
              {!walletCardValuation ? <span>
                <em>{t(cashLabelForPlatform(account.platformKey))}</em>{amountOrDash(cash)}
                {negativeCash ? <small className="negative-cash-note">{t(negativeCashStatusForPlatform(account.platformKey))}</small> : null}
              </span> : null}
            </span> : null}
            <span className="overview-marks"><span><em>{t("运行状态")}</em>{t(healthText(account.statusLabel))}</span><span><em>{t("启用")}</em>{t(activationText(account.activation))}</span></span>
            {statusNote ? <small>{t(statusNote)}</small> : null}
            {cardDetail ? <small>{cardDetail}</small> : null}
            </button>
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
          </div>;
        })}
      </div>
    </aside>
  </div>;
}
