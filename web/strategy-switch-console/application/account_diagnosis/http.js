/**
 * Account-diagnosis public and internal HTTP handlers.
 * B10-style DI: inject runtime_support helpers; never import runtime_support.js.
 */

import { HttpError } from "../http_error.js";
import {
  ACCOUNT_DIAGNOSIS_INTERNAL_PREFIX,
  ACCOUNT_DIAGNOSIS_MAX_BODY_BYTES,
  ACCOUNT_DIAGNOSIS_TRIGGERS,
} from "./constants.js";
import {
  accountDiagnosisConflict,
  accountDiagnosisErrorPayload,
} from "./helpers.js";
import {
  requireAccountDiagnosisToken,
  accountDiagnosisRequestId,
  accountDiagnosisNativeContext,
  accountDiagnosisPublicTask,
  accountDiagnosisInternalTask,
} from "./checks.js";
import {
  accountDiagnosisAccount,
  accountDiagnosisContext,
  accountDiagnosisRecheckStatus,
} from "./context.js";
import {
  dispatchAccountDiagnosis,
  reconcileAccountDiagnosis,
} from "./native.js";

export async function accountDiagnosisResponse(request, env, url, deps) {
  const {
    json,
    readSession,
    hasRuntimeInstanceStore,
    requireSameOrigin,
    readBoundedJson,
    runtimeInstanceCommand,
  } = deps;
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!hasRuntimeInstanceStore(env)) return json({ ok: false, error: "account_diagnosis_storage_unavailable" }, 503);
  if (request.method === "GET") {
    const params = [...url.searchParams.keys()].sort();
    if (params.join(",") !== "key,platform") return json({ ok: false, error: "account_diagnosis_query_required" }, 400);
    try {
      const identity = await accountDiagnosisAccount(env, url.searchParams.get("platform"), url.searchParams.get("key"), deps);
      const result = await runtimeInstanceCommand(env, { action: "diagnosis_latest", actor: session.login, platform: identity.platform, key: identity.key });
      const recheckStatus = await accountDiagnosisRecheckStatus(env, result.task, deps);
      return json({ ok: true, account: { platform: identity.platform, key: identity.key, target_id: identity.targetId }, task: accountDiagnosisPublicTask(result.task, recheckStatus) });
    } catch (error) {
      if (error instanceof HttpError) return json(accountDiagnosisErrorPayload(error), error.status);
      return json({ ok: false, error: "account_diagnosis_unavailable", reason_code: "account_diagnosis_unavailable" }, 503);
    }
  }
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  try { requireSameOrigin(request, { requireOrigin: true }); } catch (error) { return json({ ok: false, error: error.message }, error.status || 403); }
  let raw;
  try { raw = await readBoundedJson(request, ACCOUNT_DIAGNOSIS_MAX_BODY_BYTES); } catch (error) {
    return json({ ok: false, error: error.message || "invalid_account_diagnosis_request" }, error.status || 400);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).sort().join(",") !== "key,platform,trigger") {
    return json({ ok: false, error: "invalid_account_diagnosis_request" }, 400);
  }
  if (!ACCOUNT_DIAGNOSIS_TRIGGERS.includes(raw.trigger)) return json({ ok: false, error: "invalid_account_diagnosis_trigger" }, 400);
  try { accountDiagnosisNativeContext(env); } catch { return json({ ok: false, error: "account_diagnosis_native_not_configured" }, 503); }
  try {
    const context = await accountDiagnosisContext(env, raw.platform, raw.key, deps);
    if (raw.trigger === "incident" && !context.attention) {
      return json(accountDiagnosisErrorPayload(accountDiagnosisConflict("account_diagnosis_incident_requires_attention")), 409);
    }
    const requestId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const created = await runtimeInstanceCommand(env, {
      action: "diagnosis_create", actor: session.login, request_id: requestId,
      platform: context.platform, key: context.key, target_id: context.targetId, trigger: raw.trigger,
      observed_at: context.observedAt, checks: context.checks, state_fingerprint: context.stateFingerprint, created_at: createdAt, now: Date.now(),
    });
    if (!created.created) return json({ ok: true, deduplicated: true, request_id: created.task.request_id, status: created.task.status, task: accountDiagnosisPublicTask(created.task) }, 200);
    try {
      await dispatchAccountDiagnosis(env, requestId, deps);
      await runtimeInstanceCommand(env, { action: "diagnosis_mark_dispatch", actor: session.login, request_id: requestId, dispatch_state: "sent", updated_at: new Date().toISOString() });
    } catch (error) {
      await runtimeInstanceCommand(env, { action: "diagnosis_mark_dispatch", actor: session.login, request_id: requestId, dispatch_state: "unknown", updated_at: new Date().toISOString() });
      const latest = await runtimeInstanceCommand(env, { action: "diagnosis_read", actor: session.login, request_id: requestId });
      return json({ ok: false, error: error.message || "account_diagnosis_dispatch_unverified", request_id: latest.task.request_id, status: latest.task.status, task: accountDiagnosisPublicTask(latest.task) }, error.status || 502);
    }
    const latest = await runtimeInstanceCommand(env, { action: "diagnosis_read", actor: session.login, request_id: requestId });
    return json({ ok: true, status: "queued", request_id: latest.task.request_id, task: accountDiagnosisPublicTask(latest.task) }, 202);
  } catch (error) {
    if (error instanceof HttpError) return json(accountDiagnosisErrorPayload(error), error.status);
    return json({ ok: false, error: "account_diagnosis_unavailable", reason_code: "account_diagnosis_unavailable" }, 503);
  }
}

export async function accountDiagnosisInternalResponse(request, env, url, deps) {
  const {
    json,
    hasRuntimeInstanceStore,
    readBoundedJson,
    runtimeInstanceCommand,
  } = deps;
  try { requireAccountDiagnosisToken(request, env); } catch (error) { return json({ ok: false, error: error.message }, error.status || 401); }
  if (!hasRuntimeInstanceStore(env)) return json({ ok: false, error: "account_diagnosis_storage_unavailable" }, 503);
  if (url.search) return json({ ok: false, error: "invalid_account_diagnosis_request" }, 400);
  let requestId;
  try { requestId = accountDiagnosisRequestId(url.pathname.slice(ACCOUNT_DIAGNOSIS_INTERNAL_PREFIX.length)); } catch (error) {
    return json({ ok: false, error: error.message }, error.status || 400);
  }
  if (request.method === "GET") {
    try {
      const result = await runtimeInstanceCommand(env, { action: "diagnosis_read", actor: "aab-account-diagnosis", request_id: requestId });
      return json(accountDiagnosisInternalTask(result.task));
    } catch (error) {
      return json({ ok: false, error: error.message || "account_diagnosis_request_not_found" }, error.status || 404);
    }
  }
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  let raw;
  try { raw = await readBoundedJson(request, ACCOUNT_DIAGNOSIS_MAX_BODY_BYTES); } catch (error) {
    return json({ ok: false, error: error.message || "invalid_account_diagnosis_request" }, error.status || 400);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.request_id !== requestId) {
    return json({ ok: false, error: "invalid_account_diagnosis_request" }, 400);
  }
  try {
    if (Object.keys(raw).sort().join() !== "action,request_id" || !["readback", "cancel"].includes(raw.action)) {
      throw new HttpError("invalid_account_diagnosis_result", 400);
    }
    const result = await reconcileAccountDiagnosis(env, requestId, raw.action === "cancel", deps);
    const latest = await runtimeInstanceCommand(env, { action: "diagnosis_read", actor: "native-diagnosis-caller", request_id: requestId });
    return json({ ok: true, replayed: !result.changed, recheck_status: latest.task.recheck_dispatch_state,
      task: accountDiagnosisPublicTask(latest.task) });
  } catch (error) {
    if (error instanceof HttpError) return json(accountDiagnosisErrorPayload(error), error.status);
    return json({ ok: false, error: "account_diagnosis_native_outcome_unknown" }, 502);
  }
}
