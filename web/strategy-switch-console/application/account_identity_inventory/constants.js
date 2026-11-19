// Account-identity inventory constants: schema version, route and object
// names, table specifications, the fixed read statements and their
// allowlist, field vocabularies, KV families and every byte, page, depth,
// cursor and projection bound. No imports, no I/O.
export const INVENTORY_ROUTE = "/api/admin/account-identity-inventory";
export const INVENTORY_DO_PATH = "/internal/account-identity-inventory";
export const INVENTORY_SCHEMA_VERSION = "qsl_account_identity_inventory.v1";
export const INVENTORY_ORDERING = "primary_key_binary_v1";
export const INVENTORY_OBJECTS = Object.freeze({ runtime: "runtime-instances", directory: "console-kv-directory-v1" });
export const INVENTORY_PAGE_SIZE = Object.freeze({ default: 100, max: 500 });
export const RESPONSE_BYTE_BUDGET = 1_500_000;
export const ROW_BYTE_LIMIT = 256_000;
export const REQUEST_BYTE_LIMIT = 16_384;
export const LONG_STRING = 512;
// Identity projection bounds: object depth, and fields per projected value
// for a SQL JSON column, a Desk record payload and a KV value or binding.
export const PROJECTION_MAX_DEPTH = 8;
export const ROW_IDENTITY_FIELDS = 256;
export const DESK_IDENTITY_FIELDS = 128;
export const KV_IDENTITY_FIELDS = 4000;
export const CACHE_ACCOUNTS = 4000;

// Identity, reference and status fields only. Amounts, balances, positions,
// actors, credentials and free text are never copied from stored JSON.
export const IDENTITY_KEYS = new Set(["platform", "platform_id", "key", "legacy_key", "account_key", "storage_account_key",
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
export const SECRET_KEY = /token|secret|password|passwd|credential|factor|cookie|session|authorization|bearer|private_key|api_key|signature|otp|seed/i;

const c = (name, group, pk, columns, fields = {}) => Object.freeze({
  name, group, pk, columns, copy: [], json: [], opaque: [], redact: [], ...fields,
});
// Columns are the current ordinary-path schema, including ALTER-added columns.
export const TABLE_SPECS = Object.freeze([
  c("instance_state", 1, ["id"], ["id", "revision", "payload"], { copy: ["revision"], nested: "payload" }),
  c("instance_history", 1, ["revision"], ["revision", "entry"], { history: "entry" }),
  c("account_setting_draft", 2, ["platform", "account_key"], ["platform", "account_key", "revision", "identity_json", "overrides_json", "updated_at"],
    { copy: ["revision", "updated_at"], json: ["identity_json"], keys: ["overrides_json"] }),
  c("account_setting_declaration", 2, ["platform", "account_key"], ["platform", "account_key", "revision", "identity_json", "declaration_json"],
    { copy: ["revision"], json: ["identity_json"], declaration: "declaration_json" }),
  c("account_management_draft", 2, ["platform", "account_key"], ["platform", "account_key", "revision", "identity_json", "membership_json",
    "management_enabled", "base_applied_revision", "policy_revision", "instance_revision", "status", "consumed_applied_revision",
    "updated_by", "updated_at"],
  { copy: ["revision", "management_enabled", "base_applied_revision", "policy_revision", "instance_revision", "status",
    "consumed_applied_revision", "updated_at"], json: ["identity_json", "membership_json"], redact: ["updated_by"] }),
  c("account_management_applied", 2, ["platform", "account_key"], ["platform", "account_key", "revision", "identity_json", "membership_json",
    "management_enabled", "effective_at"],
  { copy: ["revision", "management_enabled", "effective_at"], json: ["identity_json", "membership_json"] }),
  c("account_setting_profile_application", 3, ["request_key"], ["request_key", "platform", "account_key", "identity_json", "instance_revision",
    "draft_revision", "old_profile", "new_profile", "approved_by", "approved_at", "status", "workflow_run_id", "workflow_run_attempt", "claimed_at"],
  { copy: ["platform", "account_key", "instance_revision", "draft_revision", "old_profile", "new_profile", "approved_at", "status",
    "workflow_run_id", "workflow_run_attempt", "claimed_at"], json: ["identity_json"], redact: ["approved_by"] }),
  c("account_management_change", 3, ["event_id"], ["event_id", "occurred_at", "actor", "platform", "account_key", "initiating_identity_json",
    "members_json", "policy_revision", "instance_revision", "draft_revision", "old_applied_revision", "new_applied_revision",
    "old_management_enabled", "new_management_enabled", "result"],
  { copy: ["occurred_at", "platform", "account_key", "policy_revision", "instance_revision", "draft_revision", "old_applied_revision",
    "new_applied_revision", "old_management_enabled", "new_management_enabled", "result"],
  json: ["initiating_identity_json", "members_json"], redact: ["actor"] }),
  c("account_management_invalidation", 2, ["platform", "account_key"], ["platform", "account_key", "policy_revision", "applied_revision",
    "draft_revision", "invalidated_at"],
  { copy: ["policy_revision", "applied_revision", "draft_revision", "invalidated_at"] }),
  c("account_management_requests", 3, ["request_key"], ["request_key", "operation", "actor", "platform", "account_key", "identity_json",
    "fingerprint", "receipt_json", "created_at"],
  { copy: ["operation", "platform", "account_key", "created_at"], json: ["identity_json", "receipt_json"], redact: ["actor", "fingerprint"] }),
  c("risk_profile_authority", 4, ["id"], ["id", "revision", "imported", "bindings_json"], { copy: ["revision", "imported"], json: ["bindings_json"] }),
  c("account_mapping_policy", 4, ["id"], ["id", "policy_revision", "policy_json", "updated_at"],
    { copy: ["policy_revision", "updated_at"], json: ["policy_json"] }),
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
    "workflow_run_id", "workflow_run_attempt", "reason_code", "readback_json", "created_at", "updated_at", "management_binding_json"],
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
// Reviewed index definitions the inventory verifies when their table exists.
// `sql` is the normalized stored definition: key columns in order, uniqueness
// and any partial predicate are part of it.
export const INDEX_SPECS = Object.freeze([
  Object.freeze({ name: "account_management_change_time", table: "account_management_change",
    sql: "create index account_management_change_time on account_management_change (occurred_at, event_id)" }),
]);
export const INVENTORY_TABLES = Object.freeze(Object.fromEntries(TABLE_SPECS.map(spec => [spec.name, spec])));

export const SCHEMA_SQL = "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name COLLATE BINARY, type COLLATE BINARY";
export const CHANGES_SQL = "SELECT total_changes() AS n";
export const TABLE_INFO_SQL = "SELECT name, type, pk FROM pragma_table_info(?) ORDER BY cid";
const quoted = name => `"${name}"`;
const order = spec => spec.pk.map(column => `${quoted(column)} COLLATE BINARY`).join(", ");
const notNull = spec => spec.pk.map(column => `${quoted(column)} IS NOT NULL`).join(" AND ");
export const STATEMENTS = new Map(TABLE_SPECS.map(spec => [spec.name, Object.freeze({
  count: `SELECT COUNT(*) AS n FROM ${quoted(spec.name)}`,
  nullKeys: `SELECT COUNT(*) AS n FROM ${quoted(spec.name)} WHERE NOT (${notNull(spec)})`,
  first: `SELECT * FROM ${quoted(spec.name)} WHERE ${notNull(spec)} ORDER BY ${order(spec)} LIMIT ?`,
  // Same non-null condition as the first page: NULL-key rows are counted and
  // withheld on every page, never surfaced by a later continuation.
  after: `SELECT * FROM ${quoted(spec.name)} WHERE ${notNull(spec)} AND (${order(spec)}) > (${spec.pk.map(() => "?").join(", ")}) ORDER BY ${order(spec)} LIMIT ?`,
  exact: `SELECT * FROM ${quoted(spec.name)} WHERE ${spec.pk.map(column => `${quoted(column)} COLLATE BINARY = ?`).join(" AND ")}`,
})]));
export const ALLOWED = new Set([SCHEMA_SQL, CHANGES_SQL, TABLE_INFO_SQL, ...[...STATEMENTS.values()].flatMap(Object.values)]);
export const UNKNOWN_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
export const unknownCount = name => `SELECT COUNT(*) AS n FROM ${quoted(name)}`;
export const UNKNOWN_COUNT = /^SELECT COUNT\(\*\) AS n FROM "[A-Za-z][A-Za-z0-9_]{0,127}"$/;

// `current_strategies_cache` qualifiers copied from an account entry.
export const CACHE_QUALIFIERS = ["account_selector", "target_name", "target_id", "deployment_selector", "account_scope", "service_name",
  "broker_environment", "runtime_status_target_id"];
// The two values saveAccountSettingDeclaration() accepts.
export const DECLARATION_VALUES = Object.freeze({ environment: ["live", "paper"], account_type: ["cash", "margin"] });
export const INSTANCE_FIELDS = ["platform", "key", "kind", "enabled", "platform_applied", "application_status", "retirement_status", "created_at", "updated_at"];
export const CONFIG_IDENTITY = ["key", "target_name", "account_selector", "deployment_selector", "account_scope", "service_name",
  "runtime_status_target_id", "github_environment", "variable_scope", "broker_environment", "default_execution_mode", "default_strategy_profile"];

// Durable Object KV families.
export const DESK_RECORD_PREFIX = "desk:readbacks:record:";
export const ADMISSION_PREFIX = "desk:readbacks:admission:";
export const IDEMPOTENCY_PREFIX = "desk:idempotency:";
export const DIRECTORY_STATE_KEY = "console-kv-directory-v1";
export const STRATEGIES_WRITE_STATE_KEY = "console-current-strategies-write-v1";
export const SNAPSHOT_OVERALL = new Set(["match", "drift", "unknown"]);

// Internal inventory command and the Worker route's sections and parameters.
export const COMMAND_FIELDS = new Set(["section", "object", "table", "page_size", "scan", "after"]);
export const HEX64 = /^[a-f0-9]{64}$/;
export const SCAN_ID = /^[A-Za-z0-9-]{8,64}$/;
export const SECTIONS = new Set(["manifest", "schema", "sql", "do_kv", "finalize", "kv", "env"]);
export const PARAMETERS = new Set(["section", "object", "table", "page_size", "cursor", "scan"]);
export const SECTION_PARAMETERS = Object.freeze({
  manifest: [], env: [], schema: ["object"], finalize: ["object", "scan"], kv: ["page_size", "cursor"],
  sql: ["object", "table", "page_size", "cursor", "scan"], do_kv: ["object", "page_size", "cursor", "scan"],
});
export const CURSOR_TTL_MS = 6 * 3600_000;
export const CURSOR_CLOCK_SKEW_MS = 60_000;
export const CURSOR_MAX_LENGTH = 8192;
export const CURSOR_CONTEXT = "qsl-account-identity-inventory-cursor-v1";
export const KV_PAGE_SIZE = Object.freeze({ default: 50, max: 100 });
export const KV_VALUE_MAX_BYTES = 2_000_000;
export const DO_ERRORS = new Set(["invalid_request", "unsupported_object", "unsupported_section", "unsupported_table", "count_only_table",
  "invalid_scan", "invalid_cursor", "invalid_cursor_key", "invalid_page_size", "schema_changed", "changed_during_scan",
  "primary_key_mismatch", "listing_progression_invalid", "statement_not_allowed", "binding_not_allowed", "method_not_allowed"]);

// Reviewed identity-bearing KV families. Values outside this list are named
// in the page but never fetched.
export const KV_KEYS = new Set(["account_options", "account_facts_bindings", "runtime_daily_bindings", "current_strategies_cache", "audit_log",
  "risk_profile_bindings", "private_binance_scope_report", "private_binance_account_facts", "console_kv_directory:v1"]);
export const KV_PREFIXES = ["runtime_daily:", "account_facts_primary_backup:", "research_promotion_ticket:", "owner_decision_intent:",
  "owner_decision_current:", "reconciliation_recovery_source:", "reconciliation_recovery_confirmation:", "reconciliation_recovery_current:",
  "private_binance_account_facts:", "control_plane_source:", "adaptive_selection_source:", "execution_evidence_source:",
  "runtime_target_lifecycle_source:", "research_task_source:"];
export const KV_EXCLUDED_KEYS = new Set(["auth_config", "strategy_profiles", "strategy_health_snapshot", "control_plane_snapshot",
  "control_plane_source_retirements", "m0_research_ledger_current"]);
export const KV_EXCLUDED_PREFIXES = ["m0_research_ledger_archive:"];
