import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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
const rotation = { target_id: primary.target_id,
  previous_source_binding_id: primary.source_binding.id, next_source_binding_id: "b".repeat(64) };
const schwab = { ...primary, platform: "schwab", account_scope: "live",
  account_selector: "schwab-placeholder", target_id: "schwab-primary",
  broker_account_hash: "synthetic-placeholder-hash" };

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
