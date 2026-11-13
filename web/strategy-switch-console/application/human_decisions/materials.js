/**
 * Human-decision material publish + authority read/exact-lookup use cases.
 *
 * Inject runtime_support-owned owner/recovery helpers so this module never
 * imports runtime_support and cannot form a cycle.
 */

import { HttpError } from "../http_error.js";
import { requireSameOrigin } from "../http_request.js";
import { json } from "../http_response.js";
import {
  controlPlaneDecisionExpiryAt,
  controlPlaneSnapshotFreshness,
  controlPlaneStaleTtlSeconds,
  isOwnerDecisionCandidate,
} from "../control_plane/helpers.js";
import { canonicalResearchTaskJson } from "../research_task/helpers.js";
import { hasRuntimeInstanceStore, runtimeInstanceCommand } from "../runtime_instances/command.js";
import {
  humanDecisionAuthorityView,
  humanDecisionReceipt,
  humanDecisionTimestamp,
  overlayPromotionDecision,
  recoveryDecisionMaterialKey,
  recoveryMaterialEligible,
  researchPromotionMaterialKey,
  researchPromotionReviewBinding,
} from "./helpers.js";

/**
 * @param {any} env
 * @param {any} snapshot
 * @param {string} sourceId
 * @param {{
 *   ownerDecisionCandidateEvidenceSha256: Function,
 *   readLegacyConfig: Function,
 *   ownerDecisionCurrentKey: Function,
 *   normalizeOwnerDecisionIntent: Function,
 * }} deps
 */
export async function publishHumanOwnerMaterials(env, snapshot, sourceId, deps) {
  const {
    ownerDecisionCandidateEvidenceSha256,
    readLegacyConfig,
    ownerDecisionCurrentKey,
    normalizeOwnerDecisionIntent,
  } = deps;
  const ownerCandidates = (snapshot.candidates || []).filter(isOwnerDecisionCandidate);
  if (!ownerCandidates.length && !hasRuntimeInstanceStore(env)) return { ok: true, skipped: true };
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
  const expiresAtMs = controlPlaneDecisionExpiryAt(snapshot, controlPlaneStaleTtlSeconds(env));
  const grouped = new Map();
  for (const candidate of ownerCandidates) {
    const list = grouped.get(candidate.candidate_id) || [];
    list.push(candidate);
    grouped.set(candidate.candidate_id, list);
  }
  const materials = [];
  const duplicateSubjectIds = [];
  for (const [subjectId, list] of grouped) {
    if (list.length > 1) duplicateSubjectIds.push(subjectId);
    const candidate = list[0];
    const materialKey = await ownerDecisionCandidateEvidenceSha256(candidate);
    const legacyRead = await readLegacyConfig(env, ownerDecisionCurrentKey(subjectId));
    if (legacyRead.unreadable) throw new HttpError("human_decision_legacy_unreadable", 503);
    let legacy = null;
    if (legacyRead.blocked) legacy = { blocked: true };
    else if (legacyRead.value) {
      try {
        const intent = await normalizeOwnerDecisionIntent(legacyRead.value, ownerDecisionCurrentKey(subjectId));
        if (intent.candidate_id !== subjectId || intent.candidate_evidence_sha256 !== materialKey) legacy = { blocked: true };
        else {
          legacy = {
            record: {
              action: intent.decision,
              actor: intent.decided_by,
              decided_at: intent.decided_at,
              material_key: materialKey,
              target_json: canonicalResearchTaskJson({ decision: intent.decision }),
              payload: intent,
            },
          };
        }
      } catch {
        legacy = { blocked: true };
      }
    }
    materials.push({
      subject_id: subjectId,
      material_key: materialKey,
      summary_json: JSON.stringify({ candidate_id: subjectId }),
      eligible: list.length === 1 && candidate.freshness?.status === "fresh",
      expires_at_ms: expiresAtMs,
      legacy,
    });
  }
  return runtimeInstanceCommand(env, {
    action: "owner_sync_materials",
    actor: "control-plane-sync",
    source_id: sourceId,
    updated_at: humanDecisionTimestamp(),
    now_ms: Date.now(),
    replace_source: true,
    materials,
    duplicate_subject_ids: duplicateSubjectIds,
  });
}

/**
 * @param {any} env
 * @param {any} source
 * @param {{
 *   reconciliationRecoveryStaleTtlSeconds: Function,
 *   reconciliationRecoveryEvidenceFreshness: Function,
 *   readLegacyConfig: Function,
 *   reconciliationRecoveryConfirmationCurrentKey: Function,
 *   normalizeReconciliationRecoveryConfirmation: Function,
 *   reconciliationRecoveryDecisionExpiryAt: Function,
 * }} deps
 */
export async function publishHumanRecoveryMaterials(env, source, deps) {
  const {
    reconciliationRecoveryStaleTtlSeconds,
    reconciliationRecoveryEvidenceFreshness,
    readLegacyConfig,
    reconciliationRecoveryConfirmationCurrentKey,
    normalizeReconciliationRecoveryConfirmation,
    reconciliationRecoveryDecisionExpiryAt,
  } = deps;
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
  const ttlSeconds = reconciliationRecoveryStaleTtlSeconds(env);
  const now = Date.now();
  const sourceFreshness = controlPlaneSnapshotFreshness(source, ttlSeconds, now);
  const grouped = new Map();
  for (const recovery of source.recoveries || []) {
    const list = grouped.get(recovery.recovery_id) || [];
    list.push(recovery);
    grouped.set(recovery.recovery_id, list);
  }
  const materials = [];
  const duplicateSubjectIds = [];
  for (const [subjectId, list] of grouped) {
    if (list.length > 1) duplicateSubjectIds.push(subjectId);
    const recovery = list[0];
    const evidenceFreshness = reconciliationRecoveryEvidenceFreshness(recovery, sourceFreshness, ttlSeconds, now);
    const materialKey = await recoveryDecisionMaterialKey(recovery);
    const legacyRead = recovery.mode === "initial_enrollment" ? { unreadable: false, blocked: false, value: null }
      : await readLegacyConfig(env, reconciliationRecoveryConfirmationCurrentKey(subjectId));
    if (legacyRead.unreadable) throw new HttpError("human_decision_legacy_unreadable", 503);
    let legacy = null;
    if (legacyRead.blocked) legacy = { blocked: true };
    else if (legacyRead.value) {
      try {
        const confirmation = await normalizeReconciliationRecoveryConfirmation(legacyRead.value, reconciliationRecoveryConfirmationCurrentKey(subjectId));
        if (confirmation.recovery_id !== subjectId || confirmation.candidate_sha256 !== recovery.candidate_sha256 || confirmation.dual_review_binding_sha256 !== recovery.dual_review.evidence_binding_sha256) {
          legacy = { blocked: true };
        } else {
          legacy = {
            record: {
              action: "approve",
              actor: confirmation.confirmed_by,
              decided_at: confirmation.confirmed_at,
              material_key: materialKey,
              target_json: canonicalResearchTaskJson({ decision: "approve" }),
              payload: confirmation,
            },
          };
        }
      } catch {
        legacy = { blocked: true };
      }
    }
    materials.push({
      subject_id: subjectId,
      material_key: materialKey,
      summary_json: JSON.stringify({ recovery_id: subjectId }),
      eligible: list.length === 1 && recoveryMaterialEligible(recovery, sourceFreshness, evidenceFreshness),
      expires_at_ms: reconciliationRecoveryDecisionExpiryAt(recovery, source, ttlSeconds, now),
      legacy,
    });
  }
  return runtimeInstanceCommand(env, {
    action: "recovery_sync_materials",
    actor: "reconciliation-recovery-source-sync",
    source_id: source.source_id,
    updated_at: humanDecisionTimestamp(),
    now_ms: Date.now(),
    replace_source: true,
    materials,
    duplicate_subject_ids: duplicateSubjectIds,
  });
}

/**
 * @param {any} env
 * @param {any} ticket
 * @param {any} existing
 */
export async function publishHumanPromotionMaterial(env, ticket, existing) {
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
  const materialKey = await researchPromotionMaterialKey(ticket);
  let legacy = null;
  if (existing && (existing.state === "human_accepted" || existing.state === "human_rejected")) {
    const existingKey = await researchPromotionMaterialKey(existing);
    const actor = String(existing.human_decision_actor || "").trim();
    if (!actor || !existing.human_decided_at || existingKey !== materialKey) legacy = { blocked: true };
    else {
      legacy = {
        record: {
          action: existing.state === "human_accepted" ? "accept" : "reject",
          actor,
          decided_at: existing.human_decided_at,
          material_key: materialKey,
          target_json: canonicalResearchTaskJson({
            selected_account: existing.selected_account || null,
            confirmation: {
              target_platform: existing.confirmation_target_platform,
              execution_mode: existing.confirmation_execution_mode,
              risk_profile: existing.confirmation_risk_profile,
            },
          }),
          payload: { ticket: existing, selected_account: existing.selected_account || null, proposed_params: existing.proposed_params },
        },
      };
    }
  }
  return runtimeInstanceCommand(env, {
    action: "promotion_sync_materials",
    actor: "research-promotion-ticket-sync",
    source_id: "research-promotion",
    updated_at: humanDecisionTimestamp(),
    now_ms: Date.now(),
    replace_source: false,
    materials: [{
      subject_id: ticket.ticket_id,
      material_key: materialKey,
      summary_json: JSON.stringify({
        ticket_id: ticket.ticket_id,
        strategy_profile: ticket.strategy_profile,
        domain: ticket.domain,
        review_binding: await researchPromotionReviewBinding(ticket),
      }),
      eligible: true,
      expires_at_ms: Date.now() + controlPlaneStaleTtlSeconds(env) * 1000,
      legacy,
    }],
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {any} session
 * @param {string} kind
 * @param {{
 *   calculateReconciliationRecoveryConfirmationSha256: Function,
 * }} deps
 */
export async function exactHumanDecisionResponse(request, env, session, kind, deps) {
  const params = new URL(request.url).searchParams;
  if (!params.has("decision_subject_id") && !params.has("decision_material_sha256")) return null;
  requireSameOrigin(request);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  const subjectId = params.get("decision_subject_id");
  const material = params.get("decision_material_sha256");
  if (params.getAll("decision_subject_id").length !== 1 || params.getAll("decision_material_sha256").length !== 1
    || !subjectId || subjectId.length > 256 || /[\u0000-\u001f\u007f]/.test(subjectId) || !/^[0-9a-f]{64}$/.test(material || "")) {
    return json({ ok: false, error: "human_decision_lookup_invalid" }, 400);
  }
  try {
    if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
    const result = await runtimeInstanceCommand(env, {
      action: `${kind}_read`, actor: session.login, subject_id: subjectId, exact_material_key: material, now_ms: Date.now(),
    });
    if (result.ok !== true || result.exact_material_key !== material || !Object.prototype.hasOwnProperty.call(result, "decision")) {
      throw new HttpError("human_decision_receipt_unavailable", 503);
    }
    const receipt = result.decision === null ? null : await humanDecisionReceipt(result.decision, { kind, subject_id: subjectId, material_sha256: material }, deps);
    return json({ ok: true, decision_readback: {
      schema_version: "qsl_human_decision_readback.v1", source: "durable_human_decision_record",
      kind, subject_id: subjectId, requested_material_sha256: material, observed_at: new Date().toISOString(),
      lookup_status: receipt ? "found" : "not_found", receipt, current_material: result.current_material,
    } });
  } catch {
    // Unreadable authority is never reported as a completed empty lookup.
    return json({ ok: false, error: "human_decision_receipt_unavailable" }, 503);
  }
}

export async function readHumanDecisionAuthority(env, kind, subjectId) {
  if (!hasRuntimeInstanceStore(env)) throw new HttpError("runtime_instances_not_bound", 503);
  return runtimeInstanceCommand(env, { action: `${kind}_read`, actor: `${kind}-decision-read`, subject_id: subjectId });
}

/**
 * @param {any} env
 * @param {any} ticket
 * @param {{ normalizeResearchPromotionTicket: Function }} deps
 */
export async function promotionTicketWithAuthority(env, ticket, deps) {
  const authority = await readHumanDecisionAuthority(env, "promotion", ticket.ticket_id);
  return overlayPromotionDecision(ticket, authority, deps);
}

export { humanDecisionAuthorityView, overlayPromotionDecision, humanDecisionReceipt };
