/**
 * Owner-decision normalize / evidence / queue helpers.
 *
 * Never import runtime_support. Human-decision authority readers stay injected
 * so this module cannot form a cycle with still-monolithic human_decision_* code.
 */

import { cleanGithubLogin, uniqueStrings } from "../auth/identity_lists.js";
import { readConfigJson } from "../config_kv.js";
import {
  CONTROL_PLANE_CANDIDATE_KINDS,
  CONTROL_PLANE_DOMAINS,
} from "../control_plane/constants.js";
import {
  isOwnerDecisionCandidate,
  normalizeControlPlaneIdentifier,
} from "../control_plane/helpers.js";
import { HttpError } from "../http_error.js";
import {
  assertExactFields,
  assertRequiredAndOptionalFields,
  canonicalResearchTaskJson,
  normalizeResearchTaskDigest,
  normalizeResearchTaskTimestamp,
} from "../research_task/helpers.js";
import {
  OWNER_DECISION_CHOICES,
  OWNER_DECISION_CURRENT_PREFIX,
  OWNER_DECISION_INTENT_PREFIX,
  OWNER_DECISION_INTENT_SCHEMA_VERSION,
  OWNER_DECISION_QUEUE_SCHEMA_VERSION,
} from "./constants.js";

function cleanChoice(value, allowed, field) {
  const text = String(value || "").trim();
  if (!allowed.includes(text)) throw new Error(`${field} is invalid`);
  return text;
}

export function currentOwnerDecisionCandidate(controlPlane, candidateId) {
  if (controlPlane?.data_status !== "ready") {
    throw new HttpError("current control-plane evidence is not ready", 409);
  }
  const candidate = controlPlane.candidates.find((item) => item.candidate_id === candidateId);
  if (!candidate || !isOwnerDecisionCandidate(candidate)) {
    throw new HttpError("candidate is not awaiting an owner decision", 409);
  }
  if (candidate.freshness?.status !== "fresh") {
    throw new HttpError("candidate evidence is not fresh", 409);
  }
  return candidate;
}

export function normalizeOwnerDecisionRequest(payload) {
  const value = assertRequiredAndOptionalFields(payload, [
    "candidate_id", "decision", "candidate_evidence_sha256",
  ], ["request_id"], "owner decision request");
  return {
    candidate_id: normalizeControlPlaneIdentifier(value.candidate_id, "owner decision request.candidate_id", false),
    decision: cleanChoice(value.decision, OWNER_DECISION_CHOICES, "owner decision request.decision"),
    candidate_evidence_sha256: normalizeResearchTaskDigest(
      value.candidate_evidence_sha256,
      "owner decision request.candidate_evidence_sha256",
    ),
    request_id: value.request_id,
  };
}

export async function ownerDecisionCandidateEvidenceSha256(candidate) {
  return await calculateOwnerDecisionSha256({
    candidate_id: candidate.candidate_id,
    candidate_kind: candidate.candidate_kind,
    domain: candidate.domain,
    lifecycle: candidate.lifecycle,
    evidence: candidate.evidence,
    recommendation: { code: candidate.recommendation?.code || "none" },
  });
}

export async function buildOwnerDecisionIntent({ candidate, decision, decidedBy, candidateEvidenceSha256, decidedAt }) {
  const intent = {
    schema_version: OWNER_DECISION_INTENT_SCHEMA_VERSION,
    candidate_id: candidate.candidate_id,
    candidate_kind: candidate.candidate_kind,
    domain: candidate.domain,
    decision,
    decided_at: decidedAt,
    decided_by: decidedBy,
    candidate_evidence_sha256: candidateEvidenceSha256,
    no_order: true,
    execution_authority_granted: false,
    decision_sha256: "",
  };
  intent.decision_sha256 = await calculateOwnerDecisionSha256(intent);
  return await normalizeOwnerDecisionIntent(intent, "owner decision intent");
}

export async function normalizeOwnerDecisionIntent(payload, fieldName) {
  const value = assertExactFields(payload, [
    "schema_version", "candidate_id", "candidate_kind", "domain", "decision", "decided_at", "decided_by",
    "candidate_evidence_sha256", "no_order", "execution_authority_granted", "decision_sha256",
  ], fieldName);
  if (value.schema_version !== OWNER_DECISION_INTENT_SCHEMA_VERSION) {
    throw new Error(`${fieldName}.schema_version is unsupported`);
  }
  const intent = {
    schema_version: OWNER_DECISION_INTENT_SCHEMA_VERSION,
    candidate_id: normalizeControlPlaneIdentifier(value.candidate_id, `${fieldName}.candidate_id`, false),
    candidate_kind: cleanChoice(value.candidate_kind, CONTROL_PLANE_CANDIDATE_KINDS, `${fieldName}.candidate_kind`),
    domain: cleanChoice(value.domain, CONTROL_PLANE_DOMAINS, `${fieldName}.domain`),
    decision: cleanChoice(value.decision, OWNER_DECISION_CHOICES, `${fieldName}.decision`),
    decided_at: normalizeResearchTaskTimestamp(value.decided_at, `${fieldName}.decided_at`),
    decided_by: cleanGithubLogin(value.decided_by, `${fieldName}.decided_by`),
    candidate_evidence_sha256: normalizeResearchTaskDigest(
      value.candidate_evidence_sha256,
      `${fieldName}.candidate_evidence_sha256`,
    ),
    no_order: value.no_order,
    execution_authority_granted: value.execution_authority_granted,
    decision_sha256: normalizeResearchTaskDigest(value.decision_sha256, `${fieldName}.decision_sha256`),
  };
  if (intent.no_order !== true || intent.execution_authority_granted !== false) {
    throw new Error(`${fieldName} must remain no-order and non-executable`);
  }
  if (intent.decision_sha256 !== await calculateOwnerDecisionSha256(intent)) {
    throw new Error(`${fieldName}.decision_sha256 mismatch`);
  }
  return intent;
}

export async function calculateOwnerDecisionSha256(payload) {
  const material = { ...payload };
  delete material.decision_sha256;
  const raw = new TextEncoder().encode(canonicalResearchTaskJson(material));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {any} env
 * @param {string} candidateId
 * @param {string} materialKey
 * @param {{
 *   readHumanDecisionAuthority: Function,
 *   humanDecisionAuthorityView: Function,
 * }} deps
 */
export async function readOwnerDecisionIntent(env, candidateId, materialKey, deps) {
  const { readHumanDecisionAuthority, humanDecisionAuthorityView } = deps;
  let authority;
  try {
    authority = await readHumanDecisionAuthority(env, "owner", candidateId);
  } catch (error) {
    return { intent: null, authority: null, error: error.message || "runtime_instances_unavailable" };
  }
  const authorityView = humanDecisionAuthorityView(authority);
  if (authority.blocked) return { intent: null, authority: authorityView, error: "owner_decision_legacy_blocked" };
  if (authority.decision && authority.material_key === materialKey && authority.decision.payload?.no_order === true && authority.decision.payload?.execution_authority_granted === false) {
    return { intent: authority.decision.payload, authority: authorityView, error: null };
  }
  if (authority.migrated === false) {
    try {
      const stored = await readConfigJson(env, ownerDecisionCurrentKey(candidateId));
      if (!stored) return { intent: null, authority: authorityView, error: null };
      const intent = await normalizeOwnerDecisionIntent(stored, ownerDecisionCurrentKey(candidateId));
      if (materialKey && intent.candidate_evidence_sha256 !== materialKey) return { intent: null, authority: authorityView, error: null };
      return { intent, authority: authorityView, error: null, read_only: true };
    } catch {
      return { intent: null, authority: authorityView, error: "owner_decision_intent_invalid" };
    }
  }
  return { intent: null, authority: authorityView, error: null };
}

export function ownerDecisionArchiveKey(candidateId, decisionSha256) {
  return `${OWNER_DECISION_INTENT_PREFIX}${candidateId}:${decisionSha256}`;
}

export function ownerDecisionCurrentKey(candidateId) {
  return `${OWNER_DECISION_CURRENT_PREFIX}${candidateId}`;
}

export function emptyOwnerDecisionQueue(errorCode, controlPlane = null) {
  return {
    schema_version: OWNER_DECISION_QUEUE_SCHEMA_VERSION,
    data_status: controlPlane?.data_status === "stale" ? "stale" : "unavailable",
    computed_at: controlPlane?.computed_at || null,
    candidates: [],
    policy: {
      admin_required: true,
      current_evidence_required: true,
      execution_authority_granted: false,
      no_order: true,
      notice: "网页只记录所有者决定意图；不会下单、变更资金或启用实盘。",
    },
    errors: uniqueStrings([...(controlPlane?.errors || []), errorCode]),
  };
}
