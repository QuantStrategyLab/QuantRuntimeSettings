import { riskTierPolicy } from "./risk_tiers.js";

/** Stable decision review projection shared by the inbox and /api/decisions. */
export const DECISION_REVIEW_SCHEMA_VERSION = "qsl.decision_review.v1";
export const DECISION_CATEGORIES = Object.freeze([
  "reconciliation_recovery",
  "strategy_promotion",
  "owner_decision",
  "credential_maintenance",
  "paper_account_application",
]);
export const DECISION_ACTIONS = Object.freeze({
  owner_decision: Object.freeze(["approve_limited_live_canary", "keep_parked"]),
  reconciliation_recovery: Object.freeze(["approve", "reject"]),
  strategy_promotion: Object.freeze(["accept", "reject"]),
  paper_account_application: Object.freeze(["accept", "reject"]),
  credential_maintenance: Object.freeze([]),
});
export const DECISION_ACTION_LABELS = Object.freeze({
  approve_limited_live_canary: "decisions.action.approve_limited_live_canary",
  keep_parked: "decisions.action.keep_parked",
  approve: "decisions.action.approve",
  reject: "decisions.action.reject",
  accept: "decisions.action.accept",
});
const DECISION_KIND = Object.freeze({
  owner_decision: "owner",
  strategy_promotion: "promotion",
  paper_account_application: "promotion",
  reconciliation_recovery: "recovery",
});
const DECISION_WRITE_FROM_CATEGORY = Object.freeze({
  owner_decision: "owner_decision",
  strategy_promotion: "strategy_promotion",
  paper_account_application: "strategy_promotion",
  reconciliation_recovery: "reconciliation_recovery",
});
const digest = (value) =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
const instant = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

export function decisionCategoryPart(id) {
  const match = /^(owner_decision|strategy_promotion|paper_account_application|reconciliation_recovery|credential_maintenance):(.+)$/.exec(String(id || ""));
  if (!match || match[2].length > 256 || /[\u0000-\u001f\u007f]/.test(match[2])) return null;
  return { category: match[1], subject_id: match[2] };
}

export function decisionKind(category) {
  return DECISION_KIND[category] || null;
}

/** The legacy write category that owns the durable decision record. */
export function decisionWriteCategory(category) {
  return DECISION_WRITE_FROM_CATEGORY[category] || category;
}

export function decisionSubjectId(category, data, entry) {
  if (category === "credential_maintenance") return data.id || null;
  if (category === "reconciliation_recovery") return data.recovery_id || entry.recovery_id || null;
  if (category === "owner_decision") return data.candidate_id || null;
  return data.ticket_id || entry.ticket_id || null;
}

export function decisionIdFor(category, subjectId) {
  return subjectId ? `${category}:${subjectId}` : null;
}

/** Synchronous, opaque material revision. The server still matches the full digest. */
export function decisionRevision(binding, fallbackId) {
  const material = digest(binding?.material_sha256);
  if (material) {
    const review = digest(binding?.review_binding?.review_sha256);
    return `rev1-${material.slice(0, 16)}${review ? `-${review.slice(0, 8)}` : ""}`;
  }
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(String(fallbackId || "")))
    hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return `rev0-${hash.toString(16).padStart(8, "0")}`;
}

export function decisionExpiry(entry, data) {
  const authority = entry?.decision_authority;
  if (authority && Object.prototype.hasOwnProperty.call(authority, "expires_at"))
    return instant(authority.expires_at);
  return instant(data?.expires_at) || instant(entry?.expires_at);
}

export function decisionExpiryState(expiresAt, now = Date.now()) {
  if (!expiresAt) return "unavailable";
  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed)) return "unavailable";
  return now >= parsed ? "expired" : "active";
}

export function decisionRecorded(entry, data, category) {
  if (category === "credential_maintenance") return false;
  return Boolean(
    entry?.intent ||
    entry?.confirmation ||
    entry?.rejection ||
    data?.human_decision ||
    ["human_accepted", "human_rejected"].includes(data?.state) ||
    entry?.application,
  );
}

export function decisionRecordAction(entry, data, category) {
  if (entry?.intent?.decision) return entry.intent.decision;
  if (entry?.rejection) return "reject";
  if (entry?.confirmation) return "approve";
  if (data?.human_decision) return data.human_decision;
  if (entry?.application || data?.state === "human_accepted") return "accept";
  if (data?.state === "human_rejected") return "reject";
  return null;
}

export function decisionRecordDecidedAt(entry, data) {
  return instant(
    entry?.intent?.decided_at ||
    entry?.confirmation?.confirmed_at ||
    entry?.rejection?.decided_at ||
    data?.human_decided_at ||
    entry?.application?.updated_at,
  );
}

export function decisionTransition(category, data, entry, action = null) {
  const target = category === "paper_account_application" ? "paper" : "small_live";
  if (category === "owner_decision")
    return {
      axis: "authorized_stage",
      from: data?.lifecycle?.stage || "P6",
      to: action === "approve_limited_live_canary" ? "small_live_intent" : action === "keep_parked" ? "research" : (data?.lifecycle?.stage || "P6"),
      pending_to: "small_live_intent",
    };
  if (category === "strategy_promotion" || category === "paper_account_application")
    return {
      axis: "authorized_stage",
      from: "research",
      to: action === "accept" ? `${target}_intent` : action === "reject" ? "research" : "research",
      pending_to: `${target}_intent`,
    };
  if (category === "reconciliation_recovery") {
    const enrollment = data?.mode === "initial_enrollment";
    return {
      axis: "operating_state",
      from: enrollment ? "UNENROLLED" : (data?.reconciliation_state || "RECONCILE_ONLY"),
      to: action === "approve" ? (enrollment ? "ACCOUNT_ENROLLED_INTENT" : "ACTIVE_LKG_INTENT") : action === "reject" ? "PAUSED" : (enrollment ? "UNENROLLED" : (data?.reconciliation_state || "RECONCILE_ONLY")),
      pending_to: enrollment ? "ACCOUNT_ENROLLED_INTENT" : "ACTIVE_LKG_INTENT",
    };
  }
  return { axis: "credential", from: "current", to: "current", pending_to: "rotated" };
}

export function decisionActionability(entry, data, category, now = Date.now()) {
  const blockers = [];
  const freshness = entry?.freshness?.data_status || entry?.freshness?.status || data?.freshness?.status || "unknown";
  if (["stale", "expired"].includes(freshness)) blockers.push("decision_evidence_stale");
  if (["unavailable", "read_failed"].includes(entry?.source_status)) blockers.push("decision_source_unavailable");
  const supported = DECISION_ACTIONS[category] || [];
  if (!supported.length) blockers.push("decision_not_actionable");
  const expiresAt = decisionExpiry(entry, data);
  if (supported.length && !expiresAt) blockers.push("decision_expiry_unavailable");
  else if (expiresAt && decisionExpiryState(expiresAt, now) !== "active") blockers.push("decision_expired");
  if (category === "reconciliation_recovery" && data?.readiness && data.readiness !== "awaiting_human_confirmation")
    blockers.push(data.readiness === "blocked" ? "recovery_blocked" : "recovery_not_awaiting_confirmation");
  if (decisionRecorded(entry, data, category)) blockers.push("decision_already_decided");
  if (Array.isArray(data?.blocker_codes)) blockers.push(...data.blocker_codes);
  const authority = entry?.decision_authority;
  if (authority?.blocked === true) blockers.push("decision_legacy_blocked");
  if (authority?.unavailable === true) blockers.push("decision_authority_unavailable");
  if (authority && authority.eligible === false && !blockers.includes("decision_expired")
    && !blockers.includes("decision_material_ineligible")) blockers.push("decision_material_ineligible");
  return { actionable: blockers.length === 0, blocker_codes: [...new Set(blockers.filter(Boolean))] };
}

export function decisionAllowedActions(entry, data, category, actionability) {
  if (!actionability.actionable || decisionRecorded(entry, data, category)) return [];
  const supported = DECISION_ACTIONS[category] || [];
  if (category === "reconciliation_recovery" && data?.readiness !== "awaiting_human_confirmation") return [];
  if ((category === "strategy_promotion" || category === "paper_account_application")
    && data?.state !== "awaiting_human") return [];
  return [...supported];
}

export function decisionActionList(category, actions) {
  return actions.map((action) => ({
    action,
    label_key: DECISION_ACTION_LABELS[action] || `decisions.action.${action}`,
    requires_selection: category === "strategy_promotion" || category === "paper_account_application"
      ? action === "accept" : false,
  }));
}

export function decisionRiskImpact(category, data, affectsLive, tier = null) {
  const selectedTier = ["CAPITAL_PRESERVATION", "BALANCED_COMPOUNDING", "GROWTH_COMPOUNDING"].includes(tier) ? tier : null;
  return {
    affects_live: affectsLive === true,
    tier: selectedTier,
    tier_label_key: selectedTier ? `risk.tier.${selectedTier}` : null,
    policy: riskTierPolicy(selectedTier),
    execution_authority_granted: false,
  };
}

export function decisionEvidenceSummary(entry, data, category, binding) {
  const dual = data?.dual_review || null;
  return {
    material_sha256: digest(binding?.material_sha256),
    review_sha256: digest(binding?.review_binding?.review_sha256),
    candidate_sha256: digest(data?.candidate_sha256),
    facts_sha256: digest(data?.facts_sha256),
    dual_review_binding_sha256: digest(dual?.evidence_binding_sha256),
    observed_at: instant(data?.last_observed_at || data?.observed_at),
    first_observed_at: instant(data?.first_observed_at),
    sample_count: Number.isSafeInteger(data?.evidence_sample_count) ? data.evidence_sample_count : null,
    dual_review: dual ? {
      outcome: typeof dual.outcome === "string" && dual.outcome.length <= 40 ? dual.outcome : null,
      reviewer_count: Number.isSafeInteger(dual.reviewer_count) ? dual.reviewer_count : null,
    } : null,
    shadow: category === "strategy_promotion" || category === "paper_account_application" ? {
      passed: data?.shadow_passed === true,
      evidence_kind: typeof data?.shadow_evidence_kind === "string" && data.shadow_evidence_kind.length <= 80
        ? data.shadow_evidence_kind : null,
    } : null,
    source_id: typeof entry?.source_id === "string" && entry.source_id.length <= 80 ? entry.source_id : null,
    freshness: entry?.freshness?.data_status || entry?.freshness?.status || "unknown",
  };
}

export function operationIdFor(category, subjectId) {
  return subjectId ? `operation:${category}:${subjectId}` : null;
}

/** Client-supplied identity of one decision action intent. */
export const DECISION_OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * The stable operation id of an action request. `request_id` stays the transport
 * retry id; `operation_id` names the intent itself, so a retried intent keeps one
 * identity while a genuinely new intent must pick a new id.
 */
export function decisionOperationId(body) {
  const operationId = typeof body?.operation_id === "string" ? body.operation_id.trim() : "";
  const requestId = typeof body?.request_id === "string" ? body.request_id.trim() : "";
  if (operationId && requestId && operationId !== requestId) return null;
  const id = operationId || requestId;
  return DECISION_OPERATION_ID_PATTERN.test(id) ? id : null;
}

/** Digest of the action intent, so a reused operation id is told apart from a retry. */
export async function decisionOperationSha256(decisionId, body) {
  const selection = body?.selection && typeof body.selection === "object" ? body.selection : null;
  const canonical = JSON.stringify([
    String(decisionId || ""),
    String(body?.action || ""),
    selection ? [String(selection.confirmation || ""), String(selection.selected_account || "")] : null,
  ]);
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function operationStatusFromApplication(application) {
  if (!application) return "unapplied";
  if (application.status === "approved")
    return application.dispatch_state === "unknown" ? "unknown" : "accepted";
  if (application.status === "claimed") return "applying";
  if (application.status === "applied_paused") return "applied";
  if (application.status === "rejected") return "failed";
  if (application.status === "uncertain") return "unknown";
  return "unknown";
}

export function decisionOperationReference(entry, category, subjectId) {
  const application = entry?.application || null;
  const id = operationIdFor(category, subjectId);
  if (!id) return null;
  if (category === "strategy_promotion" || category === "paper_account_application")
    return {
      id,
      status: operationStatusFromApplication(application),
      activation_status: "not_connected",
      reason_code: application ? (application.reason_code || null) : "application_not_created",
      updated_at: instant(application?.updated_at),
    };
  return {
    id,
    status: "unapplied",
    activation_status: "not_connected",
    reason_code: "application_not_connected",
    updated_at: null,
  };
}

export function decisionCurrentEligibility(item, authority, now = Date.now()) {
  const expiresAt = decisionExpiry({ decision_authority: authority }, item);
  const expiryState = decisionExpiryState(expiresAt, now);
  const material = digest(item?.decision_binding?.material_sha256);
  const authoritative = digest(authority?.material_sha256);
  const materialMatches = material && authoritative ? material === authoritative : null;
  const blockers = [...(item?.blocking_reason_codes || [])];
  if (item?.decision_state?.status === "decided") blockers.push("decision_already_decided");
  if (expiryState === "expired") blockers.push("decision_expired");
  if (expiryState === "unavailable" && (DECISION_ACTIONS[item?.category] || []).length) blockers.push("decision_expiry_unavailable");
  if (materialMatches === false) blockers.push("decision_material_changed");
  if (authority?.blocked === true) blockers.push("decision_legacy_blocked");
  if (authority?.eligible === false) blockers.push("decision_material_ineligible");
  const allowed = item?.actionable === true && item?.decision_state?.status !== "decided"
    && expiryState === "active" && materialMatches !== false && authority?.blocked !== true && authority?.eligible !== false;
  return {
    eligible: allowed,
    material_matches: materialMatches,
    expired: expiryState === "expired",
    blocked: authority?.blocked === true,
    reason_codes: [...new Set(blockers.filter(Boolean))],
  };
}
