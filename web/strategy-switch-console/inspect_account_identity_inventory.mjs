#!/usr/bin/env node
// Offline assembler for a private account-identity inventory export. Reads
// only the supplied export file; it makes no network request. The private
// mapping is written only where --private-out points. Standard output carries
// the sanitized summary: counts and dispositions, never keys or identifiers.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const EXPORT_FORMAT = "qsl_account_identity_inventory_export.v1";
const OBJECTS = ["runtime", "directory"];
const SQL_GROUPS = {
  1: ["instance_state", "instance_history"], 2: ["account_setting_draft", "account_setting_declaration"],
  3: ["account_setting_profile_application"], 4: ["risk_profile_authority"], 5: ["account_facts_observation", "account_facts_daily"],
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
    entry.disposition = reasons.some(reason => reason.startsWith(`${name}:`)) ? "incomplete" : "complete";
  }
  const unknown = schema.body.other_schema_objects.filter(item => item.classification === "unknown_table");
  const kvPages = chain(ok.filter(item => item.request.section === "do_kv" && item.body.scan_id === scanId), reasons, "do_kv");
  let doKv = null;
  if (kvPages) {
    const entries = kvPages.flatMap(page => page.body.entries);
    if (new Set(entries.map(item => item.key)).size !== entries.length) reasons.push("do_kv:duplicate_key");
    doKv = { entries, unknown_keys: entries.filter(item => item.family === "unknown").length, alarm: final.body.alarm };
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
const STORED_IDENTITY_TABLES = ["account_setting_draft", "account_setting_declaration", "account_setting_profile_application"];
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
function identityReferences(fields, document) {
  const groups = new Map();
  for (const [path, item] of Object.entries(fields || {})) {
    const parent = parentPath(path), name = path.slice(parent ? parent.length + 1 : 0);
    if (!groups.has(parent)) groups.set(parent, {});
    groups.get(parent)[name] = item;
  }
  const platformAt = path => PLATFORM_FIELDS.map(name => groups.get(path)?.[name]).find(item => typeof item === "string" && item);
  const references = [];
  for (const [parent, group] of groups) {
    for (const name of document ? DOCUMENT_FIELDS : ACCOUNT_FIELDS) {
      const legacyKey = group[name];
      if (typeof legacyKey !== "string" || !legacyKey) continue;
      // An unparseable ancestry keeps only a platform beside the reference;
      // none is inferred through the remainder.
      const ancestry = ancestorPaths(parent);
      const platform = [parent, ...(ancestry.parseable ? ancestry.paths : [])].map(platformAt).find(Boolean) ?? null;
      const qualifiers = Object.fromEntries(QUALIFIER_FIELDS.filter(field => field in group).map(field => [field, group[field]]));
      references.push({ legacy_key: legacyKey, platform, path: parent ? `${parent}.${name}` : name, qualifiers,
        ...(ancestry.parseable ? {} : { path_qualification: "unparseable_identity_path" }) });
    }
  }
  return references;
}
const normalizedConfig = config => Object.fromEntries(STORED_IDENTITY_FIELDS.map(field => [field, field === "broker_environment"
  ? (["live", "paper"].includes(config?.[field]) ? config[field] : null) : typeof config?.[field] === "string" ? config[field] : ""]));
// The settings identity of an instance episode as accountSettingsIdentity()
// derives it: platform, the top-level key (never config.key) and the
// normalized config fields, in one fixed order.
const settingsIdentity = (platform, legacyKey, config) => {
  const normalized = normalizedConfig(config);
  return { platform, key: legacyKey, target_name: normalized.target_name, broker_environment: normalized.broker_environment,
    account_selector: normalized.account_selector, deployment_selector: normalized.deployment_selector,
    account_scope: normalized.account_scope, service_name: normalized.service_name };
};

function mappingFrom(objects, kv, env) {
  const mapping = new Map(), unattributed = [];
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
  const addReferences = (projection, state, locator, document) => {
    for (const reference of identityReferences(projection?.fields, document)) {
      const qualification = reference.path_qualification ? { path_qualification: reference.path_qualification } : {};
      add(reference.platform, reference.legacy_key, state, { ...locator, path: reference.path, ...qualification }, { qualifiers: reference.qualifiers });
    }
  };
  for (const result of objects) {
    for (const [table, data] of Object.entries(result.tables)) {
      for (const row of data.rows || []) {
        const locator = { object: result.object, table, pk: row.pk };
        const columns = row.columns || {};
        if (table === "instance_state") {
          for (const instance of columns.payload?.entries || []) {
            const state = instance.retirement_status && instance.retirement_status !== "none" ? "retirement_requested" : instance.kind === "existing" ? "current" : instance.kind === "draft" ? "draft" : "unknown";
            add(instance.platform, instance.key, state, locator, { config: instance.config, top_config_key_mismatch: instance.top_config_key_mismatch });
          }
          continue;
        }
        if (table === "instance_history") {
          for (const side of ["before", "after"]) {
            const instance = columns.entry?.[side];
            if (instance) add(instance.platform, instance.key, "historical", { ...locator, side }, { config: instance.config });
          }
          continue;
        }
        const logical = row.logical_account;
        const pkNames = { account_period_return: ["account_key"], account_daily_native_return: ["account_key"], binance_detail_daily: ["account_key"] }[table];
        const platform = table === "binance_detail_daily" ? "binance" : pkNames ? null : value(row.pk[0]);
        const accountKey = logical?.legacy_key ?? (pkNames ? row.pk[0] : table === "research_promotion_applications" || table === "account_diagnosis_tasks" || table === "account_setting_profile_application" ? columns.account_key : row.pk[1]);
        const resolvedPlatform = table === "research_promotion_applications" ? columns.platform_id : ["account_diagnosis_tasks", "account_setting_profile_application"].includes(table) ? columns.platform : platform;
        if (["account_setting_draft", "account_setting_declaration", "account_setting_profile_application", "account_facts_observation",
          "account_facts_daily", "account_external_flow", "account_executions", "account_execution_reports", "binance_detail_daily",
          "account_diagnosis_tasks", "research_promotion_applications", "account_period_return", "account_daily_native_return"].includes(table)) {
          const identity = { storage_key: row.pk, logical_account: logical || null };
          if (STORED_IDENTITY_TABLES.includes(table)) {
            const stored = columns.identity_json;
            identity.stored_identity = stored?.state === "valid"
              ? Object.fromEntries(STORED_IDENTITY_FIELDS.filter(field => field in stored.fields).map(field => [field, stored.fields[field]]))
              : { unreadable: stored?.column_absent ? "column_absent" : stored?.state ?? "absent" };
          }
          if (table === "account_setting_declaration") {
            const declaration = columns.declaration_json;
            identity.declaration = declaration?.state === "valid"
              ? { state: "valid", environment: declaration.environment, account_type: declaration.account_type, unexpected_keys: declaration.unexpected_keys }
              : { state: declaration?.state ?? (declaration?.column_absent ? "column_absent" : "absent") };
          }
          add(resolvedPlatform, value(accountKey), "store_reference", locator, identity);
        }
        // Every projected JSON column, including operation payloads.
        for (const [column, projection] of Object.entries(columns)) {
          if (projection?.state === "valid" && projection.fields) addReferences(projection, "store_reference", { ...locator, column }, column === "identity_json");
        }
      }
    }
    for (const item of result.do_kv?.entries || []) {
      if (item.payload_identity) addReferences(item.payload_identity, "store_reference", { object: result.object, do_kv_key: item.key }, false);
    }
  }
  for (const item of kv?.keys || []) {
    if (item.state === "exported") addReferences(item.identity, "kv_reference", { source: "kv", name: item.name }, false);
  }
  // current_strategies_cache names accounts by `data[platform][accountKey]`
  // only; the reader projects that hierarchy for this family alone. The path
  // is an array because object keys may contain dots.
  for (const item of kv?.keys || []) {
    if (item.family !== "current_strategies_cache" || item.state !== "exported") continue;
    for (const account of item.cache_accounts?.accounts || []) {
      const locator = { source: "kv", name: item.name, path: ["data", account.platform, account.account_key] };
      // An empty object key is still a stored account slot; add() would drop it.
      if (!account.account_key) { unattributed.push({ legacy_key: account.account_key, locator }); continue; }
      add(account.platform, account.account_key, "kv_reference", locator,
        { qualifiers: account.qualifiers, cache_entry: account.entry_shape, evidence_status: account.evidence_status });
    }
  }
  for (const item of env?.bindings || []) {
    if (item.state === "present") addReferences(item.identity, "env_reference", { source: "env", name: item.name }, false);
  }
  const optionSources = [...(kv?.keys || []).filter(item => item.name === "account_options" && item.state === "exported").map(item => ({ fields: item.identity.fields, source: "kv:account_options" })),
    ...(env?.bindings || []).filter(item => item.name === "STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON" && item.state === "present").map(item => ({ fields: item.identity.fields, source: "env:STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON" }))];
  for (const { fields, source } of optionSources) {
    for (const [path, keyValue] of Object.entries(fields)) {
      const match = /^([^.[]+)\[(\d+)\]\.key$/.exec(path);
      if (match) add(match[1], keyValue, "configured_option", { source, path });
    }
  }
  const current = new Set([...mapping.values()].filter(item => item.states.has("current") || item.states.has("draft") || item.states.has("retirement_requested")).map(item => key(item.platform, item.legacy_key)));
  for (const item of mapping.values()) if (!current.has(key(item.platform, item.legacy_key))) item.states.add("orphan");
  const byKey = new Map();
  for (const item of mapping.values()) byKey.set(item.legacy_key, [...(byKey.get(item.legacy_key) || []), item.platform]);
  const conflicts = [];
  for (const item of mapping.values()) {
    // Every config-bearing episode, current or historical, compared by its
    // complete settings identity. Generic qualifiers are not part of it.
    const identities = new Set();
    for (const episode of item.episodes.filter(episode => episode.identity?.config)) {
      episode.identity.settings_identity = settingsIdentity(item.platform, item.legacy_key, episode.identity.config);
      identities.add(JSON.stringify(episode.identity.settings_identity));
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
        const fields = STORED_IDENTITY_FIELDS.filter(field => (stored[field] ?? (field === "broker_environment" ? null : "")) !== currentIdentity[field]);
        episode.identity.stored_identity_matches_current = !fields.length;
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
  return { entries: [...mapping.values()].map(item => ({ ...item, states: [...item.states].sort() })), unattributed, conflicts, collisions };
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
  const groups = {}, groupReasons = {};
  for (const [group, tables] of Object.entries(SQL_GROUPS)) {
    const states = objects.flatMap(result => tables.map(table => result.tables[table]?.disposition ?? "not_collected"));
    groups[group] = states.every(state => ["complete", "absent"].includes(state) || state.startsWith("count_only:")) ? "complete" : "incomplete";
  }
  groups[15] = objects.every(result => result.do_kv) ? "complete" : "incomplete";
  for (const group of Object.keys(KV_GROUPS)) {
    if (!kv) { groups[group] = "provider_export_required"; continue; }
    const local = [...kv.reasons, ...kv.failed_reads.filter(item => item.group === group).flatMap(item => item.causes.map(cause => `kv:${item.family}:${cause}`))];
    groups[group] = local.length ? "incomplete" : "complete";
    if (local.length) groupReasons[group] = [...new Set(local)];
  }
  if (groups[16] === "complete" && !env) groups[16] = "env_section_not_collected";
  groups[23] = "external_evidence_required";
  const mapping = mappingFrom(objects, kv, env);
  const pending = pendingFrom(objects, kv);
  const enumerated = objects.every(result => result.complete) && Object.entries(groups).every(([group, state]) => state === "complete" || group === "23");
  const kvReasons = kv ? [...kv.reasons, ...new Set(kv.failed_reads.flatMap(item => item.causes.map(cause => `kv:${item.family}:${cause}`)))] : [];
  const result = { status: enumerated ? "retained_state_enumerated_external_evidence_required" : "incomplete", objects, kv, env, groups,
    group_reasons: groupReasons, mapping, pending, reasons: [...kvReasons, ...objects.flatMap(item => item.reasons.map(reason => `${item.object}:${reason}`))] };
  return { private: result, summary: summarize(result) };
}

// Aggregates only. No keys, selectors, IDs, digests, object names or times.
export function summarize(result) {
  const count = (items, read) => items.reduce((totals, item) => { const name = read(item); totals[name] = (totals[name] || 0) + 1; return totals; }, {});
  return {
    format: "qsl_account_identity_inventory_summary.v1", status: result.status, groups: result.groups,
    objects: result.objects.map(item => ({ object: item.object, complete: item.complete, schema_state: item.schema_state ?? null,
      reason_count: item.reasons.length, tables_complete: Object.values(item.tables).filter(table => table.disposition === "complete").length,
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
