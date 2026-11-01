import assert from "node:assert/strict";
import worker from "./helpers/directory_worker.mjs";
import { __test } from "./helpers/directory_worker.mjs";
import { runtimeReadbackProjection } from "../web/strategy-switch-console/application/console_api/runtime_readback.js";

const now = Date.now(), observedAt = new Date(now - 1000).toISOString();
const account = { platform: "longbridge", key: "demo", runtime_status_target_id: "demo.target" };
const entry = { observed_at: observedAt,
  target: { target_id: "demo.target", target: { platform: "longbridge" }, deployment: {
    observed_at: observedAt, runtime_enabled: false, scheduler_state: "paused", strategy_profile: "demo_strategy",
  } },
  freshness: { data_status: "ready" }, deployment_freshness: { data_status: "ready" }, evidence_valid_for_seconds: 60,
};
const snapshot = { targets: [entry], errors: [] };
const project = (source = snapshot, accounts = [account]) => runtimeReadbackProjection(account, accounts, source, now);
assert.equal(project().runtime_enabled, false);
assert.equal(project().scheduler_state, "paused");
assert.equal(project().observed_at, observedAt);
assert.equal(project().data_status, "ready");
assert.equal(project(snapshot, [account, { ...account, key: "other" }]).reason, "runtime_binding_conflict");
for (const mutate of [
  item => { item.freshness.data_status = "stale"; },
  item => { item.observed_at = new Date(now + 1000).toISOString(); },
  item => { item.deployment_freshness.data_status = "stale"; },
  item => { item.target.deployment.observed_at = new Date(now - 120_000).toISOString(); },
  item => { delete item.target.deployment.observed_at; },
  item => { item.target.deployment.observed_at = new Date(now + 1000).toISOString(); },
  item => { delete item.target.deployment; },
  item => { item.target.target.platform = "ibkr"; },
  item => { item.freshness.data_status = "unavailable"; },
  item => { delete item.evidence_valid_for_seconds; },
]) {
  const changed = structuredClone(entry); mutate(changed);
  const result = project({ targets: [changed], errors: [] });
  assert.notEqual(result.data_status, "ready");
  assert.equal(result.runtime_enabled, null);
  assert.equal(result.scheduler_state, "unknown");
}
assert.equal(project({ targets: [], errors: [] }).reason, "runtime_observation_missing");
assert.equal(project({ targets: [entry, entry], errors: [] }).reason, "runtime_binding_conflict");

// Exercise the real handler with an in-memory source and no outbound service.
const source = {
  schema_version: "qsl_runtime_target_lifecycle_source_snapshot.v1", source_id: "demo",
  generated_at: observedAt, computed_at: observedAt, data_status: "ready", errors: [],
  targets: [{ target_id: "demo.target", target: { platform: "longbridge", configured_state: "disabled", execution_mode: "paper" },
    monitoring: { runtime_guard: "pass", execution_heartbeat: "not_applicable" },
    disposition: { code: "continue_disabled_validation", reason_code: "target_intentionally_disabled" },
    no_order: true, deployment: { ...entry.target.deployment, execution_mode: "paper" } }],
};
const env = {
  SESSION_SECRET: "synthetic-session-only", ALLOWED_GITHUB_LOGINS: "demo-reader",
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ longbridge: [{ key: "demo", label: "Demo", target_name: "demo", runtime_status_target_id: "demo.target", account_selector: "DEMO", deployment_selector: "demo", account_scope: "DEMO", service_name: "demo-service", supported_domains: ["us_equity"], broker_environment: "paper", default_execution_mode: "paper" }] }),
  STRATEGY_SWITCH_CONFIG: { get: async key => key.startsWith("runtime_target_lifecycle_source:") ? JSON.stringify(source) : null, put: async () => { throw Error("write attempted"); }, list: async () => ({ keys: [{ name: "runtime_target_lifecycle_source:demo" }] }) },
};
const cookie = `qsl_switch_session=${await __test.makeSession("demo-reader", [], env)}`;
const request = () => new Request("https://example.invalid/api/runtime/readback?scope=longbridge:demo", { headers: { Cookie: cookie } });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error("outbound attempted"); };
try {
  const sourceCheck = await __test.aggregateRuntimeTargetLifecycleSources(env);
  assert.deepEqual(sourceCheck.errors, [], "fixture source must validate");
  let response = await worker.fetch(request(), env, {});
  let body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data_status, "ready");
  assert.equal(body.runtime_enabled, false);
  assert.equal(body.observed_at, observedAt);
  assert.equal(JSON.stringify(body).includes("DEMO"), false);
  source.targets[0].deployment.observed_at = new Date(now - 30 * 86_400_000).toISOString();
  response = await worker.fetch(request(), env, {}); body = await response.json();
  assert.equal(body.data_status, "stale");
  assert.equal(body.runtime_enabled, null);
  env.STRATEGY_SWITCH_CONFIG.get = async key => { if (key.startsWith("runtime_target_lifecycle_source:")) throw Error("read failure"); return null; };
  assert.equal((await worker.fetch(request(), env, {})).status, 503);
  env.STRATEGY_SWITCH_CONFIG.list = async () => { throw Error("list failure"); };
  assert.equal((await worker.fetch(request(), env, {})).status, 503);
} finally { globalThis.fetch = originalFetch; }
console.log("Runtime readback validation passed");
