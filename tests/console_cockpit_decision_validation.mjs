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
        import { actionBlockers, expiryState, MutationOutcomeUnknown, loadDecisionDetail, loadOperation, submitDecisionAction, isDecisionRevision } from './src/api/cockpit';
        import { ApplicationStatus, DecisionCard, DigestStatus, EffectivePolicyPanel, FreshnessBadge, LifecycleStepper, PauseControl, RiskTierSelector } from './src/components/cockpit';
        import { CredentialExpiry, isExpiredRow } from './src/pages/decisions/CredentialExpiry';
        export { actionBlockers, expiryState, MutationOutcomeUnknown, loadDecisionDetail, loadOperation, submitDecisionAction, isDecisionRevision };
        export { isExpiredRow };
        const wrap = (language, node) => renderToStaticMarkup(h(I18nProvider, { language }, node));
        export const expiryView = (language, value, variant) => wrap(language, h(CredentialExpiry, { expiry: value, variant }));
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
          values: [
            { key: 'max_gross_exposure', label_key: null, value: 45, unit: 'percent', status: 'known', source: 'server' },
            { key: 'cash_floor', label_key: null, value: 100, unit: 'USD', status: 'known', source: 'mystery' },
            { key: 'mystery_limit', label_key: 'some.label.key', value: 2, unit: null, status: 'known', source: 'server' },
          ],
        };
        export const policy = (language) => wrap(language, h(EffectivePolicyPanel, { binding }));
        export const policyKnownCode = (language) => wrap(language, h(EffectivePolicyPanel, {
          binding: { ...binding, temporary_restriction: { active: true, reason: 'reduction_only', until: null } },
        }));
        export const policyNoReason = (language) => wrap(language, h(EffectivePolicyPanel, {
          binding: { ...binding, temporary_restriction: { active: true, reason: null, until: null } },
        }));
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
        export const pauseKnownCode = (language) => wrap(language, h(PauseControl, {
          operatingState: 'running', canPause: false, canResume: true, pending: false, reason: 'runtime_control_pending',
        }));
        export const failedKnownReason = (language) => wrap(language, h(ApplicationStatus, {
          operation: { ...base, state: 'failed', failure_reason: 'runtime_control_pending' }, status: 'ready',
        }));
        export const failedFreeText = (language) => wrap(language, h(ApplicationStatus, {
          operation: { ...base, state: 'failed', failure_reason: 'platform exploded at 03:00' }, status: 'ready',
        }));
        export const unknownFreeText = (language) => wrap(language, h(ApplicationStatus, {
          operation: { ...base, state: 'unknown', applied_at: null, unknown_reason: 'weird thing happened' }, status: 'ready',
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
  let lastPostBody = null;
  let postCount = 0;
  const jsonResponse = (payload, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => payload });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    if (String(path).endsWith("/actions")) { postCount += 1; lastPostBody = JSON.parse(init.body); return jsonResponse(actionResult); }
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
  } finally {
    globalThis.fetch = realFetch;
  }

  // Selected preference, approved mapping and observed policy stay separate.
  const policyEn = ui.policy("en");
  assert.match(policyEn, /Growth compounding/, "the selected preference is shown");
  assert.match(policyEn, /Balanced compounding/, "the observed policy is not overwritten by the selection");
  assert.match(policyEn, /Risk reduction only/, "the legacy restriction string shows its bilingual product label");
  assert.doesNotMatch(policyEn.replace(/ data-[a-z-]+="[^"]*"/g, ''), /Reduction only/, "the raw restriction string is suppressed");
  assert.match(ui.policyKnownCode("zh"), /仅允许降低风险/);
  assert.match(ui.policyKnownCode("en"), /Risk reduction only/);
  assert.match(ui.policyNoReason("zh"), /已启用临时限制，原因未知/);
  assert.match(ui.policyNoReason("en"), /Temporary restriction active; reason unknown/);
  // P03: limit keys, sources and units are copy-driven; unknowns never render raw.
  const policyVisible = policyEn.replace(/ data-[a-z-]+="[^"]*"/g, '');
  assert.match(policyEn, /Maximum gross exposure/);
  assert.match(policyEn, /45%/, "percent renders as the symbol in both languages");
  assert.match(policyEn, /Cash floor/);
  assert.match(policyEn, /Other limit/);
  assert.match(policyEn, /Source: Server/);
  assert.match(policyEn, /Unknown source/);
  assert.doesNotMatch(policyVisible, /max_gross_exposure|cash_floor|mystery_limit|some\.label\.key|45 percent|percent|USD/,
    "raw limit keys, dotted label keys and unknown units never reach visible text");
  assert.doesNotMatch(policyVisible, /Source: mystery|Source: server|Source: null/);
  const policyZh = ui.policy("zh");
  assert.match(policyZh, /最大总敞口/);
  assert.match(policyZh, /现金下限/);
  assert.match(policyZh, /其他限制/);
  assert.match(policyZh, /来源：服务端/);
  assert.match(policyZh, /来源未知/);
  assert.match(ui.policy("zh"), /临时限制/);
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
  assert.match(pauseBlocked, /This action is not supported right now\./, "free-form pause reasons fall back to the safe copy");
  assert.doesNotMatch(pauseBlocked, /Platform does not allow pausing here/);
  assert.match(pauseBlocked, /aria-describedby=/);
  assert.match(ui.pauseBlocked("zh"), /当前不支持该操作/);
  assert.match(ui.pauseKnownCode("en"), /The previous action is awaiting confirmation/, "known pause reason codes keep their copy");
  assert.match(ui.pauseKnownCode("zh"), /上次操作仍待确认/);
  // P06: application reasons render through copy; free-form failure text is suppressed.
  assert.match(ui.failedKnownReason("en"), /The previous action is awaiting confirmation/);
  const failedTextEn = ui.failedFreeText("en");
  assert.match(failedTextEn, /Operation outcome pending confirmation/);
  assert.doesNotMatch(failedTextEn, /platform exploded/);
  assert.match(ui.failedFreeText("zh"), /操作结果待确认/);
  assert.doesNotMatch(ui.unknownFreeText("en"), /weird thing happened/);

  // Accepted delivery is not delivered, and coverage stays visible.
  const digest = ui.digestAccepted("en");
  assert.match(digest, /Accepted for delivery/);
  assert.match(digest, /Targets 4 · covered 3 · unavailable 1/);
  assert.match(digest, /Accepted is not delivered/);
  assert.match(ui.tiers("zh"), /平衡复利/);
  assert.match(ui.tiers("en"), /checked/);
  assert.match(ui.tiers("en"), /No tier selected/, "clearing a tier preference stays possible");

  // The credential reminder shows the server's projection verbatim. Synthetic
  // timestamps only; the browser never recomputes severity or days from its clock.
  const credential = {
    notice: { expires_at: "2031-01-31T00:00:00.000Z", days_remaining: 30, severity: "notice" },
    warning: { expires_at: "2031-01-15T00:00:00.000Z", days_remaining: 14, severity: "warning" },
    urgent: { expires_at: "2031-01-08T00:00:00.000Z", days_remaining: 7, severity: "urgent" },
    expired: { expires_at: "2030-12-01T00:00:00.000Z", days_remaining: 0, severity: "expired" },
    none: { expires_at: "2032-06-01T00:00:00.000Z", days_remaining: 512, severity: "none" },
  };
  const urgentList = ui.expiryView("zh", credential.urgent, "list");
  assert.match(urgentList, /data-severity="urgent"/);
  assert.match(urgentList, /立即续期/, "severity names itself in text, never color alone");
  assert.match(urgentList, /7 天后到期/);
  const urgentEn = ui.expiryView("en", credential.urgent, "list");
  assert.match(urgentEn, /Renew now/);
  assert.match(urgentEn, /Expires in 7 days/);
  assert.match(ui.expiryView("en", credential.warning, "list"), /Renew soon/);
  assert.match(ui.expiryView("zh", credential.warning, "list"), /尽快续期/);
  assert.match(ui.expiryView("en", credential.warning, "list"), /Expires in 14 days/);
  assert.match(ui.expiryView("en", credential.notice, "list"), /Early reminder/);
  assert.match(ui.expiryView("zh", credential.notice, "list"), /提前提醒/);
  assert.match(ui.expiryView("en", credential.notice, "list"), /Expires in 30 days/);

  // An expired token stays an actionable reminder with manual renewal guidance.
  const expiredDetail = ui.expiryView("en", credential.expired, "detail");
  assert.match(expiredDetail, /data-severity="expired"/);
  assert.match(expiredDetail, /Registered expiry passed/);
  assert.match(expiredDetail, /cannot auto-renew/, "the reminder states the token does not renew on its own");
  assert.match(expiredDetail, /Sign in to IBKR/);
  assert.match(expiredDetail, /Registered expiry:/);
  assert.doesNotMatch(expiredDetail, /Expires in 0 days/, "expired never reads as a countdown");
  const expiredZh = ui.expiryView("zh", credential.expired, "detail");
  assert.match(expiredZh, /已过登记到期时间/);
  assert.match(expiredZh, /无法自动续期/);
  assert.match(expiredZh, /请登录 IBKR/);
  assert.match(ui.expiryView("en", credential.none, "detail"), /Not due yet/);
  assert.match(ui.expiryView("en", credential.none, "detail"), /Expires in 512 days/);

  // A missing or malformed credential_expiry falls back to an honest unknown state.
  const missing = ui.expiryView("en", undefined, "detail");
  assert.match(missing, /data-severity="unknown"/);
  assert.match(missing, /Expiry unknown/);
  assert.match(missing, /Days remaining unknown/);
  const malformed = ui.expiryView("zh", { severity: "critical", days_remaining: "soon", expires_at: "not-a-date" }, "list");
  assert.match(malformed, /data-severity="unknown"/);
  assert.match(malformed, /剩余天数未知/);
  assert.doesNotMatch(malformed, /critical|soon|not-a-date/, "an unparseable field reduces to unknown, never echoes raw input");

  // English counts decline their noun: one day, several days.
  const oneDay = { expires_at: "2031-01-01T00:00:00.000Z", days_remaining: 1, severity: "urgent" };
  assert.match(ui.expiryView("en", oneDay, "list"), /Expires in 1 day/, "a single day reads singular");
  assert.doesNotMatch(ui.expiryView("en", oneDay, "list"), /1 days/, "no plural leftover at one");
  assert.match(ui.expiryView("zh", oneDay, "list"), /1 天后到期/, "Chinese has no plural inflection");

  // Expired-row dimming keys off server fields; the browser clock never decides.
  assert.equal(ui.isExpiredRow({ status: "expired", category: "owner_decision", credential_expiry: null }), true);
  assert.equal(ui.isExpiredRow({ status: "pending", category: "owner_decision", credential_expiry: null }), false);
  assert.equal(ui.isExpiredRow({ status: "pending", category: "credential_maintenance", credential_expiry: credential.expired }), true,
    "the server's expired severity dims the row");
  assert.equal(ui.isExpiredRow({ status: "pending", category: "credential_maintenance", credential_expiry: credential.urgent }), false);
  assert.equal(ui.isExpiredRow({
    status: "pending", category: "credential_maintenance",
    credential_expiry: { expires_at: "2000-01-01T00:00:00.000Z", days_remaining: null, severity: "urgent" },
  }), false, "a past timestamp with a non-expired server severity never dims on the browser clock");
  assert.equal(ui.isExpiredRow({ status: "pending", category: "credential_maintenance", credential_expiry: { severity: "critical" } }), false,
    "a malformed severity reduces to unknown, not expired");

  // The promotion request no longer carries a client-chosen tier.
  const decisions = await readFile(new URL("../web/strategy-switch-console/frontend/src/pages/decisions/DecisionsPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(decisions, /CAPITAL_PRESERVATION/, "the promotion request must not hard-code a tier");
  assert.match(decisions, /promotionRiskBinding/);
  assert.match(decisions, /risk\.policy_revision/);
  assert.match(decisions, /allowed_actions/, "server allow-lists gate the client controls");
  assert.doesNotMatch(decisions, /role="listitem"/, "a queue row keeps its button semantics");
  assert.match(decisions, /item\.category === "credential_maintenance"\)\s*return translate\("decisions\.credential_expiry\.title"\)/,
    "the cockpit names the to-do explicitly instead of the generic inbox title");
  assert.match(decisions, /<CredentialExpiry expiry=\{item\.credential_expiry\} variant="detail" \/>/);
  assert.match(decisions, /<CredentialExpiry expiry=\{item\.credential_expiry\} variant="list" \/>/);
  assert.match(decisions, /const expired = isExpiredRow\(item\);/, "row expiry comes from the server-field predicate");
  assert.doesNotMatch(decisions, /expires\s*<\s*Date\.now\(\)/, "a row is never expired by the browser clock");
  const decisionsCss = await readFile(new URL("../web/strategy-switch-console/frontend/src/pages/decisions/decisions.css", import.meta.url), "utf8");
  assert.match(decisionsCss, /\.inbox-item\.is-expired \{ opacity: 0\.7; \}/, "the server-driven class carries the dimming treatment");

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
