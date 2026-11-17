// Account-identity inventory: no-write, completeness and access validation.
// Part A runs the real Worker route and RuntimeInstances class in Node over
// trap storage (read-only SQLite connection, trapping DO/KV/fetch/waitUntil
// proxies). Part B runs the same code in workerd through Miniflare to prove
// the SQL surface, the stability counter and before/after state identity.
// Synthetic data only; no network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const CONSOLE = new URL("../web/strategy-switch-console/", import.meta.url);
const violations = [];
const violate = what => { violations.push(what); throw new Error(`inventory_trap:${what}`); };
const realFetch = globalThis.fetch;
globalThis.fetch = (input) => violate(`fetch:${typeof input === "string" ? input : input?.url}`);

// Module import itself must not write or call out.
const workerModule = await import(new URL("worker.js", CONSOLE));
const worker = workerModule.default;
const { RuntimeInstances } = workerModule;
const { INVENTORY_TABLES, INVENTORY_DO_PATH } = await import(new URL("application/account_identity_inventory/constants.js", CONSOLE));
const { strategiesCacheAccounts } = await import(new URL("application/account_identity_inventory/helpers.js", CONSOLE));
const { assemble, EXPORT_FORMAT } = await import(new URL("inspect_account_identity_inventory.mjs", CONSOLE));
const { makeSession, hmac } = await import(new URL("application/auth/session.js", CONSOLE));
const { base64UrlEncodeJson } = await import(new URL("application/auth/cookies.js", CONSOLE));
assert.deepEqual(violations, [], "module import is side-effect free");

const ROUTE = "/api/admin/account-identity-inventory";
const ORIGIN = "https://console.example";
const SECRET = "synthetic-only-session-key";
const CANARY = "CANARY-SECRET-7f3a";
const ACTOR_CANARY = "canary-actor-login";
const AMOUNT_CANARY = 987654.321;
const env0 = {
  SESSION_SECRET: SECRET,
  STRATEGY_SWITCH_ADMIN_LOGINS: "fixture-admin",
  ALLOWED_GITHUB_LOGINS: "fixture-reader",
  RUNTIME_SETTINGS_DISPATCH_TOKEN: `${CANARY}-dispatch`,
  STRATEGY_SWITCH_SYNC_TOKEN: `${CANARY}-sync`,
};
const cookieFor = async login => `qsl_switch_session=${await makeSession(login, [], env0)}`;
const adminCookie = await cookieFor("fixture-admin");
const readerCookie = await cookieFor("fixture-reader");
const expiredPayload = base64UrlEncodeJson({ login: "fixture-admin", orgs: [], exp: Math.floor(Date.now() / 1000) - 60 });
const expiredCookie = `qsl_switch_session=${expiredPayload}.${await hmac(expiredPayload, SECRET)}`;

// ---------------------------------------------------------------- seed plan
const pad = (value, width = 4) => String(value).padStart(width, "0");
const hex = value => createHash("sha256").update(String(value)).digest("hex");
const day = offset => new Date(Date.UTC(2024, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
const jsonColumn = name => /json$|^payload$|^entry$|^record$|^response$/.test(name);
function rows(table, items) {
  const columns = INVENTORY_TABLES[table].columns;
  return { statement: `INSERT INTO "${table}" (${columns.map(name => `"${name}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    rows: items.map(item => columns.map(name => name in item ? item[name] : jsonColumn(name) ? "{}" : "seed")) };
}
const range = count => Array.from({ length: count }, (_, index) => index);

function populatedPlan() {
  const instances = range(126).map(index => ({ platform: "ibkr", key: `acct-${pad(index, 3)}`, kind: "existing", enabled: true,
    config: { key: `acct-${pad(index, 3)}`, account_selector: `sel-${index}`, target_name: `target-${index}`, broker_account_id: `SYN${index}` } }));
  instances.push(
    { platform: "ibkr", key: "shared", kind: "existing", config: { key: "shared", account_selector: "sel-shared-ibkr" } },
    { platform: "schwab", key: "shared", kind: "existing", config: { key: "shared", account_selector: "sel-shared-schwab", access_token: CANARY } },
    { platform: "ibkr", key: "draft-1", kind: "draft", enabled: false, config: { key: "draft-1" } },
    { platform: "ibkr", key: "mismatch", kind: "existing", config: { key: "different-key" } },
    { platform: "ibkr", key: "retiring", kind: "existing", retirement_status: "requested", config: { key: "retiring" } });
  instances[3].config.broker_environment = "live";
  // The stored settings identity as accountSettingsIdentity() writes it.
  const storedIdentity = (index, overrides = {}) => JSON.stringify({ platform: "ibkr", key: `acct-${pad(index, 3)}`, target_name: `target-${index}`,
    broker_environment: index === 3 ? "live" : null, account_selector: `sel-${index}`, deployment_selector: "", account_scope: "", service_name: "", ...overrides });
  const history = range(120).map(index => {
    const key = index === 11 ? "alias" : `acct-${pad(index % 126, 3)}`;
    return { revision: index + 1, entry: JSON.stringify({ revision: index + 1, ts: day(index), action: "update", login: ACTOR_CANARY,
      before: index === 10 ? { platform: "ibkr", key: "alias", config: { key: "alias", account_selector: "alias-old" } } : null,
      after: { platform: "ibkr", key, config: { key, account_selector: index === 11 ? "alias-new" : `sel-${index % 126}` } } }) };
  });
  const statuses = ["approved", "claimed", "applied", "rejected", "mystery"];
  const big = range(250).reduce((value, index) => ({ ...value, [`n${index}`]: { status: "x".repeat(500) } }), {});
  const oversized = range(256).reduce((value, index) => ({ ...value, [`${"k".repeat(1200)}${index}`]: { status: "y" } }), {});
  const sql = [
    // As the Binance detail command creates it on first use.
    { statement: `CREATE TABLE IF NOT EXISTS binance_detail_daily (account_key TEXT NOT NULL, binding_id TEXT NOT NULL, observation_date TEXT NOT NULL,
      payload_json TEXT NOT NULL, PRIMARY KEY(account_key, binding_id, observation_date))`, rows: [[]] },
    rows("instance_state", [{ id: 1, revision: 131, payload: JSON.stringify(instances) }]),
    rows("instance_history", history),
    rows("account_setting_draft", [
      { platform: "ibkr", account_key: "acct-000", revision: 2, identity_json: JSON.stringify({ key: "acct-000", account_selector: "sel-0" }), overrides_json: "{\"risk\":1}", updated_at: day(1) },
      { platform: "ibkr", account_key: "orphan-key", revision: 1, identity_json: "{bad", overrides_json: "{}", updated_at: day(2) },
      { platform: "schwab", account_key: "shared", revision: 1, identity_json: "{}", overrides_json: "[]", updated_at: day(3) }]),
    // Stored declarations: accepted values, explicit null plus an invalid value,
    // a conflicting environment, absent fields and corrupt JSON.
    rows("account_setting_declaration", [
      { platform: "ibkr", account_key: "acct-001", revision: 1, identity_json: storedIdentity(1), declaration_json: JSON.stringify({ environment: "paper", account_type: "margin" }) },
      { platform: "ibkr", account_key: "acct-002", revision: 2, identity_json: storedIdentity(2, { account_selector: "sel-retired" }), declaration_json: JSON.stringify({ environment: null, account_type: "futures" }) },
      { platform: "ibkr", account_key: "acct-003", revision: 1, identity_json: storedIdentity(3), declaration_json: JSON.stringify({ environment: "paper", account_type: null }) },
      { platform: "ibkr", account_key: "acct-005", revision: 1, identity_json: storedIdentity(5), declaration_json: "{}" },
      { platform: "ibkr", account_key: "acct-006", revision: 1, identity_json: storedIdentity(6), declaration_json: "{bad" }]),
    rows("account_setting_profile_application", range(150).map(index => ({ request_key: `req-${pad(index)}`, platform: index % 2 ? "schwab" : "ibkr",
      account_key: index % 7 ? `acct-${pad(index % 126, 3)}` : "orphan-key", identity_json: "{}", instance_revision: index, draft_revision: 1,
      old_profile: "a", new_profile: "b", approved_by: ACTOR_CANARY, approved_at: day(index), status: statuses[index % 5], workflow_run_id: null,
      workflow_run_attempt: null, claimed_at: null }))),
    rows("risk_profile_authority", [{ id: 1, revision: 3, imported: 1, bindings_json: JSON.stringify({ "target-1": { strategy_profile: "p" } }) }]),
    rows("account_facts_observation", range(30).map(index => ({ platform: "ibkr", account_key: `acct-${pad(index, 3)}`,
      payload_json: JSON.stringify(index === 29 ? oversized : { ...big, net_liquidation: AMOUNT_CANARY }), observed_finished_at: day(index),
      observation_date: day(index), target_id: `target-${index}`, source_binding_id: "src-1", account_scope: "scope", updated_at: day(index) }))),
    rows("account_facts_daily", [...range(400).map(index => ({ platform: "ibkr", account_key: "acct-000", observation_date: day(index),
      payload_json: JSON.stringify({ cash: AMOUNT_CANARY }), observed_finished_at: day(index), target_id: "target-0", source_binding_id: "src-1",
      account_scope: "scope", updated_at: day(index) })), ...range(3).map(index => ({ platform: "firstrade", account_key: "orphan-key",
      observation_date: day(index), payload_json: "{bad", observed_finished_at: day(index), target_id: "t", source_binding_id: "src-x",
      account_scope: "scope", updated_at: day(index) }))]),
    rows("account_period_return", [{ account_key: "acct-000", payload_json: "{}" }, { account_key: "unattributed-key", payload_json: "{bad" }]),
    rows("account_daily_native_return", ["src-1", "src-2"].flatMap(source => ["USD", "HKD"].flatMap(currency => range(400).map(index => ({
      account_key: "acct-000", source_binding_id: source, currency, observation_date: day(index), payload_json: "{}" }))))),
    rows("account_external_flow", [{ platform: "ibkr", account_key: "acct-000", context_json: JSON.stringify({ feature_enabled: false, target_id: "target-0" }), payload_json: "{}" }]),
    rows("account_executions", [{ platform: "ibkr", account_key: "acct-000", source_binding_id: "src-1", context_json: "{}", payload_json: "[]" }]),
    rows("account_execution_reports", [
      { platform: "ibkr", account_key: "acct-000", source_binding_id: "src-1", context_json: "{}", metadata_json: JSON.stringify({ reports: [1, 2], reports_truncated: true }) },
      { platform: "ibkr", account_key: "metadata-only", source_binding_id: "src-9", context_json: "{}", metadata_json: JSON.stringify({ reports: [] }) }]),
    rows("binance_detail_daily", [
      { account_key: `bn-main:${hex("binding-1")}`, binding_id: "binding-1", observation_date: day(1), payload_json: "{}" },
      { account_key: `bn-main:${hex("binding-0")}`, binding_id: "binding-0", observation_date: `digest:${day(0)}`, payload_json: "{}" }]),
    rows("account_diagnosis_tasks", range(5).map(index => ({ request_id: `diag-${index}`, platform: "ibkr", account_key: "acct-000",
      status: ["queued", "running", "unknown", "completed", "weird"][index], summary: CANARY, checks_json: "[]", native_json: null, auto_source: "manual" }))),
    rows("research_promotion_applications", range(120).map(index => ({ application_id: `app-${pad(index)}`, ticket_id: `ticket-${index % 40}`,
      status: index % 3 ? "rejected" : "claimed", claim_token: CANARY, platform_id: "ibkr", account_key: `acct-${pad(index % 126, 3)}`,
      expected_revision: index, workflow_run_id: null, workflow_run_attempt: null,
      // Accounts retained only inside operation payloads: one attributed, one platform-less.
      readback_json: index === 0 ? JSON.stringify({ platform_id: "schwab", account_key: "payload-only", target_name: "target-payload" })
        : index === 1 ? JSON.stringify({ result: { account_key: "payload-unattributed" } }) : null }))),
    rows("human_decision_material", range(50).map(index => ({ kind: "owner", subject_id: `subject-${pad(index)}`, summary_json: "{}", eligible: 1, expires_at_ms: 1 }))),
    rows("human_decision_record", range(150).map(index => ({ request_key: `decision-${pad(index)}`, kind: "owner", subject_id: `subject-${index % 50}`,
      actor: ACTOR_CANARY, target_json: JSON.stringify({ selected_account: "acct-001" }), payload_json: JSON.stringify({ session: CANARY }) }))),
    rows("human_decision_source_material", range(110).map(index => ({ kind: "owner", subject_id: `subject-${index % 50}`, source_id: `source-${index}`,
      summary_json: "{}", eligible: 0, expires_at_ms: 1 }))),
    rows("hk_stop_request", ["reserved", "accepted", "unknown", "stopped", "mystery", "completed"].map((phase, index) => ({ request_id: `stop-${index}`,
      target_id: `target-${index}`, identity_json: JSON.stringify({ platform: "longbridge", account_key: "lb-1" }), source_revision: index, phase,
      dispatch_result: null, workflow_run_id: null, workflow_run_attempt: null, source_identity_sha256: null, runtime_identity_sha256: null,
      result_json: null, stopped_at: null }))),
    // UX1 job states: none, known open, terminal, missing, unknown, newly introduced, corrupt.
    rows("ux1_research_slot", [null, { status: "running" }, { status: "queued" }, { status: "succeeded" }, {}, { status: "unknown" }, { status: "rehydrating" }, "{bad"]
      .map((job, index) => ({ login: `${ACTOR_CANARY}-${index}`, revision: 1, draft_json: "{}", fingerprint: "f", preview_json: null, intent_json: null,
        job_json: job === null ? null : typeof job === "string" ? job : JSON.stringify({ request_id: `ux1-${index}`, ...job }) }))),
    rows("runtime_cycle_health_attempt", range(60).map(index => ({ history_id: index + 1, attempt_key: `attempt-${index}`, cycle_id: `cycle-${index}` }))),
    rows("credential_maintenance_metadata", [{ id: "ibkr_flex", revision: 1, expires_at: day(500), last_rotated_at: null }]),
    rows("credential_rotation_operations", [{ operation_id: "op-1", record: JSON.stringify({ state: "pending", token: CANARY }) }]),
    rows("credential_rotation_requests", [{ request_id: "rq-1", fingerprint: CANARY, operation_id: "op-1", action: "start", response: CANARY }]),
    rows("credential_rotation_factors", [{ factor: CANARY }]),
    rows("credential_rotation_audit", [{ event_id: "e-1", occurred_at: day(1), actor: ACTOR_CANARY, action: "start", operation_id: "op-1", outcome: "ok", reason: null }]),
    rows("market_benchmark_daily", [{ series_id: "spy", observation_date: day(1), close: "1", source: "s", updated_at: day(1) }]),
    { statement: "CREATE TABLE legacy_mystery (id TEXT PRIMARY KEY, payload TEXT)", rows: [[]] },
    { statement: "INSERT INTO legacy_mystery VALUES (?, ?)", rows: [["m-1", CANARY]] },
  ];
  const kv = {};
  for (const index of range(1200)) kv[`desk:readbacks:record:bulk-${pad(index)}`] = { expires: index % 2 ? 1 : 4_102_444_800_000, owner: ACTOR_CANARY,
    payload: { state: index % 3 ? "done" : "running", net_liquidation: AMOUNT_CANARY, target_id: `target-${index % 126}` }, results: [] };
  // Desk readback states beyond running: unknown, missing, newly introduced, terminal.
  for (const [name, payload] of [["unknown", { state: "unknown" }], ["missing", {}], ["new", { state: "queued_v2" }], ["done", { state: "done" }], ["partial", { state: "partial" }]]) {
    kv[`desk:readbacks:record:probe-${name}`] = { expires: 4_102_444_800_000, owner: ACTOR_CANARY, payload, results: [] };
  }
  kv[`desk:readbacks:admission:${ACTOR_CANARY}`] = { active: "bulk-0001", nextAllowed: 1, expires: 1 };
  kv[`desk:idempotency:${hex("k")}`] = { state: "pending", request_id: "idem-1", fingerprint: CANARY };
  kv["mystery:key"] = { secret: CANARY };
  return { sql, kv, alarm: 4_102_444_800_000 };
}
function directoryPlan() {
  return { sql: [], kv: { "console-kv-directory-v1": { complete: true, keys: ["a", "b"], cursor: null, scanned_at: day(1), signature: CANARY },
    "console-current-strategies-write-v1": { ts: 1, signature: CANARY } }, alarm: null };
}
// Pre-migration shapes: diagnosis without ALTER-added columns, stop requests
// without identity/result columns, UX1 without job state, and an old
// credential-maintenance metadata table. Only some tables exist (partially migrated).
const OLD_SCHEMA = [
  "CREATE TABLE instance_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL)",
  "CREATE TABLE account_diagnosis_tasks (request_id TEXT PRIMARY KEY, platform TEXT NOT NULL, account_key TEXT NOT NULL, status TEXT NOT NULL)",
  "CREATE TABLE hk_stop_request (request_id TEXT PRIMARY KEY, target_id TEXT NOT NULL, identity_json TEXT NOT NULL, source_revision INTEGER NOT NULL, action TEXT NOT NULL, requested_at TEXT NOT NULL, phase TEXT NOT NULL, dispatch_result TEXT, workflow_run_id TEXT, workflow_run_attempt TEXT, updated_at TEXT NOT NULL)",
  "CREATE TABLE ux1_research_slot (login TEXT PRIMARY KEY, revision INTEGER NOT NULL, draft_json TEXT NOT NULL, fingerprint TEXT, preview_json TEXT, intent_json TEXT)",
  "CREATE TABLE credential_maintenance_metadata (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, expires_at TEXT)",
];
const OLD_SCHEMA_ROWS = [
  { statement: "INSERT INTO instance_state VALUES (?, ?, ?)", rows: [[1, 1, JSON.stringify([{ platform: "ibkr", key: "old-1", kind: "existing", config: { key: "old-1" } }])]] },
  { statement: "INSERT INTO account_diagnosis_tasks VALUES (?, ?, ?, ?)", rows: [["d-1", "ibkr", "old-1", "running"]] },
];
const EXPECTED_OLD_MISSING = {
  account_diagnosis_tasks: ["target_id", "trigger", "observed_at", "checks_json", "state_fingerprint", "workflow_run_id", "workflow_run_attempt", "job_id",
    "summary", "reason_code", "dispatch_state", "recheck_dispatch_state", "created_at", "updated_at", "auto_source", "native_json"],
  hk_stop_request: ["source_identity_sha256", "runtime_identity_sha256", "result_json", "stopped_at"],
  ux1_research_slot: ["job_json"],
  credential_maintenance_metadata: ["last_rotated_at"],
};
const seededCounts = plan => {
  const counts = {};
  for (const { statement, rows: items } of plan.sql) {
    const match = /^INSERT INTO "?([a-z_0-9]+)"?/.exec(statement);
    if (match && INVENTORY_TABLES[match[1]]) counts[match[1]] = (counts[match[1]] || 0) + items.length;
  }
  return counts;
};

// ------------------------------------------------------------- trap harness
const WRITE_SQL = /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE|UPSERT|BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|VACUUM|ATTACH|DETACH|REINDEX|ANALYZE|PRAGMA|WITH)\b/i;
function cursorOf(items) { return Object.assign(items.values(), { toArray: () => items, one: () => items[0] }); }
function writableSql(db) { return { exec: (statement, ...bindings) => cursorOf(db.prepare(statement).all(...bindings)) }; }
const utf8Compare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
// Every property not explicitly allowed is a trap; allowed reads are logged.
function trapProxy(label, allowed) {
  return new Proxy({}, { get(_, property) {
    if (property === "then" || typeof property === "symbol") return undefined;
    if (Object.hasOwn(allowed, property)) return allowed[property];
    return () => violate(`${label}.${String(property)}`);
  } });
}
async function seedDatabase(path, plan, { initialize }) {
  const db = new DatabaseSync(path);
  if (initialize) {
    const instance = Object.create(RuntimeInstances.prototype);
    instance.sqlStorage = writableSql(db);
    instance.storageInitialized = false;
    instance.initializeStorage();
  }
  for (const { statement, rows: items } of plan.sql) for (const values of items) db.prepare(statement).run(...values);
  db.close();
}
function trapObject(path, kvEntries, alarm, log) {
  const db = new DatabaseSync(path, { readOnly: true });
  const sql = { exec(statement, ...bindings) {
    log.push(statement);
    if (WRITE_SQL.test(statement) || /;\s*\S/.test(statement)) violate(`sql:${statement.slice(0, 40)}`);
    return cursorOf(db.prepare(statement).all(...bindings));
  } };
  const entries = new Map(Object.entries(kvEntries).sort(([a], [b]) => utf8Compare(a, b)));
  const storage = trapProxy("storage", {
    sql,
    list: async ({ limit = Infinity, startAfter, ...rest } = {}) => {
      if (Object.keys(rest).length) violate(`storage.list:${Object.keys(rest)}`);
      return new Map([...entries].filter(([key]) => startAfter === undefined || utf8Compare(key, startAfter) > 0).slice(0, limit).map(([key, value]) => [key, structuredClone(value)]));
    },
    getAlarm: async () => alarm,
  });
  const ctx = trapProxy("ctx", { storage, id: { toString: () => "synthetic" } });
  return { db, ctx, entries };
}
function poison(instance) {
  for (const name of Object.getOwnPropertyNames(RuntimeInstances.prototype)) {
    if (["constructor", "fetch", "sql"].includes(name)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(RuntimeInstances.prototype, name);
    if (typeof descriptor.value === "function") instance[name] = () => violate(`method:${name}`);
  }
  Object.defineProperty(instance, "sql", { get: () => violate("this.sql") });
  instance.directory = trapProxy("directory", {});
  instance.deskReadbacks = trapProxy("deskReadbacks", {});
}
function fakeKv(values, { script = null } = {}) {
  const names = Object.keys(values).sort(utf8Compare);
  const gets = [];
  const store = trapProxy("kv", {
    async get(name, type) { gets.push(name); if (type !== undefined) violate("kv.get:type"); return script?.get ? script.get(name) : values[name] ?? null; },
    async list({ limit = 1000, cursor, ...rest } = {}) {
      if (Object.keys(rest).length) violate(`kv.list:${Object.keys(rest)}`);
      if (script?.list) return script.list({ limit, cursor });
      const start = cursor ? Number(Buffer.from(cursor, "base64url").toString()) : 0;
      const page = names.slice(start, start + limit);
      const end = start + page.length;
      return { keys: page.map(name => ({ name, ...(name.startsWith("runtime_daily:") ? { expiration: 4_102_444_800 } : {}) })),
        list_complete: end >= names.length, ...(end < names.length ? { cursor: Buffer.from(String(end)).toString("base64url") } : {}) };
    },
  });
  return { store, gets };
}
const KV_VALUES = {
  account_options: JSON.stringify({ ibkr: [{ key: "acct-000", account_selector: "sel-0", api_key: CANARY }], schwab: [{ key: "shared" }] }),
  account_facts_bindings: JSON.stringify({ ibkr: { "acct-000": { source_binding_id: "src-1" } } }),
  runtime_daily_bindings: "{}",
  current_strategies_cache: JSON.stringify({ ts: 1 }),
  audit_log: JSON.stringify([{ login: ACTOR_CANARY, action: "update", ts: 1 }]),
  risk_profile_bindings: "{}",
  [`account_facts_primary_backup:${hex("b")}`]: "{}",
  "research_promotion_ticket:t-1": JSON.stringify({ ticket_id: "t-1", status: "open" }),
  "research_promotion_ticket:t-2": JSON.stringify({ ticket_id: "t-2", state: "awaiting_human" }),
  "research_promotion_ticket:t-3": JSON.stringify({ ticket_id: "t-3", state: "human_accepted" }),
  "reconciliation_recovery_confirmation:r-1": JSON.stringify({ recovery_id: "r-1" }),
  "owner_decision_current:bad": "{bad",
  auth_config: JSON.stringify({ admin: CANARY }),
  legacy_mystery_key: CANARY,
  ...Object.fromEntries(range(1100).map(index => [`runtime_daily:target-${index % 7}:${day(index)}`, JSON.stringify({ target_key: `target-${index % 7}`, business_date: day(index) })])),
};
const ENV_SECTION = {
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ ibkr: [{ key: "acct-000", account_selector: "sel-0", token: CANARY }] }),
  BINANCE_ACCOUNT_FACTS_BINDING_JSON: "{",
  CF_VERSION_METADATA: { id: "00000000-0000-4000-8000-000000000000", tag: "synthetic", timestamp: "2026-11-15T00:00:00Z" },
};

async function harness({ runtime, directory, extraEnv = {}, kv = fakeKv(KV_VALUES), objectFailure = null }) {
  const dir = await mkdtemp(join(tmpdir(), "qrt-inventory-trap-"));
  const objects = {}, logs = {}, digests = {}, doCalls = [];
  for (const [name, plan] of [["runtime-instances", runtime], ["console-kv-directory-v1", directory]]) {
    const path = join(dir, `${name}.sqlite`);
    await seedDatabase(path, plan, { initialize: plan.initialize !== false && plan.sql.length > 0 || plan.initialize === true });
    digests[name] = createHash("sha256").update(await readFile(path)).digest("hex");
    logs[name] = [];
    const trap = trapObject(path, plan.kv, plan.alarm, logs[name]);
    const instance = new RuntimeInstances(trap.ctx, { STRATEGY_SWITCH_CONFIG: kv.store, ...env0 });
    assert.deepEqual(logs[name], [], `${name}: constructor executes no SQL`);
    poison(instance);
    objects[name] = { instance, trap, path };
  }
  const namespace = trapProxy("namespace", {
    idFromName: name => ({ name }),
    get: id => trapProxy("stub", { fetch: async (url, init) => {
      doCalls.push(id.name);
      if (objectFailure) return objectFailure();
      if (!objects[id.name]) violate(`object:${id.name}`);
      return objects[id.name].instance.fetch(new Request(url, init));
    } }),
  });
  const env = { ...env0, STRATEGY_SWITCH_CONFIG: kv.store, STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace, ...extraEnv };
  const executionCtx = trapProxy("executionCtx", {});
  const outputs = [];
  const get = async (path, { cookie = adminCookie, method = "GET", headers = {} } = {}) => {
    const response = await worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } }), env, executionCtx);
    const text = await response.text();
    outputs.push(text);
    return { status: response.status, headers: response.headers, body: JSON.parse(text) };
  };
  const unchanged = async () => {
    for (const [name, object] of Object.entries(objects)) {
      const now = createHash("sha256").update(await readFile(object.path)).digest("hex");
      assert.equal(now, digests[name], `${name}: database bytes unchanged`);
    }
  };
  const close = async () => { for (const object of Object.values(objects)) object.trap.db.close(); await rm(dir, { recursive: true, force: true }); };
  return { get, outputs, logs, doCalls, kv, unchanged, close };
}

// Full collection of one object through the HTTP route, recorded as an export.
async function collect(get, object, { pageSize = 100, responses = [] } = {}) {
  const call = async params => {
    const result = await get(`${ROUTE}?${new URLSearchParams(params)}`);
    responses.push({ request: params, status: result.status, body: result.body });
    return result;
  };
  const schema = await call({ section: "schema", object });
  assert.equal(schema.status, 200, `${object}: schema page`);
  const scan = schema.body.scan;
  for (const [table, info] of Object.entries(schema.body.tables)) {
    if (!info.present || info.count_only) continue;
    let page = await call({ section: "sql", object, table, page_size: String(pageSize), scan });
    while (page.status === 200 && page.body.cursor) page = await call({ section: "sql", object, table, page_size: String(pageSize), cursor: page.body.cursor });
    assert.equal(page.status, 200, `${object}/${table}: page chain`);
  }
  let page = await call({ section: "do_kv", object, page_size: String(pageSize), scan });
  while (page.status === 200 && page.body.cursor) page = await call({ section: "do_kv", object, page_size: String(pageSize), cursor: page.body.cursor });
  assert.equal(page.status, 200, `${object}: DO-KV chain`);
  const final = await call({ section: "finalize", object, scan });
  return { responses, schema: schema.body, final: final.body };
}
async function collectKv(get, responses) {
  let page = await get(`${ROUTE}?section=kv&page_size=100`);
  responses.push({ request: { section: "kv" }, status: page.status, body: page.body });
  while (page.status === 200 && page.body.cursor) {
    page = await get(`${ROUTE}?${new URLSearchParams({ section: "kv", page_size: "100", cursor: page.body.cursor })}`);
    responses.push({ request: { section: "kv" }, status: page.status, body: page.body });
  }
  return page;
}
const noLeak = (outputs, label) => {
  const text = outputs.join("\n");
  for (const needle of [CANARY, ACTOR_CANARY, String(AMOUNT_CANARY), SECRET]) assert.ok(!text.includes(needle), `${label}: output never contains ${needle}`);
};

// ---------------------------------------------------- A1: empty object
{
  const h = await harness({ runtime: { sql: [], kv: {}, alarm: null, initialize: false }, directory: { sql: [], kv: {}, alarm: null, initialize: false } });
  for (const object of ["runtime", "directory"]) {
    const { schema, final, responses } = await collect(h.get, object);
    assert.equal(schema.schema_state, "schema_absent");
    assert.equal(schema.missing_tables.length, Object.keys(INVENTORY_TABLES).length);
    assert.equal(final.stable, true);
    const doKv = responses.find(item => item.request.section === "do_kv").body;
    assert.deepEqual([doKv.entries, doKv.terminal], [[], true], "empty DO-KV page is terminal");
    const absent = await h.get(`${ROUTE}?${new URLSearchParams({ section: "sql", object, table: "instance_state", scan: schema.scan })}`);
    assert.deepEqual([absent.status, absent.body.present, absent.body.terminal], [200, false, true], "missing table reported, never created");
  }
  assert.ok(Object.values(h.logs).flat().every(statement => /^SELECT /.test(statement)), "only SELECT statements reached SQL");
  await h.unchanged();
  await h.close();
}

// ---------------------------------------------------- A2: old and partially migrated schemas
{
  const old = { sql: [...OLD_SCHEMA.map(statement => ({ statement, rows: [[]] })), ...OLD_SCHEMA_ROWS], kv: {}, alarm: null, initialize: false };
  const h = await harness({ runtime: old, directory: { sql: [], kv: {}, alarm: null, initialize: false } });
  const { schema, final, responses } = await collect(h.get, "runtime");
  assert.equal(schema.schema_state, "partial");
  for (const [table, missing] of Object.entries(EXPECTED_OLD_MISSING)) assert.deepEqual(schema.tables[table].missing_columns, missing, `${table}: exact missing columns`);
  assert.ok(schema.missing_tables.includes("instance_history") && schema.missing_tables.includes("account_facts_daily"));
  assert.equal(schema.tables.instance_state.row_count, 1);
  const diagnosis = responses.find(item => item.request.table === "account_diagnosis_tasks").body.rows[0];
  assert.equal(diagnosis.columns.summary.column_absent, true, "absent columns are explicit");
  assert.equal(final.stable, true);
  await h.unchanged();
  await h.close();
}

// ---------------------------------------------------- A2b: NULL primary-key rows are withheld on every page
{
  const nullable = { sql: [
    { statement: "CREATE TABLE account_setting_draft (platform TEXT, account_key TEXT, revision INTEGER, identity_json TEXT, overrides_json TEXT, updated_at TEXT, PRIMARY KEY (platform, account_key))", rows: [[]] },
    rows("account_setting_draft", [["a", "first"], ["b", "middle"], ["z", null], [null, "lead"]].map(([platform, accountKey]) => ({ platform, account_key: accountKey, revision: 1, identity_json: "{}", overrides_json: "{}", updated_at: day(1) }))),
  ], kv: {}, alarm: null, initialize: false };
  const h = await harness({ runtime: nullable, directory: { sql: [], kv: {}, alarm: null, initialize: false } });
  const { schema, responses } = await collect(h.get, "runtime", { pageSize: 1 });
  assert.deepEqual([schema.tables.account_setting_draft.row_count, schema.tables.account_setting_draft.null_key_rows], [4, 2]);
  const pages = responses.filter(item => item.request.table === "account_setting_draft");
  assert.deepEqual(pages.flatMap(item => item.body.rows.map(row => row.pk)), [["a", "first"], ["b", "middle"]], "continuation never surfaces a NULL-key row");
  assert.ok(pages.every(item => item.body.null_key_rows === 2));
  const table = assemble({ format: EXPORT_FORMAT, responses }).private.objects[0];
  assert.equal(table.tables.account_setting_draft.rows.length, 2);
  assert.ok(table.reasons.includes("account_setting_draft:null_primary_key_rows") && !table.reasons.includes("account_setting_draft:row_count_mismatch"),
    "withheld rows are counted once and explicitly incomplete");
  await h.unchanged();
  await h.close();
}

// ---------------------------------------------------- A2c: per-family terminal labels and admission state presence
// A label another family treats as terminal stays unknown in a family whose
// writer never produces it. Only an explicitly idle admission is excluded.
{
  const probe = { sql: [
    rows("account_diagnosis_tasks", ["queued", "succeeded", "applied", "unknown"].map((status, index) => ({ request_id: `diag-${index}`, platform: "ibkr",
      account_key: "acct-000", status, checks_json: "[]", native_json: null }))),
    rows("account_setting_profile_application", ["invalidated", "applied", "rejected", "succeeded"].map((status, index) => ({ request_key: `req-${index}`,
      platform: "ibkr", account_key: "acct-000", identity_json: "{}", instance_revision: 1, draft_revision: 1, old_profile: "a", new_profile: "b",
      approved_by: "a", approved_at: day(index), status, workflow_run_id: null, workflow_run_attempt: null, claimed_at: null }))),
    rows("research_promotion_applications", ["applied_paused", "rejected", "succeeded", "applied"].map((status, index) => ({ application_id: `app-${index}`,
      ticket_id: "t", status, platform_id: "ibkr", account_key: "acct-000", expected_revision: 1, workflow_run_id: null, workflow_run_attempt: null, readback_json: null }))),
    rows("hk_stop_request", ["applied", "rejected", "protected", "completed", "succeeded"].map((phase, index) => ({ request_id: `stop-${index}`, target_id: `t-${index}`,
      identity_json: "{}", source_revision: index, phase, dispatch_result: null, workflow_run_id: null, workflow_run_attempt: null,
      source_identity_sha256: null, runtime_identity_sha256: null, result_json: null, stopped_at: null }))),
  ], kv: {
    "desk:readbacks:admission:idle": { active: null, nextAllowed: 1, expires: 4_102_444_800_000 },
    "desk:readbacks:admission:busy": { active: "rb-1", nextAllowed: 1, expires: 4_102_444_800_000 },
    "desk:readbacks:admission:nostate": { nextAllowed: 1, expires: 4_102_444_800_000 },
  }, alarm: null };
  const directory = { sql: [], kv: {
    "desk:readbacks:admission:invalid": { active: 7, nextAllowed: 1, expires: 1 },
    "desk:readbacks:admission:scalar": "busy",
  }, alarm: null, initialize: false };
  const kv = fakeKv({ "owner_decision_current:c-1": JSON.stringify({ status: "applied" }), "reconciliation_recovery_current:r-1": JSON.stringify({ state: "completed" }),
    "research_promotion_ticket:t-1": JSON.stringify({ state: "succeeded" }) });
  const h = await harness({ runtime: probe, directory, kv, extraEnv: { ACCOUNT_IDENTITY_INVENTORY_KV_ENABLED: "true" } });
  const responses = [];
  await collect(h.get, "runtime", { responses });
  await collect(h.get, "directory", { responses });
  await collectKv(h.get, responses);
  const exported = responses.filter(item => item.request.section === "do_kv").flatMap(item => item.body.entries).filter(item => item.family === "desk_readback_admission");
  assert.deepEqual(exported.map(item => item.active_state).sort(), ["active", "idle", "invalid:number", "missing", "unreadable"], "admission state presence survives projection");
  const sqlRows = table => responses.filter(item => item.request.table === table).flatMap(item => item.body.rows).length;
  assert.equal(sqlRows("account_diagnosis_tasks"), 4, "four diagnosis rows retained in the export");
  const { private: result } = assemble({ format: EXPORT_FORMAT, responses });
  const statuses = family => result.pending.filter(item => item.family === family).map(item => `${item.status}/${item.classification}`).sort();
  assert.deepEqual(statuses("account_diagnosis_tasks"), ["applied/unknown", "queued/nonterminal", "unknown/unknown"],
    "diagnosis: a label foreign to diagnosis stays unknown and listed even when another family treats it as terminal");
  assert.deepEqual(statuses("account_setting_profile_application"), ["applied/unknown", "rejected/unknown", "succeeded/unknown"], "profile: only invalidated is terminal");
  assert.deepEqual(statuses("research_promotion_applications"), ["applied/unknown", "succeeded/unknown"], "promotion: only applied_paused and rejected are terminal");
  assert.deepEqual(statuses("hk_stop_request"), ["completed/unknown", "succeeded/unknown"], "stop: only applied, rejected and protected are terminal");
  assert.deepEqual(statuses("owner_decision_current:"), ["applied/unknown"], "owner decision: no label proves completion");
  assert.deepEqual(statuses("reconciliation_recovery_current:"), ["completed/unknown"], "recovery: no label proves completion");
  assert.deepEqual(statuses("research_promotion_ticket:"), ["succeeded/unknown"], "ticket: a foreign terminal label stays unknown");
  const admissions = object => result.pending.filter(item => item.family === "desk_readback_admission" && item.object === object).map(item => `${item.status}/${item.classification}`).sort();
  assert.equal(exported.filter(item => responses.some(page => page.request.object === "runtime" && page.body.entries?.includes(item))).length, 3, "three runtime admissions retained");
  assert.deepEqual(admissions("runtime"), ["active/nonterminal", "missing/unknown"], "missing admission state is unknown, not idle; explicit idle is excluded");
  assert.deepEqual(admissions("directory"), ["invalid:number/unknown", "unreadable/unknown"], "invalid or non-object admission state stays unknown");
  await h.unchanged();
  await h.close();
}

// ---------------------------------------------------- A2d: Desk snapshots and cache-key identities from the real writers
// Records come from DeskReadbackStore and the current-strategies loaders and
// writer, unmodified, over in-memory stores; then the real route and assemble().
const { DeskReadbackStore, buildReadback } = await import(new URL("application/desk/readback.js", CONSOLE));
const { loadStrategiesForPlatform, executionEvidenceFallback, writeCurrentStrategiesCache } = await import(new URL("application/worker/runtime_support.js", CONSOLE));
function memoryStorage() {
  const map = new Map();
  let alarm = null;
  const api = {
    get: async name => structuredClone(map.get(name)),
    put: async (name, item) => { map.set(name, structuredClone(item)); },
    delete: async name => map.delete(name),
    list: async ({ prefix = "" } = {}) => new Map([...map].filter(([name]) => name.startsWith(prefix)).sort(([a], [b]) => utf8Compare(a, b))
      .map(([name, item]) => [name, structuredClone(item)])),
    getAlarm: async () => alarm, setAlarm: async at => { alarm = at; }, deleteAlarm: async () => { alarm = null; },
  };
  return { ...api, transaction: async work => work(api), map };
}
async function deskRecords() {
  const storage = memoryStorage();
  const config = { account_selector: "U1234567", broker_environment: "paper", default_strategy_profile: "profile-a" };
  // t-fresh reads with no observation (overall unknown); t-job drifts.
  const read = async id => buildReadback({ target: { id, platform: "ibkr", revision: 1, config }, now: Date.now(), cleanRatio: () => true,
    splitSelectorValues: item => String(item).split(","), ...(id === "t-job" ? { observed: { instance_revision: 1, config, enabled: true },
      platform: { strategy_profile: "profile-b" } } : { observed: null }) });
  const store = new DeskReadbackStore(storage, read);
  await store.command({ action: "desk_readback_fresh", owner: "owner-a", actor: "actor-a", id: "t-fresh" });
  await store.command({ action: "desk_readback_start", owner: "owner-b", actor: "actor-b", body: { idempotency_key: "k-done" }, ids: ["t-job"] });
  await store.alarm();
  await store.command({ action: "desk_readback_start", owner: "owner-c", actor: "actor-c", body: { idempotency_key: "k-running" }, ids: ["t-later"] });
  return Object.fromEntries(storage.map);
}
async function cacheText(build) {
  const values = new Map();
  const env = { STRATEGY_SWITCH_CONFIG: { get: async name => values.get(name) ?? null, put: async (name, text) => { values.set(name, text); } } };
  await writeCurrentStrategiesCache(env, await build(), 1_700_000_000_000);
  return values.get("current_strategies_cache");
}
async function inventoryOf({ doKv = {}, kvValues = {} }) {
  const h = await harness({ runtime: { sql: [], kv: doKv, alarm: null, initialize: false }, directory: { sql: [], kv: {}, alarm: null, initialize: false },
    kv: fakeKv(kvValues), extraEnv: { ACCOUNT_IDENTITY_INVENTORY_KV_ENABLED: "true" } });
  const responses = [];
  await collect(h.get, "runtime", { responses });
  await collect(h.get, "directory", { responses });
  await collectKv(h.get, responses);
  await collectKv(h.get, responses);
  const assembled = assemble({ format: EXPORT_FORMAT, responses });
  assert.deepEqual(violations, [], "no trap fired");
  await h.unchanged();
  await h.close();
  return { responses, ...assembled };
}
{
  const written = await deskRecords();
  const records = Object.entries(written).filter(([name]) => name.startsWith("desk:readbacks:record:"));
  const snapshots = records.filter(([, record]) => !("state" in record.payload));
  assert.deepEqual([records.length, snapshots.length], [4, 2], "writer stored two snapshots, a finished job and a running job");
  assert.deepEqual(snapshots.map(([, record]) => record.payload.overall).sort(), ["drift", "unknown"]);
  const [, snapshot] = snapshots[0];
  const mutate = edit => { const copy = structuredClone(snapshot); edit(copy); return copy; };
  const controls = {
    "desk:readbacks:record:rb_overall": mutate(copy => { copy.payload.readback_id = "rb_overall"; copy.payload.overall = "partial"; }),
    "desk:readbacks:record:rb_mismatch": mutate(copy => { copy.payload.readback_id = "rb_other"; }),
    "desk:readbacks:record:rb_pending": mutate(copy => { copy.payload.readback_id = "rb_pending"; copy.pending = []; }),
    "desk:readbacks:record:rb_nofields": mutate(copy => { copy.payload.readback_id = "rb_nofields"; delete copy.payload.fields; }),
    "desk:readbacks:record:rb_empty": { owner: "owner-x", expires: 4_102_444_800_000, payload: {} },
    "desk:readbacks:record:rb_scalar": "snapshot",
    "desk:readbacks:record:rbj_done": { owner: "owner-x", expires: 4_102_444_800_000, payload: { state: "done", results: [] }, pending: [], results: [] },
    "desk:readbacks:record:rbj_partial": { owner: "owner-x", expires: 4_102_444_800_000, payload: { state: "partial", results: [] }, pending: [], results: [] },
  };
  const fresh = await inventoryOf({ doKv: Object.fromEntries(snapshots.filter(([, record]) => record.payload.overall === "unknown")) });
  assert.deepEqual(fresh.private.pending.filter(item => item.family === "desk_readback_record"), [], "F1: a fresh completed snapshot is not pending, even with overall unknown");
  const mixed = await inventoryOf({ doKv: { ...written, ...controls } });
  const exported = mixed.responses.filter(item => item.request.section === "do_kv" && item.request.object === "runtime").flatMap(item => item.body.entries)
    .filter(item => item.family === "desk_readback_record");
  assert.deepEqual(Object.keys(controls).filter(name => name.includes(":rb_")).map(name => exported.find(item => item.key === name).record_kind),
    Array(6).fill("unrecognized"), "snapshot-like and malformed controls are unrecognized");
  assert.equal(exported.filter(item => item.record_kind === "snapshot").length, 2, "both writer snapshots recognized; every control rejected");
  assert.equal(exported.filter(item => item.record_kind === "job").length, 4);
  const desk = mixed.private.pending.filter(item => item.family === "desk_readback_record");
  const listed = desk.map(item => [item.key.slice("desk:readbacks:record:".length).replace(/^rbj_[0-9a-f-]{36}$/, "rbj_writer"), `${item.status}/${item.classification}`]).sort();
  assert.deepEqual(listed, [["rb_empty", "missing/unknown"], ["rb_mismatch", "missing/unknown"], ["rb_nofields", "missing/unknown"],
    ["rb_overall", "missing/unknown"], ["rb_pending", "missing/unknown"], ["rb_scalar", "missing/unknown"], ["rbj_writer", "running/nonterminal"]],
    "F1: running job listed; finished jobs and both snapshots excluded; malformed records stay unknown");
}
{
  const option = { key: "cache-only", account_selector: "sel-cache", broker_environment: "paper" };
  const readVariable = Object.assign(async (...args) => (args[3] === "STRATEGY_PROFILE" ? "tqqq_growth_income" : ""), { readStatus: async () => "ok" });
  const cases = {
    normal: () => loadStrategiesForPlatform("ibkr", { ibkr: [option] }, { ibkr: "org/repo" }, readVariable).then(entries => ({ ibkr: entries })),
    fallback_not_connected: () => loadStrategiesForPlatform("ibkr", { ibkr: [option] }, {}, readVariable).then(entries => ({ ibkr: entries })),
    fallback_read_failed: () => executionEvidenceFallback({ ibkr: [option] }, "read_failed"),
  };
  for (const [name, build] of Object.entries(cases)) {
    const text = await cacheText(build);
    const stored = JSON.parse(text).data.ibkr["cache-only"];
    assert.ok(stored && !JSON.stringify(stored).includes("cache-only"), `${name}: writer names the account only by its object key`);
    const { private: result, summary } = await inventoryOf({ kvValues: { current_strategies_cache: text } });
    assert.equal(result.groups[20], "complete", `${name}: group 20 complete`);
    const mapped = result.mapping.entries.filter(item => item.legacy_key === "cache-only");
    assert.deepEqual(mapped.map(item => item.platform), ["ibkr"], `F2 ${name}: cache-only account is mapped`);
    assert.deepEqual(mapped[0].episodes.map(episode => [episode.state, episode.locator]),
      [["kv_reference", { source: "kv", name: "current_strategies_cache", path: ["data", "ibkr", "cache-only"] }]], `${name}: KV locator`);
    const identity = mapped[0].episodes[0].identity;
    assert.equal(identity.qualifiers.broker_environment, "paper", `${name}: family qualifier from execution evidence`);
    assert.deepEqual([identity.cache_entry, identity.evidence_status], name === "normal" ? ["strategy", "config_missing"]
      : ["execution_evidence_only", name.replace("fallback_", "")], `${name}: entry shape and evidence status`);
    assert.ok(!JSON.stringify(summary).includes("cache-only"), `${name}: summary stays sanitized`);
  }
  // A cache account without a platform lands in the unattributed ledger;
  // object keys of other families are still not account identities.
  const { private: loose } = await inventoryOf({ kvValues: { current_strategies_cache: JSON.stringify({ ts: 1, data: { "": { "no-platform": {} } } }),
    account_facts_bindings: JSON.stringify({ ibkr: { "bindings-key-only": { source_binding_id: "src-9" } } }) } });
  assert.deepEqual(loose.mapping.unattributed.map(item => [item.legacy_key, item.locator.path]), [["no-platform", ["data", "", "no-platform"]]]);
  assert.ok(!loose.mapping.entries.some(item => item.legacy_key === "bindings-key-only"), "B2 rule: other families' object keys stay non-identities");
  // A projection cut at its bound is an unread identity for group 20.
  const bounded = strategiesCacheAccounts({ data: { ibkr: { a: {}, b: {} } } }, 1);
  assert.deepEqual([bounded.accounts.length, bounded.truncated], [1, true]);
  const big = JSON.stringify({ ts: 1, data: { ibkr: Object.fromEntries(range(4001).map(index => [`k-${index}`, {}])) } });
  const cut = (await inventoryOf({ kvValues: { current_strategies_cache: big } })).private;
  assert.deepEqual([cut.status, cut.groups[20], cut.group_reasons[20]], ["incomplete", "incomplete", ["kv:current_strategies_cache:cache_accounts_truncated"]]);
  assert.equal(cut.kv.keys.find(key => key.name === "current_strategies_cache").identity.truncated, false, "the specialized bound alone: the generic projection is complete");
  // A hierarchy that is not the writer's shape is unread, not empty; an empty
  // account key is a stored slot and lands in the unattributed ledger.
  for (const data of [[], { ibkr: "flat" }]) {
    const odd = (await inventoryOf({ kvValues: { current_strategies_cache: JSON.stringify({ ts: 1, data }) } })).private;
    assert.deepEqual([odd.groups[20], odd.group_reasons[20]], ["incomplete", ["kv:current_strategies_cache:cache_accounts_unexpected_shape"]], JSON.stringify(data));
  }
  const blank = (await inventoryOf({ kvValues: { current_strategies_cache: JSON.stringify({ ts: 1, data: { ibkr: { "": {} } } }) } })).private;
  assert.deepEqual(blank.mapping.unattributed.map(item => [item.legacy_key, item.locator.path]), [["", ["data", "ibkr", ""]]]);
  assert.equal(blank.groups[20], "complete");
}

// ---------------------------------------------------- A2e: r6 matrix over real collection and assemble()
// Every fixture is collected through the real route (both objects
// finalized, two equal KV passes, env collected) and assembled unmodified;
// `isolate` leaves assembly to a separate process.
async function inventoryFull({ sql = [], kvValues = {}, envValues = {}, collectEnv = true, isolate = false } = {}) {
  const h = await harness({ runtime: { sql, kv: {}, alarm: null, initialize: sql.length > 0 }, directory: { sql: [], kv: {}, alarm: null, initialize: false },
    kv: fakeKv(kvValues), extraEnv: { ACCOUNT_IDENTITY_INVENTORY_KV_ENABLED: "true", ACCOUNT_IDENTITY_INVENTORY_ENV_ENABLED: "true", ...envValues } });
  const responses = [];
  await collect(h.get, "runtime", { responses });
  await collect(h.get, "directory", { responses });
  await collectKv(h.get, responses);
  await collectKv(h.get, responses);
  if (collectEnv) {
    const envPage = await h.get(`${ROUTE}?section=env`);
    responses.push({ request: { section: "env" }, status: envPage.status, body: envPage.body });
    assert.equal(envPage.status, 200, "env section collected");
  }
  const exported = { format: EXPORT_FORMAT, responses };
  const assembled = isolate ? {} : assemble(structuredClone(exported));
  assert.deepEqual(violations, [], "no trap fired");
  await h.unchanged();
  await h.close();
  return { exported, responses, ...assembled };
}
const exportedKv = (responses, name) => {
  const items = responses.filter(item => item.request.section === "kv").flatMap(item => item.body.keys).filter(item => item.name === name);
  assert.equal(items.length, 2, `${name}: listed once in each KV pass`);
  return items.at(-1);
};
const ENUMERATED = "retained_state_enumerated_external_evidence_required";
// An unrelated reviewed family in group 20, read completely in every fixture.
const UNRELATED = { risk_profile_bindings: JSON.stringify({ rows: [{ platform: "ibkr", account_key: "unrelated-account" }] }) };

// N1: a generic identity projection cut at its field bound is a failed read.
{
  const options = (count, last = null) => JSON.stringify({ ibkr: [...range(count).map(index => ({ key: `opt-${pad(index)}`, account_selector: `sel-${index}` })), ...(last ? [last] : [])] });
  const cases = {
    "N1-fields-4000": { value: options(2000), inputs: 4000, retained: 2000, truncated: false },
    "N1-fields-4001": { value: options(2000, { key: "opt-last" }), inputs: 4001, retained: 2001, truncated: true },
    "N1-fields-4002-r5": { value: options(2001), inputs: 4002, retained: 2001, truncated: true },
  };
  for (const [label, item] of Object.entries(cases)) {
    const stored = JSON.parse(item.value);
    assert.deepEqual([stored.ibkr.length, stored.ibkr.reduce((total, option) => total + Object.keys(option).length, 0)], [item.retained, item.inputs], `${label}: fixture input counts`);
    const { responses, private: result, summary } = await inventoryFull({ kvValues: { account_options: item.value, ...UNRELATED } });
    const projected = exportedKv(responses, "account_options");
    assert.deepEqual([projected.state, Object.keys(projected.identity.fields).length, projected.identity.truncated], ["exported", 4000, item.truncated], `${label}: projected fields`);
    const configured = result.mapping.entries.filter(entry => entry.episodes.some(episode => episode.state === "configured_option"));
    assert.equal(configured.length, 2000, `${label}: mapped option accounts`);
    assert.equal(result.mapping.entries.length, 2001, `${label}: option accounts plus the unrelated account`);
    assert.equal(result.kv.repeated_pass_equal, true, `${label}: two equal passes`);
    assert.equal(result.groups[20], "complete", `${label} (N1-unaffected-group): unrelated group 20 stays complete`);
    if (!item.truncated) {
      assert.deepEqual([result.kv.failed_reads, result.groups[16], result.status, summary.status], [[], "complete", ENUMERATED, ENUMERATED], `${label}: complete`);
      continue;
    }
    assert.deepEqual(result.kv.failed_reads, [{ name: "account_options", family: "account_options", state: "identity_projection_truncated",
      causes: ["identity_projection_truncated"], group: "16" }], `${label}: exactly one failed KV key`);
    assert.deepEqual([result.groups[16], result.group_reasons[16], result.status], ["incomplete", ["kv:account_options:identity_projection_truncated"], "incomplete"], `${label}: group 16 and overall incomplete`);
    assert.deepEqual([summary.status, summary.kv.failed_reads, summary.kv.repeated_pass_equal, summary.groups[16]], ["incomplete", 1, true, "incomplete"], `${label}: summary`);
    assert.ok(result.reasons.includes("kv:account_options:identity_projection_truncated"));
  }
}
// N1: an explicit reference at the depth bound and one level beyond it.
{
  const nested = depth => {
    let node = { platform: "ibkr", account_key: "deep-account" };
    for (let level = depth; level >= 1; level--) node = { [`l${level}`]: node };
    return node;
  };
  for (const [label, depth, fields, truncated] of [["N1-depth-8", 8, 2, false], ["N1-depth-9", 9, 0, true]]) {
    const { responses, private: result, summary } = await inventoryFull({ kvValues: { account_facts_bindings: JSON.stringify(nested(depth)), ...UNRELATED } });
    const projected = exportedKv(responses, "account_facts_bindings");
    assert.deepEqual([Object.keys(projected.identity.fields).length, projected.identity.truncated], [fields, truncated], `${label}: projected fields`);
    const deep = result.mapping.entries.filter(entry => entry.legacy_key === "deep-account");
    assert.equal(result.groups[20], "complete", `${label}: unrelated group 20 stays complete`);
    if (!truncated) {
      assert.deepEqual(deep.map(entry => [entry.platform, entry.episodes.length]), [["ibkr", 1]], `${label}: one mapping`);
      assert.deepEqual([result.kv.failed_reads, result.groups[17], result.status], [[], "complete", ENUMERATED], `${label}: complete`);
      continue;
    }
    assert.deepEqual(deep, [], `${label}: the omitted identity is not invented`);
    assert.deepEqual(result.kv.failed_reads, [{ name: "account_facts_bindings", family: "account_facts_bindings", state: "identity_projection_truncated",
      causes: ["identity_projection_truncated"], group: "17" }], `${label}: the located failed read`);
    assert.deepEqual([result.groups[17], result.status, summary.kv.failed_reads, result.groups[16]], ["incomplete", "incomplete", 1, "complete"], `${label}: group 17 and overall incomplete`);
  }
}
// N1: generic and specialized-cache truncation are independent causes.
{
  const cache = (accounts, entry) => JSON.stringify({ ts: 1, data: { ibkr: Object.fromEntries(range(accounts).map(index => [`cache-${pad(index)}`, entry])) } });
  const combinations = {
    neither: { value: cache(2, { account_selector: "s" }), generic: false, specialized: false, mapped: 2, causes: [] },
    generic: { value: cache(2001, { account_selector: "s", target_name: "t" }), generic: true, specialized: false, mapped: 2001, causes: ["identity_projection_truncated"] },
    cache: { value: cache(4001, {}), generic: false, specialized: true, mapped: 4000, causes: ["cache_accounts_truncated"] },
    both: { value: cache(4001, { account_selector: "s" }), generic: true, specialized: true, mapped: 4000, causes: ["identity_projection_truncated", "cache_accounts_truncated"] },
  };
  for (const [label, item] of Object.entries(combinations)) {
    const { responses, private: result, summary } = await inventoryFull({ kvValues: { current_strategies_cache: item.value, account_facts_bindings: "{}" } });
    const projected = exportedKv(responses, "current_strategies_cache");
    assert.deepEqual([projected.identity.truncated, projected.cache_accounts.truncated, projected.cache_accounts.accounts.length], [item.generic, item.specialized, item.mapped],
      `N1-cache-independent-flags ${label}: real projections`);
    assert.equal(result.mapping.entries.filter(entry => entry.legacy_key.startsWith("cache-")).length, item.mapped, `${label}: specialized mapped observations remain`);
    assert.deepEqual([result.groups[17], result.kv.repeated_pass_equal], ["complete", true], `${label}: unrelated group and equal passes`);
    if (!item.causes.length) {
      assert.deepEqual([result.kv.failed_reads, result.groups[20], result.status], [[], "complete", ENUMERATED], `${label}: complete`);
      continue;
    }
    assert.deepEqual(result.kv.failed_reads.map(read => [read.name, read.state, read.causes]), [["current_strategies_cache", item.causes[0], item.causes]], `${label}: one failed read, every cause`);
    assert.deepEqual([result.groups[20], result.group_reasons[20], result.status, summary.kv.failed_reads],
      ["incomplete", item.causes.map(cause => `kv:current_strategies_cache:${cause}`), "incomplete", 1], `${label}: incomplete for its causes`);
  }
}

// C9/C10: an environment binding's identity projection cut at its field or
// depth bound makes group 16 and the overall result incomplete.
const ENV_BINDING_NAMES = ["STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON", "BINANCE_ACCOUNT_FACTS_BINDING_JSON", "BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON"];
const exportedEnv = (responses, name) => {
  const pages = responses.filter(item => item.request.section === "env");
  assert.equal(pages.length, 1, "one env response");
  return pages[0].body.bindings.find(item => item.name === name);
};
const envReasonsOf = result => result.reasons.filter(reason => reason.startsWith("env:"));
const otherGroupsComplete = (result, label) => {
  for (let group = 1; group <= 22; group++) if (group !== 16) assert.equal(result.groups[group], "complete", `${label}: unrelated group ${group} stays complete`);
};
const summaryAggregatesOnly = (summary, label, needles = []) => {
  const text = JSON.stringify(summary);
  for (const needle of [...ENV_BINDING_NAMES, "env:", "identity_projection_truncated", ...needles]) assert.ok(!text.includes(needle), `${label}: summary omits ${needle}`);
};
{
  const options = (count, last = null) => JSON.stringify({ ibkr: [...range(count).map(index => ({ key: `opt-${pad(index)}`, account_selector: `sel-${index}` })), ...(last ? [last] : [])] });
  const reason = "env:STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON:identity_projection_truncated";
  const cases = {
    "C9-env-fields-4000": { value: options(2000), inputs: 4000, accounts: 2000, truncated: false },
    "C9-env-fields-4001": { value: options(2000, { key: "opt-last" }), inputs: 4001, accounts: 2001, truncated: true },
    "C9-env-fields-4002": { value: options(2001), inputs: 4002, accounts: 2001, truncated: true },
  };
  for (const [label, item] of Object.entries(cases)) {
    const stored = JSON.parse(item.value);
    assert.deepEqual([stored.ibkr.length, stored.ibkr.reduce((total, option) => total + Object.keys(option).length, 0)], [item.accounts, item.inputs], `${label}: fixture input counts`);
    const { responses, private: result, summary } = await inventoryFull({ kvValues: UNRELATED, envValues: { STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: item.value } });
    const projected = exportedEnv(responses, "STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON");
    assert.deepEqual([projected.state, Object.keys(projected.identity.fields).length, projected.identity.truncated], ["present", 4000, item.truncated], `${label}: projected fields`);
    const configured = result.mapping.entries.filter(entry => entry.episodes.some(episode => episode.state === "configured_option"));
    assert.equal(configured.length, 2000, `${label}: surviving mappings remain`);
    assert.ok(configured.every(entry => entry.episodes.every(episode => episode.locator.source === "env:STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON")), `${label}: environment locators`);
    assert.equal(result.mapping.entries.length, 2001, `${label}: option accounts plus the unrelated account, no fabricated omitted account`);
    assert.ok(!result.mapping.entries.some(entry => ["opt-last", "opt-2000"].includes(entry.legacy_key)) && !result.mapping.unattributed.length, `${label}: omitted account not invented`);
    assert.deepEqual([result.kv.failed_reads, summary.kv.failed_reads, result.kv.repeated_pass_equal], [[], 0, true], `${label}: zero failed KV reads`);
    otherGroupsComplete(result, label);
    summaryAggregatesOnly(summary, label, ["opt-", "sel-"]);
    if (!item.truncated) {
      assert.deepEqual([result.groups[16], result.group_reasons[16], envReasonsOf(result), result.status, summary.status, summary.groups[16]],
        ["complete", undefined, [], ENUMERATED, ENUMERATED, "complete"], `${label}: complete and enumerated`);
      continue;
    }
    assert.deepEqual([result.groups[16], result.group_reasons[16], envReasonsOf(result), result.status], ["incomplete", [reason], [reason], "incomplete"],
      `${label}: group 16 and overall incomplete with the located reason once`);
    assert.deepEqual([summary.status, summary.groups[16], summary.reason_count], ["incomplete", "incomplete", result.reasons.length], `${label}: summary`);
  }
  // The KV control keeps its existing one-failed-key outcome and no env reason.
  const { private: control, summary } = await inventoryFull({ kvValues: { account_options: options(2001), ...UNRELATED } });
  assert.deepEqual(control.kv.failed_reads.map(read => [read.name, read.causes]), [["account_options", ["identity_projection_truncated"]]], "C9-kv-control: one failed key");
  assert.deepEqual([control.groups[16], control.group_reasons[16], envReasonsOf(control), control.status, summary.kv.failed_reads],
    ["incomplete", ["kv:account_options:identity_projection_truncated"], [], "incomplete", 1], "C9-kv-control: KV disposition unchanged");
}
{
  const nested = depth => {
    let node = { platform: "ibkr", account_key: "deep-account" };
    for (let level = depth; level >= 1; level--) node = { [`l${level}`]: node };
    return JSON.stringify(node);
  };
  for (const name of ENV_BINDING_NAMES) {
    for (const [depth, fields, truncated] of [[8, 2, false], [9, 0, true]]) {
      const label = `C10-env-depth-${depth} ${name}`;
      const { responses, private: result, summary } = await inventoryFull({ kvValues: UNRELATED, envValues: { [name]: nested(depth) } });
      const projected = exportedEnv(responses, name);
      assert.deepEqual([projected.state, Object.keys(projected.identity.fields).length, projected.identity.truncated], ["present", fields, truncated], `${label}: projected fields`);
      const deep = result.mapping.entries.filter(entry => entry.legacy_key === "deep-account");
      assert.deepEqual([result.kv.failed_reads, summary.kv.failed_reads], [[], 0], `${label}: no KV failure`);
      otherGroupsComplete(result, label);
      summaryAggregatesOnly(summary, label, ["deep-account"]);
      if (!truncated) {
        assert.deepEqual(deep.map(entry => [entry.platform, entry.episodes.map(episode => [episode.state, episode.locator])]),
          [["ibkr", [["env_reference", { source: "env", name, path: "l1.l2.l3.l4.l5.l6.l7.l8.account_key" }]]]], `${label}: one mapping`);
        assert.deepEqual([result.groups[16], envReasonsOf(result), result.status, summary.status], ["complete", [], ENUMERATED, ENUMERATED], `${label}: complete`);
        continue;
      }
      const reason = `env:${name}:identity_projection_truncated`;
      assert.deepEqual([deep, result.mapping.unattributed], [[], []], `${label}: the omitted identity is not invented`);
      assert.deepEqual([result.groups[16], result.group_reasons[16], envReasonsOf(result), result.status, summary.status, summary.groups[16]],
        ["incomplete", [reason], [reason], "incomplete", "incomplete", "incomplete"], `${label}: group 16 and overall incomplete`);
    }
  }
  // Two truncated bindings: two distinct reasons, no KV failure.
  const [first, , third] = ENV_BINDING_NAMES;
  const { private: both, summary } = await inventoryFull({ kvValues: UNRELATED, envValues: { [first]: nested(9), [third]: nested(9) } });
  const reasons = [first, third].map(name => `env:${name}:identity_projection_truncated`);
  assert.deepEqual([both.groups[16], both.group_reasons[16], envReasonsOf(both), both.kv.failed_reads, summary.kv.failed_reads, summary.status],
    ["incomplete", reasons, reasons, [], 0, "incomplete"], "C10-env-two-bindings: two distinct private reasons");
  summaryAggregatesOnly(summary, "C10-env-two-bindings");
  // Collected absent, invalid and empty bindings keep their dispositions.
  for (const [label, envValues, states] of [["absent", {}, ["absent", "absent", "absent"]],
    ["invalid-and-empty", { [first]: "{", [third]: " " }, ["invalid_json", "absent", "empty"]]]) {
    const { responses, private: result, summary: plain } = await inventoryFull({ kvValues: UNRELATED, envValues });
    assert.deepEqual(ENV_BINDING_NAMES.map(name => exportedEnv(responses, name).state), states, `C10-env-${label}: binding states`);
    assert.deepEqual([result.groups[16], envReasonsOf(result), result.status, plain.status], ["complete", [], ENUMERATED, ENUMERATED], `C10-env-${label}: existing disposition`);
  }
  // No env response keeps env_section_not_collected.
  const { private: missing, summary: missingSummary } = await inventoryFull({ kvValues: UNRELATED, collectEnv: false });
  assert.deepEqual([missing.groups[16], envReasonsOf(missing), missing.status, missingSummary.groups[16], missingSummary.env],
    ["env_section_not_collected", [], "incomplete", "env_section_not_collected", null], "C10-env-not-collected");
}

// O1-O3: a configured option is named by its key, or by its ID when the key
// is falsy, as the ordinary reader selects it; normalizeAccountOption is the
// read-only oracle.
const { normalizeAccountOption, normalizeAccountOptionsPayload } = await import(new URL("account_options_schema.js", CONSOLE));
{
  const OPTION_SOURCES = {
    kv: { source: "kv:account_options", run: value => inventoryFull({ kvValues: { account_options: value } }) },
    env: { source: "env:STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON", run: value => inventoryFull({ envValues: { STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: value } }) },
  };
  const configuredOf = result => result.mapping.entries.flatMap(entry => entry.episodes.filter(episode => episode.state === "configured_option")
    .map(episode => ({ platform: entry.platform, legacy_key: entry.legacy_key, locator: episode.locator, identity: episode.identity })));
  for (const [sourceName, { source, run }] of Object.entries(OPTION_SOURCES)) {
    // O1: ID-only and every falsy key select the ID.
    for (const [label, keyField] of [["missing", {}], ["empty", { key: "" }], ["null", { key: null }], ["false", { key: false }], ["zero", { key: 0 }]]) {
      const raw = { ...keyField, id: "acct-o1", account_selector: "sel-o1" };
      const name = `O1-${sourceName}-key-${label}`;
      const oracle = normalizeAccountOption("ibkr", raw).key;
      assert.deepEqual(Object.keys(normalizeAccountOptionsPayload({ ibkr: [raw] })), ["ibkr"], `${name}: the ordinary reader accepts the payload`);
      const { private: result, summary } = await run(JSON.stringify({ ibkr: [raw] }));
      assert.deepEqual(configuredOf(result), [{ platform: "ibkr", legacy_key: oracle, locator: { source, path: "ibkr[0].id" }, identity: { selected_field: "id" } }],
        `${name}: one configured episode matching normalizeAccountOption`);
      assert.deepEqual([result.mapping.entries.length, result.mapping.unattributed, result.status, summary.status, summary.mapping.entries, summary.mapping.unattributed_rows],
        [1, [], ENUMERATED, ENUMERATED, 1, 0], `${name}: complete, one entry, zero unattributed`);
      summaryAggregatesOnly(summary, name, ["acct-o1", "sel-o1"]);
    }
    // O2: precedence, normalization and isolation.
    const single = async (name, raw, expected, { complete = true } = {}) => {
      const { responses, private: result, summary } = await run(JSON.stringify(raw));
      assert.deepEqual(configuredOf(result), expected, `${name}: configured episodes`);
      if (complete) assert.deepEqual([result.status, summary.status], [ENUMERATED, ENUMERATED], `${name}: complete`);
      summaryAggregatesOnly(summary, name, ["acct-o2", "gen-o2"]);
      return { responses, result };
    };
    const oracleKey = raw => normalizeAccountOption("ibkr", raw).key;
    const keyOnly = { key: "acct-o2k" };
    await single(`O2-${sourceName}-key-only`, { ibkr: [keyOnly] }, [{ platform: "ibkr", legacy_key: oracleKey(keyOnly), locator: { source, path: "ibkr[0].key" }, identity: { selected_field: "key" } }]);
    const distinct = { key: "acct-o2k", id: "acct-o2i" };
    const { result: distinctResult } = await single(`O2-${sourceName}-key-and-id`, { ibkr: [distinct] },
      [{ platform: "ibkr", legacy_key: oracleKey(distinct), locator: { source, path: "ibkr[0].key" }, identity: { selected_field: "key" } }]);
    assert.ok(!distinctResult.mapping.entries.some(entry => entry.legacy_key === "acct-o2i") && !distinctResult.mapping.unattributed.length, `O2-${sourceName}-key-and-id: the ID is no second identity`);
    const same = { key: "acct-o2", id: "acct-o2" };
    const { result: sameResult } = await single(`O2-${sourceName}-identical`, { ibkr: [same] },
      [{ platform: "ibkr", legacy_key: oracleKey(same), locator: { source, path: "ibkr[0].key" }, identity: { selected_field: "key" } }]);
    assert.equal(sameResult.mapping.entries.length, 1, `O2-${sourceName}-identical: one entry`);
    for (const [label, raw, field] of [["key", { key: "  acct-o2w  " }, "key"], ["id", { key: "", id: " acct-o2v\t" }, "id"]]) {
      const name = `O2-${sourceName}-whitespace-${label}`;
      const { responses } = await single(name, { ibkr: [raw] },
        [{ platform: "ibkr", legacy_key: oracleKey(raw), locator: { source, path: `ibkr[0].${field}` }, identity: { selected_field: field, raw_value: raw[field] } }]);
      const projected = sourceName === "kv" ? exportedKv(responses, "account_options") : exportedEnv(responses, "STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON");
      assert.equal(projected.identity.fields[`ibkr[0].${field}`], raw[field], `${name}: raw evidence retained in the projection`);
    }
    // A truthy key the ordinary reader rejects, or one the projection cannot
    // carry (a string beyond the long-string bound), never falls back to the ID.
    const invalidKeys = [["invalid-chars", "bad key", [{ legacy_key: "bad key", identity: { selected_field: "key", option_key_valid: false } }]],
      ["blank", "   ", [{ legacy_key: "   ", identity: { selected_field: "key", option_key_valid: false } }]],
      ["number", 7, []], ["array", ["acct-o2a"], []], ["object", { platform: "ibkr" }, []], ["long", "k".repeat(600), []]];
    for (const [label, keyValue, expected] of invalidKeys) {
      const raw = { key: keyValue, id: "acct-o2x" };
      if (label === "long") assert.equal(oracleKey(raw), keyValue, `O2-${sourceName}-invalid-key-${label}: the ordinary reader selects the key, not the ID`);
      else assert.throws(() => normalizeAccountOption("ibkr", raw), undefined, `O2-${sourceName}-invalid-key-${label}: the ordinary reader rejects it`);
      const { result } = await single(`O2-${sourceName}-invalid-key-${label}`, { ibkr: [raw] },
        expected.map(item => ({ platform: "ibkr", locator: { source, path: "ibkr[0].key" }, ...item })), { complete: false });
      assert.ok(!result.mapping.entries.some(entry => entry.legacy_key === "acct-o2x") && !result.mapping.unattributed.some(row => row.legacy_key === "acct-o2x"),
        `O2-${sourceName}-invalid-key-${label}: no ID fallback`);
    }
    // Generic IDs outside the option slots, and in another reviewed family or binding.
    const generic = { ibkr: [{ key: "acct-o2k", links: [{ id: "gen-o2a" }], meta: { id: "gen-o2b" } }] };
    assert.equal(normalizeAccountOptionsPayload(generic).ibkr[0].key, "acct-o2k");
    const other = JSON.stringify({ ibkr: [{ id: "gen-o2c" }] });
    const { private: isolated, summary } = sourceName === "kv"
      ? await inventoryFull({ kvValues: { account_options: JSON.stringify(generic), risk_profile_bindings: other, account_facts_bindings: other } })
      : await inventoryFull({ envValues: { STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify(generic), BINANCE_ACCOUNT_FACTS_BINDING_JSON: other } });
    assert.deepEqual(configuredOf(isolated).map(item => [item.legacy_key, item.locator.path]), [["acct-o2k", "ibkr[0].key"]], `O2-${sourceName}-generic-ids: only the option key`);
    assert.deepEqual([isolated.mapping.entries.map(entry => entry.legacy_key), isolated.mapping.unattributed, isolated.status],
      [["acct-o2k"], [], ENUMERATED], `O2-${sourceName}-generic-ids: no new account identity`);
    summaryAggregatesOnly(summary, `O2-${sourceName}-generic-ids`, ["gen-o2"]);
    // O3: ID fallback through a projection cut at its field bound.
    const value = { ibkr: range(2001).map(index => ({ id: `opt-${pad(index)}`, account_selector: `sel-${index}` })) };
    const label = `O3-${sourceName}-fallback-truncated`;
    assert.deepEqual([value.ibkr.length, value.ibkr.reduce((total, option) => total + Object.keys(option).length, 0)], [2001, 4002], `${label}: fixture input counts`);
    const oracle = Object.values(normalizeAccountOptionsPayload(value)).flat().map(option => option.key);
    const { responses, private: result, summary: cut } = await run(JSON.stringify(value));
    const projected = sourceName === "kv" ? exportedKv(responses, "account_options") : exportedEnv(responses, "STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON");
    assert.deepEqual([Object.keys(projected.identity.fields).length, projected.identity.truncated], [4000, true], `${label}: projected fields`);
    const configured = configuredOf(result);
    assert.deepEqual(configured.map(item => [item.platform, item.legacy_key, item.locator.path]), oracle.slice(0, 2000).map((key, index) => ["ibkr", key, `ibkr[${index}].id`]),
      `${label}: exactly 2000 surviving configured mappings with ID locators`);
    assert.deepEqual(configured.filter(item => item.identity.key_unobserved_at_truncation).map(item => item.locator.path), ["ibkr[1999].id"], `${label}: the boundary slot is qualified`);
    assert.deepEqual([result.groups[16], result.status, cut.status, cut.groups[16]], ["incomplete", "incomplete", "incomplete", "incomplete"], `${label}: group 16 and overall incomplete`);
    if (sourceName === "kv") {
      assert.deepEqual([result.kv.failed_reads.map(read => [read.name, read.causes]), envReasonsOf(result), cut.kv.failed_reads],
        [[["account_options", ["identity_projection_truncated"]]], [], 1], `${label}: exactly one failed KV key`);
    } else {
      const reason = "env:STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON:identity_projection_truncated";
      assert.deepEqual([result.kv.failed_reads, envReasonsOf(result), result.group_reasons[16], cut.kv.failed_reads], [[], [reason], [reason], 0], `${label}: the binding reason, no KV failure`);
    }
    summaryAggregatesOnly(cut, label, ["opt-", "sel-"]);
  }
}

// N3: every ancestor step shortens the path; an unparseable ancestry stops
// the walk and qualifies the reference. The isolated runs come first, so a
// walk that does not terminate fails by the child bound, not by a hang here.
{
  const { spawn } = await import("node:child_process");
  const { writeFile } = await import("node:fs/promises");
  const CHILD = `import { readFileSync } from "node:fs";
const { assemble } = await import(process.argv[1]);
const exported = JSON.parse(readFileSync(process.argv[2], "utf8"));
process.stdout.write("READY\\n");
const started = performance.now();
const { private: result } = assemble(exported);
process.stdout.write(JSON.stringify({ elapsed_ms: performance.now() - started, mapping: result.mapping }) + "\\n");`;
  const assembler = new URL("inspect_account_identity_inventory.mjs", CONSOLE).href;
  // 1000 ms from the ready marker to the result, 15000 ms for the whole
  // child. The parent kills and fails on a timeout, crash or missing result.
  const isolated = file => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD, assembler, file], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "", ready = false, done = false, settled = false, bound = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(whole); clearTimeout(bound);
      if (child.exitCode === null) child.kill("SIGKILL");
      if (error) reject(error); else resolve(value);
    };
    const whole = setTimeout(() => finish(new Error("isolated assemble: child exceeded 15000 ms")), 15_000);
    child.stdout.on("data", chunk => {
      out += chunk;
      if (!ready && out.startsWith("READY\n")) { ready = true; bound = setTimeout(() => finish(new Error("isolated assemble: no result 1000 ms after the ready marker")), 1_000); }
      if (ready && !done && out.split("\n").length > 2) { done = true; clearTimeout(bound); }
    });
    child.stderr.on("data", chunk => { err += chunk; });
    child.on("error", error => finish(error));
    child.on("exit", (code, signal) => {
      const [marker, line] = out.split("\n");
      if (code !== 0 || signal || marker !== "READY" || !done || !line) return finish(new Error(`isolated assemble failed: ${code} ${signal} ${err.slice(0, 500)}`));
      const result = JSON.parse(line);
      if (!(result.elapsed_ms < 1_000)) return finish(new Error(`isolated assemble took ${result.elapsed_ms} ms`));
      finish(null, result);
    });
  });
  const scratch = await mkdtemp(join(tmpdir(), "qrt-inventory-n3-"));
  const located = (mapping, legacyKey) => [...mapping.entries.filter(entry => entry.legacy_key === legacyKey).flatMap(entry => entry.episodes.map(episode => ({ platform: entry.platform, locator: episode.locator }))),
    ...mapping.unattributed.filter(row => row.legacy_key === legacyKey).map(row => ({ platform: null, locator: row.locator, candidate_platforms: row.candidate_platforms }))];
  const runs = [];
  const run = async (label, value, expected) => {
    const { exported } = await inventoryFull({ kvValues: { risk_profile_bindings: JSON.stringify(value) }, isolate: true });
    const file = join(scratch, `${runs.length}.json`);
    await writeFile(file, JSON.stringify(exported));
    const { mapping, elapsed_ms } = await isolated(file);
    await rm(file, { force: true });
    assert.deepEqual(located(mapping, "synthetic-account"), [expected], `${label}: exactly one located reference, none dropped`);
    runs.push({ label, elapsed_ms });
  };
  const locator = (path, qualified) => ({ source: "kv", name: "risk_profile_bindings", path, ...(qualified ? { path_qualification: "unparseable_identity_path" } : {}) });
  try {
    for (const parent of [".", "[", "]", "a[", "a]"]) {
      await run(`N3-punctuation-same-platform ${JSON.stringify(parent)}`, { [parent]: { platform: "ibkr", account_key: "synthetic-account" } },
        { platform: "ibkr", locator: locator(`${parent}.account_key`, true) });
      await run(`N3-punctuation-no-platform ${JSON.stringify(parent)}`, { [parent]: { account_key: "synthetic-account" } },
        { platform: null, locator: locator(`${parent}.account_key`, true), candidate_platforms: [] });
    }
    assert.equal(locator("..account_key").path, "..account_key");
    await run("N3-normal-object platform", { platform: "ibkr", nested: { deeper: { account_key: "synthetic-account" } } }, { platform: "ibkr", locator: locator("nested.deeper.account_key", false) });
    await run("N3-normal-array platform", { platform: "ibkr", items: [{ note: "x" }, { account_key: "synthetic-account" }] }, { platform: "ibkr", locator: locator("items[1].account_key", false) });
    await run("N3-normal-object no platform", { nested: { deeper: { account_key: "synthetic-account" } } }, { platform: null, locator: locator("nested.deeper.account_key", false), candidate_platforms: [] });
    await run("N3-normal-array no platform", { items: [{ note: "x" }, { account_key: "synthetic-account" }] }, { platform: null, locator: locator("items[1].account_key", false), candidate_platforms: [] });
  } finally { await rm(scratch, { recursive: true, force: true }); }
  assert.equal(runs.length, 14, "N3-progress-and-bound: fourteen isolated executions");
  if (process.env.QRT_INVENTORY_EVIDENCE) console.log(JSON.stringify({ n3_isolated: runs }));
}

const { ancestorPaths } = await import(new URL("inspect_account_identity_inventory.mjs", CONSOLE));
{
  const inspect = path => {
    const { paths, parseable } = ancestorPaths(path);
    [path, ...paths].slice(1).forEach((next, index) => assert.ok(next.length < [path, ...paths][index].length, `N3-progress-and-bound: ${JSON.stringify(path)} step ${index} shortens`));
    assert.ok(paths.length <= path.length, `N3-progress-and-bound: ${JSON.stringify(path)} takes at most its length in steps`);
    return { paths, parseable };
  };
  assert.deepEqual(inspect("a.b[0].c"), { paths: ["a.b[0]", "a.b", "a", ""], parseable: true });
  for (const parent of [".", "[", "]", "a[", "a]", "x.a].y"]) assert.equal(inspect(parent).parseable, false, `${parent}: unparseable`);
  assert.deepEqual(inspect("x.a].y").paths, ["x.a]"], "the walk stops before repeating the unparseable suffix");
  // Every path over a small alphabet, up to five characters.
  const alphabet = ["a", ".", "[", "]", "0"];
  let frontier = [""], inspected = 0;
  for (let length = 1; length <= 5; length++) {
    frontier = frontier.flatMap(prefix => alphabet.map(char => prefix + char));
    for (const path of frontier) { inspect(path); inspected++; }
  }
  assert.equal(inspected, 3905);
}
// N4: one normalized settings identity over every config-bearing episode.
const { accountSettingsIdentity } = await import(new URL("application/account_settings/helpers.js", CONSOLE));
{
  const BASE = { target_name: "target-n4", account_selector: "sel-n4", deployment_selector: "dep-n4", account_scope: "scope-n4", service_name: "svc-n4", broker_environment: "paper" };
  const instance = (key, config, platform = "ibkr") => ({ platform, key, kind: "existing", config: { key, ...config } });
  const historyRow = (revision, before, after) => ({ revision, entry: JSON.stringify({ revision, ts: day(revision), action: "update", login: ACTOR_CANARY, before, after }) });
  const scan = async ({ current = [], history = [] }) => inventoryFull({ sql: [
    ...(current.length ? [rows("instance_state", [{ id: 1, revision: 1, payload: JSON.stringify(current) }])] : []),
    ...(history.length ? [rows("instance_history", history)] : []),
  ] });
  const tuples = (result, legacyKey, platform = "ibkr") => result.mapping.entries.find(entry => entry.platform === platform && entry.legacy_key === legacyKey)
    .episodes.filter(episode => episode.identity?.config).map(episode => episode.identity.settings_identity);
  // I5: the summary counts the private conflicts and carries no tuple value.
  const boundary = (label, result, summary) => {
    assert.equal(summary.mapping.conflicts, result.mapping.conflicts.length, `N4-summary-and-boundary ${label}: summary conflicts`);
    const text = JSON.stringify(summary);
    for (const needle of ["n4-", "ibkr", "schwab", "paper", "live", "settings_identity"]) assert.ok(!text.includes(needle), `N4-summary-and-boundary ${label}: summary omits ${needle}`);
  };
  const changes = { broker_environment: "live", deployment_selector: "dep-n4-changed", account_scope: "scope-n4-changed", service_name: "svc-n4-changed",
    account_selector: "sel-n4-changed", target_name: "target-n4-changed" };
  for (const [field, changed] of Object.entries(changes)) {
    const before = instance("acct-n4", BASE), after = instance("acct-n4", { ...BASE, [field]: changed });
    const oracle = [accountSettingsIdentity(before), accountSettingsIdentity(after)];
    assert.notDeepEqual(oracle[0], oracle[1], `${field}: oracle tuples differ`);
    // I1: one history row, its two sides.
    {
      const { private: result, summary } = await scan({ history: [historyRow(1, before, after)] });
      const entry = result.mapping.entries.find(item => item.legacy_key === "acct-n4");
      assert.deepEqual(entry.episodes.map(episode => [episode.state, episode.locator.table, episode.locator.side]), [["historical", "instance_history", "before"], ["historical", "instance_history", "after"]],
        `N4-history-each-field ${field}: two side-located episodes`);
      assert.deepEqual(tuples(result, "acct-n4"), oracle, `N4-history-each-field ${field}: oracle tuples`);
      assert.deepEqual(result.mapping.conflicts, [{ platform: "ibkr", legacy_key: "acct-n4", kind: "identity_episodes_differ", episodes: 2 }], `N4-history-each-field ${field}: one conflict`);
      assert.equal(summary.mapping.conflicts, 1);
      boundary(`history ${field}`, result, summary);
    }
    // I2: the current instance against a history episode.
    {
      const { private: result, summary } = await scan({ current: [before], history: [historyRow(1, null, after)] });
      const entry = result.mapping.entries.find(item => item.legacy_key === "acct-n4");
      assert.deepEqual(entry.episodes.map(episode => [episode.state, episode.locator.table, episode.locator.side ?? null]), [["current", "instance_state", null], ["historical", "instance_history", "after"]],
        `N4-current-history-each-field ${field}: current and historical episodes`);
      assert.deepEqual(entry.states, ["current", "historical"]);
      assert.deepEqual(tuples(result, "acct-n4"), oracle, `N4-current-history-each-field ${field}: oracle tuples`);
      assert.deepEqual(result.mapping.conflicts, [{ platform: "ibkr", legacy_key: "acct-n4", kind: "identity_episodes_differ", episodes: 2 }], `N4-current-history-each-field ${field}: one conflict`);
      boundary(`current ${field}`, result, summary);
    }
  }
  // I3: unchanged and normalization-equivalent tuples are one identity.
  {
    const same = instance("acct-n4", BASE);
    const { private: unchanged, summary } = await scan({ current: [same], history: [historyRow(1, same, same)] });
    assert.deepEqual(unchanged.mapping.conflicts, [], "N4-equivalence: unchanged tuples");
    boundary("unchanged", unchanged, summary);
    const loose = instance("acct-n4-null", { target_name: null, account_selector: 7, deployment_selector: ["dep"], account_scope: { scope: 1 }, broker_environment: "staging" });
    const missing = instance("acct-n4-null", {});
    const normalized = { platform: "ibkr", key: "acct-n4-null", target_name: "", broker_environment: null, account_selector: "", deployment_selector: "", account_scope: "", service_name: "" };
    assert.deepEqual([accountSettingsIdentity(loose), accountSettingsIdentity(missing)], [normalized, normalized], "N4-equivalence: oracle normalization");
    const { private: result, summary: nullSummary } = await scan({ history: [historyRow(1, loose, missing)] });
    assert.deepEqual(tuples(result, "acct-n4-null"), [normalized, normalized], "N4-equivalence: the pinned normalized tuple");
    assert.deepEqual(result.mapping.conflicts, [], "N4-equivalence: null-equivalent tuples");
    boundary("normalized null", result, nullSummary);
  }
  // I4: the top-level key and platform form separate entries; config.key
  // never replaces the top-level key.
  {
    const { private: rekeyed, summary } = await scan({ history: [historyRow(1, instance("acct-n4-old", BASE), instance("acct-n4-new", BASE))] });
    assert.deepEqual(rekeyed.mapping.entries.map(entry => entry.legacy_key).sort(), ["acct-n4-new", "acct-n4-old"], "N4-key-and-platform: two entries for a key change");
    assert.deepEqual(rekeyed.mapping.conflicts, [], "N4-key-and-platform: no episode conflict for a key change");
    boundary("key change", rekeyed, summary);
    const { private: moved, summary: movedSummary } = await scan({ history: [historyRow(1, instance("acct-n4", BASE), instance("acct-n4", BASE, "schwab"))] });
    assert.deepEqual(moved.mapping.entries.map(entry => entry.platform).sort(), ["ibkr", "schwab"], "N4-key-and-platform: two entries for a platform change");
    assert.deepEqual([moved.mapping.collisions, moved.mapping.conflicts], [[{ legacy_key: "acct-n4", platforms: ["ibkr", "schwab"] }], []], "N4-key-and-platform: one collision, no episode conflict");
    boundary("platform change", moved, movedSummary);
    const current = { ...instance("acct-n4", BASE), config: { ...BASE, key: "acct-n4-config" } };
    const { private: mismatch, summary: mismatchSummary } = await scan({ current: [current], history: [historyRow(1, null, instance("acct-n4", BASE))] });
    assert.deepEqual(tuples(mismatch, "acct-n4").map(tuple => tuple.key), ["acct-n4", "acct-n4"], "N4-key-and-platform: the top-level key, never config.key");
    assert.deepEqual(mismatch.mapping.conflicts, [{ platform: "ibkr", legacy_key: "acct-n4", kind: "top_config_key_mismatch" }], "N4-key-and-platform: only top_config_key_mismatch");
    assert.ok(!mismatch.mapping.entries.some(entry => entry.legacy_key === "acct-n4-config"));
    boundary("config key mismatch", mismatch, mismatchSummary);
  }
  // I5: generic qualifiers stay outside the settings identity.
  {
    const { private: result, summary } = await inventoryFull({ kvValues: { risk_profile_bindings: JSON.stringify({ rows: [
      { platform: "ibkr", account_key: "acct-n4q", target_name: "first" }, { platform: "ibkr", account_key: "acct-n4q", target_name: "second" }] }) } });
    const entry = result.mapping.entries.find(item => item.legacy_key === "acct-n4q");
    assert.deepEqual(entry.episodes.map(episode => [episode.locator.path, episode.identity.qualifiers.target_name]), [["rows[0].account_key", "first"], ["rows[1].account_key", "second"]],
      "N4-summary-and-boundary: qualifier-only episodes stay located");
    assert.deepEqual(result.mapping.conflicts, [], "N4-summary-and-boundary: no conflict kind mandated for generic qualifiers");
    boundary("qualifiers", result, summary);
  }
}

// ---------------------------------------------------- A3: populated, beyond legacy caps, full assembly
const plan = populatedPlan();
const counts = seededCounts(plan);
assert.ok(counts.instance_history > 50 && counts.account_setting_profile_application > 100 && counts.human_decision_record > 100
  && counts.research_promotion_applications > 100 && counts.human_decision_source_material > 100 && counts.account_daily_native_return > 1000
  && counts.account_facts_daily > 366 && Object.keys(plan.kv).length > 1000 && Object.keys(KV_VALUES).length > 1000, "seed exceeds every legacy cap");
{
  const h = await harness({ runtime: plan, directory: { ...directoryPlan(), initialize: true }, extraEnv: {
    ACCOUNT_IDENTITY_INVENTORY_KV_ENABLED: "true", ACCOUNT_IDENTITY_INVENTORY_ENV_ENABLED: "true", ...ENV_SECTION } });
  const responses = [];
  const runtime = await collect(h.get, "runtime", { responses });
  await collect(h.get, "directory", { responses });
  assert.equal(runtime.schema.schema_state, "current", "ordinary initializer schema equals the reader allowlist");
  for (const [name, table] of Object.entries(runtime.schema.tables)) {
    if (table.present) assert.deepEqual([table.missing_columns, table.unexpected_columns, table.primary_key_matches], [[], [], true], `${name}: allowlist matches schema`);
  }
  assert.deepEqual(runtime.schema.other_schema_objects.filter(item => item.classification === "unknown_table").map(item => [item.name, item.row_count]), [["legacy_mystery", 1]]);
  for (const [table, count] of Object.entries(counts)) assert.equal(runtime.schema.tables[table].row_count, count, `${table}: counted`);
  const observation = responses.filter(item => item.request.table === "account_facts_observation");
  assert.ok(observation.some(item => item.body.byte_limited), "response byte budget pages large rows instead of truncating");
  assert.equal(observation.flatMap(item => item.body.rows).filter(row => row.projection_error === "row_projection_too_large").length, 1, "oversized row recorded as failed, not dropped");
  const statePages = responses.filter(item => item.request.table === "instance_state");
  assert.ok(statePages.length >= 2 && statePages.some(item => item.body.nested_continuation), "singleton array paged by nested entries");
  const kvLast = await collectKv(h.get, responses);
  await collectKv(h.get, responses);
  assert.equal(kvLast.body.terminal, true);
  const envPage = await h.get(`${ROUTE}?section=env`);
  responses.push({ request: { section: "env" }, status: envPage.status, body: envPage.body });
  assert.deepEqual(envPage.body.bindings.map(item => [item.name, item.state]), [["STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON", "present"],
    ["BINANCE_ACCOUNT_FACTS_BINDING_JSON", "invalid_json"], ["BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON", "absent"]]);
  assert.equal(envPage.body.deployment_version.tag, "synthetic");
  // auth_config is read by session verification only; the KV section names it without a value.
  assert.ok(!h.kv.gets.includes("legacy_mystery_key"), "unknown KV value is never fetched");
  const listed = responses.filter(item => item.request.section === "kv").flatMap(item => item.body.keys);
  for (const name of ["auth_config", "legacy_mystery_key"]) {
    assert.ok(listed.filter(item => item.name === name).every(item => !("identity" in item) && !("value_sha256" in item)), `${name}: named, not exported`);
  }

  const { private: result, summary } = assemble({ format: EXPORT_FORMAT, responses });
  assert.equal(result.status, "retained_state_enumerated_external_evidence_required", JSON.stringify(result.reasons));
  for (const object of result.objects) assert.equal(object.complete, true, `${object.object}: ${object.reasons}`);
  const tables = result.objects[0].tables;
  for (const [table, count] of Object.entries(counts)) {
    if (INVENTORY_TABLES[table].countOnly) assert.ok(tables[table].disposition.startsWith("count_only:"));
    else assert.equal(tables[table].rows.length, count, `${table}: every stored row exported`);
  }
  assert.equal(tables.instance_state.rows[0].columns.payload.entries.length, 131, "all instances, including drafts, exported");
  assert.equal(result.objects[0].do_kv.entries.length, Object.keys(plan.kv).length);
  assert.equal(result.objects[0].do_kv.unknown_keys, 1);
  assert.equal(result.objects[1].do_kv.entries.length, 2);
  assert.equal(result.kv.repeated_pass_equal, true);
  assert.equal(result.kv.keys.length, Object.keys(KV_VALUES).length);
  const kvStates = summary.kv.states;
  assert.equal(kvStates.invalid_json, 1);
  assert.equal(kvStates.scope_excluded, 1);
  assert.equal(kvStates.unknown_family, 1);
  for (let group = 1; group <= 22; group++) assert.equal(result.groups[group], "complete", `group ${group}`);
  assert.equal(result.groups[23], "external_evidence_required");
  const entry = (platform, key) => result.mapping.entries.find(item => item.platform === platform && item.legacy_key === key);
  assert.ok(entry("ibkr", "orphan-key").states.includes("orphan"));
  assert.ok(entry("firstrade", "orphan-key").states.includes("orphan"), "cross-platform orphan kept separate");
  assert.ok(entry("ibkr", "draft-1").states.includes("draft"));
  assert.ok(entry("ibkr", "alias").states.includes("orphan") && result.mapping.conflicts.some(item => item.legacy_key === "alias" && item.kind === "identity_episodes_differ"), "alias reuse kept as episodes");
  assert.ok(result.mapping.conflicts.some(item => item.legacy_key === "mismatch" && item.kind === "top_config_key_mismatch"));
  assert.ok(result.mapping.collisions.some(item => item.legacy_key === "shared" && item.platforms.sort().join() === "ibkr,schwab"));
  assert.ok(result.mapping.unattributed.some(item => item.legacy_key === "unattributed-key"), "platform-less rows are not guessed");
  assert.ok(entry("binance", "bn-main"), "Binance composite resolved to its legacy key");
  const pending = summary.pending;
  assert.equal(pending.account_setting_profile_application, 150, "approved, claimed and labels the profile writer never produces stay pending");
  assert.equal(pending.hk_stop_request, 6, "only the stop family's own terminal phases are terminal; stopped and completed stay pending");
  assert.equal(pending.account_diagnosis_tasks, 5, "completed is not a diagnosis status and stays pending");
  assert.equal(pending.desk_idempotency, 1);
  assert.equal(pending.desk_readback_record, 403, "running, unknown, missing and new Desk states stay pending; done and partial are terminal");

  // B4: every operation family, with unknown kept as unknown.
  const ledger = family => result.pending.filter(item => item.family === family);
  const statuses = family => ledger(family).map(item => `${item.status}/${item.classification}`).sort();
  assert.deepEqual(statuses("ux1_research_slot"), ["missing/unknown", "queued/nonterminal", "rehydrating/unknown", "running/nonterminal",
    "unknown/unknown", "unreadable:invalid_json/unknown"], "UX1 jobs: a slot without a job holds no operation; succeeded is terminal");
  assert.ok(ledger("ux1_research_slot").every(item => item.pk.length === 1 && "actor_key_sha256" in item.pk[0]), "UX1 ledger locates by digest");
  const desk = Object.fromEntries(ledger("desk_readback_record").filter(item => item.key.includes(":probe-")).map(item => [item.key.split(":probe-")[1], `${item.status}/${item.classification}`]));
  assert.deepEqual(desk, { unknown: "unknown/unknown", missing: "missing/unknown", new: "queued_v2/unknown" }, "Desk unknown/missing/new states preserved");
  assert.equal(ledger("desk_readback_record").filter(item => item.status === "running").length, 400);
  assert.deepEqual(statuses("research_promotion_ticket:"), ["awaiting_human/nonterminal", "open/unknown"], "KV tickets: human_accepted is terminal");
  assert.deepEqual(statuses("reconciliation_recovery_confirmation:"), ["missing/unknown"], "KV material without a status is unknown");
  assert.deepEqual(statuses("owner_decision_current:"), ["unreadable:invalid_json/unknown"], "corrupt KV decision stays in the ledger");
  assert.deepEqual(statuses("credential_rotation_operations"), ["pending/unknown"], "unrecognized rotation state is unknown, not terminal");
  assert.deepEqual(statuses("desk_readback_admission"), ["active/nonterminal"]);
  assert.equal(ledger("human_decision_material").length, 50, "material without a matching decision record stays undecided");
  assert.equal(summary.pending.ux1_research_slot, 6);
  assert.equal(summary.pending_classification.unknown, result.pending.filter(item => item.classification === "unknown").length);

  // B2: identities retained only in operation payloads.
  const stop = entry("longbridge", "lb-1");
  assert.ok(stop && stop.states.includes("orphan"), "stop-request-only account is mapped");
  assert.ok(stop.episodes.every(episode => episode.locator.table === "hk_stop_request" && episode.locator.column === "identity_json"));
  assert.equal(stop.episodes.length, 6, "every stop request kept as an episode");
  const payloadOnly = entry("schwab", "payload-only");
  assert.ok(payloadOnly, "promotion readback-only account is mapped");
  assert.deepEqual(payloadOnly.episodes.map(episode => [episode.locator.table, episode.locator.column, episode.locator.path, episode.identity.qualifiers.target_name]),
    [["research_promotion_applications", "readback_json", "account_key", "target-payload"]]);
  const loose = result.mapping.unattributed.filter(item => item.legacy_key === "payload-unattributed");
  assert.deepEqual(loose.map(item => [item.locator.table, item.locator.column, item.locator.path]), [["research_promotion_applications", "readback_json", "result.account_key"]],
    "platform-less payload reference is unattributed, not guessed");
  assert.ok(!result.mapping.entries.some(item => item.legacy_key === "payload-unattributed"));
  assert.ok(result.mapping.unattributed.some(item => item.legacy_key === "acct-001" && item.locator.table === "human_decision_record"), "decision target references kept");

  // B3: stored declaration values and stored-versus-current identity.
  const declarations = Object.fromEntries(tables.account_setting_declaration.rows.map(row => [row.pk[1], row.columns.declaration_json]));
  assert.deepEqual(declarations["acct-001"], { state: "valid", bytes: 47, environment: { present: true, value: "paper", valid: true },
    account_type: { present: true, value: "margin", valid: true }, unexpected_keys: [] });
  assert.deepEqual([declarations["acct-002"].environment, declarations["acct-002"].account_type],
    [{ present: true, value: null, valid: true }, { present: true, valid: false, value_type: "string" }], "null and invalid values distinguished");
  assert.ok(!JSON.stringify(declarations["acct-002"]).includes("futures"), "invalid value reported by type only");
  assert.deepEqual([declarations["acct-005"].environment, declarations["acct-005"].account_type], [{ present: false }, { present: false }]);
  assert.equal(declarations["acct-006"].state, "invalid_json");
  const declarationEpisode = legacyKey => entry("ibkr", legacyKey).episodes.find(episode => episode.locator.table === "account_setting_declaration");
  assert.deepEqual(declarationEpisode("acct-001").identity.declaration.environment, { present: true, value: "paper", valid: true }, "declaration carried into the mapping");
  assert.equal(declarationEpisode("acct-001").identity.stored_identity_matches_current, true);
  assert.equal(declarationEpisode("acct-002").identity.stored_identity_matches_current, false);
  const storedConflict = result.mapping.conflicts.find(item => item.legacy_key === "acct-002" && item.kind === "stored_identity_differs_from_current");
  assert.deepEqual(storedConflict.records.filter(record => record.locator.table === "account_setting_declaration").map(record => record.fields), [["account_selector"]]);
  assert.ok(!result.mapping.conflicts.some(item => item.legacy_key === "acct-001" && item.kind === "stored_identity_differs_from_current"
    && item.records.some(record => record.locator.table === "account_setting_declaration")), "matching stored identity is not a conflict");
  assert.deepEqual(result.mapping.conflicts.filter(item => item.kind === "declared_environment_differs_from_current").map(item => [item.legacy_key, item.records[0].declared, item.records[0].current_broker_environment]),
    [["acct-003", "paper", "live"]]);
  const summaryText = JSON.stringify(summary);
  for (const needle of ["acct-", "orphan-key", "sel-", "target-", "shared"]) assert.ok(!summaryText.includes(needle), `sanitized summary omits ${needle}`);
  noLeak(h.outputs, "populated scan");
  assert.deepEqual(violations, [], "no trap fired during the populated scan");
  assert.ok(Object.values(h.logs).flat().every(statement => /^SELECT /.test(statement)));
  await h.unchanged();

  // Interrupted collection: a missing final page can never assemble as complete.
  const cut = responses.filter(item => !(item.request.table === "account_facts_daily" && item.body.terminal));
  const partial = assemble({ format: EXPORT_FORMAT, responses: cut }).private;
  assert.equal(partial.status, "incomplete");
  assert.ok(partial.reasons.includes("runtime:account_facts_daily:terminal_missing"));
  const duplicated = assemble({ format: EXPORT_FORMAT, responses: responses.filter(item => item.request.section !== "finalize" || item.request.object !== "directory") }).private;
  assert.equal(duplicated.objects[1].complete, false, "no finalize receipt, no completeness");

  // B1: KV completeness needs two equal complete passes and successful reads
  // of every reviewed value. Each probe changes only KV coverage or observations.
  const kvScans = [...new Set(responses.filter(item => item.request.section === "kv").map(item => item.body.scan_id))];
  assert.equal(kvScans.length, 2);
  const kvGroups = result => Object.fromEntries([16, 17, 18, 19, 20, 21, 22].map(group => [group, result.groups[group]]));
  const editKv = (scanIds, edit) => responses.map(item => item.request.section === "kv" && scanIds.includes(item.body.scan_id)
    ? { ...item, body: { ...item.body, keys: item.body.keys.map(key => edit(structuredClone(key))) } } : item);
  const single = assemble({ format: EXPORT_FORMAT, responses: responses.filter(item => item.request.section !== "kv" || item.body.scan_id !== kvScans[0]) });
  assert.equal(single.private.status, "incomplete", "one KV pass is not complete");
  assert.ok(Object.values(kvGroups(single.private)).every(state => state === "incomplete"));
  assert.ok(single.private.reasons.includes("kv:repeat_pass_missing") && single.private.group_reasons[17].includes("kv:repeat_pass_missing"));
  assert.equal(single.summary.kv.stable, false);
  const differ = assemble({ format: EXPORT_FORMAT, responses: editKv([kvScans[1]], key => (key.name === "audit_log" ? { ...key, value_sha256: "0".repeat(64) } : key)) }).private;
  assert.deepEqual([differ.status, differ.kv.repeated_pass_equal, differ.reasons.includes("kv:passes_differ")], ["incomplete", false, true], "differing passes are not complete");
  assert.ok(Object.values(kvGroups(differ)).every(state => state === "incomplete"));
  for (const state of ["missing_after_list", "read_failed", "value_too_large", "non_text"]) {
    const unread = assemble({ format: EXPORT_FORMAT, responses: editKv(kvScans, key => (key.name === "account_options"
      ? { name: key.name, family: key.family, expiration: null, metadata_present: false, state } : key)) }).private;
    assert.equal(unread.kv.repeated_pass_equal, true, `${state}: passes still equal`);
    assert.equal(unread.status, "incomplete", `${state}: unread account_options is not a successful identity read`);
    assert.equal(unread.groups[16], "incomplete");
    assert.deepEqual(unread.group_reasons[16], [`kv:account_options:${state}`]);
    assert.ok([17, 18, 19, 20, 21, 22].every(group => unread.groups[group] === "complete"), `${state}: only the affected group`);
    assert.ok(unread.reasons.includes(`kv:account_options:${state}`));
  }
  const ticketUnread = assemble({ format: EXPORT_FORMAT, responses: editKv(kvScans, key => (key.name === "research_promotion_ticket:t-2"
    ? { name: key.name, family: key.family, state: "read_failed" } : key)) }).private;
  assert.deepEqual([ticketUnread.status, ticketUnread.groups[21], ticketUnread.groups[16]], ["incomplete", "incomplete", "complete"]);
  assert.equal(result.kv.keys.find(key => key.name === "owner_decision_current:bad").state, "invalid_json");
  assert.equal(result.groups[21], "complete", "a corrupt record read successfully remains a qualified observation");
  await h.close();
}

// ---------------------------------------------------- A4: access, methods, selectors, errors
{
  const h = await harness({ runtime: { sql: [], kv: {}, alarm: null, initialize: false }, directory: { sql: [], kv: {}, alarm: null, initialize: false } });
  const denied = [
    [{ cookie: "" }, 401, "login_required"], [{ cookie: expiredCookie }, 401, "login_required"],
    [{ cookie: `${adminCookie}x` }, 401, "login_required"], [{ cookie: readerCookie }, 403, "admin_required"],
    [{ headers: { Origin: "https://untrusted.example" } }, 403, "cross_origin_rejected"], [{ headers: { "Sec-Fetch-Site": "cross-site" } }, 403, "cross_origin_rejected"],
  ];
  for (const [options, status, error] of denied) {
    const result = await h.get(`${ROUTE}?section=schema&object=runtime`, options);
    assert.deepEqual([result.status, result.body.error], [status, error]);
    assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  }
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) assert.equal((await h.get(`${ROUTE}?section=manifest`, { method })).status, 405);
  const invalid = [
    ["section=sql_raw", "unsupported_section"], ["section=schema&object=other-object", "unsupported_object"],
    ["section=sql&object=runtime&table=sqlite_schema&scan=x", "unsupported_table"], ["section=sql&object=runtime&table=instance_state%3BDROP&scan=x", "unsupported_table"],
    ["section=schema&object=runtime&sql=SELECT%201", "unsupported_parameter"], ["section=env&name=SESSION_SECRET", "unsupported_parameter"],
    ["section=manifest&section=env", "duplicate_parameter"], ["section=kv&page_size=1000", "invalid_page_size"],
    ["section=sql&object=runtime&table=instance_state", "scan_or_cursor_required"], ["section=sql&object=runtime&table=instance_state&scan=forged.token", "invalid_cursor"],
    ["section=kv", "section_disabled"], ["section=env", "section_disabled"],
  ];
  for (const [query, error] of invalid) {
    const result = await h.get(`${ROUTE}?${query}`);
    assert.equal(result.body.error, error, query);
    assert.ok(result.status >= 400);
  }
  assert.deepEqual(h.doCalls, [], "denied and invalid requests never reach a Durable Object");
  const manifest = await h.get(`${ROUTE}?section=manifest`);
  assert.deepEqual([manifest.status, manifest.body.execution_authority_granted, manifest.body.optional_sections], [200, false, { kv: false, env: false }]);

  // Cursor tampering, cross-scope replay and identical-cursor retry.
  const plan2 = { sql: [rows("instance_history", range(5).map(index => ({ revision: index + 1, entry: "{}" })))], kv: {}, alarm: null };
  const h2 = await harness({ runtime: plan2, directory: { sql: [], kv: {}, alarm: null, initialize: false } });
  const schemaR = (await h2.get(`${ROUTE}?section=schema&object=runtime`)).body;
  const schemaD = (await h2.get(`${ROUTE}?section=schema&object=directory`)).body;
  const first = await h2.get(`${ROUTE}?${new URLSearchParams({ section: "sql", object: "runtime", table: "instance_history", page_size: "2", scan: schemaR.scan })}`);
  const cursor = first.body.cursor;
  const [iv, sealed] = cursor.split(".");
  assert.ok(!/instance_history|runtime|scan_id/.test(Buffer.from(sealed, "base64url").toString("latin1")), "cursor is opaque");
  const bytes = Buffer.from(sealed, "base64url");
  bytes[3] ^= 1;
  const page = params => h2.get(`${ROUTE}?${new URLSearchParams({ section: "sql", object: "runtime", table: "instance_history", page_size: "2", ...params })}`);
  assert.equal((await page({ cursor: `${iv}.${bytes.toString("base64url")}` })).body.error, "invalid_cursor", "edited cursor rejected");
  assert.equal((await page({ cursor: `${schemaD.scan.split(".")[0]}.${sealed}` })).body.error, "invalid_cursor", "swapped nonce rejected");
  const forgedPlain = `${iv}.${Buffer.from(JSON.stringify({ v: 1, kind: "page", after: { last: [0] } })).toString("base64url")}`;
  assert.equal((await page({ cursor: forgedPlain })).body.error, "invalid_cursor", "unsealed cursor rejected");
  assert.equal((await h2.get(`${ROUTE}?${new URLSearchParams({ section: "sql", object: "runtime", table: "instance_state", page_size: "2", cursor })}`)).body.error, "cursor_scope_mismatch");
  assert.equal((await h2.get(`${ROUTE}?${new URLSearchParams({ section: "sql", object: "directory", table: "instance_history", page_size: "2", cursor })}`)).body.error, "cursor_scope_mismatch");
  assert.equal((await h2.get(`${ROUTE}?${new URLSearchParams({ section: "do_kv", object: "runtime", cursor })}`)).body.error, "cursor_scope_mismatch");
  assert.equal((await page({ scan: schemaD.scan })).body.error, "cursor_scope_mismatch", "scan token bound to its object");
  assert.equal((await page({ scan: cursor })).body.error, "invalid_cursor", "page cursor is not a scan token");
  const retryA = await page({ cursor }), retryB = await page({ cursor });
  const stripped = value => ({ ...value, observed_at: null, cursor: null });
  assert.deepEqual(stripped(retryA.body), stripped(retryB.body), "identical cursor retry is idempotent");
  assert.deepEqual(retryA.body.rows.map(row => row.pk), [[3], [4]]);
  noLeak([...h.outputs, ...h2.outputs], "access checks");
  await h2.unchanged();
  await h2.close();

  // Object failure/timeout: fixed error, no record or provider text.
  const failing = await harness({ runtime: { sql: [], kv: {}, alarm: null, initialize: false }, directory: { sql: [], kv: {}, alarm: null, initialize: false },
    objectFailure: () => { throw new Error(`timeout ${CANARY}`); } });
  const failed = await failing.get(`${ROUTE}?section=schema&object=runtime`);
  assert.deepEqual([failed.status, failed.body], [503, { ok: false, error: "inventory_read_failed" }]);
  noLeak(failing.outputs, "failure path");
  await failing.close();
  await h.close();
}

// ---------------------------------------------------- A5: KV listing edge cases
{
  const edge = async script => {
    const h = await harness({ runtime: { sql: [], kv: {}, alarm: null, initialize: false }, directory: { sql: [], kv: {}, alarm: null, initialize: false },
      kv: fakeKv({}, { script }), extraEnv: { ACCOUNT_IDENTITY_INVENTORY_KV_ENABLED: "true" } });
    return h;
  };
  let calls = 0;
  const h = await edge({ list: ({ cursor }) => (++calls === 1 ? { keys: [], list_complete: false, cursor: "c1" } : cursor === "c1"
    ? { keys: [{ name: "runtime_daily:t:2026-01-01" }, { name: "account_options" }], list_complete: true } : violate("kv.list:cursor")),
  get: name => (name === "account_options" ? null : "{}") });
  const empty = await h.get(`${ROUTE}?section=kv`);
  assert.deepEqual([empty.body.keys, empty.body.terminal, typeof empty.body.cursor], [[], false, "string"], "empty page with continuation is not terminal");
  const next = await h.get(`${ROUTE}?${new URLSearchParams({ section: "kv", cursor: empty.body.cursor })}`);
  assert.equal(next.body.terminal, true);
  assert.deepEqual(next.body.keys.map(item => item.state), ["exported", "missing_after_list"], "value deleted after listing is recorded");
  assert.equal(next.body.scan_id, empty.body.scan_id);
  await h.close();
  for (const listing of [{ keys: [], list_complete: false }, { keys: [{ name: "a" }, { name: "a" }], list_complete: true }, { keys: "x", list_complete: true }]) {
    const bad = await edge({ list: () => listing });
    assert.equal((await bad.get(`${ROUTE}?section=kv`)).body.error, "kv_listing_invalid");
    await bad.close();
  }
}

// ---------------------------------------------------- A6: ordinary path order and alarm initialization
{
  const statements = [];
  const order = [];
  const storage = { sql: { exec: statement => { statements.push(statement); return cursorOf([]); } } };
  const instance = new RuntimeInstances({ storage }, {});
  assert.deepEqual(statements, [], "constructor issues no SQL");
  instance.deskReadbacks = { alarm: async () => order.push(`alarm after ${statements.length} statements`) };
  await instance.alarm();
  assert.ok(statements.length > 40 && order[0] === `alarm after ${statements.length} statements`, "alarm initializes storage first, as the constructor did");
  const once = statements.length;
  await instance.alarm();
  assert.equal(statements.length, once, "initialization runs once per instance");
  const fresh = new RuntimeInstances({ storage: { sql: { exec: statement => { statements.push(statement); return cursorOf([]); } } } }, {});
  const before = statements.length;
  const inv = await fresh.fetch(new Request(`https://runtime-instances${INVENTORY_DO_PATH}`, { method: "GET" }));
  assert.equal(inv.status, 405, "internal inventory path is POST-only");
  assert.equal(statements.length, before, "inventory dispatch precedes initialization");
}
assert.deepEqual(violations, [], "no trap fired in Part A");

// ---------------------------------------------------- Part B: workerd through Miniflare
const require = createRequire(new URL("package.json", CONSOLE));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");
// Test-only entry: the subclass adds seed/snapshot hooks that bypass the
// ordinary path entirely; production code is imported unchanged.
const ENTRY = `import worker, { RuntimeInstances as Base } from "./worker.js";
export class RuntimeInstances extends Base {
  constructor(ctx, env) { super(ctx, env); this.testStorage = ctx.storage; }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/__test/")) return super.fetch(request);
    const storage = this.testStorage, sql = storage.sql;
    if (path === "/__test/snapshot") {
      const schema = [...sql.exec("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name")];
      const tables = {};
      for (const row of schema) if (row.type === "table" && !/^(_cf_|sqlite_)/.test(row.name)) tables[row.name] = [...sql.exec('SELECT * FROM "' + row.name + '" ORDER BY rowid')];
      return Response.json({ schema, tables, kv: [...await storage.list()], alarm: await storage.getAlarm(), changes: [...sql.exec("SELECT total_changes() AS n")][0].n });
    }
    const body = await request.json();
    for (const { statement, rows } of body.sql || []) for (const values of rows) sql.exec(statement, ...values);
    const entries = Object.entries(body.kv || {});
    for (let index = 0; index < entries.length; index += 128) await storage.put(Object.fromEntries(entries.slice(index, index + 128)));
    for (const key of body.delete || []) await storage.delete(key);
    if (body.alarm !== undefined) await (body.alarm === null ? storage.deleteAlarm() : storage.setAlarm(body.alarm));
    return Response.json({ ok: true });
  }
}
export default { async fetch(request, env, ctx) {
  const match = /^\\/__test\\/(runtime-instances|console-kv-directory-v1)(\\/.*)$/.exec(new URL(request.url).pathname);
  if (!match) return worker.fetch(request, env, ctx);
  const ns = env.STRATEGY_SWITCH_RUNTIME_INSTANCES;
  return ns.get(ns.idFromName(match[1])).fetch(new Request("https://do/__test" + match[2], request));
} };`;
globalThis.fetch = realFetch;
const consoleDir = fileURLToPath(CONSOLE).replace(/\/$/, "");
const persist = await mkdtemp(join(tmpdir(), "qrt-inventory-mf-"));
let outbound = 0;
const mf = new Miniflare({
  modules: true, modulesRoot: consoleDir, modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  script: ENTRY, scriptPath: join(consoleDir, "__inventory_validation_entry.js"), compatibilityDate: "2026-06-08",
  bindings: { ...env0, ACCOUNT_IDENTITY_INVENTORY_KV_ENABLED: "true" },
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  durableObjectsPersist: persist, kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: () => { outbound += 1; return new Response("offline only", { status: 503 }); },
});
const mfOutputs = [];
const mget = async (path, { cookie = adminCookie, method = "GET", body } = {}) => {
  const response = await mf.dispatchFetch(`${ORIGIN}${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  if (path.startsWith(ROUTE)) mfOutputs.push(text);
  return { status: response.status, body: JSON.parse(text) };
};
const snapshot = async name => (await mget(`/__test/${name}/snapshot`)).body;
const seed = async (name, payload) => assert.equal((await mget(`/__test/${name}/seed`, { method: "POST", body: payload })).status, 200);
const page = (object, table, params) => mget(`${ROUTE}?${new URLSearchParams({ section: table ? "sql" : "do_kv", object, ...(table ? { table } : {}), ...params })}`);
try {
  // B1: fresh objects stay physically empty, including no _cf_ tables.
  for (const [name, object] of [["runtime-instances", "runtime"], ["console-kv-directory-v1", "directory"]]) {
    const before = await snapshot(name);
    assert.deepEqual(before.schema, [], `${name}: fresh object has no schema`);
    const { schema, final } = await collect(mget, object);
    assert.equal(schema.schema_state, "schema_absent");
    assert.equal(final.stable, true);
    assert.deepEqual(await snapshot(name), before, `${name}: inventory created nothing`);
  }

  // B2: old schema in workerd is reported, never upgraded.
  await seed("console-kv-directory-v1", { sql: [...OLD_SCHEMA.map(statement => ({ statement, rows: [[]] })), ...OLD_SCHEMA_ROWS] });
  const oldBefore = await snapshot("console-kv-directory-v1");
  const old = await collect(mget, "directory");
  for (const [table, missing] of Object.entries(EXPECTED_OLD_MISSING)) assert.deepEqual(old.schema.tables[table].missing_columns, missing);
  assert.deepEqual(await snapshot("console-kv-directory-v1"), oldBefore, "old schema untouched in workerd");

  // B3: ordinary GET initializes exactly the schema the allowlist expects.
  assert.equal((await mget("/api/admin/runtime-instances")).status, 200);
  const initialized = (await mget(`${ROUTE}?section=schema&object=runtime`)).body;
  assert.equal(initialized.schema_state, "current", "ordinary-path schema matches the reader allowlist in workerd");
  for (const [name, table] of Object.entries(initialized.tables)) {
    if (table.present) assert.deepEqual([table.missing_columns, table.unexpected_columns], [[], []], name);
    else assert.equal(table.lazy, "binance_detail_command", `${name}: only lazy tables may be absent`);
  }

  // B4: populated full scan; byte-identical state and unchanged change counter.
  await seed("runtime-instances", { ...plan, alarm: plan.alarm });
  for (const [name, value] of Object.entries(KV_VALUES).slice(0, 200)) await (await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG")).put(name, value);
  const before = await snapshot("runtime-instances");
  const responses = [];
  const full = await collect(mget, "runtime", { pageSize: 100, responses });
  assert.equal(full.final.stable, true);
  for (const [table, count] of Object.entries(counts)) assert.equal(full.schema.tables[table].row_count, count, `${table}: workerd count`);
  const after = await snapshot("runtime-instances");
  assert.deepEqual(after, before, "schema, rows, DO-KV, alarm and total_changes() identical after a full scan");
  const exported = assemble({ format: EXPORT_FORMAT, responses }).private.objects[0];
  assert.equal(exported.complete, true, String(exported.reasons));
  const kvPage = await mget(`${ROUTE}?section=kv&page_size=100`);
  assert.equal(kvPage.status, 200);
  assert.equal(kvPage.body.keys.length, 100);

  // B5: exactly-full final page is terminal via lookahead; no empty extra page.
  const scan = (await mget(`${ROUTE}?section=schema&object=runtime`)).body.scan;
  const exact = await page("runtime", "human_decision_material", { page_size: "50", scan });
  assert.deepEqual([exact.body.rows.length, exact.body.terminal, exact.body.cursor], [50, true, null]);
  const two = await page("runtime", "human_decision_material", { page_size: "25", scan });
  const second = await page("runtime", "human_decision_material", { page_size: "25", cursor: two.body.cursor });
  assert.deepEqual([second.body.rows.length, second.body.terminal], [25, true]);

  // B6: drift between pages invalidates completeness.
  const drifts = {
    insert: { sql: [rows("account_facts_daily", [{ platform: "ibkr", account_key: "late", observation_date: day(1) }])] },
    same_count_update: { sql: [{ statement: "UPDATE account_facts_daily SET updated_at = updated_at WHERE account_key = 'acct-000' AND observation_date = ?", rows: [[day(2)]] }] },
    delete: { sql: [{ statement: "DELETE FROM account_facts_daily WHERE account_key = 'late'", rows: [[]] }] },
    replace: { sql: [{ statement: "INSERT OR REPLACE INTO account_facts_daily SELECT * FROM account_facts_daily WHERE observation_date = ? AND account_key = 'acct-000'", rows: [[day(3)]] }] },
    do_kv_put: { kv: { "desk:idempotency:late": { state: "pending" } } },
    do_kv_delete: { delete: ["desk:idempotency:late"] },
    alarm: { alarm: 4_102_444_900_000 },
    schema: { sql: [{ statement: "ALTER TABLE account_facts_daily ADD COLUMN drift TEXT", rows: [[]] }] },
  };
  for (const [kind, change] of Object.entries(drifts)) {
    const token = (await mget(`${ROUTE}?section=schema&object=runtime`)).body.scan;
    const sql = !kind.startsWith("do_kv");
    const first = sql ? await page("runtime", "account_facts_daily", { page_size: "100", scan: token }) : await page("runtime", null, { page_size: "100", scan: token });
    assert.equal(first.status, 200);
    await seed("runtime-instances", change);
    const next = sql ? await page("runtime", "account_facts_daily", { page_size: "100", cursor: first.body.cursor }) : await page("runtime", null, { page_size: "100", cursor: first.body.cursor });
    assert.equal(next.status, 409, `${kind}: drift detected`);
    assert.equal(next.body.error, kind === "schema" ? "schema_changed" : "changed_during_scan", kind);
    const final = (await mget(`${ROUTE}?${new URLSearchParams({ section: "finalize", object: "runtime", scan: token })}`)).body;
    assert.equal(final.stable, false, `${kind}: finalize refuses completeness`);
  }
  // Resume after a stable identical state: a fresh scan completes.
  const resumed = await collect(mget, "runtime", { pageSize: 500 });
  assert.equal(resumed.final.stable, true);
  const settled = await snapshot("runtime-instances");
  await collect(mget, "runtime", { pageSize: 500 });
  assert.deepEqual(await snapshot("runtime-instances"), settled);

  // B7: the Worker never exposes the internal object path; ordinary routes still work.
  const exposed = await mget(INVENTORY_DO_PATH, { method: "POST", body: { section: "schema", object: "runtime" } });
  assert.notEqual(exposed.status, 200);
  assert.ok(!("schema_state" in exposed.body));
  const ordinary = await mget("/api/admin/runtime-instances");
  assert.equal(ordinary.status, 200);
  assert.equal(ordinary.body.revision, 131, "ordinary read sees the seeded state after inventory");
  noLeak(mfOutputs, "workerd scans");
  assert.equal(outbound, 0, "no outbound fetch in workerd");
} finally {
  await mf.dispose();
  await rm(persist, { recursive: true, force: true });
}
console.log("account_identity_inventory_validation: ok");
