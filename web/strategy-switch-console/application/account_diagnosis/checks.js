/**
 * Account-diagnosis pure helpers and leaf-only tokens/bindings.
 * No runtime_support imports (avoids circular Strangler edges).
 */

import { HttpError } from "../http_error.js";
import {
  ACCOUNT_DIAGNOSIS_TARGETS,
  ACCOUNT_DIAGNOSIS_SUMMARY_MAX_CHARS,
  ACCOUNT_DIAGNOSIS_REASON_CODES,
  ACCOUNT_DIAGNOSIS_AUTO_ENABLED_ENV,
} from "./constants.js";

export function requireAccountDiagnosisToken(request, env) {
  const expected = String(env.ACCOUNT_DIAGNOSIS_SYNC_TOKEN || "");
  if (!expected) throw new HttpError("account diagnosis sync token is not configured", 500);
  const header = request.headers.get("Authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (token !== expected) throw new HttpError("account diagnosis sync token is invalid", 401);
}

export function accountDiagnosisRequestId(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)) {
    throw new HttpError("invalid_account_diagnosis_request_id", 400);
  }
  return text;
}

export function accountDiagnosisChecks(entry, dataStatus) {
  const target = entry?.target?.target || {};
  const monitoring = entry?.target?.monitoring || {};
  const deployment = entry?.target?.deployment || {};
  return {
    configured_state: ["enabled", "disabled"].includes(target.configured_state) ? target.configured_state : "unknown",
    runtime_enabled: typeof deployment.runtime_enabled === "boolean" ? deployment.runtime_enabled : null,
    scheduler_state: ["enabled", "paused"].includes(deployment.scheduler_state) ? deployment.scheduler_state : "unknown",
    runtime_guard: ["pass", "attention", "unavailable"].includes(monitoring.runtime_guard) ? monitoring.runtime_guard : "unavailable",
    execution_heartbeat: ["pass", "attention", "unavailable", "not_due", "not_applicable"].includes(monitoring.execution_heartbeat)
      ? monitoring.execution_heartbeat : "unavailable",
    freshness: ["ready", "stale", "unavailable"].includes(entry?.freshness?.data_status)
      ? entry.freshness.data_status : (dataStatus === "ready" ? "unavailable" : dataStatus),
  };
}

export function accountDiagnosisHasConfirmedAttention(checks) {
  return ["ready", "stale"].includes(checks.freshness)
    && (checks.freshness === "stale" || (checks.configured_state !== "disabled" && checks.runtime_enabled === false)
      || (checks.configured_state === "enabled" && checks.scheduler_state === "paused")
      || checks.runtime_guard === "attention" || checks.execution_heartbeat === "attention");
}

export function accountDiagnosisStateFingerprint(targetId, checks) {
  return `${targetId}:${JSON.stringify(checks)}`;
}

export function accountDiagnosisTargetSpec(platform, targetId) {
  const spec = ACCOUNT_DIAGNOSIS_TARGETS[String(targetId || "").trim()];
  return spec && (platform == null || spec.platform === platform) ? spec : null;
}

export function accountDiagnosisPublicTask(task, recheckStatus = task?.recheck_dispatch_state) {
  if (!task) return null;
  return {
    request_id: task.request_id,
    platform: task.platform,
    key: task.key,
    target_id: task.target_id,
    trigger: task.trigger,
    status: task.status,
    summary: task.summary || "",
    reason_code: task.reason_code || "",
    dispatch_state: task.dispatch_state,
    recheck_status: recheckStatus,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

export function accountDiagnosisInternalTask(task) {
  return {
    request_id: task.request_id,
    platform: task.platform,
    key: task.key,
    target_id: task.target_id,
    trigger: task.trigger,
    observed_at: task.observed_at,
    checks: task.checks,
    status: task.status,
  };
}

export function accountDiagnosisNativeContext(env) {
  try {
    const binding = JSON.parse(env.ACCOUNT_DIAGNOSIS_NATIVE_BINDING_JSON || "null");
    const expected = ["schema_version", "project", "resource", "audience", "provider", "profile", "model", "worker"];
    if (!binding || Object.keys(binding).sort().join() !== expected.sort().join()
      || binding.schema_version !== "qrs.account-diagnosis-native.v1"
      || binding.project !== "QuantStrategyLab/QuantRuntimeSettings"
      || expected.filter(key => key !== "schema_version").some(key => typeof binding[key] !== "string"
        || !binding[key] || binding[key].length > 200 || /\s/.test(binding[key]))
      || binding.profile.length > 100 || binding.profile.includes(":")) throw Error();
    const url = new URL(binding.resource);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash
      || binding.resource.endsWith("/")) throw Error();
    const transport = env.ACCOUNT_DIAGNOSIS_NATIVE_TRANSPORT;
    // This seam carries existing approved submit/read authentication. Neither
    // an old GitHub dispatch token nor the QRS callback token can substitute it.
    if (!transport || typeof transport.fetch !== "function") throw Error();
    return { binding, transport };
  } catch {
    throw new HttpError("account_diagnosis_native_not_configured", 503);
  }
}

export function accountDiagnosisNativeRequest(task, binding) {
  const input = accountDiagnosisInternalTask(task);
  const properties = { status: { enum: ["succeeded", "failed", "unknown"] },
    summary: { type: "string", minLength: 1, maxLength: ACCOUNT_DIAGNOSIS_SUMMARY_MAX_CHARS },
    reason_code: { enum: ACCOUNT_DIAGNOSIS_REASON_CODES }, advisory_only: { const: true },
    execution_authority_granted: { const: false } };
  return { mode: "agent", profile: binding.profile, model: binding.model,
    objective: "Diagnose only the supplied account/runtime availability checks. Return an advisory report, not a health or execution approval. Do not access accounts, change configuration, repair, trade, deploy, publish, or notify.",
    materials: [input], timeout_seconds: 600,
    output_schema: { type: "object", additionalProperties: false, required: Object.keys(properties), properties } };
}

export function accountDiagnosisAutoEnabled(env) {
  return String(env[ACCOUNT_DIAGNOSIS_AUTO_ENABLED_ENV] || "").toLowerCase() === "true";
}
