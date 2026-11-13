import assert from "node:assert/strict";
import { consoleApiResponse } from "../web/strategy-switch-console/application/console_api/routes.js";
const url = "https://console.invalid/api/desk/alerts/delivery";
const deps = { json: (body, status = 200) => Response.json(body, { status }),
  readSession: async () => ({ allowed: true }),
  accountOptions: () => { throw Error("must not read account state"); },
  command: () => { throw Error("must not write business state"); },
  notificationReceipts: async () => ({ read_status: "partial", as_of: "2030-01-07T12:00:00Z",
    read_reason_codes: ["receipt_missing"], items: [
      { source_run_id: 11, source_run_attempt: 1, status: "delivered", delivered: true, dry_run: false, test_message: false, business_day: "2030-01-06" },
      { source_run_id: 12, source_run_attempt: 1, status: "receipt_missing", business_day: "2030-01-07" },
    ] }) };
const response = await consoleApiResponse(new Request(url), {}, deps);
assert.equal(response.status, 200, "authenticated Desk delivery read must use the existing receipt adapter");
const body = await response.json();
assert.equal(body.source.read_status, "partial");
assert.equal(body.channel.status.status, "unknown");
assert.equal(body.last_delivery, null);
assert.equal(body.digest, null);
assert.deepEqual(body.source.items.map(row => row.receiver_ack), ["unknown", "unknown"]);
assert.deepEqual(body.source.items.map(row => row.source_run_id), [11, 12]);
assert.deepEqual(body.source.items.map(row => row.business_day), ["2030-01-06", "2030-01-07"]);
assert.equal(body.source.items[0].sender_accepted, true);
assert.equal(body.source.items[1].sender_status, "receipt_missing");
console.log("Desk authenticated read regression passed");

// The new route must deny unauthenticated reads before touching a source.
let reads = 0;
assert.equal((await consoleApiResponse(new Request(url), {}, { ...deps,
  readSession: async () => null, notificationReceipts: () => { reads++; } })).status, 401);
assert.equal(reads, 0);
assert.equal((await consoleApiResponse(new Request(url, { method: "POST" }), {}, deps)).status, 405);

const { deskDelivery } = await import("../web/strategy-switch-console/application/console_api/desk_delivery.js");
// Top-level diagnostics are bounded independently from per-item receipt errors.
const { RECEIPT_READ_ERROR_CODES } = await import("../web/strategy-switch-console/application/console_api/notification_receipts.js");
const diagnosticNow = () => Date.parse("2030-01-07T12:00:00Z");
const diagnosticProject = source => deskDelivery({}, { notificationReceipts: async () => source }, diagnosticNow);
for (const code of RECEIPT_READ_ERROR_CODES) {
  const result = await diagnosticProject({ read_status: "read_failed", read_reason_codes: ["notification_receipts_read_failed"],
    read_error_code: code, items: [] });
  assert.equal(result.source.read_error_code, code, "allowlisted top-level diagnostic must survive projection");
  assert.equal(result.source.read_status, "read_failed");
  assert.equal(result.channel.status.reason, "read_failed");
}
for (const code of [undefined, null, "", "FAKE_PRIVATE_PROVIDER_DETAIL", 403, {}, ["run_listing_http_403"]]) {
  const result = await diagnosticProject({ read_status: "read_failed", read_reason_codes: [], read_error_code: code, items: [] });
  assert.equal(result.source.read_error_code, "unknown", "missing or untrusted diagnostic stays unknown");
  assert.doesNotMatch(JSON.stringify(result), /FAKE_PRIVATE/);
}
for (const read_status of ["read_failed", "no_data", "partial"]) {
  const result = await diagnosticProject({ read_status, read_reason_codes: [], read_error_code: "run_listing_http_403",
    items: [{ status: "dry_run", dry_run: true, test_message: true, delivered: true,
      read_error_code: "artifact_listing_http_404", receiver_ack: "accepted" }] });
  assert.equal(result.source.read_status, read_status);
  assert.equal(result.source.read_error_code, "run_listing_http_403");
  assert.equal(result.source.items[0].read_error_code, "artifact_listing_http_404");
  assert.equal(result.source.items[0].dry_run, true);
  assert.equal(result.source.items[0].test_message, true);
  assert.equal(result.source.items[0].receiver_ack, "unknown");
}
for (const source of [null, { read_status: "complete", read_reason_codes: [], items: null, read_error_code: "run_listing_http_403" }]) {
  const result = await diagnosticProject(source);
  assert.equal(result.source.read_status, "unknown");
  assert.equal(result.source.read_error_code, "unknown", "malformed source cannot supply trusted diagnostics");
}
const diagnosticThrown = await deskDelivery({}, { notificationReceipts: () => { throw Error("FAKE_PRIVATE_PROVIDER_DETAIL"); } }, diagnosticNow);
assert.equal(diagnosticThrown.source.read_error_code, "unknown");
assert.equal(diagnosticThrown.source.read_status, "read_failed");
assert.doesNotMatch(JSON.stringify(diagnosticThrown), /FAKE_PRIVATE/);
let diagnosticCurrent = { read_status: "partial", read_reason_codes: [], read_error_code: "run_listing_http_403", items: [] };
const diagnosticDeps = { notificationReceipts: async () => diagnosticCurrent };
const diagnosticSnapshot = structuredClone(diagnosticCurrent);
const diagnosticConcurrent = await Promise.all(Array.from({ length: 8 }, () => deskDelivery({}, diagnosticDeps, diagnosticNow)));
assert.ok(diagnosticConcurrent.every(result => result.source.read_error_code === "run_listing_http_403"));
assert.deepEqual(diagnosticCurrent, diagnosticSnapshot);
diagnosticCurrent = { read_status: "read_failed", read_reason_codes: [], items: [] };
assert.equal((await deskDelivery({}, diagnosticDeps, diagnosticNow)).source.read_error_code, "unknown", "no stale diagnostic retained");
const { deskDelivery: restartedProjection } = await import("../web/strategy-switch-console/application/console_api/desk_delivery.js?diagnostic-restart");
assert.equal((await restartedProjection({}, diagnosticDeps, diagnosticNow)).source.read_error_code, "unknown");
console.log("Desk top-level diagnostic allowlist, unknown fallback, redaction and independent reads passed");

const { createRequire } = await import("node:module");
const { readFileSync } = await import("node:fs");
const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const ajv = new Ajv({ strict: true, strictTypes: false });
require("ajv-formats")(ajv);
const common = JSON.parse(readFileSync(new URL("../schemas/desk/common.json", import.meta.url)));
const schema = JSON.parse(readFileSync(new URL("../schemas/desk/alert-delivery.json", import.meta.url)));
ajv.addSchema(common);
const check = ajv.compile(schema);
const now = () => Date.parse("2030-01-07T12:00:00Z");
const project = source => deskDelivery({}, { notificationReceipts: async () => source }, now);
const validate = value => assert.ok(check(value), ajv.errorsText(check.errors));
validate(body);
// The completed schema declares source.read_error_code: the reader allowlist plus literal unknown.
const sourceErrorEnum = schema.properties.source.properties.read_error_code.enum;
const itemErrorEnum = schema.properties.source.properties.items.items.properties.read_error_code.anyOf[0].enum;
assert.deepEqual(itemErrorEnum, [...RECEIPT_READ_ERROR_CODES], "item enum is exactly the shared reader allowlist");
assert.deepEqual(sourceErrorEnum, [...RECEIPT_READ_ERROR_CODES, "unknown"], "source enum adds only the unknown fallback");
assert.ok(schema.properties.source.required.includes("read_error_code"));
assert.equal(schema.properties.source.additionalProperties, false, "source stays a closed object");
assert.deepEqual(schema.properties.source.properties.items.items.properties.read_error_code.anyOf[1], { type: "null" },
  "item-level diagnostics stay nullable");
for (const code of RECEIPT_READ_ERROR_CODES) {
  validate(await diagnosticProject({ read_status: "read_failed", read_reason_codes: ["notification_receipts_read_failed"],
    read_error_code: code, items: [] }));
}
for (const code of [undefined, null, "", "FAKE_PRIVATE_PROVIDER_DETAIL", 403, {}, ["run_listing_http_403"]]) {
  validate(await diagnosticProject({ read_status: "read_failed", read_reason_codes: [], read_error_code: code, items: [] }));
}
validate(diagnosticThrown);
for (const read_status of ["read_failed", "no_data", "partial"]) {
  validate(await diagnosticProject({ read_status, read_reason_codes: [], read_error_code: "run_listing_http_403",
    items: [{ status: "dry_run", dry_run: true, test_message: true, read_error_code: "artifact_listing_http_404" }] }));
}
const projectedBase = await diagnosticProject({ read_status: "read_failed", read_reason_codes: [], read_error_code: "run_listing_http_403",
  items: [{ status: "read_failed", read_error_code: null }] });
validate(projectedBase);
assert.equal(projectedBase.source.items[0].read_error_code, null, "a null item diagnostic is still valid");
for (const [label, edit] of [
  ["missing source diagnostic", body => { delete body.source.read_error_code; }],
  ["null source diagnostic", body => { body.source.read_error_code = null; }],
  ["free-text source diagnostic", body => { body.source.read_error_code = "provider said: FAKE"; }],
  ["unallowlisted source diagnostic", body => { body.source.read_error_code = "run_listing_http_418"; }],
  ["unknown is not an item-level code", body => { body.source.items[0].read_error_code = "unknown"; }],
]) {
  const mutated = structuredClone(projectedBase);
  edit(mutated);
  assert.equal(check(mutated), false, label);
}
console.log("Desk source.read_error_code schema linkage passed");
for (const [read_status, reason, sender_status] of [
  ["partial", "receipt_missing", "receipt_missing"],
  ["partial", "receipt_expired", "receipt_expired"],
  ["partial", "sender_skipped", "sender_skipped"],
  ["read_failed", "notification_receipts_read_failed", "read_failed"],
  ["unknown", "run_listing_coverage_unknown", "unknown"],
  ["complete", null, "delivered"],
]) {
  const result = await project({ read_status, read_reason_codes: reason ? [reason] : [], as_of: null,
    items: [{ status: sender_status, delivered: true, workflow_updated_at: "2000-01-01T00:00:00Z" }] });
  validate(result);
  assert.equal(result.source.read_status, read_status);
  assert.equal(result.source.items[0].sender_status, sender_status);
  assert.equal(result.source.items[0].receiver_ack, "unknown");
  assert.equal(result.source.items[0].workflow_updated_at, "2000-01-01T00:00:00Z");
  assert.equal(result.last_delivery, null, "old workflow metadata never becomes a current send");
  assert.equal(result.channel.status.status, "unknown");
}
for (const read_status of ["no_data", "not_connected"]) {
  const result = await project({ read_status, read_reason_codes: [], items: [] });
  validate(result);
  assert.equal(result.source.read_status, read_status);
  assert.equal(result.channel.status.reason, "source_unavailable");
}
const thrown = await deskDelivery({}, { notificationReceipts: () => { throw Error("FAKE_PRIVATE_PROVIDER_DETAIL"); } }, now);
validate(thrown);
assert.equal(thrown.source.read_status, "read_failed");
assert.equal(thrown.channel.status.reason, "read_failed");
assert.doesNotMatch(JSON.stringify(thrown), /FAKE_PRIVATE/);
const fallback = await deskDelivery({}, {}, now);
validate(fallback);
assert.equal(fallback.source.read_status, "not_connected");
for (const malformed of [null, {}, { read_status: "complete", read_reason_codes: [], items: null },
  { read_status: "complete", read_reason_codes: [], items: [null] },
  { read_status: "complete", read_reason_codes: [], items: Array(6).fill({}) }]) {
  const result = await project(malformed);
  validate(result);
  assert.equal(result.source.read_status, "unknown");
  assert.deepEqual(result.source.read_reason_codes, ["invalid_notification_log"]);
}
const unsafe = await project({ read_status: "partial", read_reason_codes: ["FAKE_PRIVATE_PROVIDER_DETAIL", "receipt_missing"],
  as_of: "2030-02-30T00:00:00Z", secret: "FAKE_PRIVATE_PROVIDER_DETAIL", items: [{
    source_run_id: -1, source_run_attempt: 0, status: "FAKE_PRIVATE_PROVIDER_DETAIL", delivered: "true",
    business_day: "2030-02-30", report_date: "FAKE_PRIVATE_PROVIDER_DETAIL", workflow_updated_at: "yesterday",
    read_error_code: "FAKE_PRIVATE_PROVIDER_DETAIL", source_url: "https://fake.invalid/private", receiver_ack: "accepted",
  }] });
validate(unsafe);
assert.doesNotMatch(JSON.stringify(unsafe), /FAKE_PRIVATE|fake.invalid|yesterday/);
assert.deepEqual(unsafe.source.read_reason_codes, ["receipt_missing"]);
for (const key of ["source_run_id", "source_run_attempt", "sender_accepted", "business_day", "report_date", "workflow_updated_at", "read_error_code"])
  assert.equal(unsafe.source.items[0][key], null, key);
assert.equal(unsafe.source.items[0].sender_status, "unknown");

// Never join counts, ACKs or outcomes from another attempt, run or window.
const rows = [
  { source_run_id: 21, source_run_attempt: 1, business_day: "2030-01-06", report_date: "2030-01-07", status: "delivered", delivered: true },
  { source_run_id: 21, source_run_attempt: 2, business_day: "2030-01-07", report_date: "2030-01-08", status: "send_failed", delivered: false },
  { source_run_id: 22, source_run_attempt: 1, business_day: "2030-01-06", status: "receipt_expired" },
];
const source = { read_status: "partial", read_reason_codes: ["receipt_expired"], items: rows };
const snapshot = structuredClone(source);
const concurrent = await Promise.all(Array.from({ length: 8 }, () => project(source)));
assert.deepEqual(source, snapshot, "projection never mutates shared source or persisted cache");
for (const result of concurrent) {
  validate(result);
  assert.deepEqual(result.source.items.map(row => [row.source_run_id, row.source_run_attempt, row.business_day]),
    [[21, 1, "2030-01-06"], [21, 2, "2030-01-07"], [22, 1, "2030-01-06"]]);
  assert.deepEqual(result.source.items.map(row => row.sender_accepted), [true, false, null]);
  assert.ok(result.source.items.every(row => row.receiver_ack === "unknown"));
  assert.equal(result.digest, null);
  assert.equal(result.last_delivery, null);
}
let current = source;
const freshDeps = { notificationReceipts: async () => current };
await deskDelivery({}, freshDeps, now);
current = { read_status: "read_failed", read_reason_codes: ["notification_receipts_read_failed"], items: [] };
assert.equal((await deskDelivery({}, freshDeps, now)).source.read_status, "read_failed", "no retained healthy snapshot");
assert.equal((await import("../web/strategy-switch-console/application/console_api/desk_delivery.js?restart")).deskDelivery instanceof Function, true);
console.log("Desk delivery schema, auth, unknowns, redaction, correlation and concurrent read checks passed");
