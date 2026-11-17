// Account mapping policy: strict classification documents, class-tampering
// rejection, deployment grouping and the generic management predicates.
// Pure functions over synthetic identities only; no storage or network.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const CONSOLE = new URL("../web/strategy-switch-console/", import.meta.url);
const POLICY = new URL("application/account_mapping/policy.js", CONSOLE);
const {
  MANAGEMENT_STATUS, MAPPING_POLICY_FORMAT, MappingPolicyError, classifyAccounts, effectiveManagementState, managementEnableAllowed,
  managementStatus, normalizeEffectiveManagement, normalizeMappingPolicy, processingEligible,
} = await import(POLICY);

const identity = (platform, key, overrides = {}) => ({ platform, key, target_name: `target-${key}`, broker_environment: "live",
  account_selector: `selector-${key}`, deployment_selector: "", account_scope: "", service_name: "", ...overrides });
const deployment = (platform, key, overrides) => ({ platform, legacy_key: key, identity: identity(platform, key, overrides) });
const policyOf = (accounts, revision = 1) => ({ format: MAPPING_POLICY_FORMAT, policy_revision: revision, accounts });
const resolvedOf = (items, authoritative = true) => ({ authoritative, reasons: authoritative ? [] : ["synthetic_incomplete"],
  deployments: items.map(item => ({ platform: item.platform, legacy_key: item.legacy_key, identity: item.identity, evidence_state: "known", reasons: [], ...item.extra })) });
const rejects = (document, code, label) => assert.throws(() => normalizeMappingPolicy(document), error => error instanceof MappingPolicyError && error.code === code, label);

// P1: a valid document is accepted and every value is kept byte-identical.
const odd = deployment("alpha", "Acct.01:x-Ω", { account_selector: "  spaced selector  ", broker_environment: null });
{
  const document = policyOf([{ management_class: "eligible", deployments: [odd] }, { management_class: "display_only", deployments: [deployment("beta", "b-1")] }], 7);
  const policy = normalizeMappingPolicy(structuredClone(document));
  assert.equal(policy.policy_revision, 7);
  assert.deepEqual(policy.accounts.map(account => account.management_class), ["eligible", "display_only"]);
  assert.deepEqual(policy.accounts[0].deployments[0], odd, "P1: legacy key and identity preserved byte-identical");
}

// P2: class tampering and malformed documents reject the whole document.
{
  const one = deployment("alpha", "a-1");
  for (const managementClass of ["managed", "Eligible", " eligible", "display-only", "", null, true, 1, undefined]) {
    rejects(policyOf([{ management_class: managementClass, deployments: [one] }]), "invalid_management_class", `P2: class ${JSON.stringify(managementClass)} rejected`);
  }
  rejects(policyOf([{ management_class: "eligible", deployments: [one], management_enabled: true }]), "invalid_mapping_policy_account", "P2: extra account field rejected");
  rejects(policyOf([{ management_class: "eligible", deployments: [{ ...one, label: "Shown" }] }]), "invalid_mapping_policy_deployment", "P2: a label is not a key");
  rejects(policyOf([{ management_class: "eligible", deployments: [{ ...one, identity: { ...one.identity, key: "other" } }] }]), "invalid_mapping_policy_deployment", "P2: identity key mismatch");
  rejects(policyOf([{ management_class: "eligible", deployments: [{ ...one, identity: { ...one.identity, broker_environment: "sandbox" } }] }]), "invalid_mapping_policy_deployment", "P2: environment vocabulary");
  const partial = { ...one.identity };
  delete partial.service_name;
  rejects(policyOf([{ management_class: "eligible", deployments: [{ ...one, identity: partial }] }]), "invalid_mapping_policy_deployment", "P2: incomplete identity");
  rejects(policyOf([{ management_class: "eligible", deployments: [one, deployment("beta", "b-1")] }]), "physical_account_spans_platforms", "P2: one account, two platforms");
  rejects(policyOf([{ management_class: "eligible", deployments: [one, deployment("alpha", "a-2", { broker_environment: "paper" })] }]), "physical_account_spans_environments", "P2: paper never joins live");
  rejects(policyOf([{ management_class: "eligible", deployments: [one, one] }]), "invalid_mapping_policy_deployments", "P2: repeated deployment in one account");
  rejects({ ...policyOf([{ management_class: "eligible", deployments: [one] }]), format: "other" }, "invalid_mapping_policy", "P2: format");
  rejects({ ...policyOf([{ management_class: "eligible", deployments: [one] }]), extra: 1 }, "invalid_mapping_policy", "P2: extra top-level field");
  rejects(policyOf([{ management_class: "eligible", deployments: [one] }], 0), "invalid_mapping_policy_revision", "P2: revision");
  rejects(policyOf([]), "invalid_mapping_policy_accounts", "P2: empty policy");
}

// P3: classification. Two deployments under one policy account are one
// entry; every exclusion is reported, never resolved.
{
  const a1 = deployment("alpha", "a-1"), a2 = deployment("alpha", "a-2", { deployment_selector: "second" }), b1 = deployment("beta", "b-1");
  const policy = normalizeMappingPolicy(policyOf([{ management_class: "eligible", deployments: [a1, a2] }, { management_class: "display_only", deployments: [b1] }]));
  const known = classifyAccounts(resolvedOf([a1, a2, b1]), policy);
  assert.deepEqual(known.map(entry => [entry.deployments.length, entry.management_class, entry.evidence_state, entry.reasons]),
    [[2, "eligible", "known", []], [1, "display_only", "known", []]], "P3: two deployments, one mapping entry");
  assert.deepEqual(classifyAccounts(resolvedOf([a1, a2, b1], false), policy).map(entry => entry.evidence_state), ["unknown", "unknown"], "P3: non-authoritative input");
  assert.deepEqual(classifyAccounts(resolvedOf([a1, b1]), policy).map(entry => [entry.evidence_state, entry.reasons]),
    [["unknown", ["deployment_not_resolved"]], ["known", []]], "P3: a missing deployment is unknown");
  const moved = { ...a2, identity: { ...a2.identity, account_selector: "changed" } };
  assert.deepEqual(classifyAccounts(resolvedOf([a1, moved, b1]), policy)[0].reasons, ["physical_identity_changed"], "P3: changed physical identity");
  assert.equal(classifyAccounts(resolvedOf([a1, moved, b1]), policy)[0].evidence_state, "conflict");
  const conflicted = classifyAccounts(resolvedOf([a1, { ...a2, extra: { evidence_state: "conflict", reasons: ["identity_episodes_differ"] } }, b1]), policy);
  assert.deepEqual([conflicted[0].evidence_state, conflicted[0].reasons], ["conflict", ["identity_episodes_differ"]], "P3: reader conflict propagates");
  const twice = normalizeMappingPolicy(policyOf([{ management_class: "eligible", deployments: [a1] }, { management_class: "display_only", deployments: [a1] }]));
  assert.deepEqual(classifyAccounts(resolvedOf([a1]), twice).map(entry => [entry.management_class, entry.evidence_state]),
    [["eligible", "conflict"], ["display_only", "conflict"]], "P3: a deployment claimed twice has no winner");
  const extra = deployment("gamma", "g-1");
  const visible = classifyAccounts(resolvedOf([a1, a2, b1, extra]), policy);
  assert.deepEqual(visible.at(-1), { deployments: [{ platform: "gamma", legacy_key: "g-1" }], management_class: null, evidence_state: "unknown",
    reasons: ["deployment_unclassified"] }, "P3: an unclassified resolved deployment stays visible as unknown");
}

// P4: applied management records. A record cannot carry a class, label or
// status; display-only accounts are never enabled.
{
  const a1 = deployment("alpha", "a-1"), a2 = deployment("alpha", "a-2");
  const account = { deployments: [a1, a2].map(({ platform, legacy_key }) => ({ platform, legacy_key })), management_class: "eligible", evidence_state: "known" };
  const record = (key, enabled = true, revision = 3) => ({ platform: "alpha", legacy_key: key, management_enabled: enabled, revision, effective_at: "2026-11-17T00:00:00Z" });
  assert.deepEqual(effectiveManagementState(account, [record("a-1"), record("a-2")]),
    { evidence_state: "known", reasons: [], management_enabled: true, revision: 3, effective_at: "2026-11-17T00:00:00Z" }, "P4: agreeing records");
  assert.deepEqual(effectiveManagementState(account, [record("a-1")]), { evidence_state: "unknown", reasons: ["effective_state_missing"] }, "P4: missing record");
  assert.deepEqual(effectiveManagementState(account, [record("a-1"), record("a-2", false)]).reasons, ["effective_state_differs_across_deployments"], "P4: disagreeing deployments");
  assert.deepEqual(effectiveManagementState(account, [record("a-1"), record("a-1"), record("a-2")]).reasons, ["effective_state_duplicated"], "P4: duplicated record");
  for (const field of ["management_class", "label", "management_status"]) {
    const tampered = { ...record("a-1"), [field]: "display_only" };
    assert.deepEqual(normalizeEffectiveManagement(tampered), { rejected: "effective_state_shape_rejected" }, `P4: ${field} rejected in a management record`);
    assert.equal(effectiveManagementState(account, [tampered, record("a-2")]).evidence_state, "conflict", `P4: ${field} tampering is a conflict`);
  }
  for (const bad of [{ management_enabled: "true" }, { revision: 0 }, { effective_at: "2026-11-17" }, { effective_at: "not a time" }]) {
    assert.equal(normalizeEffectiveManagement({ ...record("a-1"), ...bad }).rejected, "effective_state_shape_rejected", `P4: ${JSON.stringify(bad)}`);
  }
  const displayOnly = { ...account, management_class: "display_only" };
  assert.deepEqual(effectiveManagementState(displayOnly, [record("a-1"), record("a-2")]).reasons, ["management_enabled_for_ineligible_class"], "P4: display-only enable is a conflict");
}

// A09-A12: every record is inspected before the outcome is chosen. A
// contradiction is a conflict whatever is missing, in any deployment or
// record order; a missing record without one is unknown; only a known
// outcome carries a revision.
{
  const at = "2026-11-17T00:00:00Z";
  const rec = (key, enabled, revision = 3) => ({ platform: "alpha", legacy_key: key, management_enabled: enabled, revision, effective_at: at });
  const accountOf = (managementClass, keys) => ({ deployments: keys.map(key => ({ platform: "alpha", legacy_key: key })), management_class: managementClass, evidence_state: "known" });
  const outcome = (account, records) => {
    const effective = effectiveManagementState(account, records);
    const status = managementStatus(account, effective);
    return { effective, status, eligible: processingEligible({ evidence_state: effective.evidence_state === "conflict" ? "conflict" : account.evidence_state, management_status: status }) };
  };
  const contradiction = (label, account, records) => {
    const { effective, status, eligible } = outcome(account, records);
    assert.equal(effective.evidence_state, "conflict", `${label}: conflict`);
    assert.ok(!Object.hasOwn(effective, "revision") && !Object.hasOwn(effective, "management_enabled"), `${label}: no management revision`);
    assert.deepEqual([status, eligible], ["unknown", false], `${label}: unknown, not processing-eligible`);
  };
  let cases = 0;
  // A09/A10: a two-deployment display-only account, one record missing and
  // the other enabling, class-tampered or duplicated; both deployment
  // orders and both positions of the missing record.
  const present = {
    enable: key => [rec(key, true)],
    tampered: key => [{ ...rec(key, false), management_class: "eligible" }],
    duplicated: key => [rec(key, false), rec(key, false)],
  };
  for (const [row, kinds] of [["A09", ["enable"]], ["A10", ["tampered", "duplicated"]]]) for (const kind of kinds) {
    for (const keys of [["a-1", "a-2"], ["a-2", "a-1"]]) for (const missingKey of ["a-1", "a-2"]) {
      const other = missingKey === "a-1" ? "a-2" : "a-1";
      contradiction(`${row}: ${kind} ${keys} missing ${missingKey}`, accountOf("display_only", keys), present[kind](other));
      cases++;
    }
  }
  assert.equal(cases, 12, "A09/A10: four plus eight cases");
  // A11: a three-deployment eligible account, one record missing and two
  // disagreeing on value or revision; six deployment orders, both record
  // orders.
  const permutations = items => items.length < 2 ? [items] : items.flatMap((item, index) => permutations(items.filter((_, other) => other !== index)).map(rest => [item, ...rest]));
  let disagreements = 0;
  for (const [kind, records] of [["value", [rec("a-2", true), rec("a-3", false)]], ["revision", [rec("a-2", true, 3), rec("a-3", true, 4)]]]) {
    for (const keys of permutations(["a-1", "a-2", "a-3"])) for (const ordered of [records, [...records].reverse()]) {
      contradiction(`A11: ${kind} ${keys} ${ordered.map(item => item.legacy_key)}`, accountOf("eligible", keys), ordered);
      disagreements++;
    }
  }
  assert.equal(disagreements, 24, "A11: twenty-four cases");
  // A12: the controls.
  const pair = ["a-1", "a-2"];
  const controls = [
    ["display-only, all absent", "display_only", [], "unknown", "not_under_management"],
    ["display-only, partial disabled", "display_only", [rec("a-1", false)], "unknown", "not_under_management"],
    ["display-only, complete disabled", "display_only", [rec("a-1", false), rec("a-2", false)], "known", "not_under_management"],
    ["eligible, missing", "eligible", [rec("a-1", true)], "unknown", "unknown"],
    ["eligible, complete enabled", "eligible", [rec("a-1", true), rec("a-2", true)], "known", "managed"],
    ["eligible, complete disabled", "eligible", [rec("a-1", false), rec("a-2", false)], "known", "management_disabled"],
    ["display-only, complete enable", "display_only", [rec("a-1", true), rec("a-2", true)], "conflict", "unknown"],
  ];
  for (const [label, managementClass, records, evidence, status] of controls) {
    const result = outcome(accountOf(managementClass, pair), records);
    assert.deepEqual([result.effective.evidence_state, result.status], [evidence, status], `A12: ${label}`);
    assert.equal(Object.hasOwn(result.effective, "revision"), evidence === "known", `A12: ${label} revision only when known`);
    assert.equal(result.eligible, status === "managed", `A12: ${label} processing predicate`);
  }
}

// P5: predicates. Only the class decides whether management may be
// enabled; a display-only account is never managed or processing-eligible,
// whatever the evidence or the applied records say.
{
  for (const value of ["eligible"]) assert.equal(managementEnableAllowed(value), true);
  for (const value of ["display_only", "Eligible", "eligible ", "", null, undefined, true]) assert.equal(managementEnableAllowed(value), false, `P5: ${JSON.stringify(value)}`);
  const deployments = [{ platform: "alpha", legacy_key: "a-1" }];
  const records = {
    enabled: [{ platform: "alpha", legacy_key: "a-1", management_enabled: true, revision: 1, effective_at: "2026-11-17T00:00:00Z" }],
    disabled: [{ platform: "alpha", legacy_key: "a-1", management_enabled: false, revision: 1, effective_at: "2026-11-17T00:00:00Z" }],
    missing: [],
    tampered: [{ platform: "alpha", legacy_key: "a-1", management_enabled: true, revision: 1, effective_at: "2026-11-17T00:00:00Z", management_class: "eligible" }],
  };
  let combinations = 0;
  const statuses = new Map();
  for (const managementClass of ["eligible", "display_only", null]) for (const evidence of ["known", "unknown", "conflict", "stale"]) for (const [name, list] of Object.entries(records)) {
    const account = { deployments, management_class: managementClass, evidence_state: evidence };
    const effective = effectiveManagementState(account, list);
    const status = managementStatus(account, effective);
    const row = { evidence_state: evidence === "known" && effective.evidence_state === "conflict" ? "conflict" : evidence, management_status: status };
    combinations++;
    statuses.set(`${managementClass}/${evidence}/${name}`, status);
    if (managementClass !== "eligible") {
      assert.notEqual(status, MANAGEMENT_STATUS.MANAGED, `P5: ${managementClass}/${evidence}/${name} never managed`);
      assert.equal(processingEligible(row), false, `P5: ${managementClass}/${evidence}/${name} never processed`);
    }
    if (evidence !== "known") assert.equal(status, MANAGEMENT_STATUS.UNKNOWN, `P5: ${evidence} evidence reads unknown`);
  }
  assert.equal(combinations, 48);
  assert.deepEqual([statuses.get("eligible/known/enabled"), statuses.get("eligible/known/disabled"), statuses.get("eligible/known/missing"), statuses.get("eligible/known/tampered"),
    statuses.get("display_only/known/missing"), statuses.get("display_only/known/disabled"), statuses.get("display_only/known/enabled"), statuses.get("null/known/enabled")],
  ["managed", "management_disabled", "unknown", "unknown", "not_under_management", "not_under_management", "unknown", "unknown"], "P5: status table");
  assert.equal(processingEligible({ evidence_state: "known", management_status: "managed" }), true);
  assert.equal(processingEligible({ evidence_state: "stale", management_status: "managed" }), false);
}

// P6: no account-specific branch. The policy source names no platform,
// channel or account; it branches only on the class.
{
  const source = await readFile(POLICY, "utf8");
  for (const pattern of [/longbridge/i, /\bhk\b/i, /\bsg\b/i, /ibkr/i, /schwab/i, /binance/i, /firstrade/i]) {
    assert.ok(!pattern.test(source), `P6: policy source has no ${pattern} literal`);
  }
}

console.log("account mapping policy validation passed");
