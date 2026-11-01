import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

const root = fileURLToPath(new URL("../web/strategy-switch-console/frontend/", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "cockpit-decision-"));
try {
  const outfile = join(directory, "cockpit.cjs");
  await build({
    stdin: {
      resolveDir: root,
      contents: `
        import { createElement as h } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { I18nProvider } from './src/i18n';
        import { actionBlockers, expiryState, MutationOutcomeUnknown, loadAuditEvents, loadDecisionDetail, loadOperation, normalizeEvidenceSummary, submitDecisionAction, isDecisionRevision } from './src/api/cockpit';
        import { allowedActionIds, decisionActionAllowed, promotionDecisionBody } from './src/pages/decisions/helpers';
        import { ApplicationStatus, DecisionCard, DigestStatus, EffectivePolicyPanel, FreshnessBadge, LifecycleStepper, PauseControl, RiskTierSelector } from './src/components/cockpit';
        export { actionBlockers, expiryState, MutationOutcomeUnknown, loadAuditEvents, loadDecisionDetail, loadOperation, normalizeEvidenceSummary, submitDecisionAction, isDecisionRevision };
        export { allowedActionIds, decisionActionAllowed, promotionDecisionBody };
        const wrap = (language, node) => renderToStaticMarkup(h(I18nProvider, { language }, node));
        export const tiers = (language) => wrap(language, h(RiskTierSelector, {
          scope: 'demo_account', value: 'BALANCED_COMPOUNDING', savedValue: 'BALANCED_COMPOUNDING',
          selectionRevision: 12, mappingAvailable: true, disabled: false, saving: false, dirty: false,
          onChange: () => {}, onSave: () => {},
        }));
        const binding = {
          scope: 'demo_account', selected_tier: 'GROWTH_COMPOUNDING', selection_revision: 12,
          approved_tier: null, approved_policy_id: null, approved_policy_revision: null,
          effective_tier: 'BALANCED_COMPOUNDING', effective_policy_id: 'demo-balanced-v3',
          effective_policy_revision: 'r7', effective_observed_at: '2026-11-01T09:10:00Z',
          temporary_restriction: { active: true, reason: 'Reduction only', until: null },
          values: [{ key: 'max_gross_exposure', label_key: null, value: 45, unit: 'percent', status: 'known', source: 'server' }],
        };
        export const policy = (language) => wrap(language, h(EffectivePolicyPanel, { binding }));
        const base = {
          operation_id: 'op-1', request_id: 'req-1', decision_id: 'decision-1', decision_revision: 3,
          action: 'approve', title_key: null, account_alias: null, platform: null, release_id: null,
          target_id: null, state: 'applied', recorded_at: null, dispatched_at: null,
          applied_at: '2026-11-01T10:00:05Z', applied_by: 'platform', runtime_confirmed_at: null,
          runtime_state: 'unknown', failure_reason: null, unknown_reason: null,
          readback_available: null, server_time: null,
        };
        export const applied = (language) => wrap(language, h(ApplicationStatus, {
          operation: { ...base, readback_available: true }, status: 'ready',
        }));
        export const appliedCapabilityUnknown = (language) => wrap(language, h(ApplicationStatus, { operation: base, status: 'ready' }));
        export const appliedNoReadback = (language) => wrap(language, h(ApplicationStatus, {
          operation: { ...base, readback_available: false }, status: 'ready',
        }));
        const card = (state, blockers) => (language) => wrap(language, h(DecisionCard, {
          decision: {
            decision_id: 'decision-1', short_id: 'd-1', category: 'reconciliation_recovery', revision: 'rev1-0000ffff',
            state, title_key: 'category.reconciliation_recovery', account_alias: 'demo_account', platform: null,
            release_id: null, target_id: null, expires_at: null, server_time: null, allowed_actions: [],
            evidence: { evidence_id: null, label_key: null, observed_at: null, valid_until: null,
              state: 'stale', qualification: 'unknown', limitations: [] },
            policy: null, receipt: null,
          },
          operation: null, receivedAt: '2026-11-01T10:00:00Z', blockedReasons: blockers, onSelect: () => {},
        }));
        export const unknownCard = card('unknown', ['state_unknown', 'evidence_stale']);
        export const pendingCard = card('pending', ['decision_expired']);
        export const freshness = (language) => wrap(language, h(FreshnessBadge, { state: 'expired' }));
        const lifecycle = {
          profile: 'demo_trend', account_alias: 'demo_account', platform: 'ibkr', target_id: 'demo-target',
          release_id: 'demo-release', present: true, research_stage: 'paper', authorized_stage: 'small_live',
          effective_stage: 'paper', operating_state: 'running', application_state: 'applied',
          observed_at: '2026-11-01T09:30:00Z', evidence: null, regime_effect: 'risk_reduction_only',
        };
        export const stepper = (language) => wrap(language, h(LifecycleStepper, { binding: lifecycle }));
        export const stepperUnconfirmed = (language) => wrap(language, h(LifecycleStepper, {
          binding: { ...lifecycle, authorized_stage: 'unknown', effective_stage: 'unknown' },
        }));
        export const pause = (language) => wrap(language, h(PauseControl, {
          operatingState: 'running', canPause: true, canResume: true, pending: false, reason: null,
        }));
        export const pauseBlocked = (language) => wrap(language, h(PauseControl, {
          operatingState: 'running', canPause: false, canResume: true, pending: false, reason: 'Platform does not allow pausing here',
        }));
        export const confirmed = (language) => wrap(language, h(ApplicationStatus, {
          operation: { ...base, runtime_confirmed_at: '2026-11-01T10:05:00Z', runtime_state: 'running' }, status: 'ready',
        }));
        export const operationMissing = (language) => wrap(language, h(ApplicationStatus, { operation: null, status: 'not_ready' }));
        export const digestAccepted = (language) => wrap(language, h(DigestStatus, {
          digest: {
            business_day: '2026-11-01', timezone: 'America/New_York', expected_targets: 4,
            covered_targets: 3, unavailable_targets: 1, delivery_state: 'accepted',
            accepted_at: '2026-11-01T13:05:00Z', acknowledged_at: null,
            source_as_of: '2026-11-01T13:00:00Z', legacy_receipts: false, targets: [],
          },
        }));
      `,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "import.meta.env": "{}" },
    logLevel: "silent",
  });
  const ui = createRequire(import.meta.url)(outfile);

  // Expiry is derived from the server clock plus elapsed time only.
  const received = "2026-11-01T10:00:00Z";
  const receivedMs = Date.parse(received);
  assert.equal(ui.expiryState("2026-11-01T10:30:00Z", "2026-11-01T10:00:00Z", received, receivedMs).state, "open");
  assert.equal(ui.expiryState("2026-11-01T10:30:00Z", "2026-11-01T10:00:00Z", received, receivedMs + 31 * 60_000).state,
    "expired", "a forward browser clock cannot extend server validity");
  assert.equal(ui.expiryState("2026-11-01T10:30:00Z", "2026-11-01T10:00:00Z", received, receivedMs - 60 * 60_000).state,
    "open", "a backward browser clock cannot expire a decision early");
  assert.equal(ui.expiryState("2026-11-01T10:30:00Z", null, received, receivedMs).state, "unknown",
    "without a server clock the boundary stays unconfirmed");
  assert.equal(ui.expiryState(null, null, received, receivedMs).state, "none");

  const decision = {
    state: "pending", allowed_actions: ["approve"], expires_at: null, revision: "rev2-0000abcd",
    policy: { selected_tier: "BALANCED_COMPOUNDING", policy_revision: "r7" },
    evidence: { state: "current", qualification: "qualified", limitations: [] },
  };
  const view = { serverTime: "2026-11-01T10:00:00Z", receivedAt: received, now: receivedMs };
  assert.deepEqual(ui.actionBlockers(decision, view), []);
  assert.ok(ui.actionBlockers({ ...decision, revision: 2 }, view).includes("revision_invalid"),
    "a numeric revision is not the server's revN string");
  assert.ok(ui.actionBlockers({ ...decision, allowed_actions: ["accept"] }, view).length === 0,
    "accept is an approval action in the server vocabulary");
  assert.ok(ui.actionBlockers({ ...decision, evidence: { ...decision.evidence, state: "stale" } }, view).includes("evidence_stale"),
    "stale supporting data blocks approval");
  assert.ok(ui.actionBlockers({ ...decision, evidence: { ...decision.evidence, qualification: "unknown" } }, view).includes("evidence_unqualified"));
  assert.ok(ui.actionBlockers({ ...decision, allowed_actions: [] }, view).includes("approval_not_allowed"),
    "the server allow-list stays authoritative");
  assert.ok(ui.actionBlockers({ ...decision, policy: null }, view).includes("policy_unavailable"));
  assert.ok(ui.actionBlockers({ ...decision, policy: { selected_tier: null, policy_revision: null } }, view).includes("policy_binding_missing"));

  const unknown = new ui.MutationOutcomeUnknown("req-1", "op-1");
  assert.equal(unknown.requestId, "req-1");
  assert.equal(unknown.operationId, "op-1");
  assert.equal(unknown.message, "mutation_outcome_unknown");

  // The decision endpoints return versioned envelopes; the adapters read them.
  const reviewEnvelope = {
    schema_version: "qsl.decision_review.v1",
    server_time: "2026-11-01T10:00:00Z",
    data_status: "ready",
    decision_id: "strategy_promotion:t-1",
    decision: {
      id: "strategy_promotion:t-1",
      short_id: "IN-DEMO",
      category: "strategy_promotion",
      title_key: "decisions.strategy_promotion",
      account_alias: "demo_account",
      platform: "ibkr",
      status: "pending",
      created_at: "2026-11-01T09:00:00Z",
      expires_at: "2026-11-02T09:00:00Z",
      revision: "rev1-0123456789abcdef",
      transition: { axis: "authorized_stage", from: "research", to: "small_live_intent" },
      actionable: true,
      blocking_reason_codes: [],
      allowed_actions: [
        { action: "accept", label_key: "decisions.action.accept", requires_selection: true },
        { action: "reject", label_key: "decisions.action.reject", requires_selection: false },
      ],
      decision_state: { status: "pending", action: null, decided_at: null },
      risk_impact: {
        affects_live: false,
        tier: "BALANCED_COMPOUNDING",
        policy: { tier: "BALANCED_COMPOUNDING", policy_id: "balanced_compounding_v1", composer_mdd_multiple: 1.25, promotion_size_scale: 0.75 },
      },
      evidence_summary: { source_id: "promotion-source", observed_at: "2026-10-31T13:00:00Z", freshness: "current", shadow: { passed: true } },
      operation_reference: null,
    },
    current_eligibility: { eligible: true, material_matches: true, expired: false, blocked: false, reason_codes: [] },
    decision_authority: null,
    decision_receipt: null,
    operation: { id: "operation:strategy_promotion:t-1", status: "unapplied", activation_status: "not_connected", reason_code: "application_not_connected", updated_at: null },
    policy: { no_order: true, execution_authority_granted: false },
    tier_policies: [],
    errors: [],
  };
  const actionResult = {
    schema_version: "qsl.decision_action_result.v1",
    ok: true,
    replayed: false,
    decision_id: "strategy_promotion:t-1",
    revision: "rev1-0123456789abcdef",
    action: "accept",
    operation_id: "req-accept-1",
    decision_receipt: { decided_at: "2026-11-01T10:01:00Z", action: "accept" },
    decision_state: { status: "decided", action: "accept", decided_at: "2026-11-01T10:01:00Z" },
    operation: { id: "operation:strategy_promotion:t-1", status: "accepted", activation_status: "not_connected", reason_code: "application_not_created", updated_at: "2026-11-01T10:01:00Z" },
    policy: { no_order: true },
    server_time: "2026-11-01T10:01:00Z",
  };
  const operationEnvelope = {
    schema_version: "qsl.operation.v1",
    server_time: "2026-11-01T10:02:00Z",
    data_status: "ready",
    operation: {
      id: "operation:strategy_promotion:t-1",
      decision_id: "strategy_promotion:t-1",
      kind: "promotion",
      subject_id: "t-1",
      status: "applying",
      reason_code: null,
      activation_status: "not_connected",
      updated_at: "2026-11-01T10:02:00Z",
      dispatch: { status: "queued", workflow_run_id: "wf-1", updated_at: "2026-11-01T10:01:30Z" },
      application: { status: "claimed", updated_at: "2026-11-01T10:02:00Z" },
    },
    decision: { material_sha256: "a".repeat(64), action: "accept", decided_at: "2026-11-01T10:01:00Z" },
    policy: { no_order: true },
    errors: [],
  };
  const auditEnvelope = {
    schema_version: "qsl.audit_events.v1",
    server_time: "2026-11-01T10:03:00Z",
    data_status: "ready",
    events: [
      {
        id: "ev-1", source: "decision_actions", occurred_at: "2026-11-01T10:01:00Z",
        action: "decision_action", actor_alias: "owner", subject: { kind: "decision", id: "strategy_promotion:t-1" },
        revision: "f".repeat(64), outcome: "recorded", ref: "/api/decisions/strategy_promotion%3At-1",
      },
      {
        id: "ev-2", source: "operations", occurred_at: "2026-11-01T10:02:00Z",
        action: "operation_update", actor_alias: null, subject: { kind: "operation", id: "operation:owner_decision:c-1" },
        revision: null, outcome: "applying", ref: "/api/operations/operation%3Aowner_decision%3Ac-1",
      },
    ],
    next_cursor: "25",
    coverage: "partial",
    policy: { no_order: true },
    errors: [],
  };
  let lastPostBody = null;
  let postCount = 0;
  const jsonResponse = (payload, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => payload });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    if (String(path).endsWith("/actions")) { postCount += 1; lastPostBody = JSON.parse(init.body); return jsonResponse(actionResult); }
    if (String(path).startsWith("/api/audit-events")) return jsonResponse(auditEnvelope);
    if (String(path).startsWith("/api/operations/")) return jsonResponse(operationEnvelope);
    if (String(path).startsWith("/api/decisions/")) return jsonResponse(reviewEnvelope);
    return jsonResponse({ ok: false, error: "not_found" }, 404);
  };
  try {
    assert.equal(ui.isDecisionRevision("rev1-0123456789abcdef"), true);
    assert.equal(ui.isDecisionRevision(2), false, "revision is never a number");

    const detail = await ui.loadDecisionDetail("strategy_promotion:t-1");
    assert.equal(detail.status, "ready");
    assert.equal(detail.data.revision, "rev1-0123456789abcdef", "the revN string survives normalization");
    assert.equal(detail.data.state, "pending", "state comes from decision_state.status");
    assert.deepEqual(detail.data.allowed_actions, ["accept", "reject"], "allowed_actions arrive as objects");
    assert.equal(detail.data.selection_required, true);
    assert.equal(detail.data.operation_id, "operation:strategy_promotion:t-1");
    assert.equal(detail.data.server_time, "2026-11-01T10:00:00Z", "the clock comes from the envelope");
    assert.equal(detail.data.evidence.state, "current");
    assert.equal(detail.data.evidence.qualification, "qualified", "shadow.passed is the server qualification");
    assert.equal(detail.data.policy.selected_tier, "BALANCED_COMPOUNDING");
    assert.equal(detail.data.from_stage, "research", "a real stage in the transition is kept");
    assert.equal(ui.actionBlockers(detail.data, { serverTime: detail.data.server_time, receivedAt: received, now: receivedMs })
      .includes("revision_invalid"), false);

    const post = await ui.submitDecisionAction({
      decision_id: "strategy_promotion:t-1",
      category: "strategy_promotion",
      action: "accept",
      expected_revision: "rev1-0123456789abcdef",
      expected_expires_at: "2026-11-02T09:00:00Z",
      request_id: "req-accept-1",
      selection: {
        confirmation: { target_platform: "ibkr", execution_mode: "live", risk_profile: "BALANCED_COMPOUNDING" },
        selected_account: { platform: "ibkr", key: "demo_account" },
      },
    });
    assert.deepEqual(Object.keys(lastPostBody).sort(),
      ["action", "expected_expires_at", "expected_revision", "request_id", "selection"],
      "the POST body carries only the server's whitelisted keys");
    assert.equal(post.state, "approved", "success is read from decision_state.status");
    assert.equal(post.revision, "rev1-0123456789abcdef");
    assert.equal(post.receipt.recorded_at, "2026-11-01T10:01:00Z");
    assert.equal(post.operation.state, "pending", "an accepted-but-not-applied operation is not shown as applied");

    // Requests the server must reject never reach the network.
    const postsBefore = postCount;
    await assert.rejects(() => ui.submitDecisionAction({
      decision_id: "strategy_promotion:t-1", category: "strategy_promotion", action: "accept",
      expected_revision: "rev1-0123456789abcdef", request_id: "req-accept-2",
    }), /decision_selection_required/);
    assert.equal(postCount, postsBefore, "accept without a selection is not sent");
    await assert.rejects(() => ui.submitDecisionAction({
      decision_id: "strategy_promotion:t-1", category: "owner_decision", action: "approve",
      expected_revision: "2", request_id: "req-x",
    }), /decision_revision_required/);
    await assert.rejects(() => ui.submitDecisionAction({
      decision_id: "strategy_promotion:t-1", category: "owner_decision", action: "approve",
      expected_revision: "rev1-0123456789abcdef", request_id: "bad request id!",
    }), /decision_request_id_invalid/);
    await assert.rejects(() => ui.submitDecisionAction({
      decision_id: "strategy_promotion:t-1", category: "owner_decision", action: "approve",
      expected_revision: "rev1-0123456789abcdef", request_id: "req-1", operation_id: "op-other",
    }), /decision_operation_id_invalid/);

    const operation = await ui.loadOperation("operation:strategy_promotion:t-1");
    assert.equal(operation.status, "ready");
    assert.equal(operation.data.state, "applying");
    assert.equal(operation.data.operation_id, "operation:strategy_promotion:t-1");
    assert.equal(operation.data.action, "accept", "the recorded action comes from the envelope decision");
    assert.equal(operation.data.recorded_at, "2026-11-01T10:01:00Z");
    assert.equal(operation.data.dispatched_at, "2026-11-01T10:01:30Z");
    assert.equal(operation.data.decision_revision, null, "the operations payload carries no numeric revision");
    assert.equal(operation.data.readback_available, false, "activation is not connected");
    assert.equal(operation.data.server_time, "2026-11-01T10:02:00Z");

    // An unapplied operation is unknown, not presented as progress.
    const flat = { ...operationEnvelope, operation: { ...operationEnvelope.operation, status: "unapplied", reason_code: "application_not_connected", dispatch: null, application: null } };
    globalThis.fetch = async () => jsonResponse(flat);
    const unapplied = await ui.loadOperation("operation:strategy_promotion:t-1");
    assert.equal(unapplied.data.state, "unknown");
    assert.equal(unapplied.data.unknown_reason, "application_not_connected");
    assert.equal(unapplied.data.dispatched_at, null);

    // A transport failure is an unknown outcome that keeps the operation identity.
    globalThis.fetch = async () => { throw new TypeError("network down"); };
    await assert.rejects(() => ui.submitDecisionAction({
      decision_id: "strategy_promotion:t-1", category: "owner_decision", action: "approve",
      expected_revision: "rev1-0123456789abcdef", request_id: "req-net-1",
    }), err => err instanceof ui.MutationOutcomeUnknown && err.operationId === "req-net-1");

    // Flat legacy payloads are not mistaken for the versioned contract.
    globalThis.fetch = async () => jsonResponse({ state: "pending", revision: 4 });
    assert.equal((await ui.loadDecisionDetail("strategy_promotion:t-1")).status, "not_ready", "no review envelope, no decision");
    assert.equal((await ui.loadOperation("operation:strategy_promotion:t-1")).status, "not_ready", "no operation envelope, no operation");

    // Audit events map field-by-field from the qsl.audit_events.v1 envelope.
    let auditPath = "";
    globalThis.fetch = async (path) => {
      auditPath = String(path);
      return auditPath.startsWith("/api/audit-events") ? jsonResponse(auditEnvelope) : jsonResponse({}, 404);
    };
    const audit = await ui.loadAuditEvents("25");
    assert.match(auditPath, /cursor=25/, "the server cursor is passed through unchanged");
    assert.equal(audit.status, "ready");
    assert.equal(audit.data.length, 2);
    assert.equal(audit.data[0].event_id, "ev-1");
    assert.equal(audit.data[0].actor, "owner", "actor_alias is the audited actor");
    assert.equal(audit.data[0].subject, "decision:strategy_promotion:t-1");
    assert.equal(audit.data[0].revision, "f".repeat(64), "the revision is the opaque digest, not a counter");
    assert.equal(audit.data[0].decision_id, "strategy_promotion:t-1", "the encoded ref decodes to the decision id");
    assert.equal(audit.data[0].operation_id, null);
    assert.equal(audit.data[1].operation_id, "operation:owner_decision:c-1");
    assert.equal(audit.data[1].decision_id, null);
    assert.equal(audit.data[1].actor, null);
    assert.equal(audit.data[1].revision, null);
    globalThis.fetch = async () => jsonResponse({ ...auditEnvelope, schema_version: "qsl.audit_events.v2" });
    assert.equal((await ui.loadAuditEvents()).status, "not_ready", "an unknown audit schema is not rendered as history");
  } finally {
    globalThis.fetch = realFetch;
  }

  // The server action allow-list gates both paths; a missing field keeps legacy behaviour.
  assert.equal(ui.allowedActionIds(undefined), null);
  assert.equal(ui.allowedActionIds("approve"), null);
  assert.deepEqual(ui.allowedActionIds([{ action: "accept" }, "reject", { action: "accept" }]), ["accept", "reject"]);
  assert.equal(ui.decisionActionAllowed({}, "adopt"), true, "items without the field keep the old gating");
  assert.equal(ui.decisionActionAllowed({ allowed_actions: [] }, "adopt"), false, "an empty list allows nothing");
  assert.equal(ui.decisionActionAllowed({ allowed_actions: [{ action: "approve_limited_live_canary" }] }, "adopt"), true);
  assert.equal(ui.decisionActionAllowed({ allowed_actions: [{ action: "approve_limited_live_canary" }] }, "decline"), false);
  assert.equal(ui.decisionActionAllowed({ allowed_actions: [{ action: "keep_parked" }] }, "decline"), true);
  assert.equal(ui.decisionActionAllowed({ allowed_actions: [{ action: "reject" }] }, "adopt"), false);
  assert.equal(ui.decisionActionAllowed({ allowed_actions: [{ action: "accept" }] }, "adopt"), true);

  // The legacy promotion body sends exactly the keys the server asserts on.
  const promotionBody = ui.promotionDecisionBody({
    ticketId: "t-1", accept: true, account: { platform: "ibkr", key: "demo", mode: "live" },
    riskProfile: "BALANCED_COMPOUNDING", proposedParams: { x: 1 }, strategyProfile: "demo_trend", domain: "trend",
  });
  assert.deepEqual(Object.keys(promotionBody).sort(),
    ["confirmation", "decision", "expected_domain", "expected_proposed_params", "expected_strategy_profile", "selected_account", "ticket_id"]);
  assert.deepEqual(Object.keys(promotionBody.confirmation).sort(), ["execution_mode", "risk_profile", "target_platform"],
    "normalizePromotionConfirmation rejects any other confirmation key with 400");
  assert.equal("policy_revision" in promotionBody.confirmation, false, "a bound tier is display-only, never submitted");
  assert.equal("expected_policy_revision" in promotionBody, false, "the server never reads an expected policy revision");
  const rejectBody = ui.promotionDecisionBody({ ticketId: "t-2", accept: false, account: null, riskProfile: null, proposedParams: null, strategyProfile: "s", domain: "d" });
  assert.equal(rejectBody.decision, "reject");
  assert.equal(rejectBody.confirmation, null);
  assert.equal("selected_account" in rejectBody, false);
  assert.deepEqual(rejectBody.expected_proposed_params, {});

  // Evidence freshness "ready" is the inbox spelling of current; absent shadow never qualifies.
  assert.equal(ui.normalizeEvidenceSummary({ freshness: "ready", shadow: { passed: false } }).state, "current");
  assert.equal(ui.normalizeEvidenceSummary({ freshness: "ready", shadow: { passed: false } }).qualification, "unqualified");
  assert.equal(ui.normalizeEvidenceSummary({ freshness: "unknown" }).state, "unavailable");
  assert.equal(ui.normalizeEvidenceSummary(null), null);

  // Selected preference, approved mapping and observed policy stay separate.
  const policyEn = ui.policy("en");
  assert.match(policyEn, /Growth compounding/, "the selected preference is shown");
  assert.match(policyEn, /Balanced compounding/, "the observed policy is not overwritten by the selection");
  assert.match(policyEn, /Reduction only/, "a temporary restriction is shown separately");
  assert.match(policyEn, /Policy mapping unavailable/, "a missing approved mapping stays unavailable");

  // Applied is not runtime-confirmed, and the caveat follows the server capability flag.
  const applied = ui.applied("en");
  assert.match(applied, /Platform reported applied; runtime confirmation pending/);
  assert.doesNotMatch(applied, /Runtime confirmed/);
  assert.match(ui.confirmed("en"), /Runtime confirmed/);
  assert.match(ui.operationMissing("en"), /operation-status endpoint is not available/);
  assert.match(ui.appliedCapabilityUnknown("en"), /readback capability unknown/, "an omitted capability flag is not a pending observation");

  // A server-reported absence of readback is not sold as an observation in progress.
  const noReadback = ui.appliedNoReadback("en");
  assert.match(noReadback, /independent runtime readback is unavailable/);
  assert.doesNotMatch(noReadback, /runtime confirmation pending/);
  assert.match(ui.appliedNoReadback("zh"), /无法提供独立的运行时回读/);

  // The stepper draws one axis and says which, while the other axes stay listed.
  const stepper = ui.stepper("en");
  assert.match(stepper, /Stepper shows: authorized ceiling/);
  assert.match(stepper, /Authorized ceiling/);
  assert.match(stepper, /Observed stage/);
  assert.match(ui.stepper("zh"), /步进器显示：授权上限/);
  assert.match(ui.stepperUnconfirmed("en"), /Stage unconfirmed/);

  // An unreadable state is shown as unknown, and each blocker names its own cause.
  const unknownCard = ui.unknownCard("en");
  assert.match(unknownCard, /State unknown/);
  assert.match(unknownCard, /decision state could not be read/);
  assert.match(unknownCard, /Supporting data is stale/);
  assert.doesNotMatch(unknownCard, />Pending</, "an unknown state must not fall back to pending");
  assert.match(ui.pendingCard("en"), /Expired|expired/);
  assert.match(ui.freshness("en"), /badge-error/);
  assert.match(ui.freshness("zh"), /已失效/);

  // Pause never reads as liquidation, and a disabled control points at its reason.
  assert.match(ui.pause("en"), /Pausing does not liquidate positions or cancel pending orders/);
  assert.match(ui.pause("zh"), /暂停不会平仓/);
  assert.doesNotMatch(ui.pause("en"), /aria-describedby/, "an enabled control needs no reason link");
  const pauseBlocked = ui.pauseBlocked("en");
  assert.match(pauseBlocked, /Platform does not allow pausing here/);
  assert.match(pauseBlocked, /aria-describedby=/);

  // Accepted delivery is not delivered, and coverage stays visible.
  const digest = ui.digestAccepted("en");
  assert.match(digest, /Accepted for delivery/);
  assert.match(digest, /Targets 4 · covered 3 · unavailable 1/);
  assert.match(digest, /Accepted is not delivered/);
  assert.match(ui.tiers("zh"), /平衡复利/);
  assert.match(ui.tiers("en"), /checked/);
  assert.match(ui.tiers("en"), /No tier selected/, "clearing a tier preference stays possible");

  // The promotion request no longer carries a client-chosen tier.
  const decisions = await readFile(new URL("../web/strategy-switch-console/frontend/src/pages/decisions/DecisionsPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(decisions, /CAPITAL_PRESERVATION/, "the promotion request must not hard-code a tier");
  assert.match(decisions, /promotionRiskBinding/);
  assert.match(decisions, /risk\.policy_revision/);
  assert.match(decisions, /allowed_actions/, "server allow-lists gate the client controls");
  assert.doesNotMatch(decisions, /role="listitem"/, "a queue row keeps its button semantics");
  assert.doesNotMatch(decisions, /expected_policy_revision/, "the server rejects unknown legacy keys");
  assert.doesNotMatch(decisions, /expanded\.server_time/, "server_time lives on the inbox envelope, never per item");
  assert.match(decisions, /inboxServerTime/, "expiry uses the envelope clock");
  assert.match(decisions, /operation_reference/, "the inbox traces the operation reference object");
  assert.match(decisions, /decisionActionAllowed/, "adopt and decline follow the server action ids");

  // A queue entry links to its own decision and the URL carries that target.
  const [router, overviewSource, accounts] = await Promise.all([
    readFile(new URL("../web/strategy-switch-console/frontend/src/app/router.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/strategy-switch-console/frontend/src/pages/overview/OverviewPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/strategy-switch-console/frontend/src/pages/accounts/AccountsPage.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(router, /decision: params\.get\("decision"\)/);
  assert.match(router, /if \(route\.page === "decisions" && route\.decision\) params\.set\("decision", route\.decision\)/,
    "the target is only shared on the page that reads it");
  assert.match(decisions, /selectItem\(item\.id\)/);
  assert.match(decisions, /navigate\(\{ decision: id \}\)/);
  assert.match(overviewSource, /navigate\(\{ page: "decisions", decision: id \}\)/);
  assert.match(overviewSource, /page: "decisions", decision: null/, "an index link drops a stale target");
  assert.match(accounts, /page: "decisions", decision: null/);

  // Pages consume the cockpit surfaces instead of restating them.
  const sources = await Promise.all([
    "src/pages/overview/OverviewPage.tsx",
    "src/pages/strategies/StrategiesPage.tsx",
    "src/pages/accounts/AccountDetail.tsx",
    "src/pages/accounts/RiskPreference.tsx",
    "src/pages/health/HealthPage.tsx",
  ].map(file => readFile(new URL(`../web/strategy-switch-console/frontend/${file}`, import.meta.url), "utf8")));
  const [overview, strategies, accountDetail, riskPreference, health] = sources;
  assert.match(overview, /function DecisionQueue/);
  assert.match(overview, /queue_incomplete/, "a partial queue hides reassuring counts");
  assert.match(overview, /loadAuditEvents/);
  assert.match(strategies, /loadLifecycles/);
  assert.match(strategies, /LifecycleStepper/);
  assert.match(strategies, /binding\.present/, "absent lifecycle records stay absent");
  assert.match(accountDetail, /loadPolicyBinding/);
  assert.match(accountDetail, /EffectivePolicyPanel/);
  assert.match(riskPreference, /RiskTierSelector/);
  assert.doesNotMatch(riskPreference, /<select/, "the tier picker is no longer a bare select");
  assert.match(health, /loadDigestStatus/);
  assert.match(health, /DigestStatus/);
  assert.match(health, /AuditTimeline/);
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.log("console_cockpit_decision_validation: PASS");
