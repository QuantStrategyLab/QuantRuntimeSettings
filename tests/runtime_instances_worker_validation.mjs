import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { __test } from "../web/strategy-switch-console/worker.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");
const legacy = { key: "existing", label: "Existing fixture", target_name: "existing", account_selector: "existing-account", deployment_selector: "existing-deployment", service_name: "existing-service", supported_domains: ["us_equity"] };
const bindings = {
  SESSION_SECRET: "synthetic-only-session-key",
  STRATEGY_SWITCH_ADMIN_LOGINS: "fixture-admin",
  ALLOWED_GITHUB_LOGINS: "fixture-reader",
  STRATEGY_SWITCH_SYNC_TOKEN: "synthetic-only-sync-token",
  RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-only-dispatch-token",
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ ibkr: [legacy] }),
  STRATEGY_SWITCH_STRATEGY_PROFILES_JSON: JSON.stringify([{ profile: "fixture-strategy", label: "Fixture strategy", domain: "us_equity", allowed_execution_modes: ["dry_run"], runtime_enabled: false }]),
};
const adminCookie = `qsl_switch_session=${await __test.makeSession("fixture-admin", [], bindings)}`;
const readerCookie = `qsl_switch_session=${await __test.makeSession("fixture-reader", [], bindings)}`;
const path = "/api/admin/runtime-instances";
const headers = { Cookie: adminCookie, Origin: "https://console.example", "Content-Type": "application/json" };
assert.equal((await worker.fetch(new Request(`https://console.example${path}`, { headers }), bindings)).status, 503, "missing binding must report management unavailable");

const persist = await mkdtemp(join(tmpdir(), "qrt-runtime-instances-"));
let outbound = 0;
const options = {
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08",
  bindings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  durableObjectsPersist: persist,
  kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: () => { outbound += 1; return new Response("offline only", { status: 503 }); },
};
let mf = new Miniflare(options);
async function call(body, { cookie = adminCookie, origin = "https://console.example", endpoint = path, method = body ? "POST" : "GET", extraHeaders = {} } = {}) {
  const response = await mf.dispatchFetch(`https://console.example${endpoint}`, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json", ...extraHeaders },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
const draft = { key: "draft-one", label: "Draft one", target_name: "draft-one", account_selector: "new-account", deployment_selector: "new-deployment", service_name: "new-service", default_strategy_profile: "fixture-strategy", supported_domains: ["us_equity"] };
const create = (config = draft, revision = 1) => ({ action: "create", expected_revision: revision, platform: "ibkr", config });
try {
  assert.equal((await call(undefined, { cookie: "" })).status, 401);
  assert.equal((await call(undefined, { cookie: readerCookie })).status, 403);
  assert.equal((await call(create(), { origin: "https://untrusted.example" })).status, 403);
  assert.equal((await call(create(), { origin: "" })).status, 403);
  assert.equal((await call()).body.initialized, false);
  assert.equal((await call(create(draft, 0))).status, 409);
  let state = await call({ action: "initialize", expected_revision: 0, confirm: "IMPORT_EXISTING_CONFIG" });
  assert.equal(state.status, 200);
  assert.equal(state.body.revision, 1);
  assert.equal(state.body.instances[0].kind, "existing");
  assert.equal(state.body.instances[0].platform_applied, null);
  assert.equal((await call({ action: "initialize", expected_revision: 0, confirm: "IMPORT_EXISTING_CONFIG" })).status, 409);
  for (const config of [{ ...draft, token: "synthetic-rejected" }, { ...draft, enabled: true }, { ...draft, platform_applied: true }]) {
    assert.equal((await call(create(config))).status, 400);
  }
  for (const platform of ["unknown", "alpaca", "qmt"]) assert.equal((await call({ ...create(), platform })).status, 400);
  assert.equal((await call(create({ ...draft, default_strategy_profile: "unknown-strategy" }))).status, 400);
  for (const config of [{ ...draft, target_name: "existing" }, { ...draft, account_selector: "existing-account" }, { ...draft, service_name: "existing-service" }]) {
    assert.equal((await call(create(config))).status, 409);
  }
  const concurrent = await Promise.all([call(create()), call(create({ ...draft, label: "Competing write" }))]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
  state = await call();
  assert.equal(state.body.revision, 2);
  assert.equal(state.body.instances.length, 2);
  assert.equal(state.body.history.length, 2);
  const saved = state.body.instances.find((item) => item.kind === "draft");
  assert.equal(saved.enabled, false);
  assert.equal(saved.platform_applied, false);
  assert.equal(saved.application_status, "unapplied");
  assert.equal(state.body.account_options.ibkr.length, 1, "draft cannot become an executable account option");
  const rejectedSwitch = await call({ ...draft, platform: "ibkr", strategy_profile: "fixture-strategy", execution_mode: "dry_run", apply: "true", trigger_platform_sync: "true", confirm_apply: "APPLY_AND_SYNC" }, { endpoint: "/api/switch" });
  assert.equal(rejectedSwitch.status, 500);
  assert.equal(rejectedSwitch.body.error, "switch inputs do not match configured account options");
  assert.equal((await call({ action: "edit", expected_revision: 1, platform: "ibkr", key: draft.key, config: { ...draft, label: "stale" } })).status, 409);
  state = await call({ action: "edit", expected_revision: 2, platform: "ibkr", key: draft.key, config: { ...draft, label: "Edited draft" } });
  assert.equal(state.status, 200);
  assert.equal(state.body.instances[1].config.label, "Edited draft");
  assert.equal((await call({ action: "edit", expected_revision: 3, platform: "ibkr", key: "existing", config: { ...legacy, default_strategy_profile: "fixture-strategy" } })).status, 409);
  for (const action of ["apply", "enable", "delete", "retire", "stop"]) assert.equal((await call({ action, expected_revision: 3, platform: "ibkr", key: draft.key })).status, 400);
  state = await call({ action: "request_retirement", expected_revision: 3, platform: "ibkr", key: "existing" });
  assert.equal(state.status, 200);
  assert.equal(state.body.instances[0].retirement_status, "requested");
  assert.equal(state.body.account_options.ibkr.length, 1, "retirement request is not stop or removal");
  assert.equal(state.body.instances[0].platform_applied, null);
  assert.equal((await call({ action: "request_retirement", expected_revision: 4, platform: "ibkr", key: "existing" })).body.revision, 4, "same request is idempotent");
  // Legacy admin config must not activate a draft or delete a funded target.
  const acl = { allowed_logins: ["fixture-admin"], allowed_orgs: [], admin_logins: ["fixture-admin"], admin_orgs: [] };
  assert.equal((await call({ ...acl, account_options: {} }, { endpoint: "/api/admin/config" })).status, 409);
  assert.equal((await call({ ...acl, account_options: { ibkr: [legacy, draft] } }, { endpoint: "/api/admin/config" })).status, 409);
  assert.equal((await call({ ...acl, account_options: { ibkr: [legacy] } }, { endpoint: "/api/admin/config" })).status, 200);
  const syncInputs = { platform: "ibkr", target_name: "existing", account_selector: "existing-account", deployment_selector: "existing-deployment", service_name: "existing-service", strategy_profile: "fixture-strategy", execution_mode: "dry_run", plugin_mode: "none", option_overlay_mode: "disabled", cash_only_execution_mode: "disabled" };
  const syncOptions = { endpoint: "/api/internal/sync-account-default", cookie: "", extraHeaders: { Authorization: "Bearer synthetic-only-sync-token" } };
  assert.equal((await call(syncInputs, { ...syncOptions, extraHeaders: {} })).status, 401);
  const rejectedRegistration = await call({ ...syncInputs, target_name: "draft-one" }, syncOptions);
  assert.equal(rejectedRegistration.status, 409);
  assert.equal(rejectedRegistration.body.error, "runtime_instance_registration_requires_management");
  assert.equal((await call(syncInputs, syncOptions)).status, 200);
  state = await call();
  assert.equal(state.body.instances[1].config.label, "Edited draft");
  assert.equal(state.body.instances[0].retirement_status, "requested");
  assert.equal(state.body.instances.length, 2);
  const beforeRestart = state.body;
  await mf.dispose();
  mf = new Miniflare(options);
  assert.deepEqual((await call()).body, beforeRestart, "SQLite state and audit survive a workerd restart");
  // A bad optional strategy catalog disables draft authoring only. Existing
  // instance readback, ACL management, and retirement requests remain available.
  const configKv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG");
  await configKv.put("strategy_profiles", "{invalid");
  const degraded = await call(undefined, { endpoint: "/api/admin/config" });
  assert.equal(degraded.status, 200);
  assert.equal(degraded.body.runtimeInstanceStrategiesAvailable, false);
  assert.deepEqual(degraded.body.runtimeInstanceStrategies, []);
  assert.equal(degraded.body.runtimeInstances.instances.length, 2);
  const degradedPage = await mf.dispatchFetch("https://console.example/admin", { headers: { Cookie: adminCookie } });
  assert.equal(degradedPage.status, 200);
  const degradedHtml = await degradedPage.text();
  assert.match(degradedHtml, /策略目录暂不可用/);
  assert.match(degradedHtml, /id="instance-save"[^>]*disabled/);
  assert.equal((await call({ ...acl, account_options: beforeRestart.account_options }, { endpoint: "/api/admin/config" })).status, 200);
  assert.equal((await call(create({ ...draft, key: "another-draft" }, beforeRestart.revision))).status, 400);
  assert.equal((await call({ action: "edit", expected_revision: beforeRestart.revision, platform: "ibkr", key: draft.key, config: draft })).status, 400);
  const retirementWithoutCatalog = await call({ action: "request_retirement", expected_revision: beforeRestart.revision, platform: "ibkr", key: draft.key });
  assert.equal(retirementWithoutCatalog.status, 200);
  assert.equal(retirementWithoutCatalog.body.instances[1].retirement_status, "requested");
  const setBrokerEnvironment = await call({ action: "set_broker_environment", expected_revision: retirementWithoutCatalog.body.revision, platform: "ibkr", key: "existing", broker_environment: "live" });
  assert.equal(setBrokerEnvironment.status, 200);
  const configuredEnvironment = setBrokerEnvironment.body.instances.find((item) => item.key === "existing");
  assert.equal(configuredEnvironment.config.broker_environment, "live");
  assert.equal(configuredEnvironment.enabled, null);
  assert.equal(configuredEnvironment.platform_applied, null);
  assert.equal(configuredEnvironment.application_status, "unknown");
  assert.equal(setBrokerEnvironment.body.history[0].action, "set_broker_environment");
  assert.equal(outbound, 0, "environment metadata must not dispatch workflows or broker requests");
  // Inject a real SQLite failure after instance_state is written. This test-only
  // subclass is never in production: rollback must restore both tables.
  await mf.dispose();
  const source = await readFile(options.scriptPath, "utf8");
  mf = new Miniflare({ ...options, durableObjectsPersist: false,
    durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "FailingRuntimeInstances", useSQLite: true } },
    script: source + `\nexport class FailingRuntimeInstances extends RuntimeInstances {
      constructor(ctx) { super(ctx); this.sql.exec("CREATE TRIGGER IF NOT EXISTS fail_history BEFORE INSERT ON instance_history WHEN NEW.revision = 2 BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END"); }
    }`,
  });
  assert.equal((await call({ action: "initialize", expected_revision: 0, confirm: "IMPORT_EXISTING_CONFIG" })).status, 200);
  assert.equal((await call(create())).status, 409);
  const rolledBack = (await call()).body;
  assert.equal(rolledBack.revision, 1);
  assert.equal(rolledBack.instances.length, 1);
  assert.equal(rolledBack.history.length, 1);
  assert.equal(rolledBack.history[0].action, "initialize");
  assert.equal(outbound, 0, "instance management may not dispatch workflows or broker requests");
  console.log("runtime instance validation: PASS (workerd SQLite, concurrent writers, persistent state, authorization, legacy bypass, no activation)");
} finally {
  await mf.dispose();
  await rm(persist, { recursive: true, force: true });
}
