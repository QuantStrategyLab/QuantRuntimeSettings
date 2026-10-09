/**
 * Owner-decision HTTP use cases (GET/POST /api/owner-decisions).
 *
 * B10-c: application layer for human approval / owner decision routes.
 * Fingerprint (candidate_evidence_sha256), revision readiness, admin
 * permission rejects, and no_order / execution_authority_granted stay identical.
 * Durable Object human_decision_* tables and identity keys stay in worker/DO;
 * this module only uses injected repository helpers and never opens a txn.
 */

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   json: Function,
 *   readSession: Function,
 *   exactHumanDecisionResponse: Function,
 *   hasConfigStore: Function,
 *   currentControlPlanePayload: Function,
 *   isOwnerDecisionCandidate: Function,
 *   ownerDecisionCandidateEvidenceSha256: Function,
 *   readOwnerDecisionIntent: Function,
 *   emptyOwnerDecisionQueue: Function,
 *   uniqueStrings: Function,
 *   OWNER_DECISION_MAX_CANDIDATES: number,
 *   OWNER_DECISION_QUEUE_SCHEMA_VERSION: string,
 * }} deps
 */
export async function ownerDecisionQueueResponse(request, env, deps) {
  const {
    json,
    readSession,
    exactHumanDecisionResponse,
    hasConfigStore,
    currentControlPlanePayload,
    isOwnerDecisionCandidate,
    ownerDecisionCandidateEvidenceSha256,
    readOwnerDecisionIntent,
    emptyOwnerDecisionQueue,
    uniqueStrings,
    OWNER_DECISION_MAX_CANDIDATES,
    OWNER_DECISION_QUEUE_SCHEMA_VERSION,
  } = deps;
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  const exact = await exactHumanDecisionResponse(request, env, session, "owner");
  if (exact) return exact;
  if (!hasConfigStore(env)) return json(emptyOwnerDecisionQueue("snapshot_unavailable"));

  const controlPlane = await currentControlPlanePayload(env);
  if (controlPlane.data_status !== "ready") {
    return json(emptyOwnerDecisionQueue("control_plane_not_ready", controlPlane));
  }

  const pending = controlPlane.candidates
    .filter(isOwnerDecisionCandidate)
    .filter((candidate) => candidate.freshness?.status === "fresh")
    .slice(0, OWNER_DECISION_MAX_CANDIDATES);
  const errors = [...controlPlane.errors];
  const candidates = [];
  for (const candidate of pending) {
    const candidateEvidenceSha256 = await ownerDecisionCandidateEvidenceSha256(candidate);
    const stored = await readOwnerDecisionIntent(env, candidate.candidate_id, candidateEvidenceSha256);
    if (stored.error) errors.push(stored.error);
    const intent = stored.intent?.candidate_evidence_sha256 === candidateEvidenceSha256
      ? stored.intent
      : null;
    candidates.push({
      candidate,
      candidate_evidence_sha256: candidateEvidenceSha256,
      decision_binding: { kind: "owner", subject_id: candidate.candidate_id, material_sha256: candidateEvidenceSha256 },
      intent,
    });
  }
  if (controlPlane.candidates.filter(isOwnerDecisionCandidate).length > OWNER_DECISION_MAX_CANDIDATES) {
    errors.push("owner_decision_queue_truncated");
  }
  return json({
    schema_version: OWNER_DECISION_QUEUE_SCHEMA_VERSION,
    data_status: "ready",
    computed_at: controlPlane.computed_at,
    candidates,
    policy: {
      admin_required: true,
      current_evidence_required: true,
      execution_authority_granted: false,
      no_order: true,
      notice: "网页只记录所有者决定意图；不会下单、变更资金或启用实盘。",
    },
    errors: uniqueStrings(errors),
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {{
 *   json: Function,
 *   requireSameOrigin: Function,
 *   readSession: Function,
 *   hasConfigStore: Function,
 *   readBoundedJson: Function,
 *   normalizeOwnerDecisionRequest: Function,
 *   currentControlPlanePayload: Function,
 *   currentOwnerDecisionCandidate: Function,
 *   ownerDecisionCandidateEvidenceSha256: Function,
 *   humanDecisionTimestamp: Function,
 *   buildOwnerDecisionIntent: Function,
 *   canonicalResearchTaskJson: Function,
 *   humanDecisionRequestKey: Function,
 *   runtimeInstanceCommand: Function,
 *   humanDecisionReceipt: Function,
 *   mirrorConfigJson: Function,
 *   ownerDecisionArchiveKey: Function,
 *   ownerDecisionCurrentKey: Function,
 *   appendAuditLog: Function,
 * }} deps
 */
export async function recordOwnerDecisionResponse(request, env, deps) {
  const {
    json,
    requireSameOrigin,
    readSession,
    hasConfigStore,
    readBoundedJson,
    normalizeOwnerDecisionRequest,
    currentControlPlanePayload,
    currentOwnerDecisionCandidate,
    ownerDecisionCandidateEvidenceSha256,
    humanDecisionTimestamp,
    buildOwnerDecisionIntent,
    canonicalResearchTaskJson,
    humanDecisionRequestKey,
    runtimeInstanceCommand,
    humanDecisionReceipt,
    mirrorConfigJson,
    ownerDecisionArchiveKey,
    ownerDecisionCurrentKey,
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
    return json({ ok: false, error: error.message || "invalid owner decision request" }, error.status || 400);
  }

  let requested;
  try {
    requested = normalizeOwnerDecisionRequest(raw);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid owner decision request" }, 400);
  }

  const controlPlane = await currentControlPlanePayload(env);
  let candidate;
  try {
    candidate = currentOwnerDecisionCandidate(controlPlane, requested.candidate_id);
  } catch (error) {
    return json({ ok: false, error: error.message || "owner decision is not currently available" }, error.status || 409);
  }
  if (requested.decision === "retire_candidate") {
    return json({ ok: false, error: "owner_retirement_proposal_required" }, 409);
  }
  const candidateEvidenceSha256 = await ownerDecisionCandidateEvidenceSha256(candidate);
  if (requested.candidate_evidence_sha256 !== candidateEvidenceSha256) {
    return json({ ok: false, error: "candidate evidence changed; reload the review before deciding" }, 409);
  }

  const decidedAt = humanDecisionTimestamp();
  const intent = await buildOwnerDecisionIntent({
    candidate,
    decision: requested.decision,
    decidedBy: session.login,
    candidateEvidenceSha256,
    decidedAt,
  });
  const targetJson = canonicalResearchTaskJson({ decision: requested.decision });
  let requestKey;
  try {
    requestKey = await humanDecisionRequestKey({
      requestId: requested.request_id,
      kind: "owner",
      actor: session.login,
      subjectId: candidate.candidate_id,
      materialKey: candidateEvidenceSha256,
      action: requested.decision,
      target: { decision: requested.decision },
    });
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid owner decision request" }, error.status || 400);
  }
  let recorded;
  try {
    recorded = await runtimeInstanceCommand(env, {
      action: "owner_decide",
      actor: session.login,
      subject_id: candidate.candidate_id,
      material_key: candidateEvidenceSha256,
      action_name: requested.decision,
      request_key: requestKey,
      target_json: targetJson,
      decided_at: decidedAt,
      now_ms: Date.now(),
      payload: intent,
    });
  } catch (error) {
    return json({ ok: false, error: error.message || "owner decision unavailable" }, error.status || 503);
  }
  const decisionReceipt = await humanDecisionReceipt(recorded.record, {
    kind: "owner",
    subject_id: candidate.candidate_id,
    material_sha256: candidateEvidenceSha256,
  });
  const recordedIntent = recorded.record.payload;
  // The durable object decision stands even if the KV snapshot mirror fails.
  await mirrorConfigJson(env, ownerDecisionArchiveKey(candidate.candidate_id, recordedIntent.decision_sha256), recordedIntent);
  await mirrorConfigJson(env, ownerDecisionCurrentKey(candidate.candidate_id), recordedIntent);
  let auditLogged = false;
  try {
    await appendAuditLog(env, {
      ts: recordedIntent.decided_at,
      login: session.login,
      action: "record_owner_decision_intent",
      candidate_id: recordedIntent.candidate_id,
      decision: recordedIntent.decision,
      candidate_evidence_sha256: recordedIntent.candidate_evidence_sha256,
      decision_sha256: recordedIntent.decision_sha256,
      no_order: true,
      execution_authority_granted: false,
    });
    auditLogged = true;
  } catch {
    // The decision remains durable, auditable by its digest, and explicitly
    // non-executable even if the rolling convenience log cannot be updated.
  }
  return json({
    ok: true,
    intent: recordedIntent,
    decision_receipt: decisionReceipt,
    audit_logged: auditLogged,
    replayed: recorded.replayed === true,
  });
}
