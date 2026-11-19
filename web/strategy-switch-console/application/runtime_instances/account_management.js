// Per-physical-account management setting inside RuntimeInstances: the
// protected policy singleton, the shared draft and applied axes of each
// physical account, the append-only change journal and the request receipts.
// Every function here is synchronous over the Durable Object's own SQL handle
// and runs inside the caller's storage.transactionSync: no await, no network,
// no KV and no caller-supplied authority summary takes part.
//
// The live resolver reports `evidence_scope: runtime_instances_sqlite`. It
// covers what this object stores, and only that; it is not the full #1173
// inventory projection (`qsl_account_management_projection.v1`) and never
// claims its completeness.
import { HttpError } from "../http_error.js";
import {
  MANAGEMENT_STATUS,
  MAPPING_POLICY_FORMAT,
  SETTINGS_IDENTITY_FIELDS,
  deploymentId,
  effectiveManagementState,
  managementStatus,
  normalizeMappingPolicy,
  processingEligible,
  sameSettingsIdentity,
  validSettingsIdentity,
} from "../account_mapping/policy.js";
import { accountSettingsIdentity } from "../account_settings/helpers.js";
import { ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_KEY } from "../account_settings/constants.js";
import { canonicalResearchTaskJson } from "../research_task/helpers.js";

export const LIVE_RESOLUTION_FORMAT = "qsl_account_management_live_resolution.v1";
export const MANAGEMENT_EVIDENCE_SCOPE = "runtime_instances_sqlite";
export const MANAGEMENT_CHANGE_EVENT = "account_management_change";
export const POLICY_PROVISIONER_ACTOR = "account-mapping-policy-provisioner";

export function initializeAccountManagement(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS account_mapping_policy (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    policy_revision INTEGER NOT NULL,
    policy_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS account_management_draft (
    platform TEXT NOT NULL, account_key TEXT NOT NULL,
    revision INTEGER NOT NULL, identity_json TEXT NOT NULL, membership_json TEXT NOT NULL,
    management_enabled INTEGER NOT NULL, base_applied_revision INTEGER NOT NULL,
    policy_revision INTEGER NOT NULL, instance_revision INTEGER NOT NULL,
    status TEXT NOT NULL, consumed_applied_revision INTEGER,
    updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (platform, account_key)
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS account_management_applied (
    platform TEXT NOT NULL, account_key TEXT NOT NULL,
    revision INTEGER NOT NULL, identity_json TEXT NOT NULL, membership_json TEXT NOT NULL,
    management_enabled INTEGER NOT NULL, effective_at TEXT NOT NULL,
    PRIMARY KEY (platform, account_key)
  )`);
  // One row per physical apply; the request key is the event reference.
  sql.exec(`CREATE TABLE IF NOT EXISTS account_management_change (
    event_id TEXT PRIMARY KEY,
    occurred_at TEXT NOT NULL, actor TEXT NOT NULL,
    platform TEXT NOT NULL, account_key TEXT NOT NULL, initiating_identity_json TEXT NOT NULL,
    members_json TEXT NOT NULL,
    policy_revision INTEGER NOT NULL, instance_revision INTEGER NOT NULL, draft_revision INTEGER NOT NULL,
    old_applied_revision INTEGER NOT NULL, new_applied_revision INTEGER NOT NULL,
    old_management_enabled INTEGER, new_management_enabled INTEGER NOT NULL,
    result TEXT NOT NULL
  )`);
  sql.exec("CREATE INDEX IF NOT EXISTS account_management_change_time ON account_management_change (occurred_at, event_id)");
  // A policy replacement that changes a physical group (class, membership or
  // identities) leaves one row per affected deployment that held draft or applied
  // rows, recording the revisions they had. Rows at or below those revisions are
  // kept for history but are no longer a valid binding; only a newer draft or an
  // explicit apply (which writes above them) reconciles the group.
  sql.exec(`CREATE TABLE IF NOT EXISTS account_management_invalidation (
    platform TEXT NOT NULL, account_key TEXT NOT NULL,
    policy_revision INTEGER NOT NULL, applied_revision INTEGER NOT NULL, draft_revision INTEGER NOT NULL, invalidated_at TEXT NOT NULL,
    PRIMARY KEY (platform, account_key)
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS account_management_requests (
    request_key TEXT PRIMARY KEY,
    operation TEXT NOT NULL, actor TEXT NOT NULL,
    platform TEXT NOT NULL, account_key TEXT NOT NULL, identity_json TEXT NOT NULL,
    fingerprint TEXT NOT NULL, receipt_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`);
}

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const orderedIdentity = identity => Object.fromEntries(SETTINGS_IDENTITY_FIELDS.map(field => [field, identity[field]]));
const deploymentOrder = (left, right) => compare(deploymentId(left.platform, left.legacy_key), deploymentId(right.platform, right.legacy_key));
const rank = { known: 0, unknown: 1, conflict: 2 };

// The stored form of a normalized policy: deployments sorted within each
// account and accounts sorted, so a reordered document has the same content.
export function canonicalPolicyDocument(policy) {
  const accounts = policy.accounts.map(account => ({
    management_class: account.management_class,
    deployments: [...account.deployments].sort(deploymentOrder)
      .map(item => ({ platform: item.platform, legacy_key: item.legacy_key, identity: orderedIdentity(item.identity) })),
  })).map(account => [JSON.stringify(account), account]).sort(([left], [right]) => compare(left, right)).map(([, account]) => account);
  return { format: MAPPING_POLICY_FORMAT, policy_revision: policy.policy_revision, accounts };
}

// A physical account's membership snapshot: its policy deployments with
// their exact identities, in deployment order.
export const membershipOf = deployments => [...deployments].sort(deploymentOrder)
  .map(item => ({ platform: item.platform, legacy_key: item.legacy_key, identity: orderedIdentity(item.identity) }));

export function storedPolicy(row) {
  if (!row) return { reason: "management_policy_unavailable" };
  try {
    const policy = normalizeMappingPolicy(JSON.parse(row.policy_json));
    if (policy.policy_revision !== row.policy_revision) return { reason: "management_policy_invalid" };
    return { policy };
  } catch {
    return { reason: "management_policy_invalid" };
  }
}

// The reviewed local schema of the management tables and the journal index.
// The resolver compares live metadata with it in the same transaction; the
// full offline inventory stays a separate evidence source.
export const MANAGEMENT_TABLE_COLUMNS = Object.freeze({
  account_mapping_policy: ["id", "policy_revision", "policy_json", "updated_at"],
  account_management_draft: ["platform", "account_key", "revision", "identity_json", "membership_json", "management_enabled",
    "base_applied_revision", "policy_revision", "instance_revision", "status", "consumed_applied_revision", "updated_by", "updated_at"],
  account_management_applied: ["platform", "account_key", "revision", "identity_json", "membership_json", "management_enabled", "effective_at"],
  account_management_change: ["event_id", "occurred_at", "actor", "platform", "account_key", "initiating_identity_json", "members_json",
    "policy_revision", "instance_revision", "draft_revision", "old_applied_revision", "new_applied_revision", "old_management_enabled",
    "new_management_enabled", "result"],
  account_management_invalidation: ["platform", "account_key", "policy_revision", "applied_revision", "draft_revision", "invalidated_at"],
  account_management_requests: ["request_key", "operation", "actor", "platform", "account_key", "identity_json", "fingerprint", "receipt_json", "created_at"],
});
export const MANAGEMENT_JOURNAL_INDEX = Object.freeze({ name: "account_management_change_time", table: "account_management_change", columns: ["occurred_at", "event_id"] });

const sameList = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);

// Structural drift of the management tables, read-only and in the caller's
// transaction. A table that cannot be read at all is reported by the row
// reads, so an empty column list is not repeated here.
function schemaIssues(rows) {
  const issues = [];
  for (const [table, expected] of Object.entries(MANAGEMENT_TABLE_COLUMNS)) {
    const columns = rows(`schema:${table}`, `SELECT name FROM pragma_table_info('${table}') ORDER BY name`).map(row => row.name);
    if (columns.length && !sameList(columns, [...expected].sort())) issues.push(table);
  }
  const { name, table, columns } = MANAGEMENT_JOURNAL_INDEX;
  const listed = rows(`schema:${name}`, `SELECT "unique" AS is_unique FROM pragma_index_list('${table}') WHERE name = '${name}'`);
  const keyed = rows(`schema:${name}`, `SELECT name FROM pragma_index_info('${name}') ORDER BY seqno`).map(row => row.name);
  if (listed.length !== 1 || Number(listed[0].is_unique) !== 0 || !sameList(keyed, columns)) issues.push(name);
  return issues;
}

// Every local row the resolver checks, read synchronously in the caller's
// transaction. A table that cannot be read is reported, not skipped.
export function readManagementSnapshot(sql, state) {
  const unreadable = [];
  const rows = (name, statement) => {
    try { return sql.exec(statement).toArray(); } catch { unreadable.push(name); return []; }
  };
  return {
    state,
    policy: rows("account_mapping_policy", "SELECT policy_revision, policy_json FROM account_mapping_policy WHERE id = 1")[0] || null,
    history: rows("instance_history", "SELECT revision, entry FROM instance_history"),
    stored: [
      ...rows("account_setting_draft", "SELECT platform, account_key, identity_json FROM account_setting_draft"),
      ...rows("account_setting_declaration", "SELECT platform, account_key, identity_json FROM account_setting_declaration"),
      ...rows("account_setting_profile_application", "SELECT platform, account_key, identity_json FROM account_setting_profile_application"),
      ...rows("account_management_requests", "SELECT platform, account_key, identity_json FROM account_management_requests"),
    ],
    declarations: rows("account_setting_declaration", "SELECT platform, account_key, declaration_json FROM account_setting_declaration"),
    drafts: rows("account_management_draft", "SELECT * FROM account_management_draft"),
    applied: rows("account_management_applied", "SELECT * FROM account_management_applied"),
    journal: rows("account_management_change", "SELECT event_id, platform, account_key, initiating_identity_json, members_json FROM account_management_change"),
    invalidated: rows("account_management_invalidation", "SELECT platform, account_key, policy_revision, applied_revision, draft_revision FROM account_management_invalidation"),
    schema_issues: schemaIssues(rows),
    unreadable,
  };
}

// Reasons by the typed management conflict they produce.
const IDENTITY_REASONS = new Set(["physical_identity_changed", "top_config_key_mismatch", "history_identity_differs_from_current",
  "local_history_unreadable", "stored_identity_differs_from_current", "stored_identity_unreadable", "management_identity_differs_from_current",
  "management_record_unreadable", "management_journal_unreadable", "local_store_unreadable", "declared_environment_differs_from_current"]);
const MEMBERSHIP_REASONS = new Set(["deployment_unclassified", "deployment_claimed_by_multiple_accounts", "sibling_not_current",
  "sibling_duplicated", "sibling_retiring", "claimant_shadowing", "legacy_key_cross_platform_collision", "management_binding_changed"]);

function consistentRows(siblings, rows, fields) {
  const found = siblings.map(item => rows.filter(row => row.platform === item.platform && row.account_key === item.legacy_key));
  const present = found.filter(list => list.length).length;
  if (present === 0) return { state: "absent", rows: [] };
  if (present !== siblings.length || found.some(list => list.length > 1)) return { state: "partial", rows: found.flat() };
  const flat = found.flat();
  const agree = new Set(flat.map(row => JSON.stringify(fields.map(field => row[field])))).size === 1;
  return { state: agree ? "complete" : "conflict", rows: flat };
}

const DRAFT_FIELDS = ["revision", "management_enabled", "base_applied_revision", "policy_revision", "instance_revision", "status",
  "consumed_applied_revision", "membership_json"];

// Resolve the physical account of one deployment from local storage only.
export function resolveManagement(snapshot, platform, key) {
  const state = snapshot.state;
  const reasons = new Set();
  let evidence = "known";
  const flag = (reason, level) => { reasons.add(reason); if (rank[level] > rank[evidence]) evidence = level; };
  const result = {
    format: LIVE_RESOLUTION_FORMAT, evidence_scope: MANAGEMENT_EVIDENCE_SCOPE, platform, key,
    instance_revision: state?.initialized ? state.revision : null, policy_revision: null, management_class: null,
    deployments: [], membership_json: null, current_identity: null, applied: null, applied_state: "absent", draft: null, draft_state: "absent",
  };
  const finish = (effective = null) => {
    const identityEvidence = evidence;
    const status = effective ? managementStatus({ management_class: result.management_class, evidence_state: identityEvidence }, effective) : MANAGEMENT_STATUS.UNKNOWN;
    let evidenceState = identityEvidence;
    if (effective && identityEvidence === "known") {
      evidenceState = result.management_class === "display_only" ? (effective.evidence_state === "conflict" ? "conflict" : "known") : effective.evidence_state;
      for (const reason of effective.reasons) reasons.add(reason);
    }
    const row = { management_status: status, evidence_state: evidenceState };
    return { ...result, management_status: status, evidence_state: evidenceState, reasons: [...reasons].sort(), processing_eligible: processingEligible(row) };
  };
  for (const name of snapshot.unreadable || []) flag(name === "account_mapping_policy" ? "management_policy_unavailable" : "local_store_unreadable", "unknown");
  if ((snapshot.schema_issues || []).length) flag("management_schema_unverified", "unknown");
  if (!state?.initialized) { flag("runtime_instances_not_initialized", "unknown"); return finish(); }
  const parsed = storedPolicy(snapshot.policy);
  if (parsed.reason) { flag(parsed.reason, "unknown"); return finish(); }
  const policy = parsed.policy;
  result.policy_revision = policy.policy_revision;
  const target = deploymentId(platform, key);
  const claims = new Map();
  for (const account of policy.accounts) for (const item of account.deployments) {
    const id = deploymentId(item.platform, item.legacy_key);
    claims.set(id, (claims.get(id) || 0) + 1);
  }
  const owners = policy.accounts.filter(account => account.deployments.some(item => deploymentId(item.platform, item.legacy_key) === target));
  if (!owners.length) { flag("deployment_unclassified", "unknown"); return finish(); }
  if (owners.length > 1) { flag("deployment_claimed_by_multiple_accounts", "conflict"); return finish(); }
  const [account] = owners;
  result.management_class = account.management_class;
  result.deployments = membershipOf(account.deployments);
  result.membership_json = JSON.stringify(result.deployments);
  const siblingIds = new Set(result.deployments.map(item => deploymentId(item.platform, item.legacy_key)));
  const siblingPlatform = new Map(result.deployments.map(item => [item.legacy_key, item.platform]));
  const current = new Map();
  for (const item of result.deployments) {
    const id = deploymentId(item.platform, item.legacy_key);
    if (claims.get(id) > 1) flag("deployment_claimed_by_multiple_accounts", "conflict");
    const matches = state.instances.filter(candidate => candidate?.platform === item.platform && candidate?.key === item.legacy_key);
    if (!matches.length) { flag("sibling_not_current", "unknown"); continue; }
    if (matches.length > 1) { flag("sibling_duplicated", "conflict"); continue; }
    const [instance] = matches;
    if (instance.kind !== "existing") { flag("sibling_not_current", "unknown"); continue; }
    if (instance.retirement_status !== undefined && instance.retirement_status !== "none") { flag("sibling_retiring", "conflict"); continue; }
    if (isObject(instance.config) && instance.config.key !== undefined && instance.config.key !== instance.key) flag("top_config_key_mismatch", "conflict");
    const identity = accountSettingsIdentity(instance);
    if (!validSettingsIdentity(identity) || !sameSettingsIdentity(identity, item.identity)) { flag("physical_identity_changed", "conflict"); continue; }
    current.set(id, identity);
    const targetName = instance.config?.target_name;
    if (state.instances.some(other => other !== instance && other?.platform === instance.platform
      && (other.key === instance.key || (targetName && other.config?.target_name === targetName)))) flag("claimant_shadowing", "conflict");
  }
  result.current_identity = current.get(target) || null;
  for (const instance of state.instances) {
    if (siblingPlatform.has(instance?.key) && siblingPlatform.get(instance.key) !== instance.platform) flag("legacy_key_cross_platform_collision", "conflict");
  }
  // Retained config-bearing history, compared by complete settings identity.
  for (const row of snapshot.history) {
    let entry;
    try { entry = JSON.parse(row.entry); } catch { flag("local_history_unreadable", "unknown"); continue; }
    if (!isObject(entry)) { flag("local_history_unreadable", "unknown"); continue; }
    for (const side of ["before", "after"]) {
      const instance = entry[side];
      if (instance === undefined || instance === null) continue;
      if (!isObject(instance)) { flag("local_history_unreadable", "unknown"); continue; }
      if (siblingPlatform.has(instance.key) && siblingPlatform.get(instance.key) !== instance.platform) flag("legacy_key_cross_platform_collision", "conflict");
      const id = deploymentId(instance.platform, instance.key);
      if (!siblingIds.has(id) || !isObject(instance.config) || !current.has(id)) continue;
      if (!sameSettingsIdentity(accountSettingsIdentity(instance), current.get(id))) flag("history_identity_differs_from_current", "conflict");
    }
  }
  // Stored settings identities, including management request receipts.
  for (const row of snapshot.stored) {
    const id = deploymentId(row.platform, row.account_key);
    if (!siblingIds.has(id)) continue;
    let stored;
    try { stored = JSON.parse(row.identity_json); } catch { flag("stored_identity_unreadable", "unknown"); continue; }
    if (current.has(id) && !sameSettingsIdentity(stored, current.get(id))) flag("stored_identity_differs_from_current", "conflict");
  }
  // A declared environment disagreeing with the current one also conflicts.
  for (const row of snapshot.declarations || []) {
    const id = deploymentId(row.platform, row.account_key);
    if (!current.has(id)) continue;
    let declared;
    try { declared = JSON.parse(row.declaration_json); } catch { flag("stored_identity_unreadable", "unknown"); continue; }
    const environment = declared?.environment, now = current.get(id).broker_environment;
    if ((environment === "live" || environment === "paper") && now !== null && environment !== now) flag("declared_environment_differs_from_current", "conflict");
  }
  // Rows at or below the revisions a policy replacement invalidated are history, not a binding.
  const tombstones = new Map(snapshot.invalidated.map(row => [deploymentId(row.platform, row.account_key), row]));
  const stale = (row, field) => {
    const tombstone = tombstones.get(deploymentId(row.platform, row.account_key));
    return Boolean(tombstone) && Number(row.revision) <= Number(tombstone[field]);
  };
  const inGroup = row => siblingIds.has(deploymentId(row.platform, row.account_key));
  const staleApplied = snapshot.applied.some(row => inGroup(row) && stale(row, "applied_revision"));
  const staleDrafts = snapshot.drafts.some(row => inGroup(row) && stale(row, "draft_revision"));
  const invalidated = staleApplied || staleDrafts;
  // A group that is now display-only needs no applied value, so the history is reason-only there.
  if (invalidated) flag("management_binding_invalidated", account.management_class === "display_only" ? "known" : "unknown");
  result.invalidated = invalidated;
  // Management draft and applied rows bind their identity and membership.
  for (const [rows, field] of [[snapshot.drafts, "draft_revision"], [snapshot.applied, "applied_revision"]]) {
    for (const row of rows) {
      if (stale(row, field)) continue;
      const id = deploymentId(row.platform, row.account_key);
      let identity, membership;
      try { identity = JSON.parse(row.identity_json); membership = JSON.parse(row.membership_json); } catch {
        if (siblingIds.has(id)) flag("management_record_unreadable", "conflict");
        continue;
      }
      const lists = Array.isArray(membership) && membership.some(item => siblingIds.has(deploymentId(item?.platform, item?.legacy_key)));
      if (!siblingIds.has(id)) { if (lists) flag("management_binding_changed", "conflict"); continue; }
      if (row.membership_json !== result.membership_json) flag("management_binding_changed", "conflict");
      if (current.has(id) && (!validSettingsIdentity(identity) || !sameSettingsIdentity(identity, current.get(id)))) flag("management_identity_differs_from_current", "conflict");
    }
  }
  for (const row of snapshot.journal) {
    let members, initiator;
    try { members = JSON.parse(row.members_json); initiator = JSON.parse(row.initiating_identity_json); } catch { flag("management_journal_unreadable", "unknown"); continue; }
    if (!Array.isArray(members) || !validSettingsIdentity(initiator)) { flag("management_journal_unreadable", "unknown"); continue; }
    // The addressed initiator must be one of the retained members, with the identity the row recorded for it.
    const addressed = members.find(member => member?.platform === row.platform && member?.legacy_key === row.account_key);
    if (!addressed || !sameSettingsIdentity(addressed.identity, initiator)) { flag("management_journal_unreadable", "unknown"); continue; }
    for (const member of members) {
      const id = deploymentId(member?.platform, member?.legacy_key);
      if (current.has(id) && !sameSettingsIdentity(member?.identity, current.get(id))) flag("management_identity_differs_from_current", "conflict");
    }
  }
  const liveDrafts = snapshot.drafts.filter(row => !stale(row, "draft_revision"));
  const siblingRows = rows => rows.filter(row => siblingIds.has(deploymentId(row.platform, row.account_key)));
  const applied = consistentRows(result.deployments, snapshot.applied, ["revision", "management_enabled", "membership_json"]);
  result.applied_state = staleApplied ? "invalidated" : applied.state;
  result.applied_revision_floor = Math.max(0, ...siblingRows(snapshot.applied).map(row => Number(row.revision) || 0));
  result.draft_revision_floor = Math.max(0, ...siblingRows(snapshot.drafts).map(row => Number(row.revision) || 0));
  // Only the five effective fields reach the strict effective-record parser.
  const records = staleApplied ? [] : applied.rows.map(row => ({ platform: row.platform, legacy_key: row.account_key,
    management_enabled: row.management_enabled === 1 ? true : row.management_enabled === 0 ? false : row.management_enabled,
    revision: row.revision, effective_at: row.effective_at }));
  const effective = effectiveManagementState(account, records);
  // The applied value is published only for a fully certified binding: no
  // identity, membership, schema or invalidation evidence is outstanding.
  if (!staleApplied && evidence === "known" && effective.evidence_state === "known") {
    result.applied = { management_enabled: effective.management_enabled, revision: effective.revision, effective_at: effective.effective_at };
  }
  const draft = consistentRows(result.deployments, liveDrafts, DRAFT_FIELDS);
  result.draft_state = draft.state === "absent" && staleDrafts ? "invalidated" : draft.state;
  if (draft.state === "complete") {
    const [row] = draft.rows;
    result.draft = row.management_enabled === 1 || row.management_enabled === 0 ? {
      revision: row.revision, management_enabled: row.management_enabled === 1, base_applied_revision: row.base_applied_revision,
      policy_revision: row.policy_revision, instance_revision: row.instance_revision, status: row.status,
      consumed_applied_revision: row.consumed_applied_revision ?? null, updated_at: row.updated_at,
    } : null;
    if (!result.draft) result.draft_state = "conflict";
  }
  return finish(effective);
}

// The physical group and applied revision an admission saw; a stored
// application decision is only valid while both still hold.
export const managementBinding = resolution => JSON.stringify({ membership_json: resolution.membership_json,
  applied_revision: resolution.applied ? resolution.applied.revision : 0 });

// The typed denial of a processing admission, or null when admitted.
export function processingDenial(resolution) {
  if (resolution.processing_eligible) return null;
  for (const reason of ["management_policy_unavailable", "management_policy_invalid"]) if (resolution.reasons.includes(reason)) return reason;
  if (resolution.management_status === MANAGEMENT_STATUS.DISABLED) return "management_disabled";
  if (resolution.management_status === MANAGEMENT_STATUS.NOT_UNDER_MANAGEMENT) return "management_not_under_management";
  return "management_status_unknown";
}

export function requireProcessingAdmission(sql, state, platform, key) {
  const resolution = resolveManagement(readManagementSnapshot(sql, state), platform, key);
  const denial = processingDenial(resolution);
  if (denial) throw new HttpError(denial, 409);
  return resolution;
}

// --- Policy provisioning -------------------------------------------------

// A group the new policy does not carry unchanged (same class, membership and
// identities) loses its draft and applied bindings; groups it carries are left
// alone. An unreadable previous policy invalidates every stored binding.
function invalidateChangedGroups(sql, previousRow, nextPolicy) {
  if (!previousRow) return;
  const previous = storedPolicy(previousRow);
  const kept = new Set(nextPolicy.accounts.map(account => JSON.stringify(account)));
  const changed = previous.policy
    ? canonicalPolicyDocument(previous.policy).accounts.filter(account => !kept.has(JSON.stringify(account))).flatMap(account => account.deployments)
    : [...sql.exec("SELECT platform, account_key AS legacy_key FROM account_management_applied").toArray(),
      ...sql.exec("SELECT platform, account_key AS legacy_key FROM account_management_draft").toArray()];
  const now = new Date().toISOString();
  for (const { platform, legacy_key: key } of changed) {
    const appliedRow = sql.exec("SELECT revision FROM account_management_applied WHERE platform = ? AND account_key = ?", platform, key).toArray()[0];
    const draftRow = sql.exec("SELECT revision FROM account_management_draft WHERE platform = ? AND account_key = ?", platform, key).toArray()[0];
    if (!appliedRow && !draftRow) continue;
    sql.exec(`INSERT INTO account_management_invalidation (platform, account_key, policy_revision, applied_revision, draft_revision, invalidated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (platform, account_key) DO UPDATE SET policy_revision = excluded.policy_revision,
        applied_revision = MAX(account_management_invalidation.applied_revision, excluded.applied_revision),
        draft_revision = MAX(account_management_invalidation.draft_revision, excluded.draft_revision), invalidated_at = excluded.invalidated_at`,
    platform, key, nextPolicy.policy_revision, appliedRow ? appliedRow.revision : 0, draftRow ? draftRow.revision : 0, now);
  }
}

export function replaceMappingPolicy(sql, command) {
  if (!isObject(command) || Object.keys(command).some(field => !["action", "actor", "expected_policy_revision", "policy"].includes(field))
    || command.actor !== POLICY_PROVISIONER_ACTOR || !Number.isSafeInteger(command.expected_policy_revision) || command.expected_policy_revision < 0) {
    throw new HttpError("management_request_invalid", 400);
  }
  let policy;
  try { policy = canonicalPolicyDocument(normalizeMappingPolicy(command.policy)); } catch { throw new HttpError("management_policy_invalid", 400); }
  const content = JSON.stringify(policy);
  const row = sql.exec("SELECT policy_revision, policy_json FROM account_mapping_policy WHERE id = 1").toArray()[0] || null;
  const currentRevision = row ? row.policy_revision : 0;
  if (row && policy.policy_revision === currentRevision) {
    if (row.policy_json !== content) throw new HttpError("management_policy_content_conflict", 409);
    return { ok: true, replaced: false, policy_revision: currentRevision };
  }
  if (policy.policy_revision < currentRevision || command.expected_policy_revision !== currentRevision) {
    throw new HttpError("management_policy_revision_conflict", 409);
  }
  invalidateChangedGroups(sql, row, policy);
  sql.exec(`INSERT INTO account_mapping_policy (id, policy_revision, policy_json, updated_at) VALUES (1, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET policy_revision = excluded.policy_revision, policy_json = excluded.policy_json, updated_at = excluded.updated_at`,
  policy.policy_revision, content, new Date().toISOString());
  return { ok: true, replaced: true, policy_revision: policy.policy_revision };
}

// --- Management draft and apply ------------------------------------------

const COMMON_FIELDS = ["action", "actor", "platform", "key", "identity", "request_key", "expected_instance_revision",
  "expected_policy_revision", "expected_management_draft_revision", "expected_management_revision"];
const REQUEST_FIELDS = {
  account_management_draft_save: [...COMMON_FIELDS, "management_enabled"],
  account_management_apply: COMMON_FIELDS,
};

function managementRequest(command) {
  const fields = REQUEST_FIELDS[command?.action];
  const revisionOk = value => Number.isSafeInteger(value) && value >= 0;
  if (!fields || !isObject(command) || Object.keys(command).length !== fields.length || !fields.every(field => Object.hasOwn(command, field))
    || typeof command.actor !== "string" || !command.actor || typeof command.platform !== "string" || !command.platform
    || typeof command.key !== "string" || !command.key || !validSettingsIdentity(command.identity)
    || typeof command.request_key !== "string" || !ACCOUNT_SETTINGS_PROFILE_APPLICATION_REQUEST_KEY.test(command.request_key)
    || !revisionOk(command.expected_instance_revision) || !Number.isSafeInteger(command.expected_policy_revision) || command.expected_policy_revision < 1
    || !revisionOk(command.expected_management_draft_revision) || !revisionOk(command.expected_management_revision)
    || (command.action === "account_management_draft_save" && typeof command.management_enabled !== "boolean")) {
    throw new HttpError("management_request_invalid", 400);
  }
  const fingerprint = canonicalResearchTaskJson({ ...command, identity: orderedIdentity(command.identity) });
  return { operation: command.action, fingerprint };
}

function replayed(sql, command, request) {
  const row = sql.exec("SELECT operation, actor, fingerprint, receipt_json FROM account_management_requests WHERE request_key = ?", command.request_key).toArray()[0];
  if (!row) return null;
  if (row.operation !== request.operation || row.actor !== command.actor || row.fingerprint !== request.fingerprint) {
    throw new HttpError("management_request_conflict", 409);
  }
  return { ...JSON.parse(row.receipt_json), replayed: true };
}

// The checks a management control operation needs before it may write:
// current revisions, the exact addressed identity, a complete eligible
// physical group and agreeing sibling rows. Nothing is repaired.
function controlTarget(sql, state, command) {
  if (!state.initialized || command.expected_instance_revision !== state.revision) throw new HttpError("management_instance_revision_conflict", 409);
  const resolution = resolveManagement(readManagementSnapshot(sql, state), command.platform, command.key);
  if (resolution.reasons.includes("management_policy_unavailable")) throw new HttpError("management_policy_unavailable", 409);
  if (resolution.reasons.includes("management_policy_invalid")) throw new HttpError("management_policy_invalid", 409);
  if (command.expected_policy_revision !== resolution.policy_revision) throw new HttpError("management_policy_revision_conflict", 409);
  const addressed = resolution.deployments.find(item => item.platform === command.platform && item.legacy_key === command.key);
  if (addressed && !sameSettingsIdentity(command.identity, addressed.identity)) throw new HttpError("management_identity_conflict", 409);
  if (resolution.reasons.some(reason => IDENTITY_REASONS.has(reason))) throw new HttpError("management_identity_conflict", 409);
  if (resolution.reasons.some(reason => MEMBERSHIP_REASONS.has(reason)) || !addressed) throw new HttpError("management_membership_conflict", 409);
  if (resolution.management_class !== "eligible" || resolution.evidence_state === "conflict"
    || resolution.applied_state === "partial" || resolution.applied_state === "conflict"
    || resolution.draft_state === "partial" || resolution.draft_state === "conflict") {
    throw new HttpError("management_state_conflict", 409);
  }
  const draftRevision = resolution.draft ? resolution.draft.revision : 0;
  if (command.expected_management_draft_revision !== draftRevision) throw new HttpError("management_draft_revision_conflict", 409);
  const appliedRevision = resolution.applied ? resolution.applied.revision : 0;
  if (command.expected_management_revision !== appliedRevision) throw new HttpError("management_applied_revision_conflict", 409);
  return { resolution, draftRevision, appliedRevision };
}

function recordReceipt(sql, command, request, receipt) {
  sql.exec(`INSERT INTO account_management_requests
    (request_key, operation, actor, platform, account_key, identity_json, fingerprint, receipt_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  command.request_key, request.operation, command.actor, command.platform, command.key,
  JSON.stringify(orderedIdentity(command.identity)), request.fingerprint, JSON.stringify(receipt), receipt.committed_at);
  return receipt;
}

const receiptBase = (command, resolution, now) => ({
  ok: true, operation: command.action, request_key: command.request_key, replayed: false,
  platform: command.platform, key: command.key, policy_revision: resolution.policy_revision, instance_revision: resolution.instance_revision,
  deployments: resolution.deployments.map(item => ({ platform: item.platform, legacy_key: item.legacy_key })),
  committed_at: now, no_order: true, execution_authority_granted: false,
});

export function saveManagementDraft(sql, state, command) {
  const request = managementRequest(command);
  const replay = replayed(sql, command, request);
  if (replay) return replay;
  const { resolution, draftRevision, appliedRevision } = controlTarget(sql, state, command);
  const now = new Date().toISOString();
  const revision = Math.max(draftRevision, resolution.draft_revision_floor) + 1;
  for (const item of resolution.deployments) {
    sql.exec(`INSERT INTO account_management_draft
      (platform, account_key, revision, identity_json, membership_json, management_enabled, base_applied_revision,
       policy_revision, instance_revision, status, consumed_applied_revision, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
      ON CONFLICT (platform, account_key) DO UPDATE SET revision = excluded.revision, identity_json = excluded.identity_json,
        membership_json = excluded.membership_json, management_enabled = excluded.management_enabled,
        base_applied_revision = excluded.base_applied_revision, policy_revision = excluded.policy_revision,
        instance_revision = excluded.instance_revision, status = 'pending', consumed_applied_revision = NULL,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    item.platform, item.legacy_key, revision, JSON.stringify(item.identity), resolution.membership_json,
    command.management_enabled ? 1 : 0, appliedRevision, resolution.policy_revision, resolution.instance_revision, command.actor, now);
  }
  return recordReceipt(sql, command, request, { ...receiptBase(command, resolution, now), outcome: "draft_saved",
    management_draft_revision: revision, management_revision: appliedRevision, management_enabled: command.management_enabled });
}

export function applyManagementDraft(sql, state, command) {
  const request = managementRequest(command);
  const replay = replayed(sql, command, request);
  if (replay) return replay;
  const { resolution, draftRevision, appliedRevision } = controlTarget(sql, state, command);
  const draft = resolution.draft;
  if (!draft || draft.status !== "pending") throw new HttpError("management_draft_revision_conflict", 409);
  if (draft.base_applied_revision !== appliedRevision) throw new HttpError("management_applied_revision_conflict", 409);
  // The draft was saved against one instance and one policy snapshot; a
  // refreshed request cannot qualify it once either axis has moved.
  if (draft.instance_revision !== resolution.instance_revision) throw new HttpError("management_instance_revision_conflict", 409);
  if (draft.policy_revision !== resolution.policy_revision) throw new HttpError("management_policy_revision_conflict", 409);
  const now = new Date().toISOString();
  const base = receiptBase(command, resolution, now);
  if (resolution.applied && resolution.applied.management_enabled === draft.management_enabled) {
    return recordReceipt(sql, command, request, { ...base, outcome: "no_op", management_draft_revision: draftRevision,
      management_revision: appliedRevision, management_enabled: draft.management_enabled });
  }
  const revision = Math.max(appliedRevision, resolution.applied_revision_floor) + 1;
  for (const item of resolution.deployments) {
    sql.exec(`INSERT INTO account_management_applied
      (platform, account_key, revision, identity_json, membership_json, management_enabled, effective_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (platform, account_key) DO UPDATE SET revision = excluded.revision, identity_json = excluded.identity_json,
        membership_json = excluded.membership_json, management_enabled = excluded.management_enabled, effective_at = excluded.effective_at`,
    item.platform, item.legacy_key, revision, JSON.stringify(item.identity), resolution.membership_json, draft.management_enabled ? 1 : 0, now);
  }
  for (const item of resolution.deployments) {
    sql.exec("UPDATE account_management_draft SET status = 'consumed', consumed_applied_revision = ? WHERE platform = ? AND account_key = ? AND revision = ?",
      revision, item.platform, item.legacy_key, draftRevision);
  }
  const oldValue = resolution.applied ? (resolution.applied.management_enabled ? 1 : 0) : null;
  sql.exec(`INSERT INTO account_management_change
    (event_id, occurred_at, actor, platform, account_key, initiating_identity_json, members_json, policy_revision, instance_revision,
     draft_revision, old_applied_revision, new_applied_revision, old_management_enabled, new_management_enabled, result)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied')`,
  command.request_key, now, command.actor, command.platform, command.key, JSON.stringify(orderedIdentity(command.identity)),
  resolution.membership_json, resolution.policy_revision, resolution.instance_revision, draftRevision, appliedRevision, revision,
  oldValue, draft.management_enabled ? 1 : 0);
  return recordReceipt(sql, command, request, { ...base, outcome: "applied", event_id: command.request_key,
    management_draft_revision: draftRevision, management_revision: revision, previous_management_revision: appliedRevision,
    management_enabled: draft.management_enabled, previous_management_enabled: oldValue === null ? null : oldValue === 1 });
}
