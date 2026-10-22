import type { AccountExecutionEvidence } from "../api/contracts";
import { useT, useLanguage } from "../i18n";
import { formatDateTime } from "../lib/format";

const reasonKeys = new Set(["not_connected", "read_failed", "permission_denied", "broker_environment_missing", "execution_config_missing", "dry_run_flag_missing", "environment_conflict"]);

/** Configuration evidence only. Unknown values never become active settings. */
export function ExecutionEvidence({ evidence }: { evidence?: AccountExecutionEvidence }) {
  const t = useT(), language = useLanguage();
  const checked = formatDateTime(evidence?.observed_at, language, true);
  const value = evidence?.value || "unknown";
  const reasons = evidence?.reason_codes?.length ? evidence.reason_codes : ["evidence_missing"];
  const source = evidence?.configuration_source === "RUNTIME_TARGET_JSON" ? "runtime_target"
    : evidence?.configuration_source === "CLOUD_RUN_SERVICE_TARGETS_JSON" ? "service_target" : "missing";
  return <span className="section-stack">
    <span className={`badge badge-${value === "live" ? "warn" : value === "unknown" ? "unknown" : "accent"}`}>{t(`strategies.execution.${value}`)}</span>
    {value === "unknown" && <span>{reasons.map(reason => t(`accounts.execution.reason.${reasonKeys.has(reason) ? reason : "evidence_missing"}`)).join(" · ")}</span>}
    <span>{t("accounts.execution.broker_environment", { value: t(evidence?.broker_environment === "live" ? "strategies.execution.live" : evidence?.broker_environment === "paper" ? "strategies.execution.paper" : "common.unknown") })}</span>
    <span>{t("accounts.execution.source", { value: t(`accounts.execution.source.${source}`) })}</span>
    <span>{t("accounts.execution.observed")} <time dateTime={evidence?.observed_at || undefined}>{checked.text}{checked.zone ? ` (${checked.zone})` : ""}</time></span>
    <span>{t("accounts.execution.config_only")}</span>
  </span>;
}
