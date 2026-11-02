import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { __test } from "../web/strategy-switch-console/worker.js";
import { READBACK_KEYS, buildReadback, normalizeReadbackValue } from "../web/strategy-switch-console/application/desk/readback.js";
const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require("miniflare");
const ajv = new (require("ajv/dist/2020").default)({ strict: false });
require("ajv-formats")(ajv);
for (const name of ["common", "readback", "readback-start", "readback-job", "error"]) ajv.addSchema(JSON.parse(readFileSync(new URL(`../schemas/desk/${name}.json`, import.meta.url))));
const conforms = (name, data) => {
  const check = ajv.getSchema(`https://schemas.example.invalid/qsl/desk/${name}.json`);
  assert.ok(check(data), ajv.errorsText(check.errors));
};
const now = Date.parse("2030-01-02T12:00:00Z");
const ratio = text => Number(text) >= 0 && Number(text) <= 1 ? text : "";
const config = { key: "demo", label: "Synthetic", target_name: "demo", default_strategy_profile: "demo_profile",
  broker_environment: "paper", account_selector: "FAKE0001", deployment_selector: "demo", account_scope: "FAKE0001",
  service_name: "synthetic-service", runtime_status_target_id: "longbridge.demo", supported_domains: ["us_equity"], default_execution_mode: "live" };
const target = { id: "longbridge/demo", platform: "longbridge", key: "demo", config, revision: 3 };
const observed = { config, instance_revision: 3, enabled: true, draft: { status: "current", overrides: { reserved_cash_ratio: "0.0800" } }, account_options: { longbridge: [config] } };
const build = (extra = {}) => buildReadback({ target, observed, now, cleanRatio: ratio, ...extra });
for (const [saved, platform, state] of [[" a ", "a", "match"], ["a", "b", "drift"], ["a", undefined, "unknown"], [undefined, "a", "unknown"], [undefined, undefined, "unknown"]]) {
  const rb = build({ observed: { ...observed, config: { ...config, default_strategy_profile: saved } }, platform: { strategy_profile: platform } });
  assert.equal(rb.fields.find(row => row.key === "strategy_profile").state, state);
  assert.equal(rb.overall, state === "drift" ? "drift" : "unknown");
}
assert.equal(build({ observed: null }).overall, "unknown");
assert.equal(build({ observed: null }).saved_revision, 3, "use the known registry revision when detailed saved settings fail");
for (const [key, input, expected] of [["enabled", " TRUE ", "true"], ["enabled", 0, "false"], ["enabled", "bogus", null], ["reserved_cash_ratio", "00.0800", "0.08"], ["reserved_cash_ratio", ".080", "0.08"], ["reserved_cash_floor", "00100.00", "100"], ["reserved_cash_ratio", "1.1", null]]) assert.equal(normalizeReadbackValue(key, input, ratio), expected);
const allKnown = Object.fromEntries(READBACK_KEYS.map(key => [key, "demo"]));
Object.assign(allKnown, { enabled: true, income_layer_enabled: false, option_overlay_enabled: false, reserved_cash_floor: "10", reserved_cash_ratio: "0.08", dca_base_investment_usd: "20" });
const matched = build({ observed: { ...observed, config: { ...allKnown, default_strategy_profile: "demo" }, draft: { status: "empty" } }, platform: allKnown });
assert.equal(matched.overall, "match");
assert.equal(matched.summary.match, READBACK_KEYS.length);
const poisoned = build({ platform: { strategy_profile: "different", TOKEN: "synthetic-poison", reserved_cash_ratio: "0.08", account_selector: "OTHER0001" } });
assert.equal(poisoned.overall, "drift");
assert.equal(poisoned.fields.find(row => row.key === "account_selector").state, "drift", "same suffix cannot certify identity equality");
assert.ok(!JSON.stringify(poisoned).includes("FAKE0001"));
assert.ok(!JSON.stringify(poisoned).includes("synthetic-poison"));
assert.deepEqual(poisoned.fields.map(row => row.key), READBACK_KEYS);
assert.equal(build({ observed: { ...observed, draft: { status: "identity_conflict", overrides: { strategy_profile: "untrusted" } } } }).fields[0].saved.reason, "identity_unverified");
const nativeNow = Date.now;
Date.now = () => now;
try {
  for (const [env, platform] of [[{}, "longbridge"], [{ RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-only" }, "unmapped"]]) {
    const rb = await __test.deskTargetReadback(env, { ...target, platform }, "synthetic-reader", observed);
    assert.ok(rb.fields.every(row => row.platform.reason === "source_unavailable"));
  }
} finally { Date.now = nativeNow; }

const bindings = { SESSION_SECRET: "synthetic-session-only", ALLOWED_GITHUB_LOGINS: "synthetic-admin,synthetic-reader",
  STRATEGY_SWITCH_ADMIN_LOGINS: "synthetic-admin", RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-upstream-only",
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ longbridge: [config, { ...config, key: "failed", target_name: "failed", account_selector: "FAKE0002", deployment_selector: "failed", account_scope: "FAKE0002", service_name: "synthetic-failed" }] }) };
let cookie, otherCookie;
Date.now = () => now;
try {
  cookie = `qsl_switch_session=${await __test.makeSession("synthetic-admin", [], bindings)}`;
  otherCookie = `qsl_switch_session=${await __test.makeSession("synthetic-reader", [], bindings)}`;
} finally { Date.now = nativeNow; }
let failure = false, upstreamReads = 0;
const mf = new Miniflare({ modules: true, compatibilityDate: "2026-06-08", modulesRoot: fileURLToPath(new URL("../", import.meta.url)),
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }], scriptPath: fileURLToPath(new URL("./helpers/desk_readback_worker.mjs", import.meta.url)), bindings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "SyntheticRuntimeInstances", useSQLite: true } }, kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: request => {
    assert.equal(request.method, "GET", "readbacks cannot write to an upstream"); upstreamReads++;
    if (failure === "timeout") throw new Error("synthetic timeout private details");
    if (failure) return new Response("synthetic private details", { status: 503 });
    const targets = [{ runtime_target: { target_name: "demo", account_selector: "FAKE0001", broker_environment: "paper", strategy_profile: "demo_profile" }, service_name: "synthetic-service", runtime_target_enabled: false }];
    return Response.json({ variables: [{ name: "CLOUD_RUN_SERVICE_TARGETS_JSON", value: JSON.stringify(targets) },
      { name: "RUNTIME_TARGET_JSON", value: JSON.stringify(targets[0].runtime_target) }, { name: "RUNTIME_TARGET_ENABLED", value: "false" },
      { name: "LONGBRIDGE_RESERVED_CASH_RATIO", value: "0.0800" }, { name: "TOKEN", value: "synthetic-poison" }] });
  },
});
async function call(path, { body, auth = cookie, origin = "https://synthetic.example", raw } = {}) {
  const response = await mf.dispatchFetch(`https://synthetic.example${path}`, { method: body !== undefined || raw !== undefined ? "POST" : "GET", headers: { Cookie: auth, Origin: origin, "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : raw !== undefined ? { body: raw } : {}) });
  const data = await response.json();
  if (!path.startsWith("/test/")) assert.equal(response.headers.get("cache-control"), "no-store");
  return { status: response.status, body: data };
}
try {
  assert.equal((await call("/api/admin/runtime-instances", { body: { action: "initialize", expected_revision: 0, confirm: "IMPORT_EXISTING_CONFIG" } })).status, 200);
  assert.equal((await call("/api/desk/targets/longbridge/demo/readback", { auth: "" })).status, 401);
  for (const id of ["longbridge/missing", "invisible/demo"]) assert.equal((await call(`/api/desk/targets/${id}/readback`)).status, 404);
  const first = await call("/api/desk/targets/longbridge%2Fdemo/readback");
  assert.equal(first.status, 200); conforms("readback", first.body);
  assert.equal(first.body.fields.find(row => row.key === "strategy_profile").state, "match");
  assert.equal(first.body.fields.find(row => row.key === "enabled").platform.value, "false");
  assert.equal(first.body.identity.account_suffix, "0001");
  assert.equal(first.body.actions.reapply_saved.allowed, false);
  assert.equal(first.body.actions.adopt_platform.allowed, false);
  assert.ok(!JSON.stringify(first.body).includes("synthetic-poison"));
  assert.equal((await call(`/api/desk/readbacks/${first.body.readback_id}`)).body.readback_id, first.body.readback_id);
  assert.equal((await call(`/api/desk/readbacks/${first.body.readback_id}`, { auth: otherCookie })).status, 404);
  for (failure of [true, "timeout"]) {
    const degraded = await call("/api/desk/targets/longbridge/demo/readback");
    assert.equal(degraded.status, 200); conforms("readback", degraded.body);
    assert.ok(degraded.body.fields.every(row => row.platform.status === "unknown" && row.platform.reason === "read_failed"));
    assert.ok(!JSON.stringify(degraded).includes("private details"));
  }
  failure = false;
  for (const body of [{ target_ids: [] }, { target_ids: Array(21).fill("longbridge/demo") }, { target_ids: null }, { target_ids: ["longbridge/demo", "longbridge/demo"] }, { target_ids: [1] }, { extra: true }]) assert.equal((await call("/api/desk/readbacks", { body: { ...body, idempotency_key: "invalid" } })).status, 400);
  assert.equal((await call("/api/desk/readbacks", { raw: "{" })).status, 400);
  assert.equal((await call("/api/desk/readbacks", { raw: " ".repeat(8193) })).status, 400);
  assert.equal((await call("/api/desk/readbacks", { body: { idempotency_key: "bad key" } })).status, 400);
  assert.equal((await call("/api/desk/readbacks", { body: { target_ids: ["hidden/demo"], idempotency_key: "hidden" } })).status, 404);
  assert.equal((await call("/api/desk/readbacks", { body: { idempotency_key: "cross" }, origin: "https://other.invalid" })).status, 403);
  const before = upstreamReads;
  const body = { idempotency_key: "synthetic-job" };
  const start = await call("/api/desk/readbacks", { body });
  assert.equal(start.status, 202); conforms("readback-start", start.body);
  assert.equal(upstreamReads, before, "starting a job never blocks on upstream reads");
  const jobPath = `/api/desk/readbacks/${start.body.readback_id}`;
  assert.equal((await call(jobPath)).body.state, "running");
  const replay = await call("/api/desk/readbacks", { body });
  assert.deepEqual(replay.body, { ...start.body, reused: true });
  assert.equal((await call("/api/desk/readbacks", { body: { ...body, target_ids: ["longbridge/demo"] } })).status, 409);
  assert.equal((await call("/api/desk/readbacks", { body: { idempotency_key: "busy" }, auth: `${cookie}; harmless=changed` })).status, 429);
  for (const auth of [`${cookie}.ignored`, `qsl_switch_session=ignored; ${cookie}`, cookie.replace("=e", "=%65")]) {
    assert.equal((await call("/api/desk/readbacks", { body: { idempotency_key: `variant-${auth.length}` }, auth })).status, 429);
  }
  assert.equal((await call(jobPath, { auth: otherCookie })).status, 404);
  await call("/test/alarm");
  assert.equal((await call(jobPath)).body.state, "running");
  failure = true;
  await call("/test/alarm");
  const done = await call(jobPath); conforms("readback-job", done.body);
  assert.equal(done.body.state, "partial");
  assert.deepEqual(done.body.results.map(row => row.state), ["done", "failed"]);
  assert.equal(done.body.results[1].error, "read_failed");
  assert.equal((await call("/api/desk/targets/longbridge/failed/readback")).body.overall, "unknown");
  const attempts = await Promise.all(["next", "concurrent"].map(idempotency_key => call("/api/desk/readbacks", { body: { idempotency_key, target_ids: ["longbridge/failed"] } })));
  assert.deepEqual(attempts.map(result => result.status).sort(), [202, 429]);
  const next = attempts.find(result => result.status === 202);
  await call("/test/alarm");
  assert.equal((await call(`/api/desk/readbacks/${next.body.readback_id}`)).body.state, "failed");
  assert.ok((await call("/test/count")).body.count > 0);
  failure = false;
  const afterBusy = await call("/api/desk/readbacks", { body: { idempotency_key: "busy" } });
  assert.equal(afterBusy.status, 202, "429 must not poison a retry's idempotency key");
  await call("/test/alarm"); await call("/test/alarm");
  const success = await call("/api/desk/readbacks", { body: { idempotency_key: "success", target_ids: ["longbridge/demo"] } });
  assert.equal(success.status, 202);
  await call("/test/alarm");
  const successful = await call(`/api/desk/readbacks/${success.body.readback_id}`);
  assert.equal(successful.body.state, "done"); conforms("readback-job", successful.body);
  await call("/test/expire");
  assert.equal((await call("/test/count")).body.count, 0, "expired snapshots and jobs are physically removed");
  // Use the internal DO command after session expiry to verify physical TTL.
  const ns = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const storage = ns.get(ns.idFromName("runtime-instances"));
  const expired = await storage.fetch("https://synthetic.example/", { method: "POST", body: JSON.stringify({ action: "desk_readback_get", owner: "synthetic", actor: "synthetic-admin", id: first.body.readback_id }) });
  assert.equal(expired.status, 404);
} finally { await mf.dispose(); }
console.log("desk_readback_validation: PASS (diff, whitelist, real auth/SQLite jobs, refresh, replay, failures, TTL)");
