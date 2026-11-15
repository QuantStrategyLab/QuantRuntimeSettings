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
// Only explicit terminal labels are terminal; everything else stays pending or
// unknown. LongBridge `stopped` remains open in the current implementation.
const TERMINAL = new Set(["applied", "rejected", "failed", "completed", "complete", "succeeded", "canceled", "cancelled", "expired", "superseded"]);
const PENDING_SOURCES = {
  account_setting_profile_application: row => row.columns.status,
  account_diagnosis_tasks: row => row.columns.status,
  research_promotion_applications: row => row.columns.status,
  hk_stop_request: row => row.columns.phase,
  credential_rotation_operations: row => row.columns.record?.fields?.state ?? row.columns.record?.fields?.phase ?? null,
  credential_maintenance_delivery: row => row.columns.state,
};

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

function assembleKv(responses, reasons) {
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
  if (!complete.length) reasons.push("kv:no_complete_pass");
  const [first, second] = complete.slice(-2);
  const fingerprint = pass => JSON.stringify(pass.keys.map(item => [item.name, item.state, item.value_sha256 ?? null]));
  const repeated = Boolean(first && second && fingerprint(first) === fingerprint(second));
  return { passes: passes.length, complete_passes: complete.length, repeated_pass_equal: repeated, keys: complete.at(-1)?.keys ?? [] };
}

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
        } else if (table === "instance_history") {
          for (const side of ["before", "after"]) {
            const instance = columns.entry?.[side];
            if (instance) add(instance.platform, instance.key, "historical", { ...locator, side }, { config: instance.config });
          }
        } else {
          const logical = row.logical_account;
          const pkNames = { account_period_return: ["account_key"], account_daily_native_return: ["account_key"], binance_detail_daily: ["account_key"] }[table];
          const platform = table === "binance_detail_daily" ? "binance" : pkNames ? null : value(row.pk[0]);
          const accountKey = logical?.legacy_key ?? (pkNames ? row.pk[0] : table === "research_promotion_applications" || table === "account_diagnosis_tasks" || table === "account_setting_profile_application" ? columns.account_key : row.pk[1]);
          const resolvedPlatform = table === "research_promotion_applications" ? columns.platform_id : ["account_diagnosis_tasks", "account_setting_profile_application"].includes(table) ? columns.platform : platform;
          if (["account_setting_draft", "account_setting_declaration", "account_setting_profile_application", "account_facts_observation",
            "account_facts_daily", "account_external_flow", "account_executions", "account_execution_reports", "binance_detail_daily",
            "account_diagnosis_tasks", "research_promotion_applications", "account_period_return", "account_daily_native_return"].includes(table)) {
            add(resolvedPlatform, value(accountKey), "store_reference", locator, { storage_key: row.pk, logical_account: logical || null });
          }
        }
      }
    }
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
    const identities = new Set(item.episodes.filter(episode => episode.identity?.config).map(episode => JSON.stringify([episode.identity.config.account_selector ?? null, episode.identity.config.target_name ?? null])));
    if (identities.size > 1) conflicts.push({ platform: item.platform, legacy_key: item.legacy_key, kind: "identity_episodes_differ", episodes: identities.size });
    if (item.episodes.some(episode => episode.identity?.top_config_key_mismatch)) conflicts.push({ platform: item.platform, legacy_key: item.legacy_key, kind: "top_config_key_mismatch" });
  }
  const collisions = [...byKey].filter(([, platforms]) => platforms.length > 1).map(([legacyKey, platforms]) => ({ legacy_key: legacyKey, platforms }));
  for (const row of unattributed) row.candidate_platforms = byKey.get(row.legacy_key) || [];
  return { entries: [...mapping.values()].map(item => ({ ...item, states: [...item.states].sort() })), unattributed, conflicts, collisions };
}

function pendingFrom(objects) {
  const pending = [];
  for (const result of objects) {
    for (const [table, read] of Object.entries(PENDING_SOURCES)) {
      for (const row of result.tables[table]?.rows || []) {
        const status = read(row);
        if (!TERMINAL.has(status)) pending.push({ object: result.object, table, pk: row.pk, status: status ?? "unknown" });
      }
    }
    for (const item of result.do_kv?.entries || []) {
      if (item.family === "desk_readback_record" && item.payload_state === "running") pending.push({ object: result.object, family: item.family, key: item.key, status: "running" });
      if (item.family === "desk_idempotency" && item.state !== "complete") pending.push({ object: result.object, family: item.family, key: item.key, status: item.state ?? "unknown" });
    }
  }
  return pending;
}

export function assemble(exported) {
  if (exported?.format !== EXPORT_FORMAT || !Array.isArray(exported.responses)) throw new Error("unsupported_export_format");
  const responses = exported.responses;
  const objects = OBJECTS.map(object => assembleObject(object, responses));
  const reasons = [];
  const kv = assembleKv(responses, reasons);
  const envResponse = responses.filter(item => item.request.section === "env" && item.status === 200 && item.body?.ok === true).at(-1);
  const env = envResponse ? envResponse.body : null;
  const groups = {};
  for (const [group, tables] of Object.entries(SQL_GROUPS)) {
    const states = objects.flatMap(result => tables.map(table => result.tables[table]?.disposition ?? "not_collected"));
    groups[group] = states.every(state => ["complete", "absent"].includes(state) || state.startsWith("count_only:")) ? "complete" : "incomplete";
  }
  groups[15] = objects.every(result => result.do_kv) ? "complete" : "incomplete";
  const kvComplete = Boolean(kv?.complete_passes);
  for (const [group] of Object.entries(KV_GROUPS)) groups[group] = kvComplete ? "complete" : "provider_export_required";
  if (groups[16] === "complete" && !env) groups[16] = "env_section_not_collected";
  groups[23] = "external_evidence_required";
  const mapping = mappingFrom(objects, kv, env);
  const pending = pendingFrom(objects);
  const enumerated = objects.every(result => result.complete) && Object.entries(groups).every(([group, state]) => state === "complete" || group === "23");
  const result = { status: enumerated ? "retained_state_enumerated_external_evidence_required" : "incomplete", objects, kv, env, groups, mapping, pending,
    reasons: [...reasons, ...objects.flatMap(item => item.reasons.map(reason => `${item.object}:${reason}`))] };
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
      names: result.kv.keys.length, states: count(result.kv.keys, item => item.state) } : null,
    env: result.env ? count(result.env.bindings, item => item.state) : null,
    mapping: { entries: result.mapping.entries.length, orphans: result.mapping.entries.filter(item => item.states.includes("orphan")).length,
      drafts: result.mapping.entries.filter(item => item.states.includes("draft")).length, conflicts: result.mapping.conflicts.length,
      cross_platform_collisions: result.mapping.collisions.length, unattributed_rows: result.mapping.unattributed.length },
    pending: count(result.pending, item => item.table ?? item.family),
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
