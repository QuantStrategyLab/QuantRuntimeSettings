// D2 B2 GATES suite (core, DO side): every processing-admission entrance of
// the RuntimeInstances object, called directly, re-resolves management at
// commit time. Disabled, display-only and unprovisioned accounts are denied
// with no write; eligible managed accounts keep ordinary behavior.
// Synthetic fixtures only; the report carries row IDs, outcome codes, counts
// and the gate inventory, never fixture content.
import assert from "node:assert/strict";
import {
  FIXTURE_ACCOUNTS, INSTANCES, baselineStore, createStore, evidence, outbound, policyOf, provision, ref, setManagement,
} from "./helpers/account_management_harness.mjs";

const CONSOLE = new URL("../web/strategy-switch-console/", import.meta.url);
const { canonicalResearchTaskJson, riskProfileScopeId } = await import(new URL("application/worker/runtime_support.js", CONSOLE));
const { RISK_TIER_POLICY_BINDINGS } = await import(new URL("application/console_api/risk_tiers.js", CONSOLE));

const result = evidence("GATES");
const ok = (row, outcome, value) => { assert.ok(value, `${row}: ${outcome}`); result.record(row, outcome); };
const same = (row, outcome, actual, expected) => { assert.deepEqual(actual, expected, `${row}: ${outcome}`); result.record(row, outcome); };

const ENABLED = "ibkr/syn-acct-02";
const DISABLED = "ibkr/syn-acct-03";
const DISPLAY = FIXTURE_ACCOUNTS.find(([managementClass]) => managementClass === "display_only")[1][0];
const DENIALS = ["management_disabled", "management_not_under_management", "management_policy_unavailable", "management_status_unknown"];
const TS = "2026-01-02T00:00:00.000Z";
let keys = 0;
const uuid = () => `00000000-0000-4000-a000-${String(++keys).padStart(12, "0")}`;
const denied = (response, code) => response.status === 409 && (code ? response.body.error === code : DENIALS.includes(response.body.error));

// Gate inventory: every entrance and the DO method that enforces it at commit.
const inventory = [
  ["settings_strategy_parameter_draft", "account_settings_save(overrides)", "saveAccountSettings → requireManagementAdmission"],
  ["settings_risk_change", "account_settings_save(risk_change)", "saveAccountSettings → requireManagementAdmission"],
  ["risk_authority_set", "risk_profile_set", "setRiskProfileAuthority → requireRiskTargetAdmission"],
  ["risk_authority_replace", "risk_profile_replace", "replaceRiskProfileAuthority → requireRiskTargetAdmission per changed scope"],
  ["profile_approval", "account_settings_profile_application_approve", "approveAccountSettingsProfileApplication → requireManagementAdmission (before replay)"],
  ["profile_claim", "account_settings_profile_application_claim", "claimAccountSettingsProfileApplication → requireManagementAdmission (before replay)"],
  ["promotion_accept", "promotion_decide(accept)", "writeHumanDecision → requireManagementAdmission (before replay)"],
  ["paper_application_create", "application_create", "applicationCommand → requireManagementAdmission"],
  ["paper_application_claim", "application_claim", "applicationCommand → managementDenialFor (claimed:false)"],
  ["paper_application_result", "application_result(applied_paused)", "applicationCommand → managementDenialFor (uncertain/management_state_changed)"],
  ["default_sync", "instance_state:sync_defaults", "requireSyncDefaultsAdmission (multi-match picks no winner)"],
  ["management_control", "account_management_draft_save/apply", "account_management.js controlTarget"],
];

function riskBinding(text, store) {
  const [platform, key] = ref(text);
  const targetName = store.instance(platform, key).config.target_name;
  const [preference, policy] = Object.entries(RISK_TIER_POLICY_BINDINGS)[0];
  return { scope_id: riskProfileScopeId(platform, targetName), platform, target_name: targetName, no_order: true, execution_authority_granted: false,
    profile_selection: { risk_preference: preference, profile_id: policy.profile_id } };
}

function syncInputs(store, text) {
  const [platform, key] = ref(text);
  const config = store.instance(platform, key).config;
  return { platform, target_name: config.target_name, account_selector: config.account_selector, deployment_selector: config.deployment_selector,
    account_scope: config.account_scope, service_name: config.service_name, strategy_profile: "synthetic-strategy", execution_mode: "dry_run",
    plugin_mode: "none", option_overlay_mode: "disabled" };
}

// The entrances a direct DO caller can reach with only an account address.
const entrances = {
  settings_strategy_parameter_draft: (store, platform, key) => ({ action: "account_settings_save", actor: "synthetic-admin", platform, key,
    identity: store.identity(platform, key), expected_draft_revision: 0, overrides: { option_overlay_enabled: true } }),
  settings_risk_change: (store, platform, key) => ({ action: "account_settings_save", actor: "synthetic-admin", platform, key,
    identity: store.identity(platform, key), expected_risk_revision: 0, risk_change: "clear" }),
  risk_authority_set: (store, platform, key) => ({ action: "risk_profile_set", actor: "synthetic-admin", platform,
    target_name: store.instance(platform, key).config.target_name, expected_revision: 0, risk_change: "clear" }),
  risk_authority_replace: (store, platform, key) => ({ action: "risk_profile_replace", actor: "synthetic-admin", expected_revision: 0,
    bindings: [riskBinding(`${platform}/${key}`, store)] }),
  profile_approval: (store, platform, key) => ({ action: "account_settings_profile_application_approve", actor: "synthetic-admin", request_key: uuid(),
    platform, key, identity: store.identity(platform, key), expected_instance_revision: store.state().revision, expected_draft_revision: 0,
    old_profile: "synthetic-old", new_profile: "synthetic-new", current_profile: "synthetic-old", runtime_target_enabled: false }),
  default_sync: (store, platform, key) => ({ action: "sync_defaults", actor: "synthetic-sync", inputs: syncInputs(store, `${platform}/${key}`) }),
};

// --- B2-A09 / B2-A18: every direct entrance denies non-processing accounts --
{
  const store = await baselineStore();
  await setManagement(store, DISABLED, false);
  const unprovisioned = createStore();
  for (const [name, build] of Object.entries(entrances)) {
    for (const [label, target, text] of [["disabled", store, DISABLED], ["display_only", store, DISPLAY], ["unprovisioned", unprovisioned, ENABLED]]) {
      const before = target.dump();
      const response = await target.call(build(target, ...ref(text)));
      // The display-only fixture deployment has an incomplete settings
      // identity, so strict approval validation rejects it before the gate.
      if (name === "profile_approval" && label === "display_only") {
        same("B2-A09", "incomplete_identity_rejected_first", [response.status, response.body.error], [400, "account_settings_identity_required"]);
      } else {
        ok("B2-A09", `${name}_${label}_denied`, denied(response));
      }
      same("B2-A09", "denial_no_mutation", target.dump(), before);
    }
  }
  same("B2-A09", "display_only_code", (await store.call(entrances.settings_strategy_parameter_draft(store, ...ref(DISPLAY)))).body.error,
    "management_not_under_management");
  same("B2-A09", "disabled_code", (await store.call(entrances.settings_strategy_parameter_draft(store, ...ref(DISABLED)))).body.error, "management_disabled");
  // Positive controls: an eligible managed account keeps ordinary behavior.
  for (const name of ["settings_strategy_parameter_draft", "risk_authority_set", "risk_authority_replace", "default_sync"]) {
    const response = await store.call(entrances[name](store, ...ref(ENABLED)));
    same("B2-A18", `${name}_eligible_admitted`, response.status, 200);
  }
  // A declaration alone is an observation, not processing configuration;
  // it reaches its own validation rather than the management gate.
  const [platform, key] = ref(DISABLED);
  const declaration = await store.call({ action: "account_settings_save", actor: "synthetic-admin", platform, key, declaration: {} });
  ok("B2-A09", "declaration_not_management_gated", !DENIALS.includes(declaration.body.error));
  // A disabled account stays readable.
  same("B2-A09", "disabled_settings_readable", (await store.call({ action: "account_settings_read", actor: "synthetic-admin", platform, key })).status, 200);
  store.close();
  unprovisioned.close();
}

// --- B2-A18: legacy closure ----------------------------------------------------
{
  // A display-only target named like the legacy fixed-HK account fails the
  // generic guard on its class, not its name.
  const template = INSTANCES.find(item => `${item.platform}/${item.key}` === DISPLAY);
  const legacy = { ...template, key: "hk", config: { ...template.config, key: "hk", target_name: "syn-legacy-hk", account_selector: "SYN-LEGACY-HK",
    deployment_selector: "syn-legacy-hk", service_name: "syn-legacy-hk-service", account_scope: "SYN-SCOPE-LEGACY" } };
  const instances = [...INSTANCES, legacy];
  const store = createStore({ instances });
  assert.equal((await provision(store, policyOf([...FIXTURE_ACCOUNTS, ["display_only", ["longbridge/hk"]]], instances))).status, 200);
  for (const [managementClass, deployments] of FIXTURE_ACCOUNTS) if (managementClass === "eligible") await setManagement(store, deployments[0], true);
  for (const name of ["profile_approval", "settings_strategy_parameter_draft", "default_sync"]) {
    const before = store.dump();
    const response = await store.call(entrances[name](store, "longbridge", "hk"));
    same("B2-A18", `legacy_named_display_only_${name}_denied`, [response.status, response.body.error], [409, "management_not_under_management"]);
    same("B2-A18", "legacy_denial_no_mutation", store.dump(), before);
  }
  store.close();
}
{
  // Preexisting approved/claimed records cannot renew admission once the
  // account is disabled: replay and claim both deny before any write.
  const store = await baselineStore();
  const [platform, key] = ref(DISABLED);
  const approval = entrances.profile_approval(store, platform, key);
  const insert = (requestKey, status) => store.db.prepare(`INSERT INTO account_setting_profile_application
    (request_key, platform, account_key, identity_json, instance_revision, draft_revision, old_profile, new_profile, approved_by, approved_at, status,
     workflow_run_id, workflow_run_attempt, claimed_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(requestKey, platform, key, canonicalResearchTaskJson(approval.identity), approval.expected_instance_revision, approval.old_profile,
      approval.new_profile, approval.actor, TS, status, status === "claimed" ? "101" : null, status === "claimed" ? "1" : null, status === "claimed" ? TS : null);
  insert(approval.request_key, "approved");
  const claimedKey = uuid();
  insert(claimedKey, "claimed");
  await setManagement(store, DISABLED, false);
  const claim = requestKey => ({ action: "account_settings_profile_application_claim", actor: "synthetic-workflow", request_key: requestKey,
    workflow_run_id: "101", workflow_run_attempt: "1", identity: approval.identity, expected_instance_revision: approval.expected_instance_revision,
    expected_draft_revision: 0, old_profile: approval.old_profile, new_profile: approval.new_profile, current_profile: approval.old_profile,
    runtime_target_enabled: false });
  for (const [outcome, command] of [["approval_replay_denied", approval], ["claim_denied", claim(approval.request_key)], ["claim_replay_denied", claim(claimedKey)]]) {
    const before = store.dump();
    const response = await store.call(command);
    same("B2-A18", outcome, [response.status, response.body.error], [409, "management_disabled"]);
    same("B2-A18", "replay_denial_no_mutation", store.dump(), before);
  }
  // History stays readable.
  same("B2-A18", "approval_history_readable", (await store.call({ action: "account_settings_profile_application_lookup", actor: "synthetic-admin",
    request_key: approval.request_key })).status, 200);
  store.close();
}
{
  // Default sync: several matching deployments pick no winner.
  const [platform, key] = ref(ENABLED);
  const template = INSTANCES.find(item => item.platform === platform && item.key === key);
  const store = createStore({ instances: [...INSTANCES, { ...template, key: "syn-dup", config: { ...template.config, key: "syn-dup" } }] });
  const before = store.dump();
  const response = await store.call(entrances.default_sync(store, platform, key));
  same("B2-A18", "multi_match_sync_no_winner", [response.status, response.body.error], [409, "management_sync_target_ambiguous"]);
  same("B2-A18", "ambiguous_sync_no_mutation", store.dump(), before);
  store.close();
}

// --- B2-A21: admission races decided at commit --------------------------------
{
  // Bulk risk replacement validates every changed scope before any write.
  const store = await baselineStore();
  await setManagement(store, DISABLED, false);
  const before = store.dump();
  const mixed = await store.call({ action: "risk_profile_replace", actor: "synthetic-admin", expected_revision: 0,
    bindings: [riskBinding(ENABLED, store), riskBinding(DISABLED, store)] });
  same("B2-A21", "bulk_risk_one_denial_rejects_all", [mixed.status, mixed.body.error], [409, "management_disabled"]);
  same("B2-A21", "bulk_risk_no_partial_write", store.dump(), before);
  same("B2-A21", "bulk_risk_all_admitted_commits", (await store.call({ action: "risk_profile_replace", actor: "synthetic-admin", expected_revision: 0,
    bindings: [riskBinding(ENABLED, store)] })).status, 200);
  store.close();
}
{
  // Paper application claim/result against the commit-time management state.
  const store = await baselineStore();
  const insert = (applicationId, text, status) => {
    const [platform, key] = ref(text);
    const config = store.instance(platform, key).config;
    store.db.prepare(`INSERT INTO research_promotion_applications (application_id, ticket_id, status, dispatch_state, claim_token, platform_id, account_key,
      account_scope, account_selector, service_name, broker_environment, expected_revision, expected_strategy_profile, strategy_profile, candidate_id,
      config_sha256, source_commit, approved_ues_revision, desired_state, workflow_run_id, workflow_run_attempt, reason_code, readback_json, created_at, updated_at)
      VALUES (?, ?, ?, 'sent', 'synthetic-claim', ?, ?, ?, ?, ?, ?, ?, '', 'synthetic-strategy', 'synthetic-candidate', ?, 'synthetic-commit', 'r1', 'paused',
      ?, ?, '', NULL, ?, ?)`)
      .run(applicationId, `ticket-${applicationId}`, status, platform, key, config.account_scope || "", config.account_selector || "", config.service_name || "",
        config.broker_environment || "", store.state().revision, "0".repeat(64), status === "claimed" ? "201" : null, status === "claimed" ? "1" : null, TS, TS);
  };
  const claim = applicationId => store.call({ action: "application_claim", actor: "synthetic-workflow", application_id: applicationId,
    claim_token: "synthetic-claim", workflow_run_id: "201", workflow_run_attempt: "1", updated_at: TS });
  const resultCommand = applicationId => ({ action: "application_result", actor: "synthetic-workflow", application_id: applicationId,
    claim_token: "synthetic-claim", workflow_run_id: "201", workflow_run_attempt: "1", status: "applied_paused", reason_code: "", readback: { synthetic: true },
    updated_at: TS });
  insert("app-admitted", ENABLED, "approved");
  insert("app-after-disable", DISABLED, "approved");
  insert("app-result", DISABLED, "claimed");
  const admitted = await claim("app-admitted");
  same("B2-A21", "eligible_claim_admitted", admitted.body.claimed, true);
  same("B2-A21", "old_claim_no_fresh_authorization", (await claim("app-admitted")).body.claimed, false);
  await setManagement(store, DISABLED, false);
  const instancesBefore = store.dump().instance_state;
  const lateClaim = await claim("app-after-disable");
  same("B2-A21", "claim_after_disable_denied", [lateClaim.body.claimed, lateClaim.body.reason], [false, "management_disabled"]);
  same("B2-A21", "denied_claim_row_unchanged", store.rows("research_promotion_applications").find(row => row.application_id === "app-after-disable").status, "approved");
  const lateResult = await store.call(resultCommand("app-result"));
  same("B2-A21", "result_after_disable_uncertain", [lateResult.body.application?.status, lateResult.body.application?.reason_code],
    ["uncertain", "management_state_changed"]);
  ok("B2-A21", "result_retained_as_evidence", store.rows("research_promotion_applications").find(row => row.application_id === "app-result").readback_json);
  same("B2-A21", "no_current_strategy_install", store.dump().instance_state, instancesBefore);
  await setManagement(store, ENABLED, false);
  same("B2-A21", "earlier_admission_not_revoked", store.rows("research_promotion_applications").find(row => row.application_id === "app-admitted").status, "claimed");
  store.close();
}

assert.equal(outbound.count, 0, "zero outbound calls");
const report = JSON.stringify({ ...JSON.parse(result.report()), gate_inventory: inventory.map(([entrance, action, enforcement]) => ({ entrance, action, enforcement })) }, null, 2);
console.log(report);
if (process.env.QRT_EVIDENCE_OUT) await (await import("node:fs/promises")).writeFile(process.env.QRT_EVIDENCE_OUT, `${report}\n`);
console.log("account management gates validation passed");
