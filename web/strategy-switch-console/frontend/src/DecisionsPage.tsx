import { useId, useState } from "react";
import { useLocale, useT } from "./locales";
import { StrategyIdentity } from "./StrategyIdentity";
import {
  decisionActionState,
  unreadDecisionSourceLabels,
  unnamedDecisionOrdinal,
  type DailyDecision,
  type DecisionSourceStatuses,
} from "./presentation";

export function DecisionCount({ count }: { count: number }) {
  const t = useT();
  if (!(count > 0)) return null;
  return <span className="count-badge" aria-label={t("{count} 项待办", { count })}>{count > 99 ? "99+" : String(count)}</span>;
}

function shown(value: string, t: (key: string) => string): string {
  return value === "未命名策略" || value === "当前策略" || value === "保持暂停" || value === "有限观察" || value === "待确认材料" || value === "确认材料" || value === "有限执行观察" || value === "恢复核对" ? t(value) : value;
}

function joinSourceNames(labels: string[], language: "zh" | "en"): string {
  return labels.join(language === "zh" ? "、" : ", ");
}

export function DecisionsPage({ blocked, sources, items, admin, busy, selectedAccountId, onSelectAccount, onDecide }: {
  blocked: boolean;
  sources?: DecisionSourceStatuses;
  items: DailyDecision[];
  admin: boolean;
  busy: boolean;
  selectedAccountId: string;
  onSelectAccount: (id: string) => void;
  onDecide: (item: DailyDecision, decision: "adopt" | "reject") => void;
}) {
  const t = useT();
  const language = useLocale();
  const detailId = useId();
  const [selectedId, setSelectedId] = useState(items[0]?.id || "");
  const [showPlan, setShowPlan] = useState(false);
  const selected = items.find(item => item.id === selectedId) || items[0] || null;
  const unread = sources ? unreadDecisionSourceLabels(sources).map(label => t(label)) : [];
  const unreadNames = joinSourceNames(unread, language);
  if (!items.length) {
    const emptyMessage = blocked && unreadNames
      ? t("暂时读不到：{sources}", { sources: unreadNames })
      : blocked
        ? t("暂时读不到：{sources}", { sources: joinSourceNames([t("晋级方案"), t("负责人决定"), t("对账恢复")], language) })
        : t("暂无需要你决定的事项");
    return <section className="daily-page home-decisions"><h1>{t("待办决策")}</h1><div className="empty-state"><strong>{emptyMessage}</strong></div></section>;
  }
  return <section className="daily-page decisions-page home-decisions">
    <div className="daily-heading"><h1>{t("待办决策")}</h1><DecisionCount count={items.length} /></div>
    {blocked && <p className="workflow-note" role="status"><strong>{t("部分待办暂时无法读取")}</strong> {t("{sources} 暂时读不到。以下仅显示已读取的事项，待办列表可能不完整。", { sources: unreadNames || joinSourceNames([t("晋级方案"), t("负责人决定"), t("对账恢复")], language) })}</p>}
    <div className="decision-layout">
      <div className="decision-list" role="group" aria-label={t("待办事项")}>
        {items.map((item, index) => <button key={item.id} id={`${detailId}-item-${index}`} type="button" aria-pressed={selected?.id === item.id} aria-controls={detailId} className={selected?.id === item.id ? "active" : ""} onClick={() => { setSelectedId(item.id); setShowPlan(false); }}>
          <small>{t(item.kicker)}</small><strong>{shown(item.title, t)}{unnamedDecisionOrdinal(items, item) ? ` ${unnamedDecisionOrdinal(items, item)}` : ""}</strong>
          <small className="decision-reference">{t("材料编号")}：{item.reference}</small>
        </button>)}
      </div>
      {selected && <article id={detailId} className="decision-detail" aria-labelledby={`${detailId}-item-${items.indexOf(selected)}`}>
        <p className="kicker">{t(selected.kicker)}</p>
        <h2>{t(selected.question)}</h2>
        {selected.accountChoices.length === 1 ? <p>{selected.accountChoices[0].label}</p> : selected.accountLine ? <p>{t(selected.accountLine)}</p> : null}
        {selected.accountChoices.length > 1 && <label>{t("选择应用账户")}<select value={selectedAccountId} onChange={event => onSelectAccount(event.target.value)}><option value="">{t("选择一个账户")}</option>{selected.accountChoices.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}</select></label>}
        <dl className="decision-facts">
          <div><dt>{t("现在")}</dt><dd>{shown(selected.currentName, t)}</dd></div>
          <div><dt>{t("建议")}</dt><dd>{shown(selected.proposedName, t)}</dd></div>
          <div><dt>{t("影子结果")}</dt><dd>{t(selected.shadowReadout || "没有记录")}</dd></div>
        </dl>
        <div className="plan-compare"><div><span>{t("当前方案")}</span><strong>{shown(selected.currentName, t)}</strong></div><div><span>{t("建议方案")}</span><strong>{shown(selected.proposedName, t)}</strong></div></div>
        {selected.explanationKind === "ai" && selected.explanation ? <section className="ai-explanation"><h3>{t("候选说明")}</h3><p>{t("问题")}：{selected.explanation.question}</p><p>{t("依据")}：{selected.explanation.basis}</p><p>{t("限制")}：{selected.explanation.limits}</p><p>{t("建议")}：{selected.explanation.suggestion}</p><details><summary>{t("来源与模型")}</summary><p>{selected.explanation.provider}</p><p>{selected.explanation.model}</p></details></section> : <section><h3>{t("系统摘要")}</h3><p>{t(selected.impact)}</p></section>}
        {selected.explanationKind === "ai" && selected.explanation && <><h3>{t("影响与风险")}</h3><p>{t(selected.impact)}</p></>}
        {selected.materialNotes.length > 0 && <section className="decision-materials"><h3>{t("审阅材料")}</h3><ul>{selected.materialNotes.map(note => <li key={note}>{t(note)}</li>)}</ul></section>}
        <button type="button" className="text-link" aria-expanded={showPlan} aria-controls={`${detailId}-plan`} onClick={() => setShowPlan(value => !value)}>{t("查看方案")}</button>
        {showPlan && <pre id={`${detailId}-plan`}>{selected.technical}</pre>}
        <StrategyIdentity key={selected.id} value={selected.identity} />
        <p className="section-note" id={`${detailId}-intent`}>{t("以下操作只记录人工意向，不会应用策略、启用账户或提交订单。")}</p>
        <div className="form-actions">
          {selected.canReject && <button type="button" className="button button-secondary" aria-describedby={`${detailId}-intent`} disabled={!decisionActionState(selected, { admin, busy, selectedAccountId }).rejectEnabled} onClick={() => onDecide(selected, "reject")}>{t("记录不采用意向")}</button>}
          {selected.canAdopt && <button type="button" className="button button-primary" aria-describedby={`${detailId}-intent`} disabled={!decisionActionState(selected, { admin, busy, selectedAccountId }).adoptEnabled} onClick={() => onDecide(selected, "adopt")}>{t("记录采用意向")}</button>}
        </div>
      </article>}
    </div>
  </section>;
}
