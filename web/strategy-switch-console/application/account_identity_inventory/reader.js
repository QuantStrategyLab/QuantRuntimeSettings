// Read-only account-identity inventory inside the RuntimeInstances object.
// Dispatched before ordinary storage initialization: this module never creates,
// upgrades, repairs, caches or checkpoints anything. It only runs the fixed
// statements below through a capability that rejects every other statement.
export const INVENTORY_DO_PATH = "/internal/account-identity-inventory";
export const INVENTORY_SCHEMA_VERSION = "qsl_account_identity_inventory.v1";
export const INVENTORY_ORDERING = "primary_key_binary_v1";
export const INVENTORY_OBJECTS = Object.freeze({ runtime: "runtime-instances", directory: "console-kv-directory-v1" });
export const INVENTORY_PAGE_SIZE = Object.freeze({ default: 100, max: 500 });
const RESPONSE_BYTE_BUDGET = 1_500_000;
const ROW_BYTE_LIMIT = 256_000;
const REQUEST_BYTE_LIMIT = 16_384;
const LONG_STRING = 512;

export class InventoryError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

// Identity, reference and status fields only. Amounts, balances, positions,
// actors, credentials and free text are never copied from stored JSON.
const IDENTITY_KEYS = new Set(["platform", "platform_id", "key", "legacy_key", "account_key", "storage_account_key",
  "target_id", "target_name", "target_key", "runtime_target_id", "runtime_status_target_id", "account_selector",
  "deployment_selector", "account_scope", "service_name", "broker_environment", "github_environment", "variable_scope",
  "broker_account_id", "broker_account_hash", "source_binding_id", "binding_id", "binding_fingerprint", "kind", "id",
  "status", "phase", "state", "dispatch_state", "application_status", "retirement_status", "enabled", "platform_applied",
  "revision", "expected_revision", "source_revision", "request_id", "ticket_id", "application_id", "operation_id",
  "readback_id", "subject_id", "material_key", "source_id", "candidate_id", "strategy_profile",
  "expected_strategy_profile", "default_strategy_profile", "default_execution_mode", "execution_mode", "desired_state",
  "observation_date", "business_date", "observed_at", "observed_started_at", "observed_finished_at", "created_at",
  "updated_at", "expires", "expires_at", "expires_at_ms", "scanned_at", "ts", "from", "to", "currency",
  "configuration_sha256", "workflow_run_id", "workflow_run_attempt", "action", "reason_code", "source", "coverage",
  "time_precision", "schema", "schema_version", "imported", "preference", "scope_id", "selected_account"]);
const SECRET_KEY = /token|secret|password|passwd|credential|factor|cookie|session|authorization|bearer|private_key|api_key|signature|otp|seed/i;

const c = (name, group, pk, columns, fields = {}) => Object.freeze({
  name, group, pk, columns, copy: [], json: [], opaque: [], redact: [], ...fields,
});
// Columns are the current ordinary-path schema, including ALTER-added columns.
const TABLES = Object.freeze([
  c("instance_state", 1, ["id"], ["id", "revision", "payload"], { copy: ["revision"], nested: "payload" }),
  c("instance_history", 1, ["revision"], ["revision", "entry"], { history: "entry" }),
  c("account_setting_draft", 2, ["platform", "account_key"], ["platform", "account_key", "revision", "identity_json", "overrides_json", "updated_at"],
    { copy: ["revision", "updated_at"], json: ["identity_json"], keys: ["overrides_json"] }),
  c("account_setting_declaration", 2, ["platform", "account_key"], ["platform", "account_key", "revision", "identity_json", "declaration_json"],
    { copy: ["revision"], json: ["identity_json"], declaration: "declaration_json" }),
  c("account_setting_profile_application", 3, ["request_key"], ["request_key", "platform", "account_key", "identity_json", "instance_revision",
    "draft_revision", "old_profile", "new_profile", "approved_by", "approved_at", "status", "workflow_run_id", "workflow_run_attempt", "claimed_at"],
  { copy: ["platform", "account_key", "instance_revision", "draft_revision", "old_profile", "new_profile", "approved_at", "status",
    "workflow_run_id", "workflow_run_attempt", "claimed_at"], json: ["identity_json"], redact: ["approved_by"] }),
  c("risk_profile_authority", 4, ["id"], ["id", "revision", "imported", "bindings_json"], { copy: ["revision", "imported"], json: ["bindings_json"] }),
  c("account_facts_observation", 5, ["platform", "account_key"], ["platform", "account_key", "payload_json", "observed_finished_at",
    "observation_date", "target_id", "source_binding_id", "account_scope", "updated_at"],
  { copy: ["observed_finished_at", "observation_date", "target_id", "source_binding_id", "account_scope", "updated_at"], json: ["payload_json"] }),
  c("account_facts_daily", 5, ["platform", "account_key", "observation_date"], ["platform", "account_key", "observation_date", "payload_json",
    "observed_finished_at", "target_id", "source_binding_id", "account_scope", "updated_at"],
  { copy: ["observed_finished_at", "target_id", "source_binding_id", "account_scope", "updated_at"], json: ["payload_json"] }),
  c("account_period_return", 6, ["account_key"], ["account_key", "payload_json"], { json: ["payload_json"] }),
  c("account_daily_native_return", 6, ["account_key", "source_binding_id", "currency", "observation_date"],
    ["account_key", "source_binding_id", "currency", "observation_date", "payload_json"], { opaque: ["payload_json"] }),
  c("account_external_flow", 7, ["platform", "account_key"], ["platform", "account_key", "context_json", "payload_json"],
    { json: ["context_json", "payload_json"] }),
  c("account_executions", 8, ["platform", "account_key", "source_binding_id"], ["platform", "account_key", "source_binding_id", "context_json", "payload_json"],
    { json: ["context_json", "payload_json"] }),
  c("account_execution_reports", 8, ["platform", "account_key", "source_binding_id"], ["platform", "account_key", "source_binding_id", "context_json", "metadata_json"],
    { json: ["context_json"], reportMetadata: "metadata_json" }),
  // Created by the Binance detail command itself, not by ordinary initialization.
  c("binance_detail_daily", 9, ["account_key", "binding_id", "observation_date"], ["account_key", "binding_id", "observation_date", "payload_json"],
    { opaque: ["payload_json"], lazy: "binance_detail_command" }),
  c("account_diagnosis_tasks", 10, ["request_id"], ["request_id", "platform", "account_key", "target_id", "trigger", "observed_at", "checks_json",
    "state_fingerprint", "status", "workflow_run_id", "workflow_run_attempt", "job_id", "summary", "reason_code", "dispatch_state",
    "recheck_dispatch_state", "created_at", "updated_at", "auto_source", "native_json"],
  { copy: ["platform", "account_key", "target_id", "trigger", "observed_at", "state_fingerprint", "status", "workflow_run_id",
    "workflow_run_attempt", "job_id", "reason_code", "dispatch_state", "recheck_dispatch_state", "created_at", "updated_at", "auto_source"],
  json: ["native_json"], opaque: ["checks_json"], redact: ["summary"] }),
  c("research_promotion_applications", 11, ["application_id"], ["application_id", "ticket_id", "status", "dispatch_state", "claim_token",
    "platform_id", "account_key", "account_scope", "account_selector", "service_name", "broker_environment", "expected_revision",
    "expected_strategy_profile", "strategy_profile", "candidate_id", "config_sha256", "source_commit", "approved_ues_revision", "desired_state",
    "workflow_run_id", "workflow_run_attempt", "reason_code", "readback_json", "created_at", "updated_at"],
  { copy: ["ticket_id", "status", "dispatch_state", "platform_id", "account_key", "account_scope", "account_selector", "service_name",
    "broker_environment", "expected_revision", "expected_strategy_profile", "strategy_profile", "candidate_id", "config_sha256",
    "source_commit", "approved_ues_revision", "desired_state", "workflow_run_id", "workflow_run_attempt", "reason_code", "created_at",
    "updated_at"], json: ["readback_json"], redact: ["claim_token"] }),
  c("human_decision_material", 12, ["kind", "subject_id"], ["kind", "subject_id", "source_id", "material_key", "summary_json", "eligible",
    "expires_at_ms", "legacy_state", "legacy_block", "updated_at"],
  { copy: ["source_id", "material_key", "eligible", "expires_at_ms", "legacy_state", "legacy_block", "updated_at"], json: ["summary_json"] }),
  c("human_decision_record", 12, ["request_key"], ["request_key", "kind", "subject_id", "material_key", "action", "actor", "decided_at",
    "target_json", "payload_json"],
  { copy: ["kind", "subject_id", "material_key", "action", "decided_at"], json: ["target_json", "payload_json"], redact: ["actor"] }),
  c("human_decision_source_material", 12, ["kind", "subject_id", "source_id"], ["kind", "subject_id", "source_id", "material_key",
    "summary_json", "eligible", "expires_at_ms", "updated_at"],
  { copy: ["material_key", "eligible", "expires_at_ms", "updated_at"], json: ["summary_json"] }),
  c("hk_stop_request", 13, ["request_id"], ["request_id", "target_id", "identity_json", "source_revision", "action", "requested_at", "phase",
    "dispatch_result", "workflow_run_id", "workflow_run_attempt", "updated_at", "source_identity_sha256", "runtime_identity_sha256",
    "result_json", "stopped_at"],
  { copy: ["target_id", "source_revision", "action", "requested_at", "phase", "dispatch_result", "workflow_run_id", "workflow_run_attempt",
    "updated_at", "source_identity_sha256", "runtime_identity_sha256", "stopped_at"], json: ["identity_json", "result_json"] }),
  // Keyed by a console login: rows are located by digest, the login is not exported.
  c("ux1_research_slot", 14, ["login"], ["login", "revision", "draft_json", "fingerprint", "preview_json", "intent_json", "job_json"],
    { copy: ["revision", "fingerprint"], json: ["job_json"], opaque: ["draft_json", "preview_json", "intent_json"], actorKey: true }),
  c("runtime_cycle_health_source", 14, ["source_id"], ["source_id", "target_id", "binding_fingerprint", "configuration_sha256",
    "authority_revision", "required_from", "observed_at", "observation_json", "observation_sha256", "received_at", "checkpoint_revision"],
  { copy: ["target_id", "binding_fingerprint", "configuration_sha256", "authority_revision", "required_from", "observed_at",
    "observation_sha256", "received_at", "checkpoint_revision"], opaque: ["observation_json"] }),
  c("runtime_cycle_health_checkpoint", 14, ["target_id", "binding_fingerprint"], ["target_id", "binding_fingerprint", "source_id", "revision", "payload_json"],
    { copy: ["source_id", "revision"], json: ["payload_json"] }),
  c("runtime_cycle_health_incident", 14, ["target_id", "binding_fingerprint", "source_id", "cycle_id"], ["target_id", "binding_fingerprint",
    "source_id", "cycle_id", "cycle_json", "category", "active_category", "latest_fault_at", "attempt_count", "resolution_history_json"],
  { copy: ["category", "active_category", "latest_fault_at", "attempt_count"], opaque: ["cycle_json"], json: ["resolution_history_json"] }),
  c("runtime_cycle_health_attempt", 14, ["history_id"], ["history_id", "target_id", "binding_fingerprint", "source_id", "cycle_id", "attempt_key",
    "fault_at", "category", "configuration_sha256", "cycle_json", "resolution_ref"],
  { copy: ["target_id", "binding_fingerprint", "source_id", "cycle_id", "attempt_key", "fault_at", "category", "configuration_sha256",
    "resolution_ref"], opaque: ["cycle_json"] }),
  c("credential_maintenance_metadata", 14, ["id"], ["id", "revision", "expires_at", "last_rotated_at"], { copy: ["revision", "expires_at", "last_rotated_at"] }),
  c("credential_maintenance_delivery", 14, ["delivery_key"], ["delivery_key", "claim_id", "metadata_revision", "state"],
    { copy: ["claim_id", "metadata_revision", "state"] }),
  c("credential_rotation_operations", 14, ["operation_id"], ["operation_id", "record"], { json: ["record"] }),
  c("credential_rotation_requests", 14, ["request_id"], ["request_id", "fingerprint", "operation_id", "action", "response"],
    { copy: ["operation_id", "action"], redact: ["fingerprint", "response"] }),
  // The primary key is the factor value itself: count only, never paged.
  c("credential_rotation_factors", 14, ["factor"], ["factor"], { countOnly: "secret_bearing_primary_key" }),
  c("credential_rotation_throttle", 14, ["actor"], ["actor", "window_start", "failures"], { copy: ["window_start", "failures"], actorKey: true }),
  c("credential_rotation_audit", 14, ["event_id"], ["event_id", "occurred_at", "actor", "action", "operation_id", "outcome", "reason"],
    { copy: ["occurred_at", "action", "operation_id", "outcome", "reason"], redact: ["actor"] }),
  c("market_benchmark_daily", null, ["series_id", "observation_date"], ["series_id", "observation_date", "close", "source", "updated_at"],
    { countOnly: "not_account_identity" }),
  c("market_benchmark_revision_ledger", null, ["proposal_sha256", "entry_index"], ["proposal_sha256", "entry_index", "series_id_sha256",
    "observation_date", "prior_close_sha256", "new_close_sha256", "candidate_source", "reason", "applied_at"], { countOnly: "not_account_identity" }),
]);
export const INVENTORY_TABLES = Object.freeze(Object.fromEntries(TABLES.map(spec => [spec.name, spec])));

const SCHEMA_SQL = "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name COLLATE BINARY, type COLLATE BINARY";
const CHANGES_SQL = "SELECT total_changes() AS n";
const TABLE_INFO_SQL = "SELECT name, type, pk FROM pragma_table_info(?) ORDER BY cid";
const quoted = name => `"${name}"`;
const order = spec => spec.pk.map(column => `${quoted(column)} COLLATE BINARY`).join(", ");
const notNull = spec => spec.pk.map(column => `${quoted(column)} IS NOT NULL`).join(" AND ");
const STATEMENTS = new Map(TABLES.map(spec => [spec.name, Object.freeze({
  count: `SELECT COUNT(*) AS n FROM ${quoted(spec.name)}`,
  nullKeys: `SELECT COUNT(*) AS n FROM ${quoted(spec.name)} WHERE NOT (${notNull(spec)})`,
  first: `SELECT * FROM ${quoted(spec.name)} WHERE ${notNull(spec)} ORDER BY ${order(spec)} LIMIT ?`,
  // Same non-null condition as the first page: NULL-key rows are counted and
  // withheld on every page, never surfaced by a later continuation.
  after: `SELECT * FROM ${quoted(spec.name)} WHERE ${notNull(spec)} AND (${order(spec)}) > (${spec.pk.map(() => "?").join(", ")}) ORDER BY ${order(spec)} LIMIT ?`,
  exact: `SELECT * FROM ${quoted(spec.name)} WHERE ${spec.pk.map(column => `${quoted(column)} COLLATE BINARY = ?`).join(" AND ")}`,
})]));
const ALLOWED = new Set([SCHEMA_SQL, CHANGES_SQL, TABLE_INFO_SQL, ...[...STATEMENTS.values()].flatMap(Object.values)]);
const UNKNOWN_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const unknownCount = name => `SELECT COUNT(*) AS n FROM ${quoted(name)}`;
const UNKNOWN_COUNT = /^SELECT COUNT\(\*\) AS n FROM "[A-Za-z][A-Za-z0-9_]{0,127}"$/;

// The only storage surface the inventory can reach: allowlisted reads, list
// and getAlarm. No exec of caller text, put, delete, alarm or transaction.
export function inventoryCapability(storage, nonce) {
  const sql = storage.sql;
  return Object.freeze({
    nonce,
    query(statement, ...bindings) {
      if (!ALLOWED.has(statement) && !UNKNOWN_COUNT.test(statement)) throw new InventoryError("statement_not_allowed", 500);
      if (!bindings.every(value => value === null || ["string", "number"].includes(typeof value) || value instanceof Uint8Array || value instanceof ArrayBuffer)) {
        throw new InventoryError("binding_not_allowed", 500);
      }
      return [...sql.exec(statement, ...bindings)];
    },
    list: options => storage.list(options),
    getAlarm: () => storage.getAlarm(),
  });
}

async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
const byteLength = text => new TextEncoder().encode(text).byteLength;

function base64(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
function encodeKey(value) {
  if (value instanceof ArrayBuffer) return { $blob: base64(new Uint8Array(value)) };
  if (value instanceof Uint8Array) return { $blob: base64(value) };
  return value;
}
function decodeKey(value) {
  if (value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (value && typeof value === "object" && Object.keys(value).length === 1 && typeof value.$blob === "string") {
    return Uint8Array.from(atob(value.$blob), char => char.charCodeAt(0));
  }
  throw new InventoryError("invalid_cursor_key");
}

function scalar(value) {
  if (typeof value === "string") return value.length > LONG_STRING ? { long_string: value.length } : value;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined) return null;
  if (value instanceof ArrayBuffer || value instanceof Uint8Array) return { blob_bytes: value.byteLength };
  return { type: typeof value };
}

// Bounded walk collecting identity scalars by path and array sizes as
// embedded record counts. Secret-like keys are named, never valued.
export function identityProjection(value, cap = 256) {
  const fields = {}, counts = {}, redacted = [];
  let entries = 0, truncated = false;
  const visit = (node, path, depth, parentKey) => {
    if (truncated) return;
    if (depth > 8) { truncated = true; return; }
    if (Array.isArray(node)) {
      counts[path || "$"] = node.length;
      node.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1, parentKey));
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, item] of Object.entries(node)) {
      const next = path ? `${path}.${key}` : key;
      if (SECRET_KEY.test(key) && key !== "account_key" && key !== "legacy_key" && key !== "storage_account_key" && key !== "target_key") {
        redacted.push(next);
        continue;
      }
      if (item && typeof item === "object") visit(item, next, depth + 1, key);
      else if (IDENTITY_KEYS.has(key) && (key !== "id" || parentKey !== undefined)) {
        if (++entries > cap) { truncated = true; return; }
        fields[next] = scalar(item);
      }
    }
  };
  visit(value, "", 0, undefined);
  return { fields, counts, redacted, truncated };
}

function parseJson(text) {
  if (text === null || text === undefined) return { state: "null" };
  if (typeof text !== "string") return { state: "non_text", type: scalar(text) };
  try { return { state: "valid", bytes: byteLength(text), value: JSON.parse(text) }; }
  catch { return { state: "invalid_json", bytes: byteLength(text) }; }
}
function jsonIdentity(text, cap) {
  const parsed = parseJson(text);
  if (parsed.state !== "valid") return parsed;
  return { state: "valid", bytes: parsed.bytes, ...identityProjection(parsed.value, cap) };
}
function opaque(text) {
  const parsed = parseJson(text);
  return parsed.state === "valid" ? { state: "valid", bytes: parsed.bytes } : parsed;
}
function objectKeys(text) {
  const parsed = parseJson(text);
  if (parsed.state !== "valid") return parsed;
  const value = parsed.value;
  return value && typeof value === "object" && !Array.isArray(value)
    ? { state: "valid", bytes: parsed.bytes, keys: Object.keys(value).sort() }
    : { state: "unexpected_shape", bytes: parsed.bytes };
}

// The two values saveAccountSettingDeclaration() accepts. Each field reports
// absent, null, an accepted value, or an invalid value by type only.
const DECLARATION_VALUES = Object.freeze({ environment: ["live", "paper"], account_type: ["cash", "margin"] });
function declarationField(object, field) {
  if (!Object.hasOwn(object, field)) return { present: false };
  const item = object[field];
  if (item === null) return { present: true, value: null, valid: true };
  return DECLARATION_VALUES[field].includes(item) ? { present: true, value: item, valid: true }
    : { present: true, valid: false, value_type: Array.isArray(item) ? "array" : typeof item };
}
function declarationProjection(text) {
  const parsed = parseJson(text);
  if (parsed.state !== "valid") return parsed;
  const value = parsed.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { state: "unexpected_shape", bytes: parsed.bytes };
  return { state: "valid", bytes: parsed.bytes, environment: declarationField(value, "environment"),
    account_type: declarationField(value, "account_type"),
    unexpected_keys: Object.keys(value).filter(name => !Object.hasOwn(DECLARATION_VALUES, name)).sort() };
}

const CONFIG_IDENTITY = ["key", "target_name", "account_selector", "deployment_selector", "account_scope", "service_name",
  "runtime_status_target_id", "github_environment", "variable_scope", "broker_environment", "default_execution_mode", "default_strategy_profile"];
function instanceIdentity(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return { unexpected_shape: true };
  const config = item.config && typeof item.config === "object" && !Array.isArray(item.config) ? item.config : null;
  const out = {};
  for (const field of ["platform", "key", "kind", "enabled", "platform_applied", "application_status", "retirement_status", "created_at", "updated_at"]) {
    out[field] = scalar(item[field]);
  }
  out.config = config ? Object.fromEntries(CONFIG_IDENTITY.filter(field => field in config).map(field => [field, scalar(config[field])])) : null;
  out.top_config_key_mismatch = config ? config.key !== item.key : null;
  return out;
}

// Binance wallet history stores `<legacy_key>:<binding_id>` composites.
function logicalAccount(accountKey) {
  const match = typeof accountKey === "string" ? /^(.*):([a-f0-9]{64})$/.exec(accountKey) : null;
  return match ? { legacy_key: match[1], binding_id: match[2], composite: true } : undefined;
}

function projectRow(spec, row, { nested = null, nestedSize = 0 } = {}) {
  const out = { pk: spec.pk.map(column => encodeKey(row[column])) };
  const columns = {}, unexpected = [];
  for (const [name, value] of Object.entries(row)) {
    if (spec.pk.includes(name)) continue;
    if (spec.copy.includes(name)) columns[name] = scalar(value);
    else if (spec.json.includes(name)) columns[name] = jsonIdentity(value, 256);
    else if (spec.opaque.includes(name)) columns[name] = opaque(value);
    else if (spec.redact.includes(name)) columns[name] = { present: value !== null && value !== undefined && value !== "" };
    else if (spec.keys?.includes(name)) columns[name] = objectKeys(value);
    else if (spec.declaration === name) columns[name] = declarationProjection(value);
    else if (spec.history === name) {
      const parsed = parseJson(value);
      columns[name] = parsed.state !== "valid" ? parsed : !parsed.value || typeof parsed.value !== "object" ? { state: "unexpected_shape" } : {
        state: "valid", bytes: parsed.bytes, revision: scalar(parsed.value.revision), ts: scalar(parsed.value.ts),
        action: scalar(parsed.value.action), actor_present: Boolean(parsed.value.login),
        before: parsed.value.before ? instanceIdentity(parsed.value.before) : null,
        after: parsed.value.after ? instanceIdentity(parsed.value.after) : null,
      };
    } else if (spec.reportMetadata === name) {
      const parsed = parseJson(value);
      const meta = parsed.value;
      columns[name] = parsed.state !== "valid" ? parsed : !meta || typeof meta !== "object" ? { state: "unexpected_shape" } : {
        state: "valid", bytes: parsed.bytes, report_count: Array.isArray(meta.reports) ? meta.reports.length : null,
        reports_truncated: scalar(meta.reports_truncated ?? null), untracked_payload_write: scalar(meta.untracked_payload_write ?? null),
      };
    } else if (spec.nested === name) {
      const parsed = parseJson(value);
      if (parsed.state !== "valid") columns[name] = parsed;
      else if (!Array.isArray(parsed.value)) columns[name] = { state: "unexpected_shape", bytes: parsed.bytes };
      else {
        const offset = nested?.offset ?? 0;
        columns[name] = { state: "valid", bytes: parsed.bytes, entry_count: parsed.value.length, entries_offset: offset,
          entries: parsed.value.slice(offset, offset + nestedSize).map(instanceIdentity) };
      }
    } else unexpected.push(name);
  }
  for (const name of [...spec.copy, ...spec.json, ...spec.opaque, ...spec.redact, ...(spec.declaration ? [spec.declaration] : [])]) {
    if (!(name in row)) columns[name] = { column_absent: true };
  }
  out.columns = columns;
  if (unexpected.length) out.unexpected_columns = unexpected.sort();
  const logical = logicalAccount(row.account_key);
  if (logical) out.logical_account = logical;
  if (spec.name === "binance_detail_daily" && typeof row.observation_date === "string" && row.observation_date.startsWith("digest:")) {
    out.digest_record = { business_day: row.observation_date.slice("digest:".length) };
  }
  return out;
}

// One synchronous read of schema and the connection change counter. In this
// runtime total_changes() advances on every committed row change (SQL and
// DO-KV, including alarms) and stays fixed under reads. getCurrentBookmark()
// is deliberately not called: the local runtime advances it on every call.
function observeSync(cap) {
  const schema = cap.query(SCHEMA_SQL).map(row => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql ?? null }));
  const changes = Number(cap.query(CHANGES_SQL)[0]?.n);
  return { schema, changes };
}
async function fingerprints(cap, observed, alarm) {
  const schema = await sha256Hex(JSON.stringify(observed.schema));
  const stability = await sha256Hex(JSON.stringify([cap.nonce, observed.changes, alarm ?? null, schema]));
  return { schema, stability };
}

function tableInfo(cap, name) {
  const columns = cap.query(TABLE_INFO_SQL, name).map(row => ({ name: row.name, type: row.type, pk: Number(row.pk) }));
  return { columns, pk: columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name) };
}

function schemaManifest(cap, observed) {
  const present = new Set(observed.schema.filter(row => row.type === "table").map(row => row.name));
  const tables = {};
  for (const spec of TABLES) {
    if (!present.has(spec.name)) { tables[spec.name] = { group: spec.group, present: false, lazy: spec.lazy || null }; continue; }
    const info = tableInfo(cap, spec.name);
    const actual = info.columns.map(column => column.name);
    const statements = STATEMENTS.get(spec.name);
    const pkMatches = info.pk.join("\u0000") === spec.pk.join("\u0000");
    tables[spec.name] = {
      group: spec.group, present: true, count_only: spec.countOnly || null,
      columns: actual, missing_columns: spec.columns.filter(name => !actual.includes(name)),
      unexpected_columns: actual.filter(name => !spec.columns.includes(name)),
      primary_key: info.pk, primary_key_matches: pkMatches,
      row_count: Number(cap.query(statements.count)[0].n),
      null_key_rows: pkMatches ? Number(cap.query(statements.nullKeys)[0].n) : null,
    };
  }
  const other = [];
  for (const row of observed.schema) {
    if (row.type === "table" && INVENTORY_TABLES[row.name]) continue;
    const internal = row.name.startsWith("_cf_") ? "platform_internal" : row.name.startsWith("sqlite_") ? "sqlite_internal" : null;
    const entry = { type: row.type, name: row.name, tbl_name: row.tbl_name, classification: internal || (row.type === "table" ? "unknown_table" : row.type) };
    if (!internal && row.type === "table") {
      entry.row_count = UNKNOWN_IDENTIFIER.test(row.name) ? Number(cap.query(unknownCount(row.name))[0].n) : null;
      if (entry.row_count === null) entry.error = "unsupported_identifier";
      entry.columns = tableInfo(cap, row.name).columns.map(column => column.name);
    }
    other.push(entry);
  }
  const known = Object.values(tables);
  const unknownTables = other.filter(entry => entry.classification === "unknown_table");
  const state = !known.some(table => table.present) && !unknownTables.length ? "schema_absent"
    : known.every(table => table.present ? !table.missing_columns.length && table.primary_key_matches : table.lazy) ? "current" : "partial";
  return {
    schema_state: state, tables, other_schema_objects: other,
    missing_tables: TABLES.filter(spec => !tables[spec.name].present).map(spec => spec.name),
    incompatible_tables: known.filter(table => table.present && (!table.primary_key_matches || table.missing_columns.length)).length,
  };
}

function pageSize(value) {
  if (value === undefined || value === null) return INVENTORY_PAGE_SIZE.default;
  if (!Number.isSafeInteger(value) || value < 1 || value > INVENTORY_PAGE_SIZE.max) throw new InventoryError("invalid_page_size");
  return value;
}
const HEX64 = /^[a-f0-9]{64}$/;
function requireScan(scan) {
  if (!scan || typeof scan !== "object" || Array.isArray(scan) || typeof scan.scan_id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(scan.scan_id)
    || !HEX64.test(scan.schema) || !HEX64.test(scan.stability)) throw new InventoryError("invalid_scan");
  return scan;
}
function assertStable(scan, current) {
  if (current.schema !== scan.schema) throw new InventoryError("schema_changed", 409);
  if (current.stability !== scan.stability) throw new InventoryError("changed_during_scan", 409);
}

async function sqlPage(cap, command) {
  const spec = INVENTORY_TABLES[command.table];
  if (!spec) throw new InventoryError("unsupported_table");
  if (spec.countOnly) throw new InventoryError("count_only_table");
  const scan = requireScan(command.scan);
  const size = pageSize(command.page_size);
  const after = command.after ?? null;
  if (after !== null && (typeof after !== "object" || Array.isArray(after))) throw new InventoryError("invalid_cursor");
  const last = after?.last === undefined || after?.last === null ? null : after.last;
  if (last !== null && (!Array.isArray(last) || last.length !== spec.pk.length)) throw new InventoryError("invalid_cursor");
  const nested = after?.nested ?? null;
  if (nested !== null && (!spec.nested || !Array.isArray(nested.pk) || nested.pk.length !== spec.pk.length
    || !Number.isSafeInteger(nested.offset) || nested.offset < 1 || !HEX64.test(nested.payload_sha256)
    || JSON.stringify(nested.pk) !== JSON.stringify(last))) throw new InventoryError("invalid_cursor");
  const alarm = await cap.getAlarm();
  const observed = observeSync(cap);
  const present = observed.schema.some(row => row.type === "table" && row.name === spec.name);
  let rows = [], rowCount = 0, nullKeys = 0, info = null, nestedRow = null;
  if (present) {
    info = tableInfo(cap, spec.name);
    if (info.pk.join("\u0000") === spec.pk.join("\u0000")) {
      const statements = STATEMENTS.get(spec.name);
      rowCount = Number(cap.query(statements.count)[0].n);
      nullKeys = Number(cap.query(statements.nullKeys)[0].n);
      if (nested) nestedRow = cap.query(statements.exact, ...nested.pk.map(decodeKey))[0] ?? null;
      rows = last === null ? cap.query(statements.first, size + 1) : cap.query(statements.after, ...last.map(decodeKey), size + 1);
    }
  }
  const alarmAfter = await cap.getAlarm();
  const current = await fingerprints(cap, observed, alarm);
  assertStable(scan, current);
  if ((alarmAfter ?? null) !== (alarm ?? null) || Number(cap.query(CHANGES_SQL)[0]?.n) !== observed.changes) throw new InventoryError("changed_during_scan", 409);
  if (!present) return { ok: true, table: spec.name, present: false, rows: [], row_count: 0, terminal: true, next: null };
  if (info.pk.join("\u0000") !== spec.pk.join("\u0000")) throw new InventoryError("primary_key_mismatch", 409);
  const base = { ok: true, table: spec.name, present: true, row_count: rowCount, null_key_rows: nullKeys };
  if (nested) {
    // Continue one row's nested entries, tied to the unchanged stored value.
    if (!nestedRow) throw new InventoryError("changed_during_scan", 409);
    if (await sha256Hex(String(nestedRow[spec.nested])) !== nested.payload_sha256) throw new InventoryError("changed_during_scan", 409);
    const projected = projectRow(spec, nestedRow, { nested, nestedSize: size });
    const entries = projected.columns[spec.nested];
    const next = entries.entries_offset + entries.entries.length < entries.entry_count
      ? { last: nested.pk, nested: { ...nested, offset: entries.entries_offset + entries.entries.length } }
      : rows.length ? { last: nested.pk, nested: null } : null;
    return { ...base, rows: [projected], nested_continuation: true, terminal: next === null, byte_limited: false, next };
  }
  const out = [];
  let bytes = 0, next = null, byteLimited = false, lastPk = null;
  const lookahead = rows.length > size;
  for (const row of rows.slice(0, size)) {
    // Cursors continue from the raw key; actor-keyed rows export only its digest.
    const rawPk = spec.pk.map(column => encodeKey(row[column]));
    const pk = spec.actorKey ? [{ actor_key_sha256: await sha256Hex(JSON.stringify(rawPk)) }] : rawPk;
    let projected;
    try { projected = { ...projectRow(spec, row, { nestedSize: size }), pk }; }
    catch { projected = { pk, projection_error: "row_projection_failed" }; }
    let text = JSON.stringify(projected);
    if (byteLength(text) > ROW_BYTE_LIMIT) {
      projected = { pk, projection_error: "row_projection_too_large" };
      text = JSON.stringify(projected);
    }
    if (out.length && bytes + byteLength(text) > RESPONSE_BYTE_BUDGET) { byteLimited = true; break; }
    bytes += byteLength(text);
    out.push(projected);
    lastPk = rawPk;
    const entries = spec.nested ? projected.columns?.[spec.nested] : null;
    if (entries?.entries && entries.entries.length < entries.entry_count) {
      next = { last: rawPk, nested: { pk: rawPk, offset: entries.entries.length,
        payload_sha256: await sha256Hex(String(row[spec.nested])) } };
      break;
    }
  }
  if (!next && (lookahead || byteLimited) && out.length) next = { last: lastPk, nested: null };
  return { ...base, rows: out, terminal: next === null, byte_limited: byteLimited, next };
}

const utf8 = new TextEncoder();
function compareBytes(left, right) {
  const a = utf8.encode(left), b = utf8.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}

const ADMISSION_PREFIX = "desk:readbacks:admission:";
function projectDoKv(key, value, now) {
  const expiry = record => Number.isFinite(record?.expires) ? { expires: record.expires, expired: record.expires <= now } : {};
  if (key.startsWith("desk:readbacks:record:")) {
    const payload = value?.payload;
    return { family: "desk_readback_record", readback_id: key.slice("desk:readbacks:record:".length), ...expiry(value),
      owner_present: Boolean(value?.owner), actor_present: Boolean(value?.actor),
      payload_state: scalar(payload?.state ?? null), pending: Array.isArray(value?.pending) ? value.pending.map(scalar) : null,
      result_count: Array.isArray(value?.results) ? value.results.length : null,
      payload_identity: payload && typeof payload === "object" ? identityProjection(payload, 128) : null };
  }
  if (key.startsWith(ADMISSION_PREFIX)) {
    return { family: "desk_readback_admission", ...expiry(value),
      active: scalar(value?.active ?? null), next_allowed: scalar(value?.nextAllowed ?? null) };
  }
  if (key.startsWith("desk:idempotency:")) {
    return { family: "desk_idempotency", state: scalar(value?.state ?? null), request_id: scalar(value?.request_id ?? null),
      fingerprint_present: Boolean(value?.fingerprint), response_status: scalar(value?.response?.status ?? null) };
  }
  if (key === "console-kv-directory-v1") {
    return { family: "kv_directory_state", complete: scalar(value?.complete ?? null),
      key_count: Array.isArray(value?.keys) ? value.keys.length : null, cursor_present: Boolean(value?.cursor),
      scanned_at: scalar(value?.scanned_at ?? null), retry_at: scalar(value?.retry_at ?? null), list_day: scalar(value?.list_day ?? null),
      list_attempts: scalar(value?.list_attempts ?? null), error: scalar(value?.error ?? null),
      last_error: scalar(value?.last_error?.code ?? null), mirror_dirty: scalar(value?.mirror_dirty ?? null) };
  }
  if (key === "console-current-strategies-write-v1") {
    return { family: "current_strategies_write_state", ts: scalar(value?.ts ?? null), signature_present: Boolean(value?.signature) };
  }
  return { family: "unknown", flag: "unknown_key", value_type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value };
}

async function doKvPage(cap, command) {
  const scan = requireScan(command.scan);
  const size = pageSize(command.page_size);
  const last = command.after?.last ?? null;
  if (last !== null && (typeof last !== "string" || !last)) throw new InventoryError("invalid_cursor");
  const alarm = await cap.getAlarm();
  const observed = observeSync(cap);
  const listing = await cap.list(last === null ? { limit: size + 1 } : { limit: size + 1, startAfter: last });
  const alarmAfter = await cap.getAlarm();
  const changesAfter = Number(cap.query(CHANGES_SQL)[0]?.n);
  assertStable(scan, await fingerprints(cap, observed, alarm));
  if ((alarmAfter ?? null) !== (alarm ?? null) || changesAfter !== observed.changes) throw new InventoryError("changed_during_scan", 409);
  const now = Date.now();
  const keys = [];
  let previous = last;
  for (const [key, value] of listing) {
    if (typeof key !== "string" || (previous !== null && compareBytes(key, previous) <= 0)) throw new InventoryError("listing_progression_invalid", 502);
    previous = key;
    keys.push([key, value]);
  }
  const lookahead = keys.length > size;
  const out = [];
  let bytes = 0, byteLimited = false;
  let lastKey = null;
  for (const [key, value] of keys.slice(0, size)) {
    // Admission keys embed a console login: export the key's digest only.
    const shown = key.startsWith(ADMISSION_PREFIX) ? `${ADMISSION_PREFIX}sha256:${await sha256Hex(key)}` : key;
    let projected;
    try { projected = { key: shown, ...projectDoKv(key, value, now) }; }
    catch { projected = { key: shown, projection_error: "value_projection_failed" }; }
    const length = byteLength(JSON.stringify(projected));
    if (out.length && bytes + length > RESPONSE_BYTE_BUDGET) { byteLimited = true; break; }
    bytes += length;
    out.push(projected);
    lastKey = key;
  }
  const next = (lookahead || byteLimited) && out.length ? { last: lastKey } : null;
  return { ok: true, entries: out, terminal: next === null, byte_limited: byteLimited, next, alarm: alarm ?? null };
}

async function schemaPage(cap) {
  const alarm = await cap.getAlarm();
  const observed = observeSync(cap);
  const manifest = schemaManifest(cap, observed);
  const alarmAfter = await cap.getAlarm();
  if ((alarmAfter ?? null) !== (alarm ?? null) || Number(cap.query(CHANGES_SQL)[0]?.n) !== observed.changes) throw new InventoryError("changed_during_scan", 409);
  const current = await fingerprints(cap, observed, alarm);
  return { ok: true, ...manifest, alarm: alarm ?? null, stability_method: "connection_total_changes_v1",
    bookmark: { read: false, reason: "bookmark_read_not_proven_read_only" },
    scan: { scan_id: crypto.randomUUID(), schema: current.schema, stability: current.stability } };
}

async function finalizePage(cap, command) {
  const scan = requireScan(command.scan);
  const alarm = await cap.getAlarm();
  const observed = observeSync(cap);
  const manifest = schemaManifest(cap, observed);
  const current = await fingerprints(cap, observed, alarm);
  const stable = current.schema === scan.schema && current.stability === scan.stability;
  return { ok: true, stable, reason: stable ? null : current.schema !== scan.schema ? "schema_changed" : "changed_during_scan",
    schema_state: manifest.schema_state,
    row_counts: Object.fromEntries(Object.entries(manifest.tables).map(([name, table]) => [name, table.present ? table.row_count : null])),
    null_key_rows: Object.fromEntries(Object.entries(manifest.tables).map(([name, table]) => [name, table.present ? table.null_key_rows : null])),
    alarm: alarm ?? null };
}

const COMMAND_FIELDS = new Set(["section", "object", "table", "page_size", "scan", "after"]);
export async function inventoryResponse(request, cap) {
  const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" } });
  try {
    if (request.method !== "POST") throw new InventoryError("method_not_allowed", 405);
    const text = await request.text();
    if (byteLength(text) > REQUEST_BYTE_LIMIT) throw new InventoryError("invalid_request");
    let command;
    try { command = JSON.parse(text); } catch { throw new InventoryError("invalid_request"); }
    if (!command || typeof command !== "object" || Array.isArray(command) || Object.keys(command).some(key => !COMMAND_FIELDS.has(key))) {
      throw new InventoryError("invalid_request");
    }
    if (!Object.hasOwn(INVENTORY_OBJECTS, command.object)) throw new InventoryError("unsupported_object");
    const base = { schema_version: INVENTORY_SCHEMA_VERSION, object: command.object, section: command.section,
      ordering: INVENTORY_ORDERING, observed_at: new Date().toISOString() };
    if (command.section === "schema") return respond({ ...base, ...await schemaPage(cap) });
    if (command.section === "sql") return respond({ ...base, ...await sqlPage(cap, command) });
    if (command.section === "do_kv") return respond({ ...base, ...await doKvPage(cap, command) });
    if (command.section === "finalize") return respond({ ...base, ...await finalizePage(cap, command) });
    throw new InventoryError("unsupported_section");
  } catch (error) {
    // Fixed codes only: never echo stored values, statements or provider text.
    return error instanceof InventoryError ? respond({ ok: false, error: error.code }, error.status) : respond({ ok: false, error: "inventory_read_failed" }, 500);
  }
}
