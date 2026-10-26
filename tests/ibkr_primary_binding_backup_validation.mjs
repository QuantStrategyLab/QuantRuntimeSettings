import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { backupContext, backupPrimaryBinding, main, prepareBackup } from "../web/strategy-switch-console/backup_ibkr_primary_binding.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const PRIVATE = "private-marker-never-public";
const binding = { platform: "ibkr", account_key: "synthetic-primary", account_scope: "live-primary",
  target_name: PRIVATE, service_name: PRIVATE, deployment_selector: PRIVATE, account_selector: "U00000007",
  target_id: "synthetic-primary-target", source_binding: { kind: "deployment_runtime_account", id: "a".repeat(64) } };
const other = { ...binding, account_key: "synthetic-other", target_id: "synthetic-other-target",
  source_binding: { ...binding.source_binding, id: "b".repeat(64) } };
const hashes = { target_id_sha256: sha(binding.target_id), configured_source_binding_id_sha256: sha(binding.source_binding.id),
  candidate_source_binding_id_sha256: sha("c".repeat(64)) };
const env = { BINDING_PLATFORM: "ibkr", INPUT_EVENT_NAME: "workflow_dispatch", INPUT_REF: "refs/heads/main",
  BACKUP_PRIMARY_IBKR_BINDING: "true", IBKR_PRIMARY_BACKUP_HASHES: JSON.stringify(hashes),
  CLOUDFLARE_API_TOKEN: PRIVATE + "-credential", CLOUDFLARE_ACCOUNT_ID: "1".repeat(32),
  STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID: "2".repeat(32) };
const raw = () => ({ schema_version: "qsl_account_facts_bindings.v1", bindings: [structuredClone(binding), structuredClone(other)] });

function remote({ outcome = "success", readback = "exact", changed = false, existing = false } = {}) {
  let stored = existing ? prepareBackup(raw(), hashes).body : null;
  let reads = 0;
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    assert.equal(options.headers.Authorization, `Bearer ${env.CLOUDFLARE_API_TOKEN}`);
    assert.equal(options.redirect, "error");
    assert.ok(url.startsWith("https://api.cloudflare.com/client/v4/"));
    if (url.endsWith("/account_facts_bindings")) {
      assert.equal(options.method, "GET");
      const payload = raw();
      if (++reads > 1 && changed) payload.bindings[0].source_binding.id = "d".repeat(64);
      return new Response(JSON.stringify(payload));
    }
    assert.ok(url.includes("/account_facts_primary_backup%3A"));
    if (options.method === "PUT") {
      stored = options.body;
      if (outcome === "timeout") throw new Error(PRIVATE);
      return new Response("{}", { status: outcome === "nonzero" ? 500 : 200 });
    }
    if (!stored) return new Response("", { status: 404 });
    if (readback === "timeout") throw new Error(PRIVATE);
    return new Response(readback === "wrong" ? PRIVATE : stored);
  };
  return { fetcher, calls, saved: () => stored };
}

test("backs up only the exact original primary binding and shared comparison hash", () => {
  const backup = prepareBackup(raw(), hashes);
  const saved = JSON.parse(backup.body);
  assert.deepEqual(saved.binding, binding);
  assert.equal(saved.comparison_sha256, sha(JSON.stringify(hashes, Object.keys(hashes).sort())));
  assert.equal(backup.key, `account_facts_primary_backup:${sha(backup.body)}`);
  assert.ok(!backup.body.includes(other.target_id));
});

for (const [key, value] of [["BINDING_PLATFORM", "schwab"], ["INPUT_REF", "refs/heads/other"],
  ["INPUT_EVENT_NAME", "schedule"], ["BACKUP_PRIMARY_IBKR_BINDING", "false"], ["PREVIEW_IBKR_SOURCE_ROTATION", "true"],
  ["INSPECT_IBKR_BINDINGS", "true"], ["INITIALIZE_IBKR_BINDINGS", "true"], ["APPLY_INITIAL_IBKR_BINDINGS", "true"],
  ["INSPECT_IBKR_LIFECYCLE", "true"], ["IBKR_PRIMARY_BACKUP_HASHES", "{}"]]) {
  test(`invalid ${key} stops before any external call`, async () => {
    let calls = 0;
    await assert.rejects(() => backupPrimaryBinding({ ...env, [key]: value }, async () => { calls++; }), /backup_(mode|context)_invalid/);
    assert.equal(calls, 0);
  });
}

for (const change of ["target", "source", "duplicate", "invalid"]) {
  test(`${change} comparison cannot create a backup`, () => {
    const data = raw();
    if (change === "target") data.bindings[0].target_id = "another-target";
    if (change === "source") data.bindings[0].source_binding.id = "e".repeat(64);
    if (change === "duplicate") data.bindings.push({ ...binding, account_key: "another-key" });
    if (change === "invalid") data.bindings[0].account_selector = "invalid";
    assert.throws(() => prepareBackup(data, hashes), /binding_invalid|backup_comparison_changed/);
  });
}

for (const outcome of ["success", "nonzero", "timeout"]) {
  test(`one private PUT then exact readback resolves ${outcome}`, async () => {
    const mock = remote({ outcome });
    const result = await backupPrimaryBinding(env, mock.fetcher);
    assert.equal(result.status, "backup_verified");
    assert.equal(result.backup_object_sha256, sha(mock.saved()));
    assert.equal(mock.calls.filter(call => call.method === "PUT").length, 1);
    assert.equal(mock.calls.length, 5);
    assert.ok(!JSON.stringify(result).includes(PRIVATE));
    assert.equal(result.publication_authority_granted, false);
  });
}

test("an existing identical backup is verified without PUT", async () => {
  const mock = remote({ existing: true });
  assert.equal((await backupPrimaryBinding(env, mock.fetcher)).status, "backup_verified");
  assert.equal(mock.calls.filter(call => call.method === "PUT").length, 0);
});

for (const readback of ["wrong", "timeout"]) {
  test(`uncertain ${readback} readback returns unknown with no retry or private output`, async () => {
    const mock = remote({ readback });
    const logs = [];
    const original = console.log;
    console.log = value => logs.push(value);
    let code;
    try { code = await main(env, mock.fetcher); } finally { console.log = original; }
    assert.equal(code, 1);
    assert.deepEqual(JSON.parse(logs[0]), { status: "unknown", reason: "backup_readback_unknown" });
    assert.equal(mock.calls.filter(call => call.method === "PUT").length, 1);
    assert.ok(!logs.join().includes(PRIVATE));
  });
}

test("concurrent binding drift cannot be reported as a stable backup", async () => {
  const mock = remote({ changed: true });
  await assert.rejects(() => backupPrimaryBinding(env, mock.fetcher), /backup_comparison_changed/);
  assert.equal(mock.calls.filter(call => call.method === "PUT").length, 1);
});

test("workflow backup mode cannot enter existing mutation or Wrangler branches", () => {
  const workflow = readFileSync(new URL("../.github/workflows/sync-schwab-account-facts-binding.yml", import.meta.url), "utf8");
  for (const name of ["Prepare protected Wrangler credentials", "Validate and sync exactly one protected binding"]) {
    assert.ok(workflow.includes(`- name: ${name}\n        if: \u0024{{ !inputs.backup_primary_ibkr_binding }}`));
  }
  assert.ok(workflow.includes("run: node ./backup_ibkr_primary_binding.mjs"));
  assert.ok(workflow.includes("inputs.platform == 'ibkr' && !inputs.backup_primary_ibkr_binding"));
});
