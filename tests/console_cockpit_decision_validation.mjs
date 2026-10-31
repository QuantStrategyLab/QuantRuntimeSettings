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
        import { actionBlockers, expiryState, MutationOutcomeUnknown } from './src/api/cockpit';
        import { ApplicationStatus, DigestStatus, EffectivePolicyPanel, RiskTierSelector } from './src/components/cockpit';
        export { actionBlockers, expiryState, MutationOutcomeUnknown };
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
        export const applied = (language) => wrap(language, h(ApplicationStatus, { operation: base, status: 'ready' }));
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
    state: "pending", allowed_actions: ["approve"], expires_at: null, revision: 2,
    policy: { selected_tier: "BALANCED_COMPOUNDING", policy_revision: "r7" },
    evidence: { state: "current", qualification: "qualified", limitations: [] },
  };
  const view = { serverTime: "2026-11-01T10:00:00Z", receivedAt: received, now: receivedMs };
  assert.deepEqual(ui.actionBlockers(decision, view), []);
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

  // Selected preference, approved mapping and observed policy stay separate.
  const policyEn = ui.policy("en");
  assert.match(policyEn, /Growth compounding/, "the selected preference is shown");
  assert.match(policyEn, /Balanced compounding/, "the observed policy is not overwritten by the selection");
  assert.match(policyEn, /Reduction only/, "a temporary restriction is shown separately");
  assert.match(policyEn, /Policy mapping unavailable/, "a missing approved mapping stays unavailable");

  // Applied is not runtime-confirmed.
  const applied = ui.applied("en");
  assert.match(applied, /Platform reported applied; runtime confirmation pending/);
  assert.doesNotMatch(applied, /Runtime confirmed/);
  assert.match(ui.confirmed("en"), /Runtime confirmed/);
  assert.match(ui.operationMissing("en"), /operation-status endpoint is not available/);

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
