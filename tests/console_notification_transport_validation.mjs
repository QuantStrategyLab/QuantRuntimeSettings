import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../web/strategy-switch-console/frontend/package.json", import.meta.url));
const { buildSync } = require("esbuild");
const { Miniflare } = require("miniflare");
const sha = "a".repeat(40);
const receipt = { schema_version: "qsl.daily_digest_receipt.v1", projection: "public_summary", source_sha: sha,
  business_day: "2026-10-16", report_date: "2026-10-17", status: "delivered", delivered: true,
  dry_run: false, test_message: false, resend_guard: { reason: "FIRST_SEND" } };
function archive() {
  const body = Buffer.from(JSON.stringify(receipt)), name = Buffer.from("receipt-public.json");
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + body.length, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}
const script = buildSync({ stdin: { contents: `
  import { createNotificationLogReader } from "./application/console_api/notification_receipts.js";
  export default { async fetch() {
    const read = createNotificationLogReader(fetch, () => Date.parse("2026-10-17T00:00:00Z"));
    return Response.json(await read({ repository: "example/console", token: "synthetic-unused" }));
  } };`, resolveDir: fileURLToPath(new URL("../web/strategy-switch-console/", import.meta.url)) },
  bundle: true, format: "esm", platform: "browser", write: false }).outputFiles[0].text;

for (const redirectsAgain of [false, true]) {
  const calls = [];
  const mf = new Miniflare({
    cf: false,
    modules: true, script, compatibilityDate: "2026-06-08",
    outboundService(request) {
      const url = new URL(request.url); calls.push(url.hostname + url.pathname);
      assert.equal(request.method, "GET");
      if (url.hostname === "public-artifacts.example") {
        assert.equal(request.headers.get("Authorization"), null, "credential never reaches signed storage");
        return redirectsAgain ? new Response(null, { status: 302, headers: { location: "https://unexpected.example/private" } })
          : new Response(archive());
      }
      assert.equal(url.hostname, "api.github.com", "an extra redirect must never be followed");
      assert.equal(request.headers.get("Authorization"), "Bearer synthetic-unused");
      if (url.pathname.includes("/workflows/")) return Response.json({ workflow_runs: [{ id: 1,
        run_attempt: 1, head_sha: sha, head_branch: "main", head_repository: { full_name: "example/console" },
        event: "schedule", run_started_at: "2026-10-16T23:00:00Z", updated_at: "2026-10-16T23:02:00Z" }], total_count: 1 });
      if (url.pathname.endsWith("/artifacts")) return Response.json({ total_count: 1, artifacts: [{ id: 1,
        name: "daily-digest-receipt", size_in_bytes: 1000, created_at: "2026-10-16T23:01:00Z", expired: false }] });
      if (url.pathname.endsWith("/zip")) return new Response(null, { status: 302,
        headers: { location: "https://public-artifacts.example/receipt.zip" } });
      throw Error("unexpected synthetic request");
    } });
  try {
    const response = await mf.dispatchFetch("https://console.example/");
    const result = await response.json();
    assert.equal(result.items[0].status, redirectsAgain ? "read_failed" : "delivered",
      "exercise the real workerd Request/fetch boundary, not Node-only fetch mocks");
    assert.equal(calls.length, 4, "one list, artifact list, archive redirect and signed download; no retries");
    if (redirectsAgain) assert.equal(result.items[0].read_error_code, "artifact_download_http_other");
    assert.doesNotMatch(JSON.stringify(result), /synthetic-unused|public-artifacts|unexpected\.example/);
  } finally { await mf.dispose(); }
}
console.log("console_notification_transport_validation: PASS (actual workerd reader/download, no credential forwarding, extra redirects rejected, no retries)");
