import type { AccountExecutionEvidence } from "../api/contracts";
import { useT, useLanguage } from "../i18n";
import { formatDateTime } from "../lib/format";

const reasonKeys = new Set(["not_connected", "read_failed", "permission_denied", "broker_environment_missing", "execution_config_missing", "dry_run_flag_missing", "environment_conflict"]);

/** Configuration evidence only. Unknown values never become active settings. */
export function ExecutionEvidence({ evidence, compact = false }: { evidence?: AccountExecutionEvidence; compact?: boolean }) {
  const t = useT(), language = useLanguage();
  const checked = formatDateTime(evidence?.observed_at, language, true);
  const value = evidence?.value || "unknown";
  const reasons = evidence?.reason_codes?.length ? evidence.reason_codes : ["evidence_missing"];
  const source = evidence?.configuration_source === "RUNTIME_TARGET_JSON" ? "runtime_target"
    : evidence?.configuration_source === "CLOUD_RUN_SERVICE_TARGETS_JSON" ? "service_target" : "missing";
  const environment = t(evidence?.broker_environment === "live" ? "strategies.execution.live" : evidence?.broker_environment === "paper" ? "strategies.execution.paper" : "common.unknown");
  if (compact) {
    return <div className="execution-evidence-compact">
      <span className="account-row execution-mode-row">
        <span>{t("accounts.execution.mode")}</span>
        <span className={value === "unknown" ? "execution-value-unknown" : undefined}>{t(`strategies.execution.${value}`)}</span>
      </span>
      <span className="execution-environment">{t("accounts.execution.broker_environment", { value: environment })}</span>
      {value === "unknown" && <details className="account-facts-notes execution-evidence-notes">
        <summary>{t("accounts.data_notes")}</summary>
        <p>{reasons.map(reason => t(`accounts.execution.reason.${reasonKeys.has(reason) ? reason : "evidence_missing"}`)).join(" · ")}</p>
        <p>{t("accounts.execution.config_only")}</p>
      </details>}
    </div>;
  }
  return <div className="section-stack">
    <span className={`badge badge-${value === "live" ? "warn" : value === "unknown" ? "unknown" : "accent"}`}>{t(`strategies.execution.${value}`)}</span>
    {value === "unknown" && <span>{reasons.map(reason => t(`accounts.execution.reason.${reasonKeys.has(reason) ? reason : "evidence_missing"}`)).join(" · ")}</span>}
    <span>{t("accounts.execution.broker_environment", { value: environment })}</span>
    <details className="account-facts-notes">
      <summary>{t("accounts.data_notes")}</summary>
      <div className="section-stack">
        <span>{t("accounts.execution.source", { value: t(`accounts.execution.source.${source}`) })}</span>
        <span>{t("accounts.execution.observed")} <time dateTime={evidence?.observed_at || undefined}>{checked.text}{checked.zone ? ` (${checked.zone})` : ""}</time></span>
        <span>{t("accounts.execution.config_only")}</span>
      </div>
    </details>
  </div>;
}
