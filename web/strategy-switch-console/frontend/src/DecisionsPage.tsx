import { useState } from "react";
import { useT } from "./locales";
import { decisionActionState, type DailyDecision } from "./presentation";

function shown(value: string, t: (key: string) => string): string {
  return value === "未命名策略" || value === "当前策略" || value === "保持暂停" || value === "有限观察" || value === "待确认材料" || value === "确认材料" || value === "有限执行观察" || value === "恢复核对" ? t(value) : value;
}

export function DecisionsPage({ blocked, items, admin, busy, selectedAccountId, onSelectAccount, onDecide }: {
  blocked: boolean;
  items: DailyDecision[];
  admin: boolean;
  busy: boolean;
  selectedAccountId: string;
  onSelectAccount: (id: string) => void;
  onDecide: (item: DailyDecision, decision: "adopt" | "reject") => void;
}) {
  const t = useT();
  const [selectedId, setSelectedId] = useState(items[0]?.id || "");
  const [showPlan, setShowPlan] = useState(false);
  const selected = items.find(item => item.id === selectedId) || items[0] || null;
  if (!items.length) {
    return <section className="daily-page"><h1>{t("待办决策")}</h1><div className="empty-state"><strong>{t(blocked ? "待办暂不可用" : "暂无需要你决定的事项")}</strong>{blocked && <p>{t("来源暂不可用，不能把缺失说成没有待办。")}</p>}</div></section>;
  }
  return <section className="daily-page decisions-page">
    <div className="daily-heading"><h1>{t("待办决策")}</h1><span>{items.length}</span></div>
    {blocked && <p className="section-note">{t("来源暂不可用，不能把缺失说成没有待办。")}</p>}
    <div className="decision-layout">
      <div className="decision-list">
        {items.map(item => <button key={item.id} type="button" className={selected?.id === item.id ? "active" : ""} onClick={() => { setSelectedId(item.id); setShowPlan(false); }}>
          <small>{t(item.kicker)}</small><strong>{shown(item.title, t)}</strong>
        </button>)}
      </div>
      {selected && <article className="decision-detail">
        <p className="kicker">{t(selected.kicker)}</p>
        <h2>{t(selected.question)}</h2>
        {selected.accountLine && <p>{t(selected.accountLine)}</p>}
        {selected.accountChoices.length > 1 && <label>{t("选择应用账户")}<select value={selectedAccountId} onChange={event => onSelectAccount(event.target.value)}><option value="">{t("选择一个账户")}</option>{selected.accountChoices.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}</select></label>}
        {selected.accountChoices.length === 1 && <p>{selected.accountChoices[0].label}</p>}
        <div className="plan-compare"><div><span>{t("当前方案")}</span><strong>{shown(selected.currentName, t)}</strong></div><div><span>{t("建议方案")}</span><strong>{shown(selected.proposedName, t)}</strong></div></div>
        {selected.explanationKind === "ai" && selected.explanation ? <section className="ai-explanation"><h3>{t("候选说明")}</h3><p>{t("问题")}：{selected.explanation.question}</p><p>{t("依据")}：{selected.explanation.basis}</p><p>{t("限制")}：{selected.explanation.limits}</p><p>{t("建议")}：{selected.explanation.suggestion}</p><details><summary>{t("来源与模型")}</summary><p>{selected.explanation.provider}</p><p>{selected.explanation.model}</p></details></section> : <section><h3>{t("系统摘要")}</h3><p>{t(selected.impact)}</p></section>}
        {selected.explanationKind === "ai" && selected.explanation && <><h3>{t("影响与风险")}</h3><p>{t(selected.impact)}</p></>}
        <button type="button" className="text-link" aria-expanded={showPlan} onClick={() => setShowPlan(value => !value)}>{t("查看方案")}</button>
        {showPlan && <pre>{selected.technical}</pre>}
        <div className="form-actions">
          {selected.canReject && <button type="button" className="button button-secondary" disabled={!decisionActionState(selected, { admin, busy, selectedAccountId }).rejectEnabled} onClick={() => onDecide(selected, "reject")}>{t("不采用")}</button>}
          {selected.canAdopt && <button type="button" className="button button-primary" disabled={!decisionActionState(selected, { admin, busy, selectedAccountId }).adoptEnabled} onClick={() => onDecide(selected, "adopt")}>{t("采用")}</button>}
        </div>
      </article>}
    </div>
  </section>;
}
