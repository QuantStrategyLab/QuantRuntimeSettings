import { HttpError } from "../http_error.js";
import { ACCOUNT_DIAGNOSIS_CONFLICT_REASON_TEXT } from "./constants.js";

export function accountDiagnosisConflict(reasonCode, status = 409) {
  const reason = ACCOUNT_DIAGNOSIS_CONFLICT_REASON_TEXT[reasonCode] || "";
  return new HttpError(reasonCode, status, { reason_code: reasonCode, reason });
}
export function accountDiagnosisErrorPayload(error) {
  const reason_code = String(error?.reason_code || error?.message || "account_diagnosis_unavailable");
  const payload = { ok: false, error: reason_code, reason_code };
  const reason = String(error?.reason || ACCOUNT_DIAGNOSIS_CONFLICT_REASON_TEXT[reason_code] || "").trim();
  if (reason) payload.reason = reason;
  return payload;
}
export function accountDiagnosisTaskFromRow(row) {
  if (!row) return null;
  return {
    request_id: row.request_id,
    platform: row.platform,
    key: row.account_key,
    target_id: row.target_id,
    trigger: row.trigger,
    observed_at: row.observed_at,
    checks: JSON.parse(row.checks_json),
    state_fingerprint: row.state_fingerprint,
    status: row.status,
    native: row.native_json ? JSON.parse(row.native_json) : null,
    backend_kind: row.native_json ? "native" : "legacy",
    workflow_run_id: row.workflow_run_id || null,
    workflow_run_attempt: row.workflow_run_attempt || null,
    job_id: row.job_id || null,
    summary: row.summary || "",
    reason_code: row.reason_code || "",
    dispatch_state: row.dispatch_state,
    recheck_dispatch_state: row.recheck_dispatch_state,
    auto_source: row.auto_source || "manual",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
