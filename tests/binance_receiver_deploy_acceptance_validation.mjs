import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyBinanceAccountFactsReceiver } from "../scripts/verify_binance_account_facts_receiver.mjs";

const workflow = readFileSync(new URL("../.github/workflows/deploy-strategy-switch-console.yml", import.meta.url), "utf8");
const manualWorkflow = readFileSync(new URL("../.github/workflows/verify-binance-account-facts-receiver.yml", import.meta.url), "utf8");
const syncIndex = workflow.indexOf("- name: Sync optional Binance account-facts credentials");
const verifyIndex = workflow.indexOf("- name: Verify optional Binance account-facts receiver credentials");
assert.ok(syncIndex >= 0 && verifyIndex > syncIndex);
assert.match(workflow.slice(verifyIndex, verifyIndex + 320), /if: env\.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN != ''/);
assert.match(workflow.slice(verifyIndex, verifyIndex + 320), /scripts\/verify_binance_account_facts_receiver\.mjs/);
assert.match(manualWorkflow, /workflow_dispatch:/);
assert.match(manualWorkflow, /verify_receiver:[\s\S]{0,180}default: false/);
assert.doesNotMatch(manualWorkflow, /^\s+(?:push|schedule):/m);
assert.match(manualWorkflow, /environment: runtime-strategy-switch/);
assert.match(manualWorkflow, /STRATEGY_SWITCH_CONSOLE_URL: \$\{\{ vars\.STRATEGY_SWITCH_CONSOLE_URL \}\}/);
assert.match(manualWorkflow, /BINANCE_ACCOUNT_FACTS_SYNC_TOKEN: \$\{\{ secrets\.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN \}\}/);
assert.match(manualWorkflow, /EXPECTED_MAIN_SHA: \$\{\{ inputs\.expected_main_sha \}\}/);
assert.match(manualWorkflow, /git fetch --quiet --no-tags origin main/);
assert.doesNotMatch(manualWorkflow, /wrangler|secret put|kv key put|wrangler deploy/i);
assert.match(manualWorkflow, /group: strategy-switch-console-deploy/);

let calls = [];
const skipped = await verifyBinanceAccountFactsReceiver({
  consoleUrl: "https://console.example",
  token: "",
  fetchImpl: async (...args) => { calls.push(args); throw new Error("must not call"); },
});
assert.deepEqual(skipped, { status: "skipped" });
assert.equal(calls.length, 0);

const token = "synthetic-token-never-print";
const verified = await verifyBinanceAccountFactsReceiver({
  consoleUrl: "https://console.example/",
  token,
  fetchImpl: async (...args) => {
    calls.push(args);
  return new Response(JSON.stringify({ ok: false, error: "invalid_binance_account_facts" }), { status: 400 });
  },
});
assert.deepEqual(verified, { status: "verified", httpStatus: 400 });
assert.equal(calls.length, 1);
assert.equal(calls[0][0], "https://console.example/api/internal/binance-account-facts");
assert.equal(calls[0][1].method, "POST");
assert.equal(calls[0][1].body, "{}");
assert.equal(calls[0][1].redirect, "manual");
assert.equal(calls[0][1].headers.Authorization, `Bearer ${token}`);
assert.equal(calls[0][1].signal.aborted, false);

for (const [response, category, status] of [
  [new Response(JSON.stringify({ ok: false, error: "binance_account_facts_token_invalid" }), { status: 401 }), "token_invalid", 401],
  [new Response(JSON.stringify({ ok: false, error: "binance_account_facts_binding_unmatched" }), { status: 409 }), "binding_unmatched", 409],
  [new Response(JSON.stringify({ ok: false, error: "binance_account_facts_binding_missing" }), { status: 503 }), "config_or_binding", 503],
  [new Response(JSON.stringify({ ok: false, error: "binance_account_facts_storage_unavailable" }), { status: 503 }), "unknown", 503],
  [new Response("synthetic private body", { status: 404 }), "route_not_found", 404],
  [new Response(JSON.stringify({ ok: false, error: "invalid_binance_account_facts" }), { status: 302 }), "redirect", 302],
  [new Response(JSON.stringify({ ok: false, error: "invalid_account_facts" }), { status: 400 }), "unknown", 400],
  [new Response("synthetic private body", { status: 400 }), "unknown", 400],
]) {
  await assert.rejects(
    verifyBinanceAccountFactsReceiver({ consoleUrl: "https://console.example", token,
      fetchImpl: async () => response }),
    error => error.category === category && error.httpStatus === status
      && error.message === category
      && !error.message.includes(token) && !error.message.includes("synthetic private body"),
  );
}

calls = [];
await assert.rejects(
  verifyBinanceAccountFactsReceiver({ consoleUrl: "https://console.example", token,
    fetchImpl: async (...args) => { calls.push(args); throw new Error("sensitive transport details"); } }),
  error => error.category === "transport" && error.httpStatus === null
    && !error.message.includes(token),
);
assert.equal(calls.length, 1, "transport failure is not retried");

calls = [];
await assert.rejects(
  verifyBinanceAccountFactsReceiver({ consoleUrl: "https://console.example", token, timeoutMs: 1,
    fetchImpl: async (...args) => {
      calls.push(args);
      assert.ok(args[1].signal instanceof AbortSignal);
      throw new DOMException("timeout", "TimeoutError");
    } }),
  error => error.category === "transport" && error.httpStatus === null
    && !error.message.includes(token),
);
assert.equal(calls.length, 1, "timeout is not retried");

for (const consoleUrl of ["http://console.example", "https://user:pass@console.example", "not a URL"]) {
  await assert.rejects(
    verifyBinanceAccountFactsReceiver({ consoleUrl, token, fetchImpl: async () => { throw new Error("must not call"); } }),
    error => error.category === "configuration_invalid",
  );
}

console.log("Binance receiver deployment acceptance: token-gated, exact empty POST, closed response handling and no retry PASS");
