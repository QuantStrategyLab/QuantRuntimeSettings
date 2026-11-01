import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { KvDirectory, directoryCommand, directoryList, directoryStatus, maintainDirectory, MANIFEST_KEY } from "../web/strategy-switch-console/kv_directory.js";

const values = new Map(), metadata = new Map();
const storage = { async get(key) { return structuredClone(metadata.get(key)); },
  async put(key, value) { metadata.set(key, structuredClone(value)); } };
let lists = 0, time = Date.parse("2026-10-16T02:40:00Z"), fail = true;
const kv = { async get(key) { return values.get(key) ?? null; },
  async put(key, value) { values.set(key, value); },
  async list() { lists++; if (fail) throw Error("KV list() limit exceeded for the day.");
    return { keys: [...values.keys()].map(name => ({ name })), list_complete: true }; } };
let directory = new KvDirectory(storage, kv, {}, () => time);
const read = { action: "read", prefix: "research_promotion_ticket:", limit: 100 };
const unknown = await directory.command({ action: "status" });
assert.equal(unknown.status, "unknown");
assert.equal(unknown.complete, null);
assert.equal(unknown.in_progress, null);
assert.equal(metadata.size, 0, "a status read must not initialize storage");
assert.equal((await directory.command(read)).error, "kv_directory_uninitialized");
for (let i = 0; i < 100; i++) assert.equal((await directory.command(read)).ok, false);
assert.equal(lists, 0, "a cold read cannot spend list quota");
assert.equal((await directory.command({ action: "maintain" })).error, "kv_list_daily_limit_exceeded");
const quotaStatus = await directory.command({ action: "status" });
assert.equal(quotaStatus.status, "incomplete");
assert.equal(quotaStatus.complete, false);
assert.equal(quotaStatus.last_success, null);
assert.deepEqual(quotaStatus.last_error, { code: "kv_list_daily_limit_exceeded", at: time });
assert.equal(quotaStatus.retry_at, Date.parse("2026-10-17T00:01:00Z"));
assert.equal(quotaStatus.in_progress, false);
assert.deepEqual(Object.keys(quotaStatus).sort(), ["ok", "status", "complete", "last_success", "last_error",
  "retry_at", "in_progress", "data_as_of", "unavailable_reason"].sort());
directory = new KvDirectory(storage, kv, {}, () => time);
for (let i = 0; i < 100; i++) await directory.command({ action: "maintain" });
assert.equal(lists, 1, "quota cooldown survives an object restart and repeated cron ticks");
await Promise.all(Array.from({ length: 20 }, (_, i) => directory.command({
  action: "put", key: `research_promotion_ticket:fixture-${i}`, value: JSON.stringify({ fixture: i }),
})));
assert.equal((await directory.command(read)).ok, false, "new writes do not prove legacy coverage");
assert.equal([...values.keys()].filter(k => k.startsWith("research_promotion_ticket:")).length, 20);
time = Date.parse("2026-10-17T00:01:01Z"); fail = false;
assert.equal((await directory.command({ action: "maintain" })).ok, true);
const completed = await directory.command({ action: "status" });
assert.equal(completed.status, "complete");
assert.equal(completed.data_as_of, time);
assert.equal(completed.last_success, time);
assert.equal(completed.retry_at, null);
assert.deepEqual(completed.last_error, quotaStatus.last_error, "successful recovery retains the last recorded error");
assert.equal((await directory.command(read)).keys.length, 20);
for (let i = 0; i < 100; i++) await directory.command(read);
assert.equal(lists, 2, "warm reads never call KV list");
assert.equal((await directory.command({ ...read, limit: 10 })).error, "kv_directory_truncated");
await directory.command({ action: "put", key: "research_promotion_ticket:new", value: "{}" });
assert.equal((await directory.command(read)).keys.length, 21);
assert.equal((await directory.command({ action: "maintain" })).ok, true);
assert.equal(lists, 2, "maintenance is cached for its configured interval");

const pagedState = new Map(); let pages = 0;
const paged = new KvDirectory({ async get(k) { return structuredClone(pagedState.get(k)); },
  async put(k, v) { pagedState.set(k, structuredClone(v)); } }, {
  async get() { return null; }, async put() {}, async list(options) { pages++;
    return options.cursor ? { keys: [{ name: "control_plane_source:last" }], list_complete: true }
      : { keys: [{ name: "control_plane_source:first" }], list_complete: false, cursor: "next" };
  },
}, { KV_DIRECTORY_PAGE_DELAY_SECONDS: "30" }, () => time);
assert.equal((await paged.command({ action: "maintain" })).error, "kv_directory_migration_pending");
assert.equal((await paged.command({ action: "status" })).in_progress, true);
assert.equal((await paged.command({ action: "read", prefix: "control_plane_source:", limit: 100 })).ok, false);
await paged.command({ action: "put", key: "control_plane_source:concurrent", value: "{}" });
time += 31_000;
assert.equal((await paged.command({ action: "maintain" })).ok, true);
assert.equal(pages, 2);
assert.equal((await paged.command({ action: "read", prefix: "control_plane_source:", limit: 100 })).keys.length, 3,
  "a publisher between migration pages is retained");

// A reconciliation re-scan of a complete directory keeps serving the last
// completed snapshot while it pages, and skips KV mirror writes on pages
// where nothing mirror-visible changed.
const reconcileValues = new Map(), reconcileState = new Map();
let reconcileLists = 0, reconcileMirrorPuts = 0, reconcilePaged = false;
const reconcileTime = { value: 1_800_000_000_000 };
const reconcile = new KvDirectory({
  async get(key) { return structuredClone(reconcileState.get(key)); },
  async put(key, value) { reconcileState.set(key, structuredClone(value)); },
}, {
  async get(key) { return reconcileValues.get(key) ?? null; },
  async put(key, value) { reconcileMirrorPuts++; reconcileValues.set(key, value); },
  async list(options) {
    reconcileLists++;
    if (!reconcilePaged) return { keys: [{ name: "control_plane_source:known" },
      { name: "control_plane_source:out-of-band" }], list_complete: true };
    if (!options.cursor) return { keys: [{ name: "control_plane_source:late" }],
      list_complete: false, cursor: "page-2" };
    if (options.cursor === "page-2") return { keys: [{ name: "control_plane_source:known" }],
      list_complete: false, cursor: "page-3" };
    return { keys: [], list_complete: true };
  },
}, {}, () => reconcileTime.value);
for (let i = 0; i < 3; i++) await reconcile.command({ action: "put", key: `control_plane_source:known-${i}`, value: "{}" });
assert.equal((await reconcile.command({ action: "maintain" })).complete, true);
const migrationScannedAt = (await reconcile.command({ action: "status" })).data_as_of;
const reconcileMirrorPutsAfterMigration = reconcileMirrorPuts;
reconcilePaged = true;
reconcileTime.value += 86_401_000; // past the configured reconcile interval
assert.equal((await reconcile.command({ action: "maintain" })).ok, true, "page 1 of a re-scan succeeds");
assert.equal((await reconcile.command({ action: "read", prefix: "control_plane_source:", limit: 100 })).ok, true,
  "reads keep working between re-scan pages");
assert.equal((await reconcile.command({ action: "read", prefix: "control_plane_source:", limit: 100 })).keys.length, 6,
  "the served snapshot includes keys discovered by the page in flight");
assert.equal(reconcileMirrorPuts, reconcileMirrorPutsAfterMigration + 1,
  "a page that discovers new keys mirrors them immediately");
assert.equal((await reconcile.command({ action: "status" })).in_progress, true,
  "a completed snapshot with a pending reconciliation cursor is still in progress");
const listsAfterFirstPage = reconcileLists;
assert.deepEqual(await reconcile.command({ action: "maintain" }),
  { ok: true, complete: true, count: 6, scanned_at: migrationScannedAt, cached: true },
  "a second invocation inside the page delay reuses the in-flight snapshot");
assert.equal(reconcileLists, listsAfterFirstPage, "the page-delay window must not list again");
reconcileTime.value += 61_000;
await reconcile.command({ action: "maintain" });
assert.equal(reconcileMirrorPuts, reconcileMirrorPutsAfterMigration + 1,
  "a page that adds no mirror-visible change must not rewrite the mirror");
reconcileTime.value += 61_000;
assert.equal((await reconcile.command({ action: "maintain" })).ok, true);
assert.equal((await reconcile.command({ action: "status" })).complete, true);
assert.equal((await reconcile.command({ action: "status" })).data_as_of, reconcileTime.value,
  "the re-scan stamps scanned_at only when the last page completes");
assert.equal(reconcileMirrorPuts, reconcileMirrorPutsAfterMigration + 2,
  "the completion page mirrors the new scanned_at exactly once");

// One synthetic day of five-minute cron ticks spends one List and mirror write.
const dailyState = new Map(); let dailyLists = 0, dailyPuts = 0;
let dailyNow = Date.parse("2026-11-01T00:02:00Z");
const dailyStorage = { async get(k) { return structuredClone(dailyState.get(k)); },
  async put(k, v) { dailyState.set(k, structuredClone(v)); } };
const dailyKv = { async get() { return null; }, async put() { dailyPuts++; },
  async list() { dailyLists++; return { keys: [], list_complete: true }; } };
for (let tick = 0; tick < 288; tick++) {
  await new KvDirectory(dailyStorage, dailyKv, {}, () => dailyNow).command({ action: "maintain" });
  dailyNow += 300_000;
}
assert.equal(dailyLists, 1, "default reconciliation cuts daily lists from four to one");
assert.equal(dailyPuts, 1, "default reconciliation cuts daily mirror writes from four to one");
// Explicit refreshes and object restarts share a persisted 100-attempt UTC budget.
for (let tick = 0; tick < 120; tick++) {
  dailyNow = Date.parse("2026-11-01T01:00:00Z") + tick * 61_000;
  await new KvDirectory(dailyStorage, dailyKv, {}, () => dailyNow).command({ action: "maintain", refresh: true });
}
assert.equal(dailyLists, 100, "manual refresh cannot exhaust the account's 1000-list allowance");
const budgetStatus = await new KvDirectory(dailyStorage, dailyKv, {}, () => dailyNow).command({ action: "status" });
assert.equal(budgetStatus.last_error.code, "kv_directory_list_budget_exceeded");
assert.equal(budgetStatus.retry_at, Date.parse("2026-11-02T00:01:00Z"));
dailyNow = budgetStatus.retry_at;
assert.equal((await new KvDirectory(dailyStorage, dailyKv, {}, () => dailyNow).command({ action: "maintain" })).ok, true);
assert.equal(dailyLists, 101, "the UTC reset opens a new budget");

// A failed re-scan keeps the loud failure contract: the directory reports
// the error, refuses reads and stays on the daily quota cooldown.
const quotaReconcileValues = new Map(), quotaReconcileState = new Map();
let quotaReconcileLists = 0, quotaReconcileFailing = false;
const quotaReconcileTime = { value: 1_800_000_000_000 };
const quotaReconcile = new KvDirectory({
  async get(key) { return structuredClone(quotaReconcileState.get(key)); },
  async put(key, value) { quotaReconcileState.set(key, structuredClone(value)); },
}, {
  async get(key) { return quotaReconcileValues.get(key) ?? null; },
  async put(key, value) { quotaReconcileValues.set(key, value); },
  async list() { quotaReconcileLists++; if (quotaReconcileFailing) throw Error("KV list() limit exceeded for the day.");
    return { keys: [...quotaReconcileValues.keys()].map(name => ({ name })), list_complete: true }; },
}, {}, () => quotaReconcileTime.value);
await quotaReconcile.command({ action: "put", key: "research_promotion_ticket:seeded", value: "{}" });
assert.equal((await quotaReconcile.command({ action: "maintain" })).complete, true);
quotaReconcileTime.value += 86_401_000; quotaReconcileFailing = true;
assert.equal((await quotaReconcile.command({ action: "maintain" })).error, "kv_list_daily_limit_exceeded");
assert.equal((await quotaReconcile.command({ action: "read", prefix: "research_promotion_ticket:", limit: 100 })).ok, false,
  "a failed re-scan still refuses reads until the cooldown opens");
const quotaReconcileStatus = await quotaReconcile.command({ action: "status" });
assert.equal(quotaReconcileStatus.complete, false);
assert.equal(quotaReconcileStatus.last_error.code, "kv_list_daily_limit_exceeded");
const quotaReconcileListsAfterFailure = quotaReconcileLists;
for (let i = 0; i < 100; i++) await quotaReconcile.command({ action: "maintain" });
assert.equal(quotaReconcileLists, quotaReconcileListsAfterFailure, "the daily quota cooldown spans repeated cron ticks");

const redacted = new KvDirectory({ async get() { return { keys: ["control_plane_source:private-subject"],
  complete: false, cursor: "private-cursor", retry_at: 0, error: "private-provider-error",
  last_error: { code: "private-token-detail", at: time }, owner: "private-owner" }; },
  async put() { throw Error("status_must_not_write"); } }, {
  async get() { throw Error("unexpected_mirror_read"); }, async list() { throw Error("status_must_not_list"); },
});
assert.doesNotMatch(JSON.stringify(await redacted.command({ action: "status" })), /private-|keys|cursor|owner/);

// A private namespace adapter exercises actual Worker routing without changing
// instance authority or adding a public manifest endpoint.
const emptyStorage = new Map();
const emptyKv = { ...kv, async get(key) { return key === MANIFEST_KEY ? null : kv.get(key); } };
const emptyDirectory = new KvDirectory({ async get(k) { return emptyStorage.get(k); },
  async put(k, v) { emptyStorage.set(k, structuredClone(v)); } }, emptyKv);
const env = { SESSION_SECRET: "synthetic-directory-session", ALLOWED_GITHUB_LOGINS: "reader",
  STRATEGY_SWITCH_CONFIG: emptyKv, STRATEGY_SWITCH_RUNTIME_INSTANCES: {
    idFromName(name) { return name; }, get(name) { return { async fetch(url, init) {
      if (name !== "console-kv-directory-v1") return Response.json({ error: "unavailable" }, { status: 503 });
      const result = await emptyDirectory.command(JSON.parse(init.body));
      return Response.json(result, { status: result.ok ? 200 : 503 });
    } }; },
  } };
const cookie = `qsl_switch_session=${await __test.makeSession("reader", [], env)}`;
const before = lists;
assert.equal((await worker.fetch(new Request("https://fixture.invalid/api/admin/kv-directory"), env)).status, 401);
for (let i = 0; i < 3; i++) {
  const response = await worker.fetch(new Request("https://fixture.invalid/api/admin/kv-directory", { headers: { Cookie: cookie } }), env);
  assert.equal(response.status, 200, "authenticated readers may read status without admin authority");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.status, "unknown");
  assert.equal(body.complete, null);
  assert.doesNotMatch(JSON.stringify(body), /research_promotion_ticket:|keys|cursor|reader/);
}
assert.equal(emptyStorage.size, 0);
for (const path of ["/api/decisions-inbox", "/api/research-promotion-tickets", "/api/owner-decisions", "/api/reconciliation-recovery"]) {
  const response = await worker.fetch(new Request(`https://fixture.invalid${path}`, { headers: { Cookie: cookie } }), env);
  const body = await response.json();
  if (path.includes("inbox")) assert.equal(body.status, "read_failed");
  if (path.includes("promotion")) { assert.equal(response.status, 503); assert.equal(body.error, "kv_directory_uninitialized"); }
}
assert.equal(lists, before, "acceptance routes cannot bootstrap even on a cold manifest");

const legacyValues = new Map(); let legacyLists = 0, legacyQuota = true;
const legacyKv = { async get(k) { return legacyValues.get(k) ?? null; }, async put(k, v) { legacyValues.set(k, v); },
  async list() { legacyLists++; if (legacyQuota) throw Error("KV list() limit exceeded for the day.");
    return { keys: [{ name: "control_plane_source:legacy" }], list_complete: true }; } };
const legacyEnv = { STRATEGY_SWITCH_CONFIG: legacyKv, STRATEGY_SWITCH_RUNTIME_INSTANCES: {
  idFromName: x => x, get() { return { async fetch() {
    return Response.json({ error: "runtime_instance_actor_required" }, { status: 400 });
  } }; },
} };
const realNow = Date.now; Date.now = () => Date.parse("2026-10-16T03:00:00Z");
try {
  await assert.rejects(maintainDirectory(legacyEnv), /kv_list_daily_limit_exceeded/);
  for (let i = 0; i < 10; i++) await assert.rejects(maintainDirectory(legacyEnv), /kv_list_daily_limit_exceeded/);
  await assert.rejects(directoryList(legacyEnv, "control_plane_source:", 100), /kv_list_daily_limit_exceeded/);
  const legacyStatus = await directoryStatus(legacyEnv);
  assert.equal(legacyStatus.status, "incomplete");
  assert.equal(legacyStatus.last_error.code, "kv_list_daily_limit_exceeded");
  assert.equal(legacyLists, 1, "the 0% compatibility maintenance persists the same quota cooldown");
  Date.now = () => Date.parse("2026-10-17T00:01:01Z"); legacyQuota = false;
  assert.equal((await maintainDirectory(legacyEnv)).complete, true);
  assert.equal((await directoryList(legacyEnv, "control_plane_source:", 100)).keys.length, 1);
  assert.equal(legacyLists, 2, "the legacy receiver's read fallback never scans");
  // A fresh object adopts the exact complete mirror at first activation.
  const adopted = new KvDirectory({ async get() { return null; }, async put() {} }, legacyKv);
  assert.equal((await adopted.command({ action: "read", prefix: "control_plane_source:", limit: 100 })).keys.length, 1);
} finally { Date.now = realNow; }
await assert.rejects(directoryCommand({}, read), /kv_directory_unavailable/);
const outageEnv = { ...env, STRATEGY_SWITCH_RUNTIME_INSTANCES: { idFromName: x => x,
  get: () => ({ async fetch() { throw Error("private-provider-detail"); } }) } };
const outage = await worker.fetch(new Request("https://fixture.invalid/api/admin/kv-directory", { headers: { Cookie: cookie } }), outageEnv);
assert.equal(outage.status, 503);
const outageBody = await outage.json();
assert.equal(outageBody.status, "read_failed");
assert.doesNotMatch(JSON.stringify(outageBody), /private-provider-detail/);
assert.equal((await worker.fetch(new Request("https://fixture.invalid/api/admin/kv-directory", {
  method: "POST", headers: { Cookie: cookie, Origin: "https://fixture.invalid" },
}), env)).status, 403);
const source = await readFile(new URL("../web/strategy-switch-console/worker.js", import.meta.url), "utf8");
assert.doesNotMatch(source, /store\.list\(/, "every production read path must use the manifest");
console.log("kv_directory_validation: PASS (100 cold reads/100 cooldown ticks/100 warm reads)");

// Cold isolates and object restarts share the cache writer's semantic comparison.
const cacheMetadata = new Map(), cacheValues = new Map(); let cachePuts = 0;
const cacheStorage = { async get(k) { return structuredClone(cacheMetadata.get(k)); },
  async put(k, v) { cacheMetadata.set(k, structuredClone(v)); } };
const cacheKv = { async get(k) { return cacheValues.get(k) ?? null; },
  async put(k, v) { cachePuts++; cacheValues.set(k, v); } };
const cachePayload = stamp => ({ account: { execution_evidence: { observed_at: stamp }, balance: 10 } });
let cacheDirectory = new KvDirectory(cacheStorage, cacheKv);
await Promise.all(Array.from({ length: 100 }, (_, i) => cacheDirectory.command({
  action: "cache", payload: cachePayload(String(i)), ts: 1_800_000_000_000 + i })));
assert.equal(cachePuts, 1, "100 concurrent cold refreshes write once instead of 100 times");
cacheDirectory = new KvDirectory(cacheStorage, cacheKv);
await cacheDirectory.command({ action: "cache", payload: cachePayload("restart"), ts: 1_800_000_300_000 });
assert.equal(cachePuts, 1, "cache write dedup survives object restart");
await cacheDirectory.command({ action: "cache", payload: cachePayload("bump"), ts: 1_800_000_900_000 });
assert.equal(cachePuts, 2, "the existing 15-minute keep-alive ceiling is preserved");
await cacheDirectory.command({ action: "cache", payload: { changed: true }, ts: 1_800_000_900_001 });
assert.equal(cachePuts, 3, "real content changes still write immediately");
cacheKv.put = async () => { throw Error("synthetic_store_unavailable"); };
await assert.rejects(cacheDirectory.command({ action: "cache", payload: { changed: false }, ts: 1_800_000_900_002 }), /synthetic_store_unavailable/);
cacheKv.put = async (k, v) => { cachePuts++; cacheValues.set(k, v); };
await cacheDirectory.command({ action: "cache", payload: { changed: false }, ts: 1_800_000_900_003 });
assert.equal(cachePuts, 4, "a failed write does not advance the successful-write signature");
console.log("kv_operation_budget: PASS (288 ticks: 1 List/1 mirror put; 100 cold refreshes: 1 cache put)");

// Exercise the production Worker -> private directory command bridge as well.
const bridgeState = new Map(); let bridgeWrites = 0;
const bridgeKv = { async get() { return null; }, async put() { bridgeWrites++; } };
const bridgeDirectory = new KvDirectory({ async get(k) { return bridgeState.get(k); },
  async put(k, v) { bridgeState.set(k, structuredClone(v)); } }, bridgeKv);
const bridgeEnv = { STRATEGY_SWITCH_CONFIG: bridgeKv, STRATEGY_SWITCH_RUNTIME_INSTANCES: {
  idFromName: name => name, get: name => ({ async fetch(_url, init) {
    assert.equal(name, "console-kv-directory-v1");
    const result = await bridgeDirectory.command(JSON.parse(init.body));
    return Response.json(result);
  } }),
} };
await Promise.all(Array.from({ length: 20 }, (_, i) => __test.writeCurrentStrategiesCache(
  bridgeEnv, cachePayload(String(i)), 1_800_000_000_000 + i)));
assert.equal(bridgeWrites, 1, "production Worker cache writes actually use the serialized owner");
const legacyCache = new Map(); let legacyCacheWrites = 0;
const legacyCacheEnv = { STRATEGY_SWITCH_CONFIG: {
  async get(k) { return legacyCache.get(k) ?? null; },
  async put(k, v) { legacyCacheWrites++; legacyCache.set(k, v); },
}, STRATEGY_SWITCH_RUNTIME_INSTANCES: { idFromName: x => x, get: () => ({ async fetch() {
  return Response.json({ error: "runtime_instance_actor_required" }, { status: 400 });
} }) } };
await __test.writeCurrentStrategiesCache(legacyCacheEnv, cachePayload("old receiver"), 1_800_000_000_000);
await __test.writeCurrentStrategiesCache(legacyCacheEnv, cachePayload("retry"), 1_800_000_000_001);
assert.equal(legacyCacheWrites, 1, "older private receivers retain the existing KV comparison");
