// Validates that current_strategies_cache KV writes are quota-deduplicated:
// one write on cold miss, none while the payload is unchanged (until the
// 10-minute ts keep-alive bump), and a bump once the stored entry ages out.
import assert from "node:assert/strict";
import worker, { __test } from "./helpers/directory_worker.mjs";

const realNow = Date.now.bind(Date);
let nowOffset = 0;
Date.now = () => realNow() + nowOffset;

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("synthetic_network_off"); };

const store = new Map();
let puts = 0;
const env = {
  SESSION_SECRET: "synthetic-dedup-only",
  ALLOWED_GITHUB_LOGINS: "fixture-reader",
  STRATEGY_SWITCH_CONFIG: {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { puts++; store.set(key, value); },
    async list() { return { keys: [] }; },
    async delete(key) { store.delete(key); },
  },
};

const session = await __test.makeSession("fixture-reader", [], env);
let pending = [];
const ctx = { waitUntil(promise) { pending.push(Promise.resolve(promise).catch(() => {})); } };

const requestConfig = async () => {
  const response = await worker.fetch(new Request("https://synthetic.invalid/api/config", {
    headers: { Cookie: `qsl_switch_session=${session}` },
  }), env, ctx);
  assert.equal(response.status, 200);
  await Promise.allSettled(pending);
  pending = [];
};

// 1) Cold miss: exactly one cache write.
await requestConfig();
assert.equal(puts, 1, "cold miss must write the cache once");

// 2) Follow-up request inside the fresh window: memo serves, zero writes.
await requestConfig();
assert.equal(puts, 1, "fresh memo must not write");

// 3) Past the 60s fresh TTL but payload unchanged and stored ts younger
//    than the 10-minute bump interval: background refresh writes nothing.
nowOffset += 61_000;
await requestConfig();
assert.equal(puts, 1, "unchanged payload within the bump interval must skip the write");

// 4) Stored ts aged past the bump interval: exactly one keep-alive rewrite.
nowOffset += 600_000;
await requestConfig();
assert.equal(puts, 2, "aged cache entry must take one keep-alive bump");

// 5) The bump path must not degenerate into per-request writes again.
nowOffset += 61_000;
await requestConfig();
assert.equal(puts, 2, "post-bump requests must stay write-free");

Date.now = realNow;
globalThis.fetch = realFetch;
console.log("console_current_strategies_kv_dedup_validation: PASS");
