import { useEffect, useRef, useState } from "react";
import { loadAccountFactsHistory, loadRuntimeDaily } from "./api";
import { useT, useLocale } from "./locales";
import {
  CHART_RANGE_OPTIONS,
  DEFAULT_CHART_RANGE,
  RETURN_INDEX_LEGEND,
  buildAssetChartGeometry,
  chartRangeEmptyNote,
  chartUnavailable,
  filterAssetHistoryByRange,
  formatOverviewInstant,
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
  scheduleBinancePrivateScopeExpiry,
  type ChartMode,
  type ChartRange,
  type RuntimeDailySnapshot,
} from "./presentation";
import {
  accountFactsDetail,
  accountFactsUpdatedAt,
  formatAccountFactAmounts,
  type AccountFactsAccount,
  type AccountFactsHistorySnapshot,
  type AccountFactsSnapshot,
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

function cashFieldForPlatform(platform: string): "cash_balance" | "available_cash" {
  return platform === "ibkr" || platform === "schwab" ? "cash_balance" : "available_cash";
}

function cashLabelForPlatform(platform: string): "现金余额" | "可用现金" {
  return platform === "ibkr" || platform === "schwab" ? "现金余额" : "可用现金";
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
  const [currency, setCurrency] = useState<string>("");
  const [history, setHistory] = useState<AccountFactsHistorySnapshot | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
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
  const healthText = (label: string) => label === "已停用" || label === "监测正常" || label === "异常" ? label : "待确认";
  const activationText = (label: string) => label === "已启用" || label === "已停用" ? label : "待确认";
  const selectedAccount = accountId === "all" ? null : (visible[0] || null);
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
  const binancePrivateScope = presentBinancePrivateScope(
    privateScope?.error ? null : privateScope?.value,
    { admin: isAdmin === true, allAccounts: accountId === "all", now: privateScopeNow },
  );
  const selectedFacts = selectedAccount?.facts || null;
  const currencyOptions = Array.from(new Set([
    ...(selectedFacts?.balances || []).map((row) => row.currency).filter(Boolean),
    ...(history?.series.points || []).map((row) => row.currency).filter(Boolean),
  ]));
  useEffect(() => {
    if (!selectedFacts) {
      setCurrency("");
      return;
    }
    const next = currencyOptions.includes(currency) ? currency : (currencyOptions[0] || "");
    if (next !== currency) setCurrency(next);
  }, [selectedAccount?.id, selectedFacts?.data_status, currencyOptions.join("|")]);
  useEffect(() => {
    const epoch = ++historyEpoch.current;
    if (!selectedAccount || chart !== "assets" || !currency) {
      setHistory(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    setHistory(null);
    setHistoryError(null);
    setHistoryLoading(true);
    void loadAccountFactsHistory(selectedAccount.platformKey, selectedAccount.accountKey, currency)
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
  }, [selectedAccount?.id, selectedAccount?.platformKey, selectedAccount?.accountKey, selectedFacts?.observed_finished_at, currency, chart]);
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
    : formatAccountFactAmounts(selectedFacts?.data_status === "fresh" ? selectedFacts.balances : null, "net_assets");
  const totalCash = accountId === "all"
    ? null
    : formatAccountFactAmounts(
      selectedFacts?.data_status === "fresh" ? selectedFacts.cash : null,
      selectedAccount ? cashFieldForPlatform(selectedAccount.platformKey) : "available_cash",
    );
  const assetsDetail = accountId === "all"
    ? "请选择账户"
    : accountFactsDetail(selectedFacts);
  const cashDetail = accountId === "all"
    ? "请选择账户"
    : accountFactsDetail(selectedFacts);
  const selectedUpdatedAt = accountId === "all" ? null : accountFactsUpdatedAt(selectedFacts);
  const assetsMetricLabel = accountId === "all" ? "全部账户总额" : "总资产";
  const selectedCashLabel = selectedAccount ? cashLabelForPlatform(selectedAccount.platformKey) : "可用现金";
  const filteredPoints = filterAssetHistoryByRange(history?.series.points || [], range);
  const geometry = buildAssetChartGeometry(filteredPoints);
  const hasChart = chart === "assets" && Boolean(selectedAccount) && geometry.dots.length > 0;
  const runtimeView = presentRuntimeDaily(
    runtimeError ? null : runtimeDaily,
    selectedAccount
      ? { platform: selectedAccount.platformKey, accountKey: selectedAccount.accountKey }
      : null,
  );
  const chartEmptyTitle = accountId === "all" && chart === "assets"
    ? "请选择账户"
    : chartUnavailable(chart);
  const chartEmptyDetail = chart === "return"
    ? "暂不可用"
    : accountId === "all"
      ? "请选择账户"
      : historyLoading
        ? "加载中…"
        : historyError || history?.identity_mismatch
          ? "暂不可用"
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
    <section className="metric-row overview-metrics" aria-label={t("账户总览")}>
      <div><span>{t(assetsMetricLabel)}</span><strong>{amountOrDash(totalAssets)}</strong>{detailLine(assetsDetail, null) ? <small>{detailLine(assetsDetail, null)}</small> : null}</div>
      <div><span>{t(selectedCashLabel)}</span><strong>{amountOrDash(totalCash)}</strong>{detailLine(cashDetail, null) ? <small>{detailLine(cashDetail, null)}</small> : null}</div>
    </section>
    {showWallet ? <section id="binance-account-facts-board" className="overview-private-scope" aria-label={t(walletValuation ? "钱包总资产" : "现货与活期理财")}>
      <div className="overview-private-scope-head">
        <h2>{t(walletValuation ? "钱包总资产" : "现货与活期理财")}</h2>
        <small>{t(walletValuation ? "读取时间" : "上次更新")} {formatInstant(walletValuation?.observed_at || wallet.observed_finished_at)}</small>
      </div>
      {walletValuation ? <div className="overview-wallet-valuation">
        <strong>{walletValuation.amount}</strong><span>{walletValuation.currency}</span>
        <small>{t("按 Binance 返回的钱包范围")}</small>
      </div> : <>
        <small>{t("资产按原生数量显示；其他钱包未覆盖")}</small>
        <div className="overview-wallet-list">
          <div className="overview-wallet-row overview-private-scope-labels"><span>{t("资产")}</span><span>{t("可用数量")}</span><span>{t("冻结数量")}</span><span>{t("活期理财数量")}</span></div>
          {wallet.assets.map((item: { asset: string; spot_free: string; spot_locked: string; flexible_earn: string }) => <div className="overview-wallet-row" key={item.asset}>
            <strong>{item.asset}</strong><span>{item.spot_free}</span><span>{item.spot_locked}</span><span>{item.flexible_earn}</span>
          </div>)}
          {!wallet.assets.length ? <small>{t("暂无非零资产")}</small> : null}
        </div>
      </>}
    </section> : null}
    {binancePrivateScope?.assets.length ? <section id="binance-private-scope-board" className="overview-private-scope" aria-label={t("Binance非策略现货资产")}>
      <div className="overview-private-scope-head">
        <h2>{t("Binance非策略现货资产")}</h2>
        <small>{t("观察时间")} {formatInstant(binancePrivateScope.observed_at)}</small>
      </div>
      <div className="overview-private-scope-list">
        <div className="overview-private-scope-row overview-private-scope-labels"><span>{t("资产")}</span><span>{t("可用数量")}</span><span>{t("冻结数量")}</span></div>
        {binancePrivateScope.assets.map((item) => <div className="overview-private-scope-row" key={item.asset}>
          <strong>{item.asset}</strong><span>{item.free}</span><span>{item.locked}</span>
        </div>)}
      </div>
    </section> : null}
    <section className="chart-panel overview-chart">
      <div className="chart-toolbar">
        <div className="chart-switch" role="tablist" aria-label={t("图表")}>
          {CHART_MODES.map(mode => <button key={mode.id} type="button" role="tab" aria-selected={chart === mode.id} className={chart === mode.id ? "active" : ""} onClick={() => setChart(mode.id)}>{t(mode.label)}</button>)}
        </div>
        <div className="chart-range" role="tablist" aria-label={t("图表范围")}>
          {CHART_RANGE_OPTIONS.map(option => <button key={option.id} type="button" role="tab" aria-selected={range === option.id} className={range === option.id ? "active" : ""} onClick={() => setRange(option.id)}>{t(option.label)}</button>)}
        </div>
      </div>
      {chart === "assets" && selectedAccount ? <div className="chart-currency">
        <label>
          <span>{t("币种")}</span>
          <select aria-label={t("币种")} value={currency} onChange={event => setCurrency(event.target.value)} disabled={!currencyOptions.length}>
            {!currencyOptions.length ? <option value="">{t("暂无币种")}</option> : null}
            {currencyOptions.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
      </div> : null}
      {hasChart ? <div className="asset-chart">
        <svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="img" aria-label={t("资产变化")}>
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
        {chart === "return" ? <ul className="chart-legend" aria-label={t("指数")}>{RETURN_INDEX_LEGEND.map(name => <li key={name}>{t(name)}</li>)}</ul> : null}
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
          const assets = walletCardValuation
            ? `${walletCardValuation.currency} ${walletCardValuation.amount}`
            : formatAccountFactAmounts(account.facts?.data_status === "fresh" ? account.facts.balances : null, "net_assets");
          const cash = formatAccountFactAmounts(
            account.facts?.data_status === "fresh" ? account.facts.cash : null,
            cashFieldForPlatform(account.platformKey),
          );
          const factDetail = accountFactsDetail(account.facts);
          const updatedAt = accountFactsUpdatedAt(account.facts);
          const statusNote = overviewCardStatusDetail(account.statusDetail);
          const cardDetail = walletCardValuation
            ? `${t("按 Binance 返回的钱包范围")} · ${t("观察时间")} ${formatInstant(walletCardValuation.observed_at) || "—"}`
            : detailLine(factDetail, formatInstant(updatedAt) === selectedUpdatedTime ? null : updatedAt);
          const paperConfigured = account.brokerEnvironment === "paper";
          const schwabType = verifiedSchwabAccountTypeToken(
            account.platformKey,
            account.facts?.data_status,
            account.facts?.broker_account_type,
          );
          const accountTypeLabel = paperConfigured
            ? t("模拟账户")
            : schwabType
              ? `${t("账户类型")}: ${schwabType}`
              : t(overviewAccountTypeLabel());
          return <button key={account.id} type="button" className="overview-account" onClick={() => onOpenAccount(account.id)}>
            <strong>{account.title}</strong>
            <small>{accountTypeLabel}</small>
            <small>{account.strategy}</small>
            <span className="overview-figures"><span><em>{t(walletCardValuation ? "钱包总资产" : "账户资产")}</em>{amountOrDash(assets)}</span><span><em>{t(cashLabelForPlatform(account.platformKey))}</em>{amountOrDash(cash)}</span></span>
            <span className="overview-marks"><span><em>{t("运行状态")}</em>{t(healthText(account.statusLabel))}</span><span><em>{t("启用")}</em>{t(activationText(account.activation))}</span></span>
            {statusNote ? <small>{t(statusNote)}</small> : null}
            {cardDetail ? <small>{cardDetail}</small> : null}
          </button>;
        })}
      </div>
    </aside>
  </div>;
}
