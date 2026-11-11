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
