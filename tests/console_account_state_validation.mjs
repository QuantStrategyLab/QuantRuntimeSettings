import assert from "node:assert/strict";
import worker, { __test } from "../web/strategy-switch-console/worker.js";

const now = Date.now();
const freshAt = new Date(now - 30 * 1000).toISOString();
const staleAt = new Date(now - 2 * 60 * 60 * 1000).toISOString();
const store = new Map();
const env = {
  SESSION_SECRET: "fixture-account-state-session",
  ALLOWED_GITHUB_LOGINS: "fixture-reader",
  EXECUTION_EVIDENCE_SYNC_TOKEN: "fixture-account-state-sync",
  EXECUTION_EVIDENCE_STALE_TTL_SECONDS: "300",
  ACCOUNT_DIAGNOSIS_AUTO_ENABLED: "false",
  STRATEGY_SWITCH_CONFIG: {
    async get(key) { return store.get(key) || null; },
    async put(key, value) { store.set(key, value); },
    async list({ prefix = "", limit = 1000 } = {}) {
      return { keys: [...store.keys()].filter(key => key.startsWith(prefix)).slice(0, limit).map(name => ({ name })) };
    },
  },
};
const cookie = `qsl_switch_session=${await __test.makeSession("fixture-reader", [], env)}`;

function deployment(runtimeEnabled, schedulerState, observedAt) {
  return {
    runtime_enabled: runtimeEnabled,
    scheduler_state: schedulerState,
    strategy_profile: "fixture_profile",
    execution_mode: "dry_run",
    observed_at: observedAt,
  };
}

function target(id, configured, monitoring, disposition, deploymentRecord) {
  return {
    target_id: id,
    target: { platform: "longbridge", configured_state: configured, execution_mode: "dry_run" },
    monitoring,
    disposition,
    no_order: true,
    ...(deploymentRecord ? { deployment: deploymentRecord } : {}),
  };
}

function source(sourceId, at, targets) {
  return {
    schema_version: "qsl_runtime_target_lifecycle_source_snapshot.v1",
    source_id: sourceId,
    generated_at: at,
    computed_at: at,
    data_status: "ready",
    targets,
    errors: [],
  };
}

const enabledMonitoring = { runtime_guard: "pass", execution_heartbeat: "pass" };
const enabledDisposition = { code: "continue_enabled_monitoring", reason_code: "none" };
const disabledMonitoring = { runtime_guard: "pass", execution_heartbeat: "not_applicable" };
const disabledDisposition = { code: "continue_disabled_validation", reason_code: "target_intentionally_disabled" };
const attentionMonitoring = { runtime_guard: "attention", execution_heartbeat: "pass" };
const attentionDisposition = { code: "parked", reason_code: "runtime_guard_attention" };

const sources = [
  source("fixture.normal", freshAt, [
    target("fixture.normal", "enabled", enabledMonitoring, enabledDisposition, deployment(true, "enabled", freshAt)),
  ]),
  source("fixture.stale-source", staleAt, [
    target("fixture.stale-source", "enabled", enabledMonitoring, enabledDisposition, deployment(true, "enabled", freshAt)),
  ]),
  source("fixture.saved-off", freshAt, [
    target("fixture.saved-off", "disabled", disabledMonitoring, disabledDisposition, deployment(true, "enabled", freshAt)),
  ]),
  source("fixture.actually-off", freshAt, [
    target("fixture.actually-off", "disabled", disabledMonitoring, disabledDisposition, deployment(false, "paused", freshAt)),
  ]),
  source("fixture.saved-on-actual-off", freshAt, [
    target("fixture.saved-on-actual-off", "enabled", enabledMonitoring, enabledDisposition, deployment(false, "paused", freshAt)),
  ]),
  source("fixture.no-deploy", freshAt, [
    target("fixture.no-deploy", "disabled", disabledMonitoring, disabledDisposition),
  ]),
  source("fixture.deploy-stale", freshAt, [
    target("fixture.deploy-stale", "enabled", enabledMonitoring, enabledDisposition, deployment(true, "enabled", staleAt)),
  ]),
  source("fixture.not-due", freshAt, [
    target("fixture.not-due", "enabled", { runtime_guard: "pass", execution_heartbeat: "not_due" }, enabledDisposition, deployment(true, "enabled", freshAt)),
  ]),
  source("fixture.attention", staleAt, [
    target("fixture.attention", "enabled", attentionMonitoring, attentionDisposition, deployment(true, "enabled", freshAt)),
  ]),
  source("fixture.dup-a", freshAt, [
    target("fixture.duplicate", "enabled", enabledMonitoring, enabledDisposition, deployment(true, "enabled", freshAt)),
  ]),
  source("fixture.dup-b", freshAt, [
    target("fixture.duplicate", "enabled", enabledMonitoring, enabledDisposition, deployment(true, "enabled", freshAt)),
  ]),
];

for (const payload of sources) {
  const response = await worker.fetch(new Request("https://switch.example/api/internal/sync-runtime-target-lifecycle-source", {
    method: "POST",
    headers: { Authorization: "Bearer fixture-account-state-sync", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }), env);
  assert.equal(response.status, 200, payload.source_id);
}

const unauthorized = await worker.fetch(new Request("https://switch.example/api/runtime-target-lifecycle"), env);
assert.equal(unauthorized.status, 401);
const read = await worker.fetch(new Request("https://switch.example/api/runtime-target-lifecycle", {
  headers: { Cookie: cookie },
}), env);
assert.equal(read.status, 200);
const apiPayload = await read.json();
const aggregated = await __test.aggregateRuntimeTargetLifecycleSources(env);
const byId = new Map(apiPayload.targets.map(entry => [entry.target.target_id, entry]));
assert.deepEqual(
  apiPayload.targets.map(entry => [entry.target.target_id, entry.account_state]),
  aggregated.targets.map(entry => [entry.target.target_id, entry.account_state]),
);

function expectState(id, expected) {
  const entry = byId.get(id);
  assert.ok(entry, id);
  const { account_state: attached, ...withoutProjection } = entry;
  assert.deepEqual(__test.projectRuntimeAccountState(withoutProjection), attached, id);
  assert.equal(JSON.stringify(attached).includes("正常") || /[\u3400-\u9fff]/u.test(JSON.stringify(attached)), false, id);
  assert.deepEqual(attached, {
    scope: "monitoring_only",
    limit: "not_trading_or_books",
    ...expected,
  }, id);
}

expectState("fixture.normal", { health: "normal", activation: "enabled", reason: "monitoring_agrees" });
expectState("fixture.stale-source", { health: "unknown", activation: "enabled", reason: "source_not_fresh" });
expectState("fixture.saved-off", { health: "abnormal", activation: "enabled", reason: "config_inconsistent" });
expectState("fixture.actually-off", { health: "normal", activation: "disabled", reason: "monitoring_agrees" });
expectState("fixture.saved-on-actual-off", { health: "abnormal", activation: "disabled", reason: "config_inconsistent" });
expectState("fixture.no-deploy", { health: "unknown", activation: "unknown", reason: "deployment_missing" });
expectState("fixture.deploy-stale", { health: "unknown", activation: "unknown", reason: "deployment_not_fresh" });
expectState("fixture.not-due", { health: "unknown", activation: "enabled", reason: "check_not_due" });
expectState("fixture.attention", { health: "abnormal", activation: "enabled", reason: "retained_attention" });
assert.equal(byId.has("fixture.duplicate"), false);
assert.ok(apiPayload.errors.includes("runtime_target_lifecycle_duplicate_target"));

const savedOffWithoutDeployment = __test.projectRuntimeAccountState({
  freshness: { data_status: "ready", age_seconds: 1 },
  target: target("fixture.saved-only", "disabled", disabledMonitoring, disabledDisposition),
});
assert.equal(savedOffWithoutDeployment.activation, "unknown");
assert.notEqual(savedOffWithoutDeployment.health, "normal");
assert.notEqual(savedOffWithoutDeployment.reason, "config_inconsistent");

const mismatchedSwitch = __test.projectRuntimeAccountState({
  freshness: { data_status: "ready", age_seconds: 1 },
  deployment_freshness: { data_status: "ready", age_seconds: 1 },
  target: target("fixture.mismatch", "disabled", disabledMonitoring, disabledDisposition, deployment(false, "enabled", freshAt)),
});
assert.equal(mismatchedSwitch.activation, "unknown");
assert.equal(mismatchedSwitch.reason, "activation_unconfirmed");

const illegalDisabledReadback = target("fixture.illegal-disabled-readback", "enabled", disabledMonitoring, disabledDisposition, deployment(false, "paused", freshAt));
const illegalProjection = __test.projectRuntimeAccountState({
  freshness: { data_status: "ready", age_seconds: 1 },
  deployment_freshness: { data_status: "ready", age_seconds: 1 },
  target: illegalDisabledReadback,
});
assert.deepEqual(illegalProjection, {
  scope: "monitoring_only",
  limit: "not_trading_or_books",
  health: "abnormal",
  activation: "disabled",
  reason: "config_inconsistent",
});
const rejectedSource = await worker.fetch(new Request("https://switch.example/api/internal/sync-runtime-target-lifecycle-source", {
  method: "POST",
  headers: { Authorization: "Bearer fixture-account-state-sync", "Content-Type": "application/json" },
  body: JSON.stringify(source("fixture.illegal-disabled-readback", freshAt, [illegalDisabledReadback])),
}), env);
assert.equal(rejectedSource.status, 400);

console.log("console_account_state_validation: PASS");
