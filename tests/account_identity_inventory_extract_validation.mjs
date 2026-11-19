// Account-identity inventory extraction: the three-layer split of the
// domain (constants, pure helpers, HTTP and storage orchestration), its
// dependency direction, its consumers, value parity with the reviewed
// definitions, and the handlers' behavior through injected dependencies.
// Synthetic data only; no network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CONSOLE = new URL("../web/strategy-switch-console/", import.meta.url);
const DOMAIN = new URL("application/account_identity_inventory/", CONSOLE);
const source = url => readFileSync(url, "utf8");
const sha = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Module import must not read storage, write or call out.
const effects = [];
const realFetch = globalThis.fetch;
globalThis.fetch = input => { effects.push(`fetch:${input}`); throw new Error("network trap"); };
const constants = await import(new URL("constants.js", DOMAIN));
const helpers = await import(new URL("helpers.js", DOMAIN));
const http = await import(new URL("http.js", DOMAIN));
assert.deepEqual(effects, [], "importing the inventory layers has no effect");

// ------------------------------------------------------------ ownership
const texts = Object.fromEntries(["constants", "helpers", "http"].map(name => [name, source(new URL(`${name}.js`, DOMAIN))]));
assert.equal(existsSync(new URL("reader.js", DOMAIN)), false, "the mixed reader module is deleted");
const topLevel = text => new Set([...text.matchAll(/^(?:export )?(?:async )?(?:function\*? |class |const |let )([A-Za-z_$][\w$]*)/gm)].map(match => match[1]));
const declared = Object.fromEntries(Object.entries(texts).map(([name, text]) => [name, topLevel(text)]));
const OWNERS = {
  constants: ["INVENTORY_DO_PATH", "INVENTORY_SCHEMA_VERSION", "INVENTORY_ORDERING", "INVENTORY_OBJECTS", "INVENTORY_PAGE_SIZE", "INVENTORY_TABLES", "INDEX_SPECS",
    "INVENTORY_ROUTE", "TABLE_SPECS", "SCHEMA_SQL", "CHANGES_SQL", "TABLE_INFO_SQL", "STATEMENTS", "ALLOWED", "UNKNOWN_IDENTIFIER", "UNKNOWN_COUNT",
    "unknownCount", "IDENTITY_KEYS", "SECRET_KEY", "CACHE_QUALIFIERS", "DECLARATION_VALUES", "INSTANCE_FIELDS", "CONFIG_IDENTITY",
    "DESK_RECORD_PREFIX", "ADMISSION_PREFIX", "IDEMPOTENCY_PREFIX", "DIRECTORY_STATE_KEY", "STRATEGIES_WRITE_STATE_KEY", "SNAPSHOT_OVERALL",
    "COMMAND_FIELDS", "HEX64", "SCAN_ID", "SECTIONS", "PARAMETERS", "SECTION_PARAMETERS", "CURSOR_TTL_MS", "CURSOR_CLOCK_SKEW_MS",
    "CURSOR_MAX_LENGTH", "CURSOR_CONTEXT", "KV_PAGE_SIZE", "KV_VALUE_MAX_BYTES", "DO_ERRORS", "KV_KEYS", "KV_PREFIXES", "KV_EXCLUDED_KEYS",
    "KV_EXCLUDED_PREFIXES", "RESPONSE_BYTE_BUDGET", "ROW_BYTE_LIMIT", "REQUEST_BYTE_LIMIT", "LONG_STRING", "PROJECTION_MAX_DEPTH",
    "ROW_IDENTITY_FIELDS", "DESK_IDENTITY_FIELDS", "KV_IDENTITY_FIELDS", "CACHE_ACCOUNTS"],
  helpers: ["InventoryError", "InventoryHttpError", "identityProjection", "strategiesCacheAccounts", "instanceIdentity", "declarationProjection",
    "projectRow", "deskRecordKind", "projectDoKv", "scalar", "encodeKey", "decodeKey", "fromBase64Url", "sealParameters", "byteLength", "sha256Hex",
    "fingerprints", "compareBytes", "pageSize", "requireScan", "assertStable", "kvFamily", "parameters"],
  http: ["inventoryCapability", "inventoryResponse", "accountIdentityInventoryResponse"],
};
// Internal orchestration of the HTTP module: declared there and nowhere else.
const HTTP_INTERNAL = ["observeSync", "tableInfo", "schemaManifest", "sqlPage", "doKvPage", "schemaPage", "finalizePage", "objectCall", "scanFor",
  "pageSection", "kvSection", "envSection", "manifest", "respond", "cursorKey", "seal", "unseal", "ENV_BINDINGS"];
const modules = { constants, helpers, http };
for (const [owner, names] of Object.entries(OWNERS)) {
  assert.deepEqual(Object.keys(modules[owner]).sort(), [...names].sort(), `${owner}.js exports exactly its owned names`);
  for (const name of names) {
    assert.ok(declared[owner].has(name), `${name} is declared in ${owner}.js`);
    for (const other of Object.keys(OWNERS)) if (other !== owner) assert.ok(!declared[other].has(name), `${name} has one owner, not ${other}.js`);
  }
}
for (const name of HTTP_INTERNAL) {
  assert.ok(declared.http.has(name), `${name} is local to http.js`);
  assert.ok(!declared.constants.has(name) && !declared.helpers.has(name), `${name} is not duplicated`);
}
for (const name of ["observeSync", "tableInfo", "schemaManifest", "sqlPage", "doKvPage", "schemaPage", "finalizePage", "objectCall"]) {
  assert.match(texts.http, new RegExp(`^(?:async )?function ${name}\\(`, "m"), `${name} is a local top-level function of http.js`);
}
const exportedFunctions = Object.entries(constants).filter(([, item]) => typeof item === "function").map(([name]) => name);
assert.deepEqual(exportedFunctions, ["unknownCount"], "constants exports only the unknown-table count statement builder as a function");
// The helpers hold no SQL execution, storage, session, environment or network access.
const code = text => text.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
for (const pattern of [/\bsql\./, /\.exec\(\s*[A-Z_]*SQL/, /\.query\(/, /\bstorage\b/, /\.list\(/, /\.put\(/, /\.delete\(/, /getAlarm/, /readSession/, /\benv\b/, /\bfetch\(/,
  /randomUUID|getRandomValues/, /Date\.now/, /\bcap\.(?:query|list|getAlarm|nonce)/]) {
  assert.doesNotMatch(code(texts.helpers), pattern, `helpers.js has no ${pattern}`);
}
assert.doesNotMatch(texts.constants, /^import /m, "constants.js imports nothing");

// No other console module declares or re-exports an inventory owner.
const consoleFiles = [];
const walk = async url => {
  const { readdir } = await import("node:fs/promises");
  for (const entry of await readdir(url, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const next = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
    if (entry.isDirectory()) await walk(next);
    else if (/\.(?:m?js)$/.test(entry.name)) consoleFiles.push(next);
  }
};
await walk(CONSOLE);
const domainHrefs = new Set(["constants", "helpers", "http"].map(name => new URL(`${name}.js`, DOMAIN).href));
const UNIQUE = ["INVENTORY_DO_PATH", "INVENTORY_OBJECTS", "INVENTORY_ROUTE", "INVENTORY_TABLES", "inventoryCapability", "inventoryResponse",
  "accountIdentityInventoryResponse", "identityProjection", "strategiesCacheAccounts", "projectDoKv", "deskRecordKind"];
for (const url of consoleFiles) {
  const text = source(url);
  assert.doesNotMatch(text, /account_identity_inventory\/reader/, `${url.pathname}: no reader import`);
  if (domainHrefs.has(url.href)) continue;
  for (const name of UNIQUE) assert.ok(!topLevel(text).has(name), `${url.pathname} does not redeclare ${name}`);
  assert.doesNotMatch(text, /export \*\s+from\s+"[^"]*account_identity_inventory/, `${url.pathname}: no inventory catch-all re-export`);
}

// ------------------------------------------------------------ dependency direction
const importsOf = text => [...text.matchAll(/^(?:import|export)\s[^;]*?from\s+"([^"]+)";/gms)].map(match => match[1]);
assert.deepEqual(importsOf(texts.constants), [], "constants.js has no dependency");
assert.deepEqual(importsOf(texts.helpers), ["./constants.js"], "helpers.js depends on constants.js only");
assert.deepEqual(importsOf(texts.http), ["../http_response.js", "../auth/cookies.js", "./constants.js", "./helpers.js"], "http.js depends on its layers and two shared leaves");
// Transitively, no inventory module reaches the Worker or runtime_support.
const reached = new Set();
const follow = url => {
  if (reached.has(url.href)) return;
  reached.add(url.href);
  for (const spec of importsOf(source(url))) if (spec.startsWith(".")) follow(new URL(spec, url));
};
for (const href of domainHrefs) follow(new URL(href));
for (const href of reached) {
  assert.ok(!href.endsWith("/strategy-switch-console/worker.js") && !href.endsWith("/application/worker/runtime_support.js"), `inventory graph excludes ${href}`);
}

// ------------------------------------------------------------ consumers
const workerText = source(new URL("worker.js", CONSOLE));
const doText = source(new URL("application/runtime_instances/durable_object.js", CONSOLE));
assert.match(workerText, /^import \{ INVENTORY_ROUTE \} from "\.\/application\/account_identity_inventory\/constants\.js";$/m, "Worker: route from constants.js");
assert.match(workerText, /^import \{ accountIdentityInventoryResponse \} from "\.\/application\/account_identity_inventory\/http\.js";$/m, "Worker: handler from http.js");
assert.match(workerText, /if \(url\.pathname === INVENTORY_ROUTE\) return await accountIdentityInventoryResponse\(request, env, \{ readSession \}\);/, "Worker forward unchanged");
assert.match(doText, /^import \{ INVENTORY_DO_PATH \} from "\.\.\/account_identity_inventory\/constants\.js";$/m, "DO: path from constants.js");
assert.match(doText, /^import \{ inventoryCapability, inventoryResponse \} from "\.\.\/account_identity_inventory\/http\.js";$/m, "DO: capability and delegate from http.js");
assert.match(doText, /if \(new URL\(request\.url\)\.pathname === INVENTORY_DO_PATH\) return inventoryResponse\(request, this\.inventory\);\n {4}if \(new URL\(request\.url\)\.pathname === MANAGEMENT_READ_DO_PATH\) return managementReadResponse\(request, this\.managementRead\);\n {4}this\.initializeStorage\(\);/,
  "DO: inventory and management readback dispatches precede storage initialization");
for (const [file, owners] of [["tests/account_identity_inventory_validation.mjs", ["constants", "helpers"]], ["tests/helpers/read_contract_child.mjs", ["constants"]],
  ["tests/read_contract_boundaries_validation.mjs", ["constants"]]]) {
  const text = source(new URL(`../${file}`, import.meta.url));
  for (const owner of owners) assert.ok(text.includes(`application/account_identity_inventory/${owner}.js`), `${file} imports from ${owner}.js`);
  assert.doesNotMatch(text, /(?:from |import\(|importConsole\(|consoleModule\(|new URL\(|FILE = )["'][^"']*account_identity_inventory\/reader\.js/, `${file}: no reader import`);
}

// ------------------------------------------------------------ value parity
// The moved definitions keep the values reviewed at the pre-split head.
assert.equal(constants.INVENTORY_ROUTE, "/api/admin/account-identity-inventory");
assert.equal(constants.INVENTORY_DO_PATH, "/internal/account-identity-inventory");
assert.equal(constants.INVENTORY_SCHEMA_VERSION, "qsl_account_identity_inventory.v1");
assert.equal(constants.INVENTORY_ORDERING, "primary_key_binary_v1");
assert.deepEqual(constants.INVENTORY_OBJECTS, { runtime: "runtime-instances", directory: "console-kv-directory-v1" });
assert.ok(Object.isFrozen(constants.INVENTORY_OBJECTS) && Object.isFrozen(constants.INVENTORY_TABLES) && Object.isFrozen(constants.TABLE_SPECS));
assert.deepEqual([constants.INVENTORY_PAGE_SIZE, constants.KV_PAGE_SIZE], [{ default: 100, max: 500 }, { default: 50, max: 100 }]);
assert.deepEqual([constants.RESPONSE_BYTE_BUDGET, constants.ROW_BYTE_LIMIT, constants.REQUEST_BYTE_LIMIT, constants.LONG_STRING, constants.KV_VALUE_MAX_BYTES],
  [1_500_000, 256_000, 16_384, 512, 2_000_000]);
assert.deepEqual([constants.PROJECTION_MAX_DEPTH, constants.ROW_IDENTITY_FIELDS, constants.DESK_IDENTITY_FIELDS, constants.KV_IDENTITY_FIELDS, constants.CACHE_ACCOUNTS],
  [8, 256, 128, 4000, 4000]);
assert.deepEqual([constants.CURSOR_TTL_MS, constants.CURSOR_CLOCK_SKEW_MS, constants.CURSOR_MAX_LENGTH], [6 * 3600_000, 60_000, 8192]);
assert.equal(Object.keys(constants.INVENTORY_TABLES).length, 40);
assert.equal(sha(constants.INVENTORY_TABLES), "678677be7a82443b071d4e869787264636df21b180a5aa89a1dc81ad28a07da7", "table specifications match B2 schema");
assert.equal(constants.ALLOWED.size, 203);
assert.equal(sha([...constants.ALLOWED].sort()), "c061e233d9bd2c7cdd87246a0350200102338143e0d77de9bb81955cb67f0893", "statement allowlist matches B2 schema");
assert.deepEqual([...constants.SECTIONS], ["manifest", "schema", "sql", "do_kv", "finalize", "kv", "env"]);
assert.equal(constants.DO_ERRORS.size, 16);

// ------------------------------------------------------------ runtime_support baseline
// runtime_support exposes no inventory API: the compatibility baseline is
// empty, no wrapper or forwarding route is added, and its exports are intact.
const runtimeSupport = await import(new URL("application/worker/runtime_support.js", CONSOLE));
const supportNames = Object.keys(runtimeSupport).sort();
const INVENTORY_COMPATIBILITY_EXPORTS = [];
assert.deepEqual(supportNames.filter(name => /inventory/i.test(name) || Object.values(modules).some(module => module[name] === runtimeSupport[name])),
  INVENTORY_COMPATIBILITY_EXPORTS, "runtime_support inventory compatibility baseline is empty");
// Its own `sha256Hex` is an unrelated shared helper, not an inventory re-export.
assert.deepEqual(supportNames.filter(name => Object.values(modules).some(module => Object.hasOwn(module, name))), ["sha256Hex"]);
assert.equal(supportNames.length, 832);
assert.equal(sha(supportNames), "482670c664d9bfc6ca633118ec0f4ed9e5518e49ad796b46856f3ef71e83696e", "runtime_support exports intact");
assert.doesNotMatch(source(new URL("application/worker/runtime_support.js", CONSOLE)), /account_identity_inventory/, "runtime_support does not import the inventory");
assert.deepEqual(effects, [], "importing runtime_support has no network effect");

// ------------------------------------------------------------ handler signatures
assert.match(texts.http, /^export async function accountIdentityInventoryResponse\(request, env, \{ readSession \}\) \{$/m);
assert.match(texts.http, /^export async function inventoryResponse\(request, cap\) \{$/m);
assert.match(texts.http, /^export function inventoryCapability\(storage, nonce\) \{$/m);
assert.deepEqual([http.accountIdentityInventoryResponse.length, http.inventoryResponse.length, http.inventoryCapability.length], [3, 2, 2]);

// ------------------------------------------------------------ injected behavior
// A read-only SQLite object behind the capability, a trapping storage proxy
// and a namespace stub that serves the internal path directly.
const violations = [];
const trap = (label, allowed) => new Proxy({}, { get(_, property) {
  if (property === "then" || typeof property === "symbol") return undefined;
  if (Object.hasOwn(allowed, property)) return allowed[property];
  return () => { violations.push(`${label}.${String(property)}`); throw new Error(`trap ${label}.${String(property)}`); };
} });
const scratch = await mkdtemp(join(tmpdir(), "qrt-inventory-extract-"));
const path = join(scratch, "object.sqlite");
{
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE instance_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)");
  db.prepare("INSERT INTO instance_state VALUES (1, 4, ?)").run(JSON.stringify([{ platform: "ibkr", key: "extract-account", kind: "existing", config: { key: "extract-account" } }]));
  db.close();
}
const digest = async () => createHash("sha256").update(await readFile(path)).digest("hex");
const before = await digest();
const db = new DatabaseSync(path, { readOnly: true });
const statements = [];
const storage = trap("storage", {
  sql: { exec(statement, ...bindings) { statements.push(statement); return db.prepare(statement).all(...bindings).values(); } },
  list: async () => new Map([["desk:idempotency:extract", { state: "pending" }]]),
  getAlarm: async () => null,
});
const cap = http.inventoryCapability(storage, "extract-nonce");
assert.deepEqual(Object.keys(cap).sort(), ["getAlarm", "list", "nonce", "query"], "capability surface");
assert.ok(Object.isFrozen(cap));
for (const statement of ["DELETE FROM instance_state", "SELECT * FROM instance_state", "PRAGMA user_version", constants.SCHEMA_SQL + ";DROP TABLE x"]) {
  assert.throws(() => cap.query(statement), error => error instanceof helpers.InventoryError && error.code === "statement_not_allowed" && error.status === 500, statement);
}
assert.throws(() => cap.query(constants.TABLE_INFO_SQL, { name: "instance_state" }), error => error.code === "binding_not_allowed");
const objectFetches = [];
let objectFailure = null;
const namespace = trap("namespace", {
  idFromName: name => ({ name }),
  get: id => trap("stub", { fetch: async (url, init) => {
    objectFetches.push([id.name, new URL(url).pathname]);
    if (objectFailure) return objectFailure();
    return http.inventoryResponse(new Request(url, init), cap);
  } }),
});
const SESSION_SECRET = "synthetic-extract-secret";
const kvValues = { account_options: JSON.stringify({ ibkr: [{ key: "extract-account", account_selector: "sel" }] }), auth_config: "{}" };
const kv = trap("kv", {
  list: async () => ({ keys: Object.keys(kvValues).sort().map(name => ({ name })), list_complete: true }),
  get: async name => kvValues[name] ?? null,
});
const env = { SESSION_SECRET, STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace, STRATEGY_SWITCH_CONFIG: kv, ACCOUNT_IDENTITY_INVENTORY_KV_ENABLED: "true",
  ACCOUNT_IDENTITY_INVENTORY_ENV_ENABLED: "true", STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: kvValues.account_options };
const sessions = { admin: { login: "extract-admin", admin: true }, reader: { login: "extract-reader", admin: false } };
const ORIGIN = "https://console.example";
const call = async (query, { session = "admin", method = "GET", headers = {}, envOverride = {} } = {}) => {
  const readSession = async () => {
    if (session === "throws") throw new Error("expired");
    return sessions[session] ?? null;
  };
  const response = await http.accountIdentityInventoryResponse(new Request(`${ORIGIN}/api/admin/account-identity-inventory?${query}`, { method, headers }),
    { ...env, ...envOverride }, { readSession });
  return { status: response.status, headers: response.headers, body: await response.json() };
};
try {
  // Authentication, sessions, origin and methods.
  for (const [options, status, error] of [[{ session: null }, 401, "login_required"], [{ session: "throws" }, 401, "login_required"],
    [{ session: "reader" }, 403, "admin_required"], [{ headers: { Origin: "https://elsewhere.example" } }, 403, "cross_origin_rejected"],
    [{ headers: { "Sec-Fetch-Site": "cross-site" } }, 403, "cross_origin_rejected"]]) {
    const result = await call("section=manifest", options);
    assert.deepEqual([result.status, result.body.error, result.headers.get("Cache-Control")], [status, error, "private, no-store"], JSON.stringify(options));
  }
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const result = await call("section=manifest", { method });
    assert.deepEqual([result.status, result.headers.get("Allow")], [405, "GET"], method);
  }
  // Fixed sections and parameters.
  for (const [query, error] of [["section=sql_raw", "unsupported_section"], ["section=schema&object=elsewhere", "unsupported_object"],
    ["section=manifest&extra=1", "unsupported_parameter"], ["section=manifest&section=env", "duplicate_parameter"], ["section=sql&object=runtime&table=instance_state", "scan_or_cursor_required"],
    ["section=finalize&object=runtime", "scan_required"], ["section=kv&page_size=101", "invalid_page_size"]]) {
    assert.equal((await call(query)).body.error, error, query);
  }
  assert.deepEqual(objectFetches, [], "rejected requests never reach the object");
  const manifest = await call("section=manifest");
  assert.deepEqual([manifest.status, manifest.body.execution_authority_granted, manifest.body.sections], [200, false, [...constants.SECTIONS]]);
  // The internal sections through the real delegate, in the reviewed order.
  const schema = await call("section=schema&object=runtime");
  assert.deepEqual([schema.status, schema.body.schema_state, schema.body.tables.instance_state.row_count], [200, "partial", 1]);
  const scan = schema.body.scan;
  const rows = await call(`section=sql&object=runtime&table=instance_state&page_size=1&scan=${encodeURIComponent(scan)}`);
  assert.deepEqual([rows.status, rows.body.rows[0].columns.payload.entries[0].key, rows.body.terminal], [200, "extract-account", true]);
  const doKv = await call(`section=do_kv&object=runtime&scan=${encodeURIComponent(scan)}`);
  assert.deepEqual([doKv.status, doKv.body.entries.map(entry => entry.family)], [200, ["desk_idempotency"]]);
  const final = await call(`section=finalize&object=runtime&scan=${encodeURIComponent(scan)}`);
  assert.deepEqual([final.status, final.body.stable], [200, true]);
  assert.deepEqual(objectFetches, Array(4).fill(["runtime-instances", constants.INVENTORY_DO_PATH]), "each section reaches the named object's internal path");
  assert.ok(statements.every(statement => constants.ALLOWED.has(statement)), "only allowlisted statements reached SQL");
  // Cursor and scan scope, tampering and expiry.
  assert.equal((await call(`section=finalize&object=directory&scan=${encodeURIComponent(scan)}`)).body.error, "cursor_scope_mismatch");
  assert.equal((await call(`section=finalize&object=runtime&scan=${encodeURIComponent(`${scan.slice(0, -2)}AA`)}`)).body.error, "invalid_cursor");
  assert.equal((await call(`section=finalize&object=runtime&scan=${encodeURIComponent(scan)}`, { envOverride: { SESSION_SECRET: "another-secret" } })).body.error, "invalid_cursor");
  const now = Date.now;
  Date.now = () => now() + constants.CURSOR_TTL_MS + 1;
  try { assert.equal((await call(`section=finalize&object=runtime&scan=${encodeURIComponent(scan)}`)).body.error, "cursor_expired"); } finally { Date.now = now; }
  // Optional sections read only the reviewed KV families and fixed bindings.
  const kvPage = await call("section=kv");
  assert.deepEqual(kvPage.body.keys.map(item => [item.name, item.state]), [["account_options", "exported"], ["auth_config", "scope_excluded"]]);
  assert.equal(kvPage.body.keys[0].identity.fields["ibkr[0].key"], "extract-account");
  const envPage = await call("section=env");
  assert.deepEqual(envPage.body.bindings.map(item => [item.name, item.state]), [["STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON", "present"],
    ["BINANCE_ACCOUNT_FACTS_BINDING_JSON", "absent"], ["BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON", "absent"]]);
  assert.equal((await call("section=kv", { envOverride: { ACCOUNT_IDENTITY_INVENTORY_KV_ENABLED: "false" } })).body.error, "section_disabled");
  // Stale, corrupt and failed object responses fall back to fixed codes.
  for (const [failure, status, error] of [
    [() => new Response("not json", { status: 200 }), 503, "inventory_read_failed"],
    [() => Response.json({ ok: false, error: "provider text" }, { status: 500 }), 502, "inventory_read_failed"],
    [() => Response.json({ ok: false, error: "changed_during_scan" }, { status: 409 }), 409, "changed_during_scan"],
    [() => { throw new Error("timeout"); }, 503, "inventory_read_failed"],
  ]) {
    objectFailure = failure;
    const result = await call("section=schema&object=runtime");
    assert.deepEqual([result.status, result.body], [status, { ok: false, error }]);
  }
  objectFailure = null;
  assert.deepEqual((await call("section=schema&object=runtime", { envOverride: { STRATEGY_SWITCH_RUNTIME_INSTANCES: undefined } })).body, { ok: false, error: "runtime_instances_not_bound" });
  // The internal delegate: POST only, fixed command fields and sections.
  const internal = async (body, method = "POST") => {
    const response = await http.inventoryResponse(new Request(`https://runtime-instances${constants.INVENTORY_DO_PATH}`, { method, ...(method === "POST" ? { body } : {}) }), cap);
    return [response.status, (await response.json()).error ?? null];
  };
  assert.deepEqual(await internal(null, "GET"), [405, "method_not_allowed"]);
  assert.deepEqual(await internal(JSON.stringify({ section: "schema", object: "runtime", sql: "SELECT 1" })), [400, "invalid_request"]);
  assert.deepEqual(await internal(JSON.stringify({ section: "probe", object: "runtime" })), [400, "unsupported_section"]);
  assert.deepEqual(await internal(JSON.stringify({ section: "schema", object: "elsewhere" })), [400, "unsupported_object"]);
  assert.deepEqual(await internal("x".repeat(constants.REQUEST_BYTE_LIMIT + 1)), [400, "invalid_request"]);
  // Command-only obligations of the extraction template (idempotent replay,
  // conflict and rollback rejection) do not apply: the route is a GET
  // observation and the delegate runs no command; every other method is
  // rejected above.
  assert.deepEqual([violations, effects], [[], []], "zero mutation or network traps");
} finally {
  db.close();
  assert.equal(await digest(), before, "source state unchanged");
  await rm(scratch, { recursive: true, force: true });
  globalThis.fetch = realFetch;
}

console.log("account_identity_inventory_extract_validation: ok");
