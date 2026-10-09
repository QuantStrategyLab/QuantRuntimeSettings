import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  prepareFirstradeFactsBinding, applyFirstradeFactsSettings,
  rotateFirstradeFactsBrokerAccount, applyFirstradeSourceBindingRotation,
  firstradeSourceBindingId,
} from "../web/strategy-switch-console/prepare_firstrade_account_facts_binding.mjs";

const source = { service_name: "synthetic-ft-service", serving_source_sha: "a".repeat(40),
  runtime_target: { platform_id: "firstrade", service_name: "synthetic-ft-service",
    deployment_selector: "synthetic-ft-deployment", account_scope: "live", account_selector: ["synthetic-native-ft"] } };
const option = { key: "synthetic-ft-option", label: "synthetic", target_name: "synthetic-ft-target",
  service_name: source.service_name, deployment_selector: source.runtime_target.deployment_selector,
  account_scope: "live", account_selector: "default", supported_domains: ["us_equity"] };
const options = { firstrade: [option] };
const existing = { schema_version: "qsl_account_facts_bindings.v1", bindings: [] };
const binding = prepareFirstradeFactsBinding(source, options, existing);
assert.equal(binding.bindings[0].account_key, option.key);
assert.equal(binding.bindings[0].account_selector, "default");
assert.equal(binding.bindings[0].broker_account_id, "synthetic-native-ft");
assert.match(binding.bindings[0].source_binding.id, /^[a-f0-9]{64}$/);
assert.deepEqual(prepareFirstradeFactsBinding(source, options, binding), binding);
assert.throws(() => prepareFirstradeFactsBinding({ ...source, service_name: "other" }, options, existing));
assert.throws(() => prepareFirstradeFactsBinding(source, { firstrade: [option, { ...option, key: "duplicate" }] }, existing));
assert.throws(() => prepareFirstradeFactsBinding({ ...source, runtime_target: {
  ...source.runtime_target, account_selector: ["first", "second"] } }, options, existing));
assert.throws(() => prepareFirstradeFactsBinding(source, options, { ...binding, bindings: [
  { ...binding.bindings[0], broker_account_id: "other-synthetic-account" }] }));
assert.throws(() => prepareFirstradeFactsBinding(source, { firstrade: [
  { ...option, account_scope: "paper" }] }, existing));
assert.throws(() => prepareFirstradeFactsBinding({ ...source, serving_source_sha: "bad" }, options, existing));
// Names are presentation only; changing them cannot make a different deployment match.
assert.throws(() => prepareFirstradeFactsBinding(source, { firstrade: [
  { ...option, label: "looks right", service_name: "other-service" }] }, existing));

const calls = [];
const settings = new Map();
const variables = new Map();
const command = (args, input) => {
  calls.push({ args, input });
  if (args[0] === "api" && args[1].endsWith("actions/secrets?per_page=100")) {
    return JSON.stringify({ total_count: settings.size,
      secrets: [...settings.keys()].map((name) => ({ name })) });
  }
  if (args[0] === "variable" && args[1] === "list") {
    return JSON.stringify([...variables].map(([name, value]) => ({ name, value })));
  }
  if (args[0] === "api") return JSON.stringify({ name: "FIRSTRADE_ACCOUNT_FACTS_BINDING_JSON" });
  if (args[0] === "secret" && !args.includes("--env")) settings.set(args[2], input);
  if (args[0] === "variable" && args[1] === "set") variables.set(args[2], input);
  return "";
};
assert.deepEqual(applyFirstradeFactsSettings(binding, { env: { GH_TOKEN: "synthetic-gh-token" }, command }),
  { secret_writes: 5, sync_enabled: false });
assert.equal(variables.get("FIRSTRADE_ACCOUNT_FACTS_SYNC_ENABLED"), "false");
assert.equal(settings.get("FIRSTRADE_ACCOUNT_FACTS_SOURCE_BINDING_ID"), binding.bindings[0].source_binding.id);
for (const call of calls) {
  assert.doesNotMatch(call.args.join(" "), /synthetic-native-ft|synthetic-ft-option|synthetic-gh-token/);
}
const mutations = (items) => items.filter(({ args }) => args[1] === "set");
const before = mutations(calls).length;
assert.throws(() => applyFirstradeFactsSettings(binding, { env: { GH_TOKEN: "synthetic-gh-token" }, command }),
  /firstrade_settings_already_present/);
assert.equal(mutations(calls).length, before);
let writes = 0;
assert.throws(() => applyFirstradeFactsSettings(binding, { env: { GH_TOKEN: "synthetic" }, command: (args) => {
  if (args[0] === "api") return JSON.stringify({ total_count: 0, secrets: [] });
  if (args[1] === "list") return JSON.stringify([{ name: "FIRSTRADE_ACCOUNT_FACTS_SYNC_ENABLED", value: "true" }]);
  writes++; return "";
} }), /firstrade_sync_gate_not_disabled/);
assert.equal(writes, 0);
const workflow = readFileSync(new URL("../.github/workflows/sync-schwab-account-facts-binding.yml", import.meta.url), "utf8");
assert.match(workflow, /inputs.platform == 'firstrade' && secrets.FIRSTRADE_ACCOUNT_FACTS_RUNTIME_JSON/);
assert.match(workflow, /inputs.platform == 'firstrade' && secrets.RUNTIME_SETTINGS_GH_TOKEN/);
assert.doesNotMatch(workflow, /vars.FIRSTRADE_ACCOUNT_FACTS_RUNTIME_JSON/);
// Complete the append validation before any private configuration writes.
const dir = mkdtempSync(join(tmpdir(), "synthetic-ft-capacity-"));
try {
  const rows = Array.from({ length: 64 }, (_, i) => ({
    platform: "ibkr", account_key: `synthetic-${i}`, account_scope: "live",
    target_name: `synthetic-${i}`, service_name: "synthetic-ibkr-service",
    deployment_selector: "synthetic-ibkr-deployment", account_selector: `U${String(i).padStart(8, "0")}`,
    target_id: `ibkr-synthetic-${i}`, source_binding: {
      kind: "deployment_runtime_account", id: i.toString(16).padStart(64, "0") },
  }));
  writeFileSync(join(dir, "account-options.json"), JSON.stringify(options));
  writeFileSync(join(dir, "account-facts-bindings.json"), JSON.stringify({ ...existing, bindings: rows }));
  const marker = join(dir, "unexpected-gh-call");
  writeFileSync(join(dir, "gh"), `#!/bin/sh\ntouch '${marker}'\nexit 99\n`, { mode: 0o700 });
  const code = workflow.split("<<'NODE'", 2)[1].split("\n          NODE", 1)[0]
    .split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
  const child = spawnSync(process.execPath, ["--input-type=module", "-", dir], {
    cwd: new URL("../web/strategy-switch-console", import.meta.url), input: code, encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, BINDING_PLATFORM: "firstrade",
      FIRSTRADE_ACCOUNT_FACTS_BINDING_JSON: "", FIRSTRADE_ACCOUNT_FACTS_RUNTIME_JSON: JSON.stringify(source),
      GH_TOKEN: "synthetic-gh-token" },
  });
  assert.equal(child.status, 1);
  assert.match(child.stdout, /updated_bindings_validation_failed/);
  assert.equal(existsSync(marker), false);
  assert.doesNotMatch(child.stdout + child.stderr, /synthetic-native-ft|synthetic-gh-token/);
} finally { rmSync(dir, { recursive: true, force: true }); }

const rotatedBroker = "synthetic-corrected-ft";
const nextId = firstradeSourceBindingId({
  service_name: binding.bindings[0].service_name,
  deployment_selector: binding.bindings[0].deployment_selector,
  account_scope: binding.bindings[0].account_scope,
  broker_account_id: rotatedBroker,
});
const rotated = rotateFirstradeFactsBrokerAccount({
  target_id: binding.bindings[0].target_id,
  previous_source_binding_id: binding.bindings[0].source_binding.id,
  next_source_binding_id: nextId,
  next_broker_account_id: rotatedBroker,
}, binding);
assert.equal(rotated.bindings[0].broker_account_id, rotatedBroker);
assert.equal(rotated.bindings[0].source_binding.id, nextId);
assert.throws(() => rotateFirstradeFactsBrokerAccount({
  target_id: binding.bindings[0].target_id,
  previous_source_binding_id: binding.bindings[0].source_binding.id,
  next_source_binding_id: nextId,
  next_broker_account_id: binding.bindings[0].broker_account_id,
}, binding));
assert.throws(() => rotateFirstradeFactsBrokerAccount({
  target_id: binding.bindings[0].target_id,
  previous_source_binding_id: "0".repeat(64),
  next_source_binding_id: nextId,
  next_broker_account_id: rotatedBroker,
}, binding));
const rotateCalls = [];
const rotateSettings = new Map([["FIRSTRADE_ACCOUNT_FACTS_SOURCE_BINDING_ID", "old"]]);
const rotateCommand = (args, input) => {
  rotateCalls.push({ args, input });
  if (args[0] === "api" && args[1].endsWith("actions/secrets?per_page=100")) {
    return JSON.stringify({ total_count: rotateSettings.size,
      secrets: [...rotateSettings.keys()].map((name) => ({ name })) });
  }
  if (args[0] === "api") return JSON.stringify({ name: "FIRSTRADE_ACCOUNT_FACTS_BINDING_JSON" });
  if (args[0] === "secret" && args[2] === "FIRSTRADE_ACCOUNT_FACTS_SOURCE_BINDING_ID") {
    rotateSettings.set(args[2], input);
  }
  return "";
};
assert.deepEqual(applyFirstradeSourceBindingRotation(rotated, {
  env: { GH_TOKEN: "synthetic-gh-token" }, command: rotateCommand,
}), { secret_writes: 2, rotated: true });
assert.equal(rotateSettings.get("FIRSTRADE_ACCOUNT_FACTS_SOURCE_BINDING_ID"), nextId);
for (const call of rotateCalls) {
  assert.doesNotMatch(call.args.join(" "), /synthetic-corrected-ft|synthetic-native-ft|synthetic-gh-token/);
}

console.log("PASS Firstrade protected source, exact binding, zero-broker preparation and safe configuration writes");
