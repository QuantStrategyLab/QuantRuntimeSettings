import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import worker, { __test } from "../web/strategy-switch-console/worker.js";

const account = { key: "synthetic", target_name: "synthetic", label: "Synthetic",
  deployment_selector: "synthetic", account_scope: "synthetic", account_selector: "synthetic",
  service_name: "synthetic-service", variable_scope: "repository", supported_domains: ["crypto"] };
const target = { platform_id: "binance", deployment_selector: "synthetic", account_scope: "synthetic",
  account_selector: ["synthetic"], service_name: "synthetic-service", strategy_profile: "crypto_live_pool_rotation",
  execution_mode: "live", dry_run_only: false, live_continuity: { state: "RECONCILE_ONLY",
    baseline_kind: "legacy_authorized", baseline_id: "synthetic-baseline", captured_at: "2026-08-30",
    baseline_target_sha256: "a".repeat(64) } };
const variables = { RUNTIME_TARGET_JSON: JSON.stringify(target), RUNTIME_TARGET_ENABLED: "false",
  BINANCE_RECOVERY_CONTROL_ENABLED: "true", BINANCE_DRY_RUN: "false", STRATEGY_PROFILE: target.strategy_profile };
const digest = createHash("sha256").update(variables.RUNTIME_TARGET_JSON).digest("hex");
const body = { platform: "binance", target_name: account.target_name, runtime_target_sha256: digest, confirm: "RESUME_EXISTING" };
const env = { SESSION_SECRET: "synthetic-only-signing", ALLOWED_GITHUB_LOGINS: "synthetic-operator",
  RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-only", STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ binance: [account] }) };
const originalFetch = globalThis.fetch;
const dispatches = [];
let source = variables;
let dispatchFailure = false;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("/variables?")) return Response.json({ total_count: Object.keys(source).length,
    variables: Object.entries(source).map(([name, value]) => ({ name, value })) });
  assert.equal(String(url), "https://api.github.com/repos/QuantStrategyLab/QuantRuntimeSettings/actions/workflows/manual-binance-resume.yml/dispatches");
  dispatches.push(JSON.parse(init.body));
  if (dispatchFailure) throw new Error("synthetic-private-provider-error");
  return new Response(null, { status: 204 });
};
async function request(input = body, { authenticated = true, origin = "https://console.example" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  if (authenticated) headers.Cookie = `qsl_switch_session=${await __test.makeSession("synthetic-operator", [], env)}`;
  return worker.fetch(new Request("https://console.example/api/runtime-resume", {
    method: "POST", headers, body: JSON.stringify(input),
  }), env);
}
try {
  let result = await request();
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, configured: false, platform_applied: false,
    actions_url: "https://github.com/QuantStrategyLab/QuantRuntimeSettings/actions/workflows/manual-binance-resume.yml" });
  assert.equal(dispatches.length, 1);
  const dispatched = dispatches[0];
  assert.equal(dispatched.ref, "main");
  assert.deepEqual(Object.keys(dispatched.inputs).sort(), ["apply", "confirm", "resume_request"]);
  assert.equal(dispatched.inputs.apply, "true");
  const resume = JSON.parse(dispatched.inputs.resume_request);
  assert.equal(resume.runtime_target_sha256, digest);
  assert.deepEqual(Object.keys(resume.runtime_target).sort(),
    ["platform_id", "deployment_selector", "account_scope", "account_selector", "service_name"].sort());
  assert.equal(resume.github.repository, "QuantStrategyLab/BinancePlatform");
  const probe = spawnSync("python3", ["-c", [
    "import json,sys;sys.path.insert(0,'python/scripts')",
    "from resume_binance_runtime import validate_source",
    "payload=json.load(sys.stdin)",
    "validate_source(json.loads(payload['dispatch']['inputs']['resume_request']),payload['variables'])",
  ].join(";")], { input: JSON.stringify({ dispatch: dispatched, variables }), encoding: "utf8" });
  assert.equal(probe.status, 0, "Worker request must pass the actual workflow validator");
  for (const input of [{ ...body, platform: "ibkr" }, { ...body, target_name: "unknown" },
    { ...body, runtime_target_sha256: "b".repeat(64) }, { ...body, confirm: "APPLY" },
    { ...body, strategy_profile: "new-profile" }, { ...body, extra_variables_json: "{}" },
    { ...body, service_name: "other" }, { ...body, live_continuity_state: "ACTIVE_LKG" }]) {
    const count = dispatches.length;
    assert.ok((await request(input)).status >= 400);
    assert.equal(dispatches.length, count);
  }
  for (const options of [{ authenticated: false }, { origin: null }, { origin: "https://other.example" }]) {
    const count = dispatches.length;
    assert.ok((await request(body, options)).status >= 400);
    assert.equal(dispatches.length, count);
  }
  for (const mutation of [{ RUNTIME_TARGET_ENABLED: "true" }, { BINANCE_RECOVERY_CONTROL_ENABLED: "false" },
    { RUNTIME_TARGET_JSON: JSON.stringify({ ...target, account_scope: "other" }) }]) {
    source = { ...variables, ...mutation };
    const count = dispatches.length;
    assert.ok((await request()).status >= 400);
    assert.equal(dispatches.length, count);
  }
  source = variables;
  const current = await __test.loadCurrentStrategies({ binance: [account] }, env);
  assert.equal(current.binance.synthetic.binance_resume_target_sha256, digest);
  // No candidate catalog or confirmation is used as evidence of active recovery.
  assert.equal(current.binance.synthetic.recovery_active, undefined);
  dispatchFailure = true;
  result = await request();
  assert.equal(result.status, 502);
  assert.equal((await result.text()).includes("synthetic-private-provider-error"), false);

  const app = readFileSync(new URL("../web/strategy-switch-console/app.js", import.meta.url), "utf8");
  const digestStart = app.indexOf("    function binanceResumeDigest() {");
  const digestEnd = app.indexOf("\n    function ", digestStart + 1);
  for (const sample of [
    { selected: "binance", allowed: true, configSource: "private", enabled: false, expected: digest },
    { selected: "ibkr", allowed: true, configSource: "private", enabled: false, expected: "" },
    { selected: "binance", allowed: false, configSource: "private", enabled: false, expected: "" },
    { selected: "binance", allowed: true, configSource: "loading", enabled: false, expected: "" },
    { selected: "binance", allowed: true, configSource: "private", enabled: true, expected: "" },
    { selected: "binance", allowed: true, configSource: "private", expected: "" },
  ]) {
    const value = runInNewContext(`${app.slice(digestStart, digestEnd)}\n binanceResumeDigest();`, {
      state: { selected: sample.selected, auth: { allowed: sample.allowed }, configSource: sample.configSource },
      currentEntryForAccount: () => ({ runtime_target_enabled: sample.enabled, binance_resume_target_sha256: digest }),
      selectedAccount: () => account,
    });
    assert.equal(value, sample.expected);
  }
  const start = app.indexOf("    async function dispatchBinanceResume() {");
  const end = app.indexOf("\n    async function ", start + 1);
  assert.ok(start > 0 && end > start);
  const uiSource = `${app.slice(start, end)}\n dispatchBinanceResume();`;
  for (const [allowed, confirmed] of [[true, true], [true, false], [false, true]]) {
    let calls = 0;
    const lock = { pending: false };
    const context = { state: { auth: { allowed }, selected: "binance", forms: { binance: { strategy: "unsaved-edit" } } },
      binanceResumeLock: lock, selectedAccount: () => account, binanceResumeDigest: () => digest,
      render: () => {}, t: (key) => key, showToast: () => {}, window: { confirm: () => confirmed, open: () => {} },
      fetch: async (url, init) => {
        calls++;
        assert.equal(url, "/api/runtime-resume");
        assert.deepEqual(JSON.parse(init.body), body);
        throw new Error("synthetic-timeout");
      } };
    await runInNewContext(uiSource, context);
    await runInNewContext(uiSource, context);
    assert.equal(calls, allowed && confirmed ? 1 : 0);
    assert.equal(lock.pending, allowed && confirmed);
  }
  console.log("Binance resume: exact identity, source, authentication, configuration-only dispatch and UI no-retry checks passed");
} finally { globalThis.fetch = originalFetch; }
