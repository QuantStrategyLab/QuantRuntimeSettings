import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import {
  CANONICAL_CREDENTIAL_PLATFORMS,
  CREDENTIAL_CALENDAR_PROJECTION_VERSION,
  CREDENTIAL_CALENDAR_SCHEMA,
  REGISTERED_CREDENTIALS,
  verifyRegistrySelfConsistency,
} from "../web/strategy-switch-console/application/credential_calendar/registry.js";
import { CredentialValidationError } from "../web/strategy-switch-console/application/credential_calendar/validator.js";
import {
  projectCredentialCalendar,
  projectCredentialRecord,
} from "../web/strategy-switch-console/application/credential_calendar/projector.js";
import { multiPlatformCredentialProjection } from "../web/strategy-switch-console/application/desk/credentials.js";
import { accountsCredentialCalendarProjection } from "../web/strategy-switch-console/application/desk/accounts.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");

const loadJson = (relPath) => JSON.parse(readFileSync(new URL(relPath, import.meta.url), "utf8"));
const schema = loadJson("../schemas/qsl-credential-calendar.v1.schema.json");
const matrix = loadJson("./fixtures/sa3/sa3_credential_matrix.json");

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats(ajv);
const validateCredentialSchema = ajv.compile(schema);

const FORBIDDEN_OUTPUT_RE = new RegExp(
  "(?:source_ref|kv_key|do_key|kv://|do://|/" + "Users/|/" + "home/|broker_account_hash|BEGIN PRIVATE KEY|synthetic-secret|synthetic-client-secret|AKIASYNTHETIC)",
);

assert.equal(verifyRegistrySelfConsistency(), true, "credential registry must be self-consistent");
assert.deepEqual(CANONICAL_CREDENTIAL_PLATFORMS, ["schwab", "firstrade", "ibkr", "longbridge", "binance"]);
assert.ok(REGISTERED_CREDENTIALS.cred_longbridge_paper_pilot_90d);
assert.equal(REGISTERED_CREDENTIALS.cred_longbridge_paper_pilot_90d.expected_ttl_days, 90);

// Validate all positive C-SA-26 threshold, provenance, and applicability matrix cases.
const projectedRows = [];
for (const c of matrix.valid_cases) {
  const projected = projectCredentialRecord(c.record);
  assert.ok(
    validateCredentialSchema(projected),
    `schema invalid for ${c.name}: ${ajv.errorsText(validateCredentialSchema.errors)}`,
  );
  for (const [k, v] of Object.entries(c.expected)) {
    assert.equal(projected[k], v, `${c.name}: mismatch on ${k}`);
  }
  assert.equal(projected.evidence_source, c.record.evidence_source, `${c.name}: evidence_source must remain verbatim`);
  const serialized = JSON.stringify(projected);
  assert.ok(!FORBIDDEN_OUTPUT_RE.test(serialized), `${c.name}: forbidden pattern leaked into JSON`);
  projectedRows.push(projected);
}

// Project full 5-platform calendar envelope and validate Desk helpers.
const envelope = projectCredentialCalendar(matrix.valid_cases.map((c) => c.record), {
  evaluated_at: matrix.evaluated_at,
});
assert.equal(envelope.schema_version, CREDENTIAL_CALENDAR_SCHEMA);
assert.equal(envelope.projection_version, CREDENTIAL_CALENDAR_PROJECTION_VERSION);
assert.deepEqual(envelope.platforms_supported, ["schwab", "firstrade", "ibkr", "longbridge", "binance"]);
assert.equal(envelope.platforms_present.length, 5);
assert.ok(
  validateCredentialSchema(envelope),
  `envelope schema invalid: ${ajv.errorsText(validateCredentialSchema.errors)}`,
);

const deskCredCal = multiPlatformCredentialProjection(matrix.valid_cases.map((c) => c.record), {
  evaluated_at: matrix.evaluated_at,
});
assert.deepEqual(deskCredCal, envelope);

const acctCal = accountsCredentialCalendarProjection({
  ibkrRecord: { expires_at: "2026-06-05T12:00:00.000Z", metadata_revision: 3 },
  evaluatedAt: matrix.evaluated_at,
});
assert.ok(
  validateCredentialSchema(acctCal),
  `accounts credential calendar schema invalid: ${ajv.errorsText(validateCredentialSchema.errors)}`,
);
assert.equal(acctCal.records.find((r) => r.platform === "ibkr").phase, "due_7d");
assert.equal(acctCal.records.find((r) => r.platform === "longbridge").phase, "unknown");
assert.equal(acctCal.records.find((r) => r.platform === "longbridge").requires_action, true);
assert.equal(acctCal.records.find((r) => r.platform === "schwab").requires_action, true);
assert.equal(acctCal.records.find((r) => r.platform === "binance").phase, "not_applicable");
assert.equal(acctCal.records.find((r) => r.platform === "binance").requires_action, false);
assert.equal(acctCal.records.find((r) => r.platform === "firstrade").phase, "unsupported");
assert.equal(acctCal.records.find((r) => r.platform === "firstrade").requires_action, false);

// Negative secret, extra-field, raw-account-ID, and unregistered ID/runbook rejection tests.
const baseValid = matrix.valid_cases[0].record;
const capturedLogs = [];
const persisted = [];
for (const neg of matrix.negative_cases) {
  const candidate = {
    ...baseValid,
    ...neg.patch,
    ...(neg.patch.typed_metadata
      ? { typed_metadata: { ...(baseValid.typed_metadata || {}), ...neg.patch.typed_metadata } }
      : {}),
  };
  let caught = null;
  try {
    const out = projectCredentialRecord(candidate);
    persisted.push(out);
  } catch (err) {
    caught = err;
    capturedLogs.push(String(err.code || err.name));
  }
  assert.ok(caught instanceof CredentialValidationError, `${neg.name} must throw CredentialValidationError`);
}
assert.equal(persisted.length, 0, "rejected payloads must never reach persistence");
assert.ok(
  !FORBIDDEN_OUTPUT_RE.test(capturedLogs.join("\n")),
  "error codes/logs must never contain secret payload fragments or private locators",
);

console.log(`sa3_credential_calendar_validation: PASS (${matrix.valid_cases.length} valid + ${matrix.negative_cases.length} negative cases verified)`);
