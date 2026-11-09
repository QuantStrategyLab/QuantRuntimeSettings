import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  credentialExpiry, credentialItems, credentialPhase, deskCredentialsResponse,
} from "../web/strategy-switch-console/application/desk/credentials.js";
import { DeskError } from "../web/strategy-switch-console/application/desk/http.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const ajv = new (require("ajv/dist/2020").default)({ strict: false });
require("ajv-formats")(ajv);
for (const name of ["common", "credentials", "error"]) {
  ajv.addSchema(JSON.parse(readFileSync(new URL(`../schemas/desk/${name}.json`, import.meta.url))));
}
const conforms = (name, data) => {
  const check = ajv.getSchema(`https://schemas.example.invalid/qsl/desk/${name}.json`);
  assert.ok(check(data), ajv.errorsText(check.errors));
};

const record = {
  id: "ibkr_flex", metadata_source: "operator_provided", metadata_revision: 4,
  expires_at: "2030-01-09T12:00:00.000Z", phase: "7", days_remaining: 7,
  severity: "urgent", requires_action: true, delivery: "not_reserved",
};

// §3.20 vocabulary: every bucket the contract can express is passed through.
for (const [phase, action] of [["30", true], ["7", true], ["1", true], ["expired", true],
  ["not_due", false], ["unknown", false]]) {
  assert.equal(credentialPhase(phase), phase);
  const [item] = credentialItems({ ...record, phase });
  assert.equal(item.phase, phase);
  assert.equal(item.requires_action, action, `phase ${phase}`);
  conforms("credentials", { ok: true, schema_version: "qsl.desk.credentials.v1", generated_at: new Date().toISOString(), items: [item] });
}
// The maintenance module buckets 14 days; the desk contract has no 14 and the UI
// already folds it into 30 (normalizeCredentialPhase). The backend must apply the
// same rule, or the guard rejects the payload before the UI can normalise it.
assert.equal(credentialPhase("14"), "30");
const folded = credentialItems({ ...record, phase: "14" })[0];
assert.equal(folded.phase, "30");
assert.equal(folded.requires_action, true, "a 14-day credential is inside the action window");
conforms("credentials", { ok: true, schema_version: "qsl.desk.credentials.v1", generated_at: new Date().toISOString(), items: [folded] });
// An out-of-vocabulary phase is unknown, never a neighbouring bucket.
assert.equal(credentialPhase("14d"), "unknown");
assert.equal(credentialPhase(14), "unknown");
assert.equal(credentialPhase(undefined), "unknown");
assert.equal(credentialPhase("5"), "unknown");
const coerced = credentialItems({ ...record, phase: "5" })[0];
assert.equal(coerced.phase, "unknown");
assert.equal(coerced.requires_action, false);

// Absence of metadata is unknown, not "does not expire".
assert.deepEqual(credentialExpiry({ expires_at: null }), { status: "unknown", reason: "never_read" });
assert.deepEqual(credentialExpiry({}), { status: "unknown", reason: "never_read" });
assert.deepEqual(credentialExpiry({ expires_at: "not a date" }), { status: "unknown", reason: "never_read" });
// The record is operator-supplied metadata; the projection must not upgrade it
// into a broker-validated fact.
assert.deepEqual(credentialExpiry(record), {
  status: "known", at: "2030-01-09T12:00:00.000Z", source: "operator_provided",
});

// A record without an id proves nothing; surface a failure instead of an empty list.
for (const bad of [null, undefined, [], {}, { id: "" }, { id: 7 }]) {
  assert.throws(() => credentialItems(bad), error => error instanceof DeskError && error.status === 502);
}

const env = {};
const get = (deps) => deskCredentialsResponse(new Request("https://console.example/api/desk/credentials"), env, deps);
const body = async (deps) => { const response = await get(deps); return [response.status, await response.json()]; };
const okDeps = { auth: async () => ({ allowed: true, login: "synthetic" }), command: async () => record };

// Unauthenticated callers are rejected before the store is touched.
assert.deepEqual(await body({ auth: async () => { throw new DeskError("login_required", 401); }, command: async () => { throw new Error("must not run"); } }),
  [401, { ok: false, error: "login required", reason_code: "login_required" }]);
// Store failures are reported as a desk failure, never as an empty healthy list.
const [failedStatus, failed] = await body({ auth: async () => ({ allowed: true }), command: async () => { throw new Error("sqlite exploded at /secret/path"); } });
assert.equal(failedStatus, 502);
assert.deepEqual(failed, { ok: false, error: "read_failed", reason_code: "read_failed" });
// Methods other than GET are not served.
assert.equal((await deskCredentialsResponse(new Request("https://console.example/api/desk/credentials", { method: "POST" }), env, okDeps)).status, 404);

const [status, payload] = await body(okDeps);
assert.equal(status, 200);
conforms("credentials", payload);
assert.equal(payload.schema_version, "qsl.desk.credentials.v1");
assert.equal(payload.items.length, 1);
assert.equal(payload.items[0].id, "ibkr_flex");
assert.equal(payload.items[0].platform, "ibkr");
assert.equal(payload.items[0].kind, "flex_token");
assert.equal(payload.items[0].expiry.at, "2030-01-09T12:00:00.000Z");
assert.equal(payload.items[0].rotation.supported, true);
// The response carries no database revision or delivery bookkeeping.
assert.ok(!JSON.stringify(payload).includes("metadata_revision"));
assert.ok(!JSON.stringify(payload).includes("not_reserved"));

console.log("desk_credentials_validation: PASS");
