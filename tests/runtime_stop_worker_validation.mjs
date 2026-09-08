import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import worker, { __test } from "../web/strategy-switch-console/worker.js";

const account = {
  key: "synthetic-one", label: "Synthetic account", target_name: "synthetic-one",
  variable_scope: "environment", github_environment: "synthetic-env",
  deployment_selector: "synthetic-deployment", account_scope: "synthetic-group",
  account_selector: "synthetic-account", service_name: "synthetic-service",
  supported_domains: ["us_equity"], default_strategy_profile: "retired-synthetic-profile",
};
const env = {
  SESSION_SECRET: "synthetic-only-signing-key", ALLOWED_GITHUB_LOGINS: "synthetic-operator",
  RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-only-dispatch-value",
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ ibkr: [account] }),
};
const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  assert.equal(String(url), "https://api.github.com/repos/QuantStrategyLab/QuantRuntimeSettings/actions/workflows/manual-runtime-stop.yml/dispatches");
  return new Response(null, { status: 204 });
};
const body = { platform: "ibkr", target_name: "synthetic-one", confirm: "STOP_ONLY" };
async function request(input = body, { authenticated = true, origin = "https://console.example" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  if (authenticated) headers.Cookie = `qsl_switch_session=${await __test.makeSession("synthetic-operator", [], env)}`;
  return worker.fetch(new Request("https://console.example/api/runtime-stop", {
    method: "POST", headers, body: JSON.stringify(input),
  }), env);
}

try {
  const response = await request();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.configured, false);
  assert.equal(result.platform_applied, false);
  assert.equal(calls.length, 1);
  const dispatched = JSON.parse(calls[0].init.body);
  assert.equal(dispatched.inputs.apply, "true");
  assert.deepEqual(Object.keys(dispatched.inputs).sort(), ["apply", "confirm", "stop_request"]);
  assert.equal(dispatched.inputs.confirm, "STOP_ONLY");
  const target = JSON.parse(dispatched.inputs.stop_request);
  assert.equal(target.github.environment, account.github_environment);
  assert.equal(target.runtime_target.service_name, account.service_name);
  assert.deepEqual(target.runtime_target.account_selector, [account.account_selector]);
  assert.deepEqual(Object.keys(target.runtime_target).sort(),
    ["platform_id", "deployment_selector", "account_selector", "account_scope", "service_name"].sort());
  const probe = spawnSync("python3", [fileURLToPath(new URL("./helpers/runtime_stop_workflow_probe.py", import.meta.url))], {
    input: JSON.stringify(dispatched), encoding: "utf8",
  });
  assert.equal(probe.status, 0, probe.stderr.includes("TimeoutExpired") ? "synthetic workflow probe timed out" : "synthetic workflow probe failed");
  assert.match(probe.stdout, /readback: PASS/);
  // Both source scopes remain configuration-only, without platform callers.
  env.STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON = JSON.stringify({ ibkr: [{ ...account, variable_scope: "repository" }] });
  assert.equal((await request()).status, 200);
  const repositoryDispatch = JSON.parse(calls.at(-1).init.body);
  const chain = spawnSync("python3", [fileURLToPath(new URL("./helpers/runtime_stop_workflow_probe.py", import.meta.url))], {
    input: JSON.stringify(repositoryDispatch), encoding: "utf8",
  });
  assert.equal(chain.status, 0, chain.stderr.includes("TimeoutExpired") ? "repository configuration probe timed out" : "repository configuration probe failed");
  assert.match(chain.stdout, /configuration only, no platform dispatch/);
  env.STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON = JSON.stringify({ ibkr: [account] });

  for (const input of [
    { ...body, target_name: "unknown" }, { ...body, confirm: "APPLY_AND_SYNC" },
    { ...body, strategy_profile: "replacement" }, { ...body, service_name: "other-service" },
    { ...body, extra_variables_json: "{}" }, { ...body, enabled: true },
  ]) {
    const before = calls.length;
    assert.ok((await request(input)).status >= 400);
    assert.equal(calls.length, before);
  }
  for (const options of [{ authenticated: false }, { origin: null }, { origin: "https://other.example" }]) {
    const before = calls.length;
    assert.ok((await request(body, options)).status >= 400);
    assert.equal(calls.length, before);
  }
  const app = readFileSync(new URL("../web/strategy-switch-console/app.js", import.meta.url), "utf8");
  assert.equal(app.includes("runtime-stop-button"), false);
  assert.equal(app.includes("runtimeStopOnly"), false);
  const start = app.indexOf("    async function dispatchRuntimeStop() {");
  const end = app.indexOf("    async function dispatchSwitch() {", start);
  assert.ok(start >= 0 && end > start);
  const uiSource = `${app.slice(start, end)}\n dispatchRuntimeStop();`;
  for (const [allowed, confirmed] of [[true, true], [true, false], [false, true]]) {
    const before = calls.length;
    const dispatchButton = { disabled: false };
    const runtimeStopLock = { pending: false };
    const context = {
      runtimeStopLock,
      state: { auth: { allowed }, selected: "ibkr", forms: { ibkr: { strategy: "edited-but-not-applied" } } },
      selectedAccount: () => account, el: () => dispatchButton, t: (key) => key, showToast: () => {},
      window: { confirm: () => confirmed, open: () => {} },
      fetch: async (url, init) => {
        assert.equal(url, "/api/runtime-stop");
        assert.deepEqual(JSON.parse(init.body), body);
        return request(JSON.parse(init.body));
      },
    };
    await runInNewContext(uiSource, context);
    assert.equal(calls.length, before + (allowed && confirmed ? 1 : 0));
    assert.equal(runtimeStopLock.pending, allowed && confirmed);
    assert.equal(dispatchButton.disabled, allowed && confirmed);
    if (allowed && confirmed) {
      // The main dispatch control owns stop-only mode and must keep the pending lock.
      await runInNewContext(uiSource, context);
      assert.equal(calls.length, before + 1);
    }
  }
  let unknownAttempts = 0;
  const pendingButton = { disabled: false };
  const pendingLock = { pending: false };
  const unknownContext = {
    runtimeStopLock: pendingLock,
    state: { auth: { allowed: true }, selected: "ibkr" }, selectedAccount: () => account,
    el: () => pendingButton, t: (key) => key, showToast: () => {},
    window: { confirm: () => true, open: () => {} },
    fetch: async () => { unknownAttempts += 1; throw new Error("synthetic timeout"); },
  };
  await runInNewContext(uiSource, unknownContext);
  await runInNewContext(uiSource, unknownContext);
  assert.equal(unknownAttempts, 1);
  assert.equal(pendingLock.pending, true);
  globalThis.fetch = async () => new Response("synthetic-sensitive-provider-error", { status: 500 });
  const failure = await request();
  assert.equal(failure.status, 502);
  assert.equal((await failure.text()).includes("synthetic-sensitive-provider-error"), false);
  console.log("runtime stop: 12 Worker scenarios + 4 UI scenarios + both configuration-scope readbacks passed; no platform dispatch, external calls mocked");
} finally {
  globalThis.fetch = originalFetch;
}
