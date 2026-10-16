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
