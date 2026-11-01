// Validates that current_strategies_cache KV writes stay quota-safe:
// one write on cold miss, none while the rendered content is unchanged (until the
// 20-minute ts keep-alive bump), and — the case that defeats a whole-payload
// comparison — none when only execution_evidence.observed_at moved.
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

// 2) Follow-up request inside the memo window: zero writes.
await requestConfig();
assert.equal(puts, 1, "fresh memo must not write");

// 3) Past the memo window with unchanged content and a recently bumped entry.
nowOffset += 61_000;
await requestConfig();
assert.equal(puts, 1, "unchanged content within the bump interval must skip the write");

// 4) Stored entry aged past the 20-minute bump interval: one keep-alive rewrite.
nowOffset += 1_200_000;
await requestConfig();
assert.equal(puts, 2, "aged cache entry must take one keep-alive bump");

// 5) The bump path must not degenerate into per-request writes again.
nowOffset += 61_000;
await requestConfig();
assert.equal(puts, 2, "post-bump requests must stay write-free");

// Direct helper cases: the production payload re-stamps
// execution_evidence.observed_at with new Date() on every build, so equality has to
// ignore those stamps while still catching a real change.
const { writeCurrentStrategiesCache, currentStrategiesSignature } = __test;
const evidencePayload = (observedAt, netAssets) => ({
  longbridge: {
    hk: { execution_evidence: { status: "reported", observed_at: observedAt }, net_assets: netAssets },
  },
  // Evidence rows carry data-derived timestamps; only observed_at is stamped per build.
  accounts: [{ execution_evidence: { observed_at: observedAt, rows: [{ at: "2026-10-30T12:00:00.000Z" }] }, status: "ok" }],
});

const isolatedStore = new Map();
let isolatedPuts = 0;
const isolatedEnv = {
  ...env,
  STRATEGY_SWITCH_CONFIG: {
    async get(key) { return isolatedStore.has(key) ? isolatedStore.get(key) : null; },
    async put(key, value) { isolatedPuts++; isolatedStore.set(key, value); },
    async list() { return { keys: [] }; },
    async delete(key) { isolatedStore.delete(key); },
  },
};

const write = async (payload, ts) => writeCurrentStrategiesCache(isolatedEnv, payload, ts);
const baseTs = 1_793_500_000_000;

await write(evidencePayload("2026-11-01T04:00:00.000Z", "100"), baseTs);
assert.equal(isolatedPuts, 1, "first cache population must write");

await write(evidencePayload("2026-11-01T04:05:00.000Z", "100"), baseTs + 300_000);
assert.equal(isolatedPuts, 1, "observed_at-only change must not write");

await write(evidencePayload("2026-11-01T04:10:00.000Z", "100"), baseTs + 600_000);
assert.equal(isolatedPuts, 1, "repeated cron ticks on unchanged content must not write");

await write(evidencePayload("2026-11-01T04:25:00.000Z", "100"), baseTs + 1_500_000);
assert.equal(isolatedPuts, 2, "content that only carries new stamps still needs one keep-alive bump");

const stored = JSON.parse(isolatedStore.get("current_strategies_cache"));
assert.equal(stored.data.longbridge.hk.execution_evidence.observed_at, "2026-11-01T04:25:00.000Z",
  "the stored payload must keep its own stamps for readers");
assert.equal(stored.ts, baseTs + 1_500_000);

await write(evidencePayload("2026-11-01T04:26:00.000Z", "250"), baseTs + 1_560_000);
assert.equal(isolatedPuts, 3, "a real content change must write immediately, inside the bump interval");

assert.notEqual(
  currentStrategiesSignature(evidencePayload("2026-11-01T04:00:00.000Z", "100")),
  currentStrategiesSignature(evidencePayload("2026-11-01T04:00:00.000Z", "101")),
  "signature must distinguish rendered values",
);

Date.now = realNow;
globalThis.fetch = realFetch;
console.log("console_current_strategies_kv_dedup_validation: PASS");
