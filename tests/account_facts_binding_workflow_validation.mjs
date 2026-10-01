import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { inspectIbkrAccountFactsConfiguration } from "../web/strategy-switch-console/inspect_ibkr_account_facts_configuration.mjs";
import { prepareIbkrAccountFactsBindings } from "../web/strategy-switch-console/prepare_ibkr_account_facts_bindings.mjs";

const root = resolve(import.meta.dirname, "..");
const workflow = readFileSync(join(root, ".github/workflows/sync-schwab-account-facts-binding.yml"), "utf8");
const setupStepStart = workflow.indexOf("- name: Prepare protected Wrangler credentials");
const setupRunStart = workflow.indexOf("run: |", setupStepStart);
const syncStepAfterSetup = workflow.indexOf("\n      - name:", setupRunStart);
const setupStepEnd = syncStepAfterSetup < 0 ? workflow.length : syncStepAfterSetup;
const setupShell = workflow.slice(setupRunStart + "run: |".length, setupStepEnd)
  .replace(/^\n/, "")
  .split("\n")
  .map((line) => line.startsWith("          ") ? line.slice(10) : line)
  .join("\n");
const code = workflow.split("<<'NODE'", 2)[1].split("\n          NODE", 1)[0]
  .split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
const schema = "qsl_account_facts_bindings.v1";
const primary = {
  platform: "ibkr", account_key: "primary", account_scope: "live-primary",
  target_name: "primary", service_name: "ibkr-placeholder-service",
  deployment_selector: "ibkr-placeholder-service", account_selector: "U00000001",
  target_id: "ibkr-primary", source_binding: { kind: "deployment_runtime_account", id: "a".repeat(64) },
};
const secondary = { ...primary, account_key: "secondary", target_name: "secondary",
  account_scope: "live-secondary", account_selector: "U00000002", target_id: "ibkr-secondary",
  source_binding: { kind: "deployment_runtime_account", id: "c".repeat(64) } };
const tertiary = { ...primary, account_key: "tertiary", target_name: "tertiary",
  account_scope: "live-tertiary", account_selector: "U00000003", target_id: "ibkr-tertiary",
  source_binding: { kind: "deployment_runtime_account", id: "d".repeat(64) } };
const fourth = { ...primary, account_key: "fourth", target_name: "fourth",
  account_scope: "live-fourth", account_selector: "U00000004", target_id: "ibkr-fourth",
  source_binding: { kind: "deployment_runtime_account", id: "e".repeat(64) } };
const rotation = { target_id: primary.target_id,
  previous_source_binding_id: primary.source_binding.id, next_source_binding_id: "b".repeat(64) };
const schwab = { ...primary, platform: "schwab", account_scope: "live",
  account_selector: "schwab-placeholder", target_id: "schwab-primary",
  broker_account_hash: "synthetic-placeholder-hash" };
const longbridgeSg = { platform: "longbridge", account_key: "sg", account_scope: "sg",
  target_name: "longbridge-sg-placeholder", service_name: "longbridge-service-placeholder",
  deployment_selector: "longbridge-sg-placeholder", account_selector: "sg-placeholder",
  target_id: "sg", source_binding: { kind: "deployment_scope_token_version", id: "1".repeat(64) } };
const longbridgeRotation = { target_id: "sg", previous_source_binding_id: longbridgeSg.source_binding.id,
  next_source_binding_id: "2".repeat(64) };

const optionFor = (binding) => ({
  key: binding.account_key,
  label: "synthetic option",
  target_name: binding.target_name,
  service_name: binding.service_name,
  deployment_selector: binding.deployment_selector,
  account_selector: binding.account_selector,
  account_scope: binding.account_scope,
  supported_domains: ["us_equity"],
});
const inspectionRows = [primary, secondary, tertiary];
const initializationOptions = { ibkr: [primary, secondary, tertiary, fourth].map(optionFor) };
const initializationExisting = { schema_version: schema, bindings: [primary, schwab] };
const initializationRequests = [secondary, tertiary, fourth].map((binding) => ({
  account_scope: binding.account_scope,
  account_selector: binding.account_selector,
  service_name: binding.service_name,
  deployment_selector: binding.deployment_selector,
  target_id: binding.target_id,
  source_binding: binding.source_binding,
}));
const initializationPreview = prepareIbkrAccountFactsBindings(
  initializationOptions, initializationExisting, initializationRequests,
);
assert.equal(initializationPreview.ok, true);
assert.equal(initializationPreview.status, "preview");
assert.deepEqual(initializationPreview.counts, {
  request_count: 3, matched_target_count: 3, existing_binding_count: 2, added_count: 3,
});
assert.deepEqual(initializationPreview.proposed.bindings.slice(0, 2), [primary, schwab]);
assert.deepEqual(initializationPreview.proposed.bindings.slice(2).map((item) => item.account_key), [
  "secondary", "tertiary", "fourth",
]);
assert.doesNotMatch(JSON.stringify({
  ok: initializationPreview.ok, reason: initializationPreview.reason,
  status: initializationPreview.status, counts: initializationPreview.counts,
}), /U0000000[1-4]|ibkr-(primary|secondary|tertiary|fourth)|[a-e]{64}/);
const missingInitializationIdentity = structuredClone(initializationOptions);
delete missingInitializationIdentity.ibkr[1].service_name;
assert.equal(prepareIbkrAccountFactsBindings(
  missingInitializationIdentity, initializationExisting, initializationRequests,
).reason, "target_match_invalid");
const duplicateInitializationIdentity = structuredClone(initializationOptions);
duplicateInitializationIdentity.ibkr.push({ ...duplicateInitializationIdentity.ibkr[3] });
assert.equal(prepareIbkrAccountFactsBindings(
  duplicateInitializationIdentity, initializationExisting, initializationRequests,
).reason, "target_match_invalid");
const conflictingInitializationExisting = {
  schema_version: schema,
  bindings: [primary, schwab, { ...secondary, target_id: "other-target" }],
};
assert.equal(prepareIbkrAccountFactsBindings(
  initializationOptions, conflictingInitializationExisting, initializationRequests,
).reason, "existing_binding_conflict");
assert.equal(prepareIbkrAccountFactsBindings(
  initializationOptions,
  { schema_version: schema, bindings: [primary, schwab, { ...secondary, account_key: "historic", target_id: "other-target" }] },
  initializationRequests,
).reason, "existing_binding_conflict");
assert.equal(prepareIbkrAccountFactsBindings(
  initializationOptions,
  { schema_version: schema, bindings: [primary, schwab, {
    ...secondary, account_key: "historic",
    source_binding: { ...secondary.source_binding, id: "f".repeat(64) },
  }] },
  initializationRequests,
).reason, "existing_binding_conflict");
const duplicateRequestedSelectorOptions = structuredClone(initializationOptions);
duplicateRequestedSelectorOptions.ibkr[3].account_selector = "U00000003";
const duplicateRequestedSelectorRequests = initializationRequests.map((item) => ({ ...item }));
duplicateRequestedSelectorRequests[2].account_selector = "U00000003";
assert.equal(prepareIbkrAccountFactsBindings(
  duplicateRequestedSelectorOptions, initializationExisting, duplicateRequestedSelectorRequests,
).reason, "existing_binding_conflict");
const existingSelectorConflict = {
  schema_version: schema,
  bindings: [primary, schwab, {
    ...secondary, account_key: "historic", target_id: "other-target",
    source_binding: { ...secondary.source_binding, id: "f".repeat(64) },
  }],
};
assert.equal(prepareIbkrAccountFactsBindings(
  initializationOptions, existingSelectorConflict, initializationRequests,
).reason, "existing_binding_conflict");
const completeInspection = inspectIbkrAccountFactsConfiguration(
  { ibkr: inspectionRows.map(optionFor) },
  { schema_version: schema, bindings: inspectionRows },
);
assert.equal(completeInspection.ok, true);
assert.equal(completeInspection.reason, "none");
assert.deepEqual(completeInspection.counts, {
  option_count: 3,
  binding_count: 3,
  matched_count: 3,
  unmatched_option_count: 0,
  unmatched_binding_count: 0,
  identity_complete_count: 3,
  identity_incomplete_count: 0,
});
assert.doesNotMatch(JSON.stringify(completeInspection), /U0000000[1-3]|ibkr-(primary|secondary|tertiary)|[a-d]{64}/);

const missingBindingInspection = inspectIbkrAccountFactsConfiguration(
  { ibkr: inspectionRows.map(optionFor) },
  { schema_version: schema, bindings: inspectionRows.slice(0, 2) },
);
assert.equal(missingBindingInspection.ok, false);
assert.equal(missingBindingInspection.reason, "option_binding_mismatch");
assert.equal(missingBindingInspection.counts.unmatched_option_count, 1);
const mismatchedIdentityInspection = inspectIbkrAccountFactsConfiguration(
  { ibkr: [optionFor(primary), { ...optionFor(secondary), service_name: "other-synthetic-service" }, optionFor(tertiary)] },
  { schema_version: schema, bindings: inspectionRows },
);
assert.equal(mismatchedIdentityInspection.ok, false);
assert.equal(mismatchedIdentityInspection.counts.matched_count, 2);
const missingPhysicalIdentityInspection = inspectIbkrAccountFactsConfiguration(
  { ibkr: [optionFor(primary), Object.fromEntries(Object.entries(optionFor(secondary)).filter(([key]) => key !== "service_name")), optionFor(tertiary)] },
  { schema_version: schema, bindings: inspectionRows },
);
assert.equal(missingPhysicalIdentityInspection.ok, false);
assert.equal(missingPhysicalIdentityInspection.reason, "identity_incomplete");
assert.equal(missingPhysicalIdentityInspection.counts.matched_count, 2);
assert.equal(missingPhysicalIdentityInspection.counts.identity_complete_count, 2);
assert.equal(missingPhysicalIdentityInspection.counts.identity_incomplete_count, 1);
assert.equal(missingPhysicalIdentityInspection.counts.unmatched_option_count, 1);
const duplicateOptionInspection = inspectIbkrAccountFactsConfiguration(
  { ibkr: [optionFor(primary), optionFor(primary), optionFor(tertiary)] },
  { schema_version: schema, bindings: [primary, tertiary] },
);
assert.equal(duplicateOptionInspection.ok, false);
assert.equal(duplicateOptionInspection.counts.unmatched_option_count, 2);
const invalidInspection = inspectIbkrAccountFactsConfiguration(
  { ibkr: "invalid" },
  { schema_version: schema, bindings: inspectionRows },
);
assert.equal(invalidInspection.ok, false);
assert.equal(invalidInspection.reason, "configuration_invalid");

const inspectionDir = mkdtempSync(join(tmpdir(), "qsl-ibkr-inspection-synthetic-"));
try {
  const optionsPath = join(inspectionDir, "options.json");
  const bindingsPath = join(inspectionDir, "bindings.json");
  writeFileSync(optionsPath, JSON.stringify({ ibkr: inspectionRows.map(optionFor) }), { mode: 0o600 });
  writeFileSync(bindingsPath, JSON.stringify({ schema_version: schema, bindings: inspectionRows }), { mode: 0o600 });
  const inspectionRun = spawnSync(process.execPath, [
    "./inspect_ibkr_account_facts_configuration.mjs", optionsPath, bindingsPath,
  ], { cwd: join(root, "web/strategy-switch-console"), encoding: "utf8" });
  assert.equal(inspectionRun.status, 0);
  assert.equal(
    inspectionRun.stdout.trim(),
    "status=ok reason=none option_count=3 binding_count=3 matched_count=3 unmatched_option_count=0 unmatched_binding_count=0 identity_complete_count=3 identity_incomplete_count=0",
  );
  assert.doesNotMatch(inspectionRun.stdout + inspectionRun.stderr, /U0000000[1-3]|ibkr-(primary|secondary|tertiary)|[a-d]{64}/);
  assert.equal(existsSync(join(inspectionDir, "next-bindings.json")), false);
} finally {
  rmSync(inspectionDir, { recursive: true, force: true });
}

const inspectorWorkflowGate = workflow.slice(
  workflow.indexOf('if [ "$INSPECT_IBKR_BINDINGS" = "true" ]; then', workflow.indexOf("account_facts_bindings_read_failed")),
  workflow.indexOf("if ! node --input-type=module -", workflow.indexOf("account_facts_bindings_read_failed")),
);
assert.match(workflow, /inspect_ibkr_bindings:[\s\S]*?default: false/);
assert.match(workflow, /IBKR_ACCOUNT_FACTS_SOURCE_ROTATION_JSON: \$\{\{ inputs\.platform == 'ibkr' && !inputs\.inspect_ibkr_bindings && !inputs\.initialize_ibkr_bindings && secrets\.IBKR_ACCOUNT_FACTS_SOURCE_ROTATION_JSON \|\| '' \}\}/);
assert.match(workflow, /LONGBRIDGE_ACCOUNT_FACTS_SOURCE_ROTATION_JSON: \$\{\{ inputs\.platform == 'longbridge' && !inputs\.inspect_ibkr_bindings && !inputs\.initialize_ibkr_bindings && secrets\.LONGBRIDGE_ACCOUNT_FACTS_SOURCE_ROTATION_JSON \|\| '' \}\}/);
assert.match(workflow, /SCHWAB_ACCOUNT_FACTS_BINDING_JSON: \$\{\{ inputs\.platform == 'schwab' && !inputs\.inspect_ibkr_bindings/);
assert.match(workflow, /- longbridge/);
assert.match(workflow, /inspection_platform_invalid/);
assert.match(inspectorWorkflowGate, /node \.\/inspect_ibkr_account_facts_configuration\.mjs/);
assert.match(inspectorWorkflowGate, /exit 0/);
assert.doesNotMatch(inspectorWorkflowGate, /kv key put/);
const legacyWriterStart = workflow.indexOf("if ! node --input-type=module -");
assert.ok(workflow.indexOf("node ./inspect_ibkr_account_facts_configuration.mjs") < legacyWriterStart);
assert.ok(legacyWriterStart < workflow.indexOf("kv key put account_facts_bindings", legacyWriterStart));

const syncStepStart = workflow.indexOf("- name: Validate and sync exactly one protected binding");
const syncRunStart = workflow.indexOf("run: |", syncStepStart);
const nextSyncStep = workflow.indexOf("\n      - name:", syncRunStart);
const syncStepEnd = nextSyncStep < 0 ? workflow.length : nextSyncStep;
assert.ok(syncStepStart >= 0 && syncRunStart > syncStepStart && syncStepEnd > syncRunStart);
const syncShell = workflow.slice(syncRunStart + "run: |".length, syncStepEnd)
  .replace(/^\n/, "")
  .split("\n")
  .map((line) => line.startsWith("          ") ? line.slice(10) : line)
  .join("\n");
const syncTemp = mkdtempSync(join(tmpdir(), "qsl-ibkr-readonly-workflow-"));
try {
  const binDir = join(syncTemp, "bin");
  mkdirSync(binDir);
  const mockOptionsPath = join(syncTemp, "options.json");
  const mockBindingsPath = join(syncTemp, "bindings.json");
  const tracePath = join(syncTemp, "wrangler-calls.log");
  const writeMarkerPath = join(syncTemp, "kv-put-called");
  writeFileSync(mockOptionsPath, JSON.stringify({ ibkr: inspectionRows.map(optionFor) }), { mode: 0o600 });
  writeFileSync(mockBindingsPath, JSON.stringify({ schema_version: schema, bindings: inspectionRows }), { mode: 0o600 });
  const mockNpxPath = join(binDir, "npx");
  writeFileSync(mockNpxPath, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$MOCK_WRANGLER_TRACE"
case "$*" in
  *"kv key get account_options"*) cat "$MOCK_ACCOUNT_OPTIONS" ;;
  *"kv key get account_facts_bindings"*) cat "$MOCK_ACCOUNT_FACTS_BINDINGS" ;;
  *"kv key put"*) : > "$MOCK_KV_PUT_MARKER"; exit 23 ;;
  *) exit 24 ;;
esac
`);
  chmodSync(mockNpxPath, 0o700);
  const syncRun = spawnSync("/bin/bash", ["-e", "-u", "-o", "pipefail", "-c", syncShell], {
    cwd: join(root, "web/strategy-switch-console"),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      RUNNER_TEMP: syncTemp,
      BINDING_PLATFORM: "ibkr",
      INSPECT_IBKR_BINDINGS: "true",
      INITIALIZE_IBKR_BINDINGS: "false",
      APPLY_INITIAL_IBKR_BINDINGS: "false",
      STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID: "synthetic-namespace",
      MOCK_ACCOUNT_OPTIONS: mockOptionsPath,
      MOCK_ACCOUNT_FACTS_BINDINGS: mockBindingsPath,
      MOCK_WRANGLER_TRACE: tracePath,
      MOCK_KV_PUT_MARKER: writeMarkerPath,
    },
  });
  assert.equal(syncRun.status, 0, syncRun.stderr);
  assert.match(syncRun.stdout, /status=ok reason=none option_count=3 binding_count=3 matched_count=3/);
  const calls = readFileSync(tracePath, "utf8").trim().split("\n");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.includes("kv key get")));
  assert.doesNotMatch(calls.join("\n"), /kv key put|U0000000[1-3]/);
  assert.equal(existsSync(writeMarkerPath), false);
  assert.doesNotMatch(syncRun.stdout + syncRun.stderr, /U0000000[1-3]|ibkr-(primary|secondary|tertiary)|[a-d]{64}/);
} finally {
  rmSync(syncTemp, { recursive: true, force: true });
}

assert.match(workflow, /initialize_ibkr_bindings:[\s\S]*?default: false/);
assert.match(workflow, /apply_initial_ibkr_bindings:[\s\S]*?default: false/);
assert.match(workflow, /IBKR_ACCOUNT_FACTS_INITIAL_BINDINGS_JSON: \$\{\{ inputs\.platform == 'ibkr' && inputs\.initialize_ibkr_bindings && secrets\.IBKR_ACCOUNT_FACTS_INITIAL_BINDINGS_JSON \|\| '' \}\}/);
assert.match(workflow, /initialization_mode_required/);
assert.match(workflow, /initialization_mode_invalid/);
assert.ok(workflow.indexOf("node ./prepare_ibkr_account_facts_bindings.mjs")
  < workflow.indexOf("kv key put account_facts_bindings", workflow.indexOf("if [ \"$INITIALIZE_IBKR_BINDINGS\" = \"true\" ]; then")));

for (const invalidMode of [
  { platform: "ibkr", inspect: "true", initialize: "true", apply: "false", reason: "initialization_mode_invalid" },
  { platform: "ibkr", inspect: "false", initialize: "false", apply: "true", reason: "initialization_mode_required" },
  { platform: "schwab", inspect: "false", initialize: "true", apply: "false", reason: "initialization_mode_invalid" },
]) {
  const gated = spawnSync("/bin/bash", ["-e", "-u", "-o", "pipefail", "-c", setupShell], {
    cwd: join(root, "web/strategy-switch-console"),
    encoding: "utf8",
    env: {
      ...process.env,
      INSPECT_IBKR_BINDINGS: invalidMode.inspect,
      INITIALIZE_IBKR_BINDINGS: invalidMode.initialize,
      APPLY_INITIAL_IBKR_BINDINGS: invalidMode.apply,
      BINDING_PLATFORM: invalidMode.platform,
      CLOUDFLARE_API_TOKEN: "synthetic-token",
      STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID: "synthetic-namespace",
    },
  });
  assert.equal(gated.status, 1, invalidMode.reason);
  assert.match(gated.stdout, new RegExp(`status=blocked reason=${invalidMode.reason}`));
}

const runInitializationWorkflow = ({ options, bindings, requests, apply = false, readback = "ok" }) => {
  const temp = mkdtempSync(join(tmpdir(), "qsl-ibkr-initial-binding-shell-"));
  try {
    const binDir = join(temp, "bin");
    mkdirSync(binDir);
    const optionsPath = join(temp, "options.json");
    const originalBindingsPath = join(temp, "original-bindings.json");
    const storePath = join(temp, "kv-store.json");
    const tracePath = join(temp, "calls.log");
    const putMarkerPath = join(temp, "put-called");
    writeFileSync(optionsPath, JSON.stringify(options), { mode: 0o600 });
    writeFileSync(originalBindingsPath, JSON.stringify(bindings), { mode: 0o600 });
    writeFileSync(storePath, JSON.stringify(bindings), { mode: 0o600 });
    const mockNpxPath = join(binDir, "npx");
    writeFileSync(mockNpxPath, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$MOCK_WRANGLER_TRACE"
case "$*" in
  *"kv key get account_options"*) cat "$MOCK_ACCOUNT_OPTIONS" ;;
  *"kv key get account_facts_bindings"*)
    if [ -f "$MOCK_KV_PUT_MARKER" ] && [ "$MOCK_READBACK_MODE" = "fail" ]; then exit 28; fi
    cat "$MOCK_KV_STORE" ;;
  *"kv key put account_facts_bindings"*)
    : > "$MOCK_KV_PUT_MARKER"
    path=""
    take_path=0
    for arg in "$@"; do
      if [ "$take_path" = "1" ]; then path="$arg"; take_path=0
      elif [ "$arg" = "--path" ]; then take_path=1
      fi
    done
    [ -n "$path" ] || exit 29
    cp "$path" "$MOCK_KV_STORE" ;;
  *) exit 30 ;;
esac
`);
    chmodSync(mockNpxPath, 0o700);
    const child = spawnSync("/bin/bash", ["-e", "-u", "-o", "pipefail", "-c", syncShell], {
      cwd: join(root, "web/strategy-switch-console"),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        RUNNER_TEMP: temp,
        BINDING_PLATFORM: "ibkr",
        INSPECT_IBKR_BINDINGS: "false",
        INITIALIZE_IBKR_BINDINGS: "true",
        APPLY_INITIAL_IBKR_BINDINGS: String(apply),
        IBKR_ACCOUNT_FACTS_INITIAL_BINDINGS_JSON: JSON.stringify(requests),
        STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID: "synthetic-namespace",
        MOCK_ACCOUNT_OPTIONS: optionsPath,
        MOCK_ACCOUNT_FACTS_BINDINGS: originalBindingsPath,
        MOCK_KV_STORE: storePath,
        MOCK_WRANGLER_TRACE: tracePath,
        MOCK_KV_PUT_MARKER: putMarkerPath,
        MOCK_READBACK_MODE: readback,
      },
    });
    const calls = existsSync(tracePath) ? readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean) : [];
    return {
      status: child.status,
      stdout: child.stdout,
      stderr: child.stderr,
      calls,
      putCount: calls.filter((call) => call.includes("kv key put account_facts_bindings")).length,
      store: JSON.parse(readFileSync(storePath, "utf8")),
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
};

const previewWorkflow = runInitializationWorkflow({
  options: initializationOptions, bindings: initializationExisting, requests: initializationRequests,
});
assert.equal(previewWorkflow.status, 0, previewWorkflow.stderr + previewWorkflow.stdout);
assert.match(previewWorkflow.stdout, /status=preview reason=none request_count=3 matched_target_count=3/);
assert.equal(previewWorkflow.putCount, 0);
assert.equal(previewWorkflow.calls.length, 2);

const blockedInitializationCases = [
  {
    options: { ibkr: initializationOptions.ibkr.map((option) => ({ ...option })) },
    mutate(options) { delete options.ibkr[1].service_name; },
    requests: initializationRequests,
    reason: "target_match_invalid",
  },
  {
    options: structuredClone(initializationOptions),
    mutate(options) { options.ibkr.push({ ...options.ibkr[3] }); },
    requests: initializationRequests,
    reason: "target_match_invalid",
  },
  {
    options: initializationOptions,
    bindings: conflictingInitializationExisting,
    requests: initializationRequests,
    reason: "existing_binding_conflict",
  },
  {
    options: duplicateRequestedSelectorOptions,
    bindings: initializationExisting,
    requests: duplicateRequestedSelectorRequests,
    reason: "existing_binding_conflict",
  },
  {
    options: initializationOptions,
    bindings: existingSelectorConflict,
    requests: initializationRequests,
    reason: "existing_binding_conflict",
  },
];
for (const test of blockedInitializationCases) {
  const options = structuredClone(test.options);
  test.mutate?.(options);
  const result = runInitializationWorkflow({
    options,
    bindings: test.bindings || initializationExisting,
    requests: test.requests,
  });
  assert.equal(result.status, 1, test.reason);
  assert.match(result.stdout, new RegExp(`status=blocked reason=${test.reason}`));
  assert.equal(result.putCount, 0, test.reason);
  assert.equal(result.calls.length, 2, test.reason);
  assert.doesNotMatch(result.stdout + result.stderr, /U0000000[1-4]|ibkr-(primary|secondary|tertiary|fourth)|[a-e]{64}/);
}

const appliedInitialization = runInitializationWorkflow({
  options: initializationOptions, bindings: initializationExisting, requests: initializationRequests, apply: true,
});
assert.equal(appliedInitialization.status, 0, appliedInitialization.stderr);
assert.match(appliedInitialization.stdout, /status=prepared reason=none request_count=3 matched_target_count=3/);
assert.match(appliedInitialization.stdout, /status=applied/);
assert.equal(appliedInitialization.putCount, 1);
assert.equal(appliedInitialization.calls.length, 4);
assert.deepEqual(appliedInitialization.store.bindings.slice(0, 2), [primary, schwab]);
assert.deepEqual(appliedInitialization.store.bindings.slice(2).map((item) => item.account_key), [
  "secondary", "tertiary", "fourth",
]);
assert.doesNotMatch(appliedInitialization.stdout + appliedInitialization.stderr, /U0000000[1-4]|ibkr-(primary|secondary|tertiary|fourth)|[a-e]{64}/);

const failedReadbackInitialization = runInitializationWorkflow({
  options: initializationOptions, bindings: initializationExisting, requests: initializationRequests,
  apply: true, readback: "fail",
});
assert.equal(failedReadbackInitialization.status, 1);
assert.match(failedReadbackInitialization.stdout, /status=blocked reason=binding_readback_failed/);
assert.equal(failedReadbackInitialization.putCount, 1);
assert.equal(failedReadbackInitialization.calls.length, 4);

const cases = [
  { name: "rotate", rows: [primary, secondary], rotation, expected: "prepared" },
  { name: "wrong_previous", rows: [primary, secondary],
    rotation: { ...rotation, previous_source_binding_id: "d".repeat(64) }, expected: "blocked" },
  { name: "unknown_target", rows: [primary, secondary],
    rotation: { ...rotation, target_id: "ibkr-new-placeholder" }, expected: "blocked" },
  { name: "identity_injection", rows: [primary, secondary],
    rotation: { ...rotation, account_selector: "U00000003" }, expected: "blocked" },
  { name: "invalid_next", rows: [primary, secondary],
    rotation: { ...rotation, next_source_binding_id: "invalid" }, expected: "blocked" },
  { name: "unchanged", rows: [{ ...primary, source_binding: {
    ...primary.source_binding, id: rotation.next_source_binding_id } }, secondary],
    rotation, expected: "unchanged" },
  { name: "schwab_append", platform: "schwab", rows: [primary, secondary], proposed: schwab, expected: "prepared" },
  { name: "schwab_unchanged", platform: "schwab", rows: [primary, schwab], proposed: schwab, expected: "unchanged" },
  { name: "schwab_conflict", platform: "schwab", rows: [primary, schwab],
    proposed: { ...schwab, source_binding: { ...schwab.source_binding, id: "b".repeat(64) } }, expected: "blocked" },
  { name: "longbridge_sg_rotate", platform: "longbridge", rows: [primary, longbridgeSg, secondary],
    proposed: longbridgeSg, rotation: longbridgeRotation, expected: "prepared" },
  { name: "longbridge_wrong_scope", platform: "longbridge", rows: [primary,
    { ...longbridgeSg, account_scope: "SG" }, secondary], proposed: longbridgeSg,
    rotation: longbridgeRotation, expected: "blocked" },
  { name: "longbridge_wrong_source_kind", platform: "longbridge", rows: [primary,
    { ...longbridgeSg, source_binding: { ...longbridgeSg.source_binding, kind: "deployment_runtime_account" } }, secondary],
    proposed: longbridgeSg, rotation: longbridgeRotation, expected: "blocked" },
  { name: "longbridge_hk_or_paper_target", platform: "longbridge", rows: [primary, longbridgeSg, secondary],
    proposed: longbridgeSg, rotation: { ...longbridgeRotation, target_id: "hk" }, expected: "blocked" },
  { name: "longbridge_wrong_previous", platform: "longbridge", rows: [primary, longbridgeSg, secondary],
    proposed: longbridgeSg, rotation: { ...longbridgeRotation, previous_source_binding_id: "3".repeat(64) }, expected: "blocked" },
  { name: "longbridge_stale_after_rotation", platform: "longbridge", rows: [primary,
    { ...longbridgeSg, source_binding: { ...longbridgeSg.source_binding,
      id: longbridgeRotation.next_source_binding_id } }, secondary], proposed: longbridgeSg,
    rotation: longbridgeRotation, expected: "blocked" },
  { name: "longbridge_same_hash", platform: "longbridge", rows: [primary, longbridgeSg, secondary],
    proposed: longbridgeSg, rotation: { ...longbridgeRotation,
      next_source_binding_id: longbridgeRotation.previous_source_binding_id }, expected: "blocked" },
  { name: "longbridge_extra_rotation_field", platform: "longbridge", rows: [primary, longbridgeSg, secondary],
    proposed: longbridgeSg, rotation: { ...longbridgeRotation, account_selector: "injected-placeholder" },
    expected: "blocked" },
  { name: "longbridge_identity_changed", platform: "longbridge", rows: [primary, longbridgeSg, secondary],
    proposed: { ...longbridgeSg, service_name: "other-service-placeholder" },
    rotation: longbridgeRotation, expected: "blocked" },
  { name: "longbridge_duplicate_binding", platform: "longbridge", rows: [primary, longbridgeSg,
    { ...longbridgeSg, account_key: "sg-copy" }, secondary], proposed: longbridgeSg,
    rotation: longbridgeRotation, expected: "blocked" },
];

for (const test of cases) {
  const temp = mkdtempSync(join(tmpdir(), "qsl-binding-synthetic-"));
  try {
    const platform = test.platform || "ibkr";
    const proposed = test.proposed || primary;
    writeFileSync(join(temp, "account-options.json"), JSON.stringify({ [platform]: [{ ...proposed, key: proposed.account_key }] }), { mode: 0o600 });
    writeFileSync(join(temp, "account-facts-bindings.json"), JSON.stringify({ schema_version: schema, bindings: test.rows }), { mode: 0o600 });
    const child = spawnSync(process.execPath, ["--input-type=module", "-", temp], {
      cwd: join(root, "web/strategy-switch-console"), input: code, encoding: "utf8",
      env: { ...process.env, BINDING_PLATFORM: platform,
        IBKR_ACCOUNT_FACTS_SOURCE_ROTATION_JSON: JSON.stringify(test.rotation || {}),
        LONGBRIDGE_ACCOUNT_FACTS_SOURCE_ROTATION_JSON: JSON.stringify(test.rotation || {}),
        SCHWAB_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify({ schema_version: schema, bindings: [proposed] }) },
    });
    assert.equal(child.status, test.expected === "blocked" ? 1 : 0, test.name);
    assert.match(child.stdout, new RegExp(`status=${test.expected}`), test.name);
    if (platform === "longbridge") {
      assert.doesNotMatch(child.stdout + child.stderr,
        /longbridge-sg-placeholder|longbridge-service-placeholder|1{64}|2{64}/, test.name);
    }
    const output = join(temp, "next-bindings.json");
    assert.equal(existsSync(output), test.expected === "prepared", test.name);
    if (test.name === "rotate") {
      const next = JSON.parse(readFileSync(output, "utf8"));
      assert.deepEqual(next.bindings, [{ ...primary, source_binding: {
        ...primary.source_binding, id: rotation.next_source_binding_id } }, secondary]);
    }
    if (test.name === "schwab_append") {
      assert.deepEqual(JSON.parse(readFileSync(output, "utf8")).bindings, [primary, secondary, schwab]);
    }
    if (test.name === "longbridge_sg_rotate") {
      const next = JSON.parse(readFileSync(output, "utf8"));
      assert.deepEqual(next.bindings, [primary,
        { ...longbridgeSg, source_binding: { ...longbridgeSg.source_binding,
          id: longbridgeRotation.next_source_binding_id } }, secondary]);
      assert.deepEqual(next.bindings.filter((item) => item !== next.bindings[1]), [primary, secondary]);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
console.log(`account-facts binding workflow validation: ${cases.length} rotation cases plus initial-binding preview/apply and rejection matrix passed`);
