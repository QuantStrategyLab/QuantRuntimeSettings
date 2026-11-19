#!/usr/bin/env node
// Offline assembler for a private account-identity inventory export. Reads
// only the supplied export file; it makes no network request. The private
// mapping is written only where --private-out points. Standard output carries
// the sanitized summary: counts and dispositions, never keys or identifiers.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { INDEX_SPECS } from "./application/account_identity_inventory/constants.js";

export const EXPORT_FORMAT = "qsl_account_identity_inventory_export.v1";
const OBJECTS = ["runtime", "directory"];
const SQL_GROUPS = {
  1: ["instance_state", "instance_history"],
  2: ["account_setting_draft", "account_setting_declaration", "account_management_draft", "account_management_applied"],
  3: ["account_setting_profile_application", "account_management_change", "account_management_requests"],
  4: ["risk_profile_authority", "account_mapping_policy"],
  5: ["account_facts_observation", "account_facts_daily"],
  6: ["account_period_return", "account_daily_native_return"], 7: ["account_external_flow"],
  8: ["account_executions", "account_execution_reports"], 9: ["binance_detail_daily"], 10: ["account_diagnosis_tasks"],
  11: ["research_promotion_applications"], 12: ["human_decision_record", "human_decision_material", "human_decision_source_material"],
  13: ["hk_stop_request"], 14: ["ux1_research_slot", "runtime_cycle_health_source", "runtime_cycle_health_checkpoint",
    "runtime_cycle_health_incident", "runtime_cycle_health_attempt", "credential_maintenance_metadata", "credential_maintenance_delivery",
    "credential_rotation_operations", "credential_rotation_requests", "credential_rotation_factors", "credential_rotation_throttle",
    "credential_rotation_audit"],
};
const KV_GROUPS = {
  16: ["account_options"], 17: ["account_facts_bindings"], 18: ["runtime_daily_bindings", "runtime_daily:"],
  19: ["account_facts_primary_backup:"], 20: ["current_strategies_cache", "audit_log", "risk_profile_bindings"],
  21: ["research_promotion_ticket:", "owner_decision_intent:", "owner_decision_current:", "reconciliation_recovery_source:",
    "reconciliation_recovery_confirmation:", "reconciliation_recovery_current:"],
  22: ["private_binance_account_facts", "private_binance_account_facts:", "private_binance_scope_report", "control_plane_source:",
    "adaptive_selection_source:", "execution_evidence_source:", "runtime_target_lifecycle_source:", "research_task_source:", "console_kv_directory:v1"],
};
const KV_GROUP_OF = new Map(Object.entries(KV_GROUPS).flatMap(([group, families]) => families.map(family => [family, group])));
// A reviewed value counts as read when it was exported, or when it was read
// and is corrupt: the corrupt record stays a qualified observation. Every
// other state of a reviewed value (missing after listing, read failure,
// oversized, non-text, unrecognized) is an unread identity.
const KV_READ_OK = new Set(["exported", "invalid_json"]);
const KV_UNREVIEWED = new Set(["scope_excluded", "unknown_family"]);

// Operation families and their terminal labels. Each family has only the
// terminal labels its own writer proves final; no label is shared across
// families. A known open label is `nonterminal`; a missing, unreadable,
// `unknown`, newly introduced or other family's label is `unknown`. Both stay
// in the ledger. LongBridge `stopped` stays open in the current implementation.
const family = (terminal, open = []) => ({ terminal: new Set(terminal), open: new Set(open) });
// Owner-decision and recovery records carry no top-level state field, so no
// label proves completion for them.
const KV_DECISION = family([]);
const PENDING_FAMILIES = {
  // durable_object.js writes only `approved`, `claimed` and `invalidated`.
  account_setting_profile_application: family(["invalidated"], ["approved", "claimed"]),
  // account_diagnosis/constants.js ACCOUNT_DIAGNOSIS_STATUSES.
  account_diagnosis_tasks: family(["succeeded", "failed"], ["queued", "running"]),
  // `uncertain` is an unconfirmed outcome and stays unknown.
  research_promotion_applications: family(["applied_paused", "rejected"], ["approved", "claimed"]),
  // Record `rejected` and resolve `applied`/`protected` leave every open query.
  hk_stop_request: family(["applied", "rejected", "protected"], ["intent", "hold", "reserved", "accepted", "partial", "stopped"]),
  ux1_research_slot: family(["succeeded", "failed"], ["queued", "running"]),
  // secretRotation.js: `*_unknown` states stay unknown until reconciled.
  credential_rotation_operations: family(["finalized", "canceled", "failed"], ["staged"]),
  credential_maintenance_delivery: family(["delivered"], ["reserved"]),
  desk_readback_record: family(["done", "failed", "partial"], ["running"]),
  desk_idempotency: family(["complete"], ["pending"]),
  "research_promotion_ticket:": family(["human_accepted", "human_rejected"], ["parked", "bounded_reopt", "shadow_recorded", "awaiting_human"]),
  "owner_decision_intent:": KV_DECISION, "owner_decision_current:": KV_DECISION, "reconciliation_recovery_source:": KV_DECISION,
  "reconciliation_recovery_confirmation:": KV_DECISION, "reconciliation_recovery_current:": KV_DECISION,
};
const SQL_STATUS = {
  account_setting_profile_application: row => row.columns.status,
  account_diagnosis_tasks: row => row.columns.status,
  research_promotion_applications: row => row.columns.status,
  hk_stop_request: row => row.columns.phase,
  credential_rotation_operations: row => jsonStatus(row.columns.record),
  credential_maintenance_delivery: row => row.columns.state,
};
// Top-level state of a projected JSON value; a value that could not be read
// has no status, which classifies as unknown.
function jsonStatus(projection) {
  if (!projection || projection.state !== "valid") return { unreadable: projection?.state ?? "absent" };
  return projection.fields?.state ?? projection.fields?.status ?? projection.fields?.phase ?? null;
}
function classify(name, raw) {
  const rules = PENDING_FAMILIES[name];
  if (raw === null || raw === undefined) return { status: "missing", classification: "unknown" };
  if (typeof raw !== "string") return { status: raw?.unreadable ? `unreadable:${raw.unreadable}` : "unreadable", classification: "unknown" };
  if (rules.terminal.has(raw)) return null;
  return { status: raw, classification: rules.open.has(raw) ? "nonterminal" : "unknown" };
}

const key = (platform, legacyKey) => JSON.stringify([platform, legacyKey]);
const value = item => (item && typeof item === "object" && !Array.isArray(item) ? undefined : item);
// The projection's marker for a string beyond its 512-character bound.
const longString = item => item !== null && typeof item === "object" && !Array.isArray(item) && Object.keys(item).length === 1
  && Object.hasOwn(item, "long_string") && Number.isInteger(item.long_string) && item.long_string > 512;
const SCALAR_LOSS = "identity_scalar_long_string";

// Binance wallet history is the only composite account key: an
// `account_facts_daily` row stored under platform `binance` whose key is
// `<legacy_key>:<source_binding_id>` with its stored 64-hex source binding.
// It is decided from the row itself; an exported `logical_account` hint is
// never authority. A Binance daily row that does not meet the contract is
// unresolved: no account, literal or decoded, is taken from it.
function walletIdentity(row) {
  if (row.pk?.[0] !== "binance") return null;
  const accountKey = row.pk[1], bindingId = row.columns?.source_binding_id;
  if (typeof accountKey === "string" && typeof bindingId === "string" && /^[a-f0-9]{64}$/.test(bindingId)) {
    const prefix = accountKey.slice(0, -(bindingId.length + 1));
    if (prefix && accountKey === `${prefix}:${bindingId}`) return { legacy_key: prefix, binding_id: bindingId, composite: true };
  }
  return { unresolved: true };
}
const ROW_ERRORS = new Set(["row_projection_too_large", "row_projection_failed"]);

function chain(pages, reasons, label) {
  const ordered = [...pages].sort((a, b) => a.body.page - b.body.page);
  if (!ordered.length) { reasons.push(`${label}:not_collected`); return null; }
  if (ordered.some((page, index) => page.body.page !== index + 1)) { reasons.push(`${label}:page_chain_gap`); return null; }
  if (ordered.slice(0, -1).some(page => page.body.terminal) || !ordered.at(-1).body.terminal) { reasons.push(`${label}:terminal_missing`); return null; }
  return ordered;
}

function assembleObject(object, responses) {
  const reasons = [];
  const ok = responses.filter(item => item.request.object === object && item.status === 200 && item.body?.ok === true);
  const finals = ok.filter(item => item.request.section === "finalize" && item.body.stable === true);
  const final = finals.at(-1);
  if (!final) return { object, complete: false, reasons: ["finalize_stable_missing"], tables: {}, do_kv: null };
  const scanId = final.body.scan_id;
  const schema = ok.find(item => item.request.section === "schema" && item.body.scan_id === scanId);
  if (!schema) return { object, complete: false, reasons: ["schema_missing"], tables: {}, do_kv: null };
  const tables = {};
  for (const [name, table] of Object.entries(schema.body.tables)) {
    const entry = tables[name] = { group: table.group, present: table.present, rows: [] };
    if (!table.present) { entry.disposition = "absent"; continue; }
    entry.row_count = table.row_count;
    entry.null_key_rows = table.null_key_rows;
    entry.missing_columns = table.missing_columns;
    if (final.body.row_counts[name] !== table.row_count) reasons.push(`${name}:count_changed`);
    if (table.count_only) { entry.disposition = `count_only:${table.count_only}`; continue; }
    if (!table.primary_key_matches) { entry.disposition = "unsupported_primary_key"; reasons.push(`${name}:unsupported_primary_key`); continue; }
    const pages = chain(ok.filter(item => item.request.section === "sql" && item.request.table === name && item.body.scan_id === scanId), reasons, name);
    if (!pages) { entry.disposition = "incomplete"; continue; }
    const seen = new Map();
    for (const page of pages) {
      for (const row of page.body.rows) {
        const id = JSON.stringify(row.pk);
        if (page.body.nested_continuation && seen.has(id)) {
          const prior = seen.get(id), field = Object.keys(row.columns).find(column => Array.isArray(row.columns[column]?.entries));
          if (field) prior.columns[field].entries.push(...row.columns[field].entries);
          continue;
        }
        if (seen.has(id)) { reasons.push(`${name}:duplicate_key`); continue; }
        seen.set(id, structuredClone(row));
      }
    }
    entry.rows = [...seen.values()];
    entry.failed_rows = entry.rows.filter(row => row.projection_error).length;
    if (entry.rows.length + (table.null_key_rows || 0) !== table.row_count) reasons.push(`${name}:row_count_mismatch`);
    if (table.null_key_rows) reasons.push(`${name}:null_primary_key_rows`);
    const nested = entry.rows.flatMap(row => Object.values(row.columns || {}).filter(column => Array.isArray(column?.entries)));
    if (nested.some(column => column.entries.length !== column.entry_count)) reasons.push(`${name}:nested_entries_incomplete`);
    // Exported identity loss: a row whose projection failed, a JSON column
    // cut at its field or depth bound, and an unresolved wallet-history row.
    // Each cause once per table (and column); the rows stay as exported.
    const losses = new Set();
    for (const row of entry.rows) {
      if (row.projection_error) losses.add(`${name}:${ROW_ERRORS.has(row.projection_error) ? row.projection_error : "projection_error"}`);
      for (const [column, projection] of Object.entries(row.columns || {})) {
        if (projection?.state === "valid" && projection.truncated) losses.add(`${name}:${column}:identity_projection_truncated`);
      }
      if (name === "account_facts_daily" && walletIdentity(row)?.unresolved) losses.add(`${name}:wallet_history_identity_unresolved`);
    }
    reasons.push(...losses);
    entry.disposition = reasons.some(reason => reason.startsWith(`${name}:`)) ? "incomplete" : "complete";
  }
  // Propagate reviewed index verdicts into the owning table, group, object, and overall completeness.
  const missingIndexes = schema.body.missing_indexes;
  const incompatibleIndexes = schema.body.incompatible_indexes;
  for (const spec of INDEX_SPECS) {
    const entry = tables[spec.table];
    if (!entry?.present) continue;
    if (!Array.isArray(missingIndexes) || !Array.isArray(incompatibleIndexes)) {
      reasons.push(`${spec.table}:index_evidence_missing:${spec.name}`);
      entry.disposition = "incomplete";
    } else if (missingIndexes.includes(spec.name)) {
      reasons.push(`${spec.table}:missing_index:${spec.name}`);
      entry.disposition = "incomplete";
    } else if (incompatibleIndexes.includes(spec.name)) {
      reasons.push(`${spec.table}:incompatible_index:${spec.name}`);
      entry.disposition = "incomplete";
    }
  }
  const knownIndexNames = new Set(INDEX_SPECS.map(spec => spec.name));
  for (const indexName of Array.isArray(missingIndexes) ? missingIndexes : []) {
    if (!knownIndexNames.has(indexName)) reasons.push(`schema:missing_index:${indexName}`);
  }
  for (const indexName of Array.isArray(incompatibleIndexes) ? incompatibleIndexes : []) {
    if (!knownIndexNames.has(indexName)) reasons.push(`schema:incompatible_index:${indexName}`);
  }
  for (const [group, groupTables] of Object.entries(SQL_GROUPS)) {
    for (const name of groupTables) {
      if (Object.hasOwn(tables, name)) continue;
      tables[name] = { group: Number(group), present: null, rows: [], disposition: "not_collected" };
      reasons.push(`${name}:not_collected`);
    }
  }
  const unknown = schema.body.other_schema_objects.filter(item => item.classification === "unknown_table");
  const kvPages = chain(ok.filter(item => item.request.section === "do_kv" && item.body.scan_id === scanId), reasons, "do_kv");
  let doKv = null;
  if (kvPages) {
    const entries = kvPages.flatMap(page => page.body.entries);
    if (new Set(entries.map(item => item.key)).size !== entries.length) reasons.push("do_kv:duplicate_key");
    // A payload identity cut at its bound, or a value whose projection failed,
    // holds identities that were not read; the exported entries stay.
    const losses = new Set();
    for (const item of entries) {
      if (item.payload_identity?.truncated) losses.add("do_kv:payload_identity_truncated");
      if (item.projection_error) losses.add(item.projection_error === "value_projection_failed" ? "do_kv:value_projection_failed" : "do_kv:projection_error");
    }
    reasons.push(...losses);
    doKv = { entries, unknown_keys: entries.filter(item => item.family === "unknown").length, alarm: final.body.alarm,
      disposition: reasons.some(reason => reason.startsWith("do_kv:")) ? "incomplete" : "complete" };
  }
  return { object, complete: !reasons.length, reasons, scan_id: scanId, schema_state: schema.body.schema_state, tables, do_kv: doKv,
    unknown_tables: unknown.map(item => ({ name: item.name, row_count: item.row_count })) };
}

// Completeness requires two equal complete passes and a successful read of
// every reviewed value in them. A single pass, two differing passes or an
// unread reviewed value never certifies the namespace.
function assembleKv(responses) {
  const ok = responses.filter(item => item.request.section === "kv" && item.status === 200 && item.body?.ok === true);
  if (!ok.length) return null;
  const byScan = new Map();
  for (const item of ok) byScan.set(item.body.scan_id, [...(byScan.get(item.body.scan_id) || []), item]);
  const passes = [];
  for (const [scanId, pages] of byScan) {
    const local = [];
    const ordered = chain(pages, local, "kv");
    if (!ordered) { passes.push({ scan_id: scanId, complete: false, reasons: local }); continue; }
    const keys = ordered.flatMap(page => page.body.keys);
    if (new Set(keys.map(item => item.name)).size !== keys.length) local.push("kv:duplicate_name");
    passes.push({ scan_id: scanId, complete: !local.length, reasons: local, keys });
  }
  const complete = passes.filter(pass => pass.complete);
  const reasons = [];
  if (!complete.length) reasons.push("kv:no_complete_pass");
  else if (complete.length < 2) reasons.push("kv:repeat_pass_missing");
  const [first, second] = complete.slice(-2);
  const fingerprint = pass => JSON.stringify(pass.keys.map(item => [item.name, item.state, item.value_sha256 ?? null]));
  const repeated = Boolean(first && second && fingerprint(first) === fingerprint(second));
  if (first && second && !repeated) reasons.push("kv:passes_differ");
  const keys = complete.at(-1)?.keys ?? [];
  // A cache whose account hierarchy was cut at the projection bound, or is not
  // the writer's object hierarchy, holds identities that were not read.
  const cacheUnread = cache => !cache ? null : cache.truncated ? "cache_accounts_truncated"
    : cache.state === "unexpected_shape" || cache.unexpected_platforms ? "cache_accounts_unexpected_shape" : null;
  // Every cause a reviewed value's identities were not all read: its read
  // state, its generic identity projection cut at the field or depth bound,
  // and its cache hierarchy. A key is one failed read whatever its causes;
  // `state` is the first cause and `causes` keeps them all. Equal passes do
  // not clear a cause: their fingerprints only show the value was stable.
  const unread = item => KV_UNREVIEWED.has(item.state) ? []
    : !KV_READ_OK.has(item.state) ? [item.state ?? "missing"]
    : [item.identity?.truncated ? "identity_projection_truncated" : null, cacheUnread(item.cache_accounts)].filter(Boolean);
  const failedReads = keys.map(item => [item, unread(item)]).filter(([, causes]) => causes.length)
    .map(([item, causes]) => ({ name: item.name, family: item.family, state: causes[0], causes, group: KV_GROUP_OF.get(item.family) ?? null }));
  return { passes: passes.length, complete_passes: complete.length, repeated_pass_equal: repeated, stable: !reasons.length,
    reasons, failed_reads: failedReads, keys };
}

// Identity references inside projected JSON. In a stored identity document
// (`identity_json`) `key` is the account key; elsewhere only explicit account
// fields count. Platform comes from the same object or its nearest ancestor,
// never from elsewhere: a reference without one stays unattributed.
const ACCOUNT_FIELDS = ["account_key", "legacy_key", "storage_account_key", "selected_account"];
const DOCUMENT_FIELDS = ["key", ...ACCOUNT_FIELDS];
const PLATFORM_FIELDS = ["platform", "platform_id"];
const QUALIFIER_FIELDS = ["account_selector", "target_name", "target_id", "deployment_selector", "account_scope", "service_name",
  "broker_environment", "source_binding_id", "binding_id"];
const STORED_IDENTITY_TABLES = ["account_setting_draft", "account_setting_declaration", "account_setting_profile_application",
  "account_management_draft", "account_management_applied", "account_management_requests"];
const STORED_IDENTITY_FIELDS = ["key", "target_name", "account_selector", "deployment_selector", "account_scope", "service_name", "broker_environment"];
const parentPath = path => (path.includes(".") ? path.slice(0, path.lastIndexOf(".")) : "");
const LAST_SEGMENT = /(?:\.[^.[\]]+|\[\d+\]|^[^.[\]]+)$/;
// The ancestors of a flattened path, nearest first. Each step removes one
// trailing `.key`, `[index]` or leading key and must shorten the path, so
// the walk takes at most `path.length` steps. A suffix no step can remove (a
// key holding `.`, `[` or `]`) ends the walk unparseable instead of
// repeating; flattened paths do not encode every JSON hierarchy uniquely.
export function ancestorPaths(path) {
  const paths = [];
  while (path) {
    const next = path.replace(LAST_SEGMENT, "");
    if (next.length >= path.length) return { paths, parseable: false };
    paths.push(path = next);
  }
  return { paths, parseable: true };
}
// A selected account field or platform cut at the long-string bound is lost:
// it is returned by path, never replaced. A lost platform ends the walk, so
// its key stays unattributed rather than taking a more distant platform.
function identityReferences(fields, document) {
  const groups = new Map();
  for (const [path, item] of Object.entries(fields || {})) {
    const parent = parentPath(path), name = path.slice(parent ? parent.length + 1 : 0);
    if (!groups.has(parent)) groups.set(parent, {});
    groups.get(parent)[name] = item;
  }
  const platformAt = path => {
    for (const name of PLATFORM_FIELDS) {
      const item = groups.get(path)?.[name];
      if (typeof item === "string" && item) return { platform: item };
      if (longString(item)) return { lost: path ? `${path}.${name}` : name };
    }
    return null;
  };
  const references = [], losses = [];
  for (const [parent, group] of groups) {
    for (const name of document ? DOCUMENT_FIELDS : ACCOUNT_FIELDS) {
      const legacyKey = group[name];
      if (longString(legacyKey)) { losses.push(parent ? `${parent}.${name}` : name); continue; }
      if (typeof legacyKey !== "string" || !legacyKey) continue;
      // An unparseable ancestry keeps only a platform beside the reference;
      // none is inferred through the remainder.
      const ancestry = ancestorPaths(parent);
      let found = null;
      for (const path of [parent, ...(ancestry.parseable ? ancestry.paths : [])]) if ((found = platformAt(path))) break;
      if (found?.lost) losses.push(found.lost);
      const qualifiers = Object.fromEntries(QUALIFIER_FIELDS.filter(field => field in group).map(field => [field, group[field]]));
      references.push({ legacy_key: legacyKey, platform: found?.platform ?? null, path: parent ? `${parent}.${name}` : name, qualifiers,
        ...(ancestry.parseable ? {} : { path_qualification: "unparseable_identity_path" }) });
    }
  }
  return { references, losses };
}
// A tuple field cut at the long-string bound keeps its marker: it is never
// normalized to an empty identity.
const normalizedConfig = config => Object.fromEntries(STORED_IDENTITY_FIELDS.map(field => [field, longString(config?.[field]) ? config[field]
  : field === "broker_environment" ? (["live", "paper"].includes(config?.[field]) ? config[field] : null) : typeof config?.[field] === "string" ? config[field] : ""]));
const TUPLE_FIELDS = STORED_IDENTITY_FIELDS.filter(field => field !== "key");
// The settings identity of an instance episode as accountSettingsIdentity()
// derives it: platform, the top-level key (never config.key) and the
// normalized config fields, in one fixed order.
const settingsIdentity = (platform, legacyKey, config) => {
  const normalized = normalizedConfig(config);
  return { platform, key: legacyKey, target_name: normalized.target_name, broker_environment: normalized.broker_environment,
    account_selector: normalized.account_selector, deployment_selector: normalized.deployment_selector,
    account_scope: normalized.account_scope, service_name: normalized.service_name };
};

// The configured options of an account-options value, one per `platform[index]`
// slot. The ordinary reader names an option by its key, or by its ID when the
// key is falsy (normalizeAccountOption: `raw.key || raw.id`, a trimmed
// non-empty string of OPTION_KEY_RE characters). A truthy key always wins: an
// unreadable one (non-string, nested value, one beyond the projection) names
// no option and its ID is not used instead. Whether the key is truthy comes
// from its projected field, from a nested key path, or else from the slot's
// `option_key_truthy` bit; with none of them (an export collected before that
// evidence existed, or a slot it does not cover) the ID is not inferred and
// the slot carries `option_key_evidence_missing`. A selected key or ID cut at
// the long-string bound is lost: `selected_option_identity_long_string`, and
// nothing is mapped for the slot. A truthy key the ordinary reader would
// reject is still listed, as before, with `option_key_valid: false`; an ID the
// ordinary reader would reject names nothing. In a truncated projection the
// slot holding the last projected option field may have lost its key, so an ID
// selected there carries `key_unobserved_at_truncation`.
const OPTION_SLOT = /^([^.[]+\[\d+\])\.(key|id)$/;
const OPTION_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
function configuredOptions(identity, source) {
  const fields = identity?.fields || {}, slots = new Map();
  for (const [path, item] of Object.entries(fields)) {
    const match = OPTION_SLOT.exec(path);
    if (!match) continue;
    if (!slots.has(match[1])) slots.set(match[1], {});
    slots.get(match[1])[match[2]] = { path, value: item };
  }
  // Slots whose key is an object or array: their key is truthy but unreadable.
  const nestedKeys = new Set();
  for (const path of [...Object.keys(fields), ...Object.keys(identity?.counts || {}), ...(identity?.redacted || [])]) {
    const match = /^([^.[]+\[\d+\])\.key(?:[.[]|$)/.exec(path);
    if (match && !(path === `${match[1]}.key` && Object.hasOwn(fields, path))) nestedKeys.add(match[1]);
  }
  // Only an own Boolean is evidence; anything else leaves the slot unknown.
  const truthy = identity?.option_key_truthy;
  const bits = truthy !== null && typeof truthy === "object" && !Array.isArray(truthy) ? truthy : {};
  const boundary = identity?.truncated ? Object.keys(fields).map(path => /^([^.[]+\[\d+\])\./.exec(path)?.[1]).filter(Boolean).at(-1) : null;
  const options = [], reasons = [];
  for (const [slot, { key: keyField, id: idField }] of slots) {
    const platform = slot.slice(0, slot.lastIndexOf("["));
    const bit = Object.hasOwn(bits, slot) && typeof bits[slot] === "boolean" ? bits[slot] : undefined;
    const keyTruthy = keyField ? Boolean(keyField.value) : nestedKeys.has(slot) ? true : bit;
    if (keyTruthy === undefined) {
      if (idField?.value) reasons.push(`${source}:${slot}.key:option_key_evidence_missing`);
      continue;
    }
    const selectedField = keyTruthy ? "key" : idField?.value ? "id" : null;
    const selected = selectedField === "key" ? keyField : selectedField === "id" ? idField : null;
    if (selected && longString(selected.value)) { reasons.push(`${source}:${selected.path}:selected_option_identity_long_string`); continue; }
    if (!selected || typeof selected.value !== "string") continue;
    const trimmed = selected.value.trim();
    const valid = OPTION_KEY.test(trimmed);
    if (!valid && selectedField === "id") continue;
    const legacyKey = valid ? trimmed : selected.value;
    options.push({ platform, legacy_key: legacyKey, path: selected.path, source, identity: { selected_field: selectedField,
      ...(legacyKey !== selected.value ? { raw_value: selected.value } : {}), ...(valid ? {} : { option_key_valid: false }),
      ...(selectedField === "id" && slot === boundary ? { key_unobserved_at_truncation: true } : {}) } });
  }
  return { options, reasons };
}
// Both account-options sources: their configured options, and the private
// reasons a selected option identity was not read.
function optionsFrom(kv, env) {
  const sources = [...(kv?.keys || []).filter(item => item.name === "account_options" && item.state === "exported").map(item => ({ identity: item.identity, source: "kv:account_options" })),
    ...(env?.bindings || []).filter(item => item.name === "STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON" && item.state === "present").map(item => ({ identity: item.identity, source: "env:STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON" }))];
  const read = sources.map(({ identity, source }) => configuredOptions(identity, source));
  return { options: read.flatMap(item => item.options), reasons: [...new Set(read.flatMap(item => item.reasons))] };
}

// The account tables mapped from their own key columns.
const ACCOUNT_TABLES = ["account_setting_draft", "account_setting_declaration", "account_setting_profile_application", "account_management_draft",
  "account_management_applied", "account_management_change", "account_management_requests", "account_facts_observation",
  "account_facts_daily", "account_external_flow", "account_executions", "account_execution_reports", "binance_detail_daily",
  "account_diagnosis_tasks", "research_promotion_applications", "account_period_return", "account_daily_native_return"];
const STORED_JSON_DOCUMENTS = new Set(["identity_json", "initiating_identity_json"]);
const TYPED_DEPLOYMENT_COLUMNS = {
  account_mapping_policy: "policy_json",
  account_management_draft: "membership_json",
  account_management_applied: "membership_json",
  account_management_change: "members_json",
};
function deploymentSlots(table, projection) {
  const fields = projection?.fields || {}, counts = projection?.counts || {};
  const slots = new Set();
  if (table === "account_mapping_policy") {
    for (const path of Object.keys(fields)) {
      const match = /^(accounts\[\d+\]\.deployments\[\d+\])\.(?:platform|legacy_key|identity\.[A-Za-z_]+)$/.exec(path);
      if (match) slots.add(match[1]);
    }
    if (!projection.truncated && Number.isSafeInteger(counts.accounts)) {
      for (let a = 0; a < counts.accounts; a += 1) {
        const depCount = counts[`accounts[${a}].deployments`];
        if (!Number.isSafeInteger(depCount)) continue;
        for (let d = 0; d < depCount; d += 1) slots.add(`accounts[${a}].deployments[${d}]`);
      }
    }
    return [...slots];
  }
  for (const path of Object.keys(fields)) {
    const match = /^(\[\d+\])\.(?:platform|legacy_key|identity\.[A-Za-z_]+)$/.exec(path);
    if (match) slots.add(match[1]);
  }
  if (!projection.truncated && Number.isSafeInteger(counts.$)) {
    for (let index = 0; index < counts.$; index += 1) slots.add(`[${index}]`);
  }
  return [...slots];
}
// audit_log entries whose writer names the account by `platform` and `key`.
const AUDIT_ACCOUNT_ACTIONS = new Set(["save_account_settings", "approve_account_settings_profile_application"]);
const AUDIT_ACTION = /^(\[\d+\])\.action$/;
const AUDIT_ENTRY = /^\[(0|[1-9]\d*)\]$/;
const AUDIT_SHAPE_UNAVAILABLE = "audit_root_shape_unavailable";

function mappingFrom(objects, kv, env, options) {
  const mapping = new Map(), unattributed = [], losses = new Map();
  const entry = (platform, legacyKey) => {
    const id = key(platform, legacyKey);
    if (!mapping.has(id)) mapping.set(id, { platform, legacy_key: legacyKey, states: new Set(), episodes: [] });
    return mapping.get(id);
  };
  const add = (platform, legacyKey, state, locator, identity = {}) => {
    if (typeof legacyKey !== "string" || !legacyKey) return;
    if (typeof platform !== "string" || !platform) { unattributed.push({ legacy_key: legacyKey, locator }); return; }
    const item = entry(platform, legacyKey);
    item.states.add(state);
    item.episodes.push({ state, locator, identity });
  };
  // A selected identity scalar the export cut at the long-string bound: one
  // private reason per source, locator and path, with the owning scope.
  const lose = (reason, scope, locator) => { if (!losses.has(reason)) losses.set(reason, { reason, ...scope, locator }); };
  const sqlLoss = (object, table, index, pk) => path => lose(`sql:${object}:${table}:${index}:${path}:${SCALAR_LOSS}`, { scope: "sql", object, table }, { object, table, pk, path });
  const kvLoss = item => path => lose(`kv:${item.name}:${path}:${SCALAR_LOSS}`, { scope: "kv", group: KV_GROUP_OF.get(item.family) ?? null }, { source: "kv", name: item.name, path });
  const scalarLoss = (item, lost, at) => { if (longString(item)) lost(at); return longString(item); };
  const addReferences = (projection, state, locator, document, lost, prefix = "", skipPaths = null) => {
    const { references, losses: paths } = identityReferences(projection?.fields, document);
    for (const path of paths) lost(`${prefix}${path}`);
    for (const reference of references) {
      if (skipPaths?.has(reference.path)) continue;
      const qualification = reference.path_qualification ? { path_qualification: reference.path_qualification } : {};
      add(reference.platform, reference.legacy_key, state, { ...locator, path: reference.path, ...qualification }, { qualifiers: reference.qualifiers });
    }
  };
  // The fixed instance fields an episode is mapped and compared by.
  const instanceLoss = (instance, lost, at) => {
    scalarLoss(instance.platform, lost, `${at}.platform`);
    scalarLoss(instance.key, lost, `${at}.key`);
    for (const field of TUPLE_FIELDS) scalarLoss(instance.config?.[field], lost, `${at}.config.${field}`);
  };
  for (const result of objects) {
    for (const [table, data] of Object.entries(result.tables)) {
      for (const [index, row] of (data.rows || []).entries()) {
        const locator = { object: result.object, table, pk: row.pk };
        const columns = row.columns || {};
        const lost = sqlLoss(result.object, table, index, row.pk);
        if (table === "instance_state") {
          for (const [at, instance] of (columns.payload?.entries || []).entries()) {
            instanceLoss(instance, lost, `payload.entries[${at}]`);
            const state = instance.retirement_status && instance.retirement_status !== "none" ? "retirement_requested" : instance.kind === "existing" ? "current" : instance.kind === "draft" ? "draft" : "unknown";
            add(instance.platform, instance.key, state, locator, { config: instance.config, top_config_key_mismatch: instance.top_config_key_mismatch });
          }
          continue;
        }
        if (table === "instance_history") {
          for (const side of ["before", "after"]) {
            const instance = columns.entry?.[side];
            if (!instance) continue;
            instanceLoss(instance, lost, `entry.${side}`);
            add(instance.platform, instance.key, "historical", { ...locator, side }, { config: instance.config });
          }
          continue;
        }
        if (ACCOUNT_TABLES.includes(table)) {
          // Only a Binance wallet-history row is decoded; every other key is
          // the literal stored account, whatever an export's hint says.
          const wallet = table === "account_facts_daily" ? walletIdentity(row) : null;
          const pkNames = { account_period_return: ["account_key"], account_daily_native_return: ["account_key"], binance_detail_daily: ["account_key"] }[table];
          const copied = ["research_promotion_applications", "account_diagnosis_tasks", "account_setting_profile_application",
            "account_management_change", "account_management_requests"].includes(table);
          const platformColumn = table === "research_promotion_applications" ? "platform_id" : "platform";
          const resolvedPlatform = table === "binance_detail_daily" ? "binance" : pkNames ? null : copied ? columns[platformColumn] : value(row.pk[0]);
          const accountKey = wallet ? wallet.legacy_key : pkNames ? row.pk[0] : copied ? columns.account_key : row.pk[1];
          if (copied) { scalarLoss(columns.account_key, lost, "account_key"); scalarLoss(columns[platformColumn], lost, platformColumn); }
          const identity = { storage_key: row.pk, logical_account: wallet?.composite ? wallet : null };
          const storedColumn = table === "account_management_change" ? "initiating_identity_json"
            : STORED_IDENTITY_TABLES.includes(table) ? "identity_json" : null;
          if (storedColumn) {
            const stored = columns[storedColumn];
            identity.stored_identity = stored?.state === "valid"
              ? Object.fromEntries(STORED_IDENTITY_FIELDS.filter(field => field in stored.fields).map(field => [field, stored.fields[field]]))
              : { unreadable: stored?.column_absent ? "column_absent" : stored?.state ?? "absent" };
            if (stored?.state === "valid") for (const field of STORED_IDENTITY_FIELDS) scalarLoss(stored.fields[field], lost, `${storedColumn}.${field}`);
          }
          if (table === "account_setting_declaration") {
            const declaration = columns.declaration_json;
            identity.declaration = declaration?.state === "valid"
              ? { state: "valid", environment: declaration.environment, account_type: declaration.account_type, unexpected_keys: declaration.unexpected_keys }
              : { state: declaration?.state ?? (declaration?.column_absent ? "column_absent" : "absent") };
          }
          if (!wallet?.unresolved) add(resolvedPlatform, value(accountKey), "store_reference", locator, identity);
          const typedColumn = TYPED_DEPLOYMENT_COLUMNS[table];
          if (typedColumn && columns[typedColumn]
            && (columns[typedColumn].state !== "valid"
              || (!columns[typedColumn].truncated && !Number.isSafeInteger(columns[typedColumn].counts?.$)))) {
            const memberCol = columns[typedColumn];
            add(resolvedPlatform, value(accountKey), "store_reference", { ...locator, column: typedColumn },
              { stored_identity: { unreadable: memberCol.column_absent ? "column_absent" : memberCol.state !== "valid" ? (memberCol.state ?? "absent") : "unexpected_shape" } });
          }
        }
        // Policy and sibling-membership JSON decode every deployment's stored settings identity.
        const typedColumn = TYPED_DEPLOYMENT_COLUMNS[table];
        const typedPaths = new Set();
        if (typedColumn && columns[typedColumn]?.state === "valid" && columns[typedColumn].fields) {
          const projection = columns[typedColumn], fields = projection.fields;
          for (const slot of deploymentSlots(table, projection)) {
            const depPlatform = fields[`${slot}.platform`], depKey = fields[`${slot}.legacy_key`];
            const idPlatform = fields[`${slot}.identity.platform`], idKey = fields[`${slot}.identity.key`];
            scalarLoss(depPlatform, lost, `${typedColumn}.${slot}.platform`);
            scalarLoss(depKey, lost, `${typedColumn}.${slot}.legacy_key`);
            scalarLoss(idPlatform, lost, `${typedColumn}.${slot}.identity.platform`);
            for (const field of STORED_IDENTITY_FIELDS) scalarLoss(fields[`${slot}.identity.${field}`], lost, `${typedColumn}.${slot}.identity.${field}`);
            const hasIdentity = Object.hasOwn(fields, `${slot}.identity.platform`)
              || STORED_IDENTITY_FIELDS.some(field => Object.hasOwn(fields, `${slot}.identity.${field}`));
            let stored;
            if (hasIdentity) {
              stored = typeof depPlatform === "string" && typeof idPlatform === "string" && idPlatform !== depPlatform
                ? { unreadable: "platform_mismatch" }
                : Object.fromEntries(STORED_IDENTITY_FIELDS.filter(field => Object.hasOwn(fields, `${slot}.identity.${field}`))
                  .map(field => [field, fields[`${slot}.identity.${field}`]]));
            } else if (!projection.truncated) {
              stored = { unreadable: "absent" };
            }
            typedPaths.add(`${slot}.legacy_key`);
            typedPaths.add(`${slot}.identity.key`);
            if (typeof depKey === "string" && depKey && !longString(depKey)) {
              add(typeof depPlatform === "string" ? depPlatform : null, depKey, "store_reference",
                { ...locator, column: typedColumn, path: `${slot}.legacy_key` }, stored ? { stored_identity: stored } : {});
            }
            if (typeof idKey === "string" && idKey && !longString(idKey)
              && (idKey !== depKey || (typeof idPlatform === "string" && idPlatform !== depPlatform))) {
              add(typeof idPlatform === "string" ? idPlatform : null, idKey, "store_reference",
                { ...locator, column: typedColumn, path: `${slot}.identity.key` }, stored ? { stored_identity: stored } : {});
            }
            if (!projection.truncated && ACCOUNT_TABLES.includes(table)
              && !(typeof depKey === "string" && depKey) && !longString(depKey)
              && !(typeof idKey === "string" && idKey) && !longString(idKey)) {
              const rowPlatform = table === "account_management_change" ? columns.platform : value(row.pk[0]);
              const rowKey = value(table === "account_management_change" ? columns.account_key : row.pk[1]);
              add(typeof rowPlatform === "string" ? rowPlatform : null, rowKey, "store_reference",
                { ...locator, column: typedColumn, path: slot }, { stored_identity: { unreadable: "absent" } });
            }
          }
        }
        // A promotion decision names its account by the root selected_account
        // object of its target and of its payload, each a separate episode.
        if (table === "human_decision_record" && columns.kind === "promotion") {
          for (const column of ["target_json", "payload_json"]) {
            const fields = columns[column]?.state === "valid" ? columns[column].fields || {} : {};
            const legacyKey = fields["selected_account.key"], platform = fields["selected_account.platform"];
            if (scalarLoss(legacyKey, lost, `${column}.selected_account.key`)) continue;
            scalarLoss(platform, lost, `${column}.selected_account.platform`);
            add(typeof platform === "string" ? platform : null, legacyKey, "store_reference", { ...locator, column, path: "selected_account.key" });
          }
        }
        // Every projected JSON column, including operation payloads.
        for (const [column, projection] of Object.entries(columns)) {
          if (projection?.state === "valid" && projection.fields) {
            addReferences(projection, "store_reference", { ...locator, column }, STORED_JSON_DOCUMENTS.has(column), lost, `${column}.`,
              column === typedColumn ? typedPaths : null);
          }
        }
      }
    }
    for (const [index, item] of (result.do_kv?.entries || []).entries()) {
      const object = result.object;
      const lost = path => lose(`do_kv:${object}:${index}:payload_identity:${path}:${SCALAR_LOSS}`, { scope: "do_kv", object }, { object, do_kv_key: item.key, path });
      if (item.payload_identity) addReferences(item.payload_identity, "store_reference", { object, do_kv_key: item.key }, false, lost);
    }
  }
  for (const item of kv?.keys || []) {
    if (item.state === "exported") addReferences(item.identity, "kv_reference", { source: "kv", name: item.name }, false, kvLoss(item));
  }
  // audit_log is a root array of entries; only the two account-settings
  // actions name an account, by the entry's own `key` and `platform`. A
  // flattened `[index]` path does not show a root array: only the reader's
  // own `audit_root_array: true`, its root count and an index within it do.
  // `false` is a non-array value, which names no audit account. Without that
  // evidence (an export from before it, or a malformed one) an entry that
  // would name an account is unknown: one shape reason for the value, and
  // neither an account nor a lost scalar at the unestablished position.
  for (const item of kv?.keys || []) {
    if (item.family !== "audit_log" || item.state !== "exported") continue;
    const fields = item.identity?.fields || {}, lost = kvLoss(item);
    const shape = Object.hasOwn(item, "audit_root_array") ? item.audit_root_array : undefined;
    if (shape === false) continue;
    const counts = item.identity?.counts;
    const rootCount = counts !== null && typeof counts === "object" && Object.hasOwn(counts, "$") ? counts.$ : undefined;
    const countValid = Number.isSafeInteger(rootCount) && rootCount >= 0;
    for (const [path, action] of Object.entries(fields)) {
      const entryPath = AUDIT_ACTION.exec(path)?.[1];
      if (!entryPath || !AUDIT_ACCOUNT_ACTIONS.has(action)) continue;
      if (!Object.hasOwn(fields, `${entryPath}.key`) && !Object.hasOwn(fields, `${entryPath}.platform`)) continue;
      const index = AUDIT_ENTRY.exec(entryPath)?.[1];
      if (shape !== true || !countValid || index === undefined || Number(index) >= rootCount) {
        lose(`kv:${item.name}:${AUDIT_SHAPE_UNAVAILABLE}`, { scope: "kv", group: KV_GROUP_OF.get(item.family) ?? null }, { source: "kv", name: item.name });
        continue;
      }
      const legacyKey = fields[`${entryPath}.key`], platform = fields[`${entryPath}.platform`];
      if (scalarLoss(legacyKey, lost, `${entryPath}.key`)) continue;
      scalarLoss(platform, lost, `${entryPath}.platform`);
      add(typeof platform === "string" ? platform : null, legacyKey, "kv_reference", { source: "kv", name: item.name, path: `${entryPath}.key` }, { audit_action: action });
    }
  }
  // current_strategies_cache names accounts by `data[platform][accountKey]`
  // only; the reader projects that hierarchy for this family alone. The path
  // is an array because object keys may contain dots.
  for (const item of kv?.keys || []) {
    if (item.family !== "current_strategies_cache" || item.state !== "exported") continue;
    for (const [index, account] of (item.cache_accounts?.accounts || []).entries()) {
      const locator = { source: "kv", name: item.name, path: ["data", account.platform, account.account_key] };
      for (const [field, qualifier] of Object.entries(account.qualifiers || {})) {
        if (longString(qualifier)) lose(`kv:${item.name}:cache_accounts.accounts[${index}].qualifiers.${field}:${SCALAR_LOSS}`,
          { scope: "kv", group: KV_GROUP_OF.get(item.family) ?? null }, { ...locator, qualifier: field });
      }
      // An empty object key is still a stored account slot; add() would drop it.
      if (!account.account_key) { unattributed.push({ legacy_key: account.account_key, locator }); continue; }
      add(account.platform, account.account_key, "kv_reference", locator,
        { qualifiers: account.qualifiers, cache_entry: account.entry_shape, evidence_status: account.evidence_status });
    }
  }
  for (const item of env?.bindings || []) {
    const lost = path => lose(`env:${item.name}:${path}:${SCALAR_LOSS}`, { scope: "env" }, { source: "env", name: item.name, path });
    if (item.state === "present") addReferences(item.identity, "env_reference", { source: "env", name: item.name }, false, lost);
  }
  for (const option of options) add(option.platform, option.legacy_key, "configured_option", { source: option.source, path: option.path }, option.identity);
  const current = new Set([...mapping.values()].filter(item => item.states.has("current") || item.states.has("draft") || item.states.has("retirement_requested")).map(item => key(item.platform, item.legacy_key)));
  for (const item of mapping.values()) if (!current.has(key(item.platform, item.legacy_key))) item.states.add("orphan");
  const byKey = new Map();
  for (const item of mapping.values()) byKey.set(item.legacy_key, [...(byKey.get(item.legacy_key) || []), item.platform]);
  const conflicts = [];
  for (const item of mapping.values()) {
    // Every config-bearing episode, current or historical, compared by its
    // complete settings identity. Generic qualifiers are not part of it.
    // A tuple holding a lost field is unreadable and is compared with none.
    const identities = new Set();
    for (const episode of item.episodes.filter(episode => episode.identity?.config)) {
      episode.identity.settings_identity = settingsIdentity(item.platform, item.legacy_key, episode.identity.config);
      if (Object.values(episode.identity.settings_identity).some(longString)) episode.identity.settings_identity_qualification = SCALAR_LOSS;
      else identities.add(JSON.stringify(episode.identity.settings_identity));
    }
    if (identities.size > 1) conflicts.push({ platform: item.platform, legacy_key: item.legacy_key, kind: "identity_episodes_differ", episodes: identities.size });
    if (item.episodes.some(episode => episode.identity?.top_config_key_mismatch)) conflicts.push({ platform: item.platform, legacy_key: item.legacy_key, kind: "top_config_key_mismatch" });
    // Stored settings identity versus the current instance, as the settings
    // reader compares them; the stored values are kept, never replaced.
    const live = item.episodes.filter(episode => ["current", "draft", "retirement_requested"].includes(episode.state) && episode.identity?.config);
    const currentIdentity = live.length === 1 ? { ...normalizedConfig(live[0].identity.config), key: item.legacy_key } : null;
    const differing = [], environment = [];
    for (const episode of item.episodes) {
      const stored = episode.identity?.stored_identity;
      if (!stored) continue;
      if (!currentIdentity) episode.identity.stored_identity_matches_current = null;
      else if (stored.unreadable) { episode.identity.stored_identity_matches_current = null; differing.push({ locator: episode.locator, fields: ["unreadable"] }); }
      else {
        // A field lost on either side is unreadable: neither a match nor a difference.
        const lost = STORED_IDENTITY_FIELDS.filter(field => longString(stored[field]) || longString(currentIdentity[field]));
        const fields = STORED_IDENTITY_FIELDS.filter(field => !lost.includes(field) && (stored[field] ?? (field === "broker_environment" ? null : "")) !== currentIdentity[field]);
        episode.identity.stored_identity_matches_current = fields.length ? false : lost.length ? null : true;
        if (lost.length) episode.identity.stored_identity_unreadable_fields = lost;
        if (fields.length) differing.push({ locator: episode.locator, fields });
      }
      const declared = episode.identity.declaration?.environment;
      if (currentIdentity && declared?.valid && declared.value !== null && currentIdentity.broker_environment !== null && declared.value !== currentIdentity.broker_environment) {
        environment.push({ locator: episode.locator, declared: declared.value, current_broker_environment: currentIdentity.broker_environment });
      }
    }
    if (differing.length) conflicts.push({ platform: item.platform, legacy_key: item.legacy_key, kind: "stored_identity_differs_from_current", records: differing });
    if (environment.length) conflicts.push({ platform: item.platform, legacy_key: item.legacy_key, kind: "declared_environment_differs_from_current", records: environment });
  }
  const collisions = [...byKey].filter(([, platforms]) => platforms.length > 1).map(([legacyKey, platforms]) => ({ legacy_key: legacyKey, platforms }));
  for (const row of unattributed) row.candidate_platforms = byKey.get(row.legacy_key) || [];
  return { entries: [...mapping.values()].map(item => ({ ...item, states: [...item.states].sort() })), unattributed, conflicts, collisions,
    losses: [...losses.values()] };
}

function pendingFrom(objects, kv) {
  const pending = [];
  const push = (name, raw, fields) => { const outcome = classify(name, raw); if (outcome) pending.push({ family: name, ...fields, ...outcome }); };
  for (const result of objects) {
    for (const [table, read] of Object.entries(SQL_STATUS)) {
      for (const row of result.tables[table]?.rows || []) {
        push(table, row.projection_error ? { unreadable: row.projection_error } : read(row), { object: result.object, table, pk: row.pk });
      }
    }
    // A UX1 slot without stored job state holds no operation.
    for (const row of result.tables.ux1_research_slot?.rows || []) {
      const job = row.columns?.job_json;
      if (!row.projection_error && (job?.state === "null" || job?.column_absent)) continue;
      push("ux1_research_slot", row.projection_error ? { unreadable: row.projection_error } : jsonStatus(job), { object: result.object, table: "ux1_research_slot", pk: row.pk });
    }
    // Decision material stays pending until a decision record names it.
    const decided = new Set((result.tables.human_decision_record?.rows || []).map(row => JSON.stringify([row.columns?.kind, row.columns?.subject_id, row.columns?.material_key ?? null])));
    for (const table of ["human_decision_material", "human_decision_source_material"]) {
      for (const row of result.tables[table]?.rows || []) {
        if (decided.has(JSON.stringify([row.pk[0], row.pk[1], row.columns?.material_key ?? null]))) continue;
        pending.push({ family: table, object: result.object, table, pk: row.pk, status: "undecided", classification: "nonterminal",
          eligible: row.columns?.eligible ?? null, expires_at_ms: row.columns?.expires_at_ms ?? null, legacy_state: row.columns?.legacy_state ?? null });
      }
    }
    for (const item of result.do_kv?.entries || []) {
      const fields = { object: result.object, key: item.key };
      if (item.projection_error) pending.push({ family: "do_kv_unprojected", ...fields, status: `unreadable:${item.projection_error}`, classification: "unknown" });
      // A completed target snapshot is an observation, not a job: it is
      // excluded before job-state classification, whatever its `overall`.
      else if (item.family === "desk_readback_record") {
        if (item.record_kind !== "snapshot") push(item.family, item.payload_state, { ...fields, expired: item.expired ?? null, record_kind: item.record_kind ?? null });
      }
      else if (item.family === "desk_idempotency") push(item.family, item.state, fields);
      // Only an explicit idle admission holds no operation; a missing,
      // invalid or unreadable state stays listed as unknown.
      else if (item.family === "desk_readback_admission" && item.active_state !== "idle") {
        const state = item.active_state ?? "missing";
        pending.push({ family: item.family, ...fields, status: state, classification: state === "active" ? "nonterminal" : "unknown", expired: item.expired ?? null });
      }
    }
  }
  for (const item of kv?.keys || []) {
    if (!PENDING_FAMILIES[item.family] || KV_UNREVIEWED.has(item.state)) continue;
    push(item.family, item.state === "exported" ? jsonStatus({ state: "valid", fields: item.identity?.fields }) : { unreadable: item.state ?? "missing" }, { source: "kv", key: item.name });
  }
  return pending;
}

export function assemble(exported) {
  if (exported?.format !== EXPORT_FORMAT || !Array.isArray(exported.responses)) throw new Error("unsupported_export_format");
  const responses = exported.responses;
  const objects = OBJECTS.map(object => assembleObject(object, responses));
  const kv = assembleKv(responses);
  const envResponse = responses.filter(item => item.request.section === "env" && item.status === 200 && item.body?.ok === true).at(-1);
  const env = envResponse ? envResponse.body : null;
  // A selected option identity that was not read, or whose selection the
  // export cannot decide, makes group 16 and the overall result incomplete;
  // the surviving options stay mapped.
  const options = optionsFrom(kv, env);
  const { losses, ...mapping } = mappingFrom(objects, kv, env, options.options);
  // A lost selected identity scalar makes its table or DO-KV result and its
  // object incomplete; KV and environment losses reach their group below.
  for (const loss of losses) {
    const result = objects.find(item => item.object === loss.object);
    if (!result) continue;
    result.complete = false;
    (result.identity_losses ||= []).push(loss.reason);
    if (loss.scope === "sql") result.tables[loss.table].disposition = "incomplete";
    else result.do_kv.disposition = "incomplete";
  }
  const lossesOf = (scope, test = () => true) => losses.filter(loss => loss.scope === scope && test(loss)).map(loss => loss.reason);
  const groups = {}, groupReasons = {};
  const prefixed = test => objects.flatMap(result => result.reasons.filter(test).map(reason => `${result.object}:${reason}`));
  for (const [group, tables] of Object.entries(SQL_GROUPS)) {
    const states = objects.flatMap(result => tables.map(table => result.tables[table]?.disposition ?? "not_collected"));
    groups[group] = states.every(state => ["complete", "absent"].includes(state) || state.startsWith("count_only:")) ? "complete" : "incomplete";
    const local = [...prefixed(reason => tables.some(table => reason.startsWith(`${table}:`))), ...lossesOf("sql", loss => tables.includes(loss.table))];
    if (local.length) groupReasons[group] = local;
  }
  groups[15] = objects.every(result => result.do_kv?.disposition === "complete") ? "complete" : "incomplete";
  const doKvReasons = [...prefixed(reason => reason.startsWith("do_kv:")), ...lossesOf("do_kv")];
  if (doKvReasons.length) groupReasons[15] = doKvReasons;
  for (const group of Object.keys(KV_GROUPS)) {
    if (!kv) { groups[group] = "provider_export_required"; continue; }
    const local = [...kv.reasons, ...kv.failed_reads.filter(item => item.group === group).flatMap(item => item.causes.map(cause => `kv:${item.family}:${cause}`)),
      ...lossesOf("kv", loss => loss.group === group)];
    groups[group] = local.length ? "incomplete" : "complete";
    if (local.length) groupReasons[group] = [...new Set(local)];
  }
  if (groups[16] === "complete" && !env) groups[16] = "env_section_not_collected";
  // A binding whose identity projection was cut at its field or depth bound
  // holds identities that were not read; its projected references stay mapped.
  const envReasons = (env?.bindings || []).filter(item => item.state === "present" && item.identity?.truncated)
    .map(item => `env:${item.name}:identity_projection_truncated`);
  for (const local of [envReasons, options.reasons, lossesOf("env")]) {
    if (!local.length) continue;
    if (groups[16] === "complete") groups[16] = "incomplete";
    groupReasons[16] = [...new Set([...(groupReasons[16] || []), ...local])];
  }
  groups[23] = "external_evidence_required";
  const pending = pendingFrom(objects, kv);
  const enumerated = objects.every(result => result.complete) && Object.entries(groups).every(([group, state]) => state === "complete" || group === "23");
  const kvReasons = kv ? [...kv.reasons, ...new Set(kv.failed_reads.flatMap(item => item.causes.map(cause => `kv:${item.family}:${cause}`)))] : [];
  const result = { status: enumerated ? "retained_state_enumerated_external_evidence_required" : "incomplete", objects, kv, env, groups,
    group_reasons: groupReasons, mapping, identity_losses: losses, pending,
    reasons: [...kvReasons, ...envReasons, ...options.reasons, ...objects.flatMap(item => item.reasons.map(reason => `${item.object}:${reason}`)), ...losses.map(loss => loss.reason)] };
  return { private: result, summary: summarize(result) };
}

// Aggregates only. No keys, selectors, IDs, digests, object names or times.
export function summarize(result) {
  const count = (items, read) => items.reduce((totals, item) => { const name = read(item); totals[name] = (totals[name] || 0) + 1; return totals; }, {});
  return {
    format: "qsl_account_identity_inventory_summary.v1", status: result.status, groups: result.groups,
    objects: result.objects.map(item => ({ object: item.object, complete: item.complete, schema_state: item.schema_state ?? null,
      reason_count: item.reasons.length + (item.identity_losses?.length ?? 0), tables_complete: Object.values(item.tables).filter(table => table.disposition === "complete").length,
      tables_absent: Object.values(item.tables).filter(table => table.disposition === "absent").length,
      rows: Object.values(item.tables).reduce((total, table) => total + (table.rows?.length || 0), 0),
      failed_rows: Object.values(item.tables).reduce((total, table) => total + (table.failed_rows || 0), 0),
      do_kv_entries: item.do_kv?.entries.length ?? null, do_kv_unknown: item.do_kv?.unknown_keys ?? null, unknown_tables: item.unknown_tables?.length ?? null })),
    kv: result.kv ? { passes: result.kv.passes, complete_passes: result.kv.complete_passes, repeated_pass_equal: result.kv.repeated_pass_equal,
      stable: result.kv.stable, failed_reads: result.kv.failed_reads.length, names: result.kv.keys.length, states: count(result.kv.keys, item => item.state) } : null,
    env: result.env ? count(result.env.bindings, item => item.state) : null,
    mapping: { entries: result.mapping.entries.length, orphans: result.mapping.entries.filter(item => item.states.includes("orphan")).length,
      drafts: result.mapping.entries.filter(item => item.states.includes("draft")).length, conflicts: result.mapping.conflicts.length,
      cross_platform_collisions: result.mapping.collisions.length, unattributed_rows: result.mapping.unattributed.length },
    pending: count(result.pending, item => item.family),
    pending_classification: count(result.pending, item => item.classification),
    reason_count: result.reasons.length,
  };
}

async function main(argv) {
  const [input, ...rest] = argv;
  if (!input) {
    console.error("usage: node inspect_account_identity_inventory.mjs <private-export.json> [--private-out <file>] [--summary-out <file>]");
    process.exit(2);
  }
  const option = name => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : null; };
  const { private: result, summary } = assemble(JSON.parse(await readFile(input, "utf8")));
  if (option("--private-out")) await writeFile(option("--private-out"), JSON.stringify(result, null, 2), { mode: 0o600 });
  if (option("--summary-out")) await writeFile(option("--summary-out"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.status === "incomplete" ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
