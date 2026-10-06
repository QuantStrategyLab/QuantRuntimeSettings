import { useContext } from "react";
import { LocaleContext, useT } from "./locales";
import type { StrategyIdentityView } from "./presentation";

const ROLE_LABELS: Record<string, string> = { candidate: "候选", challenger: "挑战者", champion: "当前优选" };
const LANE_LABELS: Record<string, string> = { research: "研究", shadow: "影子", paper: "模拟", live: "实盘", dry_run: "试运行" };

export function StrategyIdentity({ value }: { value: StrategyIdentityView | null | undefined }) {
  const t = useT();
  const language = useContext(LocaleContext);
  if (!value) return null;
  const rows: Array<[string, string | null]> = [
    ["身份来源", t(value.basis)], ["策略 ID", value.profileId], ["候选 ID", value.candidateId],
    ["候选版本", value.candidateVersion], ["研究 study", value.studyId],
    ["来源 revision（资料字段）", value.sourceRevision], ["配置摘要（资料字段）", value.configHash],
    ["研究角色（资料字段）", value.role ? t(ROLE_LABELS[value.role]) : null],
    ["运行通道（资料字段）", value.lane ? t(LANE_LABELS[value.lane]) : null], ["证据时间", value.evidenceAt],
  ];
  return <details className="decision-fold strategy-identity">
    <summary>{t("策略身份与版本")}</summary>
    <dl>{rows.map(([label, content]) => <div key={label}><dt>{t(label)}</dt><dd style={{ overflowWrap: "anywhere" }}>{content || t("未知")}</dd></div>)}</dl>
    <p className="section-note">{t("名称、目录可选通道与已保存配置不证明实际采用或运行状态。")}</p>
    {value.frozenResearch && <section>
      <h4>{t("冻结研究版本")}</h4>
      <p>{language === "en" ? value.frozenResearch.noteEn : value.frozenResearch.noteZh}</p>
      <dl>
        <dt>{t("冻结 UES revision")}</dt><dd style={{ overflowWrap: "anywhere" }}>{value.frozenResearch.sourceRevision}</dd>
        <dt>{t("冻结 QPK revision")}</dt><dd style={{ overflowWrap: "anywhere" }}>{value.frozenResearch.runtimeRevision || t("未知")}</dd>
        <dt>{t("冻结配置摘要")}</dt><dd style={{ overflowWrap: "anywhere" }}>{value.frozenResearch.configHash}</dd>
      </dl>
      <p className="section-note">{t("冻结研究索引不证明实际部署、采用或运行状态。")}</p>
    </section>}
  </details>;
}
