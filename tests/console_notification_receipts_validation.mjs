import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { createNotificationLogReader, publicReceiptFromZip, projectNotificationReceipt } from "../web/strategy-switch-console/application/console_api/notification_receipts.js";
import { consoleApiResponse } from "../web/strategy-switch-console/application/console_api/routes.js";
import { notificationLog } from "../web/strategy-switch-console/application/console_api/operations.js";
import { validate } from "./console_api_contract_validation.mjs";

// Synthetic archives and receipts, never real account facts or credentials.
function zip(payload, method = 8, name = "receipt-public.json") {
  const data = Buffer.from(JSON.stringify(payload)), compressed = method === 8 ? deflateRawSync(data) : data;
  const filename = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method, 8); local.writeUInt16LE(filename.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(method, 10); central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + compressed.length, 16);
  return new Uint8Array(Buffer.concat([local, filename, compressed, central, filename, end]));
}
const repository = "example/console", sha = "a".repeat(40), now = () => Date.parse("2026-10-17T00:00:00Z");
const run = id => ({ id, run_attempt: 1, head_sha: sha, head_branch: "main", head_repository: { full_name: repository },
  event: "schedule", updated_at: "2026-10-16T23:02:00Z", run_started_at: "2026-10-16T23:00:00Z", conclusion: "success" });
const receipt = { schema_version: "qsl.daily_digest_receipt.v1", projection: "public_summary", source_sha: sha,
  business_day: "2026-10-16", report_date: "2026-10-17", status: "delivered", delivered: true, dry_run: false, test_message: false,
  resend_guard: { reason: "FIRST_SEND" }, private_text: "never expose this", sent_at: "invented_timestamp" };
for (const method of [0, 8]) assert.deepEqual(await publicReceiptFromZip(zip(receipt, method)), receipt);
for (const input of [new Uint8Array(2), new Uint8Array(262145), zip(receipt, 0, "private-preview.json"), zip(receipt, 6)])
  await assert.rejects(publicReceiptFromZip(input));
for (const patch of [{ delivered:false }, { dry_run:true }, { test_message:true }])
  assert.equal(projectNotificationReceipt({ ...receipt, ...patch }, run(1)).status, "unknown", "contradictory receipts cannot prove a real delivery");
const projected = projectNotificationReceipt(receipt, run(1));
assert.equal(projected.sent_at, null);
assert.equal(projected.delivered, true);
assert.doesNotMatch(JSON.stringify(projected), /never expose|invented_timestamp|private_text/);
assert.equal(projectNotificationReceipt({ ...receipt, business_day: "2026-02-30", report_date: "2026-99-99" }, run(1)).business_day, null);
assert.equal(projectNotificationReceipt({ ...receipt, status: "secret-detail", resend_guard: { reason: "secret" } }, run(1)).reason_code, null);
assert.throws(() => projectNotificationReceipt({ ...receipt, source_sha: "b".repeat(40) }, run(1)));

const calls = [];
const reader = createNotificationLogReader(async (url, init) => {
  calls.push(url);
  assert.equal(init.method, "GET");
  if (url.startsWith("https://example.blob/")) {
    assert.equal(init.headers, undefined, "GitHub credential must not follow the signed artifact redirect");
    const id = Number(url.split("/").at(-1));
    return new Response(zip(id === 1 ? receipt : id === 2
      ? { ...receipt, status: "blocked_resend_guard", delivered: false, resend_guard: { reason: "HISTORY_UNAVAILABLE" } }
      : { ...receipt, status: "send_failed", delivered: false }));
  }
  assert.equal(init.headers.Authorization, "Bearer synthetic-unused");
  if (url.includes("/workflows/")) return Response.json({ total_count: 100, workflow_runs: [1, 2, 3, 4, 5].map(run) });
  const artifactMatch = url.match(/actions\/runs\/(\d+)\/artifacts/);
  if (artifactMatch) {
    const id = Number(artifactMatch[1]);
    if (id === 4) return new Response(null, { status: 403 });
    return Response.json({ total_count: id === 3 ? 0 : 1, artifacts: id === 3 ? [] : [
      { id, name: "daily-digest-receipt", expired: false, size_in_bytes: 1000, created_at: "2026-10-16T23:01:00Z" },
    ] });
  }
  if (url.includes("/jobs?")) return Response.json({ jobs: [{ steps: [{ name: "Aggregate, render, and send daily digest", conclusion: "skipped" }] }] });
  if (url.includes("/zip")) return new Response(null, { status: 302, headers: { location: `https://example.blob/${url.match(/artifacts\/(\d+)/)[1]}` } });
  throw Error("unexpected URL");
}, now);
const options = { repository, token: "synthetic-unused" };
const result = await reader(options);
assert.equal(result.status, "partial");
assert.equal(result.read_status, "partial");
assert.deepEqual(result.read_reason_codes, ["run_listing_truncated", "notification_receipts_read_failed", "sender_skipped"]);
assert.deepEqual(result.items.map(item => item.status), ["delivered", "blocked_resend_guard", "sender_skipped", "read_failed", "send_failed"]);
assert.equal(result.items[1].reason_code, "HISTORY_UNAVAILABLE");
assert.equal(result.items[2].delivered, null, "successful workflow with skipped sender is not a delivery");
assert.ok(result.items.every(item => item.sent_at === null));
assert.ok(result.items.every(item => item.source_sha === sha && item.source_run_attempt === 1));
assert.equal(result.truncated, true);
assert.match(result.coverage, /daily_digest_public_receipts_only/);
assert.equal(result.no_order, true); assert.equal(result.execution_authority_granted, false);
const count = calls.length;
assert.deepEqual(await reader(options), result); assert.equal(calls.length, count, "cache avoids repeated GitHub reads");
assert.equal((await reader({ repository })).status, "not_connected");
const empty = createNotificationLogReader(async () => Response.json({ workflow_runs: [], total_count: 0 }), now);
assert.deepEqual((await empty(options)).items, []); assert.equal((await empty(options)).status, "ok", "connected empty history is not disconnected");
assert.equal((await empty(options)).read_status, "no_data");
assert.deepEqual((await empty(options)).read_reason_codes, ["no_completed_workflow_runs"]);
const denied = createNotificationLogReader(async () => new Response(null, { status: 403 }), now);
assert.equal((await denied(options)).status, "read_failed", "access failures cannot become empty history");
assert.equal((await denied(options)).read_status, "read_failed");
assert.deepEqual((await denied(options)).read_reason_codes, ["notification_receipts_read_failed"]);
let inspected = 0;
const priorAttempt = createNotificationLogReader(async url => {
  if (url.includes("/workflows/")) return Response.json({ workflow_runs: [{ ...run(1), run_attempt: 2 }] });
  if (url.includes("/artifacts")) return Response.json({ artifacts: [{ id: 1, name: "daily-digest-receipt", created_at: "2026-10-16T22:00:00Z" }] });
  inspected++; return Response.json({ jobs: [] });
}, now);
assert.equal((await priorAttempt(options)).items[0].status, "receipt_missing", "a previous attempt receipt cannot certify the latest attempt");
assert.equal(inspected, 1);

// WEB-GAP-FIX-04: receipt coverage is separate from workflow success or delivery.
async function scenario({ listing = { total_count: 1, workflow_runs: [run(1)] },
  artifact = "present", payload = receipt, deniedIds = [] } = {}) {
  const requests = [];
  const read = createNotificationLogReader(async (url, init) => {
    requests.push(url);
    assert.equal(init.method, "GET", "reader cannot dispatch, send, or mutate storage");
    if (url.includes("/workflows/")) return Response.json(listing);
    if (url.includes("/artifacts?")) {
      const id = Number(url.match(/runs\/(\d+)/)[1]);
      if (deniedIds.includes(id)) return new Response("private provider detail", { status: 403 });
      return Response.json({ total_count: artifact === "missing" || artifact === "skipped" ? 0 : 1,
        artifacts: artifact === "missing" || artifact === "skipped" ? [] : [{
          id, name: "daily-digest-receipt", expired: artifact === "expired", size_in_bytes: 1000,
          created_at: "2026-10-16T23:01:00Z",
        }] });
    }
    if (url.includes("/jobs?")) return Response.json({ total_count: 1, jobs: [{ steps: [{
      name: "Aggregate, render, and send daily digest", conclusion: artifact === "skipped" ? "skipped" : "success",
    }] }] });
    if (url.endsWith("/zip")) return new Response(zip(payload));
    throw Error("private unexpected URL");
  }, now);
  const body = await read(options);
  validate("notification_log", body);
  assert.doesNotMatch(JSON.stringify(body), /private|synthetic-unused|Authorization|never expose|invented_timestamp/);
  return { body, requests };
}
for (const [artifact, reason] of [["missing", "receipt_missing"], ["expired", "receipt_expired"], ["skipped", "sender_skipped"]]) {
  const { body, requests } = await scenario({ artifact });
  assert.equal(body.status, "partial", "a successful workflow without readable receipts cannot certify coverage");
  assert.equal(body.read_status, "partial");
  assert.deepEqual(body.read_reason_codes, [reason]);
  assert.equal(body.unavailable_reason, "notification_receipts_incomplete");
  assert.equal(body.items[0].delivered, null);
  assert.equal(body.items[0].sent_at, null);
  assert.equal(requests.some(url => url.endsWith("/zip")), false);
}
for (const payload of [receipt, { ...receipt, status: "send_failed", delivered: false },
  { ...receipt, status: "dry_run", delivered: false, dry_run: true }]) {
  const { body } = await scenario({ payload });
  assert.equal(body.status, "ok");
  assert.equal(body.read_status, "complete", "complete reads do not certify delivery");
  assert.deepEqual(body.read_reason_codes, []);
  assert.equal(body.items[0].status, payload.status);
  assert.equal(body.items[0].business_day, receipt.business_day);
  assert.equal(body.items[0].report_date, receipt.report_date);
  assert.equal(body.items[0].workflow_updated_at, run(1).updated_at);
  assert.equal(body.items[0].sent_at, null);
}
for (const [listing, status, reasons] of [
  [{ workflow_runs: [] }, "unknown", ["run_listing_coverage_unknown"]],
  [{ total_count: 2, workflow_runs: [] }, "partial", ["run_listing_incomplete"]],
  [{ total_count: 2, workflow_runs: [run(1)] }, "partial", ["run_listing_incomplete"]],
  [{ total_count: 6, workflow_runs: [1, 2, 3, 4, 5].map(run) }, "partial", ["run_listing_truncated"]],
  [{ workflow_runs: [run(1)] }, "partial", ["run_listing_coverage_unknown"]],
]) {
  const { body } = await scenario({ listing });
  assert.equal(body.read_status, status);
  assert.equal(body.status, "partial");
  assert.deepEqual(body.read_reason_codes, reasons);
}
for (const listing of [{ total_count: -1, workflow_runs: [] }, { total_count: 0, workflow_runs: [run(1)] },
  { total_count: "1", workflow_runs: [run(1)] }]) {
  const { body } = await scenario({ listing });
  assert.equal(body.status, "read_failed");
  assert.equal(body.read_status, "read_failed");
  assert.deepEqual(body.items, []);
}
for (const deniedIds of [[1], [1, 2]]) {
  const { body } = await scenario({ listing: { total_count: 2, workflow_runs: [run(1), run(2)] }, deniedIds });
  assert.equal(body.read_status, deniedIds.length === 1 ? "partial" : "read_failed");
  assert.deepEqual(body.read_reason_codes, ["notification_receipts_read_failed"]);
  assert.equal(body.items.length, 2, "partial receipts survive read errors");
}
const invalidRun = await scenario({ listing: { total_count: 1, workflow_runs: [{ ...run(1), head_branch: "private-branch" }] } });
assert.equal(invalidRun.body.read_status, "read_failed");
assert.deepEqual(invalidRun.body.items, []);
assert.deepEqual(invalidRun.body.read_reason_codes, ["notification_receipts_read_failed"]);
const malformedRun = await scenario({ listing: { total_count: 2, workflow_runs: [null, run(1)] } });
assert.equal(malformedRun.body.read_status, "partial");
assert.equal(malformedRun.body.items.length, 1, "malformed run cannot discard other readable receipts");
for (const body of [await notificationLog(), await reader({ repository })]) {
  validate("notification_log", body);
  assert.equal(body.read_status, "not_connected");
  assert.deepEqual(body.read_reason_codes, ["notification_log_not_connected"]);
}
let reads = 0;
const deps = { json: (body, status = 200) => Response.json(body, { status }), readSession: async () => ({ allowed: false }), notificationReceipts: async () => { reads++; return result; } };
assert.equal((await consoleApiResponse(new Request("https://console.example/api/notifications/send-log"), {}, deps)).status, 401);
assert.equal(reads, 0);
const response = await consoleApiResponse(new Request("https://console.example/api/notifications/send-log"), {}, { ...deps, readSession: async () => ({ allowed: true }) });
assert.deepEqual(await response.json(), result); assert.equal(reads, 1);
console.log("console_notification_receipts_validation: PASS (public ZIP, receipt provenance, GET-only, auth, send/blocked/skipped/failure, empty/error, no guessed send time, cache)");
