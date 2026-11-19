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
import { isDeepStrictEqual } from "node:util";
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
const { INVENTORY_TABLES, INVENTORY_DO_PATH, KV_IDENTITY_FIELDS, CURSOR_CONTEXT } = await import(new URL("application/account_identity_inventory/constants.js", CONSOLE));
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

// `adverse` keeps one account-facts observation whose identity projection
// exceeds the row byte limit; the loss-free control stores an ordinary payload.
function populatedPlan({ adverse = false } = {}) {
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
    // As the Binance detail command creates it on first use; its account keys
    // are literal (binding.account_key), here shaped like a composite.
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
      payload_json: JSON.stringify(index === 29 && adverse ? oversized : { ...big, net_liquidation: AMOUNT_CANARY }), observed_finished_at: day(index),
      observation_date: day(index), target_id: `target-${index}`, source_binding_id: "src-1", account_scope: "scope", updated_at: day(index) }))),
    rows("account_facts_daily", [...range(400).map(index => ({ platform: "ibkr", account_key: "acct-000", observation_date: day(index),
      payload_json: JSON.stringify({ cash: AMOUNT_CANARY }), observed_finished_at: day(index), target_id: "target-0", source_binding_id: "src-1",
      account_scope: "scope", updated_at: day(index) })), ...range(3).map(index => ({ platform: "firstrade", account_key: "orphan-key",
      observation_date: day(index), payload_json: "{bad", observed_finished_at: day(index), target_id: "t", source_binding_id: "src-x",
      account_scope: "scope", updated_at: day(index) })),
      // A Binance wallet-history row as binanceWalletHistoryCommand stores it.
      { platform: "binance", account_key: `bn-main:${hex("wallet-1")}`, observation_date: day(0), payload_json: "{}", observed_finished_at: day(0),
        target_id: "target-bn", source_binding_id: hex("wallet-1"), account_scope: "scope-bn", updated_at: day(0) }]),
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
    rows("account_mapping_policy", [{
      id: 1, policy_revision: 3, updated_at: day(1),
      policy_json: JSON.stringify({
        format: "qsl_account_mapping_policy.v1", policy_revision: 3,
        accounts: [{
          management_class: "eligible",
          deployments: [
            { platform: "ibkr", legacy_key: "acct-004", identity: JSON.parse(storedIdentity(4)) },
            { platform: "ibkr", legacy_key: "mgmt-sibling-only", identity: { platform: "ibkr", key: "mgmt-sibling-only", target_name: "tgt-mgmt", broker_environment: null, account_selector: "sel-mgmt", deployment_selector: "", account_scope: "", service_name: "" } },
          ],
        }],
      }),
    }]),
    rows("account_management_draft", [{
      platform: "ibkr", account_key: "acct-004", revision: 2, identity_json: storedIdentity(4),
      membership_json: JSON.stringify([
        { platform: "ibkr", legacy_key: "acct-004", identity: JSON.parse(storedIdentity(4)) },
        { platform: "ibkr", legacy_key: "mgmt-sibling-only", identity: { platform: "ibkr", key: "mgmt-sibling-only", target_name: "tgt-mgmt", broker_environment: null, account_selector: "sel-mgmt", deployment_selector: "", account_scope: "", service_name: "" } },
      ]),
      management_enabled: 0, base_applied_revision: 1, policy_revision: 3, instance_revision: 131,
      status: "pending", consumed_applied_revision: null, updated_by: ACTOR_CANARY, updated_at: day(2),
    }]),
    rows("account_management_applied", [{
      platform: "ibkr", account_key: "acct-004", revision: 1, identity_json: storedIdentity(4),
      membership_json: JSON.stringify([
        { platform: "ibkr", legacy_key: "acct-004", identity: JSON.parse(storedIdentity(4)) },
        { platform: "ibkr", legacy_key: "mgmt-sibling-only", identity: { platform: "ibkr", key: "mgmt-sibling-only", target_name: "tgt-mgmt", broker_environment: null, account_selector: "sel-mgmt", deployment_selector: "", account_scope: "", service_name: "" } },
      ]),
      management_enabled: 1, effective_at: day(1),
    }]),
    rows("account_management_change", [{
      event_id: "evt-mgmt-1", occurred_at: day(1), actor: ACTOR_CANARY, platform: "ibkr", account_key: "acct-004",
      initiating_identity_json: storedIdentity(4),
      members_json: JSON.stringify([
        { platform: "ibkr", legacy_key: "acct-004", identity: JSON.parse(storedIdentity(4)) },
        { platform: "ibkr", legacy_key: "mgmt-sibling-only", identity: { platform: "ibkr", key: "mgmt-sibling-only", target_name: "tgt-mgmt", broker_environment: null, account_selector: "sel-mgmt", deployment_selector: "", account_scope: "", service_name: "" } },
      ]),
      policy_revision: 3, instance_revision: 131, draft_revision: 1, old_applied_revision: 0, new_applied_revision: 1,
      old_management_enabled: null, new_management_enabled: 1, result: "applied",
    }]),
    rows("account_management_requests", [{
      request_key: "req-mgmt-1", operation: "account_management_apply", actor: ACTOR_CANARY, platform: "ibkr", account_key: "acct-004",
      identity_json: storedIdentity(4), fingerprint: CANARY,
      receipt_json: JSON.stringify({ ok: true, operation: "account_management_apply", request_key: "req-mgmt-1", platform: "ibkr", key: "acct-004",
        deployments: [{ platform: "ibkr", legacy_key: "acct-004" }, { platform: "ibkr", legacy_key: "mgmt-sibling-only" }] }),
      created_at: day(1),
    }]),
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
// `faults` names the R9 fault-injected accessors: reading `sqlColumn.column` of
// a stored `sqlColumn.table` row, or `payload` of a listed `doKvPayload` value,
// throws, so the reader's own catch emits the failure export.
const injectedFault = () => { throw new Error("injected_reader_accessor_fault"); };
function trapObject(path, kvEntries, alarm, log, faults = {}) {
  const db = new DatabaseSync(path, { readOnly: true });
  const sql = { exec(statement, ...bindings) {
    log.push(statement);
    if (WRITE_SQL.test(statement) || /;\s*\S/.test(statement)) violate(`sql:${statement.slice(0, 40)}`);
    const found = db.prepare(statement).all(...bindings);
    const fault = faults.sqlColumn;
    if (fault && statement.startsWith(`SELECT * FROM "${fault.table}"`)) for (const row of found) Object.defineProperty(row, fault.column, { enumerable: true, get: injectedFault });
    return cursorOf(found);
  } };
  const entries = new Map(Object.entries(kvEntries).sort(([a], [b]) => utf8Compare(a, b)));
  const listed = (key, value) => {
    const copy = structuredClone(value);
    if (faults.doKvPayload?.includes(key)) Object.defineProperty(copy, "payload", { enumerable: true, get: injectedFault });
    return copy;
  };
  const storage = trapProxy("storage", {
    sql,
    list: async ({ limit = Infinity, startAfter, ...rest } = {}) => {
      if (Object.keys(rest).length) violate(`storage.list:${Object.keys(rest)}`);
      return new Map([...entries].filter(([key]) => startAfter === undefined || utf8Compare(key, startAfter) > 0).slice(0, limit).map(([key, value]) => [key, listed(key, value)]));
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

async function harness({ runtime, directory, extraEnv = {}, kv = fakeKv(KV_VALUES), objectFailure = null, faults = {} }) {
  const dir = await mkdtemp(join(tmpdir(), "qrt-inventory-trap-"));
  const objects = {}, logs = {}, digests = {}, doCalls = [];
  for (const [name, plan] of [["runtime-instances", runtime], ["console-kv-directory-v1", directory]]) {
    const path = join(dir, `${name}.sqlite`);
    await seedDatabase(path, plan, { initialize: plan.initialize !== false && plan.sql.length > 0 || plan.initialize === true });
    digests[name] = createHash("sha256").update(await readFile(path)).digest("hex");
    logs[name] = [];
    const trap = trapObject(path, plan.kv, plan.alarm, logs[name], name === "runtime-instances" ? faults : {});
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

// ---------------------------------------------------- A2c (B2-A14): the B2 journal index is part of the reviewed schema
{
  const index = "account_management_change_time";
  const variants = {
    correct: { sql: [], expect: { state: "current", missing: [], incompatible: [] } },
    missing: { sql: [{ statement: `DROP INDEX ${index}`, rows: [[]] }], expect: { state: "partial", missing: [index], incompatible: [] } },
    reordered: { sql: [{ statement: `DROP INDEX ${index}`, rows: [[]] },
      { statement: `CREATE INDEX ${index} ON account_management_change (event_id, occurred_at)`, rows: [[]] }], expect: { state: "partial", missing: [], incompatible: [index] } },
    unique: { sql: [{ statement: `DROP INDEX ${index}`, rows: [[]] },
      { statement: `CREATE UNIQUE INDEX ${index} ON account_management_change (occurred_at, event_id)`, rows: [[]] }], expect: { state: "partial", missing: [], incompatible: [index] } },
    direction: { sql: [{ statement: `DROP INDEX ${index}`, rows: [[]] },
      { statement: `CREATE INDEX ${index} ON account_management_change (occurred_at DESC, event_id)`, rows: [[]] }], expect: { state: "partial", missing: [], incompatible: [index] } },
    collation: { sql: [{ statement: `DROP INDEX ${index}`, rows: [[]] },
      { statement: `CREATE INDEX ${index} ON account_management_change (occurred_at COLLATE NOCASE, event_id)`, rows: [[]] }], expect: { state: "partial", missing: [], incompatible: [index] } },
    partial: { sql: [{ statement: `DROP INDEX ${index}`, rows: [[]] },
      { statement: `CREATE INDEX ${index} ON account_management_change (occurred_at, event_id) WHERE result = 'applied'`, rows: [[]] }], expect: { state: "partial", missing: [], incompatible: [index] } },
    cold_absent_table: { sql: [{ statement: "DROP TABLE account_management_change", rows: [[]] }], expect: { state: "partial", missing: [], incompatible: [] } },
  };
  for (const [name, { sql, expect }] of Object.entries(variants)) {
    const h = await harness({ runtime: { sql, kv: {}, alarm: null, initialize: true }, directory: { sql: [], kv: {}, alarm: null, initialize: false } });
    const { schema } = await collect(h.get, "runtime");
    assert.deepEqual([schema.schema_state, schema.missing_indexes, schema.incompatible_indexes], [expect.state, expect.missing, expect.incompatible], `journal index ${name}`);
    await h.close();
  }
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
async function inventoryFull({ sql = [], kvValues = {}, envValues = {}, collectEnv = true, isolate = false, doKv = {}, directoryDoKv = {},
  initialize = sql.length > 0, faults = {} } = {}) {
  const h = await harness({ runtime: { sql, kv: doKv, alarm: null, initialize }, directory: { sql: [], kv: directoryDoKv, alarm: null, initialize: false },
    kv: fakeKv(kvValues), extraEnv: { ACCOUNT_IDENTITY_INVENTORY_KV_ENABLED: "true", ACCOUNT_IDENTITY_INVENTORY_ENV_ENABLED: "true", ...envValues }, faults });
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

// D2/D3: the two account-options sources carry one key-truthiness bit per
// retained option slot (`option_key_truthy`); selection reads it, and a
// selected key or ID cut at the long-string bound is a located loss. Long
// values are built at run time; no fixture holds a long literal.
const { identityProjection } = await import(new URL("application/account_identity_inventory/helpers.js", CONSOLE));
const { LONG_STRING } = await import(new URL("application/account_identity_inventory/constants.js", CONSOLE));
const LOSS = "selected_option_identity_long_string";
const MISSING = "option_key_evidence_missing";
const OPTIONS_BINDING = "STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON";
const long = (length, fill = "L") => fill.repeat(length);
const configuredEpisodes = result => result.mapping.entries.flatMap(entry => entry.episodes.filter(episode => episode.state === "configured_option")
  .map(episode => ({ platform: entry.platform, legacy_key: entry.legacy_key, locator: episode.locator, identity: episode.identity })));
// Both objects finalized, two equal KV passes, the KV failed-read count,
// unrelated groups untouched and an aggregate-only summary.
const settled = (label, result, summary, { failedReads = 0, needles = [] } = {}) => {
  assert.ok(result.objects.every(object => object.complete), `${label}: both objects finalized`);
  assert.equal(result.kv.repeated_pass_equal, true, `${label}: two equal KV passes`);
  assert.deepEqual([result.kv.failed_reads.length, summary.kv.failed_reads], [failedReads, failedReads], `${label}: KV failed reads`);
  otherGroupsComplete(result, label);
  summaryAggregatesOnly(summary, label, ["option_key_truthy", "kv:", "ibkr[", LOSS, MISSING, ...needles]);
};
const disposition = (label, result, summary, reasons) => {
  const state = reasons.length ? "incomplete" : "complete", status = reasons.length ? "incomplete" : ENUMERATED;
  assert.deepEqual([result.groups[16], result.group_reasons[16], result.reasons, result.status, summary.status, summary.groups[16], summary.reason_count],
    [state, reasons.length ? reasons : undefined, reasons, status, status, state, reasons.length], `${label}: group 16, private and summary disposition`);
};
{
  const SOURCES = {
    kv: { source: "kv:account_options", projected: responses => exportedKv(responses, "account_options"),
      run: (value, extra = {}) => inventoryFull({ kvValues: { account_options: value, ...extra.kvValues }, envValues: extra.envValues }) },
    env: { source: `env:${OPTIONS_BINDING}`, projected: responses => exportedEnv(responses, OPTIONS_BINDING),
      run: (value, extra = {}) => inventoryFull({ kvValues: extra.kvValues, envValues: { [OPTIONS_BINDING]: value, ...extra.envValues } }) },
  };
  for (const [sourceName, { source, projected, run }] of Object.entries(SOURCES)) {
    const truncation = sourceName === "kv" ? "kv:account_options:identity_projection_truncated" : `env:${OPTIONS_BINDING}:identity_projection_truncated`;
    const truncationFailures = sourceName === "kv" ? 1 : 0;
    const truncated = (label, result, summary) => {
      disposition(label, result, summary, [truncation]);
      if (sourceName === "kv") assert.deepEqual(result.kv.failed_reads.map(read => [read.name, read.causes]), [["account_options", ["identity_projection_truncated"]]], `${label}: one failed KV key`);
    };

    // D2-N1/N2: a truthy object key that projects nothing still blocks its ID.
    for (const [row, keyValue] of [[`D2-N1-${sourceName}-empty-object`, {}], [`D2-N2-${sourceName}-unprojected-object`, { note: "d2-note" }]]) {
      for (const order of ["key-first", "id-first"]) {
        const label = `${row} ${order}`;
        const raw = order === "key-first" ? { key: keyValue, id: "acct-d2n" } : { id: "acct-d2n", key: keyValue };
        assert.throws(() => normalizeAccountOption("ibkr", raw), undefined, `${label}: the ordinary reader rejects it`);
        const { responses, private: result, summary } = await run(JSON.stringify({ ibkr: [raw] }));
        assert.deepEqual(projected(responses).identity, { fields: { "ibkr[0].id": "acct-d2n" }, counts: { ibkr: 1 }, redacted: [], truncated: false,
          option_key_truthy: { "ibkr[0]": true } }, `${label}: one direct ID field, no key field, count or path, bit true`);
        assert.deepEqual([configuredEpisodes(result), result.mapping.entries, result.mapping.unattributed], [[], [], []], `${label}: no configured episode, mapping or unattributed ID`);
        disposition(label, result, summary, []);
        settled(label, result, summary, { needles: ["acct-d2n", "d2-note"] });
      }
    }

    // D2-P1: the five O1 fixtures carry a false bit and keep their outcome.
    for (const [variant, keyField] of [["missing", {}], ["empty", { key: "" }], ["null", { key: null }], ["false", { key: false }], ["zero", { key: 0 }]]) {
      const raw = { ...keyField, id: "acct-o1", account_selector: "sel-o1" };
      const name = `D2-P1-${sourceName}-O1-preserved ${variant}`;
      const oracle = normalizeAccountOption("ibkr", raw).key;
      assert.deepEqual(Object.keys(normalizeAccountOptionsPayload({ ibkr: [raw] })), ["ibkr"], `${name}: the ordinary reader accepts the payload`);
      const { responses, private: result, summary } = await run(JSON.stringify({ ibkr: [raw] }));
      assert.deepEqual(projected(responses).identity.option_key_truthy, { "ibkr[0]": false }, `${name}: bit false`);
      assert.deepEqual(configuredEpisodes(result), [{ platform: "ibkr", legacy_key: oracle, locator: { source, path: "ibkr[0].id" }, identity: { selected_field: "id" } }],
        `${name}: one configured episode matching normalizeAccountOption`);
      assert.deepEqual([result.mapping.entries.length, result.mapping.unattributed, result.status, summary.status, summary.mapping.entries, summary.mapping.unattributed_rows],
        [1, [], ENUMERATED, ENUMERATED, 1, 0], `${name}: complete, one entry, zero unattributed`);
      disposition(name, result, summary, []);
      settled(name, result, summary, { needles: ["acct-o1", "sel-o1"] });
    }

    // D2-P2: a true bit neither replaces a selected key nor promotes other IDs.
    for (const [variant, raw, expected, bits] of [
      ["key-and-id", { key: "acct-o2k", id: "acct-o2i" }, [["acct-o2k", "ibkr[0].key", { selected_field: "key" }]], { "ibkr[0]": true }],
      ["id-before-key", { id: "acct-o2i", key: "acct-o2k" }, [["acct-o2k", "ibkr[0].key", { selected_field: "key" }]], { "ibkr[0]": true }],
      ["identical", { key: "acct-o2", id: "acct-o2" }, [["acct-o2", "ibkr[0].key", { selected_field: "key" }]], { "ibkr[0]": true }],
      ["whitespace-key", { key: "  acct-o2w  " }, [["acct-o2w", "ibkr[0].key", { selected_field: "key", raw_value: "  acct-o2w  " }]], { "ibkr[0]": true }],
      ["whitespace-id", { key: "", id: " acct-o2v\t" }, [["acct-o2v", "ibkr[0].id", { selected_field: "id", raw_value: " acct-o2v\t" }]], { "ibkr[0]": false }],
      ["invalid-chars", { key: "bad key", id: "acct-o2x" }, [["bad key", "ibkr[0].key", { selected_field: "key", option_key_valid: false }]], { "ibkr[0]": true }],
      ["generic-ids", { key: "acct-o2k", links: [{ id: "gen-o2a" }], meta: { id: "gen-o2b" } }, [["acct-o2k", "ibkr[0].key", { selected_field: "key" }]], { "ibkr[0]": true }],
    ]) {
      const label = `D2-P2-${sourceName}-O2-preserved ${variant}`;
      const { responses, private: result, summary } = await run(JSON.stringify({ ibkr: [raw] }));
      assert.deepEqual(projected(responses).identity.option_key_truthy, bits, `${label}: one bit for the slot`);
      assert.deepEqual(configuredEpisodes(result).map(item => [item.legacy_key, item.locator.path, item.identity]), expected, `${label}: configured episodes unchanged`);
      assert.deepEqual([result.mapping.entries.map(entry => entry.legacy_key), result.mapping.unattributed], [expected.map(([legacyKey]) => legacyKey), []], `${label}: no second identity`);
      disposition(label, result, summary, []);
      settled(label, result, summary, { needles: ["acct-o2", "gen-o2"] });
    }

    // D2-B1: the last slot's key follows its ID and the 4000th field.
    {
      const label = `D2-B1-${sourceName}-hidden-key-at-exact-cap`;
      const last = { id: "acct-b1", account_selector: "sel-b1", key: { note: "d2-hidden" } };
      const value = { ibkr: [...range(1999).map(index => ({ key: `opt-${pad(index)}`, account_selector: `sel-${index}` })), last] };
      assert.throws(() => normalizeAccountOption("ibkr", last, 1999), undefined, `${label}: the ordinary reader rejects the last option`);
      const { responses, private: result, summary } = await run(JSON.stringify(value));
      const identity = projected(responses).identity;
      const bits = Object.values(identity.option_key_truthy);
      assert.deepEqual([Object.keys(identity.fields).length, identity.truncated, bits.length, identity.option_key_truthy["ibkr[1999]"], bits.every(bit => bit === true)],
        [4000, false, 2000, true, true], `${label}: 4000 fields, 2000 slot bits, last bit true`);
      assert.deepEqual(configuredEpisodes(result).map(item => [item.legacy_key, item.locator.path]), range(1999).map(index => [`opt-${pad(index)}`, `ibkr[${index}].key`]),
        `${label}: exactly 1999 configured mappings`);
      assert.ok(!result.mapping.entries.some(entry => entry.legacy_key === "acct-b1") && !result.mapping.unattributed.length, `${label}: no final ID fallback`);
      disposition(label, result, summary, []);
      settled(label, result, summary, { needles: ["opt-", "acct-b1"] });
    }

    // D2-B2: the last slot's ID is the 4000th field; its key lies beyond the cap.
    {
      const label = `D2-B2-${sourceName}-key-after-cutoff`;
      const accepted = range(1999).map(index => ({ key: `opt-${pad(index)}`, account_selector: `sel-${index}`, ...(index === 0 ? { target_name: "tgt-b2" } : {}) }));
      const value = { ibkr: [...accepted, { id: "acct-b2i", key: "acct-b2k" }] };
      assert.deepEqual([value.ibkr.length, value.ibkr.reduce((total, option) => total + Object.keys(option).length, 0)], [2000, 4001], `${label}: fixture input counts`);
      const { responses, private: result, summary } = await run(JSON.stringify(value));
      const identity = projected(responses).identity;
      assert.deepEqual([Object.keys(identity.fields).length, identity.truncated, Object.keys(identity.option_key_truthy).length, identity.option_key_truthy["ibkr[1999]"],
        identity.fields["ibkr[1999].id"], Object.hasOwn(identity.fields, "ibkr[1999].key")], [4000, true, 2000, true, "acct-b2i", false], `${label}: projection and bits`);
      assert.deepEqual(configuredEpisodes(result).map(item => item.legacy_key), range(1999).map(index => `opt-${pad(index)}`), `${label}: 1999 configured mappings survive`);
      assert.ok(!result.mapping.entries.some(entry => entry.legacy_key.startsWith("acct-b2")) && !result.mapping.unattributed.length, `${label}: no final ID inference`);
      truncated(label, result, summary);
      settled(label, result, summary, { failedReads: truncationFailures, needles: ["opt-", "acct-b2"] });
    }

    // D2-B3: evidence is bounded by the retained fields, with no second cap.
    for (const count of [4000, 4001]) {
      const label = `D2-B3-${sourceName}-evidence-bound ${count}`;
      const value = { ibkr: range(count).map(index => ({ id: `opt-${pad(index)}` })) };
      const { responses, private: result, summary } = await run(JSON.stringify(value));
      const identity = projected(responses).identity;
      const bits = Object.values(identity.option_key_truthy);
      assert.deepEqual([Object.keys(identity.fields).length, identity.truncated, bits.length, bits.every(bit => bit === false), Object.hasOwn(identity.option_key_truthy, "ibkr[4000]")],
        [4000, count > 4000, 4000, true, false], `${label}: 4000 fields and 4000 false bits, none for the unretained slot`);
      const configured = configuredEpisodes(result);
      assert.deepEqual(configured.map(item => [item.legacy_key, item.locator.path]), range(4000).map(index => [`opt-${pad(index)}`, `ibkr[${index}].id`]), `${label}: 4000 configured mappings`);
      if (count === 4000) {
        disposition(label, result, summary, []);
        settled(label, result, summary, { needles: ["opt-"] });
        continue;
      }
      assert.deepEqual(configured.filter(item => item.identity.key_unobserved_at_truncation).map(item => item.locator.path), ["ibkr[3999].id"], `${label}: the boundary slot is qualified`);
      truncated(label, result, summary);
      settled(label, result, summary, { failedReads: truncationFailures, needles: ["opt-"] });
    }

    // D2-C2: only direct key/ID fields of objects in a root platform array
    // get a bit; the bit carries nothing of the key or the option.
    {
      const label = `D2-C2-${sourceName}-slot-fence-and-privacy`;
      const raw = { ibkr: [{ key: { label: CANARY, note: "d2-ignored" }, id: "acct-c2x", meta: { id: "gen-c2m" }, links: [{ id: "gen-c2l" }] },
        { key: "acct-c2", meta: { id: "gen-c2n" }, api_key: CANARY }, { account_selector: "sel-c2" }], "acct.c2": [{ id: "gen-c2d" }] };
      const { responses, private: result, summary } = await run(JSON.stringify(raw));
      const identity = projected(responses).identity;
      assert.deepEqual(identity.option_key_truthy, { "ibkr[0]": true, "ibkr[1]": true }, `${label}: genuine slots only, none for nested, keyless or dotted-root IDs`);
      assert.ok(Object.hasOwn(identity.fields, "ibkr[0].meta.id") && Object.hasOwn(identity.fields, "acct.c2[0].id"), `${label}: the fenced IDs are still projected`);
      const text = JSON.stringify(identity.option_key_truthy);
      for (const needle of [CANARY, "d2-ignored", "acct-c2", "gen-c2", "label", "note"]) assert.ok(!text.includes(needle), `${label}: the bits omit ${needle}`);
      assert.deepEqual([configuredEpisodes(result).map(item => [item.legacy_key, item.locator.path]), result.mapping.unattributed], [[["acct-c2", "ibkr[1].key"]], []], `${label}: only the genuine key`);
      disposition(label, result, summary, []);
      settled(label, result, summary, { needles: [CANARY, "acct-c2", "gen-c2", "d2-ignored", source] });
      // A root property whose name only resembles a slot gets no bit, so its
      // ID is never inferred; the empty dictionary is still emitted.
      const lookalike = `${label} lookalike`;
      const { responses: lookResponses, private: look, summary: lookSummary } = await run(JSON.stringify({ "ibkr[0]": { id: "gen-c2p" }, "acct.c2": [{ id: "gen-c2d" }] }));
      const lookIdentity = projected(lookResponses).identity;
      assert.deepEqual([lookIdentity.fields, lookIdentity.option_key_truthy], [{ "ibkr[0].id": "gen-c2p", "acct.c2[0].id": "gen-c2d" }, {}], `${lookalike}: no bit for a lookalike`);
      assert.deepEqual([configuredEpisodes(look), look.mapping.entries, look.mapping.unattributed], [[], [], []], `${lookalike}: no inferred identity`);
      disposition(lookalike, look, lookSummary, [`${source}:ibkr[0].key:${MISSING}`]);
      settled(lookalike, look, lookSummary, { needles: ["gen-c2"] });
    }

    // D2-C3: an export collected before the bits existed. The stripped
    // projection equals the default (pre-extension) projection of the value.
    {
      const strip = exported => {
        const copy = structuredClone(exported);
        for (const response of copy.responses) {
          const items = response.request.section === "kv" ? response.body.keys : response.request.section === "env" ? response.body.bindings : [];
          for (const item of items || []) if (item.identity) delete item.identity.option_key_truthy;
        }
        return copy;
      };
      const optionItems = exported => exported.responses.flatMap(response => response.request.section === "kv" ? response.body.keys.filter(item => item.name === "account_options")
        : response.request.section === "env" ? response.body.bindings.filter(item => item.name === OPTIONS_BINDING) : []).filter(item => item.identity);
      const cases = [["missing", { id: "acct-c3" }, null], ["empty-object", { key: {}, id: "acct-c3" }, null], ["unprojected-object", { id: "acct-c3", key: { note: "d2-note" } }, null],
        ["short-key", { key: "acct-c3k", id: "acct-c3" }, ["acct-c3k", "ibkr[0].key"]],
        ...[["empty", ""], ["null", null], ["false", false], ["zero", 0]].map(([variant, keyValue]) => [`falsy-${variant}`, { key: keyValue, id: "acct-c3" }, ["acct-c3", "ibkr[0].id"]])];
      for (const [variant, raw, expected] of cases) {
        const label = `D2-C3-${sourceName}-legacy-ambiguity ${variant}`;
        const text = JSON.stringify({ ibkr: [raw] });
        const current = await run(text, { kvValues: UNRELATED });
        const legacy = strip(current.exported);
        for (const item of optionItems(legacy)) assert.deepEqual(item.identity, identityProjection(JSON.parse(text), 4000), `${label}: the authentic pre-extension projection`);
        assert.deepEqual(optionItems(legacy).map(item => item.value_sha256), optionItems(current.exported).map(item => item.value_sha256), `${label}: the same digest`);
        const { private: result, summary } = assemble(legacy);
        const unrelated = result.mapping.entries.filter(entry => entry.legacy_key === "unrelated-account").length;
        assert.equal(unrelated, 1, `${label}: other observations are kept`);
        if (expected) {
          assert.deepEqual(configuredEpisodes(result).map(item => [item.legacy_key, item.locator.path]), [expected], `${label}: proved by direct key evidence`);
          disposition(label, result, summary, []);
        } else {
          assert.deepEqual([configuredEpisodes(result), result.mapping.entries.length, result.mapping.unattributed], [[], 1, []], `${label}: the ambiguous ID is not inferred`);
          disposition(label, result, summary, [`${source}:ibkr[0].key:${MISSING}`]);
          // The current handler's export of the same value decides it.
          assert.deepEqual(configuredEpisodes(current.private).map(item => item.legacy_key), variant === "missing" ? ["acct-c3"] : [], `${label}: current export decides`);
          disposition(`${label} current`, current.private, current.summary, []);
        }
        settled(label, result, summary, { needles: ["acct-c3", "unrelated-account"] });
        if (variant !== "missing") continue;
        // Missing or non-Boolean evidence is never read as false.
        for (const [bad, bits] of [["no-entry", {}], ["string", { "ibkr[0]": "false" }], ["zero", { "ibkr[0]": 0 }], ["null-entry", { "ibkr[0]": null }],
          ["null", null], ["array", [false]], ["text", "false"]]) {
          const tampered = structuredClone(current.exported);
          for (const item of optionItems(tampered)) item.identity.option_key_truthy = structuredClone(bits);
          const { private: out, summary: outSummary } = assemble(tampered);
          assert.deepEqual(configuredEpisodes(out), [], `${label} evidence-${bad}: no ID inferred`);
          disposition(`${label} evidence-${bad}`, out, outSummary, [`${source}:ibkr[0].key:${MISSING}`]);
        }
      }
    }

    // D3-L1: a selected key beyond the long-string bound is lost, never replaced.
    for (const length of [513, 600]) {
      const label = `D3-L1-${sourceName}-selected-long-key ${length}`;
      const raw = { key: long(length), id: "acct-l1" };
      assert.equal(normalizeAccountOption("ibkr", raw).key, raw.key, `${label}: the ordinary reader selects the key`);
      const { responses, private: result, summary } = await run(JSON.stringify({ ibkr: [raw] }));
      const identity = projected(responses).identity;
      assert.deepEqual([identity.fields["ibkr[0].key"], identity.option_key_truthy, identity.truncated], [{ long_string: length }, { "ibkr[0]": true }, false], `${label}: direct marker, bit true`);
      assert.deepEqual([configuredEpisodes(result), result.mapping.entries, result.mapping.unattributed], [[], [], []], `${label}: no episode or substitute`);
      disposition(label, result, summary, [`${source}:ibkr[0].key:${LOSS}`]);
      settled(label, result, summary, { needles: ["acct-l1", "LLLL"] });
    }

    // D3-L2: a selected ID beyond the bound, for every missing or falsy key.
    for (const length of [513, 600]) {
      for (const [variant, keyField] of [["missing", {}], ["empty", { key: "" }], ["null", { key: null }], ["false", { key: false }], ["zero", { key: 0 }]]) {
        const label = `D3-L2-${sourceName}-selected-long-id ${length} ${variant}`;
        const raw = { ...keyField, id: long(length), account_selector: "sel-l2" };
        assert.equal(normalizeAccountOption("ibkr", raw).key, raw.id, `${label}: the ordinary reader selects the ID`);
        const { responses, private: result, summary } = await run(JSON.stringify({ ibkr: [raw] }));
        const identity = projected(responses).identity;
        assert.deepEqual([identity.fields["ibkr[0].id"], identity.option_key_truthy, identity.truncated], [{ long_string: length }, { "ibkr[0]": false }, false], `${label}: direct marker, bit false`);
        assert.deepEqual([configuredEpisodes(result), result.mapping.entries, result.mapping.unattributed], [[], [], []], `${label}: no episode or substitute`);
        disposition(label, result, summary, [`${source}:ibkr[0].id:${LOSS}`]);
        settled(label, result, summary, { needles: ["sel-l2", "LLLL"] });
      }
    }

    // D3-P1: a nonselected long ID is no loss.
    for (const [variant, keyValue, expected] of [["valid-key", "acct-p1k", [["acct-p1k", "ibkr[0].key"]]], ["rejected-numeric-key", 7, []]]) {
      const label = `D3-P1-${sourceName}-valid-key-long-id ${variant}`;
      const raw = { key: keyValue, id: long(513) };
      if (expected.length) assert.equal(normalizeAccountOption("ibkr", raw).key, keyValue, `${label}: the ordinary reader selects the key`);
      else assert.throws(() => normalizeAccountOption("ibkr", raw), undefined, `${label}: the ordinary reader rejects it`);
      const { responses, private: result, summary } = await run(JSON.stringify({ ibkr: [raw] }));
      assert.deepEqual(projected(responses).identity.option_key_truthy, { "ibkr[0]": true }, `${label}: bit true`);
      assert.deepEqual([configuredEpisodes(result).map(item => [item.legacy_key, item.locator.path]), result.mapping.entries.length, result.mapping.unattributed],
        [expected, expected.length, []], `${label}: no ID observation`);
      disposition(label, result, summary, []);
      settled(label, result, summary, { needles: ["acct-p1k", "LLLL"] });
    }

    // D3-P2: exactly 512 characters is still a string and maps.
    assert.equal(LONG_STRING, 512, "D3-P2: the bound stays 512");
    for (const [variant, raw, field] of [["key", { key: long(512, "K") }, "key"], ["id-fallback", { id: long(512, "I") }, "id"]]) {
      const label = `D3-P2-${sourceName}-exact-512 ${variant}`;
      const oracle = normalizeAccountOption("ibkr", raw).key;
      const { responses, private: result, summary } = await run(JSON.stringify({ ibkr: [raw] }));
      assert.equal(projected(responses).identity.fields[`ibkr[0].${field}`], raw[field], `${label}: the field stays a string`);
      assert.deepEqual(configuredEpisodes(result), [{ platform: "ibkr", legacy_key: oracle, locator: { source, path: `ibkr[0].${field}` }, identity: { selected_field: field } }],
        `${label}: one oracle-equal episode`);
      disposition(label, result, summary, []);
      settled(label, result, summary, { needles: ["KKKK", "IIII"] });
    }

    // D3-P3: an object holding a `long_string` property is not the marker.
    for (const [variant, raw, fields, bits] of [["key-object", { key: { long_string: 513 }, id: "acct-p3" }, { "ibkr[0].id": "acct-p3" }, { "ibkr[0]": true }],
      ["id-object", { id: { long_string: 513 } }, {}, {}]]) {
      const label = `D3-P3-${sourceName}-marker-lookalike ${variant}`;
      assert.throws(() => normalizeAccountOption("ibkr", raw), undefined, `${label}: the ordinary reader rejects it`);
      const { responses, private: result, summary } = await run(JSON.stringify({ ibkr: [raw] }));
      const identity = projected(responses).identity;
      assert.deepEqual([identity.fields, identity.option_key_truthy], [fields, bits], `${label}: no direct marker`);
      assert.deepEqual([configuredEpisodes(result), result.mapping.entries, result.mapping.unattributed], [[], [], []], `${label}: no fallback or inferred identity`);
      disposition(label, result, summary, []);
      settled(label, result, summary, { needles: ["acct-p3"] });
    }

    // D3-R1: two losses, one survivor and an unrelated reference in one source.
    {
      const label = `D3-R1-${sourceName}-survivors-and-dedup`;
      const value = { ibkr: [{ key: long(600), id: long(513) }, { id: long(513) }, { key: "acct-r1" }] };
      const extra = sourceName === "kv" ? { kvValues: { risk_profile_bindings: JSON.stringify({ rows: [{ platform: "ibkr", account_key: "acct-r1u" }] }) } }
        : { envValues: { BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify({ platform: "binance", account_key: "acct-r1u" }) } };
      const { responses, private: result, summary } = await run(JSON.stringify(value), extra);
      const identity = projected(responses).identity;
      assert.deepEqual([identity.fields["ibkr[0].key"], identity.fields["ibkr[1].id"], identity.option_key_truthy], [{ long_string: 600 }, { long_string: 513 },
        { "ibkr[0]": true, "ibkr[1]": false, "ibkr[2]": true }], `${label}: markers retained`);
      assert.deepEqual(configuredEpisodes(result).map(item => [item.legacy_key, item.locator]), [["acct-r1", { source, path: "ibkr[2].key" }]], `${label}: one configured survivor`);
      assert.deepEqual([result.mapping.entries.map(entry => entry.legacy_key).sort(), result.mapping.unattributed], [["acct-r1", "acct-r1u"], []], `${label}: plus the unrelated mapping only`);
      disposition(label, result, summary, [`${source}:ibkr[0].key:${LOSS}`, `${source}:ibkr[1].id:${LOSS}`]);
      settled(label, result, summary, { needles: ["acct-r1", "LLLL"] });
    }
  }

  // D3-R2: one loss in each source at once, one survivor in each.
  {
    const label = "D3-R2-both-sources";
    const { private: result, summary } = await inventoryFull({ kvValues: { account_options: JSON.stringify({ ibkr: [{ key: long(513), id: "acct-r2x" }, { key: "acct-r2k" }] }) },
      envValues: { [OPTIONS_BINDING]: JSON.stringify({ ibkr: [{ id: long(600) }, { id: "acct-r2e" }] }) } });
    assert.deepEqual(configuredEpisodes(result).map(item => [item.legacy_key, item.locator]),
      [["acct-r2k", { source: "kv:account_options", path: "ibkr[1].key" }], ["acct-r2e", { source: `env:${OPTIONS_BINDING}`, path: "ibkr[1].id" }]], `${label}: two survivors`);
    assert.deepEqual([result.mapping.entries.length, result.mapping.unattributed], [2, []], `${label}: no invented account`);
    disposition(label, result, summary, [`kv:account_options:ibkr[0].key:${LOSS}`, `env:${OPTIONS_BINDING}:ibkr[0].id:${LOSS}`]);
    settled(label, result, summary, { needles: ["acct-r2", "LLLL"] });
  }
}

// D2-C1: the default projection is unchanged and only the two option
// sources opt in.
{
  const deep = depth => {
    let node = { platform: "ibkr", account_key: "deep-c1" };
    for (let level = depth; level >= 1; level--) node = { [`l${level}`]: node };
    return node;
  };
  const DEFAULT_KEYS = ["fields", "counts", "redacted", "truncated"];
  const inputs = {
    normal: [{ ibkr: [{ key: "acct-c1", id: "acct-c1i", account_selector: "sel-c1" }], schwab: [{ id: "acct-c1s" }] }, 4000,
      { fields: { "ibkr[0].key": "acct-c1", "ibkr[0].id": "acct-c1i", "ibkr[0].account_selector": "sel-c1", "schwab[0].id": "acct-c1s" }, counts: { ibkr: 1, schwab: 1 }, redacted: [], truncated: false }],
    "empty-object": [{ ibkr: [{ key: {}, id: "acct-c1" }] }, 4000, { fields: { "ibkr[0].id": "acct-c1" }, counts: { ibkr: 1 }, redacted: [], truncated: false }],
    "unprojected-object": [{ ibkr: [{ id: "acct-c1", key: { note: "n" }, token: "t" }] }, 4000,
      { fields: { "ibkr[0].id": "acct-c1" }, counts: { ibkr: 1 }, redacted: ["ibkr[0].token"], truncated: false }],
    "nested-id": [{ ibkr: [{ key: "acct-c1", meta: { id: "gen-c1" }, links: [{ id: "gen-c1l" }] }] }, 4000,
      { fields: { "ibkr[0].key": "acct-c1", "ibkr[0].meta.id": "gen-c1", "ibkr[0].links[0].id": "gen-c1l" }, counts: { ibkr: 1, "ibkr[0].links": 1 }, redacted: [], truncated: false }],
    "long-string": [{ ibkr: [{ key: long(600), id: long(513) }] }, 4000,
      { fields: { "ibkr[0].key": { long_string: 600 }, "ibkr[0].id": { long_string: 513 } }, counts: { ibkr: 1 }, redacted: [], truncated: false }],
    "field-cutoff": [{ ibkr: [{ key: "a1", account_selector: "s1" }, { id: "a2", key: "a2k" }] }, 3,
      { fields: { "ibkr[0].key": "a1", "ibkr[0].account_selector": "s1", "ibkr[1].id": "a2" }, counts: { ibkr: 2 }, redacted: [], truncated: true }],
    "depth-cutoff": [deep(9), 4000, { fields: {}, counts: {}, redacted: [], truncated: true }],
  };
  for (const [name, [value, cap, expected]] of Object.entries(inputs)) {
    const label = `D2-C1-default-output-and-source-fence ${name}`;
    const off = identityProjection(value, cap);
    assert.deepEqual([Object.keys(off), off], [DEFAULT_KEYS, expected], `${label}: default output, four properties, pinned values`);
    assert.deepEqual(identityProjection(value, cap, {}), off, `${label}: empty options`);
    assert.deepEqual(identityProjection(value, cap, { optionKeyEvidence: false }), off, `${label}: mode off`);
    const on = identityProjection(value, cap, { optionKeyEvidence: true });
    assert.deepEqual(Object.keys(on), [...DEFAULT_KEYS, "option_key_truthy"], `${label}: mode on adds only the bits`);
    const { option_key_truthy: bits, ...rest } = on;
    assert.deepEqual(rest, off, `${label}: stripping the bits gives the default output`);
    assert.ok(Object.values(bits).every(bit => typeof bit === "boolean"), `${label}: Boolean bits`);
  }
  assert.deepEqual(Object.keys(identityProjection({ ibkr: [{ key: "a" }] })), DEFAULT_KEYS, "D2-C1: default cap call");

  // Real handlers: SQL JSON, non-option KV families and non-option bindings
  // carry no bits; their references keep their locators.
  const label = "D2-C1-default-output-and-source-fence handlers";
  const shaped = (platform, account) => JSON.stringify({ [platform]: [{ platform, account_key: account, id: `gen-${account}` }] });
  const { responses, private: result, summary } = await inventoryFull({
    sql: [rows("account_setting_draft", [{ platform: "ibkr", account_key: "acct-c1q", revision: 1,
      identity_json: JSON.stringify({ ibkr: [{ platform: "ibkr", key: "acct-c1q", id: "gen-c1q" }] }), overrides_json: "{}", updated_at: day(1) }])],
    kvValues: { account_options: JSON.stringify({ ibkr: [{ key: "acct-c1k" }] }), risk_profile_bindings: shaped("ibkr", "acct-c1r"),
      account_facts_bindings: shaped("ibkr", "acct-c1f"), current_strategies_cache: JSON.stringify({ ts: 1, data: { ibkr: { "acct-c1c": { account_selector: "s" } } } }) },
    envValues: { [OPTIONS_BINDING]: JSON.stringify({ ibkr: [{ id: "acct-c1e" }] }), BINANCE_ACCOUNT_FACTS_BINDING_JSON: shaped("binance", "acct-c1b"),
      BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON: shaped("binance", "acct-c1h") } });
  const carriers = [];
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (Object.hasOwn(node, "option_key_truthy")) carriers.push(path);
    for (const [name, item] of Object.entries(node)) walk(item, `${path}/${name}`);
  };
  responses.forEach((response, index) => walk(response.body, `${index}`));
  const expectedCarriers = responses.flatMap((response, index) => response.request.section === "kv"
    ? response.body.keys.map((item, at) => item.name === "account_options" ? `${index}/keys/${at}/identity` : null).filter(Boolean)
    : response.request.section === "env" ? response.body.bindings.map((item, at) => item.name === OPTIONS_BINDING ? `${index}/bindings/${at}/identity` : null).filter(Boolean) : []);
  assert.deepEqual([carriers, expectedCarriers.length], [expectedCarriers, 3], `${label}: bits only on the two option sources (two KV passes, one env)`);
  for (const name of ["risk_profile_bindings", "account_facts_bindings", "current_strategies_cache"]) assert.deepEqual(Object.keys(exportedKv(responses, name).identity), DEFAULT_KEYS, `${label}: ${name}`);
  for (const name of ["BINANCE_ACCOUNT_FACTS_BINDING_JSON", "BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON"]) assert.deepEqual(Object.keys(exportedEnv(responses, name).identity), DEFAULT_KEYS, `${label}: ${name}`);
  const sqlRow = responses.find(response => response.request.section === "sql" && response.request.table === "account_setting_draft").body.rows[0];
  assert.deepEqual(Object.keys(sqlRow.columns.identity_json), ["state", "bytes", ...DEFAULT_KEYS], `${label}: SQL JSON projection`);
  const episodes = legacyKey => result.mapping.entries.filter(entry => entry.legacy_key === legacyKey).flatMap(entry => entry.episodes.map(episode => [entry.platform, episode.state, episode.locator.path ?? null]));
  assert.deepEqual([episodes("acct-c1q"), episodes("acct-c1r"), episodes("acct-c1f"), episodes("acct-c1c"), episodes("acct-c1b"), episodes("acct-c1h"), episodes("acct-c1k"), episodes("acct-c1e")],
    [[["ibkr", "store_reference", null], ["ibkr", "store_reference", "ibkr[0].key"]], [["ibkr", "kv_reference", "ibkr[0].account_key"]], [["ibkr", "kv_reference", "ibkr[0].account_key"]],
      [["ibkr", "kv_reference", ["data", "ibkr", "acct-c1c"]]], [["binance", "env_reference", "binance[0].account_key"]], [["binance", "env_reference", "binance[0].account_key"]],
      [["ibkr", "configured_option", "ibkr[0].key"]], [["ibkr", "configured_option", "ibkr[0].id"]]], `${label}: mapping outcomes and locators`);
  assert.ok(!result.mapping.entries.some(entry => entry.legacy_key.startsWith("gen-")) && !result.mapping.unattributed.length, `${label}: generic IDs stay non-identities`);
  disposition(label, result, summary, []);
  summaryAggregatesOnly(summary, label, ["option_key_truthy", "acct-c1", "gen-"]);
  // Desk payloads from the real writer, and an option-shaped job payload.
  const desk = await inventoryOf({ doKv: { ...await deskRecords(), "desk:readbacks:record:rb_c1": { owner: "owner-c1", expires: Date.now() + 86_400_000,
    payload: { state: "running", ibkr: [{ id: "gen-c1d", key: "acct-c1d" }] }, pending: [], results: [] } } });
  const deskCarriers = [];
  desk.responses.forEach((response, index) => { const before = carriers.length; walk(response.body, `${index}`); deskCarriers.push(...carriers.splice(before)); });
  const payloads = desk.responses.filter(response => response.request.section === "do_kv").flatMap(response => response.body.entries).filter(item => item.payload_identity);
  assert.deepEqual([deskCarriers, payloads.length, payloads.every(item => JSON.stringify(Object.keys(item.payload_identity)) === JSON.stringify(DEFAULT_KEYS))], [[], 5, true], `${label}: Desk payloads`);
  assert.deepEqual(desk.private.pending.filter(item => item.key === "desk:readbacks:record:rb_c1").map(item => [item.status, item.classification]), [["running", "nonterminal"]], `${label}: Desk pending outcome`);
  assert.ok(!desk.private.mapping.entries.some(entry => ["acct-c1d", "gen-c1d"].includes(entry.legacy_key)), `${label}: Desk payload names no option`);
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

// ---------------------------------------------------- R9: U1-U6 identity export completeness
// Every row is its own synthetic fixture, collected through the real route
// (both objects finalized, two equal KV passes, env collected) and assembled
// unmodified. Long values are built at run time.
const SCALAR_LOSS = "identity_scalar_long_string";
const r9Executions = {};
const r9Row = row => { r9Executions[row] = (r9Executions[row] || 0) + 1; };
const RUNTIME_SCOPED = /^(?:runtime:|sql:runtime:|do_kv:runtime:)/;
const DIRECTORY_SCOPED = /^(?:directory:|sql:directory:|do_kv:directory:)/;
const PRE_B2_TABLES = ["account_management_draft", "account_management_applied", "account_management_change", "account_management_requests", "account_mapping_policy"];
const PRE_B2_REASONS = ["runtime", "directory"].flatMap(object => PRE_B2_TABLES.map(table => `${object}:${table}:not_collected`));
// The exact disposition: private reasons, incomplete groups, both objects,
// KV failed reads, and an aggregate-only summary.
const r9Outcome = (label, { responses, private: result, summary }, { reasons = [], incomplete = [], failedReads = 0, needles = [], preB2 = false } = {}) => {
  const allReasons = preB2 ? [...PRE_B2_REASONS, ...reasons] : reasons;
  const allIncomplete = preB2 ? [...new Set([2, 3, 4, ...incomplete])] : incomplete;
  for (const object of ["runtime", "directory"]) {
    assert.ok(responses.some(item => item.request.section === "finalize" && item.request.object === object && item.body?.stable === true), `${label}: ${object} finalized`);
  }
  assert.equal(result.kv.repeated_pass_equal, true, `${label}: two equal KV passes`);
  assert.deepEqual([result.kv.failed_reads.length, summary.kv.failed_reads], [failedReads, failedReads], `${label}: KV failed reads`);
  for (let group = 1; group <= 22; group++) {
    const state = allIncomplete.includes(group) ? "incomplete" : "complete";
    assert.deepEqual([result.groups[group], summary.groups[group]], [state, state], `${label}: group ${group}`);
  }
  const runtime = !allReasons.some(reason => RUNTIME_SCOPED.test(reason));
  const directory = !allReasons.some(reason => DIRECTORY_SCOPED.test(reason));
  assert.deepEqual([result.objects.map(object => object.complete), summary.objects.map(object => object.complete)], [[runtime, directory], [runtime, directory]], `${label}: objects`);
  const status = allReasons.length ? "incomplete" : ENUMERATED;
  assert.deepEqual([[...result.reasons].sort(), result.status, summary.status, summary.reason_count], [[...allReasons].sort(), status, status, allReasons.length],
    `${label}: reasons and overall disposition`);
  summaryAggregatesOnly(summary, label, ["sql:", "do_kv:", "kv:", SCALAR_LOSS, "LLLL", ...needles]);
};
const pairs = result => result.mapping.entries.map(entry => [entry.platform, entry.legacy_key]).sort();
const unattributedKeys = result => result.mapping.unattributed.map(row => row.legacy_key).sort();
const sqlRowsOf = (responses, table) => responses.filter(item => item.request.section === "sql" && item.request.table === table).flatMap(item => item.body.rows);
const doKvEntriesOf = (responses, object = "runtime") => responses.filter(item => item.request.section === "do_kv" && item.request.object === object).flatMap(item => item.body.entries);
const noTruncation = (responses, label) => assert.ok(!JSON.stringify(responses).includes('"truncated":true'), `${label}: no projection flags truncation`);
const DETAIL_TABLE = { statement: `CREATE TABLE IF NOT EXISTS binance_detail_daily (account_key TEXT NOT NULL, binding_id TEXT NOT NULL, observation_date TEXT NOT NULL,
  payload_json TEXT NOT NULL, PRIMARY KEY(account_key, binding_id, observation_date))`, rows: [[]] };
const desk = payload => ({ owner: "owner-r9", expires: 4_102_444_800_000, payload });
const references = (count, prefix, platform = "ibkr") => ({ refs: range(count).map(index => ({ platform, account_key: `${prefix}-${pad(index)}` })) });
const deepReference = (depth, legacyKey) => {
  let node = { platform: "ibkr", account_key: legacyKey };
  for (let level = depth; level >= 1; level--) node = { [`l${level}`]: node };
  return node;
};

// R9-K1: a key shaped like a wallet composite is the literal account in every
// direct-account table; only Binance wallet history is decoded.
{
  const K1 = {
    account_setting_draft: ["ibkr", key => ({ platform: "ibkr", account_key: key, revision: 1, identity_json: "{}", overrides_json: "{}", updated_at: day(1) })],
    account_setting_declaration: ["ibkr", key => ({ platform: "ibkr", account_key: key, revision: 1, identity_json: "{}", declaration_json: "{}" })],
    account_management_draft: ["ibkr", key => ({ platform: "ibkr", account_key: key, revision: 1, identity_json: "{}", membership_json: "[]", management_enabled: 1, base_applied_revision: 0, policy_revision: 1, instance_revision: 1, status: "pending", updated_at: day(1) })],
    account_management_applied: ["ibkr", key => ({ platform: "ibkr", account_key: key, revision: 1, identity_json: "{}", membership_json: "[]", management_enabled: 1, effective_at: day(1) })],
    account_setting_profile_application: ["ibkr", key => ({ request_key: "req-k1", platform: "ibkr", account_key: key, identity_json: "{}", status: "invalidated" })],
    account_management_change: ["ibkr", key => ({ event_id: "evt-k1", platform: "ibkr", account_key: key, initiating_identity_json: "{}", members_json: "[]", policy_revision: 1, instance_revision: 1, draft_revision: 1, old_applied_revision: 0, new_applied_revision: 1, new_management_enabled: 1, result: "applied" })],
    account_management_requests: ["ibkr", key => ({ request_key: "req-mk1", operation: "account_management_apply", platform: "ibkr", account_key: key, identity_json: "{}", receipt_json: "{}" })],
    account_facts_observation: ["ibkr", (key, binding) => ({ platform: "ibkr", account_key: key, payload_json: "{}", source_binding_id: binding })],
    account_facts_daily: ["ibkr", (key, binding) => ({ platform: "ibkr", account_key: key, observation_date: day(0), payload_json: "{}", source_binding_id: binding })],
    account_external_flow: ["ibkr", key => ({ platform: "ibkr", account_key: key })],
    account_executions: ["ibkr", (key, binding) => ({ platform: "ibkr", account_key: key, source_binding_id: binding })],
    account_execution_reports: ["ibkr", (key, binding) => ({ platform: "ibkr", account_key: key, source_binding_id: binding, metadata_json: "{}" })],
    binance_detail_daily: ["binance", (key, binding) => ({ account_key: key, binding_id: binding, observation_date: day(0), payload_json: "{}" })],
    account_diagnosis_tasks: ["ibkr", key => ({ request_id: "diag-k1", platform: "ibkr", account_key: key, status: "succeeded", checks_json: "[]", native_json: "{}" })],
    research_promotion_applications: ["ibkr", key => ({ application_id: "app-k1", platform_id: "ibkr", account_key: key, status: "rejected", readback_json: "{}" })],
    account_period_return: [null, key => ({ account_key: key, payload_json: "{}" })],
    account_daily_native_return: [null, (key, binding) => ({ account_key: key, source_binding_id: binding, currency: "USD", observation_date: day(0), payload_json: "{}" })],
  };
  assert.equal(Object.keys(K1).length, 17, "R9-K1: the seventeen direct-account tables");
  for (const [table, [platform, build]] of Object.entries(K1)) {
    r9Row("R9-K1");
    const label = `R9-K1-literal-table-fence ${table}`;
    const binding = hex(`k1-${table}`), literal = `lit-${table.replace(/_/g, "-")}:${binding}`, prefix = literal.slice(0, -(binding.length + 1));
    const run = await inventoryFull({ sql: [...(table === "binance_detail_daily" ? [DETAIL_TABLE] : []), rows(table, [build(literal, binding)])] });
    const [row] = sqlRowsOf(run.responses, table);
    assert.ok(row && !("logical_account" in row) && (row.pk.includes(literal) || row.columns.account_key === literal), `${label}: projected with its full literal key and no logical-account hint`);
    assert.ok(!pairs(run.private).some(([, legacyKey]) => legacyKey === prefix) && !unattributedKeys(run.private).includes(prefix), `${label}: no decoded-prefix account`);
    if (platform) {
      assert.deepEqual(run.private.mapping.entries.map(entry => [entry.platform, entry.legacy_key, entry.episodes.map(episode => [episode.locator.table, episode.identity.logical_account])]),
        [[platform, literal, [[table, null]]]], `${label}: exactly one mapping, the literal key`);
      assert.deepEqual(run.private.mapping.unattributed, [], `${label}: zero unattributed`);
    } else {
      assert.deepEqual([run.private.mapping.entries, run.private.mapping.unattributed.map(item => [item.legacy_key, item.locator.table])], [[], [[literal, table]]],
        `${label}: zero mappings, one unattributed literal key`);
    }
    r9Outcome(label, run);
  }
}

// R9-K2: a Binance wallet-history row decodes only with its matching stored
// binding; otherwise it is unresolved and names no account.
{
  const daily = (key, binding, payload) => rows("account_facts_daily", [{ platform: "binance", account_key: key, observation_date: day(0), payload_json: JSON.stringify(payload),
    source_binding_id: binding }]);
  for (const [variant, prefix] of [["ordinary-prefix", "bn-k2"], ["colon-prefix", "bn:k2:sub"]]) {
    r9Row("R9-K2");
    const label = `R9-K2-wallet-contract ${variant}`;
    const binding = hex(`k2-${variant}`), stored = `${prefix}:${binding}`;
    const run = await inventoryFull({ sql: [daily(stored, binding, {})] });
    const decoded = { legacy_key: prefix, binding_id: binding, composite: true };
    assert.deepEqual(sqlRowsOf(run.responses, "account_facts_daily")[0].logical_account, decoded, `${label}: the producer decodes the wallet-history row`);
    assert.deepEqual(run.private.mapping.entries.map(entry => [entry.platform, entry.legacy_key, entry.episodes.map(episode => episode.identity)]),
      [["binance", prefix, [{ storage_key: ["binance", stored, day(0)], logical_account: decoded }]]], `${label}: exactly one decoded mapping, full raw key kept`);
    assert.deepEqual(run.private.mapping.unattributed, [], `${label}: zero unattributed`);
    r9Outcome(label, run);
  }
  const unresolved = {
    "malformed-suffix": [`bn-k2m:${"z".repeat(64)}`, hex("k2-m")],
    "nonmatching-binding": [`bn-k2n:${hex("k2-n1")}`, hex("k2-n2")],
    "missing-binding": [`bn-k2x:${hex("k2-x")}`, ""],
  };
  const reason = "runtime:account_facts_daily:wallet_history_identity_unresolved";
  for (const [variant, [stored, binding]] of Object.entries(unresolved)) {
    r9Row("R9-K2");
    const label = `R9-K2-wallet-contract unresolved ${variant}`;
    const run = await inventoryFull({ sql: [daily(stored, binding, { platform: "binance", account_key: `k2-payload-${variant}` })] });
    assert.ok(!("logical_account" in sqlRowsOf(run.responses, "account_facts_daily")[0]), `${label}: no producer hint`);
    const table = run.private.objects[0].tables.account_facts_daily;
    assert.deepEqual([table.rows.map(row => row.pk), table.disposition], [[["binance", stored, day(0)]], "incomplete"], `${label}: raw row retained, table incomplete`);
    assert.deepEqual([pairs(run.private), run.private.mapping.unattributed], [[["binance", `k2-payload-${variant}`]], []],
      `${label}: only the explicit payload reference; no account from the undecidable key`);
    assert.deepEqual(run.private.group_reasons[5], [reason], `${label}: group 5 reason`);
    r9Outcome(label, run, { reasons: [reason], incomplete: [5] });
  }
}

// Frozen exports from the pre-fix producer: its own complete console module
// tree, run once through the real handlers over synthetic stores, both
// objects finalized, two KV passes and the env section. Each export is the
// collection's unedited output; its provenance and checksums are checked here
// offline, and nothing is rebuilt from history.
const FIXTURES = new URL("fixtures/", import.meta.url);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const preFixText = await readFile(new URL("account-identity-inventory-pre-fix.json", FIXTURES), "utf8");
const provenance = JSON.parse(await readFile(new URL("account-identity-inventory-pre-fix.provenance.json", FIXTURES), "utf8"));
assert.equal(sha256(preFixText), provenance.fixture.sha256, "pre-fix fixture: file checksum");
const PRE_FIX = JSON.parse(preFixText).exports;
assert.deepEqual(Object.keys(PRE_FIX), Object.keys(provenance.exports), "pre-fix fixture: every export has provenance, in order");
for (const [id, exported] of Object.entries(PRE_FIX)) {
  assert.equal(sha256(JSON.stringify(exported)), provenance.exports[id].sha256, `pre-fix ${id}: export checksum`);
  assert.deepEqual(Object.keys(exported), ["format", "responses"], `pre-fix ${id}: a complete collection export`);
  assert.equal(exported.format, EXPORT_FORMAT, `pre-fix ${id}: export format`);
}
assert.ok(!preFixText.includes("audit_root_array"), "pre-fix fixture: the earlier producer emits no audit shape field");
assert.notEqual(provenance.producer.modules["application/account_identity_inventory/helpers.js"],
  sha256(await readFile(new URL("application/account_identity_inventory/helpers.js", CONSOLE))), "pre-fix fixture: produced by the earlier helper, not the current one");
// Every scan and cursor token opens under the suite's synthetic session
// secret to scan or page metadata alone.
{
  const subtle = globalThis.crypto.subtle, text = new TextEncoder();
  const base = await subtle.importKey("raw", text.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const key = await subtle.importKey("raw", await subtle.sign("HMAC", base, text.encode(CURSOR_CONTEXT)), { name: "AES-GCM" }, false, ["decrypt"]);
  const bytes = value => Buffer.from(value, "base64url");
  let tokens = 0;
  for (const [id, exported] of Object.entries(PRE_FIX)) {
    for (const { request, body } of exported.responses) {
      for (const token of [request.scan, request.cursor, body?.scan, body?.cursor].filter(item => typeof item === "string")) {
        const [iv, sealed] = token.split(".");
        const opened = JSON.parse(Buffer.from(await subtle.decrypt({ name: "AES-GCM", iv: bytes(iv), additionalData: text.encode(CURSOR_CONTEXT) }, key, bytes(sealed))).toString());
        assert.ok(opened.v === 1 && ["scan", "page"].includes(opened.kind), `pre-fix ${id}: a synthetic sealed ${opened.kind} token`);
        tokens++;
      }
    }
  }
  assert.ok(tokens > 0, "pre-fix fixture: sealed tokens checked");
}

// R9-K3: the earlier producer put a hint on every key ending in `:<64 hex>`.
// Its frozen exports are replayed unedited; the consumer decides from the
// row and never from the hint. The same stores collected now show the
// producers differ by that hint alone.
{
  const binding = "a3".repeat(32);
  const K3 = {
    "literal-observation": ["account_facts_observation", [rows("account_facts_observation", [{ platform: "ibkr", account_key: `lit-k3-obs:${binding}`, payload_json: "{}" }])],
      ["ibkr", `lit-k3-obs:${binding}`], null, "lit-k3-obs"],
    "literal-detail": ["binance_detail_daily", [DETAIL_TABLE, rows("binance_detail_daily", [{ account_key: `lit-k3-det:${binding}`, binding_id: binding, observation_date: day(0), payload_json: "{}" }])],
      ["binance", `lit-k3-det:${binding}`], null, "lit-k3-det"],
    "wallet-daily": ["account_facts_daily", [rows("account_facts_daily", [{ platform: "binance", account_key: `bn-k3:${binding}`, observation_date: day(0), payload_json: "{}",
      source_binding_id: binding }])], ["binance", "bn-k3"], { legacy_key: "bn-k3", binding_id: binding, composite: true }, "bn-k3"],
  };
  const withoutHint = ({ logical_account: _, ...row }) => row;
  for (const [variant, [table, sql, expected, logical, hinted]] of Object.entries(K3)) {
    r9Row("R9-K3");
    const label = `R9-K3-old-export-replay ${variant}`;
    const id = `k3/${variant}`;
    assert.equal(provenance.exports[id].row, "R9-K3", `${label}: provenance category`);
    const replay = PRE_FIX[id];
    const old = sqlRowsOf(replay.responses, table)[0];
    assert.deepEqual(old.logical_account, { legacy_key: hinted, binding_id: binding, composite: true }, `${label}: the old export carries its unconditional hint`);
    const current = sqlRowsOf((await inventoryFull({ sql })).responses, table)[0];
    assert.deepEqual(withoutHint(old), withoutHint(current), `${label}: the old and current producers export the same row apart from the hint`);
    assert.ok(logical ? isDeepStrictEqual(current.logical_account, logical) : !("logical_account" in current), `${label}: the hint differs from the fenced producer only on literal rows`);
    const assembled = assemble(structuredClone(replay));
    assert.deepEqual([pairs(assembled.private), assembled.private.mapping.unattributed], [[expected], []], `${label}: exactly one correct mapping`);
    assert.deepEqual(assembled.private.mapping.entries[0].episodes.map(episode => episode.identity.logical_account), [logical], `${label}: the hint is validated against the row`);
    r9Outcome(label, { responses: replay.responses, ...assembled }, { preB2: true });
  }
}

// R9-D1/D2: a Desk payload identity cut at its 128-field or depth bound.
{
  const reason = "runtime:do_kv:payload_identity_truncated";
  const deskRun = async (label, payload, { fields, truncated, mapped, prefix }) => {
    const run = await inventoryFull({ doKv: { "desk:readbacks:record:rb_r9": desk(payload) } });
    const [entry] = doKvEntriesOf(run.responses);
    assert.deepEqual([Object.keys(entry.payload_identity.fields).length, entry.payload_identity.truncated], [fields, truncated], `${label}: projected payload fields`);
    assert.equal(run.private.mapping.entries.filter(item => item.legacy_key.startsWith(prefix)).length, mapped, `${label}: mapped references`);
    assert.deepEqual([run.private.group_reasons[15], run.private.objects[0].do_kv.disposition], truncated ? [[reason], "incomplete"] : [undefined, "complete"], `${label}: DO-KV disposition`);
    r9Outcome(label, run, truncated ? { reasons: [reason], incomplete: [15] } : {});
  };
  for (const [count, truncated] of [[64, false], [65, true], [70, true]]) {
    r9Row("R9-D1");
    const payload = references(count, "d1");
    assert.equal(payload.refs.reduce((total, item) => total + Object.keys(item).length, 0), count * 2, `R9-D1 ${count}: input fields`);
    await deskRun(`R9-D1-desk-fields ${count}`, payload, { fields: 128, truncated, mapped: 64, prefix: "d1-" });
  }
  for (const [depth, fields, mapped] of [[8, 2, 1], [9, 0, 0]]) {
    r9Row("R9-D2");
    await deskRun(`R9-D2-desk-depth ${depth}`, deepReference(depth, "d2-deep"), { fields, truncated: depth === 9, mapped, prefix: "d2-" });
  }
}

// R9-D3: a value whose projection failed, and a duplicated key.
{
  r9Row("R9-D3");
  const label = "R9-D3-desk-error-and-duplicate value-projection-failed";
  const key = "desk:readbacks:record:rb_d3";
  const run = await inventoryFull({ doKv: { [key]: desk({ platform: "ibkr", account_key: "d3-unread" }) }, faults: { doKvPayload: [key] } });
  assert.deepEqual(doKvEntriesOf(run.responses), [{ key, projection_error: "value_projection_failed" }], `${label}: one retained failed entry`);
  assert.deepEqual([run.private.mapping.entries, run.private.mapping.unattributed], [[], []], `${label}: zero account mappings`);
  assert.deepEqual(run.private.pending.map(item => [item.family, item.key, item.status, item.classification]), [["do_kv_unprojected", key, "unreadable:value_projection_failed", "unknown"]],
    `${label}: one unknown pending record`);
  const reason = "runtime:do_kv:value_projection_failed";
  assert.deepEqual([run.private.group_reasons[15], run.private.objects[0].do_kv.disposition], [[reason], "incomplete"], `${label}: DO-KV disposition`);
  r9Outcome(label, run, { reasons: [reason], incomplete: [15] });
}
{
  // The reader never lists a key twice in one chain. A collection that retried
  // under the same scan at another page size can still export one: page 1 of
  // the first chain and pages 2-3 of the retry, each a genuine response.
  r9Row("R9-D3");
  const label = "R9-D3-desk-error-and-duplicate duplicated-key";
  const doKv = Object.fromEntries(["a", "b", "c"].map(name => [`desk:idempotency:${name}`, { state: "complete", request_id: `idem-${name}` }]));
  const h = await harness({ runtime: { sql: [], kv: doKv, alarm: null, initialize: false }, directory: { sql: [], kv: {}, alarm: null, initialize: false },
    kv: fakeKv({}), extraEnv: { ACCOUNT_IDENTITY_INVENTORY_KV_ENABLED: "true", ACCOUNT_IDENTITY_INVENTORY_ENV_ENABLED: "true" } });
  const first = [];
  const { schema } = await collect(h.get, "runtime", { pageSize: 2, responses: first });
  const retry = [];
  let page = await h.get(`${ROUTE}?${new URLSearchParams({ section: "do_kv", object: "runtime", page_size: "1", scan: schema.scan })}`);
  retry.push({ request: { section: "do_kv", object: "runtime" }, status: page.status, body: page.body });
  while (page.status === 200 && page.body.cursor) {
    page = await h.get(`${ROUTE}?${new URLSearchParams({ section: "do_kv", object: "runtime", page_size: "1", cursor: page.body.cursor })}`);
    retry.push({ request: { section: "do_kv", object: "runtime" }, status: page.status, body: page.body });
  }
  const chained = [first.find(item => item.request.section === "do_kv"), ...retry.slice(1)];
  assert.deepEqual(chained.map(item => [item.body.page, item.body.terminal, item.body.entries.map(entry => entry.key.slice(-1))]),
    [[1, false, ["a", "b"]], [2, false, ["b"]], [3, true, ["c"]]], `${label}: the exported chain lists b twice`);
  const responses = [...first.filter(item => item.request.section !== "do_kv"), ...chained];
  await collect(h.get, "directory", { responses });
  await collectKv(h.get, responses);
  await collectKv(h.get, responses);
  const envPage = await h.get(`${ROUTE}?section=env`);
  responses.push({ request: { section: "env" }, status: envPage.status, body: envPage.body });
  assert.deepEqual(violations, [], `${label}: no trap fired`);
  await h.unchanged();
  await h.close();
  const assembled = assemble({ format: EXPORT_FORMAT, responses });
  const reason = "runtime:do_kv:duplicate_key";
  assert.deepEqual([assembled.private.objects[0].do_kv.entries.length, assembled.private.group_reasons[15], assembled.private.objects[0].do_kv.disposition], [4, [reason], "incomplete"],
    `${label}: duplicate reason kept, DO-KV result incomplete`);
  r9Outcome(label, { responses, ...assembled }, { reasons: [reason], incomplete: [15] });
}

// R9-D4: source-quality flags are not projection loss.
{
  const written = await deskRecords();
  const snapshot = Object.entries(written).find(([name, record]) => name.startsWith("desk:readbacks:record:") && !("state" in record.payload) && record.payload.overall === "unknown");
  const D4 = {
    "completed-snapshot-overall-unknown": [{ doKv: Object.fromEntries([snapshot]) }, "runtime", entry => entry.record_kind === "snapshot" && entry.payload_identity.truncated === false],
    "directory-state-incomplete-with-error": [{ directoryDoKv: { "console-kv-directory-v1": { complete: false, keys: ["a"], cursor: "c-1", error: "list_failed",
      last_error: { code: "kv_list_failed" }, scanned_at: day(1) } } }, "directory", entry => entry.family === "kv_directory_state" && entry.complete === false && entry.error === "list_failed"],
    "current-strategies-write-state": [{ directoryDoKv: { "console-current-strategies-write-v1": { ts: 1, signature: "sig-d4" } } }, "directory",
      entry => entry.family === "current_strategies_write_state" && entry.signature_present === true],
  };
  for (const [variant, [fixture, object, check]] of Object.entries(D4)) {
    r9Row("R9-D4");
    const label = `R9-D4-source-quality-controls ${variant}`;
    const run = await inventoryFull(fixture);
    const entries = doKvEntriesOf(run.responses, object);
    assert.ok(entries.length === 1 && check(entries[0]), `${label}: the source flag is exported`);
    assert.deepEqual([run.private.mapping.entries, run.private.mapping.unattributed, run.private.pending], [[], [], []], `${label}: no invented account, no pending operation`);
    r9Outcome(label, run);
  }
}

// R9-S1: each of the 33 generic SQL JSON columns at 128 and 129 references.
{
  const S1_COLUMNS = Object.values(INVENTORY_TABLES).flatMap(spec => spec.json.map(column => `${spec.name}.${column}`));
  assert.deepEqual(S1_COLUMNS, ["account_setting_draft.identity_json", "account_setting_declaration.identity_json",
    "account_management_draft.identity_json", "account_management_draft.membership_json", "account_management_applied.identity_json",
    "account_management_applied.membership_json", "account_setting_profile_application.identity_json",
    "account_management_change.initiating_identity_json", "account_management_change.members_json",
    "account_management_requests.identity_json", "account_management_requests.receipt_json", "risk_profile_authority.bindings_json",
    "account_mapping_policy.policy_json", "account_facts_observation.payload_json", "account_facts_daily.payload_json", "account_period_return.payload_json",
    "account_external_flow.context_json", "account_external_flow.payload_json", "account_executions.context_json", "account_executions.payload_json",
    "account_execution_reports.context_json", "account_diagnosis_tasks.native_json", "research_promotion_applications.readback_json",
    "human_decision_material.summary_json", "human_decision_record.target_json", "human_decision_record.payload_json", "human_decision_source_material.summary_json",
    "hk_stop_request.identity_json", "hk_stop_request.result_json", "ux1_research_slot.job_json", "runtime_cycle_health_checkpoint.payload_json",
    "runtime_cycle_health_incident.resolution_history_json", "credential_rotation_operations.record"], "R9-S1: the 33 generic JSON columns");
  const PK = "pk-s1";
  const BASE = {
    account_setting_draft: { platform: "ibkr", account_key: PK },
    account_setting_declaration: { platform: "ibkr", account_key: PK, declaration_json: "{}" },
    account_management_draft: { platform: "ibkr", account_key: PK, revision: 1, management_enabled: 1, base_applied_revision: 0, policy_revision: 1, instance_revision: 1, status: "pending" },
    account_management_applied: { platform: "ibkr", account_key: PK, revision: 1, management_enabled: 1 },
    account_setting_profile_application: { request_key: "req-s1", platform: "ibkr", account_key: PK, status: "invalidated" },
    account_management_change: { event_id: "evt-s1", platform: "ibkr", account_key: PK, policy_revision: 1, instance_revision: 1, draft_revision: 1, old_applied_revision: 0, new_applied_revision: 1, new_management_enabled: 1, result: "applied" },
    account_management_requests: { request_key: "req-ms1", operation: "account_management_apply", platform: "ibkr", account_key: PK },
    risk_profile_authority: { id: 1, revision: 1, imported: 1 },
    account_mapping_policy: { id: 1, policy_revision: 1 },
    account_facts_observation: { platform: "ibkr", account_key: PK },
    account_facts_daily: { platform: "ibkr", account_key: PK, observation_date: day(0) },
    account_period_return: { account_key: PK },
    account_external_flow: { platform: "ibkr", account_key: PK },
    account_executions: { platform: "ibkr", account_key: PK, source_binding_id: "src-s1" },
    account_execution_reports: { platform: "ibkr", account_key: PK, source_binding_id: "src-s1", metadata_json: "{}" },
    account_diagnosis_tasks: { request_id: "diag-s1", platform: "ibkr", account_key: PK, status: "succeeded", checks_json: "[]" },
    research_promotion_applications: { application_id: "app-s1", platform_id: "ibkr", account_key: PK, status: "rejected" },
    human_decision_material: { kind: "owner", subject_id: "subject-s1" },
    human_decision_record: { request_key: "dec-s1", kind: "owner", subject_id: "subject-s1" },
    human_decision_source_material: { kind: "owner", subject_id: "subject-s1", source_id: "source-s1" },
    hk_stop_request: { request_id: "stop-s1", target_id: "target-s1", source_revision: 1, phase: "applied" },
    ux1_research_slot: { login: "login-s1", revision: 1, draft_json: "{}" },
    runtime_cycle_health_checkpoint: { target_id: "target-s1", binding_fingerprint: "fp-s1", revision: 1 },
    runtime_cycle_health_incident: { target_id: "target-s1", binding_fingerprint: "fp-s1", source_id: "source-s1", cycle_id: "cycle-s1", cycle_json: "{}" },
    credential_rotation_operations: { operation_id: "op-s1" },
  };
  const BASELINE = new Set(["account_setting_draft", "account_setting_declaration", "account_management_draft", "account_management_applied",
    "account_setting_profile_application", "account_management_change", "account_management_requests", "account_facts_observation", "account_facts_daily",
    "account_external_flow", "account_executions", "account_execution_reports", "account_diagnosis_tasks", "research_promotion_applications"]);
  for (const name of S1_COLUMNS) {
    const [table, column] = name.split(".");
    for (const count of [128, 129]) {
      r9Row("R9-S1");
      const label = `R9-S1-all-JSON-columns ${name} ${count}`;
      const value = references(count, "s1");
      assert.equal(value.refs.reduce((total, item) => total + Object.keys(item).length, 0), count * 2, `${label}: input fields`);
      const run = await inventoryFull({ sql: [rows(table, [{ ...BASE[table], [column]: JSON.stringify(value) }])] });
      const [row] = sqlRowsOf(run.responses, table);
      assert.deepEqual([row.projection_error, Object.keys(row.columns[column].fields).length, row.columns[column].truncated], [undefined, 256, count === 129], `${label}: the real projected column`);
      const episodes = run.private.mapping.entries.flatMap(entry => entry.episodes.filter(episode => episode.locator.column === column && entry.legacy_key.startsWith("s1-")));
      const b = BASELINE.has(table) ? 1 : 0;
      assert.deepEqual([episodes.length, run.private.mapping.entries.length, unattributedKeys(run.private)], [128, 128 + b, table === "account_period_return" ? [PK] : []],
        `${label}: 128 reference episodes, baseline ${b}`);
      assert.deepEqual([run.private.objects[0].tables[table].failed_rows, run.summary.objects[0].failed_rows, run.private.objects[0].tables[table].disposition],
        [0, 0, count === 129 ? "incomplete" : "complete"], `${label}: no failed row; table disposition`);
      r9Outcome(label, run, count === 129 ? { reasons: [`runtime:${table}:${column}:identity_projection_truncated`], incomplete: [INVENTORY_TABLES[table].group] } : {});
    }
  }
}

// R9-S2: one generic SQL column at the depth bound and beyond it.
for (const [depth, fields, mapped] of [[8, 2, 1], [9, 0, 0]]) {
  r9Row("R9-S2");
  const label = `R9-S2-SQL-depth ${depth}`;
  const run = await inventoryFull({ sql: [rows("risk_profile_authority", [{ id: 1, revision: 1, imported: 1, bindings_json: JSON.stringify(deepReference(depth, "s2-deep")) }])] });
  const projection = sqlRowsOf(run.responses, "risk_profile_authority")[0].columns.bindings_json;
  assert.deepEqual([Object.keys(projection.fields).length, projection.truncated, pairs(run.private).length, run.summary.objects[0].failed_rows], [fields, depth === 9, mapped, 0],
    `${label}: projection, mapping and failed rows`);
  r9Outcome(label, run, depth === 9 ? { reasons: ["runtime:risk_profile_authority:bindings_json:identity_projection_truncated"], incomplete: [4] } : {});
}

// R9-S3: a row whose identity projection was not exported.
{
  const oversized = range(256).reduce((item, index) => ({ ...item, [`${"k".repeat(1200)}${index}`]: { status: "y" } }), {});
  const S3 = {
    "byte-oversize": [{ ...oversized, ref: { platform: "ibkr", account_key: "s3-unread" } }, {}, "row_projection_too_large"],
    // Named fault: the stored row's payload_json accessor throws inside the reader.
    "injected-row-accessor-fault": [{ ref: { platform: "ibkr", account_key: "s3-unread" } }, { sqlColumn: { table: "account_facts_observation", column: "payload_json" } }, "row_projection_failed"],
  };
  for (const [variant, [payload, faults, error]] of Object.entries(S3)) {
    r9Row("R9-S3");
    const label = `R9-S3-SQL-failed-row ${variant}`;
    const run = await inventoryFull({ sql: [rows("account_facts_observation", [{ platform: "ibkr", account_key: "s3-pk", payload_json: JSON.stringify(payload) }])], faults });
    assert.deepEqual(sqlRowsOf(run.responses, "account_facts_observation"), [{ pk: ["ibkr", "s3-pk"], projection_error: error }], `${label}: the reader's failure export`);
    const table = run.private.objects[0].tables.account_facts_observation;
    assert.deepEqual([table.rows.length, table.failed_rows, run.summary.objects[0].failed_rows, table.disposition], [1, 1, 1, "incomplete"], `${label}: one retained PK row, one failed row`);
    assert.deepEqual([pairs(run.private), run.private.mapping.unattributed], [[["ibkr", "s3-pk"]], []],`${label}: the direct key survives; the unread reference is not invented`);
    r9Outcome(label, run, { reasons: [`runtime:account_facts_observation:${error}`], incomplete: [5] });
  }
}

// R9-S4: nested pagination is not truncation.
for (const count of [100, 101]) {
  r9Row("R9-S4");
  const label = `R9-S4-nested-continuation ${count}`;
  const instances = range(count).map(index => ({ platform: "ibkr", key: `s4-${pad(index)}`, kind: "existing", config: { key: `s4-${pad(index)}` } }));
  const run = await inventoryFull({ sql: [rows("instance_state", [{ id: 1, revision: 1, payload: JSON.stringify(instances) }])] });
  const pages = run.responses.filter(item => item.request.section === "sql" && item.request.table === "instance_state");
  const payload = run.private.objects[0].tables.instance_state.rows[0].columns.payload;
  assert.deepEqual([pages.length, pages.filter(item => item.body.nested_continuation).length, pages.at(-1).body.terminal, payload.entry_count, payload.entries.length],
    [count === 100 ? 1 : 2, count === 100 ? 0 : 1, true, count, count], `${label}: nested page segments and completed continuation`);
  assert.equal(pairs(run.private).length, count, `${label}: every instance mapped`);
  r9Outcome(label, run);
}

// R9-S5: qualified source states are observations, not projection loss.
{
  const S5 = {
    "invalid-json": [{ sql: [rows("risk_profile_authority", [{ id: 1, revision: 1, imported: 1, bindings_json: "{bad" }])] }, "risk_profile_authority",
      columns => columns.bindings_json.state === "invalid_json", []],
    "nontext-json": [{ sql: [rows("risk_profile_authority", [{ id: 1, revision: 1, imported: 1, bindings_json: new Uint8Array([1, 2, 3]) }])] }, "risk_profile_authority",
      columns => columns.bindings_json.state === "non_text" && columns.bindings_json.type.blob_bytes === 3, []],
    "absent-legacy-column": [{ initialize: false, sql: [{ statement: OLD_SCHEMA[1], rows: [[]] },
      { statement: "INSERT INTO account_diagnosis_tasks VALUES (?, ?, ?, ?)", rows: [["diag-s5", "ibkr", "s5-acct", "succeeded"]] }] }, "account_diagnosis_tasks",
      columns => columns.native_json.column_absent === true, [["ibkr", "s5-acct"]]],
    "unexpected-instance-shape": [{ sql: [rows("instance_state", [{ id: 1, revision: 1, payload: "{}" }])] }, "instance_state",
      columns => columns.payload.state === "unexpected_shape", []],
  };
  for (const [variant, [fixture, table, check, expected]] of Object.entries(S5)) {
    r9Row("R9-S5");
    const label = `R9-S5-qualified-source-states ${variant}`;
    const run = await inventoryFull(fixture);
    assert.ok(check(sqlRowsOf(run.responses, table)[0].columns), `${label}: the qualified source state is exported`);
    assert.deepEqual([pairs(run.private), run.private.mapping.unattributed, run.private.objects[0].tables[table].disposition], [expected, [], "complete"], `${label}: no invented account`);
    r9Outcome(label, run);
  }
}

// R9-A1..A3: the two account-settings audit actions name their account by
// the entry's own `key` and `platform`.
{
  const auditRun = entries => inventoryFull({ kvValues: { audit_log: JSON.stringify(entries) } });
  const located = (result, legacyKey) => [
    ...result.mapping.entries.filter(entry => entry.legacy_key === legacyKey).flatMap(entry => entry.episodes.map(episode => [entry.platform, episode.state, episode.locator.path])),
    ...result.mapping.unattributed.filter(row => row.legacy_key === legacyKey).map(row => [null, "unattributed", row.locator.path])];
  for (const action of ["save_account_settings", "approve_account_settings_profile_application"]) {
    for (const withPlatform of [true, false]) {
      r9Row("R9-A1");
      const label = `R9-A1-audit-actions ${action} ${withPlatform ? "platform" : "no-platform"}`;
      const legacyKey = `a1-${action.slice(0, 4)}-${withPlatform ? "p" : "u"}`;
      const run = await auditRun([{ login: "fixture-admin", action: "update", ts: 1 }, { login: "fixture-admin", action, ...(withPlatform ? { platform: "ibkr" } : {}), key: legacyKey, ts: 2 }]);
      assert.deepEqual(located(run.private, legacyKey), [withPlatform ? ["ibkr", "kv_reference", "[1].key"] : [null, "unattributed", "[1].key"]], `${label}: one located account`);
      assert.deepEqual([pairs(run.private).length, run.private.mapping.unattributed.length], withPlatform ? [1, 0] : [0, 1], `${label}: one direct account field`);
      r9Outcome(label, run);
    }
  }
  const explicit = { action: "update", platform: "ibkr", account_key: "a2-explicit" };
  const A2 = {
    "unrecognized-action": { audit_log: [{ action: "update", platform: "ibkr", key: "a2-key" }, explicit] },
    "missing-action": { audit_log: [{ platform: "ibkr", key: "a2-key" }, explicit] },
    "key-nested-in-recognized-entry": { audit_log: [{ action: "save_account_settings", details: { platform: "ibkr", key: "a2-key" } }, explicit] },
    "non-audit-family": { risk_profile_bindings: [{ action: "save_account_settings", platform: "ibkr", key: "a2-key" }, explicit] },
  };
  for (const [variant, values] of Object.entries(A2)) {
    r9Row("R9-A2");
    const label = `R9-A2-audit-isolation ${variant}`;
    const run = await inventoryFull({ kvValues: Object.fromEntries(Object.entries(values).map(([name, item]) => [name, JSON.stringify(item)])) });
    assert.deepEqual([located(run.private, "a2-key"), located(run.private, "a2-explicit")], [[], [["ibkr", "kv_reference", "[1].account_key"]]],
      `${label}: no account from the key; the explicit field stays recognized`);
    assert.deepEqual([pairs(run.private).length, run.private.mapping.unattributed], [1, []], `${label}: nothing else`);
    r9Outcome(label, run);
  }
  {
    r9Row("R9-A3");
    const label = "R9-A3-audit-multiplicity same-account";
    const run = await auditRun([{ action: "save_account_settings", platform: "ibkr", key: "a3-same" }, { action: "approve_account_settings_profile_application", platform: "ibkr", key: "a3-same" }]);
    assert.equal(exportedKv(run.responses, "audit_log").state, "exported");
    assert.deepEqual([pairs(run.private), located(run.private, "a3-same")], [[["ibkr", "a3-same"]], [["ibkr", "kv_reference", "[0].key"], ["ibkr", "kv_reference", "[1].key"]]],
      `${label}: one mapping, two source-path episodes, none repeated across passes`);
    r9Outcome(label, run);
  }
  {
    r9Row("R9-A3");
    const label = "R9-A3-audit-multiplicity sibling-platform";
    const run = await auditRun([{ action: "save_account_settings", key: "a3-lone" }, { action: "update", platform: "ibkr" }]);
    assert.deepEqual([pairs(run.private), run.private.mapping.unattributed.map(row => [row.legacy_key, row.locator.path, row.candidate_platforms])], [[], [["a3-lone", "[0].key", []]]],
      `${label}: no borrowed platform, one unattributed key`);
    r9Outcome(label, run);
  }
}

// R9-P1..P3: a promotion decision names its account by the root
// selected_account object of target_json and of payload_json.
{
  const decision = (kind, target, payload) => ({ sql: [rows("human_decision_record", [{ request_key: "dec-r9", kind, subject_id: "ticket-r9", material_key: "material-r9",
    action: "approve", actor: "fixture-admin", decided_at: day(1), target_json: JSON.stringify(target), payload_json: JSON.stringify(payload) }])] });
  const selected = legacyKey => ({ selected_account: { platform: "ibkr", key: legacyKey } });
  const episodes = (result, legacyKey) => result.mapping.entries.filter(entry => entry.legacy_key === legacyKey)
    .flatMap(entry => entry.episodes.map(episode => [entry.platform, episode.state, episode.locator]));
  const locator = column => ({ object: "runtime", table: "human_decision_record", pk: ["dec-r9"], column, path: "selected_account.key" });
  const P1 = { "target-only": [selected("p1-acct"), {}, ["target_json"]], "payload-only": [{}, selected("p1-acct"), ["payload_json"]],
    both: [selected("p1-acct"), selected("p1-acct"), ["target_json", "payload_json"]] };
  for (const [variant, [target, payload, columns]] of Object.entries(P1)) {
    r9Row("R9-P1");
    const label = `R9-P1-promotion-selection ${variant}`;
    const run = await inventoryFull(decision("promotion", target, payload));
    assert.deepEqual([pairs(run.private), episodes(run.private, "p1-acct"), run.private.mapping.unattributed],
      [[["ibkr", "p1-acct"]], columns.map(column => ["ibkr", "store_reference", locator(column)]), []], `${label}: one mapping, one episode per column`);
    r9Outcome(label, run);
  }
  const P2 = {
    "wrong-kind": decision("owner", selected("p2-key"), selected("p2-key")),
    "nested-ticket-and-params": decision("promotion", { ticket: selected("p2-key"), proposed_params: { platform: "ibkr", key: "p2-key" } }, { ticket: selected("p2-key") }),
    "selected-account-null": decision("promotion", { selected_account: null }, { selected_account: null }),
    "generic-id-only": decision("promotion", { id: "p2-key", candidate_id: "p2-key", items: [{ id: "p2-key" }] }, { ticket_id: "p2-key" }),
    "kv-ticket-key": { kvValues: { "research_promotion_ticket:t-p2": JSON.stringify({ ticket_id: "t-p2", state: "awaiting_human", selected_account: { platform: "ibkr", key: "p2-key" } }) } },
  };
  for (const [variant, fixture] of Object.entries(P2)) {
    r9Row("R9-P2");
    const label = `R9-P2-promotion-isolation ${variant}`;
    const run = await inventoryFull(fixture);
    assert.deepEqual([pairs(run.private), run.private.mapping.unattributed], [[], []], `${label}: no promoted account identity`);
    r9Outcome(label, run);
  }
  {
    r9Row("R9-P3");
    const label = "R9-P3-promotion-conflicting-references";
    const run = await inventoryFull(decision("promotion", selected("p3-target"), selected("p3-payload")));
    assert.deepEqual([pairs(run.private), episodes(run.private, "p3-target"), episodes(run.private, "p3-payload")],
      [[["ibkr", "p3-payload"], ["ibkr", "p3-target"]], [["ibkr", "store_reference", locator("target_json")]], [["ibkr", "store_reference", locator("payload_json")]]],
      `${label}: both selections kept as separate episodes`);
    assert.ok(run.private.mapping.entries.every(entry => !entry.states.includes("current")), `${label}: no inferred current account`);
    r9Outcome(label, run);
  }
}

// R9-L1: a selected identity scalar at the 512-character bound and beyond.
{
  const SURVIVOR = { account_options: JSON.stringify({ ibkr: [{ key: "l1-survivor" }] }) };
  const sqlRow = (table, item) => ({ sql: [rows(table, [item])] });
  const instance = item => ({ platform: "ibkr", key: item, kind: "existing", config: { key: item } });
  const history = (side, item) => sqlRow("instance_history", { revision: 1, entry: JSON.stringify({ revision: 1, ts: day(1), action: "update", login: "fixture-admin",
    before: side === "before" ? instance(item) : null, after: side === "after" ? instance(item) : null }) });
  const column = (table, read) => responses => read(sqlRowsOf(responses, table)[0].columns);
  const L1 = [
    ["current-instance-key", item => sqlRow("instance_state", { id: 1, revision: 1, payload: JSON.stringify([instance(item)]) }),
      column("instance_state", columns => columns.payload.entries[0].key), "sql:runtime:instance_state:0:payload.entries[0].key", 1, "ibkr"],
    ["history-before-key", item => history("before", item), column("instance_history", columns => columns.entry.before.key), "sql:runtime:instance_history:0:entry.before.key", 1, "ibkr"],
    ["history-after-key", item => history("after", item), column("instance_history", columns => columns.entry.after.key), "sql:runtime:instance_history:0:entry.after.key", 1, "ibkr"],
    ["profile-application-account-key", item => sqlRow("account_setting_profile_application", { request_key: "req-l1", platform: "ibkr", account_key: item, identity_json: "{}",
      status: "invalidated" }), column("account_setting_profile_application", columns => columns.account_key), "sql:runtime:account_setting_profile_application:0:account_key", 3, "ibkr"],
    ["diagnosis-account-key", item => sqlRow("account_diagnosis_tasks", { request_id: "diag-l1", platform: "ibkr", account_key: item, status: "succeeded", checks_json: "[]",
      native_json: "{}" }), column("account_diagnosis_tasks", columns => columns.account_key), "sql:runtime:account_diagnosis_tasks:0:account_key", 10, "ibkr"],
    ["promotion-application-account-key", item => sqlRow("research_promotion_applications", { application_id: "app-l1", platform_id: "ibkr", account_key: item, status: "rejected",
      readback_json: "{}" }), column("research_promotion_applications", columns => columns.account_key), "sql:runtime:research_promotion_applications:0:account_key", 11, "ibkr"],
    ["hk-stop-identity-key", item => sqlRow("hk_stop_request", { request_id: "stop-l1", target_id: "target-l1", identity_json: JSON.stringify({ platform: "ibkr", key: item }),
      source_revision: 1, phase: "applied", result_json: "{}" }), column("hk_stop_request", columns => columns.identity_json.fields.key), "sql:runtime:hk_stop_request:0:identity_json.key", 13, "ibkr"],
    ["generic-sql-account-key", item => sqlRow("risk_profile_authority", { id: 1, revision: 1, imported: 1, bindings_json: JSON.stringify({ platform: "ibkr", account_key: item }) }),
      column("risk_profile_authority", columns => columns.bindings_json.fields.account_key), "sql:runtime:risk_profile_authority:0:bindings_json.account_key", 4, "ibkr"],
    ["desk-payload-account-key", item => ({ doKv: { "desk:readbacks:record:rb_l1": desk({ platform: "ibkr", account_key: item }) } }),
      responses => doKvEntriesOf(responses)[0].payload_identity.fields.account_key, "do_kv:runtime:0:payload_identity:account_key", 15, "ibkr"],
    ["generic-kv-account-key", item => ({ kvValues: { risk_profile_bindings: JSON.stringify({ platform: "ibkr", account_key: item }) } }),
      responses => exportedKv(responses, "risk_profile_bindings").identity.fields.account_key, "kv:risk_profile_bindings:account_key", 20, "ibkr"],
    ["binance-env-binding-account-key", item => ({ envValues: { BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify({ platform: "binance", account_key: item }) } }),
      responses => exportedEnv(responses, "BINANCE_ACCOUNT_FACTS_BINDING_JSON").identity.fields.account_key, "env:BINANCE_ACCOUNT_FACTS_BINDING_JSON:account_key", 16, "binance"],
    ["binance-env-history-account-key", item => ({ envValues: { BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON: JSON.stringify([{ platform: "binance", account_key: item }]) } }),
      responses => exportedEnv(responses, "BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON").identity.fields["[0].account_key"],
      "env:BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON:[0].account_key", 16, "binance"],
  ];
  assert.equal(L1.length, 12, "R9-L1: twelve selected locations");
  for (const [name, fixture, projected, path, group, platform] of L1) {
    for (const length of [LONG_STRING, LONG_STRING + 1]) {
      r9Row("R9-L1");
      const label = `R9-L1-scalar-boundaries ${name} ${length}`;
      const item = long(length), extra = fixture(item);
      const run = await inventoryFull({ ...extra, kvValues: { ...SURVIVOR, ...extra.kvValues } });
      noTruncation(run.responses, label);
      if (length === LONG_STRING) {
        assert.equal(projected(run.responses), item, `${label}: the full value is exported`);
        assert.deepEqual([pairs(run.private), run.private.mapping.unattributed], [[["ibkr", "l1-survivor"], [platform, item]].sort(), []], `${label}: tested reference and survivor`);
        r9Outcome(label, run);
        continue;
      }
      assert.deepEqual(projected(run.responses), { long_string: length }, `${label}: one direct marker`);
      assert.deepEqual([pairs(run.private), run.private.mapping.unattributed], [[["ibkr", "l1-survivor"]], []], `${label}: the survivor only, no substitute account`);
      r9Outcome(label, run, { reasons: [`${path}:${SCALAR_LOSS}`], incomplete: [group] });
    }
  }
}

// R9-L2: a lost platform or mapping-tuple qualifier.
{
  const lost = long(LONG_STRING + 1);
  {
    r9Row("R9-L2");
    const label = "R9-L2-platform-and-qualifiers selected-platform";
    const run = await inventoryFull({ kvValues: { risk_profile_bindings: JSON.stringify({ platform: "ibkr", inner: { platform: lost, account_key: "l2-key" } }) } });
    assert.deepEqual([pairs(run.private), run.private.mapping.unattributed.map(row => [row.legacy_key, row.locator.path, row.candidate_platforms])], [[], [["l2-key", "inner.account_key", []]]],
      `${label}: the key stays unattributed; no ancestor platform`);
    r9Outcome(label, run, { reasons: [`kv:risk_profile_bindings:inner.platform:${SCALAR_LOSS}`], incomplete: [20] });
  }
  const current = selector => rows("instance_state", [{ id: 1, revision: 1, payload: JSON.stringify([{ platform: "ibkr", key: "l2-acct", kind: "existing",
    config: { key: "l2-acct", account_selector: selector } }]) }]);
  const draft = selector => rows("account_setting_draft", [{ platform: "ibkr", account_key: "l2-acct", revision: 1,
    identity_json: JSON.stringify({ platform: "ibkr", key: "l2-acct", account_selector: selector }), overrides_json: "{}", updated_at: day(1) }]);
  const tuple = [
    ["current-instance-account-selector", [current(lost), draft("sel-l2")], `sql:runtime:instance_state:0:payload.entries[0].config.account_selector:${SCALAR_LOSS}`, 1],
    ["stored-identity-account-selector", [current("sel-l2"), draft(lost)], `sql:runtime:account_setting_draft:0:identity_json.account_selector:${SCALAR_LOSS}`, 2],
  ];
  for (const [variant, sql, reason, group] of tuple) {
    r9Row("R9-L2");
    const label = `R9-L2-platform-and-qualifiers ${variant}`;
    const run = await inventoryFull({ sql });
    const [entry] = run.private.mapping.entries;
    assert.deepEqual([pairs(run.private), run.private.mapping.conflicts], [[["ibkr", "l2-acct"]], []], `${label}: one account mapping, no asserted comparison`);
    const live = entry.episodes.find(episode => episode.state === "current"), stored = entry.episodes.find(episode => episode.identity.stored_identity);
    assert.deepEqual([stored.identity.stored_identity_matches_current, stored.identity.stored_identity_unreadable_fields], [null, ["account_selector"]], `${label}: the comparison is unreadable`);
    if (group === 1) {
      assert.deepEqual([live.identity.settings_identity.account_selector, live.identity.settings_identity_qualification], [{ long_string: LONG_STRING + 1 }, SCALAR_LOSS], `${label}: the marker is kept`);
    } else assert.deepEqual(stored.identity.stored_identity.account_selector, { long_string: LONG_STRING + 1 }, `${label}: the marker is kept`);
    r9Outcome(label, run, { reasons: [reason], incomplete: [group] });
  }
  {
    r9Row("R9-L2");
    const label = "R9-L2-platform-and-qualifiers cache-account-selector";
    const run = await inventoryFull({ kvValues: { current_strategies_cache: JSON.stringify({ ts: 1, data: { ibkr: { "l2-cache": { account_selector: lost } } } }) } });
    assert.deepEqual([pairs(run.private), run.private.mapping.entries[0].episodes[0].identity.qualifiers.account_selector], [[["ibkr", "l2-cache"]], { long_string: LONG_STRING + 1 }],
      `${label}: one account mapping, marker kept`);
    const reason = `kv:current_strategies_cache:cache_accounts.accounts[0].qualifiers.account_selector:${SCALAR_LOSS}`;
    assert.deepEqual(run.private.identity_losses.map(item => [item.reason, item.locator]), [[reason, { source: "kv", name: "current_strategies_cache",
      path: ["data", "ibkr", "l2-cache"], qualifier: "account_selector" }]], `${label}: structured locator kept separately`);
    r9Outcome(label, run, { reasons: [reason], incomplete: [20] });
  }
}

// R9-L3: a long value outside a selected identity position is no loss.
{
  const item = long(LONG_STRING + 1);
  const L3 = {
    "nonselected-option-id": [{ kvValues: { account_options: JSON.stringify({ ibkr: [{ key: "l3-opt", id: item }] }) } }, [["ibkr", "l3-opt"]]],
    "marker-lookalike-object": [{ kvValues: { risk_profile_bindings: JSON.stringify({ platform: "ibkr", account_key: { long_string: 999 } }) } }, []],
    "long-operation-status": [{ sql: [rows("account_diagnosis_tasks", [{ request_id: "diag-l3", platform: "ibkr", account_key: "l3-diag", status: item, checks_json: "[]",
      native_json: "{}" }])] }, [["ibkr", "l3-diag"]]],
    "ignored-free-text": [{ kvValues: { risk_profile_bindings: JSON.stringify({ platform: "ibkr", account_key: "l3-free", note: item }) } }, [["ibkr", "l3-free"]]],
    "raw-cache-account-key": [{ kvValues: { current_strategies_cache: JSON.stringify({ ts: 1, data: { ibkr: { [long(LONG_STRING + 1, "C")]: {} } } }) } },
      [["ibkr", long(LONG_STRING + 1, "C")]]],
    "raw-sql-account-pk": [{ sql: [rows("account_facts_observation", [{ platform: "ibkr", account_key: long(LONG_STRING + 1, "P"), payload_json: "{}" }])] },
      [["ibkr", long(LONG_STRING + 1, "P")]]],
  };
  for (const [variant, [fixture, expected]] of Object.entries(L3)) {
    r9Row("R9-L3");
    const label = `R9-L3-nonidentity-and-preservation ${variant}`;
    const run = await inventoryFull(fixture);
    assert.deepEqual([pairs(run.private), run.private.mapping.unattributed, run.private.identity_losses], [expected, [], []], `${label}: accounts kept, no loss reason`);
    if (variant === "long-operation-status") {
      assert.deepEqual(run.private.pending.map(row => [row.family, row.status, row.classification]), [["account_diagnosis_tasks", "unreadable", "unknown"]], `${label}: pending semantics unchanged`);
    }
    r9Outcome(label, run, { needles: ["CCCC", "PPPP"] });
  }
}

// R9-L4: loss causes combine without duplication.
{
  const lost = long(LONG_STRING + 1);
  {
    r9Row("R9-L4");
    const label = "R9-L4-combined-causes marker-and-kv-truncation";
    const value = { first: { platform: "ibkr", account_key: lost }, ...references(2000, "l4a") };
    const run = await inventoryFull({ kvValues: { risk_profile_bindings: JSON.stringify(value) } });
    assert.deepEqual([Object.keys(exportedKv(run.responses, "risk_profile_bindings").identity.fields).length, exportedKv(run.responses, "risk_profile_bindings").identity.truncated], [4000, true],
      `${label}: projected fields`);
    assert.deepEqual(run.private.kv.failed_reads.map(read => [read.name, read.causes]), [["risk_profile_bindings", ["identity_projection_truncated"]]], `${label}: one failed KV key`);
    const reasons = ["kv:risk_profile_bindings:identity_projection_truncated", `kv:risk_profile_bindings:first.account_key:${SCALAR_LOSS}`];
    assert.deepEqual([[...run.private.group_reasons[20]].sort(), pairs(run.private).length], [[...reasons].sort(), 1999], `${label}: both causes once, survivors mapped`);
    r9Outcome(label, run, { reasons, incomplete: [20], failedReads: 1 });
  }
  {
    r9Row("R9-L4");
    const label = "R9-L4-combined-causes sql-and-do-truncation";
    const run = await inventoryFull({ sql: [rows("risk_profile_authority", [{ id: 1, revision: 1, imported: 1, bindings_json: JSON.stringify(references(129, "l4b-sql")) }])],
      doKv: { "desk:readbacks:record:rb_l4": desk(references(65, "l4b-do")) } });
    r9Outcome(label, run, { reasons: ["runtime:risk_profile_authority:bindings_json:identity_projection_truncated", "runtime:do_kv:payload_identity_truncated"], incomplete: [4, 15] });
  }
  {
    r9Row("R9-L4");
    const label = "R9-L4-combined-causes sql-kv-env-markers";
    const pair = (platform, survivor) => JSON.stringify({ rows: [{ platform, account_key: lost }, { platform, account_key: survivor }] });
    const run = await inventoryFull({ sql: [rows("risk_profile_authority", [{ id: 1, revision: 1, imported: 1, bindings_json: pair("ibkr", "l4c-sql") }])],
      kvValues: { risk_profile_bindings: pair("ibkr", "l4c-kv") }, envValues: { BINANCE_ACCOUNT_FACTS_BINDING_JSON: pair("binance", "l4c-env") } });
    assert.deepEqual([pairs(run.private), run.private.mapping.unattributed], [[["binance", "l4c-env"], ["ibkr", "l4c-kv"], ["ibkr", "l4c-sql"]], []], `${label}: three survivors`);
    r9Outcome(label, run, { reasons: [`sql:runtime:risk_profile_authority:0:bindings_json.rows[0].account_key:${SCALAR_LOSS}`, `kv:risk_profile_bindings:rows[0].account_key:${SCALAR_LOSS}`,
      `env:BINANCE_ACCOUNT_FACTS_BINDING_JSON:rows[0].account_key:${SCALAR_LOSS}`], incomplete: [4, 16, 20] });
  }
}

// R9-R1: the accepted R8-A residual. A root property named like an option
// slot with a short direct key still maps as a configured option; this
// records the unchanged baseline outcome, not a correction.
for (const [sourceName, source, fixture] of [["kv", "kv:account_options", value => ({ kvValues: { account_options: value } })],
  ["env", `env:${OPTIONS_BINDING}`, value => ({ envValues: { [OPTIONS_BINDING]: value } })]]) {
  r9Row("R9-R1");
  const label = `R9-R1-accepted-alias ${sourceName}`;
  const run = await inventoryFull(fixture(JSON.stringify({ "ibkr[0]": { key: "r1-alias" } })));
  assert.deepEqual(configuredEpisodes(run.private), [{ platform: "ibkr", legacy_key: "r1-alias", locator: { source, path: "ibkr[0].key" }, identity: { selected_field: "key" } }],
    `${label}: the accepted baseline outcome is kept`);
  r9Outcome(label, run);
}
assert.deepEqual(r9Executions, { "R9-K1": 17, "R9-K2": 5, "R9-K3": 3, "R9-D1": 3, "R9-D2": 2, "R9-D3": 2, "R9-D4": 3, "R9-S1": 66, "R9-S2": 2, "R9-S3": 2, "R9-S4": 2,
  "R9-S5": 4, "R9-A1": 4, "R9-A2": 4, "R9-A3": 2, "R9-P1": 3, "R9-P2": 5, "R9-P3": 1, "R9-L1": 24, "R9-L2": 4, "R9-L3": 6, "R9-L4": 3, "R9-R1": 2 }, "R9: every matrix execution ran");
assert.equal(Object.values(r9Executions).reduce((total, count) => total + count, 0), 169, "R9: 169 semantic executions");

// R10: an audit entry names an account only in a root array, which the
// reader reports as `audit_root_array` from the parsed value. Flattened
// paths alone cannot show it: a `{ "": [entry] }` value projects exactly as
// `[entry]`. Without that evidence an export's would-be audit account is
// unknown. "Short" is 512 characters, "long" 513.
const r10Executions = {};
const r10Row = row => { r10Executions[row] = (r10Executions[row] || 0) + 1; };
const { loadAuditLog } = await import(new URL("application/worker/runtime_support.js", CONSOLE));
const AUDIT_ACTIONS = ["save_account_settings", "approve_account_settings_profile_application"];
const AUDIT_SHAPES = { "index-shaped-object": item => ({ "[0]": item }), "root-array": item => [item], "count-alias": item => ({ "": [item] }) };
const SHAPE_REASON = "kv:audit_log:audit_root_shape_unavailable";
const auditEntry = (action, length, extra = {}) => ({ action, platform: "ibkr", key: long(length, "A"), ...extra });
// The ordinary audit reader's entries for a stored value.
const ordinaryAudit = async text => (await loadAuditLog({ STRATEGY_SWITCH_CONFIG: { get: async () => text, put: () => violate("audit.put") } })).length;
const rootCount = item => Object.hasOwn(item.identity.counts, "$") ? item.identity.counts.$ : undefined;
// The shape bit is an own Boolean on every exported audit item in both
// passes and on nothing else; every other exported field is the unextended
// projection of the stored value.
const auditScope = (label, responses, kvValues, envValues = {}) => {
  const items = responses.filter(item => item.request.section === "kv").flatMap(item => item.body.keys);
  for (const item of items) {
    if (item.family === "audit_log" && item.state === "exported") {
      assert.ok(Object.hasOwn(item, "audit_root_array") && typeof item.audit_root_array === "boolean", `${label}: own Boolean shape on exported audit item`);
      assert.equal(item.audit_root_array, Array.isArray(JSON.parse(kvValues[item.name])), `${label}: shape bit from the parsed value`);
    } else assert.ok(!Object.hasOwn(item, "audit_root_array"), `${label}: no shape bit on ${item.family}`);
    if (item.state !== "exported") continue;
    const value = JSON.parse(kvValues[item.name]);
    assert.deepEqual(item.identity, identityProjection(value, KV_IDENTITY_FIELDS, { optionKeyEvidence: item.name === "account_options" }), `${label}: ${item.name} unextended projection`);
    if (item.family === "current_strategies_cache") assert.deepEqual(item.cache_accounts, strategiesCacheAccounts(value), `${label}: cache sidecar unchanged`);
  }
  assert.equal(items.filter(item => item.family === "audit_log" && item.state === "exported").length, "audit_log" in kvValues ? 2 : 0, `${label}: audit item in both passes`);
  for (const binding of responses.filter(item => item.request.section === "env").flatMap(item => item.body.bindings)) {
    assert.ok(!Object.hasOwn(binding, "audit_root_array"), `${label}: no shape bit on env ${binding.name}`);
    if (binding.state === "present") assert.deepEqual(binding.identity, identityProjection(JSON.parse(envValues[binding.name]), KV_IDENTITY_FIELDS,
      { optionKeyEvidence: binding.name === OPTIONS_BINDING }), `${label}: env ${binding.name} unextended projection`);
  }
};
// A fresh collection of one audit value, its shape inspected before and after.
const auditRun = async (label, value, { array, count }) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert.equal(Array.isArray(JSON.parse(text)), array, `${label}: stored root shape`);
  const run = await inventoryFull({ kvValues: { audit_log: text } });
  auditScope(label, run.responses, { audit_log: text });
  const item = exportedKv(run.responses, "audit_log");
  assert.deepEqual([item.audit_root_array, rootCount(item), item.identity.truncated], [array, count, false], `${label}: shape bit, root count, no truncation`);
  return { run, item, text, ordinary: await ordinaryAudit(text) };
};
const r10Outcome = (label, run, expected = {}) => {
  assert.equal(run.private.groups[23], "external_evidence_required", `${label}: group 23`);
  if (expected.reasons?.length) assert.deepEqual(run.private.group_reasons[20], expected.reasons, `${label}: group 20 reasons`);
  r9Outcome(label, run, { needles: ["AAAA", "audit_root_shape_unavailable", "[0]"], ...expected });
};
const auditEpisodes = result => result.mapping.entries.map(entry => [entry.platform, entry.legacy_key, entry.episodes.map(episode => [episode.state, episode.locator])]);
const auditLocator = path => ({ source: "kv", name: "audit_log", path });

// R10-A1: a recognized entry under an index-shaped property of a root object
// names nothing; in a genuine root array it is the account, or a located loss.
const freshAudit = {};
for (const action of AUDIT_ACTIONS) for (const shape of ["index-shaped-object", "root-array"]) for (const length of [512, 513]) {
  r10Row("R10-A1");
  const label = `R10-A1-root-fence ${action} ${shape} ${length}`;
  const array = shape === "root-array";
  const { run, item, text, ordinary } = await auditRun(label, AUDIT_SHAPES[shape](auditEntry(action, length)), { array, count: array ? 1 : undefined });
  freshAudit[`a1/${action}/${shape}/${length}`] = { text, identity: item.identity };
  assert.deepEqual(item.identity.fields, { "[0].action": action, "[0].platform": "ibkr", "[0].key": length === 512 ? long(512, "A") : { long_string: 513 } }, `${label}: three projected fields, strict marker when long`);
  assert.equal(ordinary, array ? 1 : 0, `${label}: ordinary reader entries`);
  if (!array) {
    assert.deepEqual([pairs(run.private), run.private.mapping.unattributed, run.private.identity_losses], [[], [], []], `${label}: no audit account from a non-array root`);
    r10Outcome(label, run);
  } else if (length === 512) {
    assert.deepEqual([auditEpisodes(run.private), run.private.mapping.unattributed], [[["ibkr", long(512, "A"), [["kv_reference", auditLocator("[0].key")]]]], []], `${label}: one located account`);
    r10Outcome(label, run);
  } else {
    const reason = `kv:audit_log:[0].key:${SCALAR_LOSS}`;
    assert.deepEqual([pairs(run.private), run.private.mapping.unattributed, run.private.identity_losses.map(loss => loss.reason)], [[], [], [reason]], `${label}: one located loss, no account`);
    r10Outcome(label, run, { reasons: [reason], incomplete: [20] });
  }
}

// R10-A2: the count alias projects exactly as the genuine array; only the
// shape bit tells them apart, so it names nothing.
for (const action of AUDIT_ACTIONS) for (const length of [512, 513]) {
  r10Row("R10-A2");
  const label = `R10-A2-count-path-collision ${action} ${length}`;
  const { run, item, text, ordinary } = await auditRun(label, AUDIT_SHAPES["count-alias"](auditEntry(action, length)), { array: false, count: 1 });
  freshAudit[`a2/${action}/count-alias/${length}`] = { text, identity: item.identity };
  assert.deepEqual(item.identity, freshAudit[`a1/${action}/root-array/${length}`].identity, `${label}: projection equals the genuine array's`);
  assert.equal(ordinary, 0, `${label}: ordinary reader entries`);
  assert.deepEqual([pairs(run.private), run.private.mapping.unattributed, run.private.identity_losses], [[], [], []], `${label}: no audit account from the count alias`);
  r10Outcome(label, run);
}

// R10-A3: no root type is an audit account.
for (const [variant, text, array] of [["null", "null", false], ["boolean", "true", false], ["number", "7", false], ["string", JSON.stringify("audit-r10-string"), false],
  ["empty-object", "{}", false], ["empty-array", "[]", true]]) {
  r10Row("R10-A3");
  const label = `R10-A3-root-types ${variant}`;
  const { run, item, ordinary } = await auditRun(label, text, { array, count: array ? 0 : undefined });
  assert.deepEqual([item.identity.fields, ordinary], [{}, 0], `${label}: no projected field, no ordinary entry`);
  assert.deepEqual([pairs(run.private), run.private.mapping.unattributed, run.private.identity_losses], [[], [], []], `${label}: no audit account`);
  r10Outcome(label, run);
}

// R10-A4: a root array with no direct recognized entry.
for (const [variant, value, entries] of [["null-entry", [null], 0], ["scalar-entry", [7], 0], ["nested-array", [[auditEntry("save_account_settings", 512)]], 0],
  ["nested-object", [{ nested: auditEntry("approve_account_settings_profile_application", 512) }], 1]]) {
  r10Row("R10-A4");
  const label = `R10-A4-entry-types ${variant}`;
  const { run, ordinary } = await auditRun(label, value, { array: true, count: 1 });
  assert.equal(ordinary, entries, `${label}: ordinary reader entries`);
  assert.deepEqual([pairs(run.private), run.private.mapping.unattributed, run.private.identity_losses], [[], [], []], `${label}: no audit account`);
  r10Outcome(label, run);
}

// R10-A5: a lost platform leaves the selected key unattributed.
for (const action of AUDIT_ACTIONS) {
  r10Row("R10-A5");
  const label = `R10-A5-selected-platform-loss ${action}`;
  const { run, item } = await auditRun(label, [{ action, platform: long(513, "P"), key: "audit-a5-key" }], { array: true, count: 1 });
  assert.deepEqual(item.identity.fields["[0].platform"], { long_string: 513 }, `${label}: strict platform marker`);
  const reason = `kv:audit_log:[0].platform:${SCALAR_LOSS}`;
  assert.deepEqual([pairs(run.private), run.private.mapping.unattributed.map(row => [row.legacy_key, row.locator])], [[], [["audit-a5-key", auditLocator("[0].key")]]],
    `${label}: one unattributed key, no borrowed platform`);
  assert.deepEqual(run.private.identity_losses.map(loss => loss.reason), [reason], `${label}: one located platform loss`);
  r10Outcome(label, run, { reasons: [reason], incomplete: [20] });
}

// R10-A6: an explicit account reference in a non-array audit value stays a
// generic reference.
for (const [variant, shape, action] of [["index-shaped-object", "index-shaped-object", "save_account_settings"], ["count-alias", "count-alias", "approve_account_settings_profile_application"]]) {
  r10Row("R10-A6");
  const label = `R10-A6-generic-independence ${variant}`;
  const value = { ...AUDIT_SHAPES[shape](auditEntry(action, 513)), ref: { platform: "ibkr", account_key: "audit-a6-ref" } };
  const { run } = await auditRun(label, value, { array: false, count: shape === "count-alias" ? 1 : undefined });
  assert.deepEqual([auditEpisodes(run.private), run.private.mapping.unattributed, run.private.identity_losses],
    [[["ibkr", "audit-a6-ref", [["kv_reference", auditLocator("ref.account_key")]]]], [], []], `${label}: only the generic reference`);
  r10Outcome(label, run);
}

// R10-A7: the frozen pre-fix exports of every A1 and A2 value carry no shape
// bit. Each would-be audit account is unknown: no account, no loss at an
// unestablished position, one shape reason.
for (const id of Object.keys(PRE_FIX).filter(item => /^a[12]\//.test(item))) {
  r10Row("R10-A7");
  const label = `R10-A7-old-audit-replay ${id}`;
  assert.equal(provenance.exports[id].row, "R10-A7", `${label}: provenance category`);
  const replay = PRE_FIX[id];
  const item = exportedKv(replay.responses, "audit_log");
  assert.ok(!Object.hasOwn(item, "audit_root_array"), `${label}: no shape bit in the old export`);
  assert.deepEqual([item.value_sha256, item.identity], [sha256(freshAudit[id].text), freshAudit[id].identity], `${label}: the same stored value and projection as the fresh collection`);
  const run = { responses: replay.responses, ...assemble(structuredClone(replay)) };
  assert.deepEqual([pairs(run.private), run.private.mapping.unattributed], [[], []], `${label}: no audit account`);
  assert.deepEqual(run.private.identity_losses.map(loss => loss.reason), [SHAPE_REASON], `${label}: exactly one shape-unavailable reason, no scalar loss`);
  r10Outcome(label, run, { reasons: [SHAPE_REASON], incomplete: [20], preB2: true });
}

// R10-A8: an old export without a would-be audit account adds no reason.
for (const id of ["a8/empty-root-array", "a8/unrecognized-action"]) {
  r10Row("R10-A8");
  const label = `R10-A8-old-noncandidate ${id}`;
  assert.equal(provenance.exports[id].row, "R10-A8", `${label}: provenance category`);
  const replay = PRE_FIX[id];
  assert.ok(!Object.hasOwn(exportedKv(replay.responses, "audit_log"), "audit_root_array"), `${label}: no shape bit in the old export`);
  const run = { responses: replay.responses, ...assemble(structuredClone(replay)) };
  assert.deepEqual([pairs(run.private), run.private.mapping.unattributed, run.private.identity_losses], [[], [], []], `${label}: no account and no reason`);
  r10Outcome(label, run, { preB2: true });
}
assert.deepEqual(r10Executions, { "R10-A1": 8, "R10-A2": 4, "R10-A3": 6, "R10-A4": 4, "R10-A5": 2, "R10-A6": 2, "R10-A7": 12, "R10-A8": 2 }, "R10: every matrix execution ran");
assert.equal(Object.values(r10Executions).reduce((total, count) => total + count, 0), 40, "R10: 40 semantic executions");

// R10 source scope (supplemental): the shape bit is on the audit item alone,
// beside other KV families and all three env bindings, whose projections and
// sidecars are unchanged.
for (const audit of [JSON.stringify([auditEntry("save_account_settings", 512)]), JSON.stringify({ "[0]": auditEntry("save_account_settings", 512) })]) {
  const kvValues = { audit_log: audit, account_options: JSON.stringify({ ibkr: [{ key: "r10-opt", id: "r10-opt-id" }] }),
    account_facts_bindings: JSON.stringify({ bindings: [{ platform: "ibkr", account_key: "r10-fact" }] }),
    current_strategies_cache: JSON.stringify({ ts: 1, data: { ibkr: { "r10-cache": { account_selector: "s" } } } }), ...UNRELATED };
  const envValues = { [OPTIONS_BINDING]: JSON.stringify({ ibkr: [{ key: "r10-env-opt" }] }),
    BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify({ platform: "binance", account_key: "r10-bn" }),
    BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON: JSON.stringify([{ platform: "binance", account_key: "r10-bn-old" }]) };
  const run = await inventoryFull({ kvValues, envValues });
  auditScope("R10-source-scope", run.responses, kvValues, envValues);
  assert.equal(run.private.status, ENUMERATED, "R10-source-scope: complete");
}
// R10 malformed shape evidence (supplemental unit checks on edited exports,
// not real-handler collections): a non-Boolean bit, a true bit without a root
// count, and a true bit with the entry beyond its count are each unknown.
{
  const fresh = (await inventoryFull({ kvValues: { audit_log: freshAudit["a1/save_account_settings/root-array/512"].text } })).exported;
  for (const [variant, edit] of [["string-bit", item => { item.audit_root_array = "true"; }], ["no-root-count", item => { delete item.identity.counts.$; }],
    ["index-beyond-count", item => { item.identity.counts.$ = 0; }]]) {
    const copy = structuredClone(fresh);
    for (const item of copy.responses.filter(response => response.request.section === "kv").flatMap(response => response.body.keys)) if (item.name === "audit_log") edit(item);
    const { private: result } = assemble(copy);
    assert.deepEqual([pairs(result), result.mapping.unattributed, result.reasons, result.groups[20]], [[], [], [SHAPE_REASON], "incomplete"], `R10-supplemental ${variant}: unknown, one shape reason`);
  }
}

// ---------------------------------------------------- A3: populated, beyond legacy caps, full assembly
const plan = populatedPlan();
const counts = seededCounts(plan);
assert.ok(counts.instance_history > 50 && counts.account_setting_profile_application > 100 && counts.human_decision_record > 100
  && counts.research_promotion_applications > 100 && counts.human_decision_source_material > 100 && counts.account_daily_native_return > 1000
  && counts.account_facts_daily > 366 && Object.keys(plan.kv).length > 1000 && Object.keys(KV_VALUES).length > 1000, "seed exceeds every legacy cap");
// The same populated seed twice: a loss-free control that must enumerate
// completely, and the adverse seed whose one oversized observation row is a
// failed identity projection and must leave group 5, its object and the
// overall result incomplete. Every other assertion runs on both.
const adversePlan = populatedPlan({ adverse: true });
assert.deepEqual(seededCounts(adversePlan), counts, "the adverse seed differs from the control by one stored payload only");
for (const [label, runPlan, adverse] of [["A3-populated-loss-free-control", plan, false], ["A3-populated-adverse-row-projection", adversePlan, true]]) {
  const h = await harness({ runtime: runPlan, directory: { ...directoryPlan(), initialize: true }, extraEnv: {
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
  assert.equal(observation.flatMap(item => item.body.rows).filter(row => row.projection_error === "row_projection_too_large").length, adverse ? 1 : 0,
    `${label}: oversized row recorded as failed, not dropped`);
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
  const tables = result.objects[0].tables;
  if (adverse) {
    const reason = "account_facts_observation:row_projection_too_large";
    assert.deepEqual([result.status, summary.status, result.reasons, result.objects.map(object => [object.complete, object.reasons])],
      ["incomplete", "incomplete", [`runtime:${reason}`], [[false, [reason]], [true, []]]], `${label}: the failed row leaves its object and the overall result incomplete`);
    assert.deepEqual([tables.account_facts_observation.disposition, tables.account_facts_observation.failed_rows, result.groups[5], result.group_reasons[5],
      summary.groups[5], summary.objects[0].failed_rows], ["incomplete", 1, "incomplete", [`runtime:${reason}`], "incomplete", 1], `${label}: table and group 5 incomplete`);
  } else {
    assert.equal(result.status, "retained_state_enumerated_external_evidence_required", JSON.stringify(result.reasons));
    for (const object of result.objects) assert.equal(object.complete, true, `${object.object}: ${object.reasons}`);
    assert.equal(summary.objects[0].failed_rows, 0, `${label}: no failed row`);
  }
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
  for (let group = 1; group <= 22; group++) if (!(adverse && group === 5)) assert.equal(result.groups[group], "complete", `${label}: group ${group}`);
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
  assert.deepEqual(entry("binance", "bn-main").episodes.map(episode => [episode.locator.table, episode.identity.storage_key, episode.identity.logical_account]),
    [["account_facts_daily", ["binance", `bn-main:${hex("wallet-1")}`, day(0)], { legacy_key: "bn-main", binding_id: hex("wallet-1"), composite: true }]],
    `${label}: the wallet-history row is the composite witness; its raw key is kept`);
  assert.ok(tables.binance_detail_daily.rows.every(row => !("logical_account" in row)), `${label}: detail rows carry no logical-account hint`);
  for (const binding of ["binding-1", "binding-0"]) {
    assert.deepEqual(entry("binance", `bn-main:${hex(binding)}`)?.episodes.map(episode => [episode.locator.table, episode.identity.logical_account]),
      [["binance_detail_daily", null]], `${label}: Binance detail key ${binding} survives as its literal account`);
  }
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
  for (const needle of ["acct-", "orphan-key", "sel-", "target-", "shared", "mgmt-"]) assert.ok(!summaryText.includes(needle), `sanitized summary omits ${needle}`);
  const mgmtSibling = entry("ibkr", "mgmt-sibling-only");
  assert.ok(mgmtSibling, "sibling-only deployment in policy/membership/members/receipt is mapped");
  assert.deepEqual(
    [...new Set(mgmtSibling.episodes.map(episode => episode.locator.table))].sort(),
    ["account_management_applied", "account_management_change", "account_management_draft", "account_management_requests", "account_mapping_policy"],
  );
  assert.ok(!result.mapping.conflicts.some(item => item.legacy_key === "acct-004"
    && item.kind === "stored_identity_differs_from_current"
    && item.records.some(record => PRE_B2_TABLES.includes(record.locator.table))),
  "matching stored identities in B2 management tables produce zero conflicts");
  const acct4MgmtEpisodes = entry("ibkr", "acct-004").episodes
    .filter(episode => PRE_B2_TABLES.includes(episode.locator.table) && episode.identity?.stored_identity);
  assert.ok(acct4MgmtEpisodes.length >= 4 && acct4MgmtEpisodes.every(episode => episode.identity.stored_identity_matches_current === true),
    "every B2 management stored identity on acct-004 matches current");
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

// ---------------------------------------------------- B2-A14: typed decoding & loss propagation for B2 tables
{
  const currentA = { platform: "ibkr", key: "b2-a", kind: "existing", config: { key: "b2-a", target_name: "tgt-a", account_selector: "sel-a", broker_environment: "live" } };
  const currentB = { platform: "ibkr", key: "b2-b", kind: "existing", config: { key: "b2-b", target_name: "tgt-b", account_selector: "sel-b", broker_environment: "live" } };
  const idA = { platform: "ibkr", key: "b2-a", target_name: "tgt-a", broker_environment: "live", account_selector: "sel-a", deployment_selector: "", account_scope: "", service_name: "" };
  const idB = { platform: "ibkr", key: "b2-b", target_name: "tgt-b", broker_environment: "live", account_selector: "sel-b", deployment_selector: "", account_scope: "", service_name: "" };
  const idBDrift = { ...idB, account_selector: "sel-b-stale" };
  const membersDrift = JSON.stringify([
    { platform: "ibkr", legacy_key: "b2-a", identity: idA },
    { platform: "ibkr", legacy_key: "b2-b", identity: idBDrift },
  ]);

  // 1. Matching sibling identity succeeds cleanly; drifting sibling inside policy/membership/members triggers stored_identity_differs_from_current.
  const driftRun = await inventoryFull({
    sql: [
      rows("instance_state", [{ id: 1, revision: 1, payload: JSON.stringify([currentA, currentB]) }]),
      rows("account_mapping_policy", [{
        id: 1, policy_revision: 1, updated_at: day(1),
        policy_json: JSON.stringify({ format: "qsl_account_mapping_policy.v1", policy_revision: 1, accounts: [{ management_class: "eligible", deployments: JSON.parse(membersDrift) }] }),
      }]),
      rows("account_management_draft", [{
        platform: "ibkr", account_key: "b2-a", revision: 1, identity_json: JSON.stringify(idA), membership_json: membersDrift,
        management_enabled: 1, base_applied_revision: 0, policy_revision: 1, instance_revision: 1, status: "pending", updated_by: ACTOR_CANARY, updated_at: day(1),
      }]),
      rows("account_management_applied", [{
        platform: "ibkr", account_key: "b2-a", revision: 1, identity_json: JSON.stringify(idA), membership_json: membersDrift,
        management_enabled: 1, effective_at: day(1),
      }]),
      rows("account_management_change", [{
        event_id: "evt-b2-1", occurred_at: day(1), actor: ACTOR_CANARY, platform: "ibkr", account_key: "b2-a",
        initiating_identity_json: JSON.stringify(idA), members_json: membersDrift,
        policy_revision: 1, instance_revision: 1, draft_revision: 1, old_applied_revision: 0, new_applied_revision: 1,
        old_management_enabled: null, new_management_enabled: 1, result: "applied",
      }]),
    ],
  });
  assert.equal(driftRun.private.status, ENUMERATED);
  const driftTables = driftRun.private.mapping.conflicts
    .filter(item => item.legacy_key === "b2-b" && item.kind === "stored_identity_differs_from_current")
    .flatMap(item => item.records.map(record => record.locator.table))
    .sort();
  assert.deepEqual(driftTables, ["account_management_applied", "account_management_change", "account_management_draft", "account_mapping_policy"]);
  assert.ok(!driftRun.private.mapping.conflicts.some(item => item.legacy_key === "b2-a"));

  // 2. Corrupt or non-array membership_json/members_json flags unreadable conflict rather than silently passing.
  const corruptRun = await inventoryFull({
    sql: [
      rows("instance_state", [{ id: 1, revision: 1, payload: JSON.stringify([currentA]) }]),
      rows("account_management_draft", [{
        platform: "ibkr", account_key: "b2-a", revision: 1, identity_json: JSON.stringify(idA), membership_json: "{}",
        management_enabled: 1, base_applied_revision: 0, policy_revision: 1, instance_revision: 1, status: "pending", updated_by: ACTOR_CANARY, updated_at: day(1),
      }]),
      rows("account_management_applied", [{
        platform: "ibkr", account_key: "b2-a", revision: 1, identity_json: JSON.stringify(idA), membership_json: "{bad",
        management_enabled: 1, effective_at: day(1),
      }]),
      rows("account_management_change", [{
        event_id: "evt-b2-corrupt", occurred_at: day(1), actor: ACTOR_CANARY, platform: "ibkr", account_key: "b2-a",
        initiating_identity_json: JSON.stringify(idA), members_json: "{bad",
        policy_revision: 1, instance_revision: 1, draft_revision: 1, old_applied_revision: 0, new_applied_revision: 1,
        old_management_enabled: null, new_management_enabled: 1, result: "applied",
      }]),
    ],
  });
  const unreadableConflict = corruptRun.private.mapping.conflicts.find(item => item.legacy_key === "b2-a" && item.kind === "stored_identity_differs_from_current");
  assert.ok(unreadableConflict);
  assert.deepEqual(
    unreadableConflict.records.map(record => [record.locator.table, record.locator.column, record.fields]).sort(),
    [
      ["account_management_applied", "membership_json", ["unreadable"]],
      ["account_management_change", "members_json", ["unreadable"]],
      ["account_management_draft", "membership_json", ["unreadable"]],
    ],
  );

  // 3. Long-string scalar losses inside policy_json, membership_json, members_json, and journal/request keys
  // propagate cleanly to their owning groups (2, 3, 4), runtime object, and overall incomplete status.
  const longText = long(LONG_STRING + 1);
  const lossCases = [
    ["policy-selector", 4, [`sql:runtime:account_mapping_policy:0:policy_json.accounts[0].deployments[0].identity.account_selector:${SCALAR_LOSS}`],
      rows("account_mapping_policy", [{
        id: 1, policy_revision: 1, updated_at: day(1),
        policy_json: JSON.stringify({ format: "qsl_account_mapping_policy.v1", policy_revision: 1, accounts: [{ management_class: "eligible", deployments: [{ platform: "ibkr", legacy_key: "b2-a", identity: { ...idA, account_selector: longText } }] }] }),
      }])],
    ["membership-selector", 2, [`sql:runtime:account_management_draft:0:membership_json.[1].identity.account_selector:${SCALAR_LOSS}`],
      rows("account_management_draft", [{
        platform: "ibkr", account_key: "b2-a", revision: 1, identity_json: JSON.stringify(idA),
        membership_json: JSON.stringify([{ platform: "ibkr", legacy_key: "b2-a", identity: idA }, { platform: "ibkr", legacy_key: "b2-b", identity: { ...idB, account_selector: longText } }]),
        management_enabled: 1, base_applied_revision: 0, policy_revision: 1, instance_revision: 1, status: "pending", updated_by: ACTOR_CANARY, updated_at: day(1),
      }])],
    ["journal-member-key", 3, [
      `sql:runtime:account_management_change:0:members_json.[1].legacy_key:${SCALAR_LOSS}`,
      `sql:runtime:account_management_change:0:members_json.[1].identity.key:${SCALAR_LOSS}`,
    ],
      rows("account_management_change", [{
        event_id: "evt-b2-loss-1", occurred_at: day(1), actor: ACTOR_CANARY, platform: "ibkr", account_key: "b2-a",
        initiating_identity_json: JSON.stringify(idA),
        members_json: JSON.stringify([{ platform: "ibkr", legacy_key: "b2-a", identity: idA }, { platform: "ibkr", legacy_key: longText, identity: { ...idB, key: longText } }]),
        policy_revision: 1, instance_revision: 1, draft_revision: 1, old_applied_revision: 0, new_applied_revision: 1,
        old_management_enabled: null, new_management_enabled: 1, result: "applied",
      }])],
    ["journal-scalar-and-init", 3, [`sql:runtime:account_management_change:0:initiating_identity_json.account_selector:${SCALAR_LOSS}`],
      rows("account_management_change", [{
        event_id: "evt-b2-loss-2", occurred_at: day(1), actor: ACTOR_CANARY, platform: "ibkr", account_key: "b2-a",
        initiating_identity_json: JSON.stringify({ ...idA, account_selector: longText }),
        members_json: "[]",
        policy_revision: 1, instance_revision: 1, draft_revision: 1, old_applied_revision: 0, new_applied_revision: 1,
        old_management_enabled: null, new_management_enabled: 1, result: "applied",
      }])],
    ["request-account-key", 3, [`sql:runtime:account_management_requests:0:account_key:${SCALAR_LOSS}`],
      rows("account_management_requests", [{
        request_key: "req-b2-loss", operation: "account_management_apply", actor: ACTOR_CANARY, platform: "ibkr",
        account_key: longText, identity_json: JSON.stringify(idA), fingerprint: CANARY, receipt_json: "{}", created_at: day(1),
      }])],
  ];
  for (const [label, group, reasons, tableRows] of lossCases) {
    const run = await inventoryFull({ sql: [tableRows] });
    r9Outcome(`B2-A14-${label}`, run, { reasons, incomplete: [group], needles: ["b2-a", "b2-b"] });
  }
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
