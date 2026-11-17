// Runtime-instance mapping projection: the protected read projection over
// a seeded RuntimeInstances object. The projection derives the mapping
// authority itself from a real inventory collection, a policy document and
// the collection metadata; caller-supplied summaries confer nothing. Covers
// the ten-account roster, generic status codes and evidence states, applied
// management records, enrollment links as a compatibility edge checked
// against the legacy digest consumers, byte-identical legacy and opaque IDs,
// label exclusion and the no-account-branch rule. Rows A01-A16 are the
// adjudicated acceptance rows. Synthetic identities only; no network.
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
const deploymentOf = (instances, text) => { const [platform, key] = ref(text);
  return { platform, legacy_key: key, identity: accountSettingsIdentity(instances.find(item => item.platform === platform && item.key === key)) }; };
// A policy document over `accounts` ([class, [platform/key, ...]]), each
// deployment bound to its settings identity in `instances`.
const policyOf = (accounts, instances = INSTANCES, revision = fixture.policy.policy_revision) => ({ format: fixture.policy.format, policy_revision: revision,
  accounts: accounts.map(([managementClass, deployments]) => ({ management_class: managementClass, deployments: deployments.map(text => deploymentOf(instances, text)) })) });
const FIXTURE_ACCOUNTS = fixture.policy.accounts.map(account => [account.management_class, account.deployments]);
const policyFor = (instances = INSTANCES, classes = {}) => policyOf(FIXTURE_ACCOUNTS.map(([managementClass, deployments], index) => [classes[index] ?? managementClass, deployments]), instances);
const collect = async (instances = INSTANCES, options = {}) => (await collectInventory({ statements: [instanceStateRow(fixture.instance_revision, instances), ...(options.extra || [])], ...options })).private;
const inputOf = (inventory, policy = policyFor(), collection = META) => ({ inventory, policy, collection });

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
const recordAt = (text, enabled, revision) => { const [platform, key] = ref(text); return record({ platform, legacy_key: key }, enabled, revision); };
const ENABLED = eligibleKeys.map(item => record(item));
const rowOf = (projection, text) => projection.accounts.find(row => row.deployments.some(item => `${item.platform}/${item.legacy_key}` === text));
const rowsOf = (projection, text) => projection.accounts.filter(row => row.deployments.some(item => `${item.platform}/${item.legacy_key}` === text));
const stateOf = (projection, text) => [rowOf(projection, text).evidence_state, rowOf(projection, text).management_status];
const ROW_KEYS = ["configuration_revision", "deployments", "enrollment_links", "evidence_state", "management_status", "observed_at", "source_ref"];
const noneKnown = (projection, label) => {
  assert.equal(projection.counts.managed, 0, `${label}: zero managed`);
  assert.ok(projection.accounts.every(row => row.evidence_state !== "known"), `${label}: no row known`);
};
const unclassifiedOnly = (projection, label) => {
  assert.deepEqual(projection.counts, { display_accounts: INSTANCES.length, managed: 0, management_disabled: 0, not_under_management: 0, unknown: INSTANCES.length }, `${label}: current instances only, all unknown`);
  assert.ok(projection.accounts.every(row => row.evidence_state === "unknown" && row.deployments.length === 1 && row.configuration_revision.mapping_policy === null
    && row.observed_at === null && row.source_ref === null), `${label}: unclassified rows`);
  assert.deepEqual(projection.accounts.map(row => `${row.deployments[0].platform}/${row.deployments[0].legacy_key}`).sort(),
    INSTANCES.map(item => `${item.platform}/${item.key}`).sort(), `${label}: one row per current instance, no extra summary row`);
};

const COMPLETE = await collect();
const complete = inputOf(COMPLETE);
// Test-only: the authority summary the old call shape accepted.
const LEGACY = deriveMappingAuthority(COMPLETE, policyFor(), META);
assert.equal(LEGACY.authoritative, true);

// A01 authoritative-ten-account-control: the real reader through the
// revised Durable Object projection.
{
  const projection = await project({ ...complete, effective: ENABLED, links: fixture.enrollment_links });
  assert.deepEqual(projection.counts, { display_accounts: 10, managed: 9, management_disabled: 0, not_under_management: 1, unknown: 0 }, "A01: ten displayed, nine managed");
  assert.ok(projection.accounts.every(row => row.evidence_state === "known"), "A01: every row known");
  assert.ok(projection.accounts.every(row => JSON.stringify(Object.keys(row).sort()) === JSON.stringify(ROW_KEYS)), "A01: rows expose only the projection fields");
  assert.deepEqual(rowOf(projection, "ibkr/syn-acct-01").deployments.map(item => item.legacy_key), ["syn-acct-01", "syn-acct-01-b"], "A01: the duplicate pair is one row");
  assert.equal(rowOf(projection, "longbridge/syn-acct-08").management_status, "not_under_management", "A01: the display-only row");
  assert.deepEqual(rowOf(projection, "ibkr/syn-acct-02").configuration_revision, { instances: 41, mapping_policy: 3, management: 5 });
  assert.deepEqual([rowOf(projection, "ibkr/syn-acct-02").observed_at, rowOf(projection, "ibkr/syn-acct-02").source_ref], [META.observedAt, META.sourceRef]);
  assert.equal(projection.accounts.filter(processingEligible).length, 9, "A01: processing predicate follows the rows");
  assert.equal(processingEligible(rowOf(projection, "longbridge/syn-acct-08")), false);
  // Legacy keys and opaque link IDs byte-identical.
  assert.deepEqual(projection.accounts.flatMap(row => row.deployments.map(item => item.legacy_key)).sort(), INSTANCES.map(item => item.key).sort());
  assert.deepEqual(rowOf(projection, "ibkr/syn-acct-01").enrollment_links, fixture.enrollment_links.slice(0, 2).map(link => ({ platform_id: link.platform_id,
    candidate_slot: link.candidate_slot, opaque_account_uid: link.opaque_account_uid, target_id: link.target_id })), "A01: both links attach to the one account");
  assert.equal(rowOf(projection, "ibkr/syn-acct-01").enrollment_links[0].opaque_account_uid, "uid:SYN-Opaque/01==");
  assert.deepEqual(projection.rejected_links, []);
  const oneOff = await project({ ...complete, effective: ENABLED.map(item => item.legacy_key === "syn-acct-05" ? { ...item, management_enabled: false } : item) });
  assert.deepEqual([oneOff.counts.managed, oneOff.counts.management_disabled, oneOff.counts.not_under_management, stateOf(oneOff, "schwab/syn-acct-05")],
    [8, 1, 1, ["known", "management_disabled"]], "A01: one eligible account off");
}

// A02 legacy-authority-only-rejected: the seven reproduced constructions
// through the old authority-only call shape, and malformed invocations.
{
  const incomplete = deriveMappingAuthority(await collect(INSTANCES, { kvPasses: 0, collectEnv: false }), policyFor(), META);
  const constructions = {
    "authority-false": { ...LEGACY, authoritative: false, reasons: ["synthetic"] },
    "resolved-missing": { ...LEGACY, deployments: [] },
    "resolved-unknown": { ...LEGACY, deployments: LEGACY.deployments.map(item => ({ ...item, evidence_state: "unknown", reasons: ["synthetic"] })) },
    "policy-error": { ...LEGACY, policy_error: "invalid_management_class" },
    "duplicate-summary": { ...LEGACY, accounts: [...LEGACY.accounts, ...LEGACY.accounts] },
    "class-summary": { ...LEGACY, accounts: LEGACY.accounts.map(account => ({ ...account, management_class: "eligible" })) },
    "incomplete-summary": { ...incomplete, authoritative: true, reasons: [], accounts: incomplete.accounts.map(account => ({ ...account, evidence_state: "known", reasons: [] })) },
  };
  const everything = [...ENABLED, ...displayKeys.map(item => record(item))];
  for (const [label, authority] of Object.entries(constructions)) {
    unclassifiedOnly(await project({ authority, effective: everything, links: fixture.enrollment_links }), `A02: ${label}`);
  }
  const malformed = {
    "no-input": undefined, "empty": {}, "inventory-only": { inventory: COMPLETE }, "no-collection": { inventory: COMPLETE, policy: policyFor() },
    "bad-collection": inputOf(COMPLETE, policyFor(), { ...META, observedAt: "yesterday" }), "inventory-string": inputOf("COMPLETE"),
    "null-entry": inputOf({ ...COMPLETE, mapping: { ...COMPLETE.mapping, entries: [null] } }), "policy-string": inputOf(COMPLETE, "policy"),
  };
  for (const [label, input] of Object.entries(malformed)) {
    const projection = await project(input === undefined ? undefined : { ...input, effective: everything });
    assert.equal(projection.counts.managed, 0, `A02: ${label} zero managed`);
    assert.ok(projection.accounts.every(row => row.evidence_state === "unknown" && row.deployments.length === 1), `A02: ${label} unclassified unknown`);
    assert.equal(projection.counts.display_accounts, INSTANCES.length, `A02: ${label} current instances`);
  }
}

// A03 summary-cannot-override-policy: one display-only account; the old
// authority, class and status fields alongside the revised intake confer
// nothing.
const SINGLE_INSTANCES = INSTANCES.filter(item => item.key === "syn-acct-08");
const SINGLE = await collect(SINGLE_INSTANCES);
{
  const policy = policyOf([["display_only", ["longbridge/syn-acct-08"]]], SINGLE_INSTANCES);
  const forged = { ...deriveMappingAuthority(SINGLE, policyOf([["eligible", ["longbridge/syn-acct-08"]]], SINGLE_INSTANCES), META) };
  const extra = { authority: forged, accounts: forged.accounts, management_class: "eligible", management_status: "managed", evidence_state: "known", authoritative: true };
  const enabled = await project({ ...extra, ...inputOf(SINGLE, policy), effective: [recordAt("longbridge/syn-acct-08", true, 2)] }, { instances: SINGLE_INSTANCES });
  assert.deepEqual([stateOf(enabled, "longbridge/syn-acct-08"), enabled.counts.managed], [["conflict", "unknown"], 0], "A03: enabling record on display-only is a conflict");
  assert.equal(processingEligible(rowOf(enabled, "longbridge/syn-acct-08")), false);
  const plain = await project({ ...extra, ...inputOf(SINGLE, policy) }, { instances: SINGLE_INSTANCES });
  assert.deepEqual([stateOf(plain, "longbridge/syn-acct-08"), plain.counts.managed], [["known", "not_under_management"], 0], "A03: without enabling state, not under management");
}

// A04 incomplete-reader-exclusion: partial collections reach no known row,
// whatever summary fields ride along. Group 23 stays external evidence in
// the complete control.
{
  let node = { platform: "ibkr", account_key: "syn-deep" };
  for (let level = 9; level >= 1; level--) node = { [`l${level}`]: node };
  const long = INSTANCES.map(item => item.key === "syn-acct-02" ? { ...item, config: { ...item.config, account_selector: "S".repeat(600) } } : item);
  const partials = [
    ["provider-export-required", await collect(INSTANCES, { kvPasses: 0, collectEnv: false }), INSTANCES],
    ["one-kv-pass", await collect(INSTANCES, { kvPasses: 1 }), INSTANCES],
    ["missing-env", await collect(INSTANCES, { collectEnv: false }), INSTANCES],
    ["depth-truncated-kv", await collect(INSTANCES, { kv: { account_facts_bindings: JSON.stringify(node) } }), INSTANCES],
    ["truncated-identity", await collect(long), long],
  ];
  for (const [label, inventory, instances] of partials) {
    assert.equal(inventory.status, "incomplete", `A04: ${label} reader status`);
    const projection = await project({ authority: LEGACY, accounts: LEGACY.accounts, ...inputOf(inventory), effective: ENABLED }, { instances });
    noneKnown(projection, `A04: ${label}`);
    assert.equal(projection.counts.display_accounts, 10, `A04: ${label} every account displayed`);
  }
  assert.equal(COMPLETE.groups["23"], "external_evidence_required", "A04: group 23 is external evidence in the complete control");
  assert.equal(COMPLETE.status, "retained_state_enumerated_external_evidence_required");
}

// A05 policy-validation-and-ownership: an invalid or malformed policy
// classifies nothing; a deployment two accounts claim has no winner; class
// changes act only through fresh derivation from the policy document.
{
  for (const [label, policy] of [["invalid-class", { ...policyFor(), accounts: [{ management_class: "managed", deployments: policyFor().accounts[1].deployments }] }],
    ["malformed", { ...policyFor(), format: "other" }], ["extra-field", { ...policyFor(), management_status: "managed" }]]) {
    const projection = await project({ ...inputOf(COMPLETE, policy), effective: ENABLED });
    noneKnown(projection, `A05: ${label}`);
    assert.ok(projection.accounts.every(row => row.configuration_revision.mapping_policy === null), `A05: ${label} carries no policy revision`);
  }
  const twice = await project({ ...inputOf(COMPLETE, policyOf([...FIXTURE_ACCOUNTS, ["display_only", ["ibkr/syn-acct-02"]]])), effective: ENABLED });
  assert.deepEqual(rowsOf(twice, "ibkr/syn-acct-02").map(row => [row.evidence_state, row.management_status]), [["conflict", "unknown"], ["conflict", "unknown"]], "A05: claimed twice, both conflict");
  assert.equal(twice.counts.managed, 8, "A05: zero managed for the double claim");
  const reclassified = await project({ ...inputOf(COMPLETE, policyFor(INSTANCES, { 1: "display_only" })), effective: ENABLED.filter(item => item.legacy_key !== "syn-acct-02") });
  assert.deepEqual([reclassified.counts.managed, reclassified.counts.not_under_management, stateOf(reclassified, "ibkr/syn-acct-02")], [8, 2, ["known", "not_under_management"]], "A05: fresh derivation follows the policy");
  const summaryOnly = await project({ ...complete, authority: deriveMappingAuthority(COMPLETE, policyFor(INSTANCES, { 1: "display_only" }), META), effective: ENABLED });
  assert.equal(summaryOnly.counts.managed, 9, "A05: a reclassified summary alone changes nothing");
}

// A06 resolution-required: every claimed deployment needs exactly one known
// resolved reader entry. Reader results are edited only here, in the test.
{
  const without = structuredClone(COMPLETE);
  without.mapping.entries = without.mapping.entries.filter(entry => entry.legacy_key !== "syn-acct-04");
  const missing = await project({ ...inputOf(without), effective: ENABLED });
  noneKnown(missing, "A06: missing resolved entry");
  assert.deepEqual(stateOf(missing, "ibkr/syn-acct-04"), ["unknown", "unknown"]);
  const unparseable = structuredClone(COMPLETE);
  // Episodes share one locator object; give the edited one its own.
  const episode = unparseable.mapping.entries.find(entry => entry.legacy_key === "syn-acct-04").episodes[0];
  episode.locator = { ...episode.locator, path_qualification: "unparseable_identity_path" };
  const unknown = await project({ ...inputOf(unparseable), effective: ENABLED });
  assert.deepEqual([stateOf(unknown, "ibkr/syn-acct-04"), unknown.counts.managed], [["unknown", "unknown"], 8], "A06: unknown resolved evidence");
  const conflicted = structuredClone(COMPLETE);
  conflicted.mapping.conflicts.push({ platform: "ibkr", legacy_key: "syn-acct-04", kind: "identity_episodes_differ" });
  const conflict = await project({ ...inputOf(conflicted), effective: ENABLED });
  assert.deepEqual([stateOf(conflict, "ibkr/syn-acct-04"), conflict.counts.managed], [["conflict", "unknown"], 8], "A06: conflict resolved evidence stays conflict");
  const duplicated = structuredClone(COMPLETE);
  duplicated.mapping.entries.push(structuredClone(duplicated.mapping.entries.find(entry => entry.legacy_key === "syn-acct-09")));
  const duplicate = await project({ ...inputOf(duplicated), effective: ENABLED });
  noneKnown(duplicate, "A06: duplicate reader entry");
  assert.deepEqual(rowsOf(duplicate, "binance/syn-acct-09").map(row => [row.evidence_state, row.management_status]), [["conflict", "unknown"]], "A06: a duplicate chooses no winner");
}

// A07 current-state-consistency: the derived identity must still be the one
// current instance; a later instance revision makes it stale.
{
  const moved = INSTANCES.map(item => item.key === "syn-acct-04" ? { ...item, config: { ...item.config, account_selector: "SYN0000077" } } : item);
  assert.deepEqual(stateOf(await project({ ...complete, effective: ENABLED }, { instances: moved }), "ibkr/syn-acct-04"), ["conflict", "unknown"], "A07: changed physical identity");
  const doubled = await project({ ...complete, effective: ENABLED }, { instances: [...INSTANCES, INSTANCES.find(item => item.key === "syn-acct-03")] });
  assert.deepEqual([stateOf(doubled, "ibkr/syn-acct-03"), rowsOf(doubled, "ibkr/syn-acct-03").length, doubled.counts.managed], [["conflict", "unknown"], 1, 8], "A07: duplicated current instance");
  const absent = await project({ ...complete, effective: ENABLED }, { instances: INSTANCES.filter(item => item.key !== "syn-acct-04") });
  assert.deepEqual(stateOf(absent, "ibkr/syn-acct-04"), ["unknown", "unknown"], "A07: missing current instance");
  const retiring = await project({ ...complete, effective: ENABLED }, { instances: INSTANCES.map(item => item.key === "syn-acct-05" ? { ...item, retirement_status: "requested" } : item) });
  assert.deepEqual(stateOf(retiring, "schwab/syn-acct-05"), ["unknown", "unknown"], "A07: retirement-requested instance");
  const drafted = await project({ ...complete, effective: ENABLED }, { instances: INSTANCES.map(item => item.key === "syn-acct-05" ? { ...item, kind: "draft" } : item) });
  assert.deepEqual(stateOf(drafted, "schwab/syn-acct-05"), ["unknown", "unknown"], "A07: draft instance");
  const stale = await project({ ...complete, effective: ENABLED }, { revision: 42 });
  assert.ok(stale.accounts.every(row => row.evidence_state === "stale" && row.management_status === "unknown"), "A07: a later instance revision makes the authority stale");
  assert.equal(stale.accounts[0].observed_at, META.observedAt, "A07: last-known observation time kept");
  const added = [...INSTANCES, settled({ platform: "schwab", key: "syn-acct-11", config: { key: "syn-acct-11", target_name: "syn-target-11", account_selector: "syn-selector-11" } })];
  const uncovered = await project({ ...complete, effective: ENABLED }, { instances: added });
  assert.deepEqual([uncovered.counts.display_accounts, rowOf(uncovered, "schwab/syn-acct-11").evidence_state], [11, "unknown"], "A07: an instance the authority does not cover is displayed as unknown");
  const uninitialized = await project({ ...complete, effective: ENABLED }, { instances: null });
  assert.ok(uninitialized.accounts.every(entry => entry.management_status === "unknown"), "A07: no instance state, nothing known");
}

// A08 reader-conflict-controls: replayed reader conflicts reach the
// affected account only; unattributed rows create no account.
{
  const episodes = await collect(INSTANCES, { extra: [historyRow(40, { action: "edit",
    before: { platform: "ibkr", key: "syn-acct-02", config: { key: "syn-acct-02", account_selector: "SYN0000099", target_name: "syn-target-02" } }, after: INSTANCES[2] })] });
  const replay = await project({ ...inputOf(episodes), effective: ENABLED });
  assert.deepEqual([stateOf(replay, "ibkr/syn-acct-02"), replay.counts.managed], [["conflict", "unknown"], 8], "A08: identity_episodes_differ");
  const stored = { ...accountSettingsIdentity(INSTANCES.find(item => item.key === "syn-acct-03")), account_selector: "SYN0000098" };
  const differs = await collect(INSTANCES, { extra: [["INSERT INTO account_setting_declaration (platform, account_key, revision, identity_json, declaration_json) VALUES (?, ?, ?, ?, ?)",
    "ibkr", "syn-acct-03", 1, JSON.stringify(stored), JSON.stringify({ environment: "live" })]] });
  const storedProjection = await project({ ...inputOf(differs), effective: ENABLED });
  assert.deepEqual([stateOf(storedProjection, "ibkr/syn-acct-03"), storedProjection.counts.managed], [["conflict", "unknown"], 8], "A08: stored_identity_differs_from_current");
  const colliding = [...INSTANCES, settled({ platform: "schwab", key: "syn-acct-04", config: { key: "syn-acct-04", target_name: "syn-target-04-s", account_selector: "syn-selector-04-s" } })];
  const collision = await project({ ...inputOf(await collect(colliding), policyFor(colliding)), effective: ENABLED }, { instances: colliding });
  assert.deepEqual([stateOf(collision, "ibkr/syn-acct-04"), stateOf(collision, "schwab/syn-acct-04")], [["conflict", "unknown"], ["conflict", "unknown"]], "A08: a cross-platform collision excludes both sides");
  const unattributed = await collect(INSTANCES, { extra: [["INSERT INTO account_period_return (account_key, payload_json) VALUES (?, ?)", "syn-unattributed", "{}"]] });
  assert.equal(unattributed.mapping.unattributed.length, 1);
  const counted = await project({ ...inputOf(unattributed), effective: ENABLED });
  assert.deepEqual([counted.counts.display_accounts, counted.counts.managed, JSON.stringify(counted).includes("syn-unattributed")], [10, 9, false], "A08: unattributed rows create no account");
}

// Applied state drives the code: missing state is unknown, never an
// invented disabled label; disagreeing or tampered records are conflicts.
{
  const missing = await project(complete);
  assert.deepEqual(missing.counts, { display_accounts: 10, managed: 0, management_disabled: 0, not_under_management: 1, unknown: 9 }, "applied: missing applied state");
  assert.ok(missing.accounts.filter(row => row.management_status === "unknown").every(row => row.evidence_state === "unknown"));
  const pairSplit = await project({ ...complete, effective: ENABLED.map(item => item.legacy_key === "syn-acct-01-b" ? { ...item, management_enabled: false } : item) });
  assert.deepEqual(stateOf(pairSplit, "ibkr/syn-acct-01"), ["conflict", "unknown"], "applied: deployments disagree");
  const relabeled = await project({ ...complete, effective: ENABLED.map(item => item.legacy_key === "syn-acct-02" ? { ...item, management_class: "display_only" } : item) });
  assert.deepEqual(stateOf(relabeled, "ibkr/syn-acct-02"), ["conflict", "unknown"], "applied: a management record cannot reclassify");
}

// Enrollment links are a compatibility edge, never a second resolver.
{
  const [l1, l1b, l5, l10] = fixture.enrollment_links;
  const cases = [
    ["changed", { ...l5, config_identity: { ...l5.config_identity, account_selector: "syn-selector-05-old" } }, "link_identity_changed"],
    ["missing", { ...l10, account_key: "syn-acct-gone" }, "link_target_missing"],
    ["platform", { ...l10, platform_id: "schwab" }, "link_target_missing"],
    ["shape", { ...l10, config_identity: { account_selector: "syn-selector-10" } }, "link_shape_rejected"],
  ];
  for (const [label, link, reason] of cases) {
    const projection = await project({ ...complete, effective: ENABLED, links: [link] });
    assert.deepEqual(projection.rejected_links.map(item => item.reason), [reason], `links: ${label}`);
    assert.ok(projection.accounts.every(row => !row.enrollment_links.length), `links: ${label} attaches nothing`);
    assert.equal(projection.counts.display_accounts, 10, `links: ${label} creates no account`);
  }
  const twoUids = await project({ ...complete, links: [l5, { ...l5, candidate_slot: "syn-slot-05-x", opaque_account_uid: "uid:syn-other" }] });
  assert.deepEqual(twoUids.rejected_links.map(item => item.reason), ["link_ambiguous", "link_ambiguous"], "links: one deployment, two opaque IDs");
  const duplicated = await project({ ...complete, links: [l10, l10] });
  assert.deepEqual(duplicated.rejected_links.map(item => item.reason), ["link_duplicated", "link_duplicated"], "links: duplicated binding");
  const shared = await project({ ...complete, links: [l1, { ...l1b, account_key: "syn-acct-02", config_identity: { ...l1b.config_identity, account_selector: "SYN0000002",
    deployment_selector: "syn-deploy-02", service_name: "syn-service-02" } }] });
  assert.deepEqual(shared.rejected_links.map(item => item.reason), ["link_ambiguous", "link_ambiguous"], "links: one opaque ID across two physical accounts");
  const ignored = await project({ ...complete, links: [{ ...l10, account_label: "Synthetic Link Label" }] });
  assert.deepEqual(rowOf(ignored, "firstrade/syn-acct-10").enrollment_links, [{ platform_id: "firstrade", candidate_slot: "syn-slot-10", opaque_account_uid: "uid:syn-opaque-10", target_id: "syn-run-10" }]);
}

// Labels are never keys and never emitted, whoever supplies them.
{
  const labeled = INSTANCES.map((item, index) => ({ ...item, label: `Synthetic Label ${index}`, config: { ...item.config, label: `Synthetic Config Label ${index}` } }));
  const injected = { ...LEGACY, accounts: LEGACY.accounts.map(account => ({ ...account, label: "INJECTED-LABEL", management_status: "managed" })) };
  const projection = await project({ ...complete, authority: injected, effective: ENABLED, links: fixture.enrollment_links.map(link => ({ ...link, account_label: "INJECTED-LINK-LABEL" })) }, { instances: labeled });
  const text = JSON.stringify(projection);
  for (const needle of ["Synthetic Label", "Synthetic Config Label", "INJECTED"]) assert.ok(!text.includes(needle), `labels: ${needle} never emitted`);
  assert.equal(projection.counts.managed, 9, "labels: an injected status is not trusted");
}

// The legacy digest roster preparer accepts the same links unchanged, and
// rejects a changed identity as the projection does. It validates IBKR
// selectors as broker IDs, so the non-IBKR links are replayed.
{
  const legacyLinks = fixture.enrollment_links.filter(link => link.platform_id !== "ibkr");
  const management = { initialized: true, instances: INSTANCES.map((item, index) => ({ ...item, config: { ...item.config, label: `Synthetic Label ${index}` } })) };
  const roster = legacyLinks.map(link => ({ platform_id: link.platform_id, candidate_slot: link.candidate_slot, opaque_account_uid: link.opaque_account_uid, target_id: link.target_id }));
  const legacy = links => spawnSync("python3", ["-I", "-c", `import json, sys; sys.path.insert(0, sys.argv[1]); from project_digest_display_roster import project_display_roster
try:
    print(json.dumps({"ok": project_display_roster(*json.loads(sys.stdin.read()))}))
except ValueError as error:
    print(json.dumps({"error": str(error)}))`, fileURLToPath(new URL("python/scripts", ROOT))], { input: JSON.stringify([roster, management, links]), encoding: "utf8", timeout: 30000 });
  const accepted = legacy(legacyLinks);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).ok.length, 2, "legacy: preparer accepts the links");
  const projection = await project({ ...complete, links: legacyLinks });
  assert.deepEqual([projection.rejected_links.length, projection.accounts.filter(row => row.enrollment_links.length).length], [0, 2], "legacy: the projection accepts the same links");
  const changed = legacyLinks.map(link => link.account_key === "syn-acct-05" ? { ...link, config_identity: { ...link.config_identity, service_name: "syn-service-old" } } : link);
  assert.deepEqual(JSON.parse(legacy(changed).stdout), { error: "digest_configured_account_identity_changed" }, "legacy: rejects the changed identity");
  assert.deepEqual((await project({ ...complete, links: changed })).rejected_links.map(item => item.reason), ["link_identity_changed"], "legacy: so does the projection");
}

// No account-specific branch in the policy, adapter or projection code.
// Platform literals appear only in synthetic fixtures and tests.
{
  const paths = ["application/account_mapping/policy.js", "application/account_mapping/inventory_adapter.js", "application/runtime_instances/mapping_projection.js"];
  for (const path of paths) {
    const source = await readFile(new URL(path, CONSOLE), "utf8");
    for (const pattern of [/longbridge/i, /\bhk\b/i, /\bsg\b/i, /ibkr/i, /schwab/i, /binance/i, /firstrade/i, /syn-acct/i]) {
      assert.ok(!pattern.test(source), `literals: ${path} has no ${pattern} literal`);
    }
  }
}

await rm(dir, { recursive: true, force: true });
console.log("account mapping projection validation passed");
