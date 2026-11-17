// Inventory adapter: mapping authority derived only from complete #1173
// reader results. Every fixture is collected through the real inventory
// route over a seeded RuntimeInstances object and assembled by the real
// assembler, unmodified. Synthetic identities only; no network.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { collectInventory, historyRow, instanceStateRow } from "./helpers/account_identity_inventory_collect.mjs";

const CONSOLE = new URL("../web/strategy-switch-console/", import.meta.url);
const { deriveMappingAuthority, mappingAuthorityInput } = await import(new URL("application/account_mapping/inventory_adapter.js", CONSOLE));
const { accountSettingsIdentity } = await import(new URL("application/account_settings/helpers.js", CONSOLE));
const fixture = JSON.parse(await readFile(new URL("fixtures/account-mapping-roster.synthetic.json", import.meta.url), "utf8"));

const ENUMERATED = "retained_state_enumerated_external_evidence_required";
const META = { observedAt: "2026-11-17T01:00:00.000Z", sourceRef: "inventory_export:synthetic-01" };
const TS = "2026-01-01T00:00:00.000Z";
const settled = item => ({ ...item, kind: "existing", enabled: null, platform_applied: null, application_status: "unknown", retirement_status: "none", created_at: TS, updated_at: TS });
const INSTANCES = fixture.instances.map(settled);
const ref = text => { const at = text.indexOf("/"); return [text.slice(0, at), text.slice(at + 1)]; };
const identityOf = (instances, platform, key) => accountSettingsIdentity(instances.find(item => item.platform === platform && item.key === key));
// The fixture policy, with each deployment bound to its settings identity.
const policyFor = (instances = INSTANCES, classes = {}) => ({ ...fixture.policy, accounts: fixture.policy.accounts.map((account, index) => ({
  management_class: classes[index] ?? account.management_class,
  deployments: account.deployments.map(text => { const [platform, key] = ref(text); return { platform, legacy_key: key, identity: identityOf(instances, platform, key) }; }) })) });
const roster = (instances = INSTANCES, extra = []) => [instanceStateRow(fixture.instance_revision, instances), ...extra];
const keysOf = account => account.deployments.map(item => `${item.platform}/${item.legacy_key}`);
const byKey = (authority, text) => authority.accounts.find(account => keysOf(account).includes(text));
const classCount = (authority, managementClass) => authority.accounts.filter(account => account.management_class === managementClass).length;
const excludedFromAuthority = (authority, label) => {
  assert.equal(authority.authoritative, false, `${label}: not authoritative`);
  assert.ok(authority.accounts.every(account => account.evidence_state !== "known"), `${label}: no account is known`);
};

// roster: the ten-account roster through the real route. Eleven deployments,
// ten physical accounts; the duplicate pair is one mapping entry.
const complete = await collectInventory({ statements: roster() });
{
  assert.equal(complete.private.status, ENUMERATED, "roster: the reader enumerates retained state");
  assert.deepEqual([complete.summary.mapping.entries, complete.summary.mapping.conflicts, complete.summary.mapping.cross_platform_collisions], [11, 0, 0]);
  const authority = deriveMappingAuthority(complete.private, policyFor(), META);
  assert.deepEqual([authority.authoritative, authority.reasons, authority.instance_revision, authority.policy_revision, authority.policy_error], [true, [], 41, 3, null]);
  assert.equal(authority.deployments.length, 11, "roster: eleven resolved deployments");
  assert.equal(authority.accounts.length, 10, "roster: ten physical accounts");
  assert.ok(authority.accounts.every(account => account.evidence_state === "known" && !account.reasons.length), "roster: every account known");
  assert.deepEqual([classCount(authority, "eligible"), classCount(authority, "display_only")], [9, 1], "roster: nine eligible, one display-only");
  assert.deepEqual(keysOf(byKey(authority, "ibkr/syn-acct-01-b")), ["ibkr/syn-acct-01", "ibkr/syn-acct-01-b"], "roster: two deployments, one mapping entry");
  assert.deepEqual(authority.accounts.flatMap(keysOf).sort(), INSTANCES.map(item => `${item.platform}/${item.key}`).sort(), "roster: keys preserved byte-identical");
  assert.notEqual(byKey(authority, "longbridge/syn-acct-06"), byKey(authority, "longbridge/syn-acct-07"), "roster: a shared selector merges nothing");
  // The eligible count follows the policy data, not the code.
  assert.deepEqual([classCount(deriveMappingAuthority(complete.private, policyFor(INSTANCES, { 1: "display_only" }), META), "eligible")], [8], "roster: two display-only, eight eligible");
  assert.equal(classCount(deriveMappingAuthority(complete.private, policyFor(INSTANCES, { 7: "eligible" }), META), "eligible"), 10, "roster: no display-only, ten eligible");
  // An unclassified deployment and an invalid policy stay visible as unknown.
  const partialPolicy = policyFor();
  partialPolicy.accounts = partialPolicy.accounts.slice(1);
  const unclassified = deriveMappingAuthority(complete.private, partialPolicy, META);
  assert.deepEqual(unclassified.accounts.filter(account => account.management_class === null).map(account => [keysOf(account), account.evidence_state]),
    [[["ibkr/syn-acct-01"], "unknown"], [["ibkr/syn-acct-01-b"], "unknown"]], "roster: unclassified deployments are not grouped or classified");
  const invalid = deriveMappingAuthority(complete.private, { ...policyFor(), accounts: [{ management_class: "managed", deployments: [] }] }, META);
  assert.deepEqual([invalid.policy_error, invalid.accounts.length, invalid.accounts.every(account => account.management_class === null && account.evidence_state === "unknown")],
    ["invalid_management_class", 11, true], "roster: a tampered policy classifies nothing");
  for (const [meta, code] of [[{ ...META, observedAt: "yesterday" }, "invalid_observed_at"], [{ ...META, sourceRef: "has space" }, "invalid_source_ref"]]) {
    assert.throws(() => mappingAuthorityInput(complete.private, meta), error => error.code === code, `roster: ${code}`);
  }
}

// A04 incomplete-reader-exclusion: partial collections. Groups 16-22 left
// to the provider export (the first production collection's shape), one KV
// pass, and no environment. Group 23 stays external evidence in the complete
// control.
assert.deepEqual([complete.private.groups["23"], deriveMappingAuthority(complete.private, policyFor(), META).authoritative], ["external_evidence_required", true], "A04: group 23 control");
for (const [label, options, reason] of [
  ["A04-provider-export-required", { kvPasses: 0, collectEnv: false }, "group:16:provider_export_required"],
  ["A04-one-kv-pass", { kvPasses: 1 }, "group:20:incomplete"],
  ["A04-missing-env", { collectEnv: false }, "group:16:env_section_not_collected"],
]) {
  const assembled = await collectInventory({ statements: roster(), ...options });
  assert.equal(assembled.private.status, "incomplete", `${label}: reader status`);
  const authority = deriveMappingAuthority(assembled.private, policyFor(), META);
  excludedFromAuthority(authority, label);
  assert.ok(authority.reasons.includes(reason), `${label}: ${reason}`);
  assert.ok(authority.accounts.every(account => account.evidence_state === "unknown" && account.reasons.includes("mapping_authority_unavailable")), `${label}: every account unknown`);
  assert.equal(authority.accounts.length, 10, `${label}: the accounts stay listed`);
}

// A04: truncated identity projections. A KV value cut at the depth bound,
// and an instance selector beyond the long-string bound.
{
  let node = { platform: "ibkr", account_key: "syn-deep" };
  for (let level = 9; level >= 1; level--) node = { [`l${level}`]: node };
  const deep = await collectInventory({ statements: roster(), kv: { account_facts_bindings: JSON.stringify(node) } });
  assert.equal(deep.private.groups[17], "incomplete");
  const deepAuthority = deriveMappingAuthority(deep.private, policyFor(), META);
  excludedFromAuthority(deepAuthority, "A04-depth-truncated-kv");
  assert.ok(deepAuthority.reasons.includes("group:17:incomplete"));

  const long = INSTANCES.map(item => item.key === "syn-acct-02" ? { ...item, config: { ...item.config, account_selector: "S".repeat(600) } } : item);
  const truncated = await collectInventory({ statements: roster(long) });
  const authority = deriveMappingAuthority(truncated.private, policyFor(long), META);
  excludedFromAuthority(authority, "A04-truncated-identity");
  assert.ok(authority.reasons.includes("identity_losses"), "A04: the identity loss is a reason");
  assert.deepEqual(authority.deployments.find(item => item.legacy_key === "syn-acct-02").reasons, ["identity_unreadable"], "A04: the truncated identity is unreadable, never matched");
  assert.equal(byKey(authority, "ibkr/syn-acct-02").evidence_state, "unknown");
}

// A08 reader-conflict-controls: the two production conflict shapes and a cross-platform
// collision, replayed. The result stays enumerated; only the affected
// accounts leave authority, as conflicts.
{
  const episodes = await collectInventory({ statements: roster(INSTANCES, [historyRow(40, { action: "edit",
    before: { platform: "ibkr", key: "syn-acct-02", config: { key: "syn-acct-02", account_selector: "SYN0000099", target_name: "syn-target-02" } },
    after: INSTANCES.find(item => item.key === "syn-acct-02") })]) });
  assert.deepEqual([episodes.private.status, episodes.private.mapping.conflicts.map(item => item.kind)], [ENUMERATED, ["identity_episodes_differ"]], "A08: reader conflict");
  const authority = deriveMappingAuthority(episodes.private, policyFor(), META);
  assert.equal(authority.authoritative, true);
  assert.deepEqual([byKey(authority, "ibkr/syn-acct-02").evidence_state, byKey(authority, "ibkr/syn-acct-02").reasons], ["conflict", ["identity_episodes_differ"]], "A08: excluded as conflict");
  assert.equal(authority.accounts.filter(account => account.evidence_state === "known").length, 9, "A08: the other nine stay known");

  const stored = { ...accountSettingsIdentity(INSTANCES.find(item => item.key === "syn-acct-03")), account_selector: "SYN0000098" };
  const differs = await collectInventory({ statements: roster(INSTANCES, [["INSERT INTO account_setting_declaration (platform, account_key, revision, identity_json, declaration_json) VALUES (?, ?, ?, ?, ?)",
    "ibkr", "syn-acct-03", 1, JSON.stringify(stored), JSON.stringify({ environment: "live" })]]) });
  assert.deepEqual([differs.private.status, differs.private.mapping.conflicts.map(item => item.kind)], [ENUMERATED, ["stored_identity_differs_from_current"]], "A08: reader conflict");
  const storedAuthority = deriveMappingAuthority(differs.private, policyFor(), META);
  assert.deepEqual([byKey(storedAuthority, "ibkr/syn-acct-03").evidence_state, byKey(storedAuthority, "ibkr/syn-acct-03").reasons], ["conflict", ["stored_identity_differs_from_current"]], "A08: excluded as conflict");

  const colliding = [...INSTANCES, settled({ platform: "schwab", key: "syn-acct-04", config: { key: "syn-acct-04", target_name: "syn-target-04-s", account_selector: "syn-selector-04-s" } })];
  const collision = await collectInventory({ statements: roster(colliding) });
  assert.deepEqual([collision.private.status, collision.summary.mapping.cross_platform_collisions], [ENUMERATED, 1], "A08: one cross-platform collision");
  const collisionAuthority = deriveMappingAuthority(collision.private, policyFor(colliding), META);
  assert.deepEqual([byKey(collisionAuthority, "ibkr/syn-acct-04").evidence_state, byKey(collisionAuthority, "schwab/syn-acct-04").evidence_state], ["conflict", "conflict"], "A08: both sides excluded");
  assert.ok(byKey(collisionAuthority, "ibkr/syn-acct-04").reasons.includes("cross_platform_collision"));
}

// A08: unattributed references are counted, never mapped.
{
  const unattributed = await collectInventory({ statements: roster(INSTANCES, [["INSERT INTO account_period_return (account_key, payload_json) VALUES (?, ?)", "syn-unattributed", "{}"],
    ["INSERT INTO account_period_return (account_key, payload_json) VALUES (?, ?)", "syn-acct-05", "{}"]]) });
  assert.equal(unattributed.private.mapping.unattributed.length, 2);
  const authority = deriveMappingAuthority(unattributed.private, policyFor(), META);
  assert.deepEqual([authority.authoritative, authority.counts.unattributed, authority.accounts.length], [true, 2, 10], "A08: counted");
  assert.ok(!JSON.stringify(authority.accounts).includes("syn-unattributed") && !JSON.stringify(authority.deployments).includes("syn-unattributed"), "A08: never mapped");
  assert.equal(byKey(authority, "schwab/syn-acct-05").evidence_state, "known", "A08: an unattributed reference adds no identity");
}

// changed physical identity. A policy bound before a selector change
// no longer matches the resolved identity.
{
  const authority = deriveMappingAuthority(complete.private, policyFor(INSTANCES.map(item => item.key === "syn-acct-10"
    ? { ...item, config: { ...item.config, account_selector: "syn-selector-10-old" } } : item)), META);
  assert.deepEqual([byKey(authority, "firstrade/syn-acct-10").evidence_state, byKey(authority, "firstrade/syn-acct-10").reasons], ["conflict", ["physical_identity_changed"]], "changed physical identity");
}

// drafts, retirement requests, orphans and opaque keys.
{
  const odd = "Syn Acct/Ω:01 ";
  const instances = [...INSTANCES, settled({ platform: "schwab", key: odd, config: { key: odd, target_name: "syn-target-odd", account_selector: "syn-selector-odd" } }),
    { ...settled({ platform: "schwab", key: "syn-retiring", config: { key: "syn-retiring", target_name: "syn-target-r", account_selector: "syn-selector-r" } }), retirement_status: "requested" },
    { ...settled({ platform: "schwab", key: "syn-draft", config: { key: "syn-draft", target_name: "syn-target-d", account_selector: "syn-selector-d" } }), kind: "draft" }];
  const assembled = await collectInventory({ statements: roster(instances, [["INSERT INTO account_setting_draft (platform, account_key, revision, identity_json, overrides_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    "schwab", "syn-orphan", 1, "{}", "{}", TS]]) });
  const authority = deriveMappingAuthority(assembled.private, policyFor(instances), META);
  assert.equal(authority.authoritative, true);
  assert.deepEqual(authority.excluded.map(item => [item.legacy_key, item.evidence_state, item.reasons]).sort(),
    [["syn-draft", "unknown", ["instance_draft"]], ["syn-orphan", "unknown", ["instance_orphan"]], ["syn-retiring", "unknown", ["instance_retirement_requested"]]], "drafts: excluded, with reasons");
  const opaque = authority.accounts.find(account => account.deployments[0].legacy_key === odd);
  assert.ok(opaque && opaque.management_class === null && opaque.evidence_state === "unknown", "drafts: an opaque key passes byte-identical and stays unclassified");
}

// A06 resolution-required: tampered reader results never certify
// themselves. A claimed enumerated status over incomplete groups, a
// duplicated entry and an unparseable identity path are each excluded.
{
  const tampered = structuredClone((await collectInventory({ statements: roster(), kvPasses: 0, collectEnv: false })).private);
  tampered.status = ENUMERATED;
  excludedFromAuthority(deriveMappingAuthority(tampered, policyFor(), META), "A06-claimed-status");
  const duplicated = structuredClone(complete.private);
  duplicated.mapping.entries.push(structuredClone(duplicated.mapping.entries.find(entry => entry.legacy_key === "syn-acct-09")));
  const duplicatedAuthority = deriveMappingAuthority(duplicated, policyFor(), META);
  assert.deepEqual(duplicatedAuthority.excluded.map(item => [item.legacy_key, item.evidence_state, item.reasons]), [["syn-acct-09", "conflict", ["mapping_entry_duplicated"]], ["syn-acct-09", "conflict", ["mapping_entry_duplicated"]]]);
  assert.equal(duplicatedAuthority.authoritative, false, "A06: a duplicated entry breaks the instance cross-check");
  const unparseable = structuredClone(complete.private);
  // Episodes share one locator object; give the edited one its own.
  const episode = unparseable.mapping.entries.find(entry => entry.legacy_key === "syn-acct-09").episodes[0];
  episode.locator = { ...episode.locator, path_qualification: "unparseable_identity_path" };
  const unparseableAuthority = deriveMappingAuthority(unparseable, policyFor(), META);
  assert.deepEqual([byKey(unparseableAuthority, "binance/syn-acct-09").evidence_state, byKey(unparseableAuthority, "binance/syn-acct-09").reasons], ["unknown", ["identity_path_unparseable"]], "A06: unknown resolved evidence");
  assert.equal(unparseableAuthority.accounts.filter(account => account.evidence_state === "known").length, 9, "A06: only the affected account leaves authority");
  const without = structuredClone(complete.private);
  without.mapping.entries = without.mapping.entries.filter(entry => entry.legacy_key !== "syn-acct-04");
  const withoutAuthority = deriveMappingAuthority(without, policyFor(), META);
  excludedFromAuthority(withoutAuthority, "A06-missing-resolved-entry");
  assert.deepEqual([withoutAuthority.reasons, byKey(withoutAuthority, "ibkr/syn-acct-04").reasons], [["instance_state_mismatch"], ["deployment_not_resolved", "mapping_authority_unavailable"]], "A06: missing resolved entry");
  const conflicted = structuredClone(complete.private);
  conflicted.mapping.conflicts.push({ platform: "ibkr", legacy_key: "syn-acct-04", kind: "identity_episodes_differ" });
  assert.equal(byKey(deriveMappingAuthority(conflicted, policyFor(), META), "ibkr/syn-acct-04").evidence_state, "conflict", "A06: conflict resolved evidence stays conflict");
  assert.ok(duplicatedAuthority.accounts.every(account => account.evidence_state !== "known"), "A06: a duplicate chooses no winner");
  assert.throws(() => mappingAuthorityInput({ status: ENUMERATED }, META), error => error.code === "invalid_inventory_result");
}

// A05 policy-validation-and-ownership: an invalid or malformed policy
// classifies nothing; one deployment claimed by two policy accounts has no
// winner; a class change acts through derivation from the policy document.
{
  for (const [label, policy] of [["invalid-class", { ...policyFor(), accounts: [{ ...policyFor().accounts[1], management_class: "managed" }] }], ["malformed", { ...policyFor(), format: "other" }],
    ["not-an-object", "policy"]]) {
    const authority = deriveMappingAuthority(complete.private, policy, META);
    assert.ok(authority.policy_error && authority.policy_revision === null, `A05: ${label} rejected`);
    assert.ok(authority.accounts.every(account => account.management_class === null && account.evidence_state !== "known"), `A05: ${label} classifies nothing`);
  }
  const twice = policyFor();
  twice.accounts.push({ management_class: "display_only", deployments: structuredClone(twice.accounts[1].deployments) });
  const authority = deriveMappingAuthority(complete.private, twice, META);
  assert.deepEqual(authority.accounts.filter(account => keysOf(account).includes("ibkr/syn-acct-02")).map(account => [account.management_class, account.evidence_state]),
    [["eligible", "conflict"], ["display_only", "conflict"]], "A05: a deployment claimed twice is a conflict for both");
  assert.equal(classCount(deriveMappingAuthority(complete.private, policyFor(INSTANCES, { 1: "display_only" }), META), "display_only"), 2, "A05: the class follows the policy document");
}

// A17 reader-reason-contract: `groups`, `group_reasons` and
// `identity_losses` are on the result root, not on `mapping`. Completeness
// is read from `status`, `groups`, `objects`, the top-level `reasons` and
// `identity_losses`; `group_reasons` is diagnostic and is not read.
{
  const partial = (await collectInventory({ statements: roster(), kvPasses: 1 })).private;
  for (const field of ["groups", "group_reasons", "identity_losses"]) {
    assert.ok(Object.hasOwn(partial, field) && !Object.hasOwn(partial.mapping, field), `A17: ${field} at the result root`);
  }
  assert.ok(Object.keys(partial.group_reasons).length > 0, "A17: the partial collection carries retained-group causes");
  excludedFromAuthority(deriveMappingAuthority(partial, policyFor(), META), "A17-partial");
  const withoutCauses = structuredClone(partial);
  withoutCauses.group_reasons = {};
  excludedFromAuthority(deriveMappingAuthority(withoutCauses, policyFor(), META), "A17-causes-removed");
  const forged = structuredClone(complete.private);
  forged.group_reasons = { 20: ["synthetic_diagnostic"] };
  assert.equal(deriveMappingAuthority(forged, policyFor(), META).authoritative, true, "A17: group_reasons alone decides nothing");
}

console.log("account mapping inventory adapter validation passed");
