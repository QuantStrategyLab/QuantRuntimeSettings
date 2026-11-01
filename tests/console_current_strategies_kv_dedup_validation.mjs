// Validates that current_strategies_cache KV writes stay quota-safe.
// The case that matters is the production one: every build re-stamps
// execution_evidence.observed_at with new Date(), so the payload bytes always
// differ while the rendered content does not.
import assert from "node:assert/strict";
import worker, { __test } from "./helpers/directory_worker.mjs";

const realNow = Date.now.bind(Date);
let nowOffset = 0;
Date.now = () => realNow() + nowOffset;

const realFetch = globalThis.fetch;
let fetchAttempts = 0;
globalThis.fetch = async () => { fetchAttempts++; throw new Error("synthetic_network_off"); };

const account = {
  key: "default", label: "Binance", target_name: "crypto_live_pool_rotation",
  runtime_status_target_id: "binance.crypto_live_pool_rotation", supported_domains: ["crypto"],
  service_name: "binance-platform", default_execution_mode: "live",
};
// With no network the Worker answers with the read_failed evidence fallback, whose
// only per-build difference is observed_at — the exact shape the live cron produces.
const env = {
  SESSION_SECRET: "synthetic-dedup-only",
  ALLOWED_GITHUB_LOGINS: "fixture-reader",
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ binance: [account] }),
  STRATEGY_SWITCH_CONFIG: {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { puts++; store.set(key, value); },
    async list() { return { keys: [] }; },
    async delete(key) { store.delete(key); },
  },
};

const store = new Map();
let puts = 0;

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

const storedCache = () => JSON.parse(store.get("current_strategies_cache"));

// 1) Cold miss: exactly one cache write, and the payload really carries evidence.
await requestConfig();
assert.equal(puts, 1, "cold miss must write the cache once");
assert.ok(storedCache().data.binance.default.execution_evidence.observed_at,
  "the fixture payload must include the per-build stamp the production payload has");

// 2) Follow-up request inside the memo window: zero writes.
await requestConfig();
assert.equal(puts, 1, "fresh memo must not write");

// 3) Past the memo window: the refresh rebuilds the payload with a new observed_at,
//    which byte-comparison calls "changed". Content comparison must skip the write.
nowOffset += 61_000;
await requestConfig();
assert.equal(puts, 1, "observed_at-only change must not write");
assert.ok(storedCache().data.binance.default.execution_evidence.observed_at,
  "the stored entry keeps the stamp it was written with");

// 4) Stored entry aged past the 15-minute keep-alive ceiling: one rewrite.
nowOffset += 900_000;
await requestConfig();
assert.equal(puts, 2, "aged cache entry must take one keep-alive bump");

// 5) The bump path must not degenerate into per-request writes again.
nowOffset += 61_000;
await requestConfig();
assert.equal(puts, 2, "post-bump requests must stay write-free");

// Direct helper cases pin the boundaries and the failure modes the HTTP timeline
// cannot reach from a single isolate.
const { writeCurrentStrategiesCache, currentStrategiesSignature, isDegradedCurrentStrategies } = __test;
const evidencePayload = (observedAt, netAssets) => ({
  longbridge: {
    hk: { execution_evidence: { status: "reported", observed_at: observedAt }, net_assets: netAssets },
  },
  // Evidence rows carry data-derived timestamps; only observed_at is stamped per build.
  accounts: [{ execution_evidence: { observed_at: observedAt, rows: [{ at: "2026-10-30T12:00:00.000Z" }] }, status: "ok" }],
});

function makeIsolatedEnv(initial) {
  const isolatedStore = new Map(initial ?? []);
  const state = { puts: 0 };
  return {
    state,
    env: {
      ...env,
      STRATEGY_SWITCH_CONFIG: {
        async get(key) { return isolatedStore.has(key) ? isolatedStore.get(key) : null; },
        async put(key, value) { state.puts++; isolatedStore.set(key, value); },
        async list() { return { keys: [] }; },
        async delete(key) { isolatedStore.delete(key); },
      },
    },
    raw: { store: isolatedStore },
  };
}

const baseTs = 1_793_500_000_000;
const bump = __test.currentStrategiesKvBumpMs;
const fixture = makeIsolatedEnv();
const write = (payload, ts) => writeCurrentStrategiesCache(fixture.env, payload, ts);

await write(evidencePayload("2026-11-01T04:00:00.000Z", "100"), baseTs);
assert.equal(fixture.state.puts, 1, "first cache population must write");

await write(evidencePayload("2026-11-01T04:05:00.000Z", "100"), baseTs + 300_000);
await write(evidencePayload("2026-11-01T04:10:00.000Z", "100"), baseTs + 600_000);
assert.equal(fixture.state.puts, 1, "repeated cron ticks on unchanged content must not write");

// Exactly at the ceiling the entry is no longer inside it, so the keep-alive fires.
await write(evidencePayload("2026-11-01T04:15:00.000Z", "100"), baseTs + bump);
assert.equal(fixture.state.puts, 2, "a stored entry at the bump ceiling must be rewritten");

await write(evidencePayload("2026-11-01T04:20:00.000Z", "100"), baseTs + bump + 300_000);
assert.equal(fixture.state.puts, 2, "the fresh bump buys another full interval of no writes");

const stored = JSON.parse(fixture.raw.store.get("current_strategies_cache"));
assert.equal(stored.data.longbridge.hk.execution_evidence.observed_at, "2026-11-01T04:15:00.000Z",
  "the stored payload must keep its own stamps for readers");
assert.equal(stored.ts, baseTs + bump);

await write(evidencePayload("2026-11-01T04:26:00.000Z", "250"), baseTs + bump + 360_000);
assert.equal(fixture.state.puts, 3, "a real content change must write immediately, inside the bump interval");

// A damaged stored value must not wedge the cache forever.
const broken = makeIsolatedEnv([["current_strategies_cache", "{not json"]]);
await writeCurrentStrategiesCache(broken.env, evidencePayload("2026-11-01T04:00:00.000Z", "100"), baseTs);
assert.equal(broken.state.puts, 1, "an unparseable stored value must be overwritten");

assert.notEqual(
  currentStrategiesSignature(evidencePayload("2026-11-01T04:00:00.000Z", "100")),
  currentStrategiesSignature(evidencePayload("2026-11-01T04:00:00.000Z", "101")),
  "signature must distinguish rendered values",
);

// The read_failed fallback carries no strategy information, so it must never be
// served as a fresh entry for the length of the KV window — and a payload that
// really did render (the captured entry above carries not_connected evidence) must
// keep the window, otherwise the guard silently disables the whole optimization.
assert.equal(isDegradedCurrentStrategies({
  binance: { default: { execution_evidence: { status: "read_failed", observed_at: "2026-11-01T04:00:00.000Z" } } },
}), true, "the evidence-only read_failed shape must count as degraded");
assert.equal(isDegradedCurrentStrategies(storedCache().data), false,
  "a rendered payload must not count as degraded");
assert.equal(isDegradedCurrentStrategies({
  binance: { default: { execution_evidence: { status: "read_failed" }, current_strategy: "x" } },
}), false, "an account carrying strategy data is not degraded");
assert.equal(isDegradedCurrentStrategies({}), false,
  "an unconfigured account set is not a read failure");

// The freshness windows must leave slack for a missed cron tick: an entry that is
// only kept alive at the bump ceiling still has to land inside the KV fresh window.
assert.ok(bump + 300_000 <= __test.currentStrategiesKvFreshMs,
  "bump ceiling plus one 5-minute tick must stay inside the KV fresh window");

Date.now = realNow;
globalThis.fetch = realFetch;
console.log(`console_current_strategies_kv_dedup_validation: PASS (fetch attempts ${fetchAttempts})`);
