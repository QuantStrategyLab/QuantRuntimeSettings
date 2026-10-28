import type { AccountExecutionEvidence } from "../api/contracts";
import { useT, useLanguage } from "../i18n";
import { formatDateTime } from "../lib/format";

const reasonKeys = new Set(["not_connected", "read_failed", "permission_denied", "broker_environment_missing", "execution_config_missing", "dry_run_flag_missing", "environment_conflict"]);

/** Configuration evidence only. Unknown values never become active settings. */
export function ExecutionEvidence({ evidence, compact = false, showState = false }: { evidence?: AccountExecutionEvidence; compact?: boolean; showState?: boolean }) {
  const t = useT(), language = useLanguage();
  const checked = formatDateTime(evidence?.observed_at, language, true);
  const value = evidence?.value || "unknown";
  const reasons = evidence?.reason_codes?.length ? evidence.reason_codes :
    [evidence?.status && reasonKeys.has(evidence.status) ? evidence.status : "evidence_missing"];
  const source = evidence?.configuration_source === "RUNTIME_TARGET_JSON" ? "runtime_target"
    : evidence?.configuration_source === "CLOUD_RUN_SERVICE_TARGETS_JSON" ? "service_target" : "missing";
  const environmentKnown = evidence?.broker_environment === "live" || evidence?.broker_environment === "paper";
  const environment = t(evidence?.broker_environment === "live" ? "strategies.execution.live" : evidence?.broker_environment === "paper" ? "strategies.execution.paper" : "common.unknown");
  if (showState) {
    // Show the reason for unknown values; source and time remain in details.
    return <div className="execution-evidence-status">
      <span className={`badge badge-${value === "live" ? "warn" : value === "unknown" ? "unknown" : "accent"}`}>{t(`strategies.execution.${value}`)}</span>
      {value === "unknown" && <span>{reasons.map(reason => t(`accounts.execution.reason.${reasonKeys.has(reason) ? reason : "evidence_missing"}`)).join(" · ")}</span>}
    </div>;
  }
  if (compact) {
    // Unknown configuration stays off the card; repeating "Execution mode:
    // unknown / broker: unknown" on every card row was noise. A known mode is
    // still useful at a glance.
    if (value === "unknown") return null;
    return <div className="execution-evidence-compact">
      <span className="account-row execution-mode-row">
        <span>{t("accounts.execution.mode")}</span>
        <span>{t(`strategies.execution.${value}`)}</span>
      </span>
    </div>;
  }
  return <div className="section-stack">
    <span className={`badge badge-${value === "live" ? "warn" : value === "unknown" ? "unknown" : "accent"}`}>{t(`strategies.execution.${value}`)}</span>
    {environmentKnown && <span>{t("accounts.execution.broker_environment", { value: environment })}</span>}
    <details className="account-facts-notes">
      <summary>{t("accounts.data_notes")}</summary>
      <div className="section-stack">
        {value === "unknown" && <span>{reasons.map(reason => t(`accounts.execution.reason.${reasonKeys.has(reason) ? reason : "evidence_missing"}`)).join(" · ")}</span>}
        {!environmentKnown && <span>{t("accounts.execution.broker_environment", { value: environment })}</span>}
        <span>{t("accounts.execution.source", { value: t(`accounts.execution.source.${source}`) })}</span>
        <span>{t("accounts.execution.observed")} <time dateTime={evidence?.observed_at || undefined}>{checked.text}{checked.zone ? ` (${checked.zone})` : ""}</time></span>
        <span>{t("accounts.execution.config_only")}</span>
      </div>
    </details>
  </div>;
}

/**
 * One concise configuration note for a card's single expandable details block.
 * It never upgrades an unknown mode or broker environment into a definite one.
 */
export function ExecutionEvidenceNote({ evidence }: { evidence?: AccountExecutionEvidence }) {
  const t = useT(), language = useLanguage();
  const checked = formatDateTime(evidence?.observed_at, language, true);
  const value = evidence?.value || "unknown";
  const reasons = evidence?.reason_codes?.length ? evidence.reason_codes : ["evidence_missing"];
  const source = evidence?.configuration_source === "RUNTIME_TARGET_JSON" ? "runtime_target"
    : evidence?.configuration_source === "CLOUD_RUN_SERVICE_TARGETS_JSON" ? "service_target" : "missing";
  const environment = t(evidence?.broker_environment === "live" ? "strategies.execution.live" : evidence?.broker_environment === "paper" ? "strategies.execution.paper" : "common.unknown");
  return <div className="execution-evidence-note">
    <span className="account-row">
      <span>{t("accounts.execution.mode")}</span>
      <span>{t(`strategies.execution.${value}`)}</span>
    </span>
    {value === "unknown" && <p>{reasons.map(reason => t(`accounts.execution.reason.${reasonKeys.has(reason) ? reason : "evidence_missing"}`)).join(" · ")}</p>}
    <span className="account-row"><span>{t("accounts.execution.source", { value: "" })}</span><span>{t(`accounts.execution.source.${source}`)}</span></span>
    <span className="account-row"><span>{t("accounts.execution.broker_environment", { value: "" })}</span><span>{environment}</span></span>
    <span className="account-row"><span>{t("accounts.execution.observed")}</span><time dateTime={evidence?.observed_at || undefined}>{checked.text}{checked.zone ? ` (${checked.zone})` : ""}</time></span>
    <p>{t("accounts.execution.config_only")}</p>
  </div>;
}
