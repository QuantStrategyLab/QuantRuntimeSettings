import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  listIbkrPeriodReturnTargets,
  matchAdditionalOnePeriodReturn,
  applyAdditionalOnePeriodReturn,
  applyIbkrPeriodReturnSettings,
} from "../web/strategy-switch-console/configure_ibkr_period_return.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const bindingId = "a".repeat(64);
const options = {
  ibkr: [{
    key: "synthetic-ibkr",
    label: "Synthetic",
    account_scope: "live-u100001",
    target_name: "synthetic",
    service_name: "interactive-brokers-quant-live-u100001-service",
    deployment_selector: "live-u100001",
    account_selector: "U100001",
  }],
};
const bindings = {
  schema_version: "qsl_account_facts_bindings.v1",
  bindings: [{
    platform: "ibkr",
    account_key: "synthetic-ibkr",
    account_scope: "live-u100001",
    target_name: "synthetic",
    service_name: "interactive-brokers-quant-live-u100001-service",
    deployment_selector: "live-u100001",
    account_selector: "U100001",
    target_id: "ibkr-u100001",
    source_binding: { kind: "deployment_runtime_account", id: bindingId },
  }],
};

const listed = listIbkrPeriodReturnTargets(options, bindings);
assert.equal(listed.count, 1);
assert.equal(listed.catalog, "ibkr-u100001|live-u100001|synthetic-ibkr");
assert.ok(!listed.catalog.includes("U100001"));

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const matched = matchAdditionalOnePeriodReturn(options, bindings, sha256("ibkr-u100001"), sha256(bindingId));
assert.deepEqual(matched, {
  target_unique: true,
  source_matches_rotation: true,
  account_key_sha256: sha256("synthetic-ibkr"),
  secret_writes: 0,
});
assert.equal(matchAdditionalOnePeriodReturn(options, bindings, sha256("ibkr-u100001"), "b".repeat(64)).source_matches_rotation, false);
assert.throws(() => matchAdditionalOnePeriodReturn(options, bindings, "c".repeat(64), sha256(bindingId)), /target_match_invalid/);
const invalidOptions = structuredClone(options);
invalidOptions.ibkr[0].account_selector = "U999999";
assert.throws(() => matchAdditionalOnePeriodReturn(invalidOptions, bindings, sha256("ibkr-u100001"), sha256(bindingId)), /option_binding_mismatch/);
assert.ok(!JSON.stringify(matched).includes("U100001"));
assert.ok(!JSON.stringify(matched).includes("synthetic-ibkr"));

const singleWrites = [];
const singleConfig = {
  env: { GH_TOKEN: "synthetic-token" }, targetHash: sha256("ibkr-u100001"),
  sourceHash: sha256(bindingId), accountKeyHash: sha256("synthetic-ibkr"),
  command: (args, input) => {
    if (args[0] === "secret") { singleWrites.push({ args, input }); return ""; }
    return JSON.stringify({ total_count: singleWrites.length, secrets: singleWrites.map(() => ({ name: "IBKR_PERIOD_RETURN_ADDITIONAL1_ACCOUNT_KEY" })) });
  },
};
assert.equal(applyAdditionalOnePeriodReturn(options, bindings, singleConfig).secret_writes, 1);
assert.equal(singleWrites.length, 1);
assert.deepEqual(singleWrites[0].args.slice(0, 3), ["secret", "set", "IBKR_PERIOD_RETURN_ADDITIONAL1_ACCOUNT_KEY"]);
assert.equal(singleWrites[0].input, "synthetic-ibkr");
assert.throws(() => applyAdditionalOnePeriodReturn(options, bindings, singleConfig), /additional1_setting_already_present/);
assert.throws(() => applyAdditionalOnePeriodReturn(options, bindings, { ...singleConfig, sourceHash: "b".repeat(64) }), /source_rotation_mismatch/);
assert.throws(() => applyAdditionalOnePeriodReturn(options, bindings, { ...singleConfig, accountKeyHash: "b".repeat(64) }), /account_key_mismatch/);
assert.throws(() => applyAdditionalOnePeriodReturn(invalidOptions, bindings, singleConfig), /option_binding_mismatch/);
assert.equal(singleWrites.length, 1);
let attempted = 0;
assert.throws(() => applyAdditionalOnePeriodReturn(options, bindings, { ...singleConfig, command: (args) => {
  if (args[0] === "api") return JSON.stringify({ total_count: 0, secrets: [] });
  attempted += 1;
  throw new Error("protected_configuration_write_failed_or_unknown");
} }), /protected_configuration_write_failed_or_unknown/);
assert.equal(attempted, 1);

const writes = [];
const applied = applyIbkrPeriodReturnSettings(options, bindings, "ibkr-u100001", {
  env: { GH_TOKEN: "synthetic-token" },
  command: (args, input) => {
    writes.push({ args, input });
    if (args[0] === "api" && args[1].includes("/actions/secrets")) {
      const names = writes.filter((row) => row.args[0] === "secret").map((row) => row.args[2]);
      return JSON.stringify({
        total_count: names.length + 1,
        secrets: [
          { name: "IBKR_ACCOUNT_FACTS_SYNC_TOKEN" },
          ...names.map((name) => ({ name })),
        ],
      });
    }
    return "";
  },
});
assert.equal(applied.secret_writes, 5);
assert.equal(applied.target_id, "ibkr-u100001");
assert.equal(applied.account_key, "synthetic-ibkr");
assert.equal(
  writes.find((row) => row.args[2] === "IBKR_FLEX_EXPECTED_ACCOUNT_IDS_JSON")?.input,
  '["U100001"]',
);

const dir = mkdtempSync(join(tmpdir(), "ibkr-period-return-"));
const optionsPath = join(dir, "options.json");
const bindingsPath = join(dir, "bindings.json");
writeFileSync(optionsPath, JSON.stringify(options));
writeFileSync(bindingsPath, JSON.stringify(bindings));
const cli = spawnSync(process.execPath, [
  join(root, "web/strategy-switch-console/configure_ibkr_period_return.mjs"),
  "list", optionsPath, bindingsPath,
], { encoding: "utf8" });
assert.equal(cli.status, 0);
assert.match(cli.stdout, /^status=ok reason=none count=1 catalog=ibkr-u100001\|live-u100001\|synthetic-ibkr\n$/);

const matchCli = spawnSync(process.execPath, [
  join(root, "web/strategy-switch-console/configure_ibkr_period_return.mjs"),
  "match-additional-1", optionsPath, bindingsPath,
], { encoding: "utf8", env: { ...process.env, GH_TOKEN: "synthetic-secret" } });
assert.equal(matchCli.status, 1); // Fixed production anchor cannot match the synthetic fixture.
assert.equal(matchCli.stdout, "status=blocked reason=target_match_invalid\n");
assert.ok(!matchCli.stdout.includes("synthetic-secret"));
assert.ok(!matchCli.stdout.includes("U100001"));

const workflow = readFileSync(
  join(root, ".github/workflows/configure-ibkr-period-return.yml"), "utf8",
);
assert.match(workflow, /Configure IBKR period-return secrets/);
assert.match(workflow, /configure_ibkr_period_return\.mjs/);
assert.match(workflow, /CONFIGURE_MODE.*match-additional-1/);
assert.match(workflow, /inputs.mode != 'match-additional-1' && secrets.RUNTIME_SETTINGS_GH_TOKEN/);
assert.ok(!workflow.includes("IBKR_FLEX_TOKEN"));
assert.ok(!workflow.includes("IBKR_PERIOD_RETURN_PUBLISH_ENABLED"));

console.log("IBKR period-return configure: list/apply/privacy/workflow gate PASS");
