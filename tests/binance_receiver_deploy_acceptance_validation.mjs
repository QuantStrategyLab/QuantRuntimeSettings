import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyBinanceAccountFactsReceiver } from "../scripts/verify_binance_account_facts_receiver.mjs";

const workflow = readFileSync(new URL("../.github/workflows/deploy-strategy-switch-console.yml", import.meta.url), "utf8");
const syncIndex = workflow.indexOf("- name: Sync optional Binance account-facts credentials");
const verifyIndex = workflow.indexOf("- name: Verify optional Binance account-facts receiver credentials");
assert.ok(syncIndex >= 0 && verifyIndex > syncIndex);
assert.match(workflow.slice(verifyIndex, verifyIndex + 320), /if: env\.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN != ''/);
assert.match(workflow.slice(verifyIndex, verifyIndex + 320), /scripts\/verify_binance_account_facts_receiver\.mjs/);

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
assert.deepEqual(verified, { status: "verified" });
assert.equal(calls.length, 1);
assert.equal(calls[0][0], "https://console.example/api/internal/binance-account-facts");
assert.equal(calls[0][1].method, "POST");
assert.equal(calls[0][1].body, "{}");
assert.equal(calls[0][1].redirect, "manual");
assert.equal(calls[0][1].headers.Authorization, `Bearer ${token}`);
assert.equal(calls[0][1].signal.aborted, false);

for (const response of [
  new Response(JSON.stringify({ ok: false, error: "binance_account_facts_token_invalid" }), { status: 401 }),
  new Response(JSON.stringify({ ok: false, error: "binance_account_facts_binding_unmatched" }), { status: 409 }),
  new Response(JSON.stringify({ ok: false, error: "invalid_account_facts" }), { status: 400 }),
  new Response("synthetic private body", { status: 400 }),
  new Response(JSON.stringify({ ok: false, error: "invalid_binance_account_facts" }), { status: 302 }),
]) {
  await assert.rejects(
    verifyBinanceAccountFactsReceiver({ consoleUrl: "https://console.example", token,
      fetchImpl: async () => response }),
    error => error.message === "receiver_check_unexpected_response"
      && !error.message.includes(token) && !error.message.includes("synthetic private body"),
  );
}

calls = [];
await assert.rejects(
  verifyBinanceAccountFactsReceiver({ consoleUrl: "https://console.example", token,
    fetchImpl: async (...args) => { calls.push(args); throw new Error("sensitive transport details"); } }),
  error => error.message === "receiver_check_unavailable" && !error.message.includes(token),
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
  error => error.message === "receiver_check_unavailable" && !error.message.includes(token),
);
assert.equal(calls.length, 1, "timeout is not retried");

for (const consoleUrl of ["http://console.example", "https://user:pass@console.example", "not a URL"]) {
  await assert.rejects(
    verifyBinanceAccountFactsReceiver({ consoleUrl, token, fetchImpl: async () => { throw new Error("must not call"); } }),
    error => error.message === "receiver_check_configuration_invalid",
  );
}

console.log("Binance receiver deployment acceptance: token-gated, exact empty POST, closed response handling and no retry PASS");
