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

const CHART_MODES: Array<{ id: ChartMode; label: "收益率" | "总资产" }> = [
  { id: "return", label: "收益率" },
  { id: "assets", label: "总资产" },
];

export function OverviewPage({ accounts, onOpenAccount }: {
  accounts: OverviewAccount[];
  accountFacts?: AccountFactsSnapshot | null;
  onOpenAccount: (id: string) => void;
}) {
  const t = useT();
  const language = useLocale();
  const formatInstant = (value: string | null | undefined) => formatOverviewInstant(value, language);
  const [accountId, setAccountId] = useState("all");
  const [chart, setChart] = useState<ChartMode>("assets");
  const [range, setRange] = useState<ChartRange>(DEFAULT_CHART_RANGE);
  const [currency, setCurrency] = useState<string>("");
  const [history, setHistory] = useState<AccountFactsHistorySnapshot | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const runtimeToday = runtimeBusinessDate();
  const [runtimeDate, setRuntimeDate] = useState(runtimeToday);
  const [runtimeDaily, setRuntimeDaily] = useState<RuntimeDailySnapshot | null>(null);
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
  const healthText = (label: string) => label === "正常" || label === "异常" ? label : "待确认";
  const activationText = (label: string) => label === "已启用" || label === "已停用" ? label : "待确认";
  const selectedAccount = accountId === "all" ? null : (visible[0] || null);
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
  }, [selectedAccount?.id, selectedAccount?.platformKey, selectedAccount?.accountKey, currency, chart]);
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
  }, [selectedAccount?.id, selectedAccount?.platformKey, selectedAccount?.accountKey, runtimeDate]);
  // All-account totals stay unavailable under partial broker identity. Only a
  // single selected account may show its own per-currency facts.
  const totalAssets = accountId === "all"
    ? null
    : formatAccountFactAmounts(selectedFacts?.data_status === "fresh" ? selectedFacts.balances : null, "net_assets");
  const totalCash = accountId === "all"
    ? null
    : formatAccountFactAmounts(selectedFacts?.data_status === "fresh" ? selectedFacts.cash : null, "available_cash");
  const assetsDetail = accountId === "all"
    ? "请选择账户"
    : accountFactsDetail(selectedFacts);
  const cashDetail = accountId === "all"
    ? "请选择账户"
    : accountFactsDetail(selectedFacts);
  const selectedUpdatedAt = accountId === "all" ? null : accountFactsUpdatedAt(selectedFacts);
  const assetsMetricLabel = accountId === "all" ? "全部账户总额" : "总资产";
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
  return <div className="daily-page overview-layout">
    <div className="daily-heading overview-head">
      <h1>{t("账户总览")}</h1>
      <select className="account-filter" aria-label={t("全部账户")} value={accountId} onChange={event => setAccountId(event.target.value)}>
        <option value="all">{t("全部账户")}</option>
        {accounts.map(account => <option key={account.id} value={account.id}>{optionLabel(account)}</option>)}
      </select>
    </div>
    <section className="metric-row overview-metrics" aria-label={t("账户总览")}>
      <div><span>{t(assetsMetricLabel)}</span><strong>{amountOrDash(totalAssets)}</strong>{detailLine(assetsDetail, selectedUpdatedAt) ? <small>{detailLine(assetsDetail, selectedUpdatedAt)}</small> : null}</div>
      <div><span>{t("可用现金")}</span><strong>{amountOrDash(totalCash)}</strong>{detailLine(cashDetail, selectedUpdatedAt) ? <small>{detailLine(cashDetail, selectedUpdatedAt)}</small> : null}</div>
    </section>
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
          <div><span>{t("运行时间")}</span><strong>{runtimeRunTime}</strong>{runtimeView.dataStatusLabel !== "—" ? <small>{runtimeUpdated ? `${t(runtimeView.dataStatusLabel)} · ${t("上次更新")} ${runtimeUpdated}` : t(runtimeView.dataStatusLabel)}</small> : null}</div>
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
          const assets = formatAccountFactAmounts(account.facts?.data_status === "fresh" ? account.facts.balances : null, "net_assets");
          const cash = formatAccountFactAmounts(account.facts?.data_status === "fresh" ? account.facts.cash : null, "available_cash");
          const factDetail = accountFactsDetail(account.facts);
          const updatedAt = accountFactsUpdatedAt(account.facts);
          const statusNote = overviewCardStatusDetail(account.statusDetail);
          const paperConfigured = account.brokerEnvironment === "paper";
          return <button key={account.id} type="button" className="overview-account" onClick={() => onOpenAccount(account.id)}>
            <strong>{account.title}</strong>
            <small>{paperConfigured ? t("模拟账户") : t(overviewAccountTypeLabel())}</small>
            <small>{account.strategy}</small>
            <span className="overview-figures"><span><em>{t("账户资产")}</em>{amountOrDash(assets)}</span><span><em>{t("可用现金")}</em>{amountOrDash(cash)}</span></span>
            <span className="overview-marks"><span><em>{t("运行状态")}</em>{t(healthText(account.statusLabel))}</span><span><em>{t("启用")}</em>{t(activationText(account.activation))}</span></span>
            {statusNote ? <small>{t(statusNote)}</small> : null}
            {detailLine(factDetail, updatedAt) ? <small>{detailLine(factDetail, updatedAt)}</small> : null}
          </button>;
        })}
      </div>
    </aside>
  </div>;
}
