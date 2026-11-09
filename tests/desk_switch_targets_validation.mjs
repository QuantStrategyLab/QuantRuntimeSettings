import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  switchTargetsFromConfig, deskSwitchTargetsResponse,
} from "../web/strategy-switch-console/application/desk/switch_targets.js";
import { DeskError } from "../web/strategy-switch-console/application/desk/http.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const ajv = new (require("ajv/dist/2020").default)({ strict: false });
require("ajv-formats")(ajv);
for (const name of ["common", "switch-targets", "error"]) {
  ajv.addSchema(JSON.parse(readFileSync(new URL(`../schemas/desk/${name}.json`, import.meta.url))));
}
const conforms = (data) => {
  const check = ajv.getSchema("https://schemas.example.invalid/qsl/desk/switch-targets.json");
  assert.ok(check(data), ajv.errorsText(check.errors));
};

const config = {
  revision: 7,
  options: {
    ibkr: [
      { key: "ibkr-main", label: "IBKR Main", target_name: "tqqq",
        supported_domains: ["us_equity"], default_execution_mode: "paper",
        default_strategy_profile: "tqqq_growth_income", account_selector: "DU1234567" },
      { key: "ibkr-no-selector", label: "IBKR Unbound", target_name: "soxl", supported_domains: [] },
    ],
    schwab: [
      { key: "schwab-core", label: "Schwab Core", target_name: "core",
        supported_domains: ["us_equity", "hk_equity"], default_execution_mode: "not_a_mode",
        account_selector: "1234" },
    ],
  },
};

const targets = switchTargetsFromConfig(config);
assert.equal(targets.length, 3);
conforms({ ok: true, schema_version: "qsl.desk.switch_targets.v1", generated_at: new Date().toISOString(), targets });

const [ibkr, unbound, schwab] = targets;
assert.equal(ibkr.target_id, "ibkr/tqqq");
assert.equal(ibkr.platform, "ibkr");
assert.equal(ibkr.platform_label, "IBKR");
assert.equal(ibkr.account_suffix, "4567");
assert.match(ibkr.account_ref, /••••4567/);
assert.deepEqual(ibkr.domains, ["us_equity"]);
assert.deepEqual(ibkr.execution_modes, ["paper"]);
assert.deepEqual(ibkr.switchable, { allowed: false, reason_code: "switch_not_connected" });
assert.equal(ibkr.pending_request_id, null);
assert.deepEqual(ibkr.stop, { supported: false, resume_supported: false });

// A configured default is not an observation of the running broker.
assert.deepEqual(ibkr.mode, { status: "unknown", reason: "never_read" });
assert.deepEqual(ibkr.current_strategy, { status: "unknown", reason: "never_read" });
assert.ok(!JSON.stringify(targets).includes("tqqq_growth_income"), "no invented strategy label");
assert.ok(!JSON.stringify(targets).includes("DU1234567"), "no unmasked account selector");
assert.ok(!JSON.stringify(targets).includes("revision"), "no configuration bookkeeping in the payload");

// Missing or invalid configuration details stay blank/unknown, never guessed.
assert.equal(unbound.account_suffix, "");
assert.deepEqual(unbound.domains, []);
assert.deepEqual(unbound.execution_modes, []);
assert.deepEqual(schwab.execution_modes, [], "an out-of-vocabulary mode is not emitted");
assert.deepEqual(schwab.domains, ["us_equity", "hk_equity"]);

// A broken configuration is a failure, not an empty healthy list.
for (const bad of [null, undefined, [], {}, { options: null }, { options: [] }, { options: "x" }]) {
  assert.throws(() => switchTargetsFromConfig(bad), error => error instanceof DeskError && error.status === 502);
}
conforms({ ok: true, schema_version: "qsl.desk.switch_targets.v1", generated_at: new Date().toISOString(), targets: [] });

const env = {};
const url = "https://console.example/api/desk/switch/targets";
const get = (deps, method = "GET") => deskSwitchTargetsResponse(new Request(url, { method }), env, deps);
const body = async (deps, method = "GET") => { const response = await get(deps, method); return [response.status, await response.json()]; };
const okDeps = { auth: async () => ({ allowed: true, login: "synthetic" }), options: async () => config };

// Auth runs before the configuration is read; a failed read is never an empty list.
assert.deepEqual(await body({ auth: async () => { throw new DeskError("login_required", 401); }, options: async () => { throw new Error("must not run"); } }),
  [401, { ok: false, error: "login required", reason_code: "login_required" }]);
const [failedStatus, failed] = await body({ auth: async () => ({ allowed: true }), options: async () => { throw new Error("kv exploded at /secret/path"); } });
assert.equal(failedStatus, 502);
assert.deepEqual(failed, { ok: false, error: "read_failed", reason_code: "read_failed" });
assert.equal((await get(okDeps, "POST")).status, 404);

const [status, payload] = await body(okDeps);
assert.equal(status, 200);
conforms(payload);
assert.equal(payload.schema_version, "qsl.desk.switch_targets.v1");
assert.equal(payload.targets.length, 3);

console.log("desk_switch_targets_validation: PASS");
