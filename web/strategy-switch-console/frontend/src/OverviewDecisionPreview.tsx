import { shown } from "./DecisionsPage";
import { useT, useLocale } from "./locales";
import { decisionSourceFailureLabels, unreadDecisionSourceLabels, type DailyDecision, type DecisionSourceStatuses } from "./presentation";

export function OverviewDecisionPreview({ items, sources, onOpen }: { items: DailyDecision[]; sources?: DecisionSourceStatuses; onOpen?: () => void }) {
  const t = useT();
  const language = useLocale();
  const unread = sources ? unreadDecisionSourceLabels(sources).map(label => t(label)) : [];
  const failed = sources ? decisionSourceFailureLabels(sources).map(label => t(label)) : [];
  return <section className="overview-panel overview-pending" aria-label={t("待办决策")}>
    <div className="overview-panel-heading"><h2>{t("待办决策")}</h2>{onOpen ? <button type="button" className="text-link" onClick={onOpen}>{t("查看全部")}</button> : null}</div>
    {unread.length ? <p className="overview-panel-note" role="status">{t(failed.length ? "待办来源读取失败：{sources}" : "待办来源未取得：{sources}", { sources: unread.join(language === "zh" ? "、" : ", ") })}</p> : null}
    {items.length ? <ul className="overview-pending-list">{items.slice(0, 3).map(item => <li key={item.id}><button type="button" disabled={!onOpen} onClick={onOpen}><span className="overview-pending-dot" /><span><small>{t(item.kicker)}</small><strong>{shown(item.title, t)}</strong>{item.kind !== "maintenance" && <small>{t("材料编号")}：{item.reference}</small>}</span><span aria-hidden="true">›</span></button></li>)}</ul> : <p className="overview-panel-empty">{t(unread.length ? "部分待办暂时无法读取" : "暂无需要你决定的事项")}</p>}
  </section>;
}
