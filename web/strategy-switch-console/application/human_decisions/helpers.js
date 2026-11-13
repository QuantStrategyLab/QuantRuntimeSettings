/**
 * Human-decision material keys, review bindings, and authority projections.
 *
 * Pure / lightly-dependent helpers extracted from runtime_support. Hashing uses
 * research_task canonicalization so this module never imports runtime_support.
 */

import { PLATFORM_CONFIG } from "../../config.js";
import { HttpError } from "../http_error.js";
import { RESEARCH_PROMOTION_RISK_PROFILES } from "../research_promotion/constants.js";
import { canonicalResearchTaskJson, sha256Hex } from "../research_task/helpers.js";
import { RESEARCH_PROMOTION_REVIEW_INVALID } from "./constants.js";

export const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_CONFIG);

export class ResearchPromotionReviewMaterialError extends HttpError {
  constructor() { super(RESEARCH_PROMOTION_REVIEW_INVALID, 400); }
}

/** Match calculateOwnerDecisionSha256 without importing runtime_support. */
export async function humanDecisionMaterialSha256(payload) {
  const material = { ...payload };
  delete material.decision_sha256;
  return sha256Hex(canonicalResearchTaskJson(material));
}

export async function humanDecisionRequestKey({ requestId, kind, actor, subjectId, materialKey, action, target }) {
  if (requestId !== undefined && requestId !== null && requestId !== "") {
    const text = String(requestId).trim();
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(text)) throw new HttpError("invalid request_id", 400);
    return `id:${kind}:${text}`;
  }
  const digest = await humanDecisionMaterialSha256({
    actor, kind, subject_id: subjectId, material_key: materialKey, action, target: target || null,
  });
  return `fp:${digest}`;
}

export async function researchPromotionMaterialKey(ticket) {
  return humanDecisionMaterialSha256({
    ticket_id: ticket.ticket_id,
    strategy_profile: ticket.strategy_profile,
    domain: ticket.domain,
    proposed_params: ticket.proposed_params,
    shadow_passed: ticket.shadow_passed,
    shadow_evidence_kind: ticket.shadow_evidence_kind,
  });
}

// The legacy six-field material key remains the durable terminal index. This
// independent versioned snapshot binds all saved producer review content without
// rekeying historical records or hashing post-decision/observation-only fields.
export function researchPromotionReviewMaterial(ticket) {
  return {
    schema_version: "qsl_promotion_review_material.v2",
    ticket_id: ticket.ticket_id, strategy_profile: ticket.strategy_profile, domain: ticket.domain,
    proposed_params: ticket.proposed_params, shadow_passed: ticket.shadow_passed,
    shadow_evidence_kind: ticket.shadow_evidence_kind,
    drift_status: ticket.drift_status, drift_score: ticket.drift_score,
    budget: ticket.budget, search_iterations: ticket.search_iterations,
    suggested_risk_profile: ticket.suggested_risk_profile,
    notification_subject: ticket.notification_subject, notification_body: ticket.notification_body,
    notes: ticket.notes, research_summary: ticket.research_summary || null,
  };
}

export async function researchPromotionReviewBinding(ticket) {
  let canonical;
  try {
    canonical = canonicalResearchTaskJson(researchPromotionReviewMaterial(ticket));
  } catch (error) {
    // Only canonical data validation is recoverable per ticket. Hash/storage
    // failures must not be relabelled as invalid material or a healthy queue.
    if (error?.message === "research task must use finite JSON values"
      || error?.message === "research task must use JSON values") throw new ResearchPromotionReviewMaterialError();
    throw error;
  }
  return { schema_version: "qsl_promotion_review_binding.v2", review_sha256: await sha256Hex(canonical) };
}

export function promotionReviewBindingsMatch(left, right) {
  return left?.schema_version === "qsl_promotion_review_binding.v2" && right?.schema_version === left.schema_version
    && /^[0-9a-f]{64}$/.test(left.review_sha256) && left.review_sha256 === right.review_sha256;
}

export function promotionMaterialReviewBinding(row) {
  try {
    const binding = JSON.parse(row?.summary_json || "{}").review_binding;
    return promotionReviewBindingsMatch(binding, binding) ? { schema_version: "qsl_promotion_review_binding.v2", review_sha256: binding.review_sha256 } : null;
  } catch { return null; }
}

export async function recoveryDecisionMaterialKey(recovery) {
  if (recovery.mode === "initial_enrollment") return humanDecisionMaterialSha256({
    mode: recovery.mode, recovery_id: recovery.recovery_id,
    candidate_sha256: recovery.candidate?.candidate_sha256 || recovery.candidate_sha256,
    facts_sha256: recovery.candidate?.facts_sha256 || recovery.facts_sha256,
  });
  return humanDecisionMaterialSha256({
    recovery_id: recovery.recovery_id,
    candidate_sha256: recovery.candidate_sha256,
    dual_review_binding_sha256: recovery.dual_review.evidence_binding_sha256,
  });
}

export function humanDecisionTimestamp(value) {
  return String(value || new Date().toISOString()).replace(/\.\d{3}Z$/, "Z");
}

export function recoveryMaterialEligible(recovery, sourceFreshness, evidenceFreshness) {
  if (recovery.mode === "initial_enrollment") return sourceFreshness?.data_status === "ready" && evidenceFreshness?.data_status === "ready"
    && Object.values(recovery.candidate.coverage).every(status => status === "complete");
  return sourceFreshness?.data_status === "ready"
    && evidenceFreshness?.data_status === "ready"
    && recovery.readiness === "awaiting_human_confirmation"
    && recovery.reconciliation_state === "RECONCILE_ONLY"
    && !recovery.blocker_codes.length
    && recovery.dual_review.evidence_binding_sha256 === recovery.candidate_sha256
    && recovery.evidence_sample_count >= 1;
}

// A safe projection of durable material authority. It carries only digests and
// server-side expiry; raw provider payloads and credentials never enter a read model.
export function humanDecisionAuthorityView(authority) {
  if (!authority || typeof authority !== "object") return null;
  const materialKey = /^[0-9a-f]{64}$/.test(authority.material_key || "") ? authority.material_key : null;
  const expiresAt = typeof authority.expires_at === "string" && Number.isFinite(Date.parse(authority.expires_at))
    ? authority.expires_at
    : null;
  return {
    material_sha256: materialKey,
    expires_at: expiresAt,
    eligible: typeof authority.eligible === "boolean" ? authority.eligible : null,
    blocked: authority.blocked === true,
    unavailable: authority.migrated === false,
    source: "durable_human_decision_material",
  };
}

/**
 * @param {any} ticket
 * @param {any} authority
 * @param {{ normalizeResearchPromotionTicket: Function }} deps
 */
export function overlayPromotionDecision(ticket, authority, deps) {
  const { normalizeResearchPromotionTicket } = deps;
  if (!authority || authority.migrated === false) return ticket;
  const current = authority.eligible === true && authority.blocked !== true ? authority.decision : null;
  if (current?.payload?.ticket && (current.action === "accept" || current.action === "reject")) {
    return normalizeResearchPromotionTicket(current.payload.ticket, "human decision ticket");
  }
  if (ticket.state !== "human_accepted" && ticket.state !== "human_rejected") return ticket;
  return normalizeResearchPromotionTicket({
    ...ticket,
    state: "awaiting_human",
    human_decision: "",
    human_decided_at: "",
    confirmation_target_platform: "",
    confirmation_execution_mode: "",
    confirmation_risk_profile: "",
  }, "human decision ticket");
}

/**
 * Fixed projection of the durable terminal record, never a request echo or KV fallback.
 *
 * @param {any} record
 * @param {any} expected
 * @param {{
 *   calculateReconciliationRecoveryConfirmationSha256: Function,
 * }} deps
 */
export async function humanDecisionReceipt(record, expected, deps) {
  const { calculateReconciliationRecoveryConfirmationSha256 } = deps;
  const invalid = () => { throw new HttpError("human_decision_receipt_unavailable", 503); };
  const text = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  const actions = { owner: ["approve_limited_live_canary", "keep_parked"], recovery: ["approve", "reject"], promotion: ["accept", "reject"] };
  if (!record || !actions[record.kind]?.includes(record.action) || !text(record.subject_id, 256)
    || !/^[0-9a-f]{64}$/.test(record.material_key) || !text(record.actor, 100)
    || !text(record.decided_at, 40) || !Number.isFinite(Date.parse(record.decided_at))
    || record.kind !== expected.kind || record.subject_id !== expected.subject_id || record.material_key !== expected.material_sha256) invalid();
  let target;
  try { target = JSON.parse(record.target_json); } catch { invalid(); }
  let projection;
  if (record.kind === "promotion") {
    const account = target?.selected_account;
    const confirmation = target?.confirmation;
    if (account != null && (!SUPPORTED_PLATFORMS.includes(account.platform) || !text(account.key, 128))) invalid();
    if (confirmation != null && (!SUPPORTED_PLATFORMS.includes(confirmation.target_platform)
      || !["live", "paper", "dry_run"].includes(confirmation.execution_mode)
      || !RESEARCH_PROMOTION_RISK_PROFILES.includes(confirmation.risk_profile))) invalid();
    if (record.action === "accept" && (!account || !confirmation || account.platform !== confirmation.target_platform)) invalid();
    if (record.payload?.ticket?.live_authority_granted !== false || record.payload?.ticket?.human_decision !== record.action
      || record.payload?.ticket?.ticket_id !== record.subject_id || record.payload.ticket.human_decided_at !== record.decided_at
      || await researchPromotionMaterialKey(record.payload.ticket) !== record.material_key
      || canonicalResearchTaskJson(record.payload.selected_account ?? null) !== canonicalResearchTaskJson(account ?? null)
      || canonicalResearchTaskJson(record.payload.confirmation ?? null) !== canonicalResearchTaskJson(confirmation ?? null)) invalid();
    projection = {
      selected_account: account ? { platform: account.platform, key: account.key } : null,
      confirmation: confirmation ? { target_platform: confirmation.target_platform, execution_mode: confirmation.execution_mode, risk_profile: confirmation.risk_profile } : null,
    };
  } else {
    if (target?.decision !== record.action || record.payload?.no_order !== true || record.payload?.execution_authority_granted !== false) invalid();
    const payload = record.payload;
    if (record.kind === "owner") {
      if (payload.schema_version !== "qsl_owner_decision_intent.v1" || payload.candidate_id !== record.subject_id
        || payload.candidate_evidence_sha256 !== record.material_key || payload.decision !== record.action
        || payload.decided_by !== record.actor || payload.decided_at !== record.decided_at
        || payload.decision_sha256 !== await humanDecisionMaterialSha256(payload)) invalid();
    } else if (payload.mode === "initial_enrollment") {
      const approval = record.action === "approve";
      if (payload.schema_version !== (approval ? "qsl_initial_enrollment_confirmation.v1" : "qsl_initial_enrollment_rejection.v1")
        || payload.recovery_id !== record.subject_id || (approval ? payload.confirmed_by : payload.decided_by) !== record.actor
        || (approval ? payload.confirmed_at : payload.decided_at) !== record.decided_at || (!approval && payload.decision !== "reject")
        || (approval && payload.confirmation_sha256 !== await calculateReconciliationRecoveryConfirmationSha256(payload))
        || await recoveryDecisionMaterialKey(payload) !== record.material_key) invalid();
    } else {
      const approval = record.action === "approve";
      if (payload.schema_version !== (approval ? "qsl_reconciliation_recovery_confirmation.v1" : "qsl_reconciliation_recovery_rejection.v1")
        || payload.recovery_id !== record.subject_id || (approval ? payload.confirmed_by : payload.decided_by) !== record.actor
        || (approval ? payload.confirmed_at : payload.decided_at) !== record.decided_at || (!approval && payload.decision !== "reject")
        || await recoveryDecisionMaterialKey({ recovery_id: payload.recovery_id, candidate_sha256: payload.candidate_sha256, dual_review: { evidence_binding_sha256: payload.dual_review_binding_sha256 } }) !== record.material_key) invalid();
    }
    projection = { decision: target.decision };
  }
  // Extra stored target fields must not be silently dropped into an apparently matching receipt.
  if (canonicalResearchTaskJson(target) !== canonicalResearchTaskJson(projection)) invalid();
  let reviewBinding = null;
  if (record.kind === "promotion" && record.payload?.review_binding !== undefined) {
    const material = record.payload.review_material;
    if (material?.schema_version !== "qsl_promotion_review_material.v2" || material.ticket_id !== record.subject_id
      || await researchPromotionMaterialKey(material) !== record.material_key
      || !promotionReviewBindingsMatch(record.payload.review_binding, { schema_version: "qsl_promotion_review_binding.v2", review_sha256: await humanDecisionMaterialSha256(material) })) invalid();
    reviewBinding = { schema_version: "qsl_promotion_review_binding.v2", review_sha256: record.payload.review_binding.review_sha256 };
  }
  const receipt = {
    schema_version: reviewBinding ? "qsl_human_decision_receipt.v2" : "qsl_human_decision_receipt.v1",
    ...(reviewBinding ? { review_binding: reviewBinding } : {}),
    kind: record.kind, subject_id: record.subject_id, material_sha256: record.material_key,
    action: record.action, target: projection, decided_at: record.decided_at, decided_by: record.actor,
    no_order: true, execution_authority_granted: false,
  };
  return { ...receipt, receipt_sha256: await humanDecisionMaterialSha256(receipt) };
}
