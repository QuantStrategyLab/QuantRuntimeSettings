import { DECISION_ACTIONS, decisionCategoryPart, decisionKind, decisionRevision } from "./decision_contract.js";

const digest = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
const instant = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const RESUME = Object.freeze({
  decision_evidence_stale: "refresh_evidence",
  decision_source_unavailable: "restore_source_read",
  decision_not_actionable: "use_existing_maintenance_process",
  decision_expiry_unavailable: "restore_verified_decision_material",
  decision_expired: "refresh_decision_material",
  recovery_blocked: "restore_recovery_readiness",
  recovery_not_awaiting_confirmation: "restore_recovery_readiness",
  decision_already_decided: "read_existing_decision_receipt",
  decision_legacy_blocked: "restore_verified_decision_material",
  decision_authority_unavailable: "restore_authority_read",
  decision_material_ineligible: "restore_verified_decision_material",
  decision_material_changed: "reload_current_revision",
});

/** Read-only decision action lifecycle; it never certifies downstream execution. */
export function todoLifecycle(item, acknowledgement = { status: "unavailable" }) {
  const parts = decisionCategoryPart(item.id);
  const kind = decisionKind(item.category);
  const binding = item.decision_binding;
  const material = digest(binding?.material_sha256);
  const review = digest(binding?.review_binding?.review_sha256);
  const bound = !!(parts && kind && parts.category === item.category && binding?.kind === kind
    && binding.subject_id === parts.subject_id && material && item.revision === decisionRevision(binding, item.id));
  const supported = !!kind;
  const codes = Array.isArray(item.blocking_reason_codes) ? item.blocking_reason_codes : [null];
  const blockers = [...new Set(codes.slice(0, 20).map(code => typeof code === "string" && Object.hasOwn(RESUME, code) ? code : "decision_blocked_unknown"))]
    .map(code => ({ code, resume_condition: RESUME[code] || "restore_verified_decision_material" }));
  if (codes.length > 20 && !blockers.some(blocker => blocker.code === "decision_blocked_unknown"))
    blockers.push({ code: "decision_blocked_unknown", resume_condition: "restore_verified_decision_material" });
  let status = supported ? "unknown" : "unsupported";
  const ack = acknowledgement;
  if (bound && ack?.status === "not_found") status = "pending";
  if (bound && (kind !== "promotion" || review !== null) && ack?.status === "found" && ack.kind === kind && ack.subject_id === parts.subject_id
    && ack.material_sha256 === material && (ack.review_sha256 ?? null) === review
    && DECISION_ACTIONS[item.category]?.includes(ack.action) && digest(ack.receipt_sha256)
    && instant(ack.acknowledged_at) && /^actor-[0-9a-f]{16}$/.test(ack.actor_alias || "")) status = "acknowledged";
  const completion = {
    status, scope: "decision_intent",
    actor_alias: status === "acknowledged" ? ack.actor_alias : null,
    acknowledged_at: status === "acknowledged" ? ack.acknowledged_at : null,
    receipt_sha256: status === "acknowledged" ? ack.receipt_sha256 : null,
  };
  if (status === "unknown") blockers.push({ code: "decision_completion_unknown", resume_condition: "restore_exact_decision_receipt" });
  return {
    schema_version: "qsl.todo_lifecycle.v1", scope: "decision_intent",
    owner: { required_role: supported ? "admin" : null, assignment_status: "not_recorded", actor_alias: null },
    state: status === "acknowledged" ? "acknowledged" : !supported ? "unsupported"
      : status === "unknown" ? "unknown" : item.status === "expired" ? "expired"
        : blockers.length || item.actionable !== true ? "blocked" : "pending",
    blockers,
    setup_decision: { status: bound ? "available" : "unavailable",
      href: bound ? `?page=decisions&decision=${encodeURIComponent(item.id)}` : null,
      decision_id: bound ? item.id : null, revision: bound ? item.revision : null, material_sha256: bound ? material : null },
    completion, no_order: true, execution_authority_granted: false,
  };
}

/** No cache: only this returned page is enriched from current durable authority. */
export async function todoLifecycleItem(item, readCompletion) {
  let acknowledgement;
  try { acknowledgement = readCompletion ? await readCompletion(item) : null; }
  catch { acknowledgement = null; }
  return { ...item, todo_lifecycle: todoLifecycle(item, acknowledgement) };
}
