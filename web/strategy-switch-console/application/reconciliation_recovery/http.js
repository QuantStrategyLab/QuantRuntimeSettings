/**
 * Reconciliation-recovery sync / dashboard / confirmation / controller HTTP.
 *
 * Inject human-decision and control-plane freshness helpers from runtime_support
 * so this module never imports runtime_support and cannot form a cycle.
 */

import { directoryList } from "../../kv_directory.js";
import { uniqueStrings } from "../auth/identity_lists.js";
import { readSession } from "../auth/session.js";
import { sourceListFailure } from "../console_api/read_failures.js";
import { decorateQueue } from "../console_api/presentation.js";
import { recoveryMaterialPresentation, currentReconciliationObservationPresentation } from "../console_api/reconciliation_presentation.js";
import { hasConfigStore, configStore, readConfigJson, writeConfigJson } from "../config_kv.js";
import { normalizeControlPlaneIdentifier } from "../control_plane/helpers.js";
import { requireSameOrigin } from "../http_request.js";
import { json } from "../http_response.js";
import { canonicalResearchTaskJson } from "../research_task/helpers.js";
import {
  RECONCILIATION_RECOVERY_CONTROLLER_READ_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_DASHBOARD_SCHEMA_VERSION,
  RECONCILIATION_RECOVERY_MAX_BODY_BYTES,
  RECONCILIATION_RECOVERY_MAX_SOURCES,
  RECONCILIATION_RECOVERY_SOURCE_PREFIX,
} from "./constants.js";
import {
  buildReconciliationRecoveryConfirmation,
  calculateReconciliationRecoveryConfirmationSha256,
  currentReconciliationRecoveryRequest,
  emptyReconciliationRecoveryPayload,
  emptyReconciliationRecoverySourceSnapshot,
  normalizeReconciliationRecoveryConfirmation,
  normalizeReconciliationRecoveryConfirmationRequest,
  normalizeReconciliationRecoverySourceSnapshot,
  reconciliationRecoveryConfirmationArchiveKey,
  reconciliationRecoveryConfirmationCurrentKey,
  reconciliationRecoveryEvidenceFreshness,
  reconciliationRecoverySourceKey,
  reconciliationRecoveryStaleTtlSeconds,
  requireDedicatedReconciliationRecoveryControllerToken,
  requireDedicatedReconciliationRecoverySyncToken,
} from "./helpers.js";

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   readBoundedJson: Function,
 *   publishHumanRecoveryMaterials: Function,
 *   appendAuditLog: Function,
 *   initialEnrollmentAccountOption: Function,
 * }} deps
 */
export async function syncReconciliationRecoverySourceResponse(request, env, deps) {
  const { readBoundedJson, publishHumanRecoveryMaterials, appendAuditLog, initialEnrollmentAccountOption } = deps;
  requireDedicatedReconciliationRecoverySyncToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "reconciliation recovery KV is not configured" }, 503);
  }
  let raw;
  try {
    raw = await readBoundedJson(request, RECONCILIATION_RECOVERY_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid reconciliation recovery payload" }, error.status || 400);
  }
  let source;
  try {
    source = normalizeReconciliationRecoverySourceSnapshot(raw, "reconciliation recovery source snapshot");
    for (const recovery of source.recoveries) {
      if (recovery.mode === "initial_enrollment") await initialEnrollmentAccountOption(env, recovery);
    }
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid reconciliation recovery payload" }, 400);
  }
  try {
    await publishHumanRecoveryMaterials(env, source);
  } catch (error) {
    return json({ ok: false, error: error.message || "reconciliation recovery material unavailable" }, error.status || 503);
  }
  await writeConfigJson(env, reconciliationRecoverySourceKey(source.source_id), source);
  try {
    await appendAuditLog(env, {
      ts: new Date().toISOString(),
      login: "reconciliation-recovery-source-sync",
      action: "sync_reconciliation_recovery_source",
      source_id: source.source_id,
      schema_version: source.schema_version,
      recovery_count: source.recoveries.length,
      data_status: source.data_status,
    });
  } catch {
    // The source is still safely stored even if the rolling convenience log
    // cannot be updated.
  }
  return json({
    ok: true,
    source_id: source.source_id,
    schema_version: source.schema_version,
    recovery_count: source.recoveries.length,
    generated_at: source.generated_at,
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   exactHumanDecisionResponse: Function,
 *   aggregateReconciliationRecoverySources: Function,
 * }} deps
 */
export async function reconciliationRecoveryResponse(request, env, deps) {
  const { exactHumanDecisionResponse, aggregateReconciliationRecoverySources } = deps;
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  const exact = await exactHumanDecisionResponse(request, env, session, "recovery");
  if (exact) return exact;
  if (!hasConfigStore(env)) return json(emptyReconciliationRecoveryPayload("snapshot_unavailable"));
  return json(decorateQueue(await aggregateReconciliationRecoverySources(env), "recoveries", "reconciliation_recovery"));
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @param {{
 *   aggregateReconciliationRecoverySources: Function,
 * }} deps
 */
export async function reconciliationRecoveryControllerReadResponse(request, env, url, deps) {
  const { aggregateReconciliationRecoverySources } = deps;
  requireDedicatedReconciliationRecoveryControllerToken(request, env);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "reconciliation recovery KV is not configured" }, 503);
  }
  let recoveryId;
  try {
    recoveryId = normalizeControlPlaneIdentifier(
      url.searchParams.get("recovery_id") || "",
      "reconciliation recovery controller recovery_id",
      false,
    );
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid recovery_id" }, 400);
  }
  const dashboard = await aggregateReconciliationRecoverySources(env);
  let recovery;
  try {
    recovery = currentReconciliationRecoveryRequest(dashboard, recoveryId);
  } catch (error) {
    return json({ ok: false, error: error.message || "reconciliation recovery is unavailable" }, error.status || 409);
  }
  const entry = dashboard.recoveries.find((item) => item.recovery?.recovery_id === recoveryId);
  if (!entry?.confirmation) {
    return json({ ok: false, error: "reconciliation recovery has no current confirmation" }, 404);
  }
  if (recovery.mode === "initial_enrollment") {
    return json({
      ok: true,
      schema_version: "qsl_initial_enrollment_controller_read.v1",
      recovery: {
        mode: recovery.mode,
        recovery_id: recovery.recovery_id,
        candidate_sha256: recovery.candidate_sha256,
        facts_sha256: recovery.facts_sha256,
      },
      confirmation: entry.confirmation,
      policy: { no_order: true, execution_authority_granted: false, controller_must_reverify: true },
    });
  }
  return json({
    ok: true,
    schema_version: RECONCILIATION_RECOVERY_CONTROLLER_READ_SCHEMA_VERSION,
    recovery: {
      recovery_id: recovery.recovery_id,
      platform: recovery.platform,
      strategy_profile: recovery.strategy_profile,
      environment: recovery.environment,
      reconciliation_state: recovery.reconciliation_state,
      candidate_sha256: recovery.candidate_sha256,
      dual_review_binding_sha256: recovery.dual_review.evidence_binding_sha256,
      evidence_sample_count: recovery.evidence_sample_count,
      first_observed_at: recovery.first_observed_at,
      last_observed_at: recovery.last_observed_at,
    },
    confirmation: entry.confirmation,
    policy: {
      no_order: true,
      execution_authority_granted: false,
      controller_must_reverify: true,
    },
  });
}

/**
 * @param {any} env
 * @param {string} recoveryId
 * @param {{
 *   readHumanDecisionAuthority: Function,
 *   humanDecisionAuthorityView: Function,
 * }} deps
 */
export async function readReconciliationRecoveryConfirmation(env, recoveryId, deps) {
  const { readHumanDecisionAuthority, humanDecisionAuthorityView } = deps;
  let authority;
  try {
    authority = await readHumanDecisionAuthority(env, "recovery", recoveryId);
  } catch (error) {
    return { confirmation: null, rejection: null, authority: null, error: error.message || "runtime_instances_unavailable" };
  }
  const authorityView = humanDecisionAuthorityView(authority);
  if (authority.migrated === false) {
    try {
      const stored = await readConfigJson(env, reconciliationRecoveryConfirmationCurrentKey(recoveryId));
      if (!stored) return { confirmation: null, rejection: null, authority: authorityView, error: null };
      return {
        confirmation: await normalizeReconciliationRecoveryConfirmation(
          stored,
          reconciliationRecoveryConfirmationCurrentKey(recoveryId),
        ),
        rejection: null,
        authority: authorityView,
        error: null,
        read_only: true,
      };
    } catch {
      return { confirmation: null, rejection: null, authority: authorityView, error: "reconciliation_recovery_confirmation_invalid" };
    }
  }
  if (authority.blocked) return { confirmation: null, rejection: null, authority: authorityView, error: "reconciliation_recovery_legacy_blocked" };
  if (authority.eligible !== true) return { confirmation: null, rejection: null, authority: authorityView, error: null };
  if (authority.decision?.action === "reject") {
    const payload = authority.decision.payload;
    if (payload?.decision === "reject" && payload?.no_order === true && payload?.execution_authority_granted === false) {
      return { confirmation: null, rejection: payload, authority: authorityView, error: null };
    }
    return { confirmation: null, rejection: null, authority: authorityView, error: null };
  }
  if (authority.decision?.action === "approve" && authority.decision.payload?.no_order === true && authority.decision.payload?.execution_authority_granted === false) {
    return { confirmation: authority.decision.payload, rejection: null, authority: authorityView, error: null };
  }
  return { confirmation: null, rejection: null, authority: authorityView, error: null };
}

/**
 * @param {any} env
 * @param {any} session
 * @param {any} requested
 * @param {any} recovery
 * @param {{
 *   recoveryDecisionMaterialKey: Function,
 *   humanDecisionTimestamp: Function,
 *   humanDecisionRequestKey: Function,
 *   humanDecisionReceipt: Function,
 *   runtimeInstanceCommand: Function,
 * }} deps
 */
export async function recordInitialEnrollmentDecision(env, session, requested, recovery, deps) {
  const {
    recoveryDecisionMaterialKey,
    humanDecisionTimestamp,
    humanDecisionRequestKey,
    humanDecisionReceipt,
    runtimeInstanceCommand,
  } = deps;
  if (recovery.mode !== "initial_enrollment" || requested.candidate_sha256 !== recovery.candidate_sha256
      || requested.facts_sha256 !== recovery.facts_sha256) {
    return json({ ok: false, error: "initial_enrollment_changed" }, 409);
  }
  const decidedAt = humanDecisionTimestamp();
  const materialKey = await recoveryDecisionMaterialKey(recovery);
  const base = {
    mode: "initial_enrollment",
    recovery_id: recovery.recovery_id,
    candidate_sha256: recovery.candidate_sha256,
    facts_sha256: recovery.facts_sha256,
    no_order: true,
    execution_authority_granted: false,
  };
  const payload = requested.decision === "approve"
    ? {
      schema_version: "qsl_initial_enrollment_confirmation.v1",
      ...base,
      confirmed_at: decidedAt,
      confirmed_by: session.login,
    }
    : {
      schema_version: "qsl_initial_enrollment_rejection.v1",
      ...base,
      decision: "reject",
      decided_at: decidedAt,
      decided_by: session.login,
    };
  if (requested.decision === "approve") {
    payload.confirmation_sha256 = await calculateReconciliationRecoveryConfirmationSha256(payload);
  }
  const target = { decision: requested.decision };
  try {
    const requestKey = await humanDecisionRequestKey({
      requestId: requested.request_id,
      kind: "recovery",
      actor: session.login,
      subjectId: recovery.recovery_id,
      materialKey,
      action: requested.decision,
      target,
    });
    const recorded = await runtimeInstanceCommand(env, {
      action: "recovery_decide",
      actor: session.login,
      subject_id: recovery.recovery_id,
      material_key: materialKey,
      action_name: requested.decision,
      request_key: requestKey,
      target_json: canonicalResearchTaskJson(target),
      decided_at: decidedAt,
      now_ms: Date.now(),
      payload,
    });
    const decisionReceipt = await humanDecisionReceipt(recorded.record, {
      kind: "recovery",
      subject_id: recovery.recovery_id,
      material_sha256: materialKey,
    });
    return json({
      ok: true,
      confirmation: recorded.record?.action === "approve" ? recorded.record.payload : null,
      rejection: recorded.record?.action === "reject" ? recorded.record.payload : null,
      decision_receipt: decisionReceipt,
      replayed: recorded.replayed === true,
    });
  } catch (error) {
    return json({ ok: false, error: error.message || "initial_enrollment_unavailable" }, error.status || 503);
  }
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   readBoundedJson: Function,
 *   aggregateReconciliationRecoverySources: Function,
 *   recoveryDecisionMaterialKey: Function,
 *   humanDecisionTimestamp: Function,
 *   humanDecisionRequestKey: Function,
 *   humanDecisionReceipt: Function,
 *   runtimeInstanceCommand: Function,
 *   mirrorConfigJson: Function,
 *   appendAuditLog: Function,
 * }} deps
 */
export async function recordReconciliationRecoveryConfirmationResponse(request, env, deps) {
  const {
    readBoundedJson,
    aggregateReconciliationRecoverySources,
    recoveryDecisionMaterialKey,
    humanDecisionTimestamp,
    humanDecisionRequestKey,
    humanDecisionReceipt,
    runtimeInstanceCommand,
    mirrorConfigJson,
    appendAuditLog,
  } = deps;
  requireSameOrigin(request, { requireOrigin: true });
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  if (!hasConfigStore(env)) {
    return json({ ok: false, error: "STRATEGY_SWITCH_CONFIG KV binding is required" }, 503);
  }
  let raw;
  try {
    raw = await readBoundedJson(request, 4 * 1024);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid reconciliation recovery confirmation" }, error.status || 400);
  }
  let requested;
  try {
    requested = normalizeReconciliationRecoveryConfirmationRequest(raw);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid reconciliation recovery confirmation" }, 400);
  }
  const dashboard = await aggregateReconciliationRecoverySources(env);
  let recovery;
  try {
    recovery = currentReconciliationRecoveryRequest(dashboard, requested.recovery_id);
  } catch (error) {
    return json({ ok: false, error: error.message || "reconciliation recovery confirmation is unavailable" }, error.status || 409);
  }
  if (requested.mode === "initial_enrollment") {
    return recordInitialEnrollmentDecision(env, session, requested, recovery, deps);
  }
  if (recovery.mode === "initial_enrollment"
    || requested.candidate_sha256 !== recovery.candidate_sha256
    || requested.dual_review_binding_sha256 !== recovery.dual_review.evidence_binding_sha256
  ) {
    return json({ ok: false, error: "reconciliation evidence changed; reload the review before confirming" }, 409);
  }
  const decidedAt = humanDecisionTimestamp();
  const materialKey = await recoveryDecisionMaterialKey(recovery);
  const confirmation = requested.decision === "approve"
    ? await buildReconciliationRecoveryConfirmation({ recovery, confirmedBy: session.login, confirmedAt: decidedAt })
    : null;
  const rejection = requested.decision === "reject" ? {
    schema_version: "qsl_reconciliation_recovery_rejection.v1",
    recovery_id: recovery.recovery_id,
    candidate_sha256: recovery.candidate_sha256,
    dual_review_binding_sha256: recovery.dual_review.evidence_binding_sha256,
    decision: "reject",
    decided_at: decidedAt,
    decided_by: session.login,
    no_order: true,
    execution_authority_granted: false,
  } : null;
  const target = { decision: requested.decision };
  let requestKey;
  try {
    requestKey = await humanDecisionRequestKey({
      requestId: requested.request_id,
      kind: "recovery",
      actor: session.login,
      subjectId: recovery.recovery_id,
      materialKey,
      action: requested.decision,
      target,
    });
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid reconciliation recovery confirmation" }, error.status || 400);
  }
  let recorded;
  try {
    recorded = await runtimeInstanceCommand(env, {
      action: "recovery_decide",
      actor: session.login,
      subject_id: recovery.recovery_id,
      material_key: materialKey,
      action_name: requested.decision,
      request_key: requestKey,
      target_json: canonicalResearchTaskJson(target),
      decided_at: decidedAt,
      now_ms: Date.now(),
      payload: confirmation || rejection,
    });
  } catch (error) {
    return json({ ok: false, error: error.message || "reconciliation recovery confirmation is unavailable" }, error.status || 503);
  }
  const decisionReceipt = await humanDecisionReceipt(recorded.record, {
    kind: "recovery",
    subject_id: recovery.recovery_id,
    material_sha256: materialKey,
  });
  const recordedPayload = recorded.record.payload;
  if (recorded.record?.action === "approve") {
    await mirrorConfigJson(env, reconciliationRecoveryConfirmationArchiveKey(recovery.recovery_id, recordedPayload.confirmation_sha256), recordedPayload);
    await mirrorConfigJson(env, reconciliationRecoveryConfirmationCurrentKey(recovery.recovery_id), recordedPayload);
  }
  let auditLogged = false;
  try {
    await appendAuditLog(env, {
      ts: recorded.record?.decided_at || decidedAt,
      login: session.login,
      action: "record_reconciliation_recovery_confirmation",
      recovery_id: recovery.recovery_id,
      candidate_sha256: recovery.candidate_sha256,
      dual_review_binding_sha256: recovery.dual_review.evidence_binding_sha256,
      confirmation_sha256: recordedPayload.confirmation_sha256 || "",
      decision: recorded.record?.action || requested.decision,
      no_order: true,
      execution_authority_granted: false,
    });
    auditLogged = true;
  } catch {
    // The immutable confirmation remains available to a future private
    // controller even if the rolling audit log is unavailable.
  }
  return json({
    ok: true,
    confirmation: recorded.record?.action === "approve" ? recordedPayload : null,
    rejection: recorded.record?.action === "reject" ? recordedPayload : null,
    decision_receipt: decisionReceipt,
    audit_logged: auditLogged,
    replayed: recorded.replayed === true,
  });
}

/**
 * @param {any} env
 * @param {{
 *   readReconciliationRecoverySources: Function,
 *   controlPlaneSnapshotFreshness: Function,
 *   earliestControlPlaneTimestamp: Function,
 *   readReconciliationRecoveryConfirmation: Function,
 *   recoveryDecisionMaterialKey: Function,
 *   initialEnrollmentAccountOption: Function,
 * }} deps
 */
export async function aggregateReconciliationRecoverySources(env, deps) {
  const {
    readReconciliationRecoverySources,
    controlPlaneSnapshotFreshness,
    earliestControlPlaneTimestamp,
    readReconciliationRecoveryConfirmation,
    recoveryDecisionMaterialKey,
    initialEnrollmentAccountOption,
  } = deps;
  const sources = await readReconciliationRecoverySources(env);
  if (!sources.length) return emptyReconciliationRecoveryPayload("snapshot_unavailable");
  const ttlSeconds = reconciliationRecoveryStaleTtlSeconds(env);
  const now = Date.now();
  const recoveries = [];
  const recoveryIds = new Set();
  const duplicateRecoveryIds = new Set();
  const errors = [];
  const timestamps = [];
  let hasReadySource = false;
  let hasStaleSource = false;
  let hasStaleRecoveryEvidence = false;
  for (const source of sources) {
    const sourceFreshness = controlPlaneSnapshotFreshness(source, ttlSeconds, now);
    if (source.generated_at) timestamps.push(source.generated_at);
    if (source.computed_at) timestamps.push(source.computed_at);
    if (sourceFreshness.data_status === "ready") hasReadySource = true;
    if (sourceFreshness.data_status === "stale") {
      hasStaleSource = true;
      errors.push("reconciliation_recovery_source_stale");
    }
    for (const recovery of source.recoveries) {
      if (recoveryIds.has(recovery.recovery_id)) {
        duplicateRecoveryIds.add(recovery.recovery_id);
        errors.push("reconciliation_recovery_duplicate_recovery");
        continue;
      }
      recoveryIds.add(recovery.recovery_id);
      const freshness = reconciliationRecoveryEvidenceFreshness(recovery, sourceFreshness, ttlSeconds, now);
      if (freshness.data_status === "stale") {
        hasStaleRecoveryEvidence = true;
        errors.push("reconciliation_recovery_evidence_stale");
      }
      const result = await readReconciliationRecoveryConfirmation(env, recovery.recovery_id);
      if (result.error) errors.push(result.error);
      if (recovery.mode === "initial_enrollment") {
        const option = await initialEnrollmentAccountOption(env, recovery);
        const incomplete = Object.entries(recovery.candidate.coverage)
          .filter(([, status]) => status !== "complete")
          .map(([name]) => `initial_enrollment_${name}_incomplete`);
        const view = {
          ...recovery,
          platform: "ibkr",
          strategy_profile: recovery.candidate.strategy_profile,
          target_name: option.target_name,
          account_key: option.key,
          candidate_sha256: recovery.candidate.candidate_sha256,
          facts_sha256: recovery.candidate.facts_sha256,
          first_observed_at: recovery.candidate.first_observed_at,
          last_observed_at: recovery.candidate.last_observed_at,
          readiness: incomplete.length ? "blocked" : "awaiting_human_confirmation",
          blocker_codes: incomplete,
        };
        const matches = (decision) => decision?.mode === "initial_enrollment"
          && decision.candidate_sha256 === view.candidate_sha256
          && decision.facts_sha256 === view.facts_sha256;
        const confirmation = matches(result.confirmation) ? result.confirmation : null;
        const rejection = matches(result.rejection) ? result.rejection : null;
        const presentation = recoveryMaterialPresentation({
          source, recovery: view, confirmation, rejection, decisionError: result.error,
        });
        presentation.label = { zh: "首次登记确认", en: "Initial enrollment" };
        presentation.material_kind = "initial_enrollment";
        recoveries.push({
          source_id: source.source_id,
          freshness,
          recovery: view,
          confirmation,
          rejection,
          presentation,
          decision_authority: result.authority || null,
          decision_binding: {
            kind: "recovery",
            subject_id: view.recovery_id,
            material_sha256: await recoveryDecisionMaterialKey(recovery),
          },
        });
        continue;
      }
      const confirmation = result.confirmation
        && result.confirmation.candidate_sha256 === recovery.candidate_sha256
        && result.confirmation.dual_review_binding_sha256 === recovery.dual_review.evidence_binding_sha256
        ? result.confirmation
        : null;
      const rejection = result.rejection
        && result.rejection.candidate_sha256 === recovery.candidate_sha256
        && result.rejection.dual_review_binding_sha256 === recovery.dual_review.evidence_binding_sha256
        ? result.rejection
        : null;
      recoveries.push({
        source_id: source.source_id,
        freshness,
        recovery,
        confirmation,
        rejection,
        presentation: recoveryMaterialPresentation({
          source, recovery, confirmation, rejection, decisionError: result.error,
        }),
        decision_authority: result.authority || null,
        decision_binding: {
          kind: "recovery",
          subject_id: recovery.recovery_id,
          material_sha256: await recoveryDecisionMaterialKey(recovery),
        },
      });
    }
    errors.push(...source.errors);
  }
  const uniqueRecoveries = recoveries
    .filter((entry) => !duplicateRecoveryIds.has(entry.recovery.recovery_id))
    .sort((left, right) => left.recovery.recovery_id.localeCompare(right.recovery.recovery_id));
  const dataStatus = hasStaleSource || hasStaleRecoveryEvidence
    ? "stale"
    : (hasReadySource ? "ready" : "unavailable");
  return {
    schema_version: RECONCILIATION_RECOVERY_DASHBOARD_SCHEMA_VERSION,
    generated_at: earliestControlPlaneTimestamp(timestamps),
    computed_at: earliestControlPlaneTimestamp(timestamps),
    data_status: dataStatus,
    summary: {
      recovery_count: uniqueRecoveries.length,
      awaiting_human_confirmation: uniqueRecoveries.filter((entry) =>
        entry.freshness.data_status === "ready"
        && entry.recovery.readiness === "awaiting_human_confirmation"
        && !entry.confirmation
        && !entry.rejection
      ).length,
      blocked: uniqueRecoveries.filter((entry) => entry.recovery.readiness === "blocked").length,
      confirmed: uniqueRecoveries.filter((entry) => Boolean(entry.confirmation)).length,
    },
    recoveries: uniqueRecoveries,
    current_reconciliation_observation: currentReconciliationObservationPresentation(),
    policy: {
      human_confirmation_required: true,
      current_evidence_required: true,
      no_order: true,
      execution_authority_granted: false,
      notice: "恢复确认只记录与双审摘要绑定的人工意图；私有控制器仍须重新核验后才可恢复既有执行。",
    },
    errors: uniqueStrings(errors),
  };
}

/**
 * @param {any} env
 * @param {{
 *   initialEnrollmentAccountOption: Function,
 * }} deps
 */
export async function readReconciliationRecoverySources(env, deps) {
  const { initialEnrollmentAccountOption } = deps;
  const store = configStore(env);
  if (!store) return [];
  let listing;
  try {
    listing = await directoryList(env, RECONCILIATION_RECOVERY_SOURCE_PREFIX, RECONCILIATION_RECOVERY_MAX_SOURCES);
  } catch (error) {
    return [emptyReconciliationRecoverySourceSnapshot(sourceListFailure(error, "reconciliation_recovery_source_list_unavailable"))];
  }
  const keys = Array.isArray(listing?.keys) ? listing.keys : [];
  const sources = [];
  for (const entry of keys.slice(0, RECONCILIATION_RECOVERY_MAX_SOURCES)) {
    const key = typeof entry?.name === "string" ? entry.name : "";
    if (!key.startsWith(RECONCILIATION_RECOVERY_SOURCE_PREFIX)) continue;
    try {
      const stored = await readConfigJson(env, key);
      if (!stored) throw new Error("indexed_record_unavailable");
      const source = normalizeReconciliationRecoverySourceSnapshot(stored, key);
      for (const recovery of source.recoveries) {
        if (recovery.mode === "initial_enrollment") await initialEnrollmentAccountOption(env, recovery);
      }
      sources.push(source);
    } catch {
      sources.push(emptyReconciliationRecoverySourceSnapshot("reconciliation_recovery_source_invalid"));
    }
  }
  return sources;
}
