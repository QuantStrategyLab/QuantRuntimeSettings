import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  listIbkrPeriodReturnTargets,
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

const workflow = readFileSync(
  join(root, ".github/workflows/configure-ibkr-period-return.yml"), "utf8",
);
assert.match(workflow, /Configure IBKR period-return secrets/);
assert.match(workflow, /configure_ibkr_period_return\.mjs/);
assert.match(workflow, /RUNTIME_SETTINGS_GH_TOKEN/);
assert.ok(!workflow.includes("IBKR_FLEX_TOKEN"));
assert.ok(!workflow.includes("IBKR_PERIOD_RETURN_PUBLISH_ENABLED"));

console.log("IBKR period-return configure: list/apply/privacy/workflow gate PASS");
