// STORE: the RuntimeInstances management store over a real SQLite
// transaction. Covers the core rows of B2-ATOMIC-PHYSICAL-MANAGEMENT-v1 that
// are Durable Object transaction behaviour: atomicity with injected faults
// (A04), concurrency (A05), replay and request conflicts (A06), stale
// revisions and identities (A07), tampering (A09), physical siblings (A10),
// independence (A11), live revision stability (A15), policy lifecycle
// (A16), initialization and binding (A20) and the admission races the store
// decides (A21). Synthetic fixture only; zero outbound calls. The printed
// result carries row IDs, outcome codes and counts, never identities.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FIXTURE_ACCOUNTS, INSTANCES, POLICY_REVISION, baselineStore, createStore, evidence, management, managementCommand,
  outbound, policyOf, provision, ref, requestKey, setManagement, statuses,
} from "./helpers/account_management_harness.mjs";

const result = evidence("STORE");
const ok = (row, outcome, condition, message) => { assert.ok(condition, `${row}: ${message || outcome}`); result.record(row, outcome); };
const same = (row, outcome, actual, expected, message) => { assert.deepEqual(actual, expected, `${row}: ${message || outcome}`); result.record(row, outcome); };
const PAIR = "ibkr/syn-acct-01", SIBLING = "ibkr/syn-acct-01-b";
const MANAGEMENT_TABLES = ["account_management_draft", "account_management_applied", "account_management_change", "account_management_requests"];
const counts = store => Object.fromEntries(MANAGEMENT_TABLES.map(table => [table, store.count(table)]));
const runtimeSnapshot = store => store.state().instances.map(item => JSON.stringify([item.platform, item.key, item.enabled, item.config, item.retirement_status]));

// --- B2-A04: atomicity with injected faults -------------------------------
{
  const store = await baselineStore();
  const [platform, key] = ref(PAIR);
  const saved = await store.call(managementCommand(store, "account_management_draft_save", platform, key, { management_enabled: false }));
  same("B2-A04", "draft_saved", saved.status, 200);
  const before = counts(store);
  store.faults.writes.length = 0;
  const applied = await store.call(managementCommand(store, "account_management_apply", platform, key));
  same("B2-A04", "applied", [applied.status, applied.body.outcome], [200, "applied"]);
  const after = counts(store);
  same("B2-A04", "one_logical_event", after.account_management_change - before.account_management_change, 1);
  same("B2-A04", "one_receipt", after.account_management_requests - before.account_management_requests, 1);
  const rows = store.rows("account_management_applied").filter(row => row.platform === platform && row.account_key.startsWith(key));
  same("B2-A04", "all_siblings_written", rows.map(row => [row.revision, row.management_enabled]), [[2, 0], [2, 0]]);
  // The ordered write statements of one physical apply.
  same("B2-A04", "write_sequence", store.faults.writes, ["INSERT INTO account_management_applied", "INSERT INTO account_management_applied",
    "UPDATE account_management_draft SET", "UPDATE account_management_draft SET", "INSERT INTO account_management_change", "INSERT INTO account_management_requests"]);
  store.close();
}
// Each pre-commit failure point: after each sibling write, before and after
// the journal insert, before and after the receipt insert (the last one
// fails at commit). None of the attempted state, event or receipt remains;
// the same request then commits exactly once.
for (const point of [0, 1, 2, 3, 4, 5, "commit"]) {
  for (const operation of ["account_management_apply", "account_management_draft_save"]) {
    const store = await baselineStore();
    const [platform, key] = ref(PAIR);
    if (operation === "account_management_apply") {
      assert.equal((await store.call(managementCommand(store, "account_management_draft_save", platform, key, { management_enabled: false }))).status, 200);
    }
    const command = managementCommand(store, operation, platform, key, operation === "account_management_draft_save" ? { management_enabled: false } : {});
    const before = store.dump();
    store.faults.writes.length = 0;
    if (point === "commit") store.faults.beforeCommit = () => true;
    else store.faults.exec = (_text, index) => index === point;
    const failed = await store.call(command);
    store.faults.exec = null; store.faults.beforeCommit = null;
    if (operation === "account_management_draft_save" && typeof point === "number" && point > 2) { store.close(); continue; }
    same("B2-A04", "fault_rejected", failed.status, 409, `${operation} fault ${point}`);
    same("B2-A04", "fault_rolled_back", store.dump(), before, `${operation} fault ${point} leaves nothing`);
    const retried = await store.call(command);
    same("B2-A04", "retry_commits_once", [retried.status, retried.body.replayed], [200, false], `${operation} retry ${point}`);
    const replay = await store.call(command);
    same("B2-A04", "retry_replays", [replay.status, replay.body.replayed], [200, true]);
    store.close();
  }
}
// The management transaction never touches the KV mirror: with every KV
// operation failing, the apply commits and its durable history stays.
{
  const store = await baselineStore();
  let kvOperations = 0;
  store.object.directory = new Proxy({}, { get() { kvOperations += 1; throw new Error("kv_unavailable"); } });
  await setManagement(store, PAIR, false);
  same("B2-A04", "kv_failure_cannot_lose_durable_state", [kvOperations, store.resolve(...ref(PAIR)).management_status, store.count("account_management_change")],
    [0, "management_disabled", 10]);
  store.close();
}

// --- B2-A05: concurrency ----------------------------------------------------
{
  const store = await baselineStore();
  const [platform, key] = ref(PAIR), [, siblingKey] = ref(SIBLING);
  const first = managementCommand(store, "account_management_draft_save", platform, key, { management_enabled: false });
  const second = { ...managementCommand(store, "account_management_draft_save", platform, siblingKey, { management_enabled: true }) };
  const before = counts(store);
  const saves = await Promise.all([store.call(first), store.call(second)]);
  same("B2-A05", "one_save_winner", saves.map(item => item.status).sort(), [200, 409]);
  same("B2-A05", "save_loser_draft_conflict", saves.find(item => item.status === 409).body.error, "management_draft_revision_conflict");
  same("B2-A05", "loser_no_receipt", counts(store).account_management_requests - before.account_management_requests, 1);
  const drafts = store.rows("account_management_draft").filter(row => row.account_key.startsWith(key));
  same("B2-A05", "no_partial_siblings", new Set(drafts.map(row => JSON.stringify([row.revision, row.management_enabled]))).size, 1);
  const applyA = managementCommand(store, "account_management_apply", platform, key);
  const applyB = managementCommand(store, "account_management_apply", platform, siblingKey);
  const applies = await Promise.all([store.call(applyA), store.call(applyB)]);
  same("B2-A05", "one_apply_winner", applies.map(item => item.status).sort(), [200, 409]);
  ok("B2-A05", "apply_loser_revision_conflict", ["management_draft_revision_conflict", "management_applied_revision_conflict"].includes(applies.find(item => item.status === 409).body.error));
  same("B2-A05", "one_event", store.count("account_management_change"), 10);
  same("B2-A05", "loser_receipt_absent", store.rows("account_management_requests").filter(row => [applyA.request_key, applyB.request_key].includes(row.request_key)).length, 1);
  store.close();
}

// --- B2-A06: replay and request conflicts -----------------------------------
{
  const store = await baselineStore();
  const [platform, key] = ref(PAIR), [, siblingKey] = ref(SIBLING);
  const save = managementCommand(store, "account_management_draft_save", platform, key, { management_enabled: false });
  const saved = await store.call(save);
  const apply = managementCommand(store, "account_management_apply", platform, key);
  const applied = await store.call(apply);
  await setManagement(store, PAIR, true);
  const advanced = counts(store);
  for (const [command, original] of [[save, saved.body], [apply, applied.body]]) {
    const replay = await store.call(command);
    same("B2-A06", "exact_replay_original_receipt", { ...replay.body, replayed: false }, original);
    ok("B2-A06", "replay_flagged", replay.body.replayed === true);
  }
  same("B2-A06", "replay_no_mutation", counts(store), advanced);
  ok("B2-A06", "historical_receipt_revisions_explicit", applied.body.management_revision < store.resolve(platform, key).applied.revision);
  const changed = {
    value: { ...save, management_enabled: true },
    address: { ...save, key: siblingKey, identity: store.identity(platform, siblingKey) },
    identity: { ...save, identity: { ...save.identity, service_name: "syn-other" } },
    revision: { ...save, expected_management_draft_revision: save.expected_management_draft_revision + 1 },
    operation: { ...apply, action: "account_management_draft_save", management_enabled: false, request_key: save.request_key },
    actor: { ...save, actor: "synthetic-other" },
  };
  for (const [field, command] of Object.entries(changed)) {
    const response = await store.call(command);
    same("B2-A06", "management_request_conflict", [response.status, response.body.error], [409, "management_request_conflict"], field);
  }
  same("B2-A06", "conflict_no_mutation", counts(store), advanced);
  // Fresh, validated same-value apply: an explicit no-op receipt.
  const draft = await store.call(managementCommand(store, "account_management_draft_save", platform, key, { management_enabled: true }));
  const appliedRevision = store.resolve(platform, key).applied.revision;
  const events = store.count("account_management_change");
  const noOp = await store.call(managementCommand(store, "account_management_apply", platform, key));
  same("B2-A06", "same_value_apply_no_op", [draft.status, noOp.status, noOp.body.outcome, noOp.body.replayed], [200, 200, "no_op", false]);
  same("B2-A06", "no_op_keeps_applied_revision", [store.resolve(platform, key).applied.revision, store.count("account_management_change")], [appliedRevision, events]);
  store.close();
}

// --- B2-A07: stale revisions and identities ---------------------------------
{
  const cases = {
    async instance(store) { await store.call({ action: "create", actor: "synthetic-admin", expected_revision: store.state().revision, platform: "ibkr",
      config: { key: "syn-acct-99", target_name: "syn-target-99", account_selector: "SYN0000099", deployment_selector: "syn-deploy-99", service_name: "syn-service-99", broker_environment: "live" } });
    return "management_instance_revision_conflict"; },
    async policy(store) { assert.equal((await provision(store, policyOf(FIXTURE_ACCOUNTS, INSTANCES, POLICY_REVISION + 1), POLICY_REVISION)).status, 200);
      return "management_policy_revision_conflict"; },
    async draft(store) { assert.equal((await store.call(managementCommand(store, "account_management_draft_save", ...ref(PAIR), { management_enabled: false }))).status, 200);
      return "management_draft_revision_conflict"; },
    async applied(store) { await setManagement(store, PAIR, false); return "management_draft_revision_conflict"; },
  };
  for (const [name, advance] of Object.entries(cases)) {
    const store = await baselineStore();
    const stale = managementCommand(store, "account_management_draft_save", ...ref(PAIR), { management_enabled: false });
    const expected = await advance(store);
    const before = store.dump();
    const response = await store.call(stale);
    same("B2-A07", expected, [response.status, response.body.error], [409, expected], name);
    same("B2-A07", "stale_zero_writes", store.dump(), before, name);
    store.close();
  }
  // The applied axis alone: a draft saved on an old applied base.
  {
    const store = await baselineStore();
    await store.call(managementCommand(store, "account_management_draft_save", ...ref(PAIR), { management_enabled: false }));
    const stale = managementCommand(store, "account_management_apply", ...ref(PAIR), { expected_management_revision: 0 });
    const response = await store.call(stale);
    same("B2-A07", "management_applied_revision_conflict", [response.status, response.body.error], [409, "management_applied_revision_conflict"]);
    store.close();
  }
  // Each saved axis alone: a refreshed apply request cannot qualify an older
  // draft, for a real change and for a no-op alike; a current draft applies.
  for (const [axis, value] of [["instance", false], ["instance", true], ["policy", false], ["policy", true]]) {
    const store = await baselineStore();
    const saved = await store.call(managementCommand(store, "account_management_draft_save", ...ref(PAIR), { management_enabled: value }));
    assert.equal(saved.status, 200);
    if (axis === "instance") {
      await store.call({ action: "create", actor: "synthetic-admin", expected_revision: store.state().revision, platform: "ibkr",
        config: { key: "syn-acct-99", target_name: "syn-target-99", account_selector: "SYN0000099", deployment_selector: "syn-deploy-99", service_name: "syn-service-99", broker_environment: "live" } });
    } else {
      assert.equal((await provision(store, policyOf(FIXTURE_ACCOUNTS, INSTANCES, POLICY_REVISION + 1), POLICY_REVISION)).status, 200);
    }
    const before = store.dump();
    const refreshed = await store.call(managementCommand(store, "account_management_apply", ...ref(PAIR)));
    const expected = `management_${axis}_revision_conflict`;
    same("B2-A07", "saved_axis_conflict", [refreshed.status, refreshed.body.error], [409, expected], `${axis}:${value}`);
    same("B2-A07", "saved_axis_zero_writes", store.dump(), before, `${axis}:${value}`);
    store.close();
  }
  {
    const store = await baselineStore();
    await store.call(managementCommand(store, "account_management_draft_save", ...ref(PAIR), { management_enabled: false }));
    const applied = await store.call(managementCommand(store, "account_management_apply", ...ref(PAIR)));
    same("B2-A07", "current_draft_applies_positive_control", [applied.status, applied.body.outcome], [200, "applied"]);
    store.close();
  }
  // A changed settings identity, and a request carrying a different one.
  {
    const store = await baselineStore();
    const tampered = managementCommand(store, "account_management_draft_save", ...ref("ibkr/syn-acct-02"));
    const response = await store.call({ ...tampered, identity: { ...tampered.identity, account_selector: "SYN-OTHER" } });
    same("B2-A07", "management_identity_conflict", [response.status, response.body.error], [409, "management_identity_conflict"], "request identity");
    const stale = managementCommand(store, "account_management_draft_save", ...ref("longbridge/syn-acct-06"));
    const moved = await store.call({ action: "set_broker_environment", actor: "synthetic-admin", expected_revision: store.state().revision, platform: "longbridge", key: "syn-acct-06", broker_environment: "paper" });
    assert.equal(moved.status, 200);
    const before = store.dump();
    const changed = await store.call({ ...managementCommand(store, "account_management_draft_save", ...ref("longbridge/syn-acct-06")), identity: stale.identity });
    same("B2-A07", "management_identity_conflict", [changed.status, changed.body.error], [409, "management_identity_conflict"], "changed identity");
    same("B2-A07", "stale_zero_writes", store.dump(), before);
    store.close();
  }
}

// --- B2-A09: tampering --------------------------------------------------------
{
  const store = await baselineStore();
  const before = store.dump();
  for (const field of ["management_class", "management_status", "label", "siblings", "policy", "effective_at"]) {
    const response = await store.call({ ...managementCommand(store, "account_management_draft_save", ...ref(PAIR)), [field]: "eligible" });
    same("B2-A09", "management_request_invalid", [response.status, response.body.error], [400, "management_request_invalid"], field);
  }
  const notBoolean = await store.call(managementCommand(store, "account_management_draft_save", ...ref(PAIR), { management_enabled: "true" }));
  same("B2-A09", "management_request_invalid", notBoolean.body.error, "management_request_invalid");
  const editableApply = await store.call({ ...managementCommand(store, "account_management_apply", ...ref(PAIR)), management_enabled: false });
  same("B2-A09", "management_request_invalid", editableApply.body.error, "management_request_invalid", "apply carries no editable boolean");
  const displayOnly = await store.call(managementCommand(store, "account_management_draft_save", "longbridge", "syn-acct-08", { management_enabled: true }));
  same("B2-A09", "display_only_enable_denied", [displayOnly.status, displayOnly.body.error], [409, "management_state_conflict"]);
  same("B2-A09", "denial_no_mutation", store.dump(), before);
  // Persisted domain state carrying a class is a stored contradiction.
  const [row] = store.rows("account_management_applied").filter(item => item.account_key === "syn-acct-02");
  store.db.prepare("UPDATE account_management_applied SET identity_json = ? WHERE platform = ? AND account_key = ?")
    .run(JSON.stringify({ ...JSON.parse(row.identity_json), management_class: "eligible" }), row.platform, row.account_key);
  const tampered = store.resolve("ibkr", "syn-acct-02");
  same("B2-A09", "stored_contradiction_conflicts", [tampered.evidence_state, tampered.processing_eligible], ["conflict", false]);
  store.db.prepare("UPDATE account_management_applied SET identity_json = ?, management_enabled = 2 WHERE platform = ? AND account_key = ?").run(row.identity_json, row.platform, row.account_key);
  same("B2-A09", "corrupt_value_not_laundered", store.resolve("ibkr", "syn-acct-02").evidence_state, "conflict");
  store.close();
  // No platform or account literal in the new classification/admission module.
  const source = await readFile(new URL("../web/strategy-switch-console/application/runtime_instances/account_management.js", import.meta.url), "utf8");
  for (const literal of ["\"ibkr\"", "\"schwab\"", "\"longbridge\"", "\"binance\"", "\"firstrade\"", "\"hk\"", "syn-acct"]) {
    ok("B2-A09", "no_account_literal", !source.includes(literal), literal);
  }
}

// --- B2-A10: physical siblings ------------------------------------------------
{
  const store = await baselineStore();
  const [platform, key] = ref(PAIR), [, siblingKey] = ref(SIBLING);
  await setManagement(store, PAIR, false);
  const viaSibling = await setManagement(store, SIBLING, true);
  same("B2-A10", "shared_axes_via_each_sibling", [store.resolve(platform, key).applied.revision, store.resolve(platform, siblingKey).applied.revision,
    store.resolve(platform, key).draft.revision, store.resolve(platform, siblingKey).draft.revision], [3, 3, 3, 3]);
  const event = store.rows("account_management_change").find(item => item.event_id === viaSibling.applied.event_id);
  same("B2-A10", "one_event_lists_both_siblings", JSON.parse(event.members_json).map(item => item.legacy_key), [key, siblingKey]);
  same("B2-A10", "event_visible_from_each_sibling", [key, siblingKey].map(legacy => store.rows("account_management_change")
    .filter(item => JSON.parse(item.members_json).some(member => member.legacy_key === legacy)).length), [3, 3]);
  store.close();
  // Corruptions of the stored sibling pair: no repair, missing-only is
  // unknown, contradictions conflict and outrank missing.
  const variants = {
    differing_values: [db => db.exec(`UPDATE account_management_applied SET management_enabled = 0 WHERE account_key = '${siblingKey}'`), "conflict"],
    differing_revisions: [db => db.exec(`UPDATE account_management_applied SET revision = 9 WHERE account_key = '${siblingKey}'`), "conflict"],
    one_missing_row: [db => db.exec(`DELETE FROM account_management_applied WHERE account_key = '${siblingKey}'`), "unknown"],
    missing_and_malformed: [db => { db.exec(`DELETE FROM account_management_applied WHERE account_key = '${siblingKey}'`); db.exec(`UPDATE account_management_applied SET management_enabled = 5 WHERE account_key = '${key}'`); }, "conflict"],
    differing_drafts: [db => db.exec(`UPDATE account_management_draft SET management_enabled = 0 WHERE account_key = '${siblingKey}'`), "draft"],
  };
  for (const [name, [corrupt, expected]] of Object.entries(variants)) {
    const corrupted = await baselineStore();
    corrupt(corrupted.db);
    const before = corrupted.dump();
    const resolution = corrupted.resolve(platform, key);
    if (expected === "draft") same("B2-A10", "draft_disagreement_detected", resolution.draft_state, "conflict", name);
    else same("B2-A10", `missing_${expected}`, [resolution.evidence_state, resolution.processing_eligible], [expected, false], name);
    for (const action of ["account_management_draft_save", "account_management_apply"]) {
      const response = await corrupted.call({ ...managementCommand(corrupted, action, platform, key), expected_management_revision: 1, expected_management_draft_revision: 1 });
      same("B2-A10", "management_state_conflict", [response.status, response.body.error], [409, "management_state_conflict"], `${name} ${action}`);
    }
    same("B2-A10", "rejected_without_repair", corrupted.dump(), before, name);
    corrupted.close();
  }
  // Retired or missing sibling, duplicate policy claims.
  const membership = {
    retired_sibling: async s => s.call({ action: "request_retirement", actor: "synthetic-admin", expected_revision: s.state().revision, platform, key: siblingKey }),
    missing_sibling: async s => s.db.prepare("UPDATE instance_state SET payload = ? WHERE id = 1").run(JSON.stringify(s.state().instances.filter(item => item.key !== siblingKey))),
    duplicate_policy_claim: async s => provision(s, policyOf([...FIXTURE_ACCOUNTS, ["eligible", [SIBLING]]], INSTANCES, POLICY_REVISION + 1), POLICY_REVISION),
  };
  for (const [name, change] of Object.entries(membership)) {
    const changed = await baselineStore();
    await change(changed);
    const resolution = changed.resolve(platform, key);
    same("B2-A10", "group_fails_closed", resolution.processing_eligible, false, name);
    const response = await changed.call(managementCommand(changed, "account_management_draft_save", platform, key, { management_enabled: false }));
    same("B2-A10", "management_membership_conflict", [response.status, response.body.error], [409, "management_membership_conflict"], name);
    changed.close();
  }
  // Reordered deployment lists and accounts: identical canonical content.
  const reordered = await baselineStore();
  const shuffled = policyOf([...FIXTURE_ACCOUNTS].reverse().map(([managementClass, deployments]) => [managementClass, [...deployments].reverse()]));
  const replay = await provision(reordered, shuffled, POLICY_REVISION);
  same("B2-A10", "order_independent", [replay.status, replay.body.replaced, statuses(reordered)], [200, false, { managed: 10, not_under_management: 1 }]);
  reordered.close();
}

// --- B2-A11: independence of runtime configuration ---------------------------
{
  const store = await baselineStore();
  const before = runtimeSnapshot(store);
  const risk = store.rows("risk_profile_authority");
  await setManagement(store, "firstrade/syn-acct-10", false);
  await setManagement(store, "longbridge/syn-acct-07", false);
  await setManagement(store, "longbridge/syn-acct-07", true);
  same("B2-A11", "runtime_lifecycle_strategy_risk_unchanged", [runtimeSnapshot(store), store.rows("risk_profile_authority")], [before, risk]);
  same("B2-A11", "paper_account_managed_in_paper_scope", [store.resolve("longbridge", "syn-acct-07").management_status, store.identity("longbridge", "syn-acct-07").broker_environment],
    ["managed", "paper"]);
  store.close();
}

// --- B2-A15: live revision stability -----------------------------------------
{
  const store = await baselineStore();
  const stale = managementCommand(store, "account_management_draft_save", "ibkr", "syn-acct-03", { management_enabled: false });
  const synced = await store.call({ action: "sync_defaults", actor: "synthetic-sync", inputs: { platform: "ibkr", target_name: "syn-target-02",
    account_selector: "SYN0000002", deployment_selector: "syn-deploy-02", account_scope: "SYN-SCOPE-03", service_name: "syn-service-02", strategy_profile: "syn-profile",
    option_overlay_mode: "enabled" } });
  same("B2-A15", "identity_preserving_revision_advance", [synced.status, synced.body.revision], [200, stale.expected_instance_revision + 1]);
  await store.call({ action: "create", actor: "synthetic-admin", expected_revision: store.state().revision, platform: "schwab",
    config: { key: "syn-acct-98", target_name: "syn-target-98", account_selector: "SYN0000098", deployment_selector: "syn-deploy-98", service_name: "syn-service-98", broker_environment: "live" } });
  same("B2-A15", "revision_only_change_keeps_live_gates", statuses(store), { managed: 10, not_under_management: 1 });
  const old = await store.call(stale);
  same("B2-A15", "old_cas_fails", old.body.error, "management_instance_revision_conflict");
  store.close();
  const closures = {
    identity_change: [async s => s.call({ action: "set_broker_environment", actor: "synthetic-admin", expected_revision: s.state().revision, platform: "longbridge", key: "syn-acct-06", broker_environment: "paper" }), ["longbridge/syn-acct-06"]],
    retire_sibling: [async s => s.call({ action: "request_retirement", actor: "synthetic-admin", expected_revision: s.state().revision, platform: "ibkr", key: "syn-acct-01-b" }), [PAIR, SIBLING]],
    stored_identity_conflict: [async s => s.db.prepare("INSERT INTO account_setting_draft (platform, account_key, revision, identity_json, overrides_json, updated_at) VALUES (?, ?, 1, ?, '{}', ?)")
      .run("ibkr", "syn-acct-03", JSON.stringify({ ...s.identity("ibkr", "syn-acct-03"), service_name: "syn-old" }), "2026-01-02T00:00:00.000Z"), ["ibkr/syn-acct-03"]],
    history_conflict: [async s => s.db.prepare("INSERT INTO instance_history (revision, entry) VALUES (?, ?)").run(1, JSON.stringify({ revision: 1, before: null,
      after: { ...s.instance("schwab", "syn-acct-05"), config: { ...s.instance("schwab", "syn-acct-05").config, target_name: "syn-old" } } })), ["schwab/syn-acct-05"]],
    cross_platform_collision: [async s => s.call({ action: "create", actor: "synthetic-admin", expected_revision: s.state().revision, platform: "schwab",
      config: { key: "syn-acct-03", target_name: "syn-target-97", account_selector: "SYN0000097", deployment_selector: "syn-deploy-97", service_name: "syn-service-97", broker_environment: "live" } }), ["ibkr/syn-acct-03"]],
  };
  for (const [name, [change, affected]] of Object.entries(closures)) {
    const changed = await baselineStore();
    await change(changed);
    for (const text of affected) same("B2-A15", "affected_group_closed", changed.resolve(...ref(text)).processing_eligible, false, `${name} ${text}`);
    same("B2-A15", "unaffected_group_open", changed.resolve("binance", "syn-acct-09").processing_eligible, true, name);
    changed.close();
  }
  // Missing schema or truncated local enumeration never certifies a subset.
  for (const [name, change] of Object.entries({
    missing_table: db => db.exec("DROP TABLE account_management_applied"),
    truncated_history: db => db.prepare("INSERT INTO instance_history (revision, entry) VALUES (2, ?)").run("{\"revision\":2,\"after\":"),
  })) {
    const changed = await baselineStore();
    change(changed.db);
    same("B2-A15", "uncertifiable_scope_blocked", INSTANCES.some(item => changed.resolve(item.platform, item.key).processing_eligible), false, name);
    changed.close();
  }
}

// --- B2-A16: policy lifecycle (synthetic) ------------------------------------
{
  const dir = await mkdtemp(join(tmpdir(), "qrt-management-store-"));
  const file = join(dir, "runtime.sqlite");
  const store = createStore({ file });
  const missing = store.resolve(...ref(PAIR));
  same("B2-A16", "missing_policy_unknown", [missing.management_status, missing.processing_eligible, missing.policy_revision, missing.reasons.includes("management_policy_unavailable")],
    ["unknown", false, null, true]);
  same("B2-A16", "display_retained", store.state().instances.length, INSTANCES.length);
  const unavailable = await store.call(managementCommand(store, "account_management_draft_save", ...ref(PAIR), { expected_policy_revision: 1 }));
  same("B2-A16", "management_policy_unavailable", unavailable.body.error, "management_policy_unavailable");
  const malformedInput = await provision(store, { ...policyOf(FIXTURE_ACCOUNTS), accounts: [] });
  same("B2-A16", "malformed_policy_rejected", [malformedInput.status, malformedInput.body.error], [400, "management_policy_invalid"]);
  const extra = await store.call({ action: "account_mapping_policy_replace", actor: "account-mapping-policy-provisioner", expected_policy_revision: 0, policy: policyOf(FIXTURE_ACCOUNTS), token: "x" });
  same("B2-A16", "extra_field_rejected", extra.body.error, "management_request_invalid");
  const userActor = await store.call({ action: "account_mapping_policy_replace", actor: "synthetic-admin", expected_policy_revision: 0, policy: policyOf(FIXTURE_ACCOUNTS) });
  same("B2-A16", "non_provisioner_rejected", userActor.body.error, "management_request_invalid");
  const absentNonZero = await provision(store, policyOf(FIXTURE_ACCOUNTS), 1);
  same("B2-A16", "absent_requires_zero", absentNonZero.body.error, "management_policy_revision_conflict");
  same("B2-A16", "first_provision", (await provision(store, policyOf(FIXTURE_ACCOUNTS))).body.replaced, true);
  same("B2-A16", "same_content_no_op", (await provision(store, policyOf(FIXTURE_ACCOUNTS), POLICY_REVISION)).body.replaced, false);
  const differing = await provision(store, policyOf(FIXTURE_ACCOUNTS.map(([, deployments]) => ["eligible", deployments])), POLICY_REVISION);
  same("B2-A16", "management_policy_content_conflict", differing.body.error, "management_policy_content_conflict");
  const lower = await provision(store, policyOf(FIXTURE_ACCOUNTS, INSTANCES, POLICY_REVISION - 1), POLICY_REVISION);
  same("B2-A16", "lower_revision_rejected", lower.body.error, "management_policy_revision_conflict");
  const wrongExpected = await provision(store, policyOf(FIXTURE_ACCOUNTS, INSTANCES, POLICY_REVISION + 1), POLICY_REVISION - 1);
  same("B2-A16", "expected_revision_required", wrongExpected.body.error, "management_policy_revision_conflict");
  // Two concurrent replacements from the same revision: one winner.
  const racers = await Promise.all([
    provision(store, policyOf(FIXTURE_ACCOUNTS, INSTANCES, POLICY_REVISION + 1), POLICY_REVISION),
    provision(store, policyOf(FIXTURE_ACCOUNTS.map(([, deployments]) => ["eligible", deployments]), INSTANCES, POLICY_REVISION + 1), POLICY_REVISION),
  ]);
  same("B2-A16", "one_concurrent_winner", racers.map(item => item.status).sort(), [200, 409]);
  store.close();
  // Restart: a new object over the same file keeps the revision.
  const restarted = createStore({ file, seed: false });
  same("B2-A16", "revision_survives_restart", restarted.resolve(...ref(PAIR)).policy_revision, POLICY_REVISION + 1);
  const regress = await provision(restarted, policyOf(FIXTURE_ACCOUNTS), POLICY_REVISION + 1);
  same("B2-A16", "restart_cannot_lower", regress.body.error, "management_policy_revision_conflict");
  // Forward-revision rollback carrying reviewed prior content.
  const rollback = await provision(restarted, policyOf(FIXTURE_ACCOUNTS, INSTANCES, POLICY_REVISION + 2), POLICY_REVISION + 1);
  same("B2-A16", "forward_revision_rollback", [rollback.status, rollback.body.policy_revision], [200, POLICY_REVISION + 2]);
  ok("B2-A16", "no_content_echo", !("policy" in rollback.body) && !JSON.stringify(rollback.body).includes("syn-"));
  // Malformed stored policy: unknown with the same non-authoritative fallback.
  restarted.db.exec("UPDATE account_mapping_policy SET policy_json = '{\"format\":1}' WHERE id = 1");
  const invalid = restarted.resolve(...ref(PAIR));
  same("B2-A16", "management_policy_invalid", [invalid.management_status, invalid.processing_eligible, invalid.reasons.includes("management_policy_invalid")], ["unknown", false, true]);
  restarted.close();
  await rm(dir, { recursive: true, force: true });
}

// --- B2-A20: initialization and binding --------------------------------------
{
  const store = createStore();
  await provision(store, policyOf(FIXTURE_ACCOUNTS));
  const [platform, key] = ref(PAIR), [, siblingKey] = ref(SIBLING);
  same("B2-A20", "uninitialized_unknown", store.resolve(platform, key).management_status, "unknown");
  const nonZero = await store.call(managementCommand(store, "account_management_draft_save", platform, key, { expected_management_revision: 1 }));
  same("B2-A20", "initialization_requires_zero", nonZero.body.error, "management_applied_revision_conflict");
  const init = await setManagement(store, PAIR, true);
  same("B2-A20", "initialized_once", [init.applied.management_revision, init.applied.previous_management_revision, init.applied.previous_management_enabled], [1, 0, null]);
  const [event] = store.rows("account_management_change");
  same("B2-A20", "old_value_journaled_null", [event.old_management_enabled, event.old_applied_revision, event.new_applied_revision], [null, 0, 1]);
  store.db.exec(`DELETE FROM account_management_applied WHERE account_key = '${siblingKey}'`);
  const partial = await store.call(managementCommand(store, "account_management_draft_save", platform, key, { expected_management_revision: 0 }));
  same("B2-A20", "partial_state_rejects", partial.body.error, "management_state_conflict");
  store.close();
  // Unrelated policy update keeps an unchanged group's applied state.
  const unrelated = await baselineStore();
  const classes = FIXTURE_ACCOUNTS.map(([managementClass, deployments]) => [deployments.includes("firstrade/syn-acct-10") ? "display_only" : managementClass, deployments]);
  await setManagement(unrelated, "firstrade/syn-acct-10", false);
  assert.equal((await provision(unrelated, policyOf(classes, INSTANCES, POLICY_REVISION + 1), POLICY_REVISION)).status, 200);
  same("B2-A20", "unchanged_group_preserved", [unrelated.resolve(platform, key).management_status, unrelated.resolve(platform, key).applied.revision], ["managed", 1]);
  same("B2-A20", "class_change_reclassifies", unrelated.resolve("firstrade", "syn-acct-10").management_status, "not_under_management");
  unrelated.close();
  // Changed membership, class or identity invalidates; nothing inherits.
  const rebinding = {
    membership: FIXTURE_ACCOUNTS.flatMap(([managementClass, deployments]) => deployments.length > 1 ? deployments.map(item => [managementClass, [item]]) : [[managementClass, deployments]]),
    class: FIXTURE_ACCOUNTS.map(([managementClass, deployments]) => [deployments.includes(PAIR) ? "display_only" : managementClass, deployments]),
  };
  for (const [name, accounts] of Object.entries(rebinding)) {
    const changed = await baselineStore();
    await provision(changed, policyOf(accounts, INSTANCES, POLICY_REVISION + 1), POLICY_REVISION);
    for (const deployment of [key, siblingKey]) {
      const resolution = changed.resolve(platform, deployment);
      same("B2-A20", "changed_binding_invalidates", [resolution.evidence_state, resolution.processing_eligible], ["conflict", false], `${name} ${deployment}`);
    }
    changed.close();
  }
  const identity = await baselineStore();
  const moved = INSTANCES.map(item => item.key === "syn-acct-02" ? { ...item, config: { ...item.config, service_name: "syn-moved" } } : item);
  await provision(identity, policyOf(FIXTURE_ACCOUNTS, moved, POLICY_REVISION + 1), POLICY_REVISION);
  same("B2-A20", "changed_identity_invalidates", identity.resolve("ibkr", "syn-acct-02").processing_eligible, false);
  identity.close();
  // Only the five effective fields reach the strict parser; extra stored
  // data is rejected, not trimmed.
  const source = await readFile(new URL("../web/strategy-switch-console/application/runtime_instances/account_management.js", import.meta.url), "utf8");
  ok("B2-A20", "five_field_effective_records", /records = applied\.rows\.map\(row => \(\{ platform: row\.platform, legacy_key: row\.account_key,\s*management_enabled: [^\n]+\n\s*revision: row\.revision, effective_at: row\.effective_at \}\)\)/.test(source));
}

// --- B2-A21: races the store decides -----------------------------------------
{
  const store = await baselineStore();
  const [platform, key] = ref(PAIR);
  const preflight = store.resolve(platform, key);
  ok("B2-A21", "preflight_admits", preflight.processing_eligible);
  await setManagement(store, PAIR, false);
  const before = store.dump();
  const draft = await store.call({ action: "account_settings_save", actor: "synthetic-admin", platform, key, identity: store.identity(platform, key),
    expected_draft_revision: 0, overrides: { option_overlay_enabled: true } });
  same("B2-A21", "disable_before_commit_denies", [draft.status, draft.body.error], [409, "management_disabled"]);
  same("B2-A21", "denial_before_write", store.dump(), before);
  store.close();
}

assert.equal(outbound.count, 0, "zero outbound calls");
const report = result.report();
console.log(report);
if (process.env.QRT_EVIDENCE_OUT) await (await import("node:fs/promises")).writeFile(process.env.QRT_EVIDENCE_OUT, `${report}\n`);
console.log("account management storage validation passed");
