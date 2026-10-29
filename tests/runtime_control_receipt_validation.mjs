import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { runControls } from "../web/strategy-switch-console/application/console_api/run_controls.js";
import { readRuntimeControlReceipt } from "../web/strategy-switch-console/application/console_api/runtime_control_receipts.js";
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

const requestId = "12345678-1234-4abc-8def-123456789abc";
const receipt = { request_id: requestId, operation: "enable", run_id: "123", attempt: "1", status: "applied" };
const run = { workflow_id: 10, id: 123, run_attempt: 1, event: "workflow_dispatch", head_branch: "main", display_title: `Runtime control ${requestId}`, status: "completed" };
const listing = { total_count: 1, artifacts: [{ name: "runtime-control-safe-123-1", id: 12, size_in_bytes: 1024 }] };
function reader(override = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/actions/workflows/manual-runtime-stop.yml/runs?')) return Response.json({ total_count: 1, workflow_runs: [run] });
    if (String(url).includes('/actions/workflows/')) return Response.json({ path: '.github/workflows/manual-runtime-stop.yml', id: 10 });
    if (String(url).includes('/actions/runs/123/artifacts')) return Response.json(override.listing || listing);
    if (String(url).includes('/actions/runs/123')) return Response.json(override.run || run);
    if (String(url).includes('/actions/artifacts/12/zip')) return new Response(null, { status: 302, headers: { location: 'https://artifact.example/safe' } });
    return new Response(zip(override.receipt || receipt, 0, 'runtime-control.safe.json'));
  };
  return { requests, fetchImpl };
}
const input = { repository: 'example/console', token: 'synthetic-token', requestId, operation: 'enable', runId: '123' };
const recovery = reader();
assert.equal((await readRuntimeControlReceipt({ ...input, runId: null, requestedAt: '2026-01-01T00:00:00.000Z', fetchImpl: recovery.fetchImpl })).status, 'applied');
assert.ok(recovery.requests.some(item => item.url.includes('created=')));
const valid = reader();
assert.equal((await readRuntimeControlReceipt({ ...input, fetchImpl: valid.fetchImpl })).status, 'applied');
assert.equal(valid.requests.at(-1).options.headers, undefined);
for (const override of [{ run: { ...run, display_title: 'other' } }, { receipt: { ...receipt, request_id: 'other' } }, { listing: { total_count: 2, artifacts: [...listing.artifacts, ...listing.artifacts] } }]) {
  const mock = reader(override);
  assert.equal((await readRuntimeControlReceipt({ ...input, fetchImpl: mock.fetchImpl })).status, 'unknown');
}
for (const phase of ["reserved", "accepted", "unknown", "partial"]) {
  const controls = await runControls({ key: "synthetic", platform: "ibkr" }, { admin: true }, {
    dispatchAvailable: true, platformControl: async () => ({ phase }), profileState: async () => ({ ready: false }) });
  assert.equal(controls.actions.enable.enabled, false);
  assert.equal(controls.actions.stop.enabled, false);
}
const controls = await runControls({ key: "synthetic", platform: "ibkr" }, { admin: true }, {
  dispatchAvailable: true, platformControl: async () => ({ phase: "applied" }), profileState: async () => ({ ready: false }) });
assert.equal(controls.actions.enable.enabled, true);
assert.equal(controls.actions.stop.enabled, true);
const denied = await runControls({ key: "synthetic", platform: "ibkr" }, { admin: false }, {
  dispatchAvailable: true, platformControl: async () => { throw Error("must not read"); } });
assert.equal(denied.actions.enable.reason, "admin_required");
console.log('runtime control receipt: PASS');
