// Runtime-instance mapping projection: the protected read projection over
// a seeded RuntimeInstances object. The projection derives the mapping
// authority itself from a real inventory collection, a policy document and
// the collection metadata; caller-supplied summaries confer nothing. Covers
// the ten-account roster, generic status codes and evidence states, applied
// management records, enrollment links as a compatibility edge checked
// against the legacy digest consumers, byte-identical legacy and opaque IDs,
// label exclusion and the no-account-branch rule. Rows A01-A27 are the
// adjudicated acceptance rows; A22-A27 run through both the Durable Object
// entry and the direct helper. Synthetic identities only; no network.
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
const { projectAccountManagement } = await import(new URL("application/runtime_instances/mapping_projection.js", CONSOLE));
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
// The same top-level arguments through the real Durable Object entry and
// the direct helper.
async function entries(args, { revision = fixture.instance_revision, instances = INSTANCES, state } = {}) {
  const { object, close } = await objectWith(revision, instances);
  let viaObject;
  try { viaObject = object.accountManagementProjection(...args); } finally { close(); }
  return { viaObject, direct: projectAccountManagement(...args.map(arg => state ? { ...arg, state } : arg)) };
}
// One input at both entries, the helper given the state the object reads;
// both must agree.
async function both(input, options = {}) {
  const instances = options.instances === undefined ? INSTANCES : options.instances;
  const state = instances ? { revision: options.revision ?? fixture.instance_revision, instances, initialized: true } : { revision: 0, instances: [], initialized: false };
  const { viaObject, direct } = await entries([input], { ...options, state });
  assert.deepEqual(direct, viaObject, "both entries agree");
  return viaObject;
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

// A09-A12: applied records through the projection. Every record is
// inspected; a contradiction is a conflict whatever is missing.
{
  const PAIR = ["ibkr/syn-acct-01", "ibkr/syn-acct-01-b"];
  const othersEnabled = ENABLED.filter(item => item.legacy_key !== "syn-acct-01" && item.legacy_key !== "syn-acct-01-b");
  const pairAs = (managementClass, order = PAIR) => policyOf([[managementClass, order], ...FIXTURE_ACCOUNTS.slice(1)]);
  const contradiction = (projection, label) => {
    const row = rowOf(projection, PAIR[0]);
    assert.deepEqual([row.evidence_state, row.management_status, row.configuration_revision.management, processingEligible(row)], ["conflict", "unknown", null, false], label);
  };
  const present = {
    enable: text => [recordAt(text, true, 5)],
    tampered: text => [{ ...recordAt(text, false, 5), management_class: "eligible" }],
    duplicated: text => [recordAt(text, false, 5), recordAt(text, false, 5)],
  };
  let cases = 0;
  for (const [row, kinds] of [["A09", ["enable"]], ["A10", ["tampered", "duplicated"]]]) for (const kind of kinds) {
    for (const order of [PAIR, [...PAIR].reverse()]) for (const missingText of PAIR) {
      const other = PAIR.find(text => text !== missingText);
      contradiction(await project({ ...inputOf(COMPLETE, pairAs("display_only", order)), effective: [...othersEnabled, ...present[kind](other)] }), `${row}: ${kind} ${order} missing ${missingText}`);
      cases++;
    }
  }
  assert.equal(cases, 12, "A09/A10: four plus eight cases");

  // A11: a three-deployment eligible account.
  const tri = ["syn-tri-a", "syn-tri-b", "syn-tri-c"].map(key => settled({ platform: "ibkr", key,
    config: { key, target_name: `target-${key}`, account_selector: "SYN0000500", deployment_selector: `deploy-${key}`, service_name: `service-${key}`, broker_environment: "live" } }));
  const triInventory = await collect(tri);
  const permutations = items => items.length < 2 ? [items] : items.flatMap((item, index) => permutations(items.filter((_, other) => other !== index)).map(rest => [item, ...rest]));
  let disagreements = 0;
  for (const [kind, records] of [["value", [recordAt("ibkr/syn-tri-b", true, 5), recordAt("ibkr/syn-tri-c", false, 5)]],
    ["revision", [recordAt("ibkr/syn-tri-b", true, 5), recordAt("ibkr/syn-tri-c", true, 6)]]]) {
    for (const order of permutations(tri.map(item => `ibkr/${item.key}`))) for (const ordered of [records, [...records].reverse()]) {
      const projection = await project({ ...inputOf(triInventory, policyOf([["eligible", order]], tri)), effective: ordered }, { instances: tri });
      assert.deepEqual([projection.counts.display_accounts, stateOf(projection, "ibkr/syn-tri-a"), projection.accounts[0].configuration_revision.management],
        [1, ["conflict", "unknown"], null], `A11: ${kind} ${order} ${ordered.map(item => item.legacy_key)}`);
      disagreements++;
    }
  }
  assert.equal(disagreements, 24, "A11: twenty-four cases");
  const triAgree = await project({ ...inputOf(triInventory, policyOf([["eligible", tri.map(item => `ibkr/${item.key}`)]], tri)), effective: tri.map(item => recordAt(`ibkr/${item.key}`, true, 5)) }, { instances: tri });
  assert.deepEqual(stateOf(triAgree, "ibkr/syn-tri-a"), ["known", "managed"], "A11: the agreeing control");

  // A12: the controls.
  const controls = [
    ["display-only, all absent", "display_only", [], ["known", "not_under_management"], null],
    ["display-only, partial disabled", "display_only", [recordAt(PAIR[0], false, 5)], ["known", "not_under_management"], null],
    ["display-only, complete disabled", "display_only", PAIR.map(text => recordAt(text, false, 5)), ["known", "not_under_management"], 5],
    ["eligible, missing", "eligible", [recordAt(PAIR[1], true, 5)], ["unknown", "unknown"], null],
    ["eligible, complete enabled", "eligible", PAIR.map(text => recordAt(text, true, 5)), ["known", "managed"], 5],
    ["eligible, complete disabled", "eligible", PAIR.map(text => recordAt(text, false, 5)), ["known", "management_disabled"], 5],
    ["display-only, complete enable", "display_only", PAIR.map(text => recordAt(text, true, 5)), ["conflict", "unknown"], null],
  ];
  for (const [label, managementClass, records, expected, revision] of controls) {
    const projection = await project({ ...inputOf(COMPLETE, pairAs(managementClass)), effective: [...othersEnabled, ...records] });
    const row = rowOf(projection, PAIR[0]);
    assert.deepEqual([[row.evidence_state, row.management_status], row.configuration_revision.management, processingEligible(row)], [expected, revision, expected[1] === "managed"], `A12: ${label}`);
  }
  const noRecords = await project(complete);
  assert.deepEqual(stateOf(noRecords, "longbridge/syn-acct-08"), ["known", "not_under_management"], "A12: the single display-only account without records");
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

// The real Python consumers in a child with a bounded timeout. A timeout,
// signal or non-zero exit fails the row; it is never read as acceptance.
const PYTHON_SCRIPTS = fileURLToPath(new URL("python/scripts", ROOT));
function python(source, input) {
  const child = spawnSync("python3", ["-I", "-c", `import json, sys; sys.path.insert(0, sys.argv[1])\n${source}`, PYTHON_SCRIPTS],
    { input: JSON.stringify(input), encoding: "utf8", timeout: 60000, killSignal: "SIGKILL" });
  assert.equal(child.error, undefined, `python child: ${child.error}`);
  assert.deepEqual([child.status, child.signal], [0, null], `python child exit: ${child.stderr}`);
  return JSON.parse(child.stdout);
}
const bindingOf = link => ({ platform_id: link.platform_id, candidate_slot: link.candidate_slot, opaque_account_uid: link.opaque_account_uid, target_id: link.target_id });
const acceptedOf = projection => projection.accounts.flatMap(row => row.enrollment_links);
const linkFor = (instances, text, slot, uid, target) => { const [platform, key] = ref(text);
  const config = instances.find(item => item.platform === platform && item.key === key).config;
  return { platform_id: platform, candidate_slot: slot, opaque_account_uid: uid, target_id: target, account_key: key,
    config_identity: { account_selector: config.account_selector, deployment_selector: config.deployment_selector ?? null, service_name: config.service_name ?? null, runtime_status_target_id: null } }; };
const [L1, L1B, L5, L10] = fixture.enrollment_links;
const SLOT_PAIR = [L1, { ...L1, target_id: "syn-run-01-x" }];

// A13 same-platform-slot-ambiguity: links sharing one platform candidate
// slot are all rejected, within a deployment, across the deployments of
// one account and across accounts. Account rows stay as proven.
{
  const cases = [
    ["one-deployment", SLOT_PAIR],
    ["two-deployments-one-account", [L1, { ...L1B, candidate_slot: L1.candidate_slot }]],
    ["two-accounts", [L1, linkFor(INSTANCES, "ibkr/syn-acct-02", L1.candidate_slot, "uid:syn-opaque-02", "syn-run-02")]],
  ];
  for (const [label, links] of cases) {
    for (const ordered of [links, [...links].reverse()]) {
      const projection = await project({ ...complete, effective: ENABLED, links: ordered });
      assert.deepEqual(acceptedOf(projection), [], `A13: ${label} accepts none`);
      assert.deepEqual(projection.rejected_links.map(item => item.reason), ["link_candidate_slot_ambiguous", "link_candidate_slot_ambiguous"], `A13: ${label} rejects both`);
      assert.deepEqual([projection.counts.display_accounts, projection.counts.managed, projection.accounts.every(row => row.evidence_state === "known")], [10, 9, true], `A13: ${label} rows stay known`);
    }
  }
}

// A14 slot-and-link-controls.
{
  const crossPlatform = [{ ...L5, candidate_slot: "syn-slot-shared" }, { ...L10, candidate_slot: "syn-slot-shared" }];
  const shared = await project({ ...complete, links: crossPlatform });
  assert.deepEqual([acceptedOf(shared), shared.rejected_links], [crossPlatform.map(bindingOf), []], "A14: distinct platforms may reuse a slot");
  const distinct = await project({ ...complete, links: fixture.enrollment_links });
  assert.deepEqual(acceptedOf(distinct), fixture.enrollment_links.map(bindingOf), "A14: distinct slots accepted, fields byte-identical");
  for (const link of fixture.enrollment_links) {
    assert.ok(rowOf(distinct, `${link.platform_id}/${link.account_key}`).enrollment_links.some(item => JSON.stringify(item) === JSON.stringify(bindingOf(link))), `A14: ${link.account_key} keeps its link`);
  }
  const controls = [
    ["exact-duplicate", [L10, L10], ["link_duplicated", "link_duplicated"]],
    ["missing-target", [{ ...L10, account_key: "syn-acct-gone" }], ["link_target_missing"]],
    ["changed-config-identity", [{ ...L5, config_identity: { ...L5.config_identity, service_name: "syn-service-old" } }], ["link_identity_changed"]],
    ["two-opaque-ids", [L5, { ...L5, candidate_slot: "syn-slot-05-x", opaque_account_uid: "uid:syn-other" }], ["link_ambiguous", "link_ambiguous"]],
    ["opaque-id-two-accounts", [L1, linkFor(INSTANCES, "ibkr/syn-acct-02", "syn-slot-02", L1.opaque_account_uid, "syn-run-02")], ["link_ambiguous", "link_ambiguous"]],
  ];
  for (const [label, links, reasons] of controls) {
    const projection = await project({ ...complete, links });
    assert.deepEqual([acceptedOf(projection), projection.rejected_links.map(item => item.reason)], [[], reasons], `A14: ${label}`);
  }
  // The link target check is unchanged: a retiring instance is still a
  // target, while its row reads unknown.
  const retiring = await project({ ...complete, links: [L5] }, { instances: INSTANCES.map(item => item.key === "syn-acct-05" ? { ...item, retirement_status: "requested" } : item) });
  assert.deepEqual([acceptedOf(retiring), stateOf(retiring, "schwab/syn-acct-05")], [[bindingOf(L5)], ["unknown", "unknown"]], "A14: link target set unchanged");
}

// A15 legacy-constructor-parity: the unchanged digest Configuration
// accepts the single binding and rejects the A13 pair. The strategy
// profile is a synthetic legacy run-binding input only.
{
  const expected = links => links.map(link => ({ ...bindingOf(link), strategy_profile: "syn_profile" }));
  const outcomes = python(`import cloud_run_daily_digest as app
out = []
for expected in json.loads(sys.stdin.read()):
    try:
        app.Configuration(expected, "projects/synthetic/locations/synthetic/jobs/synthetic", "synthetic", "2026-10-16", False, "en")
        out.append({"ok": True})
    except ValueError as error:
        out.append({"error": str(error)})
print(json.dumps(out))`, [expected([L1]), expected(SLOT_PAIR)]);
  assert.deepEqual(outcomes, [{ ok: true }, { error: "digest_duplicate_target_binding" }], "A15: legacy Configuration parity");
  assert.deepEqual(acceptedOf(await project({ ...complete, links: [L1] })), [bindingOf(L1)], "A15: the projection accepts the single binding");
}

// A16 synthetic-ibkr-boundary: projection links through the digest roster
// preparer, the Telegram settings projection and Configuration. The IBKR
// selectors are synthetic broker-format values, never real identities.
{
  const SELECTOR = "U0000000002";
  const ibkr = INSTANCES.map(item => item.key === "syn-acct-02" ? { ...item, config: { ...item.config, account_selector: SELECTOR } } : item);
  const inventory = await collect(ibkr);
  const links = [linkFor(ibkr, "ibkr/syn-acct-02", "syn-slot-02", "uid:syn-opaque-02", "syn-run-02"), L5];
  const projection = await project({ ...inputOf(inventory, policyFor(ibkr)), effective: ENABLED, links }, { instances: ibkr });
  assert.deepEqual([acceptedOf(projection), projection.rejected_links, stateOf(projection, "ibkr/syn-acct-02")], [links.map(bindingOf), [], ["known", "managed"]], "A16: the projection accepts the links");
  assert.ok(!JSON.stringify(projection).includes(SELECTOR), "A16: no broker ID in the projection");
  const changedLinks = links.map(link => link.account_key === "syn-acct-02" ? { ...link, config_identity: { ...link.config_identity, account_selector: "U0000000099" } } : link);
  assert.deepEqual((await project({ ...inputOf(inventory, policyFor(ibkr)), links: changedLinks }, { instances: ibkr })).rejected_links.map(item => item.reason), ["link_identity_changed"], "A16: JS rejects a changed selector");
  const management = { initialized: true, instances: ibkr.map((item, index) => ({ ...item, config: { ...item.config, label: `Synthetic Label ${index}` } })) };
  const roster = acceptedOf(projection).map(binding => ({ ...binding, strategy_profile: "syn_profile" }));
  const result = python(`import os
import cloud_run_daily_digest as app
from project_digest_display_roster import project_telegram_display_settings
roster, management, links, changed = json.loads(sys.stdin.read())
settings = project_telegram_display_settings(roster, management, links, "syn-recipient")
def configured(recipient, accounts_json):
    os.environ.update({"QRS_UNIFIED_NOTIFICATION_ENABLED": "true", "DIGEST_EXPECTED_TARGETS_JSON": settings["DIGEST_EXPECTED_TARGETS_JSON"],
        "DIGEST_SCHEDULER_JOB_NAME": "projects/synthetic/locations/synthetic/jobs/synthetic", "DIGEST_RECIPIENT_SCOPE": "synthetic",
        "DIGEST_CUTOVER_REPORT_DATE": "2026-10-16", "DIGEST_TELEGRAM_IBKR_ACCOUNT_IDS_JSON": accounts_json, "QSL_GLOBAL_TELEGRAM_CHAT_ID": recipient})
    configuration = app.Configuration.from_environment()
    return {"expected": configuration.expected, "ibkr_accounts": configuration.telegram_ibkr_accounts}
mismatched = json.loads(settings["DIGEST_TELEGRAM_IBKR_ACCOUNT_IDS_JSON"])
mismatched["accounts"][0]["target_id"] = "syn-run-other"
try:
    project_telegram_display_settings(roster, management, changed, "syn-recipient")
    changed_outcome = "accepted"
except ValueError as error:
    changed_outcome = str(error)
print(json.dumps({"settings": settings, "matching": configured("syn-recipient", settings["DIGEST_TELEGRAM_IBKR_ACCOUNT_IDS_JSON"]),
    "wrong_recipient": configured("syn-other-recipient", settings["DIGEST_TELEGRAM_IBKR_ACCOUNT_IDS_JSON"]),
    "mismatched_binding": configured("syn-recipient", json.dumps(mismatched)), "changed": changed_outcome}))`, [roster, management, links, changedLinks]);
  const fields = rows => rows.map(row => [row.platform_id, row.opaque_account_uid, row.candidate_slot, row.target_id]);
  assert.deepEqual(fields(JSON.parse(result.settings.DIGEST_EXPECTED_TARGETS_JSON)), fields(acceptedOf(projection)), "A16: preparer keeps the opaque, slot and target fields byte-identical");
  assert.deepEqual(fields(result.matching.expected), fields(acceptedOf(projection)), "A16: Configuration keeps them byte-identical");
  assert.deepEqual(result.matching.ibkr_accounts, { "uid:syn-opaque-02": SELECTOR }, "A16: the matching recipient binding maps the synthetic IBKR account");
  assert.deepEqual([result.wrong_recipient.ibkr_accounts, result.mismatched_binding.ibkr_accounts], [{}, {}], "A16: wrong recipient or mismatched binding maps nothing");
  assert.equal(result.changed, "digest_configured_account_identity_changed", "A16: the preparer rejects a changed selector");
  for (const text of [result.settings.DIGEST_EXPECTED_TARGETS_JSON, JSON.stringify(result.matching.expected)]) assert.ok(!text.includes(SELECTOR), "A16: no broker ID in the general roster");
}

// A22 null-and-top-level-options: any top-level argument returns a
// projection. The object reads its own state; the helper given no state
// projects nothing.
const unknownSingle = (projection, label) => {
  assert.deepEqual(projection.counts, { display_accounts: 1, managed: 0, management_disabled: 0, not_under_management: 0, unknown: 1 }, `${label}: one row, zero managed`);
  const [row] = projection.accounts;
  assert.deepEqual([row.evidence_state, row.management_status, row.deployments, row.configuration_revision.mapping_policy, row.enrollment_links],
    ["unknown", "unknown", [{ platform: "longbridge", legacy_key: "syn-acct-08" }], null, []], `${label}: unclassified unknown row`);
};
const EMPTY = { format: "qsl_account_management_projection.v1", accounts: [], rejected_links: [], counts: { display_accounts: 0, managed: 0, management_disabled: 0, not_under_management: 0, unknown: 0 } };
{
  const forms = [["omitted", []], ["undefined", [undefined]], ["null", [null]], ["empty-object", [{}]], ["empty-array", [[]]], ["populated-array", [[complete]]],
    ["empty-string", [""]], ["string", ["inventory"]], ["zero", [0]], ["number", [7]], ["false", [false]], ["true", [true]], ["bigint", [7n]], ["symbol", [Symbol("options")]],
    ["null-prototype", [Object.create(null)]], ["date", [new Date(0)]]];
  for (const [label, args] of forms) {
    const { viaObject, direct } = await entries(args, { instances: SINGLE_INSTANCES });
    unknownSingle(viaObject, `A22: ${label} object`);
    assert.deepEqual(direct, EMPTY, `A22: ${label} helper without state`);
  }
  const valid = { ...inputOf(SINGLE, policyOf([["eligible", ["longbridge/syn-acct-08"]]], SINGLE_INSTANCES)), effective: [recordAt("longbridge/syn-acct-08", true, 2)] };
  const control = await both(valid, { instances: SINGLE_INSTANCES });
  assert.deepEqual([control.counts.managed, stateOf(control, "longbridge/syn-acct-08")], [1, ["known", "managed"]], "A22: valid state-bearing control");
}

// A23 malformed-derivation-with-state: each authority input replaced, one
// usable current instance, at both entries.
{
  const policy = policyOf([["eligible", ["longbridge/syn-acct-08"]]], SINGLE_INSTANCES);
  const valid = { ...inputOf(SINGLE, policy), effective: [recordAt("longbridge/syn-acct-08", true, 2)] };
  const values = [["undefined", undefined], ["null", null], ["empty-object", {}], ["array", [SINGLE]], ["string", "input"], ["number", 7], ["boolean", true]];
  let calls = 0;
  for (const field of ["inventory", "policy", "collection"]) for (const [label, value] of values) {
    const projection = await both({ ...valid, [field]: value }, { instances: SINGLE_INSTANCES });
    unknownSingle(projection, `A23: ${field} ${label}`);
    calls += 2;
  }
  assert.equal(calls, 42, "A23: forty-two entry calls");
  const authority = deriveMappingAuthority(SINGLE, policy, META);
  unknownSingle(await both({ authority, accounts: authority.accounts, effective: valid.effective }, { instances: SINGLE_INSTANCES }), "A23: authority-only");
  // Malformed lists read as absent ones.
  const link = linkFor(SINGLE_INSTANCES, "longbridge/syn-acct-08", "syn-slot-08", "uid:syn-opaque-08", "syn-run-08");
  const withoutEffective = await both({ ...inputOf(SINGLE, policy), links: [link] }, { instances: SINGLE_INSTANCES });
  const withoutLinks = await both(valid, { instances: SINGLE_INSTANCES });
  assert.deepEqual([stateOf(withoutEffective, "longbridge/syn-acct-08"), acceptedOf(withoutEffective)], [["unknown", "unknown"], [bindingOf(link)]], "A23: absent effective control");
  assert.deepEqual([stateOf(withoutLinks, "longbridge/syn-acct-08"), acceptedOf(withoutLinks)], [["known", "managed"], []], "A23: absent links control");
  for (const [label, value] of [["null", null], ["object", {}], ["string", "list"], ["number", 7], ["boolean", true]]) {
    assert.deepEqual(await both({ ...inputOf(SINGLE, policy), links: [link], effective: value }, { instances: SINGLE_INSTANCES }), withoutEffective, `A23: effective ${label} reads as absent`);
    assert.deepEqual(await both({ ...valid, links: value }, { instances: SINGLE_INSTANCES }), withoutLinks, `A23: links ${label} reads as absent`);
  }
}

// A24-A27: deployment ownership. Left and Right each own one deployment
// of their own; both may claim Shared. A link attaches only to its
// deployment's sole owner row.
const LEFT = "ibkr/syn-acct-02", RIGHT = "ibkr/syn-acct-03", SHARED = "ibkr/syn-acct-04";
const OTHERS = FIXTURE_ACCOUNTS.filter(([, deployments]) => ![LEFT, RIGHT, SHARED].includes(deployments[0]));
const SHARED_LINK = linkFor(INSTANCES, SHARED, "syn-slot-04", "uid:syn-opaque-04", "syn-run-04");
const LEFT_LINK = linkFor(INSTANCES, LEFT, "syn-slot-02", "uid:syn-opaque-02", "syn-run-02");
const ownedBy = (accounts, reversed) => inputOf(COMPLETE, policyOf(reversed ? [...accounts].reverse() : accounts));
const DOUBLE = [["eligible", [LEFT, SHARED]], ["eligible", [RIGHT, SHARED]], ...OTHERS];
const ORDERS = [false, true];
// Rows keyed by their deployments, so account order does not matter.
const semantic = projection => projection.accounts.map(row => JSON.stringify([row.deployments, row.evidence_state, row.management_status,
  row.enrollment_links.map(item => JSON.stringify(item)).sort()])).sort();
const rejectedOf = projection => projection.rejected_links.map(item => JSON.stringify(item)).sort();

// A24 ambiguous-deployment-owner-rejected.
for (const [label, accounts, sides] of [["with-unique-deployments", DOUBLE, [LEFT, RIGHT]],
  ["shared-only", [["eligible", [SHARED]], ["display_only", [SHARED]], ...OTHERS], []]]) {
  const outcomes = [];
  for (const reversed of ORDERS) {
    const input = { ...ownedBy(accounts, reversed), effective: ENABLED };
    const projection = await both({ ...input, links: [SHARED_LINK] });
    const tag = `A24: ${label} ${reversed ? "reversed" : "forward"}`;
    assert.deepEqual(acceptedOf(projection), [], `${tag} accepts none`);
    assert.deepEqual(projection.rejected_links, [{ ...bindingOf(SHARED_LINK), reason: "link_ambiguous" }], `${tag} one link_ambiguous`);
    const owners = rowsOf(projection, SHARED);
    assert.equal(owners.length, 2, `${tag} two owner rows`);
    assert.ok(owners.every(row => !row.enrollment_links.length && row.evidence_state === "conflict" && row.management_status === "unknown"), `${tag} owners conflict, no link`);
    for (const side of sides) assert.equal(rowOf(projection, side), owners.find(row => row.deployments.some(item => `${item.platform}/${item.legacy_key}` === side)), `${tag} ${side} is an owner`);
    assert.equal(owners.filter(row => row.management_status === "managed").length, 0, `${tag} zero managed owners`);
    assert.deepEqual(projection.accounts, (await both(input)).accounts, `${tag} rejection changes no row`);
    outcomes.push([semantic(projection), rejectedOf(projection)]);
  }
  assert.deepEqual(outcomes[0], outcomes[1], `A24: ${label} account order changes nothing`);
}

// A25 owner-cardinality-controls.
{
  for (const reversed of ORDERS) {
    const tag = `A25: ${reversed ? "reversed" : "forward"}`;
    const single = await both({ ...ownedBy([["eligible", [LEFT, SHARED]], ["eligible", [RIGHT]], ...OTHERS], reversed), effective: ENABLED, links: [SHARED_LINK] });
    assert.deepEqual([JSON.stringify(rowOf(single, SHARED).enrollment_links), single.rejected_links, rowsOf(single, SHARED).length],
      [JSON.stringify([bindingOf(SHARED_LINK)]), [], 1], `${tag} the sole claimant keeps the link byte-identically`);
    assert.equal(rowOf(single, SHARED), rowOf(single, LEFT), `${tag} the claimant is Left`);
    const unclaimed = await both({ ...ownedBy([["eligible", [LEFT]], ["eligible", [RIGHT]], ...OTHERS], reversed), effective: ENABLED, links: [SHARED_LINK] });
    const fallback = rowsOf(unclaimed, SHARED);
    assert.deepEqual([fallback.length, fallback[0].deployments.length, fallback[0].evidence_state, fallback[0].management_status, fallback[0].enrollment_links, unclaimed.rejected_links],
      [1, 1, "unknown", "unknown", [bindingOf(SHARED_LINK)], []], `${tag} an unclaimed existing deployment keeps its row and link`);
    const without = INSTANCES.filter(item => `${item.platform}/${item.key}` !== SHARED);
    const absent = await both({ ...inputOf(await collect(without), policyOf([["eligible", [LEFT]], ["eligible", [RIGHT]], ...OTHERS], without)), effective: ENABLED, links: [SHARED_LINK] }, { instances: without });
    assert.deepEqual([acceptedOf(absent), absent.rejected_links.map(item => item.reason), rowsOf(absent, SHARED).length], [[], ["link_target_missing"], 0], `${tag} an absent target is missing`);
    const conflicted = await both({ ...ownedBy(DOUBLE, reversed), effective: ENABLED, links: [LEFT_LINK] });
    assert.deepEqual([rowOf(conflicted, LEFT).enrollment_links, stateOf(conflicted, LEFT), conflicted.rejected_links, rowOf(conflicted, RIGHT).enrollment_links],
      [[bindingOf(LEFT_LINK)], ["conflict", "unknown"], [], []], `${tag} a uniquely owned deployment in a conflicted account keeps its link`);
  }
  const retiring = await both({ ...complete, links: [L5] }, { instances: INSTANCES.map(item => item.key === "syn-acct-05" ? { ...item, retirement_status: "requested" } : item) });
  assert.deepEqual([acceptedOf(retiring), stateOf(retiring, "schwab/syn-acct-05")], [[bindingOf(L5)], ["unknown", "unknown"]], "A25: the retiring target keeps its link, its row unknown");
}

// A26 ownership-and-link-ambiguity-composition: duplicate and slot rules
// come first; ownership chooses no winner among their participants.
{
  const pairs = [
    ["exact-duplicate", [SHARED_LINK, SHARED_LINK], "link_duplicated"],
    ["same-slot-same-deployment", [SHARED_LINK, { ...SHARED_LINK, target_id: "syn-run-04-x" }], "link_candidate_slot_ambiguous"],
    ["same-slot-owned-deployment", [SHARED_LINK, { ...LEFT_LINK, candidate_slot: SHARED_LINK.candidate_slot }], "link_candidate_slot_ambiguous"],
  ];
  for (const [label, pair, reason] of pairs) {
    const outcomes = [];
    for (const reversed of ORDERS) for (const ordered of [[...pair, L10], [L10, ...[...pair].reverse()]]) {
      const tag = `A26: ${label} ${reversed ? "reversed" : "forward"} ${ordered.indexOf(L10) ? "independent-last" : "independent-first"}`;
      const projection = await both({ ...ownedBy(DOUBLE, reversed), effective: ENABLED, links: ordered });
      assert.deepEqual(projection.rejected_links.map(item => item.reason), [reason, reason], `${tag} every participant rejected with ${reason}`);
      assert.deepEqual(JSON.stringify(acceptedOf(projection)), JSON.stringify([bindingOf(L10)]), `${tag} the independent link stays byte-identical`);
      assert.deepEqual(stateOf(projection, "firstrade/syn-acct-10"), ["known", "managed"], `${tag} the independent row stays known`);
      assert.ok(rowsOf(projection, SHARED).every(row => !row.enrollment_links.length && row.evidence_state === "conflict"), `${tag} owners get nothing`);
      outcomes.push([semantic(projection), rejectedOf(projection)]);
    }
    assert.ok(outcomes.every(outcome => JSON.stringify(outcome) === JSON.stringify(outcomes[0])), `A26: ${label} order changes nothing`);
  }
}

// A27 distinct-ownership-stability: uniquely owned deployments give the
// same accepted multiset and attachment in every account and link order.
{
  const crossPlatform = [{ ...L5, candidate_slot: "syn-slot-shared" }, { ...L10, candidate_slot: "syn-slot-shared" }];
  for (const [label, links] of [["distinct-slots", fixture.enrollment_links], ["cross-platform-slot", crossPlatform]]) {
    const outcomes = [];
    for (const reversed of ORDERS) for (const ordered of [links, [...links].reverse()]) {
      const projection = await both({ ...ownedBy(FIXTURE_ACCOUNTS, reversed), effective: ENABLED, links: ordered });
      assert.deepEqual([projection.rejected_links, acceptedOf(projection).map(item => JSON.stringify(item)).sort()], [[], links.map(link => JSON.stringify(bindingOf(link))).sort()], `A27: ${label} accepted multiset`);
      for (const link of links) assert.ok(rowOf(projection, `${link.platform_id}/${link.account_key}`).enrollment_links.some(item => JSON.stringify(item) === JSON.stringify(bindingOf(link))), `A27: ${label} ${link.account_key} attached`);
      outcomes.push(semantic(projection));
    }
    assert.ok(outcomes.every(outcome => JSON.stringify(outcome) === JSON.stringify(outcomes[0])), `A27: ${label} order changes nothing`);
  }
  const controls = [
    ["changed-identity", [{ ...L5, config_identity: { ...L5.config_identity, service_name: "syn-service-old" } }], ["link_identity_changed"]],
    ["two-opaque-ids", [L5, { ...L5, candidate_slot: "syn-slot-05-x", opaque_account_uid: "uid:syn-other" }], ["link_ambiguous", "link_ambiguous"]],
    ["opaque-id-two-accounts", [L1, linkFor(INSTANCES, LEFT, "syn-slot-02", L1.opaque_account_uid, "syn-run-02")], ["link_ambiguous", "link_ambiguous"]],
  ];
  for (const [label, links, reasons] of controls) for (const reversed of ORDERS) for (const ordered of [links, [...links].reverse()]) {
    const input = { ...ownedBy(FIXTURE_ACCOUNTS, reversed), effective: ENABLED };
    const projection = await both({ ...input, links: ordered });
    assert.deepEqual([acceptedOf(projection), projection.rejected_links.map(item => item.reason)], [[], reasons], `A27: ${label} keeps its reasons`);
    assert.deepEqual(projection.accounts, (await both(input)).accounts, `A27: ${label} leaves account evidence unchanged`);
  }
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
