import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { inspectIbkrAccountFactsConfiguration } from "../web/strategy-switch-console/inspect_ibkr_account_facts_configuration.mjs";

const root = resolve(import.meta.dirname, "..");
const workflow = readFileSync(join(root, ".github/workflows/sync-schwab-account-facts-binding.yml"), "utf8");
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
const rotation = { target_id: primary.target_id,
  previous_source_binding_id: primary.source_binding.id, next_source_binding_id: "b".repeat(64) };
const schwab = { ...primary, platform: "schwab", account_scope: "live",
  account_selector: "schwab-placeholder", target_id: "schwab-primary",
  broker_account_hash: "synthetic-placeholder-hash" };

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
assert.match(workflow, /IBKR_ACCOUNT_FACTS_SOURCE_ROTATION_JSON: \$\{\{ !inputs\.inspect_ibkr_bindings && secrets\.IBKR_ACCOUNT_FACTS_SOURCE_ROTATION_JSON \|\| '' \}\}/);
assert.match(workflow, /inspection_platform_invalid/);
assert.match(inspectorWorkflowGate, /node \.\/inspect_ibkr_account_facts_configuration\.mjs/);
assert.match(inspectorWorkflowGate, /exit 0/);
assert.doesNotMatch(inspectorWorkflowGate, /kv key put/);
assert.ok(workflow.indexOf("node ./inspect_ibkr_account_facts_configuration.mjs") < workflow.indexOf("kv key put account_facts_bindings"));

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
        SCHWAB_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify({ schema_version: schema, bindings: [proposed] }) },
    });
    assert.equal(child.status, test.expected === "blocked" ? 1 : 0, test.name);
    assert.match(child.stdout, new RegExp(`status=${test.expected}`), test.name);
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
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
console.log(`account-facts binding workflow validation: ${cases.length} cases passed`);
