import { displayName } from "../../../../display_names.js";
import type { InboxResponse } from "../../api/contracts";
import type { Translate } from "../../i18n";

export function ReconciliationMaterials({ data, language, t, itemId }: {
  data?: InboxResponse | null;
  language: "zh" | "en";
  t: Translate;
  itemId?: string | null;
}) {
  const source = data?.sources.find(row => row.source === "recovery");
  const observation = source?.current_reconciliation_observation;
  const rows = (data?.items || []).filter(row =>
    row.category === "reconciliation_recovery" && (!itemId || row.id === itemId));
  // Keep the raw ISO instant in dateTime; show a localized browser-zone reading (SGT for this console's users).
  const timestamp = (value: string | null | undefined) => {
    if (!value || !Number.isFinite(Date.parse(value))) return t("common.unknown");
    const parts = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "shortOffset",
    }).formatToParts(new Date(value));
    const zone = parts.find(part => part.type === "timeZoneName")?.value || "";
    const text = parts.filter(part => part.type !== "timeZoneName").map(part => part.value).join("").trim();
    return <time dateTime={value}>{zone ? `${text} (${zone})` : text}</time>;
  };
  return <section className="reconciliation-materials" aria-label={t("reconciliation.title")}>
    <h2 className="card-title">{t("reconciliation.current")}</h2>
    <p role="status">{observation?.status_label[language] || t("reconciliation.not_connected")}</p>
    {observation?.last_observed_at && <p>{t("reconciliation.observed_at")}：{timestamp(observation.last_observed_at)}</p>}
    <p className="decision-note">{t("reconciliation.history_notice")}</p>
    <h2 className="card-title">{t("reconciliation.materials")}</h2>
    {source?.status !== "ok" && <p className="decision-note">{t(source?.status === "stale" ? "reconciliation.stale" : "reconciliation.read_unknown")}</p>}
    {!rows.length && <p>{t("reconciliation.empty")}</p>}
    {rows.map(item => {
      const material = item.presentation;
      const strategy = displayName("strategies", material?.strategy_profile || "", language, t("reconciliation.unnamed_strategy"));
      const account = displayName("accounts", item.account_alias || "", language, t("common.account"), item.platform || "");
      return <article key={item.id} className="reconciliation-material">
        <h3>{material?.label[language] || t("reconciliation.materials")}</h3>
        {/* A selected detail already carries the one traceable ref in its header, so the
            single-item context reuses it instead of repeating the number here. Collection
            rendering (no itemId) has no header of its own and keeps a per-row ref. */}
        <p>
          {strategy} · {account}
          {!itemId && <> · <span className="reconciliation-ref">{t("decisions.ref", { id: item.short_id })}</span></>}
        </p>
        <dl>
          <div><dt>{t("reconciliation.decision_status")}</dt><dd>{material?.decision_status_label[language] || t("reconciliation.decision_unknown")}</dd></div>
          <div><dt>{t("reconciliation.freshness")}</dt><dd>{t(item.evidence_freshness.status === "stale" ? "state.stale" : item.evidence_freshness.status === "ready" ? "decisions.freshness.ready" : "common.unknown")}</dd></div>
          <div><dt>{t("reconciliation.observed_at")}</dt><dd>{timestamp(material?.last_observed_at || item.evidence_freshness.as_of)}</dd></div>
          <div><dt>{t("reconciliation.generated_at")}</dt><dd>{timestamp(material?.source_generated_at)}</dd></div>
          <div><dt>{t("reconciliation.computed_at")}</dt><dd>{timestamp(material?.source_computed_at)}</dd></div>
        </dl>
      </article>;
    })}
  </section>;
}
