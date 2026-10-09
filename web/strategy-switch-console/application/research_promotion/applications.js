/**
 * Research-promotion paper-application HTTP use cases
 * (GET/POST /api/research-promotion-applications and
 *  GET/POST /api/internal/research-promotion-application/:id).
 *
 * B10-d: application layer with the same DI pattern as B10-a/b/c.
 * Login / admin / same-origin / dedicated sync-token permission rejects,
 * promotion material qualification (fingerprint), claim-token binding, and
 * readback mismatch → uncertain stay identical. Durable Object
 * paper-application durable rows and application_* actions stay in
 * worker/DO; this module never opens a txn and never imports worker.js.
 */

/**
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @param {{
 *   json: Function,
 *   readSession: Function,
 *   requireSameOrigin: Function,
 *   readBoundedJson: Function,
 *   runtimeInstanceCommand: Function,
 *   assertExactFields: Function,
 *   randomToken: Function,
 *   qualifyV7PaperApplication: Function,
 *   dispatchV7PaperApplication: Function,
 *   publicResearchPromotionApplication: Function,
 *   isUnsupportedApplicationActionError: Function,
 *   V7_PAPER_APPLICATION_MAX_BODY_BYTES: number,
 *   V7_PAPER_APPLICATION_SOURCE_COMMIT: string,
 *   V7_PAPER_APPLICATION_UES_REVISION: string,
 * }} deps
 */
export async function researchPromotionApplicationResponse(request, env, url, deps) {
  const {
    json,
    readSession,
    requireSameOrigin,
    readBoundedJson,
    runtimeInstanceCommand,
    assertExactFields,
    randomToken,
    qualifyV7PaperApplication,
    dispatchV7PaperApplication,
    publicResearchPromotionApplication,
    isUnsupportedApplicationActionError,
    V7_PAPER_APPLICATION_MAX_BODY_BYTES,
    V7_PAPER_APPLICATION_SOURCE_COMMIT,
    V7_PAPER_APPLICATION_UES_REVISION,
  } = deps;
  const session = await readSession(request, env);
  if (!session?.allowed) return json({ ok: false, error: "login required" }, 401);
  if (request.method === "GET") {
    const keys = [...url.searchParams.keys()].sort();
    if (keys.join(",") !== "ticket_id") return json({ ok: false, error: "ticket_id is required" }, 400);
    try {
      const result = await runtimeInstanceCommand(env, {
        action: "application_latest",
        actor: session.login,
        ticket_id: String(url.searchParams.get("ticket_id") || ""),
      });
      return json({ ok: true, application: publicResearchPromotionApplication(result.application) });
    } catch (error) {
      if (isUnsupportedApplicationActionError(error)) return json({ ok: true, application: null });
      return json({ ok: false, error: error.message || "paper application unavailable" }, error.status || 503);
    }
  }
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!session.admin) return json({ ok: false, error: "admin required" }, 403);
  try {
    requireSameOrigin(request, { requireOrigin: true });
  } catch (error) {
    return json({ ok: false, error: error.message }, error.status || 403);
  }
  let raw;
  try {
    raw = await readBoundedJson(request, V7_PAPER_APPLICATION_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message }, error.status || 400);
  }
  try {
    assertExactFields(raw, ["expected_revision", "selected_account", "ticket_id"], "paper application request");
    const qualified = await qualifyV7PaperApplication(env, {
      ticketId: raw.ticket_id,
      selectedAccount: raw.selected_account,
      expectedRevision: raw.expected_revision,
    });
    const applicationId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const created = await runtimeInstanceCommand(env, {
      action: "application_create",
      actor: session.login,
      application_id: applicationId,
      ticket_id: qualified.ticket.ticket_id,
      promotion_material_key: qualified.promotionMaterialKey,
      claim_token: randomToken(),
      platform_id: qualified.account.platform_id,
      account_key: qualified.account.account_key,
      account_scope: qualified.account.account_scope,
      account_selector: qualified.account.account_selector,
      service_name: qualified.account.service_name,
      broker_environment: qualified.account.broker_environment,
      expected_revision: qualified.revision,
      expected_strategy_profile: qualified.account.expected_strategy_profile,
      strategy_profile: qualified.ticket.strategy_profile,
      candidate_id: qualified.candidate.candidate_id,
      config_sha256: qualified.candidate.config_sha256,
      source_commit: V7_PAPER_APPLICATION_SOURCE_COMMIT,
      approved_ues_revision: V7_PAPER_APPLICATION_UES_REVISION,
      created_at: createdAt,
    });
    if (!created.created) {
      return json({
        ok: true,
        deduplicated: true,
        application: publicResearchPromotionApplication(created.application),
      });
    }
    try {
      await dispatchV7PaperApplication(env, applicationId);
      await runtimeInstanceCommand(env, {
        action: "application_mark_dispatch",
        actor: session.login,
        application_id: applicationId,
        dispatch_state: "sent",
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      await runtimeInstanceCommand(env, {
        action: "application_mark_dispatch",
        actor: session.login,
        application_id: applicationId,
        dispatch_state: "unknown",
        updated_at: new Date().toISOString(),
      });
      const latest = await runtimeInstanceCommand(env, {
        action: "application_read",
        actor: session.login,
        application_id: applicationId,
      });
      return json({
        ok: false,
        error: error.message || "paper application dispatch unverified",
        application: publicResearchPromotionApplication(latest.application),
      }, error.status || 502);
    }
    const latest = await runtimeInstanceCommand(env, {
      action: "application_read",
      actor: session.login,
      application_id: applicationId,
    });
    return json({
      ok: true,
      status: "approved",
      application: publicResearchPromotionApplication(latest.application),
    }, 202);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid paper application" }, error.status || 409);
  }
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @param {{
 *   json: Function,
 *   requireDedicatedExecutionEvidenceSyncToken: Function,
 *   hasRuntimeInstanceStore: Function,
 *   applicationIdFromPath: Function,
 *   readBoundedJson: Function,
 *   runtimeInstanceCommand: Function,
 *   assertExactFields: Function,
 *   qualifyV7PaperApplication: Function,
 *   validateV7PaperApplicationReadback: Function,
 *   V7_PAPER_APPLICATION_MAX_BODY_BYTES: number,
 *   V7_PAPER_APPLICATION_WORKFLOW_REPOSITORY: string,
 *   V7_PAPER_APPLICATION_WORKFLOW: string,
 * }} deps
 */
export async function researchPromotionApplicationInternalResponse(request, env, url, deps) {
  const {
    json,
    requireDedicatedExecutionEvidenceSyncToken,
    hasRuntimeInstanceStore,
    applicationIdFromPath,
    readBoundedJson,
    runtimeInstanceCommand,
    assertExactFields,
    qualifyV7PaperApplication,
    validateV7PaperApplicationReadback,
    V7_PAPER_APPLICATION_MAX_BODY_BYTES,
    V7_PAPER_APPLICATION_WORKFLOW_REPOSITORY,
    V7_PAPER_APPLICATION_WORKFLOW,
  } = deps;
  try {
    requireDedicatedExecutionEvidenceSyncToken(request, env);
  } catch (error) {
    return json({ ok: false, error: error.message }, error.status || 401);
  }
  if (!hasRuntimeInstanceStore(env) || url.search) {
    return json({ ok: false, error: "invalid paper application request" }, 400);
  }
  let applicationId;
  try {
    applicationId = applicationIdFromPath(url.pathname);
  } catch (error) {
    return json({ ok: false, error: error.message }, error.status || 400);
  }
  if (request.method === "GET") {
    try {
      const result = await runtimeInstanceCommand(env, {
        action: "application_read",
        actor: "longbridge-paper-application",
        application_id: applicationId,
      });
      const application = result.application;
      const {
        claim_token: claimToken,
        workflow_run_id: workflowRunId,
        workflow_run_attempt: workflowRunAttempt,
        ...record
      } = application;
      return json({
        ok: true,
        application: {
          ...record,
          claim: {
            token: claimToken,
            workflow_run_id: workflowRunId,
            workflow_run_attempt: workflowRunAttempt,
          },
          workflow: {
            repository: V7_PAPER_APPLICATION_WORKFLOW_REPOSITORY,
            workflow: V7_PAPER_APPLICATION_WORKFLOW,
            ref: "main",
          },
        },
      });
    } catch (error) {
      return json({ ok: false, error: error.message }, error.status || 404);
    }
  }
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  let raw;
  try {
    raw = await readBoundedJson(request, V7_PAPER_APPLICATION_MAX_BODY_BYTES);
  } catch (error) {
    return json({ ok: false, error: error.message }, error.status || 400);
  }
  try {
    if (raw?.status === "claimed") {
      assertExactFields(raw, ["application_id", "claim", "status"], "paper application claim");
      assertExactFields(raw.claim, ["token", "workflow_run_attempt", "workflow_run_id"], "paper application claim.claim");
      if (
        raw.application_id !== applicationId
        || !/^[1-9][0-9]{0,20}$/.test(String(raw.claim.workflow_run_id))
        || !/^[1-9][0-9]{0,5}$/.test(String(raw.claim.workflow_run_attempt))
        || !/^[A-Za-z0-9_-]{24,128}$/.test(String(raw.claim.token))
      ) {
        throw Object.assign(new Error("invalid paper application claim"), { status: 400 });
      }
      const current = await runtimeInstanceCommand(env, {
        action: "application_read",
        actor: "longbridge-paper-application",
        application_id: applicationId,
      });
      const stored = current.application;
      if (stored.claim_token !== String(raw.claim.token)) {
        throw Object.assign(new Error("invalid paper application claim token"), { status: 409 });
      }
      try {
        await qualifyV7PaperApplication(env, {
          ticketId: stored.ticket_id,
          selectedAccount: { platform: stored.platform_id, key: stored.account_key },
          expectedRevision: stored.expected_revision,
        });
      } catch (error) {
        throw Object.assign(
          new Error(error.message === "runtime instance revision conflict" ? "account_changed" : "qualification_changed"),
          { status: 409 },
        );
      }
      const result = await runtimeInstanceCommand(env, {
        action: "application_claim",
        actor: "longbridge-paper-application",
        application_id: applicationId,
        claim_token: String(raw.claim.token),
        workflow_run_id: String(raw.claim.workflow_run_id),
        workflow_run_attempt: String(raw.claim.workflow_run_attempt),
        updated_at: new Date().toISOString(),
      });
      return json({ ok: true, claimed: Boolean(result.claimed), reason: result.reason || "" });
    }
    assertExactFields(raw, ["application_id", "claim", "readback", "status"], "paper application result");
    assertExactFields(raw.claim, ["token", "workflow_run_attempt", "workflow_run_id"], "paper application result.claim");
    if (
      raw.application_id !== applicationId
      || !["applied_paused", "rejected", "uncertain"].includes(raw.status)
      || !/^[1-9][0-9]{0,20}$/.test(String(raw.claim.workflow_run_id))
      || !/^[1-9][0-9]{0,5}$/.test(String(raw.claim.workflow_run_attempt))
      || !/^[A-Za-z0-9_-]{24,128}$/.test(String(raw.claim.token))
    ) {
      throw Object.assign(new Error("invalid paper application result"), { status: 400 });
    }
    const current = await runtimeInstanceCommand(env, {
      action: "application_read",
      actor: "longbridge-paper-application",
      application_id: applicationId,
    });
    const application = current.application;
    const readbackMatches = raw.status === "applied_paused"
      && validateV7PaperApplicationReadback(application, raw.readback);
    const persistedStatus = raw.status === "applied_paused" && !readbackMatches
      ? "uncertain"
      : raw.status;
    const reasonCode = persistedStatus === "uncertain" && raw.status === "applied_paused"
      ? "readback_mismatch"
      : raw.status === "rejected"
        ? "workflow_rejected"
        : raw.status === "uncertain"
          ? "workflow_uncertain"
          : "";
    const result = await runtimeInstanceCommand(env, {
      action: "application_result",
      actor: "longbridge-paper-application",
      application_id: applicationId,
      claim_token: String(raw.claim.token),
      workflow_run_id: String(raw.claim.workflow_run_id),
      workflow_run_attempt: String(raw.claim.workflow_run_attempt),
      status: persistedStatus,
      reason_code: reasonCode,
      readback: raw.readback,
      updated_at: new Date().toISOString(),
    });
    return json({ ok: true, replayed: !result.changed, status: result.application.status });
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid paper application result" }, error.status || 409);
  }
}
