import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { KvDirectory, directoryCommand } from "../web/strategy-switch-console/kv_directory.js";

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
assert.equal((await directory.command(read)).error, "kv_directory_uninitialized");
assert.equal(lists, 0, "a cold read cannot spend list quota");
assert.equal((await directory.command({ action: "maintain" })).error, "kv_list_daily_limit_exceeded");
directory = new KvDirectory(storage, kv, {}, () => time);
for (let i = 0; i < 100; i++) await directory.command({ action: "maintain" });
assert.equal(lists, 1, "quota cooldown survives an object restart and repeated cron ticks");
await Promise.all(Array.from({ length: 20 }, (_, i) => directory.command({
  action: "put", key: `research_promotion_ticket:fixture-${i}`, value: JSON.stringify({ fixture: i }),
})));
assert.equal((await directory.command(read)).ok, false, "new writes do not prove legacy coverage");
assert.equal(values.size, 20);
time = Date.parse("2026-10-17T00:01:01Z"); fail = false;
assert.equal((await directory.command({ action: "maintain" })).ok, true);
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
  async put() {}, async list(options) { pages++;
    return options.cursor ? { keys: [{ name: "control_plane_source:last" }], list_complete: true }
      : { keys: [{ name: "control_plane_source:first" }], list_complete: false, cursor: "next" };
  },
}, { KV_DIRECTORY_PAGE_DELAY_SECONDS: "30" }, () => time);
assert.equal((await paged.command({ action: "maintain" })).error, "kv_directory_migration_pending");
assert.equal((await paged.command({ action: "read", prefix: "control_plane_source:", limit: 100 })).ok, false);
await paged.command({ action: "put", key: "control_plane_source:concurrent", value: "{}" });
time += 31_000;
assert.equal((await paged.command({ action: "maintain" })).ok, true);
assert.equal(pages, 2);
assert.equal((await paged.command({ action: "read", prefix: "control_plane_source:", limit: 100 })).keys.length, 3,
  "a publisher between migration pages is retained");

// A private namespace adapter exercises actual Worker routing without changing
// instance authority or adding a public manifest endpoint.
const emptyStorage = new Map();
const emptyDirectory = new KvDirectory({ async get(k) { return emptyStorage.get(k); },
  async put(k, v) { emptyStorage.set(k, structuredClone(v)); } }, kv);
const env = { SESSION_SECRET: "synthetic-directory-session", ALLOWED_GITHUB_LOGINS: "reader",
  STRATEGY_SWITCH_CONFIG: kv, STRATEGY_SWITCH_RUNTIME_INSTANCES: {
    idFromName(name) { return name; }, get(name) { return { async fetch(url, init) {
      if (name !== "console-kv-directory-v1") return Response.json({ error: "unavailable" }, { status: 503 });
      const result = await emptyDirectory.command(JSON.parse(init.body));
      return Response.json(result, { status: result.ok ? 200 : 503 });
    } }; },
  } };
const cookie = `qsl_switch_session=${await __test.makeSession("reader", [], env)}`;
const before = lists;
for (const path of ["/api/decisions-inbox", "/api/research-promotion-tickets", "/api/owner-decisions", "/api/reconciliation-recovery"]) {
  const response = await worker.fetch(new Request(`https://fixture.invalid${path}`, { headers: { Cookie: cookie } }), env);
  const body = await response.json();
  if (path.includes("inbox")) assert.equal(body.status, "read_failed");
  if (path.includes("promotion")) { assert.equal(response.status, 503); assert.equal(body.error, "kv_directory_uninitialized"); }
}
assert.equal(lists, before, "acceptance routes cannot bootstrap even on a cold manifest");
await assert.rejects(directoryCommand({}, read), /kv_directory_unavailable/);
assert.equal((await worker.fetch(new Request("https://fixture.invalid/api/admin/kv-directory", {
  method: "POST", headers: { Cookie: cookie, Origin: "https://fixture.invalid" },
}), env)).status, 403);
const source = await readFile(new URL("../web/strategy-switch-console/worker.js", import.meta.url), "utf8");
assert.doesNotMatch(source, /store\.list\(/, "every production read path must use the manifest");
console.log("kv_directory_validation: PASS (100 cold reads/100 cooldown ticks/100 warm reads)");
