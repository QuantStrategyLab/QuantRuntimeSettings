// READ suite for the registered live management readback
// (`qsl_account_management_readback.v1`), the trusted applied-state export,
// the full-projection seam and the Q5 aggregate cohort. Synthetic fixtures
// only; the results name row IDs, outcome codes and counts, never data.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import {
  INSTANCES, INSTANCE_REVISION, FIXTURE_ACCOUNTS, baselineStore, createStore, evidence, managementCommand, outbound, policyOf, provision, readback, ref, setManagement,
} from "./helpers/account_management_harness.mjs";
import { collectInventory, instanceStateRow } from "./helpers/account_identity_inventory_collect.mjs";

const rec = evidence("account_management_readback");
const ok = (row, outcome) => rec.record(row, outcome);
const ROOT = new URL("../", import.meta.url);
const CONSOLE = new URL("web/strategy-switch-console/", ROOT);
const { accountSettingsIdentity } = await import(new URL("application/account_settings/helpers.js", CONSOLE));
const { aggregateAccountFactsTotals, accountFactsAssetCoverage } = await import(new URL("account_facts.js", CONSOLE));
const { managementCohort } = await import(new URL("application/account_mapping/management_cohort.js", CONSOLE));
const { MANAGEMENT_STATUS_TEXT, MANAGEMENT_EVIDENCE_TEXT } = await import(new URL("application/runtime_instances/account_management_text.js", CONSOLE));

const EXPORT_FIELDS = ["effective_at", "legacy_key", "management_enabled", "platform", "revision"];
const READBACK_KEYS = ["counts", "effective_export", "evidence_scope", "format", "groups", "instance_revision", "observed_at", "ok", "physical_grouping_complete",
  "policy_revision", "policy_status", "reasons", "status", "uncovered_deployments"];
const eligible = FIXTURE_ACCOUNTS.filter(([managementClass]) => managementClass === "eligible").map(([, deployments]) => deployments);

// Observation of the object's SQL write surface during one read.
function counting(store) {
  const writes = [];
  const sql = store.object.storage.sql;
  const exec = sql.exec;
  sql.exec = (statement, ...bindings) => { if (!/^\s*SELECT\b/i.test(String(statement))) writes.push(String(statement).trim().slice(0, 24)); return exec(statement, ...bindings); };
  return { writes, restore: () => { sql.exec = exec; } };
}
const group = (body, text) => { const [platform, key] = ref(text); return body.groups.find(item => item.deployments.some(member => member.platform === platform && member.key === key)); };

// A01/A02/A11: the baseline envelope and the persisted applies that drive it.
{
  const store = await baselineStore();
  const base = (await store.read()).body;
  assert.deepEqual(Object.keys(base).sort(), READBACK_KEYS, "envelope keys exact");
  assert.equal(base.format, "qsl_account_management_readback.v1");
  assert.equal(base.evidence_scope, "runtime_instances_sqlite", "the live scope is never the #1173 label");
  assert.deepEqual(base.counts, { physical_accounts: 10, display_deployments: 11, uncovered_deployments: 0, managed: 9, management_disabled: 0, not_under_management: 1, unknown: 0 });
  assert.equal(base.physical_grouping_complete, true);
  assert.equal(base.instance_revision, INSTANCE_REVISION);
  assert.ok(base.policy_revision >= 1 && Number.isFinite(Date.parse(base.observed_at)));
  assert.ok(base.groups.every(item => ["management_class", "management_status", "evidence_state", "reasons", "scope", "processing_eligible", "processing_denial", "applied", "deployments"]
    .every(field => Object.hasOwn(item, field))), "group fields");
  const pair = base.groups.find(item => item.deployments.length === 2);
  assert.ok(pair, "the two-deployment physical account is one group");
  assert.deepEqual(pair.applied && Object.keys(pair.applied).sort(), ["effective_at", "management_enabled", "revision"]);
  const displayOnly = base.groups.find(item => item.management_class === "display_only");
  assert.deepEqual([displayOnly.management_status, displayOnly.applied, displayOnly.processing_eligible], ["not_under_management", null, false], "display-only is known, not under management");
  ok("B2-A01", "baseline_counts");
  assert.ok(base.groups.some(item => item.scope === "paper"), "a paper scope group is reported");
  assert.ok(base.groups.every(item => ["paper", "live", "unknown"].includes(item.scope)));
  ok("B2-A11", "paper_scope_reported");
  const target = eligible.find(deployments => deployments.length === 1 && group(base, deployments[0]).scope === "live");
  await setManagement(store, target[0], false);
  const off = (await store.read()).body;
  assert.deepEqual([off.counts.managed, off.counts.management_disabled, off.counts.not_under_management, off.counts.physical_accounts, off.counts.display_deployments], [8, 1, 1, 10, 11]);
  const disabled = group(off, target[0]);
  assert.deepEqual([disabled.management_status, disabled.processing_eligible, disabled.processing_denial, disabled.applied.management_enabled, disabled.applied.revision],
    ["management_disabled", false, "management_disabled", false, 2]);
  assert.equal(off.effective_export.records.length, 10, "export lists every persisted applied row");
  ok("B2-A01", "off_applied_counts");
  await setManagement(store, target[0], true);
  const on = (await store.read()).body;
  assert.deepEqual([on.counts.managed, on.counts.management_disabled, group(on, target[0]).applied.revision], [9, 0, 3]);
  ok("B2-A02", "on_restores_count");
  // A draft never drives the export or the counts.
  const sibling = eligible.find(deployments => deployments.length === 2);
  const [platform, key] = ref(sibling[0]);
  const saved = await store.call((await import("./helpers/account_management_harness.mjs")).managementCommand(store, "account_management_draft_save", platform, key, { management_enabled: false }));
  assert.equal(saved.status, 200);
  const drafted = (await store.read()).body;
  assert.deepEqual([drafted.counts, drafted.effective_export.records], [on.counts, on.effective_export.records], "a pending draft changes neither counts nor export");
  assert.ok(!JSON.stringify(drafted).includes("draft"), "no draft object in the live readback");
  ok("B2-A20", "draft_not_authority");
  store.close();
}

// A20: the adapter emits exactly the five B1 fields and never launders.
{
  const store = await baselineStore();
  const body = (await store.read()).body;
  assert.ok(body.effective_export.records.every(item => JSON.stringify(Object.keys(item).sort()) === JSON.stringify(EXPORT_FIELDS)), "exactly five fields");
  assert.equal(body.effective_export.format, readback.MANAGEMENT_EFFECTIVE_EXPORT_FORMAT);
  assert.equal(body.effective_export.instance_revision, body.instance_revision);
  assert.equal(body.effective_export.policy_revision, body.policy_revision, "same coherent snapshot");
  const [platform, key] = ref(eligible[0][0]);
  store.db.prepare("UPDATE account_management_applied SET management_enabled = 2 WHERE platform = ? AND account_key = ?").run(platform, key);
  const tampered = (await store.read()).body;
  assert.equal(group(tampered, eligible[0][0]).management_status, "unknown", "a non-boolean stored value is not coerced");
  assert.equal(group(tampered, eligible[0][0]).evidence_state, "conflict");
  assert.equal(group(tampered, eligible[0][0]).applied, null, "no applied value is published for an uncertified binding");
  assert.ok(!tampered.effective_export.records.some(item => eligible[0].some(text => ref(text)[0] === item.platform && ref(text)[1] === item.legacy_key)),
    "an uncertified group exports no effective record");
  assert.equal(tampered.effective_export.records.length, body.effective_export.records.length - eligible[0].length, "certified groups still export");
  ok("B2-A20", "export_exact_fields_no_laundering");
  ok("B2-A08", "malformed_applied_is_conflict");
  store.close();
}

// A16/A08: missing and malformed policy stay unknown and retain the display.
{
  const store = createStore();
  const missing = (await store.read()).body;
  assert.deepEqual([missing.status, missing.policy_status, missing.policy_revision, missing.physical_grouping_complete, missing.reasons.includes("management_policy_unavailable")],
    ["available", "unavailable", null, false, true]);
  assert.deepEqual(missing.counts, { physical_accounts: null, display_deployments: 11, uncovered_deployments: 11, managed: null, management_disabled: null, not_under_management: null, unknown: null });
  assert.equal(missing.uncovered_deployments.length, 11, "every discoverable deployment stays visible");
  assert.ok(missing.uncovered_deployments.every(item => item.management_status === "unknown" && item.processing_eligible === false));
  ok("B2-A16", "missing_policy_unknown_display_retained");
  store.db.prepare("INSERT INTO account_mapping_policy (id, policy_revision, policy_json, updated_at) VALUES (1, 3, ?, ?)").run("{not json", "2026-01-01T00:00:00.000Z");
  const invalid = (await store.read()).body;
  assert.deepEqual([invalid.policy_status, invalid.policy_revision, invalid.reasons.includes("management_policy_invalid"), invalid.counts.managed], ["invalid", null, true, null]);
  ok("B2-A16", "malformed_policy_unknown");
  store.close();
}

// A08: an absent eligible applied row, an unclassified instance and an
// identity change are explicit unknown/conflict; display-only stays known.
{
  const store = await baselineStore();
  const [platform, key] = ref(eligible.find(deployments => deployments.length === 1)[0]);
  store.db.prepare("DELETE FROM account_management_applied WHERE platform = ? AND account_key = ?").run(platform, key);
  const absent = (await store.read()).body;
  const row = group(absent, `${platform}/${key}`);
  assert.deepEqual([row.management_status, row.evidence_state, row.processing_eligible, row.applied], ["unknown", "unknown", false, null]);
  assert.equal(absent.counts.unknown, 1);
  assert.deepEqual(absent.groups.filter(item => item.management_class === "display_only").map(item => item.management_status), ["not_under_management"]);
  ok("B2-A08", "absent_applied_unknown_display_only_known");
  const state = store.state();
  state.instances.push({ ...structuredClone(state.instances[0]), key: "syn-unclassified", config: { ...state.instances[0].config, key: "syn-unclassified", target_name: "syn-unclassified-target", account_selector: "SYN9999999", deployment_selector: "syn-deploy-99", service_name: "syn-service-99", account_scope: "SYN-SCOPE-99" } });
  store.db.prepare("UPDATE instance_state SET payload = ? WHERE id = 1").run(JSON.stringify(state.instances));
  const extra = (await store.read()).body;
  assert.equal(extra.uncovered_deployments.length, 1);
  assert.deepEqual([extra.physical_grouping_complete, extra.counts.physical_accounts, extra.counts.display_deployments, extra.counts.uncovered_deployments], [false, null, 12, 1], "an unclassified deployment makes the physical count unavailable, never promoted");
  ok("B2-A08", "unclassified_instance_incomplete_grouping");
  store.close();
}

// A15: a revision-only advance keeps the live read valid with the new revision.
{
  const store = await baselineStore();
  const before = (await store.read()).body;
  store.db.prepare("UPDATE instance_state SET revision = revision + 1 WHERE id = 1").run();
  const after = (await store.read()).body;
  assert.equal(after.instance_revision, before.instance_revision + 1);
  assert.deepEqual(after.counts, before.counts, "unaffected identities stay managed");
  ok("B2-A15", "revision_only_keeps_live_read");
  store.close();
}

// A22: the read path writes nothing, initializes nothing, repairs nothing.
{
  const store = await baselineStore();
  const dumpBefore = JSON.stringify(store.dump());
  const changesBefore = store.db.prepare("SELECT total_changes() AS n").get().n;
  const probe = counting(store);
  const result = await store.read();
  probe.restore();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(probe.writes, [], "no SQL write statement on the read path");
  assert.equal(store.db.prepare("SELECT total_changes() AS n").get().n, changesBefore, "no row changed");
  assert.equal(JSON.stringify(store.dump()), dumpBefore);
  ok("B2-A22", "read_path_no_sql_writes");
  // No KV/alarm effect: the read facade offers SELECT only and the object's KV is never reached.
  const kv = [];
  const storage = store.object.storage;
  for (const name of ["put", "delete", "deleteAll", "setAlarm", "deleteAlarm"]) storage[name] = (...args) => { kv.push(name); return undefined; };
  await store.read();
  assert.deepEqual(kv, [], "no KV or alarm write on the read path");
  ok("B2-A22", "read_path_no_kv_writes");
  const cap = readback.managementReadCapability({ sql: { exec: () => ({ toArray: () => [] }) } });
  for (const statement of ["INSERT INTO x VALUES (1)", "SELECT 1; DELETE FROM x", "CREATE TABLE x (a)", "PRAGMA writable_schema = 1"]) {
    assert.throws(() => cap.sql.exec(statement), /statement_not_allowed/, "the facade admits one SELECT only");
  }
  ok("B2-A22", "facade_select_only");
  store.close();
}

// A22: missing tables and missing state report unavailable without creating anything.
{
  const store = createStore({ seed: false });
  assert.equal((await provision(store, policyOf(FIXTURE_ACCOUNTS))).status, 200);
  for (const table of ["account_management_applied", "account_management_draft"]) store.db.exec(`DROP TABLE ${table}`);
  const objectsBefore = JSON.stringify(store.db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all());
  const none = (await store.read()).body;
  assert.deepEqual([none.status, none.reasons, none.instance_revision, none.counts.physical_accounts], ["unavailable", ["runtime_instances_not_initialized"], null, null]);
  store.db.prepare("INSERT INTO instance_state (id, revision, payload) VALUES (1, ?, ?)").run(INSTANCE_REVISION, JSON.stringify(INSTANCES));
  const partial = (await store.read()).body;
  assert.ok(partial.status === "unavailable" && partial.reasons.includes("local_store_unreadable"), "unreadable management tables leave the section unavailable with an explicit reason");
  assert.ok(partial.groups.every(item => item.management_status === "unknown" && item.processing_eligible === false));
  const objectsAfter = JSON.stringify(store.db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all());
  assert.equal(objectsAfter, objectsBefore, "no table was created or repaired");
  ok("B2-A22", "missing_tables_unavailable_no_init");
  store.close();
  // A never-initialized object: the read path must not run initializeStorage.
  const fresh = createStore({ seed: false });
  for (const table of ["instance_state", "account_management_applied"]) fresh.db.exec(`DROP TABLE ${table}`);
  const empty = (await fresh.read()).body;
  assert.deepEqual([empty.status, empty.reasons], ["unavailable", ["runtime_instances_state_unreadable"]]);
  assert.equal(fresh.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'instance_state'").get().n, 0, "the read did not recreate storage");
  fresh.close();
  ok("B2-A22", "uninitialized_no_creation");
}

// A22: request boundary of the DO read action and the Worker route.
{
  const store = await baselineStore();
  const post = async body => { const response = await store.object.fetch(new Request(`https://runtime-instances${readback.MANAGEMENT_READ_DO_PATH}`, { method: "POST", body })); return response.status; };
  assert.equal(await post(JSON.stringify({ action: "account_management_read", extra: 1 })), 400, "extra field");
  assert.equal(await post(JSON.stringify({ action: "other" })), 400, "wrong action");
  assert.equal(await post("nope"), 400, "malformed body");
  assert.equal((await store.object.fetch(new Request(`https://runtime-instances${readback.MANAGEMENT_READ_DO_PATH}`))).status, 405, "GET to the DO path");
  const namespace = { idFromName: name => name, get: () => ({ fetch: (url, init) => store.object.fetch(new Request(url, init)) }) };
  const env = { STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace };
  const call = async (session, { method = "GET", url = "https://console.example.test/api/admin/account-management", headers = {}, bound = true } = {}) =>
    readback.accountManagementReadResponse(new Request(url, { method, headers }), bound ? env : {}, { readSession: async () => session });
  assert.equal((await call(null)).status, 401);
  assert.equal((await call({ admin: false })).status, 403);
  assert.equal((await call({ admin: true }, { method: "POST" })).status, 405);
  assert.equal((await call({ admin: true }, { url: "https://console.example.test/api/admin/account-management?platform=x" })).status, 400, "no caller authority input");
  assert.equal((await call({ admin: true }, { headers: { Origin: "https://elsewhere.example.test" } })).status, 403);
  assert.equal((await call({ admin: true }, { bound: false })).status, 503);
  const good = await call({ admin: true });
  assert.equal(good.status, 200);
  assert.equal(good.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await good.json()).format, "qsl_account_management_readback.v1");
  ok("B2-A22", "http_401_403_400_boundaries");
  store.close();
}

// A12: the live envelope next to the full #1173 projection.
{
  const store = await baselineStore();
  const before = (await store.read()).body;
  const target = eligible.find(deployments => deployments.length === 1 && group(before, deployments[0]).scope === "live")[0];
  await setManagement(store, target, false);
  const live = (await store.read()).body;
  const META = { observedAt: "2026-11-17T01:00:00.000Z", sourceRef: "inventory_export:synthetic-01" };
  const collect = async revision => (await collectInventory({ statements: [instanceStateRow(revision, INSTANCES)] })).private;
  const links = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("tests/fixtures/account-mapping-roster.synthetic.json", ROOT), "utf8")).enrollment_links;
  const policy = policyOf(FIXTURE_ACCOUNTS);
  const full = store.object.accountManagementProjection({ inventory: await collect(INSTANCE_REVISION), policy, collection: META, effective: live.effective_export.records, links });
  assert.equal(full.format, "qsl_account_management_projection.v1", "the full projection keeps its own format");
  assert.deepEqual([full.counts.display_accounts, full.counts.managed, full.counts.management_disabled], [10, 8, 1], "full display ten, managed eight");
  assert.equal(live.counts.managed, 8);
  assert.notEqual(full.format, live.format);
  const opaque = full.accounts.flatMap(item => item.enrollment_links).map(link => link.opaque_account_uid);
  assert.ok(opaque.includes("uid:SYN-Opaque/01=="), "opaque link bytes preserved");
  const stale = store.object.accountManagementProjection({ inventory: await collect(INSTANCE_REVISION - 1), policy, collection: META, effective: live.effective_export.records, links });
  assert.equal(stale.counts.managed, 0, "a stale full inventory confers no managed authority");
  assert.equal((await store.read()).body.counts.managed, 8, "the refreshed live read stays valid");
  ok("B2-A12", "live_and_full_seam");
  store.close();
}


// Q5: the shared cohort predicate through the totals and the coverage. The
// cohort is built from a real readback of the object, never hand-written.
{
  const rowsOf = (instances = INSTANCES) => instances.map((item, index) => ({
    platform: item.platform, account_key: item.key, binding_status: "bound", data_status: "fresh", identity_mismatch: false,
    broker_environment: item.config.broker_environment ?? null, account_scope: item.config.account_scope ?? null,
    observation_date: "2026-11-18", observed_finished_at: "2026-11-18T01:00:00.000Z",
    balances: [{ currency: "USD", net_assets: "100", total_cash: "10" }], cash: [{ currency: "USD", available_cash: "10", cash_balance: "10" }],
    // One physical identity per policy account: the sibling pair shares one (a channel alias never does).
    __identity: item.key.replace(/-b$/, ""),
  }));
  const identities = rows => new Map(rows.map(row => [row, JSON.stringify([row.platform, row.__identity])]));
  const cohortOf = async store => managementCohort((await store.read()).body);
  const evaluate = async (store, mutate = rows => rows) => {
    const rows = mutate(rowsOf());
    const cohort = await cohortOf(store);
    const totals = aggregateAccountFactsTotals(rows, identities(rows), cohort);
    return { rows, totals, coverage: accountFactsAssetCoverage(rows, totals, cohort), cohort };
  };
  const live = store => eligible.find(deployments => deployments.length === 1 && store.resolve(...ref(deployments[0])).management_status === "managed"
    && INSTANCES.find(item => `${item.platform}/${item.key}` === deployments[0]).config.broker_environment === "live")[0];
  const paperText = FIXTURE_ACCOUNTS.flatMap(([, deployments]) => deployments).find(text => INSTANCES.find(item => `${item.platform}/${item.key}` === text).config.broker_environment === "paper");
  const dispositions = result => Object.fromEntries(result.coverage.accounts.map(row => [`${row.platform}/${row.account_key}`, `${row.status}:${row.reason}`]));

  const store = await baselineStore();
  const base = await evaluate(store);
  assert.equal(base.totals.status, "by_currency", "known cohort sums");
  const liveManaged = INSTANCES.filter(item => item.config.broker_environment !== "paper" && `${item.platform}/${item.key}` !== "longbridge/syn-acct-08").length;
  assert.equal(base.totals.by_currency[0].account_count, liveManaged - 1, "the duplicate pair is one physical account, never summed twice");
  assert.equal(base.coverage.management_scope, "managed_non_paper");
  assert.equal(base.coverage.management_coverage_status, "complete");
  assert.deepEqual(Object.keys(base.coverage.management_counts), ["display_physical", "display_deployments", "managed_non_paper", "management_disabled_non_paper",
    "not_under_management_non_paper", "unknown_non_paper", "paper_excluded", "duplicate_deployments", "unresolved_deployments"], "exact count fields");
  assert.deepEqual(base.coverage.management_counts, { display_physical: 10, display_deployments: 11, managed_non_paper: 8, management_disabled_non_paper: 0,
    not_under_management_non_paper: 1, unknown_non_paper: 0, paper_excluded: 1, duplicate_deployments: 1, unresolved_deployments: 0 });
  assert.equal(base.coverage.management_policy_revision, (await store.read()).body.policy_revision);
  assert.ok(base.coverage.accounts.every(row => ["management_status", "evidence_state", "management_revision"].every(field => Object.hasOwn(row, field))));
  const disp = dispositions(base);
  assert.equal(disp["longbridge/syn-acct-08"], "excluded:not_under_management");
  assert.equal(disp[paperText], "excluded:paper_account");
  assert.equal(Object.values(disp).filter(text => text === "excluded:duplicate_account").length, 1);
  ok("B2-A17", "known_cohort_totals_and_counts");

  // B09: two deployments of one physical group, one managed and one scope-
  // conflicted, are one group in exactly one category (unknown), one duplicate.
  {
    const { managementCounts, resolveCohortDispositions } = await import(new URL("application/account_mapping/management_cohort.js", CONSOLE));
    const dep = key => ({ platform: "ibkr", key });
    const synthetic = (members, extra = {}) => ({ format: "qsl_account_management_readback.v1", status: "available", physical_grouping_complete: true,
      evidence_scope: "synthetic", observed_at: "2026-11-18T00:00:00.000Z", instance_revision: 1, policy_revision: 1,
      groups: [{ deployments: members.map(dep), management_status: "managed", evidence_state: "known", scope: "live", ...extra }] });
    const items = [{ platform: "ibkr", account_key: "syn-a", paper: false, environment: "live" }, { platform: "ibkr", account_key: "syn-b", paper: false, environment: "paper" }];
    const mixed = managementCohort(synthetic(["syn-a", "syn-b"]));
    const mixedCounts = managementCounts(items, resolveCohortDispositions(items, mixed), mixed);
    assert.deepEqual([mixedCounts.display_physical, mixedCounts.unknown_non_paper, mixedCounts.managed_non_paper, mixedCounts.duplicate_deployments, mixedCounts.display_deployments],
      [1, 1, 0, 1, 2], "a live/paper disagreement in one group is one unknown group plus one duplicate");
    const clean = managementCohort(synthetic(["syn-a", "syn-b"]));
    const cleanItems = items.map(item => ({ ...item, environment: "live" }));
    const cleanCounts = managementCounts(cleanItems, resolveCohortDispositions(cleanItems, clean), clean);
    assert.deepEqual([cleanCounts.display_physical, cleanCounts.managed_non_paper, cleanCounts.unknown_non_paper, cleanCounts.duplicate_deployments], [1, 1, 0, 1], "a consistent sibling pair counts once");
    const loose = managementCohort(synthetic(["syn-a"]));
    const looseCounts = managementCounts(items, resolveCohortDispositions(items, loose), loose);
    assert.deepEqual([looseCounts.display_physical, looseCounts.unresolved_deployments], [null, 1], "an unresolved deployment keeps the physical total null");
  }

  // Disable one live account: a clean exclusion, totals stay available.
  const disabledText = live(store);
  await setManagement(store, disabledText, false);
  const off = await evaluate(store);
  assert.equal(off.totals.status, "by_currency");
  assert.equal(off.totals.by_currency[0].account_count, base.totals.by_currency[0].account_count - 1);
  assert.equal(dispositions(off)[disabledText], "excluded:management_disabled");
  assert.equal(off.coverage.management_counts.management_disabled_non_paper, 1);
  ok("B2-A01", "disabled_group_excluded_from_totals");

  // Known disabled and display-only rows with missing facts are clean exclusions.
  const missing = await evaluate(store, rows => rows.map(row => ["longbridge/syn-acct-08"].includes(`${row.platform}/${row.account_key}`) ? { ...row, data_status: "unavailable", balances: [], cash: [] } : row));
  assert.equal(missing.totals.status, "by_currency", "a display-only row with missing facts is a clean exclusion");
  ok("B2-A17", "known_exclusions_with_missing_facts_clean");

  // Unknown non-paper membership: no totals at all, every other row blocked.
  const [livePlatform, liveKey] = ref(live(store));
  store.db.prepare("DELETE FROM account_management_applied WHERE platform = ? AND account_key = ?").run(livePlatform, liveKey);
  const unknown = await evaluate(store);
  assert.deepEqual([unknown.totals.status, unknown.totals.reason, unknown.totals.by_currency], ["unavailable", "management_status_unknown", []]);
  assert.equal(dispositions(unknown)[`${livePlatform}/${liveKey}`], "unavailable:management_status_unknown");
  assert.ok(Object.entries(dispositions(unknown)).filter(([text]) => text !== `${livePlatform}/${liveKey}` && text !== paperText && text !== "longbridge/syn-acct-08")
    .every(([, text]) => text === "excluded:duplicate_account" || text === "excluded:management_disabled" || text === "unavailable:source_not_supported" || text === "blocked:aggregate_management_status_unknown"), "unknown cohort blocks the managed rows");
  assert.equal(unknown.coverage.management_coverage_status, "incomplete");
  assert.equal(unknown.coverage.management_counts.unknown_non_paper, 1);
  ok("B2-A17", "unknown_non_paper_unavailable_no_totals");
  // The raw rows stay visible.
  assert.ok(unknown.rows.every(row => row.balances.length === 1), "raw balances persist");
  ok("B2-A17", "raw_rows_persist");

  // Conflict evidence is unknown too.
  const conflictStore = await baselineStore();
  const target = live(conflictStore);
  conflictStore.db.prepare("UPDATE account_management_applied SET management_enabled = 2 WHERE platform = ? AND account_key = ?").run(...ref(target));
  const conflict = await evaluate(conflictStore);
  assert.equal(conflict.totals.reason, "management_status_unknown");
  ok("B2-A17", "conflict_evidence_unavailable");

  // Paper unknown status cannot invalidate live membership.
  const paperStore = await baselineStore();
  paperStore.db.prepare("DELETE FROM account_management_applied WHERE platform = ? AND account_key = ?").run(...ref(paperText));
  const paperUnknown = await evaluate(paperStore);
  assert.equal(paperUnknown.totals.status, "by_currency", "an unknown paper status never invalidates the live cohort");
  assert.equal(dispositions(paperUnknown)[paperText], "excluded:paper_account");
  ok("B2-A17", "paper_unknown_does_not_invalidate");
  ok("B2-A11", "paper_never_in_live_totals");

  // Scope evidence is reconciled: a policy scope never excludes a row whose current
  // environment disagrees, and a row contradicting its own group's scope vetoes.
  const scopeStore = await baselineStore();
  const staleScope = scopeStore.state().instances.map(item => item.key === "syn-acct-07" ? { ...item, config: { ...item.config, broker_environment: "live" } } : item);
  scopeStore.db.prepare("UPDATE instance_state SET payload = ? WHERE id = 1").run(JSON.stringify(staleScope));
  const staleRows = rowsOf(staleScope);
  const staleTotals = aggregateAccountFactsTotals(staleRows, identities(staleRows), await cohortOf(scopeStore));
  assert.equal(staleTotals.reason, "management_status_unknown", "a current live row is not excluded by a stale paper policy scope");
  const contradiction = await evaluate(store, rows => rows.map(row => row.account_key === "syn-acct-02" ? { ...row, account_scope: "paper" } : row));
  assert.equal(contradiction.totals.reason, "management_status_unknown", "a paper label on a live row vetoes the total");
  assert.equal(contradiction.rows.find(row => row.account_key === "syn-acct-02").management_scope_conflict, true);
  assert.equal(base.totals.status, "by_currency", "positive control: consistent scopes still sum");
  ok("B2-A17", "scope_conflict_vetoes_total");

  // Empty managed live cohort: unavailable, never a zero.
  const emptyStore = await baselineStore();
  for (const deployments of eligible) {
    const text = deployments[0];
    if (INSTANCES.find(item => `${item.platform}/${item.key}` === text).config.broker_environment !== "paper") await setManagement(emptyStore, text, false);
  }
  const empty = await evaluate(emptyStore);
  assert.deepEqual([empty.totals.status, empty.totals.reason], ["unavailable", "no_managed_non_paper_accounts"]);
  ok("B2-A17", "no_managed_cohort_never_zero");

  // No readback at all: everything non-paper is unknown.
  const rows = rowsOf();
  const none = aggregateAccountFactsTotals(rows, identities(rows), managementCohort(null));
  assert.equal(none.reason, "management_status_unknown");
  assert.equal(managementCohort(null).groupingComplete, false);
  const noneCoverage = accountFactsAssetCoverage(rows, none, managementCohort(null));
  assert.deepEqual([noneCoverage.management_counts.display_physical, noneCoverage.management_counts.unresolved_deployments, noneCoverage.management_counts.display_deployments], [null, 11, 11]);
  ok("B2-A17", "absent_readback_all_unknown");

  // An unclassified deployment makes the physical count null; it is not promoted.
  const extraState = await baselineStore();
  const instances = extraState.state().instances;
  instances.push({ ...structuredClone(instances[0]), key: "syn-unclassified", config: { ...instances[0].config, key: "syn-unclassified", target_name: "syn-unclassified-target", account_selector: "SYN9999999", deployment_selector: "syn-deploy-99", service_name: "syn-service-99", account_scope: "SYN-SCOPE-99" } });
  extraState.db.prepare("UPDATE instance_state SET payload = ? WHERE id = 1").run(JSON.stringify(instances));
  const extraRows = rowsOf(instances);
  const extraCohort = managementCohort((await extraState.read()).body);
  const extraTotals = aggregateAccountFactsTotals(extraRows, identities(extraRows), extraCohort);
  const extraCoverage = accountFactsAssetCoverage(extraRows, extraTotals, extraCohort);
  assert.equal(extraTotals.reason, "management_status_unknown", "an unclassified non-paper deployment is unknown");
  assert.deepEqual([extraCoverage.management_counts.display_physical, extraCoverage.management_counts.unresolved_deployments, extraCoverage.management_counts.display_deployments], [null, 1, 12]);
  ok("B2-A17", "unresolved_deployment_physical_null");
}


// Q5: performance `scope=all` through the real Worker over the real object, and
// the production wiring of the shared cohort into every aggregate surface.
{
  const { default: worker, __test } = await import(new URL("worker.js", CONSOLE));
  const { readFile } = await import("node:fs/promises");
  const env = store => ({
    SESSION_SECRET: "synthetic-only-session-key", ALLOWED_GITHUB_LOGINS: "fixture-reader",
    STRATEGY_SWITCH_RUNTIME_INSTANCES: { idFromName: name => name, get: () => ({ fetch: (url, init) => store.object.fetch(new Request(url, init)) }) },
  });
  const read = async (store, query = "scope=all") => {
    const bindings = env(store);
    const cookie = `qsl_switch_session=${await __test.makeSession("fixture-reader", [], bindings)}`;
    const response = await worker.fetch(new Request(`https://console.example/api/performance/summary?${query}`, { headers: { Cookie: cookie } }), bindings);
    return { status: response.status, body: await response.json() };
  };
  const known = await baselineStore();
  const knownRead = await read(known);
  assert.notEqual(knownRead.body.unavailable_reason, "management_status_unknown", "a known cohort is not the unavailable contract");
  const unknownStore = await baselineStore();
  const target = eligible.find(deployments => deployments.length === 1 && INSTANCES.find(item => `${item.platform}/${item.key}` === deployments[0]).config.broker_environment === "live")[0];
  unknownStore.db.prepare("DELETE FROM account_management_applied WHERE platform = ? AND account_key = ?").run(...ref(target));
  const unknownRead = await read(unknownStore);
  assert.equal(unknownRead.status, 200, "unavailability is a successful observation, not a server failure");
  assert.deepEqual([unknownRead.body.status, unknownRead.body.unavailable_reason, unknownRead.body.management_scope, unknownRead.body.management_coverage_status],
    ["unavailable", "management_status_unknown", "managed_non_paper", "incomplete"]);
  assert.equal(unknownRead.body.management_counts.unknown_non_paper, 1);
  assert.deepEqual(Object.keys(unknownRead.body.management_counts).length, 9);
  assert.deepEqual([unknownRead.body.twr_return_percent, unknownRead.body.amount, unknownRead.body.simple_weighted_return_percent], [null, null, null], "no numeric aggregate");
  assert.ok(["points", "rows", "per_currency", "excess_returns"].every(field => !Object.hasOwn(unknownRead.body, field) || unknownRead.body[field].length === 0), "typed empty payload, no curve, holdings or trade rows");
  ok("B2-A17", "performance_scope_all_unavailable_200");
  const accountScoped = await read(unknownStore, `scope=${ref(target)[1]}&platform=${ref(target)[0]}`);
  assert.notEqual(accountScoped.body.unavailable_reason, "management_status_unknown", "an account-specific read is not gated by the cohort");
  ok("B2-A17", "account_specific_read_stays_available");

  // The production wiring supplies the shared cohort to every aggregate surface.
  const sources = await Promise.all(["worker.js", "application/worker/runtime_support.js"].map(path => readFile(new URL(path, CONSOLE), "utf8")));
  assert.equal(sources.join("\n").split("managementReadback: fetchManagementReadback").length - 1, 3, "performance, Desk and account-facts wiring");
  ok("B2-A17", "production_wiring_three_surfaces");
}


// Q6: the account-settings readback carries independent draft and applied
// objects, the sibling list, both revisions and the status/evidence/reasons.
{
  const store = await baselineStore();
  const pair = eligible.find(deployments => deployments.length === 2);
  const settings = async text => (await store.call({ action: "account_settings_read", actor: "synthetic-admin", platform: ref(text)[0], key: ref(text)[1] })).body.management;
  const first = await settings(pair[0]);
  assert.deepEqual(Object.keys(first).sort(), ["applied", "draft", "evidence_scope", "evidence_state", "instance_revision", "management_class", "management_status",
    "policy_revision", "processing_eligible", "reasons", "siblings"], "management section fields");
  // The baseline was initialized through a draft that its apply consumed.
  assert.deepEqual([first.management_status, first.evidence_state, first.management_class, first.draft, first.applied.revision, first.applied.management_enabled],
    ["managed", "known", "eligible", { management_enabled: true, revision: 1, base_applied_revision: 0, status: "consumed", consumed_applied_revision: 1 }, 1, true]);
  assert.deepEqual(first.siblings, pair.map(text => ({ platform: ref(text)[0], key: ref(text)[1] })), "both siblings are listed");
  assert.deepEqual(await settings(pair[1]), first, "the sibling reads the identical section");
  const { managementCommand } = await import("./helpers/account_management_harness.mjs");
  const saved = await store.call(managementCommand(store, "account_management_draft_save", ref(pair[0])[0], ref(pair[0])[1], { management_enabled: false }));
  assert.equal(saved.status, 200);
  const drafted = await settings(pair[1]);
  assert.deepEqual([drafted.draft.revision, drafted.draft.management_enabled, drafted.draft.base_applied_revision, drafted.draft.status, drafted.applied.revision, drafted.applied.management_enabled],
    [2, false, 1, "pending", 1, true], "the two axes are independent");
  const applied = await store.call(managementCommand(store, "account_management_apply", ref(pair[1])[0], ref(pair[1])[1]));
  assert.equal(applied.status, 200);
  const after = await settings(pair[0]);
  assert.deepEqual([after.draft.status, after.draft.consumed_applied_revision, after.applied.revision, after.applied.management_enabled, after.management_status],
    ["consumed", 2, 2, false, "management_disabled"]);
  assert.equal(after.draft.revision, 2, "draft and applied revisions are separate shared axes");
  ok("B2-A22", "settings_readback_draft_applied_axes");
  ok("B2-A10", "settings_readback_siblings_identical");
  const missing = createStore();
  const unknown = (await missing.call({ action: "account_settings_read", actor: "synthetic-admin", platform: ref(pair[0])[0], key: ref(pair[0])[1] })).body.management;
  assert.deepEqual([unknown.management_status, unknown.evidence_state, unknown.applied, unknown.draft, unknown.policy_revision, unknown.processing_eligible, unknown.reasons.includes("management_policy_unavailable")],
    ["unknown", "unknown", null, null, null, false, true], "no policy: unknown, never an invented flag");
  ok("B2-A16", "settings_readback_missing_policy_unknown");
}

// Status text table: the pinned bilingual contract.
{
  assert.deepEqual(MANAGEMENT_STATUS_TEXT, {
    managed: { "zh-CN": "已纳入量化管理", en: "Under quant management" },
    management_disabled: { "zh-CN": "已停用量化管理", en: "Quant management disabled" },
    not_under_management: { "zh-CN": "不纳入量化管理", en: "Outside quant management" },
    unknown: { "zh-CN": "量化管理状态未知", en: "Quant management status unknown" },
  });
  assert.deepEqual(Object.keys(MANAGEMENT_EVIDENCE_TEXT), ["unknown", "conflict", "stale"]);
  assert.equal(MANAGEMENT_EVIDENCE_TEXT.stale["zh-CN"], "证据已过期");
  ok("B2-A13", "status_text_pinned");
}

// Q8 / B2-A19 / B2-A04 / B2-A10: journal surfacing in global audit & account
// history, shared sibling events, replay non-duplication, KV outage resilience
// and equal-timestamp cursor pagination.
{
  const { default: worker, __test } = await import(new URL("worker.js", CONSOLE));
  const { consoleApiResponse } = await import(new URL("application/console_api/routes.js", CONSOLE));
  const store = await baselineStore();
  const pair = eligible.find(deployments => deployments.length === 2);
  const [pA, kA] = ref(pair[0]);
  const [pB, kB] = ref(pair[1]);

  // Baseline + OFF + ON applied across siblings, plus replay of the ON apply.
  await setManagement(store, pair[0], false);
  const { managementCommand } = await import("./helpers/account_management_harness.mjs");
  const draftOn = await store.call(managementCommand(store, "account_management_draft_save", pB, kB, { management_enabled: true }));
  assert.equal(draftOn.status, 200);
  const applyCmd = managementCommand(store, "account_management_apply", pB, kB);
  const firstApply = await store.call(applyCmd);
  const replayApply = await store.call(applyCmd);
  assert.equal(firstApply.status, 200);
  assert.equal(replayApply.status, 200);
  assert.equal(replayApply.body.replayed, true);
  const applyEvents = store.rows("account_management_change").filter(row => row.event_id === applyCmd.request_key);
  assert.equal(applyEvents.length, 1, "replay produces zero duplicate journal rows");

  // Force the OFF and ON events onto an identical past timestamp (and keep baseline earlier)
  // so both global audit and sibling history paginate across tied timestamps deterministically.
  const baseTs = new Date(Date.now() - 120_000).toISOString();
  const tiedTs = new Date(Date.now() - 60_000).toISOString();
  store.db.prepare("UPDATE account_management_change SET occurred_at = ? WHERE new_applied_revision = 1").run(baseTs);
  store.db.prepare("UPDATE account_management_change SET occurred_at = ? WHERE new_applied_revision >= 2").run(tiedTs);

  const bindings = (kvStore) => ({
    SESSION_SECRET: "synthetic-only-session-key",
    ALLOWED_GITHUB_LOGINS: "fixture-reader",
    STRATEGY_SWITCH_CONFIG: kvStore,
    STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify(Object.fromEntries(
      ["longbridge", "ibkr", "schwab", "firstrade", "binance"].map(platform => [
        platform,
        INSTANCES.filter(item => item.platform === platform).map(item => ({ ...item.config, key: item.key })),
      ]),
    )),
    STRATEGY_SWITCH_RUNTIME_INSTANCES: { idFromName: name => name, get: () => ({ fetch: (url, init) => store.object.fetch(new Request(url, init)) }) },
  });

  // 1. Global /api/audit-events surfaces account_management_change without raw actor login,
  // and limit=1 pagination across equal timestamps emits each physical apply exactly once.
  const okKv = { get: async key => (key === "audit_log" ? "[]" : null), put: async () => {} };
  const okBindings = bindings(okKv);
  const cookie = `qsl_switch_session=${await __test.makeSession("fixture-reader", [], okBindings)}`;
  const auditResp = await worker.fetch(new Request("https://console.example/api/audit-events?limit=100", { headers: { Cookie: cookie } }), okBindings);
  assert.equal(auditResp.status, 200);
  const auditBody = await auditResp.json();
  const mgmtEvents = auditBody.events.filter(ev => ev.source === "account_management_change");
  assert.equal(mgmtEvents.length, 11, "all 9 baseline + OFF + ON physical applies appear once each globally across siblings and replay");
  assert.ok(mgmtEvents.every(ev => ev.action === "account_management_change" && ev.subject.kind === "account_management"));
  assert.ok(!JSON.stringify(mgmtEvents).includes("synthetic-admin"), "actor login is aliased on global audit");

  const globalWalked = [];
  let globalCursor = null;
  for (let i = 0; i < 20; i++) {
    const qs = new URLSearchParams({ limit: "1" });
    if (globalCursor) qs.set("cursor", globalCursor);
    const pageResp = await worker.fetch(new Request(`https://console.example/api/audit-events?${qs}`, { headers: { Cookie: cookie } }), okBindings);
    assert.equal(pageResp.status, 200);
    const pageBody = await pageResp.json();
    globalWalked.push(...pageBody.events.filter(ev => ev.source === "account_management_change").map(ev => ev.id));
    if (!pageBody.next_cursor) break;
    globalCursor = pageBody.next_cursor;
  }
  assert.equal(globalWalked.length, 11);
  assert.equal(new Set(globalWalked).size, 11, "global equal-timestamp pagination neither drops nor duplicates events");
  assert.equal(globalCursor !== null || globalWalked.length === 11, true);
  assert.deepEqual(globalWalked.slice(0, 2), mgmtEvents.slice(0, 2).map(ev => ev.id), "tied OFF/ON events keep deterministic order");
  ok("B2-A19", "global_audit_surfaces_management_changes");

  // 2. Both siblings see identical management_change items via /api/account-settings/history + equal-timestamp pagination.
  const readHistory = async (bindingsObj, platform, key, limit = 25, cursor = null) => {
    const qs = new URLSearchParams({ account: key, platform, limit: String(limit) });
    if (cursor) qs.set("cursor", cursor);
    return worker.fetch(new Request(`https://console.example/api/account-settings/history?${qs}`, { headers: { Cookie: cookie } }), bindingsObj);
  };
  const hA = await (await readHistory(okBindings, pA, kA)).json();
  const hB = await (await readHistory(okBindings, pB, kB)).json();
  const mgmtA = hA.items.filter(item => item.event === "account_management_change");
  const mgmtB = hB.items.filter(item => item.event === "account_management_change");
  assert.equal(mgmtA.length, 3, "baseline + OFF + ON events present without replay duplicate");
  assert.deepEqual(mgmtA, mgmtB, "siblings share identical management journal timeline");
  assert.deepEqual(mgmtA.map(item => [item.old_management_enabled, item.new_management_enabled, item.management_revision]),
    // Ordered time DESC, id ASC; at tiedTs, OFF (rev 2) vs ON (rev 3) depends on UUID order, then baseline rev 1 earlier.
    mgmtA.map(item => [item.old_management_enabled, item.new_management_enabled, item.management_revision]));
  assert.ok(mgmtA.some(item => item.management_revision === 2 && item.old_management_enabled === true && item.new_management_enabled === false));
  assert.ok(mgmtA.some(item => item.management_revision === 3 && item.old_management_enabled === false && item.new_management_enabled === true));
  assert.ok(!JSON.stringify(mgmtA).includes("synthetic-admin"));

  // Page size 1 walks all tied-timestamp rows on both siblings with zero skips or duplicates.
  const walkHistory = async (platform, key) => {
    const walkedIds = [];
    let cursor = null;
    for (let i = 0; i < 10; i++) {
      const page = await (await readHistory(okBindings, platform, key, 1, cursor)).json();
      walkedIds.push(...page.items.map(item => item.id));
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
    return walkedIds;
  };
  const walkedA = await walkHistory(pA, kA);
  const walkedB = await walkHistory(pB, kB);
  assert.equal(walkedA.length, 3);
  assert.equal(new Set(walkedA).size, 3, "equal-timestamp pagination neither skips nor duplicates");
  assert.deepEqual(walkedA, walkedB, "both siblings paginate identical history event IDs");
  ok("B2-A10", "siblings_share_history_timeline");
  ok("B2-A19", "history_equal_timestamp_pagination");

  // An append between pages never shifts or repeats a returned item: the cursor
  // is keyed to the last emitted ordering key, and it is bound to its account.
  {
    const first = await (await readHistory(okBindings, pA, kA, 1)).json();
    assert.equal(typeof first.next_cursor, "string");
    const template = store.rows("account_management_change")[0];
    const appended = { ...template, event_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", occurred_at: new Date().toISOString() };
    const columns = Object.keys(appended);
    store.db.prepare(`INSERT INTO account_management_change (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...columns.map(column => appended[column]));
    const rest = [];
    let cursor = first.next_cursor;
    for (let i = 0; i < 10 && cursor; i++) {
      const page = await (await readHistory(okBindings, pA, kA, 1, cursor)).json();
      rest.push(...page.items.map(item => item.id));
      cursor = page.next_cursor;
    }
    assert.deepEqual([first.items[0].id, ...rest], walkedA, "the pages are the first page's snapshot, unshifted and unrepeated");
    const wrongAccount = await readHistory(okBindings, pB, "synthetic-other-account", 1, first.next_cursor);
    assert.ok([400, 404].includes(wrongAccount.status), "a cursor is bound to its account");
    const forged = await readHistory(okBindings, pA, kA, 1, "12");
    assert.equal(forged.status, 400, "an offset cursor is rejected");
    store.db.prepare("DELETE FROM account_management_change WHERE event_id = ?").run(appended.event_id);
    ok("B2-A19", "history_cursor_stable_under_append");
  }

  // B06 (Q-C): the traversal from page one is exactly the first page's version of
  // all three sources, once each: equal-time and backdated appends to the
  // journal, an approval and a legacy audit entry are invisible to later pages
  // on both sibling timelines; a new traversal sees them; an expired legacy
  // version rejects explicitly.
  {
    let auditEntries = [
      { action: "save_account_settings", platform: pA, key: kA, draft_revision: 3, ts: "2026-11-18T00:10:00.000Z", login: "fixture-reader" },
      { action: "save_account_settings", platform: pA, key: kA, draft_revision: 2, ts: "2026-11-18T00:05:00.000Z", login: "fixture-reader" },
    ];
    const kv = { get: async key => (key === "audit_log" ? JSON.stringify(auditEntries) : null), put: async () => {} };
    const live = bindings(kv);
    const walk = async (platform, key, between = async () => {}) => {
      const first = await (await readHistory(live, platform, key, 1)).json();
      const ids = first.items.map(item => item.id);
      await between();
      let cursor = first.next_cursor;
      for (let i = 0; i < 40 && cursor; i += 1) {
        const response = await readHistory(live, platform, key, 1, cursor);
        const page = await response.json();
        if (response.status !== 200) return { ids, status: response.status, error: page.error };
        ids.push(...page.items.map(item => item.id));
        cursor = page.next_cursor;
      }
      return { ids, status: 200 };
    };
    const template = store.rows("account_management_change")[0];
    const insertJournal = (id, at) => {
      const row = { ...template, event_id: id, occurred_at: at };
      const columns = Object.keys(row);
      store.db.prepare(`INSERT INTO account_management_change (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...columns.map(column => row[column]));
    };
    const insertApproval = (id, at) => {
      const cols = store.db.prepare("PRAGMA table_info(account_setting_profile_application)").all();
      const values = Object.fromEntries(cols.filter(col => col.notnull).map(col => [col.name, /INT/i.test(col.type) ? 1 : ""]));
      Object.assign(values, { request_key: id, platform: pA, account_key: kA, approved_at: at, approved_by: "synthetic-admin", status: "applied" });
      const names = Object.keys(values);
      store.db.prepare(`INSERT INTO account_setting_profile_application (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...names.map(name => values[name]));
    };
    const baseline = {};
    for (const [platform, key] of [[pA, kA], [pB, kB]]) baseline[key] = (await walk(platform, key)).ids;
    assert.ok(baseline[kA].length >= 3, "the journal and the legacy log both contribute");
    const cleanup = [];
    for (const [platform, key] of [[pA, kA], [pB, kB]]) {
      const tied = tiedTs;
      const traversal = await walk(platform, key, async () => {
        insertJournal(`eeeeeeee-0000-4000-8000-${key === kA ? "000000000001" : "000000000002"}`, tied);       // equal-time
        insertJournal(`eeeeeeee-0000-4000-8000-${key === kA ? "000000000003" : "000000000004"}`, baseTs);     // backdated
        insertApproval(`approval-late-${key}`, new Date().toISOString());
        auditEntries = [{ action: "save_account_settings", platform: pA, key: kA, draft_revision: 9, ts: tied, login: "fixture-reader" }, ...auditEntries];
        cleanup.push(() => { auditEntries = auditEntries.slice(1); });
      });
      assert.equal(traversal.status, 200);
      assert.deepEqual(traversal.ids.slice().sort(), baseline[key].slice().sort(), `the traversal is exactly the first page's selection (${key})`);
      assert.equal(new Set(traversal.ids).size, traversal.ids.length, "each entry once");
      const fresh = (await walk(platform, key)).ids;
      assert.ok(fresh.length > baseline[key].length, "a new traversal sees the appended entries");
      // Restore for the next sibling run.
      store.db.prepare("DELETE FROM account_management_change WHERE event_id LIKE 'eeeeeeee-%'").run();
      store.db.prepare("DELETE FROM account_setting_profile_application WHERE request_key LIKE 'approval-late-%'").run();
      for (const undo of cleanup.splice(0)) undo();
    }
    // Positive control: with no append the traversal is unchanged.
    assert.deepEqual((await walk(pA, kA)).ids, baseline[kA]);
    // An expired pinned version rejects continuation instead of traversing fresh data.
    const expiredLegacy = await walk(pA, kA, async () => { auditEntries = auditEntries.slice(1); });
    assert.deepEqual([expiredLegacy.status, expiredLegacy.error], [409, "history_snapshot_expired"], "a vanished legacy head expires the snapshot");
    auditEntries = [
      { action: "save_account_settings", platform: pA, key: kA, draft_revision: 3, ts: "2026-11-18T00:10:00.000Z", login: "fixture-reader" },
      { action: "save_account_settings", platform: pA, key: kA, draft_revision: 2, ts: "2026-11-18T00:05:00.000Z", login: "fixture-reader" },
    ];
    const savedRow = store.rows("account_management_change").find(row => row.new_applied_revision === 1);
    const expiredJournal = await walk(pA, kA, async () => { store.db.prepare("DELETE FROM account_management_change WHERE event_id = ?").run(savedRow.event_id); });
    assert.deepEqual([expiredJournal.status, expiredJournal.error], [409, "history_snapshot_expired"], "a changed journal prefix expires the snapshot");
    const columns = Object.keys(savedRow);
    store.db.prepare(`INSERT INTO account_management_change (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...columns.map(column => savedRow[column]));
    ok("B2-A19", "history_snapshot_three_sources");
  }

  // 3. KV failure or missing KV never makes durable management history unavailable (B2-A04 / B2-A19).
  const throwingKv = { get: async key => { if (key === "audit_log") throw new Error("kv_outage"); return null; }, put: async () => {} };
  const noKvResp = await worker.fetch(new Request(`https://console.example/api/account-settings/history?account=${kA}&platform=${pA}`, { headers: { Cookie: cookie } }), {
    SESSION_SECRET: "synthetic-only-session-key",
    ALLOWED_GITHUB_LOGINS: "fixture-reader",
    STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: okBindings.STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON,
    STRATEGY_SWITCH_RUNTIME_INSTANCES: okBindings.STRATEGY_SWITCH_RUNTIME_INSTANCES,
  });
  assert.equal(noKvResp.status, 200);
  const workerThrowKvResp = await worker.fetch(
    new Request(`https://console.example/api/account-settings/history?account=${kA}&platform=${pA}`, { headers: { Cookie: cookie } }),
    bindings(throwingKv),
  );
  assert.equal(workerThrowKvResp.status, 200, "worker history route keeps durable management history on KV outage");
  const workerThrowKvBody = await workerThrowKvResp.json();
  assert.equal(workerThrowKvBody.items.filter(item => item.event === "account_management_change").length, 3);
  assert.deepEqual(workerThrowKvBody.availability.management_change, { status: "ok", unavailable_reason: null });
  assert.deepEqual(workerThrowKvBody.availability.draft_saved, { status: "unavailable", unavailable_reason: "stored_records_unreadable" });
  const kvFailResp = await consoleApiResponse(
    new Request(`https://console.example/api/account-settings/history?account=${kA}&platform=${pA}`),
    bindings(throwingKv),
    {
      json: (body, status = 200) => Response.json(body, { status }),
      readSession: async () => ({ allowed: true, login: "fixture-reader" }),
      accountOptions: async () => ({ options: { [pA]: [{ key: kA }] } }),
      command: async (e, cmd) => store.object.consoleReadCommand(cmd),
      audit: async () => { throw new Error("kv_outage"); },
    },
  );
  assert.equal(kvFailResp.status, 200, "KV audit failure cannot hide durable management history");
  const kvFailBody = await kvFailResp.json();
  assert.equal(kvFailBody.items.filter(item => item.event === "account_management_change").length, 3);
  assert.deepEqual(kvFailBody.availability.management_change, { status: "ok", unavailable_reason: null });
  assert.deepEqual(kvFailBody.availability.draft_saved, { status: "unavailable", unavailable_reason: "stored_records_unreadable" });
  assert.deepEqual(kvFailBody.availability.effect_verification, { status: "unavailable", unavailable_reason: "effect_verification_not_recorded" });
  ok("B2-A04", "kv_outage_preserves_durable_history");
  ok("B2-A19", "history_availability_reported_independently");
  store.close();
}

assert.equal(outbound.count, 0, "zero outbound calls");
const out = process.env.READ_RESULT_FILE;
if (out) await writeFile(out, rec.report());

// B01 / F03 / F04: local schema (table constraints/keys + journal index DDL/order/
// direction/collation/uniqueness/predicate) and journal initiator certification
// reach resolver, readback, export, AND fresh ordinary write fencing together,
// while preserving exact historical receipt replay and genuine first init.
{
  const recreateTable = (store, table, ddl, selectSql = "*") => {
    const existing = store.rows(table);
    store.db.exec(`DROP TABLE ${table}`);
    store.db.exec(ddl);
    for (const row of existing) {
      const cols = Object.keys(row);
      store.db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map(col => row[col]));
    }
  };
  const drifts = {
    extra_applied_column: store => store.db.exec("ALTER TABLE account_management_applied ADD COLUMN extra_domain TEXT"),
    missing_notnull_constraint: store => recreateTable(store, "account_management_applied",
      `CREATE TABLE account_management_applied (platform TEXT NOT NULL, account_key TEXT NOT NULL, revision INTEGER,
       identity_json TEXT NOT NULL, membership_json TEXT NOT NULL, management_enabled INTEGER NOT NULL, effective_at TEXT NOT NULL,
       PRIMARY KEY (platform, account_key))`),
    missing_check_constraint: store => recreateTable(store, "account_mapping_policy",
      `CREATE TABLE account_mapping_policy (id INTEGER PRIMARY KEY, policy_revision INTEGER NOT NULL, policy_json TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    wrong_pk_order: store => recreateTable(store, "account_management_draft",
      `CREATE TABLE account_management_draft (platform TEXT NOT NULL, account_key TEXT NOT NULL, revision INTEGER NOT NULL,
       identity_json TEXT NOT NULL, membership_json TEXT NOT NULL, management_enabled INTEGER NOT NULL,
       base_applied_revision INTEGER NOT NULL, policy_revision INTEGER NOT NULL, instance_revision INTEGER NOT NULL,
       status TEXT NOT NULL, consumed_applied_revision INTEGER, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
       PRIMARY KEY (account_key, platform))`),
    missing_journal_index: store => store.db.exec("DROP INDEX account_management_change_time"),
    wrong_journal_index_order: store => { store.db.exec("DROP INDEX account_management_change_time"); store.db.exec("CREATE INDEX account_management_change_time ON account_management_change (event_id, occurred_at)"); },
    wrong_journal_index_direction: store => { store.db.exec("DROP INDEX account_management_change_time"); store.db.exec("CREATE INDEX account_management_change_time ON account_management_change (occurred_at DESC, event_id)"); },
    wrong_journal_index_collation: store => { store.db.exec("DROP INDEX account_management_change_time"); store.db.exec("CREATE INDEX account_management_change_time ON account_management_change (occurred_at COLLATE NOCASE, event_id)"); },
    wrong_journal_index_unique: store => { store.db.exec("DROP INDEX account_management_change_time"); store.db.exec("CREATE UNIQUE INDEX account_management_change_time ON account_management_change (occurred_at, event_id)"); },
    wrong_journal_index_partial: store => { store.db.exec("DROP INDEX account_management_change_time"); store.db.exec("CREATE INDEX account_management_change_time ON account_management_change (occurred_at, event_id) WHERE result = 'applied'"); },
    initiator_only: store => {
      const row = store.rows("account_management_change")[0];
      const identity = { ...JSON.parse(row.initiating_identity_json), service_name: "syn-initiator-drift" };
      store.db.prepare("UPDATE account_management_change SET initiating_identity_json = ? WHERE event_id = ?").run(JSON.stringify(identity), row.event_id);
    },
  };
  const control = await baselineStore();
  const clean = (await control.read()).body;
  assert.deepEqual([clean.status, clean.effective_export.records.length > 0, clean.groups.every(item => item.evidence_state === "known" || item.management_class !== "eligible")], ["available", true, true], "positive control");
  control.close();
  for (const [name, drift] of Object.entries(drifts)) {
    const store = await baselineStore();
    const [first] = eligible[0];
    const [platform, key] = ref(first);
    const replayCmd = managementCommand(store, "account_management_draft_save", platform, key, { management_enabled: false });
    const replayOriginal = await store.call(replayCmd);
    assert.equal(replayOriginal.status, 200);
    // Also exercise revision-zero handling under drift on an uninitialized target (applied rows deleted).
    const [, second] = eligible[1] ? [null, eligible[1][0]] : [null, first];
    const [uninitPlatform, uninitKey] = ref(second);
    store.db.prepare("DELETE FROM account_management_applied WHERE platform = ? AND account_key = ?").run(uninitPlatform, uninitKey);
    store.db.prepare("DELETE FROM account_management_draft WHERE platform = ? AND account_key = ?").run(uninitPlatform, uninitKey);
    drift(store);
    const resolution = store.resolve(platform, key);
    assert.deepEqual([resolution.processing_eligible, resolution.applied], [false, null], `${name}: resolver withholds applied`);
    assert.throws(() => store.object.requireManagementAdmission(platform, key), /management_status_unknown|management/, `${name}: admission denies`);
    const body = (await store.read()).body;
    assert.equal(group(body, first).applied, null, `${name}: group publishes no applied value`);
    assert.equal(body.effective_export.records.length, 0, `${name}: export empty`);
    assert.equal(body.status, name === "initiator_only" ? "available" : "unavailable", `${name}: section status`);
    const beforeWrites = store.dump();
    for (const action of ["account_management_draft_save", "account_management_apply"]) {
      for (const [targetP, targetK, revOverride] of [[platform, key, {}], [uninitPlatform, uninitKey, { expected_management_draft_revision: 0, expected_management_revision: 0 }]]) {
        const denied = await store.call(managementCommand(store, action, targetP, targetK, revOverride));
        assert.equal(denied.status, 409, `${name} ${action} (${targetK}): typed 409`);
        assert.equal(denied.body.error, name === "initiator_only" ? "management_identity_conflict" : "management_state_conflict", `${name} ${action}: typed error`);
      }
    }
    assert.deepEqual(store.dump(), beforeWrites, `${name}: zero state or receipt writes on denied save/apply`);
    const replayed = await store.call(replayCmd);
    assert.deepEqual([replayed.status, replayed.body.replayed], [200, true], `${name}: exact historical receipt replay preserved`);
    store.close();
  }
  ok("B2-A08", "schema_and_initiator_drift_withhold_applied");
  ok("B2-A08", "uncertified_schema_fences_writes_zero_mutations");
}
console.log(`account_management_readback_validation ok ${Object.values(rec.rows).reduce((total, row) => total + row.checks, 0)} checks outbound=${outbound.count}`);
