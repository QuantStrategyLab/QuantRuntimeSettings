/**
 * Account-diagnosis native transport, reconcile, and dispatch helpers.
 * Inject runtime_support deps; import leaf modules only otherwise.
 */

import { HttpError } from "../http_error.js";
import {
  ACCOUNT_DIAGNOSIS_TARGETS,
  ACCOUNT_DIAGNOSIS_SUMMARY_MAX_CHARS,
  ACCOUNT_DIAGNOSIS_REASON_CODES,
} from "./constants.js";
import { accountDiagnosisConflict } from "./helpers.js";
import {
  accountDiagnosisChecks,
  accountDiagnosisHasConfirmedAttention,
  accountDiagnosisStateFingerprint,
  accountDiagnosisTargetSpec,
  accountDiagnosisNativeContext,
  accountDiagnosisNativeRequest,
  accountDiagnosisAutoEnabled,
} from "./checks.js";
import {
  accountDiagnosisIdentityForTarget,
} from "./context.js";

export async function accountDiagnosisNativeIO(context, method, path, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await context.transport.fetch(new Request(context.binding.resource + path, {
      method, redirect: "manual", signal: controller.signal,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    if (!response.ok || !response.body) throw Error();
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 64 * 1024) { await reader.cancel(); throw Error(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError("account_diagnosis_native_outcome_unknown", 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function accountDiagnosisNativeStop(env, context, task, deps) {
  const {
    runtimeInstanceCommand,
  } = deps;
  const reserved = await runtimeInstanceCommand(env, { action: "diagnosis_native_cancel", actor: "native-diagnosis-caller",
    request_id: task.request_id, updated_at: new Date().toISOString() });
  if (reserved.send_cancel) {
    try { await accountDiagnosisNativeIO(context, "POST", `/v1/tasks/${encodeURIComponent(reserved.task.native.task_id)}/cancel`, {}); } catch { /* Unknown cancellation is never retried. */ }
  }
  return reserved;
}

export async function accountDiagnosisNativeReadback(env, context, task, record, cancelRequested = false, deps) {
  const {
    runtimeInstanceCommand,
    canonicalResearchTaskJson,
    sha256Hex,
  } = deps;
  const native = task.native;
  if (!native || canonicalResearchTaskJson(native.binding) !== canonicalResearchTaskJson(context.binding)) {
    throw accountDiagnosisConflict("account_diagnosis_native_binding_conflict");
  }
  const taskId = record?.id;
  const validId = typeof taskId === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(taskId);
  if (!validId || (native.task_id && taskId !== native.task_id)
    || record.owner !== native.binding.project || record.provider !== native.binding.provider
    || record.result_kind !== "advisory" || record.revision !== 1
    || !Number.isFinite(record.deadline) || (native.task_deadline !== null && native.task_deadline !== record.deadline)
    || await sha256Hex(canonicalResearchTaskJson(record.request ?? null)) !== native.request_sha256) {
    throw accountDiagnosisConflict("account_diagnosis_native_binding_conflict");
  }
  const next = structuredClone(native);
  next.task_id = taskId;
  next.task_deadline = record.deadline;
  if (record.worker !== null && record.worker !== undefined || record.attempt !== null && record.attempt !== undefined) {
    if (record.worker !== native.binding.worker || typeof record.attempt !== "string" || !record.attempt || record.attempt.length > 200) {
      throw accountDiagnosisConflict("account_diagnosis_native_binding_conflict");
    }
    const claim = [record.worker, record.attempt, record.revision];
    if (native.claim && canonicalResearchTaskJson(native.claim) !== canonicalResearchTaskJson(claim)) {
      throw accountDiagnosisConflict("account_diagnosis_native_binding_conflict");
    }
    next.claim = claim;
  } else if (native.claim) {
    throw accountDiagnosisConflict("account_diagnosis_native_binding_conflict");
  }
  const expired = Date.now() / 1000 >= Math.min(native.deadline, record.deadline);
  let status = "queued", summary = "", reason = "", terminal = false;
  const negativeTerminal = ["failed", "invalid_output", "cancelled"].includes(record.status);
  if (((cancelRequested || expired || native.cancel_requested || native.cancel_sent) && !negativeTerminal)
    || record.status === "cancel_requested" || record.status === "outcome_unknown") {
    status = "unknown";
    next.phase = "hold";
  } else if (["queued", "submitting", "running"].includes(record.status)) {
    status = record.status === "running" ? "running" : "queued";
    if (status === "running" && !next.claim) throw accountDiagnosisConflict("account_diagnosis_native_binding_conflict");
    next.phase = "pending";
  } else if (record.status === "completed") {
    const output = record.output;
    if (!next.claim || !output || Object.keys(output).sort().join() !== "advisory_only,execution_authority_granted,reason_code,status,summary"
      || !["succeeded", "failed", "unknown"].includes(output.status)
      || typeof output.summary !== "string" || !output.summary.trim() || output.summary.length > ACCOUNT_DIAGNOSIS_SUMMARY_MAX_CHARS
      || !ACCOUNT_DIAGNOSIS_REASON_CODES.includes(output.reason_code)
      || output.advisory_only !== true || output.execution_authority_granted !== false) {
      throw new HttpError("invalid_account_diagnosis_result", 400);
    }
    next.output_sha256 = await sha256Hex(canonicalResearchTaskJson(output));
    next.phase = "terminal";
    status = output.status; summary = output.summary.trim(); reason = output.reason_code;
    terminal = true;
  } else if (["failed", "invalid_output", "cancelled"].includes(record.status)) {
    next.phase = "terminal"; status = "failed"; terminal = true;
    summary = "Native diagnosis did not produce an accepted advisory result."; reason = "invalid_response";
  } else {
    throw new HttpError("invalid_account_diagnosis_result", 400);
  }
  // All terminal adoption is still bounded by the original operation deadline.
  if (terminal && status === "succeeded" && Date.now() / 1000 >= Math.min(native.deadline, record.deadline)) {
    return accountDiagnosisNativeStop(env, context, { ...task, native: next }, deps);
  }
  if (terminal) next.receipt = await sha256Hex(canonicalResearchTaskJson({ task_id: taskId, claim: next.claim,
    revision: record.revision, request_sha256: next.request_sha256, output_sha256: next.output_sha256,
    native_status: record.status, status, summary, reason }));
  const saved = await runtimeInstanceCommand(env, { action: "diagnosis_native_save", actor: "native-diagnosis-caller",
    request_id: task.request_id, native: next, status, summary, reason_code: reason, updated_at: new Date().toISOString() });
  if ((cancelRequested || native.cancel_requested || expired) && !terminal) return accountDiagnosisNativeStop(env, context, saved.task, deps);
  if (terminal && status === "succeeded" && saved.changed) {
    // Durable result persistence may itself cross expiry; no recheck then.
    if (Date.now() / 1000 >= Math.min(native.deadline, record.deadline)) {
      return accountDiagnosisNativeStop(env, context, saved.task, deps);
    }
    try {
      await dispatchAccountDiagnosisRecheck(env, saved.task, deps);
      await runtimeInstanceCommand(env, { action: "diagnosis_mark_recheck", actor: "native-diagnosis-caller",
        request_id: task.request_id, recheck_dispatch_state: "sent", updated_at: new Date().toISOString() });
    } catch {
      await runtimeInstanceCommand(env, { action: "diagnosis_mark_recheck", actor: "native-diagnosis-caller",
        request_id: task.request_id, recheck_dispatch_state: "unknown", updated_at: new Date().toISOString() });
    }
  }
  return saved;
}

export async function reconcileAccountDiagnosis(env, requestId, cancel = false, deps) {
  const {
    runtimeInstanceCommand,
    canonicalResearchTaskJson,
  } = deps;
  const context = accountDiagnosisNativeContext(env);
  const current = await runtimeInstanceCommand(env, { action: "diagnosis_read", actor: "native-diagnosis-caller", request_id: requestId });
  let task = current.task;
  if (!task?.native) throw new HttpError("account_diagnosis_legacy_retired", 409);
  if (canonicalResearchTaskJson(task.native.binding) !== canonicalResearchTaskJson(context.binding)) {
    throw accountDiagnosisConflict("account_diagnosis_native_binding_conflict");
  }
  if (task.native.phase === "terminal") return { ...current, changed: false };
  if (cancel) {
    const stopped = await accountDiagnosisNativeStop(env, context, task, deps);
    task = stopped.task;
    if (task.native.receipt || task.native.task_id) return stopped;
  }
  if (task.native.task_id && (Date.now() / 1000 >= Math.min(task.native.deadline, task.native.task_deadline ?? Infinity)
    || (task.native.cancel_requested && !task.native.cancel_sent))) return accountDiagnosisNativeStop(env, context, task, deps);
  try {
    let taskId = task.native.task_id;
    if (!taskId) {
      const found = await accountDiagnosisNativeIO(context, "GET", "/v1/tasks/lookup", undefined,
        { "Idempotency-Key": task.native.operation_key, "X-Request-SHA256": task.native.request_sha256 });
      if (!found || Object.keys(found).join() !== "id" || typeof found.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(found.id)) {
        throw new HttpError("account_diagnosis_native_outcome_unknown", 502);
      }
      taskId = found.id;
    }
    const record = await accountDiagnosisNativeIO(context, "GET", `/v1/tasks/${encodeURIComponent(taskId)}`);
    if (record.id !== taskId) throw accountDiagnosisConflict("account_diagnosis_native_binding_conflict");
    return accountDiagnosisNativeReadback(env, context, task, record, cancel, deps);
  } catch (error) {
    // A read/validation failure retains the original obligation beyond24h.
    try {
      await runtimeInstanceCommand(env, { action: "diagnosis_native_save", actor: "native-diagnosis-caller",
        request_id: requestId, native: { ...task.native, phase: "hold" }, status: "unknown", summary: "", reason_code: "",
        updated_at: new Date().toISOString() });
    } catch { /* Never overwrite a concurrently accepted immutable terminal receipt. */ }
    throw error;
  }
}

export async function dispatchAccountDiagnosis(env, requestId, deps) {
  const {
    runtimeInstanceCommand,
    canonicalResearchTaskJson,
    sha256Hex,
  } = deps;
  const context = accountDiagnosisNativeContext(env);
  const current = await runtimeInstanceCommand(env, { action: "diagnosis_read", actor: "native-diagnosis-caller", request_id: requestId });
  const request = accountDiagnosisNativeRequest(current.task, context.binding);
  const native = { version: "qrs.native-diagnosis.v1", binding: context.binding, request,
    input_sha256: await sha256Hex(canonicalResearchTaskJson(request.materials)),
    request_sha256: await sha256Hex(canonicalResearchTaskJson(request)), operation_key: "qrs-account-diagnosis:" + requestId,
    deadline: Date.now() / 1000 + 600, task_id: null, task_deadline: null, claim: null,
    output_sha256: null, receipt: null, cancel_requested: false, cancel_sent: false, phase: "intent" };
  const intent = await runtimeInstanceCommand(env, { action: "diagnosis_native_intent", actor: "native-diagnosis-caller",
    request_id: requestId, native, updated_at: new Date().toISOString() });
  if (!intent.created) return intent; // Never replay POST, even after a lost reply.
  if (Date.now() / 1000 >= intent.task.native.deadline) return accountDiagnosisNativeStop(env, context, intent.task, deps);
  const record = await accountDiagnosisNativeIO(context, "POST", "/v1/tasks", request,
    { "Idempotency-Key": native.operation_key });
  return accountDiagnosisNativeReadback(env, context, intent.task, record, false, deps);
}

export async function dispatchAccountDiagnosisRecheck(env, task, deps) {
  const {
    fetchWithTimeout,
    githubHeaders,
  } = deps;
  const token = String(env.RUNTIME_SETTINGS_DISPATCH_TOKEN || "");
  if (!token) throw new HttpError("account_diagnosis_recheck_unavailable", 503);
  const spec = accountDiagnosisTargetSpec(task?.platform, task?.target_id);
  if (!spec) throw accountDiagnosisConflict("account_diagnosis_target_not_admitted");
  const url = `https://api.github.com/repos/${spec.recheckRepository}/actions/workflows/${spec.recheckWorkflow}/dispatches`;
  const body = task.platform === "longbridge"
    ? { ref: "main", inputs: { target: task.target_id.slice("longbridge.".length) } }
    : { ref: "main" };
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new HttpError("account_diagnosis_recheck_unverified", 502);
}

export async function maybeAutoDispatchAccountDiagnosis(env, source, deps) {
  const {
    controlPlaneSnapshotFreshness,
    executionEvidenceStaleTtlSeconds,
    runtimeInstanceCommand,
  } = deps;
  if (!accountDiagnosisAutoEnabled(env)) return;
  try { accountDiagnosisNativeContext(env); } catch { return; }
  const now = Date.now();
  const freshness = controlPlaneSnapshotFreshness(source, executionEvidenceStaleTtlSeconds(env), now);
  if (freshness.data_status !== "ready") return;
  const observedAt = source.computed_at || source.generated_at;
  if (!observedAt) return;
  for (const [targetId, spec] of Object.entries(ACCOUNT_DIAGNOSIS_TARGETS)) {
    try {
      const matchingTargets = source.targets.filter(item =>
        item.target_id === targetId && item.target?.platform === spec.platform);
      if (matchingTargets.length !== 1) continue;
      const target = matchingTargets[0];
      const checks = accountDiagnosisChecks({ target, freshness }, freshness.data_status);
      if (checks.configured_state !== "enabled" || !accountDiagnosisHasConfirmedAttention(checks)) continue;
      const identity = await accountDiagnosisIdentityForTarget(env, targetId, deps);
      if (!identity) continue;
      const createdAt = new Date().toISOString();
      const requestId = crypto.randomUUID();
      const created = await runtimeInstanceCommand(env, {
        action: "diagnosis_create", actor: "runtime-target-lifecycle-source-sync", request_id: requestId,
        platform: identity.platform, key: identity.key, target_id: identity.targetId, trigger: "incident",
        observed_at: observedAt, checks, state_fingerprint: accountDiagnosisStateFingerprint(identity.targetId, checks),
        created_at: createdAt, now, auto_source: "source_sync",
      });
      if (!created.created) continue;
      try {
        await dispatchAccountDiagnosis(env, requestId, deps);
        await runtimeInstanceCommand(env, {
          action: "diagnosis_mark_dispatch", actor: "runtime-target-lifecycle-source-sync",
          request_id: requestId, dispatch_state: "sent", updated_at: new Date().toISOString(),
        });
      } catch {
        await runtimeInstanceCommand(env, {
          action: "diagnosis_mark_dispatch", actor: "runtime-target-lifecycle-source-sync",
          request_id: requestId, dispatch_state: "unknown", updated_at: new Date().toISOString(),
        });
      }
    } catch {
      // One target's unavailable identity or dispatch must not affect the other targets.
    }
  }
}
