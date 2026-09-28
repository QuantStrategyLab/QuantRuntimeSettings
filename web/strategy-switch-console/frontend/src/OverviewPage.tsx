import { useState } from "react";
import { useT } from "./locales";
import { CHART_RANGE_OPTIONS, DEFAULT_CHART_RANGE, RETURN_INDEX_LEGEND, chartRangeNote, chartUnavailable, overviewFigures, type ChartMode, type ChartRange } from "./presentation";

export type OverviewAccount = {
  id: string;
  title: string;
  platform: string;
  environment: string;
  environmentSource: string;
  strategy: string;
  statusLabel: string;
  statusDetail: string;
  activation: string;
  preference: string | null;
};

function preferenceLabel(value: string | null, t: (key: string) => string): string {
  const labels: Record<string, string> = { CAPITAL_PRESERVATION: "保守", BALANCED_COMPOUNDING: "均衡", GROWTH_COMPOUNDING: "增长" };
  return value && labels[value] ? t(labels[value]) : "—";
}

const CHART_MODES: Array<{ id: ChartMode; label: "收益率" | "总资产" }> = [
  { id: "return", label: "收益率" },
  { id: "assets", label: "总资产" },
];

export function OverviewPage({ accounts, onOpenAccount }: {
  accounts: OverviewAccount[];
  onOpenAccount: (id: string) => void;
}) {
  const t = useT();
  const [accountId, setAccountId] = useState("all");
  const [chart, setChart] = useState<ChartMode>("assets");
  const [range, setRange] = useState<ChartRange>(DEFAULT_CHART_RANGE);
  const rangeNote = chartRangeNote(range);
  const visible = accountId === "all" ? accounts : accounts.filter(account => account.id === accountId);
  const figures = overviewFigures(accounts.length ? visible.length : null, visible.map(account => account.preference));
  const optionLabel = (account: OverviewAccount) => {
    const duplicates = accounts.filter(item => item.title === account.title);
    if (duplicates.length < 2 || !account.environment) return account.title;
    return `${account.title} · ${account.environment}`;
  };
  const healthText = (label: string) => label === "正常" || label === "异常" ? label : "待确认";
  const activationText = (label: string) => label === "已启用" || label === "已停用" ? label : "待确认";
  return <div className="daily-page overview-layout">
    <div className="daily-heading overview-head">
      <h1>{t("账户总览")}</h1>
      <select className="account-filter" aria-label={t("全部账户")} value={accountId} onChange={event => setAccountId(event.target.value)}>
        <option value="all">{t("全部账户")}</option>
        {accounts.map(account => <option key={account.id} value={account.id}>{optionLabel(account)}</option>)}
      </select>
    </div>
    <section className="metric-row overview-metrics" aria-label={t("账户总览")}>
      <div><span>{t("总资产")}</span><strong>—</strong><small>{t("账户资产快照尚未接入；未知不等于零。")}</small></div>
      <div><span>{t("可用现金")}</span><strong>—</strong><small>{t("可用现金尚未接入可信账户快照；未知不等于零。")}</small></div>
      <div><span>{t("账户配置")}</span><strong>{figures.accountCount ?? "—"}</strong></div>
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
      <div className="chart-empty">
        {chart === "return" ? <ul className="chart-legend" aria-label={t("指数数据尚未接入")}>{RETURN_INDEX_LEGEND.map(name => <li key={name}>{t(name)}</li>)}</ul> : null}
        <strong>{t(chartUnavailable(chart))}</strong>
        <p>{t(chart === "return"
          ? "缺少可信账户估值序列和完整资金流，收益率与回撤暂不可计算。"
          : "账户资产快照来源尚未接入；—表示未知，不表示资产为零。")}</p>
        <p>{t(rangeNote.key, { range: t(rangeNote.rangeLabel) })}</p>
      </div>
    </section>
    <section className="metric-row compact overview-stats">
      <div><span>{t("年化收益")}</span><strong>—</strong><small>{t("完整账户估值和外部资金流未接入，收益不可计算。")}</small></div>
      <div><span>{t("最大回撤")}</span><strong>—</strong><small>{t("尚无可信账户估值序列，回撤不可计算。")}</small></div>
      <div><span>{t("风险偏好")}</span><strong>{preferenceLabel(figures.riskPreference, t)}</strong></div>
    </section>
    <aside className="overview-accounts">
      <h2>{t("我的账户")}</h2>
      <div className="overview-account-list">
        {visible.map(account => <button key={account.id} type="button" className="overview-account" onClick={() => onOpenAccount(account.id)}>
          <strong>{account.title}</strong>
          <small>{t(account.environment)} · {t(account.environmentSource)}</small>
          <small>{account.strategy}</small>
          <span className="overview-figures"><span><em>{t("账户资产")}</em>—</span><span><em>{t("收益率")}</em>—</span></span>
          <span className="overview-marks"><span><em>{t("健康")}</em>{t(healthText(account.statusLabel))}</span><span><em>{t("启用")}</em>{t(activationText(account.activation))}</span></span>
          <small>{t(account.statusDetail)}</small>
        </button>)}
        <small>{t("普通策略应用和启用尚未接通；此处只读展示配置与运行观察。")}</small>
      </div>
    </aside>
  </div>;
}
