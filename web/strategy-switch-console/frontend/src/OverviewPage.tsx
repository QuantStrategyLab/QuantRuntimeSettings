import { useState } from "react";
import { useT } from "./locales";
import { CHART_RANGE_OPTIONS, DEFAULT_CHART_RANGE, chartRangeNote, chartUnavailable, overviewFigures, type ChartMode, type ChartRange } from "./presentation";

export type OverviewAccount = {
  id: string;
  title: string;
  platform: string;
  environment: string;
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

const CHART_MODES: Array<{ id: ChartMode; label: "收益率" | "账户资产" | "现金" }> = [
  { id: "return", label: "收益率" },
  { id: "assets", label: "账户资产" },
  { id: "cash", label: "现金" },
];

export function OverviewPage({ accounts, decisions, decisionsBlocked, onOpenAccount, onOpenDecisions }: {
  accounts: OverviewAccount[];
  decisions: number;
  decisionsBlocked: boolean;
  onOpenAccount: (id: string) => void;
  onOpenDecisions: () => void;
}) {
  const t = useT();
  const [accountId, setAccountId] = useState("all");
  const [chart, setChart] = useState<ChartMode>("assets");
  const [range, setRange] = useState<ChartRange>(DEFAULT_CHART_RANGE);
  const rangeNote = chartRangeNote(range);
  const visible = accountId === "all" ? accounts : accounts.filter(account => account.id === accountId);
  const figures = overviewFigures(accounts.length ? visible.length : null, visible.map(account => account.preference));
  const showRail = decisions > 0;
  const optionLabel = (account: OverviewAccount) => accounts.filter(item => item.title === account.title).length > 1 ? `${account.title} · ${account.platform}` : account.title;
  return <div className={`daily-page${showRail ? " with-rail" : ""}`}>
    <div className="daily-heading overview-head">
      <h1>{t("账户总览")}</h1>
      <select className="account-filter" aria-label={t("全部账户")} value={accountId} onChange={event => setAccountId(event.target.value)}>
        <option value="all">{t("全部账户")}</option>
        {accounts.map(account => <option key={account.id} value={account.id}>{optionLabel(account)}</option>)}
      </select>
    </div>
    <section className="metric-row overview-metrics" aria-label={t("账户总览")}>
      <div><span>{t("总资产")}</span><strong>—</strong></div>
      <div><span>{t("可用现金")}</span><strong>—</strong></div>
      <div><span>{t("账户配置")}</span><strong>{figures.accountCount ?? "—"}</strong></div>
    </section>
    <section className="chart-panel overview-chart">
      <div className="chart-toolbar">
        <div className="chart-switch" role="tablist" aria-label={t("账户资产")}>
          {CHART_MODES.map(mode => <button key={mode.id} type="button" role="tab" aria-selected={chart === mode.id} className={chart === mode.id ? "active" : ""} onClick={() => setChart(mode.id)}>{t(mode.label)}</button>)}
        </div>
        <div className="chart-range" role="tablist" aria-label={t("图表范围")}>
          {CHART_RANGE_OPTIONS.map(option => <button key={option.id} type="button" role="tab" aria-selected={range === option.id} className={range === option.id ? "active" : ""} onClick={() => setRange(option.id)}>{t(option.label)}</button>)}
        </div>
      </div>
      <div className="chart-empty"><strong>{t(chartUnavailable(chart))}</strong><p>{t(rangeNote.key, { range: t(rangeNote.rangeLabel) })}</p></div>
    </section>
    <section className="metric-row compact overview-stats">
      <div><span>{t("年化收益")}</span><strong>—</strong></div>
      <div><span>{t("最大回撤")}</span><strong>—</strong></div>
      <div><span>{t("风险偏好")}</span><strong>{preferenceLabel(figures.riskPreference, t)}</strong></div>
    </section>
    <section className="account-table-wrap overview-table">
      <h2>{t("我的账户")}</h2>
      <table className="daily-table">
        <thead><tr><th>{t("账户")}</th><th>{t("当前策略")}</th><th>{t("状态")}</th><th>{t("启用策略")}</th></tr></thead>
        <tbody>
          {visible.map(account => <tr key={account.id}>
            <td className="account-identity"><button type="button" className="table-link" onClick={() => onOpenAccount(account.id)}><strong>{account.title}</strong></button><small>{account.platform}</small><small>{account.environment}</small></td>
            <td>{account.strategy}</td>
            <td>{account.statusLabel === "—" ? "—" : t(account.statusLabel)}</td>
            <td>{account.activation === "—" ? "—" : t(account.activation)}</td>
          </tr>)}
        </tbody>
      </table>
    </section>
    {showRail && <aside className="decision-rail">
      <h2>{t("待办决策")}</h2>
      <p>{decisions === 1 ? t("一项事项等待你的决定") : t("{count} 项事项等待你的决定", { count: decisions })}</p>
      {decisionsBlocked && <p>{t("部分待办暂时无法读取")}</p>}
      <button type="button" className="button button-primary" onClick={onOpenDecisions}>{t("查看建议")}</button>
    </aside>}
  </div>;
}
