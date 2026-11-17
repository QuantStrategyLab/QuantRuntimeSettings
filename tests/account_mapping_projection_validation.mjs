// Runtime-instance mapping projection: the protected read projection over
// a seeded RuntimeInstances object, fed by a mapping authority derived from
// a real inventory collection. Covers the ten-account roster, generic
// status codes and evidence states, enrollment links as a compatibility
// edge checked against the legacy digest roster preparer, byte-identical
// legacy and opaque IDs, label exclusion and the no-account-branch rule.
// Synthetic identities only; no network.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { collectInventory, historyRow, instanceStateRow } from "./helpers/account_identity_inventory_collect.mjs";

const ROOT = new URL("../", import.meta.url);
const CONSOLE = new URL("web/strategy-switch-console/", ROOT);
const { RuntimeInstances } = await import(new URL("worker.js", CONSOLE));
const { deriveMappingAuthority } = await import(new URL("application/account_mapping/inventory_adapter.js", CONSOLE));
const { processingEligible } = await import(new URL("application/account_mapping/policy.js", CONSOLE));
const { accountSettingsIdentity } = await import(new URL("application/account_settings/helpers.js", CONSOLE));
const fixture = JSON.parse(await readFile(new URL("tests/fixtures/account-mapping-roster.synthetic.json", ROOT), "utf8"));

const META = { observedAt: "2026-11-17T01:00:00.000Z", sourceRef: "inventory_export:synthetic-01" };
const TS = "2026-01-01T00:00:00.000Z";
const settled = item => ({ ...item, kind: "existing", enabled: null, platform_applied: null, application_status: "unknown", retirement_status: "none", created_at: TS, updated_at: TS });
const INSTANCES = fixture.instances.map(settled);
const ref = text => { const at = text.indexOf("/"); return [text.slice(0, at), text.slice(at + 1)]; };
const policyFor = (instances = INSTANCES) => ({ ...fixture.policy, accounts: fixture.policy.accounts.map(account => ({ management_class: account.management_class,
  deployments: account.deployments.map(text => { const [platform, key] = ref(text);
    return { platform, legacy_key: key, identity: accountSettingsIdentity(instances.find(item => item.platform === platform && item.key === key)) }; }) })) });
const authorityOf = async (options = {}, instances = INSTANCES) => deriveMappingAuthority((await collectInventory({ statements: [instanceStateRow(fixture.instance_revision, instances), ...(options.extra || [])], ...options })).private, policyFor(instances), META);

// The real RuntimeInstances read path over a seeded SQLite file.
const dir = await mkdtemp(join(tmpdir(), "qrt-mapping-projection-"));
let files = 0;
const cursorOf = items => Object.assign(items.values(), { toArray: () => items, one: () => items[0] });
async function objectWith(revision, instances) {
  const db = new DatabaseSync(join(dir, `runtime-${files++}.sqlite`));
  const object = Object.create(RuntimeInstances.prototype);
  object.sqlStorage = { exec: (statement, ...bindings) => cursorOf(db.prepare(statement).all(...bindings)) };
  object.storageInitialized = false;
  object.initializeStorage();
  if (instances) db.prepare("INSERT INTO instance_state (id, revision, payload) VALUES (1, ?, ?)").run(revision, JSON.stringify(instances));
  return { object, close: () => db.close() };
}
async function project(input, { revision = fixture.instance_revision, instances = INSTANCES } = {}) {
  const { object, close } = await objectWith(revision, instances);
  try { return object.accountManagementProjection(input); } finally { close(); }
}

const eligibleKeys = policyFor().accounts.filter(account => account.management_class === "eligible").flatMap(account => account.deployments);
const displayKeys = policyFor().accounts.filter(account => account.management_class === "display_only").flatMap(account => account.deployments);
const record = (item, enabled = true, revision = 5) => ({ platform: item.platform, legacy_key: item.legacy_key, management_enabled: enabled, revision, effective_at: "2026-11-17T00:30:00.000Z" });
const ENABLED = eligibleKeys.map(item => record(item));
const rowOf = (projection, text) => projection.accounts.find(row => row.deployments.some(item => `${item.platform}/${item.legacy_key}` === text));
const ROW_KEYS = ["configuration_revision", "deployments", "enrollment_links", "evidence_state", "management_status", "observed_at", "source_ref"];

const complete = await authorityOf();
assert.equal(complete.authoritative, true);

// R1: the ten-account roster through the real projection path.
{
  const projection = await project({ authority: complete, effective: ENABLED, links: fixture.enrollment_links });
  assert.deepEqual(projection.counts, { display_accounts: 10, managed: 9, management_disabled: 0, not_under_management: 1, unknown: 0 }, "R1: ten displayed, nine managed");
  assert.ok(projection.accounts.every(row => row.evidence_state === "known"), "R1: every row known");
  assert.ok(projection.accounts.every(row => JSON.stringify(Object.keys(row).sort()) === JSON.stringify(ROW_KEYS)), "R1: rows expose only the projection fields");
  assert.deepEqual(rowOf(projection, "ibkr/syn-acct-01").deployments.map(item => item.legacy_key), ["syn-acct-01", "syn-acct-01-b"], "R1: the duplicate pair is one row");
  assert.deepEqual(rowOf(projection, "longbridge/syn-acct-08").management_status, "not_under_management", "R1: the display-only row");
  assert.deepEqual(rowOf(projection, "ibkr/syn-acct-02").configuration_revision, { instances: 41, mapping_policy: 3, management: 5 });
  assert.deepEqual([rowOf(projection, "ibkr/syn-acct-02").observed_at, rowOf(projection, "ibkr/syn-acct-02").source_ref], [META.observedAt, META.sourceRef]);
  assert.equal(projection.accounts.filter(processingEligible).length, 9, "R1: processing predicate follows the rows");
  assert.equal(processingEligible(rowOf(projection, "longbridge/syn-acct-08")), false);
  // Legacy keys and opaque link IDs byte-identical.
  assert.deepEqual(projection.accounts.flatMap(row => row.deployments.map(item => item.legacy_key)).sort(), INSTANCES.map(item => item.key).sort());
  assert.deepEqual(rowOf(projection, "ibkr/syn-acct-01").enrollment_links, fixture.enrollment_links.slice(0, 2).map(link => ({ platform_id: link.platform_id,
    candidate_slot: link.candidate_slot, opaque_account_uid: link.opaque_account_uid, target_id: link.target_id })), "R1: both links attach to the one account");
  assert.equal(rowOf(projection, "ibkr/syn-acct-01").enrollment_links[0].opaque_account_uid, "uid:SYN-Opaque/01==");
  assert.deepEqual(projection.rejected_links, []);
}

// R2-R4: applied state drives the code; missing state is unknown, never an
// invented disabled label; a display-only enable is a conflict.
{
  const missing = await project({ authority: complete });
  assert.deepEqual(missing.counts, { display_accounts: 10, managed: 0, management_disabled: 0, not_under_management: 1, unknown: 9 }, "R2: missing applied state");
  assert.ok(missing.accounts.filter(row => row.management_status === "unknown").every(row => row.evidence_state === "unknown"));
  const oneOff = await project({ authority: complete, effective: ENABLED.map(item => item.legacy_key === "syn-acct-05" ? { ...item, management_enabled: false } : item) });
  assert.deepEqual([oneOff.counts.managed, oneOff.counts.management_disabled, rowOf(oneOff, "schwab/syn-acct-05").management_status], [8, 1, "management_disabled"], "R3: an arbitrary eligible account off");
  const pairSplit = await project({ authority: complete, effective: ENABLED.map(item => item.legacy_key === "syn-acct-01-b" ? { ...item, management_enabled: false } : item) });
  assert.deepEqual([rowOf(pairSplit, "ibkr/syn-acct-01").evidence_state, rowOf(pairSplit, "ibkr/syn-acct-01").management_status], ["conflict", "unknown"], "R3: deployments disagree");
  const forced = await project({ authority: complete, effective: [...ENABLED, ...displayKeys.map(item => record(item))] });
  const row = rowOf(forced, "longbridge/syn-acct-08");
  assert.deepEqual([row.evidence_state, row.management_status, processingEligible(row)], ["conflict", "unknown", false], "R4: display-only is never managed");
  const relabeled = await project({ authority: complete, effective: ENABLED.map(item => item.legacy_key === "syn-acct-02" ? { ...item, management_class: "display_only" } : item) });
  assert.deepEqual([rowOf(relabeled, "ibkr/syn-acct-02").evidence_state, rowOf(relabeled, "ibkr/syn-acct-02").management_status], ["conflict", "unknown"], "R4: a management record cannot reclassify");
}

// R5-R6: stale authority and changed identities.
{
  const stale = await project({ authority: complete, effective: ENABLED }, { revision: 42 });
  assert.ok(stale.accounts.every(row => row.evidence_state === "stale" && row.management_status === "unknown"), "R5: a later instance revision makes the authority stale");
  assert.equal(stale.accounts[0].observed_at, META.observedAt, "R5: last-known observation time kept");
  const moved = INSTANCES.map(item => item.key === "syn-acct-04" ? { ...item, config: { ...item.config, account_selector: "SYN0000077" } } : item);
  const changed = await project({ authority: complete, effective: ENABLED }, { instances: moved });
  assert.deepEqual([rowOf(changed, "ibkr/syn-acct-04").evidence_state, rowOf(changed, "ibkr/syn-acct-04").management_status], ["conflict", "unknown"], "R6: changed physical identity");
  const added = [...INSTANCES, settled({ platform: "schwab", key: "syn-acct-11", config: { key: "syn-acct-11", target_name: "syn-target-11", account_selector: "syn-selector-11" } })];
  const uncovered = await project({ authority: complete, effective: ENABLED }, { instances: added });
  assert.deepEqual([uncovered.counts.display_accounts, rowOf(uncovered, "schwab/syn-acct-11").evidence_state], [11, "unknown"], "R6: an instance the authority does not cover is displayed as unknown");
  const uninitialized = await project({ authority: complete, effective: ENABLED }, { instances: null });
  assert.ok(uninitialized.accounts.every(entry => entry.management_status === "unknown"), "R6: no instance state, nothing known");
}

// R7-R8: partial and conflicting reader results never reach known.
{
  const partial = await project({ authority: await authorityOf({ kvPasses: 0, collectEnv: false }), effective: ENABLED });
  assert.deepEqual([partial.counts.display_accounts, partial.counts.unknown], [10, 10], "R7: provider-export groups: all displayed, all unknown");
  const episodes = await authorityOf({ extra: [historyRow(40, { action: "edit",
    before: { platform: "ibkr", key: "syn-acct-02", config: { key: "syn-acct-02", account_selector: "SYN0000099", target_name: "syn-target-02" } }, after: INSTANCES[2] })] });
  const conflicted = await project({ authority: episodes, effective: ENABLED });
  assert.deepEqual([rowOf(conflicted, "ibkr/syn-acct-02").evidence_state, rowOf(conflicted, "ibkr/syn-acct-02").management_status, conflicted.counts.managed], ["conflict", "unknown", 8], "R8: replayed conflict");
  const unusable = await project({ authority: { ...complete, format: "other" }, effective: ENABLED });
  assert.deepEqual([unusable.counts.display_accounts, unusable.counts.unknown], [11, 11], "R8: an unrecognized authority covers nothing");
}

// R9: enrollment links are a compatibility edge, never a second resolver.
{
  const [l1, l1b, l5, l10] = fixture.enrollment_links;
  const cases = [
    ["changed", { ...l5, config_identity: { ...l5.config_identity, account_selector: "syn-selector-05-old" } }, "link_identity_changed"],
    ["missing", { ...l10, account_key: "syn-acct-gone" }, "link_target_missing"],
    ["platform", { ...l10, platform_id: "schwab" }, "link_target_missing"],
    ["shape", { ...l10, config_identity: { account_selector: "syn-selector-10" } }, "link_shape_rejected"],
  ];
  for (const [label, link, reason] of cases) {
    const projection = await project({ authority: complete, effective: ENABLED, links: [link] });
    assert.deepEqual(projection.rejected_links.map(item => item.reason), [reason], `R9: ${label}`);
    assert.ok(projection.accounts.every(row => !row.enrollment_links.length), `R9: ${label} attaches nothing`);
    assert.equal(projection.counts.display_accounts, 10, `R9: ${label} creates no account`);
  }
  const twoUids = await project({ authority: complete, links: [l5, { ...l5, candidate_slot: "syn-slot-05-x", opaque_account_uid: "uid:syn-other" }] });
  assert.deepEqual(twoUids.rejected_links.map(item => item.reason), ["link_ambiguous", "link_ambiguous"], "R9: one deployment, two opaque IDs");
  const duplicated = await project({ authority: complete, links: [l10, l10] });
  assert.deepEqual(duplicated.rejected_links.map(item => item.reason), ["link_duplicated", "link_duplicated"], "R9: duplicated binding");
  const shared = await project({ authority: complete, links: [l1, { ...l1b, account_key: "syn-acct-02", config_identity: { ...l1b.config_identity, account_selector: "SYN0000002",
    deployment_selector: "syn-deploy-02", service_name: "syn-service-02" } }] });
  assert.deepEqual(shared.rejected_links.map(item => item.reason), ["link_ambiguous", "link_ambiguous"], "R9: one opaque ID across two physical accounts");
  const ignored = await project({ authority: complete, links: [{ ...l10, account_label: "Synthetic Link Label" }] });
  assert.deepEqual(rowOf(ignored, "firstrade/syn-acct-10").enrollment_links, [{ platform_id: "firstrade", candidate_slot: "syn-slot-10", opaque_account_uid: "uid:syn-opaque-10", target_id: "syn-run-10" }]);
}

// R10: labels are never keys and never emitted, whoever supplies them.
{
  const labeled = INSTANCES.map((item, index) => ({ ...item, label: `Synthetic Label ${index}`, config: { ...item.config, label: `Synthetic Config Label ${index}` } }));
  const injected = { ...complete, accounts: complete.accounts.map(account => ({ ...account, label: "INJECTED-LABEL", management_status: "managed" })) };
  const projection = await project({ authority: injected, effective: ENABLED, links: fixture.enrollment_links.map(link => ({ ...link, account_label: "INJECTED-LINK-LABEL" })) }, { instances: labeled });
  const text = JSON.stringify(projection);
  for (const needle of ["Synthetic Label", "Synthetic Config Label", "INJECTED"]) assert.ok(!text.includes(needle), `R10: ${needle} never emitted`);
  assert.equal(projection.counts.managed, 9, "R10: an injected status is not trusted");
}

// R11: the legacy digest roster preparer accepts the same links unchanged,
// and rejects a changed identity as the projection does. It validates IBKR
// selectors as broker IDs, so the non-IBKR links are replayed.
{
  const legacyLinks = fixture.enrollment_links.filter(link => link.platform_id !== "ibkr");
  const management = { initialized: true, instances: INSTANCES.map((item, index) => ({ ...item, config: { ...item.config, label: `Synthetic Label ${index}` } })) };
  const roster = legacyLinks.map(link => ({ platform_id: link.platform_id, candidate_slot: link.candidate_slot, opaque_account_uid: link.opaque_account_uid, target_id: link.target_id }));
  const legacy = links => spawnSync("python3", ["-I", "-c", `import json, sys; sys.path.insert(0, sys.argv[1]); from project_digest_display_roster import project_display_roster
try:
    print(json.dumps({"ok": project_display_roster(*json.loads(sys.stdin.read()))}))
except ValueError as error:
    print(json.dumps({"error": str(error)}))`, fileURLToPath(new URL("python/scripts", ROOT))], { input: JSON.stringify([roster, management, links]), encoding: "utf8" });
  const accepted = legacy(legacyLinks);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).ok.length, 2, "R11: legacy preparer accepts the links");
  const projection = await project({ authority: complete, links: legacyLinks });
  assert.deepEqual([projection.rejected_links.length, projection.accounts.filter(row => row.enrollment_links.length).length], [0, 2], "R11: the projection accepts the same links");
  const changed = legacyLinks.map(link => link.account_key === "syn-acct-05" ? { ...link, config_identity: { ...link.config_identity, service_name: "syn-service-old" } } : link);
  assert.deepEqual(JSON.parse(legacy(changed).stdout), { error: "digest_configured_account_identity_changed" }, "R11: legacy rejects the changed identity");
  assert.deepEqual((await project({ authority: complete, links: changed })).rejected_links.map(item => item.reason), ["link_identity_changed"], "R11: so does the projection");
}

// R12: no account-specific branch in the policy, adapter or projection
// code. Platform literals appear only in synthetic fixtures and tests.
{
  const paths = ["application/account_mapping/policy.js", "application/account_mapping/inventory_adapter.js", "application/runtime_instances/mapping_projection.js"];
  for (const path of paths) {
    const source = await readFile(new URL(path, CONSOLE), "utf8");
    for (const pattern of [/longbridge/i, /\bhk\b/i, /\bsg\b/i, /ibkr/i, /schwab/i, /binance/i, /firstrade/i, /syn-acct/i]) {
      assert.ok(!pattern.test(source), `R12: ${path} has no ${pattern} literal`);
    }
  }
}

await rm(dir, { recursive: true, force: true });
console.log("account mapping projection validation passed");
