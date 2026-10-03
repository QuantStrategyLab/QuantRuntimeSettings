import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  projectIbkrRuntimeLifecycle,
  main,
  readRemoteLifecycleData,
  summaryLine,
} from "../web/strategy-switch-console/inspect_ibkr_runtime_lifecycle.mjs";

const root = resolve(import.meta.dirname, "..");
const workflow = readFileSync(`${root}/.github/workflows/sync-schwab-account-facts-binding.yml`, "utf8");
const now = new Date().toISOString();
const staleAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const accountId = "synthetic-account-key";
const targetId = "tqqq_growth_income";
const sourceKey = "runtime_target_lifecycle_source:synthetic-source";
const factsBinding = {
  platform: "ibkr", account_key: accountId, account_scope: "live-primary",
  target_name: "synthetic-account", service_name: "synthetic-service",
  deployment_selector: "synthetic-deployment", account_selector: "U12345678",
  target_id: "primary-live", source_binding: { kind: "deployment_runtime_account", id: "a".repeat(64) },
};
const bindingPayload = (bindings = [factsBinding]) => ({ schema_version: "qsl_account_facts_bindings.v1", bindings });

function source({ generatedAt = now, computedAt = now, observedAt = now, target = targetId,
  strategyProfile = "tqqq_growth_income", includeDeployment = true } = {}) {
  const deployment = {
    runtime_enabled: true,
    scheduler_state: "enabled",
    strategy_profile: strategyProfile,
    execution_mode: "live",
    ...(observedAt ? { observed_at: observedAt } : {}),
  };
  return {
    schema_version: "qsl_runtime_target_lifecycle_source_snapshot.v1",
    source_id: "synthetic-source",
    generated_at: generatedAt,
    computed_at: computedAt,
    data_status: "ready",
    targets: [{
      target_id: target,
      target: { platform: "ibkr", configured_state: "enabled", execution_mode: "live" },
      monitoring: { runtime_guard: "pass", execution_heartbeat: "pass" },
      disposition: { code: "continue_enabled_monitoring", reason_code: "none" },
      no_order: true,
      ...(includeDeployment ? { deployment } : {}),
    }],
    errors: [],
  };
}
const row = (value, key = sourceKey) => ({ key, value: JSON.stringify(value) });
const options = (runtimeTargetId = targetId) => ({
  ibkr: [{ key: accountId, runtime_status_target_id: runtimeTargetId, account_scope: factsBinding.account_scope,
    target_name: factsBinding.target_name, service_name: factsBinding.service_name,
    deployment_selector: factsBinding.deployment_selector, account_selector: factsBinding.account_selector }],
});

const missingTime = await projectIbkrRuntimeLifecycle(options(), bindingPayload(), [row(source({ observedAt: null }))]);
assert.equal(missingTime.ok, true);
assert.equal(missingTime.mapping, "unique");
assert.equal(missingTime.aggregate_target_matches, "1");
assert.equal(missingTime.raw_source_target_matches, "1");
assert.equal(missingTime.source_freshness, "ready");
assert.equal(missingTime.deployment_present, true);
assert.equal(missingTime.deployment_observed_at_present, false);
assert.equal(missingTime.deployment_freshness, "unavailable");
assert.equal(missingTime.account_state_reason, "deployment_not_fresh");
assert.equal(missingTime.ttl_source, "default_unconfirmed");
assert.equal(missingTime.configuration_scope, "legacy_kv_unconfirmed");

const fresh = await projectIbkrRuntimeLifecycle(options(), bindingPayload(), [row(source())]);
assert.equal(fresh.source_freshness, "ready");
assert.equal(fresh.deployment_freshness, "ready");
assert.equal(fresh.account_state_reason, "monitoring_agrees");

const deploymentMissing = await projectIbkrRuntimeLifecycle(options(), bindingPayload(), [row(source({ includeDeployment: false }))]);
assert.equal(deploymentMissing.mapping, "unique");
assert.equal(deploymentMissing.raw_source_target_matches, "1");
assert.equal(deploymentMissing.aggregate_target_matches, "1");
assert.equal(deploymentMissing.deployment_present, false);
assert.equal(deploymentMissing.deployment_observed_at_present, false);
assert.equal(deploymentMissing.deployment_freshness, "unavailable");
assert.equal(deploymentMissing.account_state_reason, "deployment_missing");

const nullStrategyProfile = await projectIbkrRuntimeLifecycle(options(), bindingPayload(), [row(source({ strategyProfile: null }))]);
assert.equal(nullStrategyProfile.mapping, "unique");
assert.equal(nullStrategyProfile.raw_source_target_matches, "1");
assert.equal(nullStrategyProfile.aggregate_target_matches, "1");

const stale = await projectIbkrRuntimeLifecycle(options(), bindingPayload(), [row(source({ generatedAt: staleAt, computedAt: staleAt, observedAt: staleAt }))]);
assert.equal(stale.source_freshness, "stale");
assert.equal(stale.deployment_freshness, "stale");

const mappingMissing = await projectIbkrRuntimeLifecycle(options(""), bindingPayload(), [row(source())]);
assert.equal(mappingMissing.mapping, "missing");
assert.equal(mappingMissing.deployment_present, true);
assert.equal(mappingMissing.deployment_observed_at_present, true);
assert.equal(mappingMissing.account_state_reason, "monitoring_agrees");
assert.equal((await projectIbkrRuntimeLifecycle(options("wrong-target"), bindingPayload(), [row(source())])).mapping, "missing");
const mappingDuplicateOptions = options();
mappingDuplicateOptions.ibkr.push({ ...mappingDuplicateOptions.ibkr[0], key: "synthetic-other" });
const mappingDuplicate = await projectIbkrRuntimeLifecycle(mappingDuplicateOptions, bindingPayload(), [row(source())]);
assert.equal(mappingDuplicate.mapping, "duplicate");
assert.equal(mappingDuplicate.deployment_present, true);
assert.equal(mappingDuplicate.deployment_observed_at_present, true);

assert.deepEqual(
  await projectIbkrRuntimeLifecycle(options(), bindingPayload([]), [row(source())]),
  { ok: false, reason: "binding_missing" },
);
assert.deepEqual(
  await projectIbkrRuntimeLifecycle(options(), bindingPayload([factsBinding, { ...factsBinding, account_key: "synthetic-other" }]), [row(source())]),
  { ok: false, reason: "binding_duplicate" },
);
assert.deepEqual(
  await projectIbkrRuntimeLifecycle(options(), bindingPayload([{ ...factsBinding, account_scope: "wrong-scope" }]), [row(source())]),
  { ok: false, reason: "binding_mismatch" },
);

const duplicatedAcrossSources = await projectIbkrRuntimeLifecycle(options(), bindingPayload(), [
  row(source(), "runtime_target_lifecycle_source:source-a"),
  row(source({ generatedAt: new Date(Date.now() - 1000).toISOString() }), "runtime_target_lifecycle_source:source-b"),
]);
assert.equal(duplicatedAcrossSources.mapping, "unique");
assert.equal(duplicatedAcrossSources.raw_source_target_matches, "multiple");
assert.equal(duplicatedAcrossSources.aggregate_target_matches, "0");
assert.equal(duplicatedAcrossSources.source_freshness, "unavailable");
assert.equal(duplicatedAcrossSources.account_state_reason, "absent");

const absentSource = await projectIbkrRuntimeLifecycle(options(), bindingPayload(), []);
assert.equal(absentSource.mapping, "unique");
assert.equal(absentSource.raw_source_target_matches, "0");
assert.equal(absentSource.aggregate_target_matches, "0");
assert.equal(absentSource.deployment_present, false);
assert.equal(absentSource.account_state_reason, "absent");

assert.equal((await projectIbkrRuntimeLifecycle(options(), bindingPayload(), [{ key: sourceKey, value: "{malformed" }])).reason, "source_invalid");
assert.equal((await projectIbkrRuntimeLifecycle(options(), bindingPayload(), [row({ schema_version: "invalid" })])).reason, "source_invalid");
assert.equal((await projectIbkrRuntimeLifecycle(options(), bindingPayload(), [row(source(), "other-key")])).reason, "source_invalid");
assert.equal((await projectIbkrRuntimeLifecycle(options(), bindingPayload(), [
  { key: sourceKey, value: "x".repeat(256 * 1024 + 1) },
])).reason, "source_invalid");

const originalPutGuard = /async put\(\) \{ throw new Error\("read_only"\); \}/;
assert.match(readFileSync(`${root}/web/strategy-switch-console/inspect_ibkr_runtime_lifecycle.mjs`, "utf8"), originalPutGuard);

const env = {
  CLOUDFLARE_API_TOKEN: "synthetic-token",
  CLOUDFLARE_ACCOUNT_ID: "synthetic-account",
  STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID: "synthetic-namespace",
};
const optionsBody = JSON.stringify(options());
const bindingsBody = JSON.stringify(bindingPayload());
const sourceBody = JSON.stringify(source());
const urlCalls = [];
const remoteData = await readRemoteLifecycleData(env, async (url, init) => {
  urlCalls.push(String(url));
  assert.equal(init.headers.Authorization, "Bearer synthetic-token");
  assert.equal(init.method, "GET");
  assert.equal(init.redirect, "error");
  if (String(url).endsWith("/values/account_options")) return new Response(optionsBody, { status: 200 });
  if (String(url).endsWith("/values/account_facts_bindings")) return new Response(bindingsBody, { status: 200 });
  if (String(url).includes("/keys?")) {
    assert.match(String(url), /limit=100/);
    return new Response(JSON.stringify({ success: true, result: [{ name: sourceKey }] }), { status: 200 });
  }
  return new Response(sourceBody, { status: 200 });
});
assert.equal(urlCalls.length, 4);
assert.deepEqual(remoteData.options, options());
assert.deepEqual(remoteData.bindings, bindingPayload());
assert.deepEqual(remoteData.sources, [{ key: sourceKey, value: sourceBody }]);

await assert.rejects(() => readRemoteLifecycleData(env, async () => { throw new Error("private URL and token"); }));
await assert.rejects(() => readRemoteLifecycleData(env, async () => new Response("private response body", { status: 403 })));
let oversizedSourceReads = 0;
await assert.rejects(() => readRemoteLifecycleData(env, async (url) => {
  oversizedSourceReads += 1;
  if (String(url).endsWith("/values/account_options")) return new Response(optionsBody, { status: 200 });
  if (String(url).endsWith("/values/account_facts_bindings")) return new Response(bindingsBody, { status: 200 });
  if (String(url).includes("/keys?")) return new Response(JSON.stringify({ success: true, result: [{ name: sourceKey }] }), { status: 200 });
  return new Response("x", { status: 200, headers: { "content-length": String(256 * 1024 + 1) } });
}), (error) => error.code === "read_failed");
assert.equal(oversizedSourceReads, 4);
let oversizedListReads = 0;
await assert.rejects(() => readRemoteLifecycleData(env, async (url) => {
  oversizedListReads += 1;
  if (String(url).endsWith("/values/account_options")) return new Response(optionsBody, { status: 200 });
  if (String(url).endsWith("/values/account_facts_bindings")) return new Response(bindingsBody, { status: 200 });
  return new Response("x", { status: 200, headers: { "content-length": String(512 * 1024 + 1) } });
}), (error) => error.code === "read_failed");
assert.equal(oversizedListReads, 3);
let paginationReads = 0;
await assert.rejects(() => readRemoteLifecycleData(env, async () => {
  paginationReads += 1;
  return new Response(JSON.stringify({ success: true, result: [], result_info: { cursor: "private-cursor" } }), { status: 200 });
}));
assert.equal(paginationReads, 3);
let timeoutReads = 0;
let clock = 0;
await assert.rejects(() => readRemoteLifecycleData(env, async () => {
  timeoutReads += 1;
  clock += 8 * 60 * 1000 + 1;
  return new Response(optionsBody, { status: 200 });
}, () => clock), (error) => error.code === "timeout");
assert.equal(timeoutReads, 1);
await assert.rejects(() => readRemoteLifecycleData(env, async (url) => {
  if (String(url).endsWith("/values/account_options")) return new Response("private malformed JSON", { status: 200 });
  throw new Error("unexpected request");
}), (error) => error.code === "configuration_invalid");
await assert.rejects(() => readRemoteLifecycleData(env, async (url) => {
  if (String(url).endsWith("/values/account_options")) {
    return new Response("{}", { status: 200, headers: { "content-length": String(5 * 1024 * 1024 + 1) } });
  }
  throw new Error("unexpected request");
}), (error) => error.code === "read_failed");
let redirectRequest;
await assert.rejects(() => readRemoteLifecycleData(env, async (_url, init) => {
  redirectRequest = init;
  if (init.redirect !== "error") throw new Error("redirect not blocked");
  throw new Error("redirect rejected");
}), (error) => error.code === "read_failed");
assert.equal(redirectRequest.redirect, "error");
assert.equal((await projectIbkrRuntimeLifecycle(options(), bindingPayload(), Array(101).fill(row(source())))).reason, "source_limit_exceeded");
await assert.rejects(() => readRemoteLifecycleData({ ...env, CLOUDFLARE_API_TOKEN: "" }, async () => {
  throw new Error("must not call fetch");
}));

async function runMain(fetchImpl, nowFn = Date.now, argv = []) {
  let output = "";
  const status = await main(argv, { env, fetchImpl, now: nowFn, write: (text) => { output += text; } });
  return { status, output };
}
let failureReads = 0;
const readFailureOutput = await runMain(async () => { failureReads += 1; return new Response("private response", { status: 403 }); });
assert.equal(readFailureOutput.status, 1);
assert.equal(failureReads, 1);
assert.equal(readFailureOutput.output, "status=blocked reason=read_failed ttl_source=default_unconfirmed configuration_scope=legacy_kv_unconfirmed freshness_scope=lifecycle\n");
const jsonFailureOutput = await runMain(async () => new Response("private malformed body", { status: 200 }));
assert.equal(jsonFailureOutput.output, "status=blocked reason=configuration_invalid ttl_source=default_unconfirmed configuration_scope=legacy_kv_unconfirmed freshness_scope=lifecycle\n");
let mainClock = 0;
const timeoutFailureOutput = await runMain(async () => {
  mainClock += 8 * 60 * 1000 + 1;
  return new Response(optionsBody, { status: 200 });
}, () => mainClock);
assert.equal(timeoutFailureOutput.output, "status=blocked reason=timeout ttl_source=default_unconfirmed configuration_scope=legacy_kv_unconfirmed freshness_scope=lifecycle\n");
const successOutput = await runMain(async (url, init) => {
  assert.equal(init.method, "GET");
  assert.equal(init.redirect, "error");
  if (String(url).endsWith("/values/account_options")) return new Response(optionsBody, { status: 200 });
  if (String(url).endsWith("/values/account_facts_bindings")) return new Response(bindingsBody, { status: 200 });
  if (String(url).includes("/keys?")) return new Response(JSON.stringify({ success: true, result: [{ name: sourceKey }] }), { status: 200 });
  return new Response(sourceBody, { status: 200 });
});
assert.equal(successOutput.status, 0);
assert.equal(successOutput.output, "status=ok mapping=unique aggregate_target_matches=1 raw_source_target_matches=1 source_freshness=ready deployment_present=true deployment_observed_at_present=true deployment_freshness=ready account_state_reason=monitoring_agrees ttl_source=default_unconfirmed configuration_scope=legacy_kv_unconfirmed freshness_scope=lifecycle\n");
const invalidArgOutput = await runMain(async () => { throw new Error("network must not be called"); }, Date.now, ["private-argument"]);
assert.equal(invalidArgOutput.status, 1);
assert.equal(invalidArgOutput.output, "status=blocked reason=configuration_invalid ttl_source=default_unconfirmed configuration_scope=legacy_kv_unconfirmed freshness_scope=lifecycle\n");
const cliRun = spawnSync(process.execPath, [
  `${root}/web/strategy-switch-console/inspect_ibkr_runtime_lifecycle.mjs`,
], { encoding: "utf8", env: { ...process.env, CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "", STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID: "" } });
assert.equal(cliRun.status, 1);
assert.equal(cliRun.stdout, "status=blocked reason=credentials_missing ttl_source=default_unconfirmed configuration_scope=legacy_kv_unconfirmed freshness_scope=lifecycle\n");
assert.equal(cliRun.stderr, "");

const privateProjection = await projectIbkrRuntimeLifecycle(options(), bindingPayload(), [row(source())]);
const stdoutShape = Object.keys(privateProjection).join(",");
assert.equal(stdoutShape, [
  "ok", "mapping", "aggregate_target_matches", "raw_source_target_matches", "source_freshness",
  "deployment_present", "deployment_observed_at_present", "deployment_freshness", "account_state_reason", "ttl_source", "configuration_scope",
].join(","));
assert.doesNotMatch(JSON.stringify(privateProjection), /synthetic-account-key|synthetic-lifecycle-target|synthetic-source|runtime_target_lifecycle_source:|tqqq_growth_income/);
assert.doesNotMatch(JSON.stringify(privateProjection), /token|secret|amount|balance|url/i);
const stdout = summaryLine(privateProjection);
assert.match(stdout, /mapping=unique aggregate_target_matches=1 raw_source_target_matches=1/);
assert.match(stdout, /ttl_source=default_unconfirmed configuration_scope=legacy_kv_unconfirmed freshness_scope=lifecycle/);
assert.doesNotMatch(stdout, /synthetic-account-key|synthetic-lifecycle-target|synthetic-source|runtime_target_lifecycle_source:|tqqq_growth_income|token|secret|amount|balance|url/i);
assert.match(summaryLine({ ok: false, reason: "binding_missing" }), /reason=binding_missing ttl_source=default_unconfirmed configuration_scope=legacy_kv_unconfirmed freshness_scope=lifecycle/);

assert.match(workflow, /inspect_ibkr_lifecycle:[\s\S]*?default: false/);
assert.match(workflow, /INSPECT_IBKR_LIFECYCLE: \$\{\{ inputs\.inspect_ibkr_lifecycle \}\}/);
assert.match(workflow, /inspection_mode_invalid/);
assert.match(workflow, /node \.\/inspect_ibkr_runtime_lifecycle\.mjs/);
assert.ok(workflow.indexOf("inspect_ibkr_runtime_lifecycle.mjs") < workflow.indexOf('temp_dir="$(mktemp'));
assert.match(workflow, /CLOUDFLARE_WRANGLER_CONFIG_TOML: \$\{\{ !inputs\.inspect_ibkr_lifecycle && secrets\.CLOUDFLARE_WRANGLER_CONFIG_TOML \|\| '' \}\}/);
assert.match(workflow, /!inputs\.inspect_ibkr_lifecycle && !inputs\.initialize_ibkr_bindings && secrets\.IBKR_ACCOUNT_FACTS_SOURCE_ROTATION_JSON/);
assert.match(workflow, /!inputs\.inspect_ibkr_lifecycle && !inputs\.initialize_ibkr_bindings && secrets\.LONGBRIDGE_ACCOUNT_FACTS_SOURCE_ROTATION_JSON/);
assert.match(workflow, /SCHWAB_ACCOUNT_FACTS_BINDING_JSON: \$\{\{ inputs\.platform == 'schwab' && !inputs\.inspect_ibkr_bindings && !inputs\.inspect_ibkr_lifecycle/);

const syncStepStart = workflow.indexOf("- name: Validate and sync exactly one protected binding");
const syncRunStart = workflow.indexOf("run: |", syncStepStart);
const nextStep = workflow.indexOf("\n      - name:", syncRunStart);
const syncShell = workflow.slice(syncRunStart + "run: |".length, nextStep < 0 ? workflow.length : nextStep)
  .replace(/^\n/, "").split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
const setupStepStart = workflow.indexOf("- name: Prepare protected Wrangler credentials");
const setupRunStart = workflow.indexOf("run: |", setupStepStart);
const setupNextStep = workflow.indexOf("\n      - name:", setupRunStart);
const setupShell = workflow.slice(setupRunStart + "run: |".length, setupNextStep < 0 ? workflow.length : setupNextStep)
  .replace(/^\n/, "").split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
const readonlyGateStart = syncShell.indexOf('if [ "$INSPECT_IBKR_LIFECYCLE" = "true" ]; then');
const readonlyGateEnd = syncShell.indexOf("exit 0", readonlyGateStart);
const readonlyGate = syncShell.slice(readonlyGateStart, readonlyGateEnd + "exit 0".length);
assert.ok(readonlyGateStart >= 0 && readonlyGateEnd > readonlyGateStart);
assert.doesNotMatch(readonlyGate, /kv key put/);

const work = mkdtempSync(join(tmpdir(), "qsl-ibkr-lifecycle-workflow-"));
try {
  const bin = join(work, "bin");
  const home = join(work, "home");
  mkdirSync(bin);
  mkdirSync(home);
  const tracePath = join(work, "calls.log");
  const npxPath = join(bin, "npx");
  writeFileSync(npxPath, `#!/bin/sh
printf '%s\\n' npx >> "$MOCK_TRACE"
exit 23
`);
  chmodSync(npxPath, 0o700);
  const mktempPath = join(bin, "mktemp");
  writeFileSync(mktempPath, `#!/bin/sh
printf '%s\\n' mktemp >> "$MOCK_TRACE"
exit 24
`);
  chmodSync(mktempPath, 0o700);
  const nodePath = join(bin, "node");
  writeFileSync(nodePath, `#!/bin/sh
set -eu
[ "$#" -eq 1 ] && [ "$1" = "./inspect_ibkr_runtime_lifecycle.mjs" ] || exit 25
printf '%s\\n' node-lifecycle-no-args >> "$MOCK_TRACE"
printf '%s\\n' 'status=ok mapping=unique aggregate_target_matches=1 raw_source_target_matches=1 source_freshness=ready deployment_present=true deployment_observed_at_present=true deployment_freshness=ready account_state_reason=monitoring_agrees ttl_source=default_unconfirmed configuration_scope=legacy_kv_unconfirmed freshness_scope=lifecycle'
`);
  chmodSync(nodePath, 0o700);
  const commonEnv = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home,
    RUNNER_TEMP: work, BINDING_PLATFORM: "ibkr", INSPECT_IBKR_BINDINGS: "false",
    INSPECT_IBKR_LIFECYCLE: "true", INITIALIZE_IBKR_BINDINGS: "false", APPLY_INITIAL_IBKR_BINDINGS: "false",
    CLOUDFLARE_API_TOKEN: "synthetic-token", CLOUDFLARE_ACCOUNT_ID: "synthetic-account",
    STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID: "synthetic-namespace",
    CLOUDFLARE_WRANGLER_CONFIG_TOML: "private-wrangler-config-marker", MOCK_TRACE: tracePath,
  };
  const setupRun = spawnSync("/bin/bash", ["-e", "-u", "-o", "pipefail", "-c", setupShell], {
    cwd: `${root}/web/strategy-switch-console`, encoding: "utf8", env: commonEnv,
  });
  assert.equal(setupRun.status, 0, setupRun.stderr);
  assert.equal(existsSync(join(home, ".config/.wrangler/config/default.toml")), false);
  for (const invalidEnv of [
    { BINDING_PLATFORM: "schwab" },
    { INSPECT_IBKR_BINDINGS: "true" },
    { INITIALIZE_IBKR_BINDINGS: "true" },
    { APPLY_INITIAL_IBKR_BINDINGS: "true" },
  ]) {
    const blocked = spawnSync("/bin/bash", ["-e", "-u", "-o", "pipefail", "-c", setupShell], {
      cwd: `${root}/web/strategy-switch-console`, encoding: "utf8", env: { ...commonEnv, ...invalidEnv },
    });
    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /status=blocked reason=inspection_mode_invalid/);
  }
  const run = spawnSync("/bin/bash", ["-e", "-u", "-o", "pipefail", "-c", syncShell], {
    cwd: `${root}/web/strategy-switch-console`, encoding: "utf8", env: commonEnv,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readFileSync(tracePath, "utf8").trim().split("\n"), ["node-lifecycle-no-args"]);
  assert.doesNotMatch(run.stdout + run.stderr + setupRun.stdout + setupRun.stderr,
    /synthetic-|primary-live|account_key|target_id|namespace|private-wrangler-config-marker/);
  assert.equal(existsSync(join(work, "kv-put-called")), false);
} finally {
  rmSync(work, { recursive: true, force: true });
}

process.stdout.write("ibkr runtime lifecycle inspection validation passed\n");
