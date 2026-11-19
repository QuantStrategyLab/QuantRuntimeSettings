// D2 B2 GATES suite (core, DO side): every processing-admission entrance of
// the RuntimeInstances object, called directly, re-resolves management at
// commit time. Disabled, display-only and unprovisioned accounts are denied
// with no write; eligible managed accounts keep ordinary behavior.
// Synthetic fixtures only; the report carries row IDs, outcome codes, counts
// and the gate inventory, never fixture content.
import assert from "node:assert/strict";
import {
  FIXTURE_ACCOUNTS, INSTANCES, POLICY_REVISION, baselineStore, createStore, evidence, management, outbound, policyOf, provision, ref, setManagement,
} from "./helpers/account_management_harness.mjs";

const CONSOLE = new URL("../web/strategy-switch-console/", import.meta.url);
const { canonicalResearchTaskJson, riskProfileScopeId } = await import(new URL("application/worker/runtime_support.js", CONSOLE));
const { RISK_TIER_POLICY_BINDINGS } = await import(new URL("application/console_api/risk_tiers.js", CONSOLE));

const result = evidence("GATES");
const ok = (row, outcome, value) => { assert.ok(value, `${row}: ${outcome}`); result.record(row, outcome); };
const same = (row, outcome, actual, expected) => { assert.deepEqual(actual, expected, `${row}: ${outcome}`); result.record(row, outcome); };

const ENABLED = "ibkr/syn-acct-02";
const DISABLED = "ibkr/syn-acct-03";
const ENABLED2 = "ibkr/syn-acct-04";
const ENABLED3 = "schwab/syn-acct-05";
const ENABLED4 = "longbridge/syn-acct-06";
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
  ["strategy_switch", "POST /api/switch → account_management_admission_check", "dispatchSwitch → requireManagementAdmission (before the activation interlock and any dispatch)"],
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
  const insert = (applicationId, text, status, unbound = false) => {
    const [platform, key] = ref(text);
    const config = store.instance(platform, key).config;
    store.db.prepare(`INSERT INTO research_promotion_applications (application_id, ticket_id, status, dispatch_state, claim_token, platform_id, account_key,
      account_scope, account_selector, service_name, broker_environment, expected_revision, expected_strategy_profile, strategy_profile, candidate_id,
      config_sha256, source_commit, approved_ues_revision, desired_state, workflow_run_id, workflow_run_attempt, reason_code, readback_json, created_at, updated_at, management_binding_json)
      VALUES (?, ?, ?, 'sent', 'synthetic-claim', ?, ?, ?, ?, ?, ?, ?, '', 'synthetic-strategy', 'synthetic-candidate', ?, 'synthetic-commit', 'r1', 'paused',
      ?, ?, '', NULL, ?, ?, ?)`)
      .run(applicationId, `ticket-${applicationId}`, status, platform, key, config.account_scope || "", config.account_selector || "", config.service_name || "",
        config.broker_environment || "", store.state().revision, "0".repeat(64), status === "claimed" ? "201" : null, status === "claimed" ? "1" : null, TS, TS,
        unbound ? null : management.managementBinding(store.resolve(platform, key)));
  };
  const claim = applicationId => store.call({ action: "application_claim", actor: "synthetic-workflow", application_id: applicationId,
    claim_token: "synthetic-claim", workflow_run_id: "201", workflow_run_attempt: "1", updated_at: TS });
  const resultCommand = applicationId => ({ action: "application_result", actor: "synthetic-workflow", application_id: applicationId,
    claim_token: "synthetic-claim", workflow_run_id: "201", workflow_run_attempt: "1", status: "applied_paused", reason_code: "", readback: { synthetic: true },
    updated_at: TS });
  insert("app-admitted", ENABLED, "approved");
  insert("app-after-disable", DISABLED, "approved");
  insert("app-result", DISABLED, "claimed");
  insert("app-bounce", ENABLED2, "claimed");
  insert("app-unbound", ENABLED3, "claimed", true);
  insert("app-fresh", ENABLED4, "claimed");
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
  await setManagement(store, ENABLED2, false);
  await setManagement(store, ENABLED2, true);
  const bounced = await store.call(resultCommand("app-bounce"));
  same("B2-A21", "result_after_disable_then_reenable_uncertain", [bounced.body.application?.status, bounced.body.application?.reason_code],
    ["uncertain", "management_state_changed"]);
  const unbound = await store.call(resultCommand("app-unbound"));
  same("B2-A21", "result_without_verifiable_binding_uncertain", [unbound.body.application?.status, unbound.body.application?.reason_code],
    ["uncertain", "management_state_changed"]);
  same("B2-A21", "drifted_results_install_nothing", store.dump().instance_state, instancesBefore);
  const fresh = await store.call(resultCommand("app-fresh"));
  same("B2-A21", "result_still_admitted_applies_positive_control", fresh.body.application?.status, "applied_paused");
  await setManagement(store, ENABLED, false);
  same("B2-A21", "earlier_admission_not_revoked", store.rows("research_promotion_applications").find(row => row.application_id === "app-admitted").status, "claimed");
  store.close();
}

// B2-A21 / inventory 8: paper application create after disable (the negative the
// core deferred). A full accepted-promotion fixture: eligible material plus a
// terminal accept decision bound to the selected account and the instance revision.
{
  const store = await baselineStore();
  const revision = store.state().revision;
  const accept = (subject, text) => {
    const [platform, key] = ref(text);
    store.db.prepare("INSERT INTO human_decision_material (kind, subject_id, source_id, material_key, summary_json, eligible, expires_at_ms, legacy_state, legacy_block, updated_at) VALUES ('promotion', ?, 'synthetic-source', ?, '{}', 1, NULL, 'none', '', ?)")
      .run(subject, `mk-${subject}`, TS);
    store.db.prepare("INSERT INTO human_decision_record (request_key, kind, subject_id, material_key, action, actor, decided_at, target_json, payload_json) VALUES (?, 'promotion', ?, ?, 'accept', 'synthetic-admin', ?, '{}', ?)")
      .run(`rk-${subject}`, subject, `mk-${subject}`, TS, JSON.stringify({ selected_account: { platform, key }, account_revision: revision }));
  };
  accept("ticket-enabled", ENABLED);
  accept("ticket-disabled", DISABLED);
  const create = (subject, text) => {
    const [platform, key] = ref(text);
    return store.call({ action: "application_create", actor: "synthetic-admin", application_id: `app-${subject}`, ticket_id: subject, promotion_material_key: `mk-${subject}`,
      claim_token: "synthetic-claim", platform_id: platform, account_key: key, account_scope: store.instance(platform, key).config.account_scope,
      account_selector: store.instance(platform, key).config.account_selector, service_name: store.instance(platform, key).config.service_name,
      broker_environment: "live", expected_revision: revision, expected_strategy_profile: "synthetic-strategy", strategy_profile: "synthetic-strategy",
      candidate_id: "synthetic-candidate", config_sha256: "0".repeat(64), source_commit: "synthetic", approved_ues_revision: "synthetic", created_at: TS });
  };
  const created = await create("ticket-enabled", ENABLED);
  same("B2-A21", "application_create_eligible_positive_control", [created.status, created.body.created, created.body.error], [200, true, undefined]);
  await setManagement(store, DISABLED, false);
  const before = store.dump().research_promotion_applications;
  const refused = await create("ticket-disabled", DISABLED);
  same("B2-A21", "application_create_after_disable_denied", [refused.status, refused.body.error], [409, "management_disabled"]);
  same("B2-A21", "application_create_denied_zero_writes", store.dump().research_promotion_applications, before);
  store.close();
}

// HTTP level (Q6/Q7, rows A09/A18/A21/A22): the real Worker over the real
// object. The namespace stub forwards to the SQLite-backed object and records
// each command action, so "denied before the object" is observed, not assumed.
{
  const { default: worker, __test } = await import(new URL("worker.js", CONSOLE));
  const { managementCommand, PROVISIONER: PROVISIONER_ACTOR } = await import("./helpers/account_management_harness.mjs");
  const store = await baselineStore();
  const actions = [];
  const base = {
    SESSION_SECRET: "synthetic-only-session-key", STRATEGY_SWITCH_ADMIN_LOGINS: "fixture-admin", ALLOWED_GITHUB_LOGINS: "fixture-reader",
    STRATEGY_SWITCH_SYNC_TOKEN: "synthetic-sync-token", RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-dispatch-token",
    STRATEGY_SWITCH_STRATEGY_PROFILES_JSON: JSON.stringify([{ profile: "synthetic-strategy", label: "Synthetic", domain: "us_equity", allowed_execution_modes: ["dry_run"], runtime_enabled: false }]),
  };
  const namespace = { idFromName: name => name, get: () => ({ fetch: async (url, init) => {
    let action = null;
    try { action = JSON.parse(init?.body || "null")?.action ?? null; } catch { action = null; }
    actions.push(action || `${init?.method || "GET"} ${new URL(String(url)).pathname}`);
    return store.object.fetch(new Request(url, init));
  } }) };
  const env = { ...base, STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace };
  const adminCookie = `qsl_switch_session=${await __test.makeSession("fixture-admin", [], base)}`;
  const readerCookie = `qsl_switch_session=${await __test.makeSession("fixture-reader", [], base)}`;
  const call = async (path, { method = "POST", body, cookie = adminCookie, origin = "https://console.example", headers = {}, bindings = env } = {}) => {
    const response = await worker.fetch(new Request(`https://console.example${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}),
      "Content-Type": "application/json", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), bindings);
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
    return { status: response.status, body: payload, text, cache: response.headers.get("Cache-Control") };
  };
  const wire = (text, extra = {}) => {
    const [platform, key] = ref(text);
    const command = managementCommand(store, "account_management_draft_save", platform, key);
    const { action, actor, ...fields } = command;
    return { ...fields, ...extra };
  };
  // The settings read an advisory request makes first may import the legacy risk
  // registry once (an existing initialization on that read, not a gated write);
  // it is the only table left out of the "nothing was written" comparison.
  const before = () => { const { risk_profile_authority, ...rest } = store.dump(); return JSON.stringify(rest); };

  // Draft save through POST /api/account-settings (management_draft group).
  const group = { management_draft: { management_enabled: false } };
  const noIdentityFields = body => { const { management_enabled, ...rest } = body; return rest; };
  const saveBody = (text, extra = {}) => ({ ...noIdentityFields(wire(text)), ...group, ...extra });
  same("B2-A22", "save_unauthenticated_401", (await call("/api/account-settings", { cookie: "", body: saveBody(ENABLED) })).status, 401);
  same("B2-A22", "save_non_admin_403", (await call("/api/account-settings", { cookie: readerCookie, body: saveBody(ENABLED) })).status, 403);
  same("B2-A22", "save_cross_origin_403", (await call("/api/account-settings", { origin: "https://untrusted.example", body: saveBody(ENABLED) })).status, 403);
  let snapshot = before();
  for (const [label, body] of [
    ["mixed_overrides_group", saveBody(ENABLED, { overrides: { income_layer_enabled: false } })],
    ["mixed_declaration_group", saveBody(ENABLED, { declaration: { environment: "live", account_type: "cash" } })],
    ["mixed_risk_group", saveBody(ENABLED, { risk_preference: null, expected_risk_revision: 0 })],
    ["non_boolean_value", saveBody(ENABLED, { management_draft: { management_enabled: "false" } })],
    ["extra_group_field", saveBody(ENABLED, { management_draft: { management_enabled: false, status: "managed" } })],
    ["client_supplied_class", saveBody(ENABLED, { management_class: "eligible" })],
    ["client_supplied_siblings", saveBody(ENABLED, { siblings: [] })],
    ["missing_policy_revision", (() => { const { expected_policy_revision, ...rest } = saveBody(ENABLED); return rest; })()],
    ["zero_policy_revision", saveBody(ENABLED, { expected_policy_revision: 0 })],
    ["bad_request_key", saveBody(ENABLED, { request_key: "not-a-uuid" })],
  ]) {
    const response = await call("/api/account-settings", { body });
    same("B2-A22", `save_${label}_400`, [response.status, response.body.error], [400, "management_request_invalid"]);
  }
  same("B2-A22", "save_rejections_write_nothing", before(), snapshot);
  actions.length = 0;
  const saved = await call("/api/account-settings", { body: saveBody(ENABLED) });
  same("B2-A22", "save_draft_200", [saved.status, saved.body.outcome], [200, "draft_saved"]);
  ok("B2-A22", "save_forwards_one_command", actions.filter(action => action === "account_management_draft_save").length === 1);
  const stale = await call("/api/account-settings", { body: saveBody(ENABLED, { request_key: uuid(), expected_instance_revision: store.state().revision + 1 }) });
  same("B2-A22", "save_stale_instance_409", [stale.status, stale.body.error], [409, "management_instance_revision_conflict"]);

  // Apply route.
  const applyBody = (text, extra = {}) => {
    const [platform, key] = ref(text);
    const command = managementCommand(store, "account_management_apply", platform, key);
    const { action, actor, ...fields } = command;
    return { ...fields, ...extra };
  };
  same("B2-A22", "apply_unauthenticated_401", (await call("/api/account-settings/management/apply", { cookie: "", body: applyBody(ENABLED) })).status, 401);
  same("B2-A22", "apply_non_admin_403", (await call("/api/account-settings/management/apply", { cookie: readerCookie, body: applyBody(ENABLED) })).status, 403);
  same("B2-A22", "apply_cross_origin_403", (await call("/api/account-settings/management/apply", { origin: "", body: applyBody(ENABLED) })).status, 403);
  same("B2-A22", "apply_get_405", (await call("/api/account-settings/management/apply", { method: "GET" })).status, 405);
  snapshot = before();
  for (const [label, extra] of [["identity_conflict_ack", { acknowledge_identity_conflict: true }], ["boolean_field", { management_enabled: true }], ["overrides", { overrides: {} }]]) {
    const response = await call("/api/account-settings/management/apply", { body: applyBody(ENABLED, extra) });
    same("B2-A22", `apply_${label}_400`, [response.status, response.body.error], [400, "management_request_invalid"]);
  }
  same("B2-A22", "apply_rejections_write_nothing", before(), snapshot);
  const exact = applyBody(ENABLED);
  const applied = await call("/api/account-settings/management/apply", { body: exact });
  same("B2-A22", "apply_200", [applied.status, applied.body.outcome], [200, "applied"]);
  const replay = await call("/api/account-settings/management/apply", { body: exact });
  same("B2-A22", "apply_replay_original_receipt", [replay.status, replay.body.replayed, replay.body.management_revision], [200, true, applied.body.management_revision]);
  const staleApply = await call("/api/account-settings/management/apply", { body: { ...exact, request_key: uuid() } });
  same("B2-A22", "apply_stale_applied_revision_409", staleApply.status, 409);
  const read = (await store.read()).body;
  ok("B2-A22", "export_has_no_draft_authority", !JSON.stringify(read).includes("draft"));
  await setManagement(store, ENABLED, true);

  // Policy provisioning route: dormant, dedicated secret, no fallback, no echo.
  const policyBody = (revision, expected) => ({ expected_policy_revision: expected, policy: policyOf(FIXTURE_ACCOUNTS, INSTANCES, revision) });
  const current = (await store.read()).body.policy_revision;
  const unbound = await call("/api/internal/account-mapping-policy", { cookie: "", headers: { Authorization: "Bearer synthetic-sync-token" }, body: policyBody(current + 1, current) });
  same("B2-A22", "provision_missing_binding_denied", [unbound.status, unbound.body.error], [503, "account_mapping_policy_provisioning_unavailable"]);
  const bound = { ...env, ACCOUNT_MAPPING_POLICY_PROVISION_TOKEN: "synthetic-provision-token" };
  snapshot = before();
  for (const [label, init] of [
    ["no_authorization", { cookie: "" }],
    ["wrong_token", { cookie: "", headers: { Authorization: "Bearer synthetic-wrong" } }],
    ["admin_session_only", { cookie: adminCookie }],
    ["producer_sync_token", { cookie: "", headers: { Authorization: "Bearer synthetic-sync-token" } }],
    ["dispatch_token", { cookie: "", headers: { Authorization: "Bearer synthetic-dispatch-token" } }],
  ]) {
    const response = await call("/api/internal/account-mapping-policy", { ...init, bindings: bound, body: policyBody(current + 1, current) });
    same("B2-A16", `provision_${label}_401`, [response.status, response.body.error], [401, "account_mapping_policy_unauthorized"]);
  }
  same("B2-A16", "provision_unauthenticated_writes_nothing", before(), snapshot);
  const auth = { cookie: "", headers: { Authorization: "Bearer synthetic-provision-token" }, bindings: bound };
  same("B2-A22", "provision_get_405", (await call("/api/internal/account-mapping-policy", { ...auth, method: "GET" })).status, 405);
  same("B2-A22", "provision_extra_field_400", (await call("/api/internal/account-mapping-policy", { ...auth, body: { ...policyBody(current + 1, current), actor: "x" } })).status, 400);
  const logs = [];
  const originals = Object.fromEntries(["log", "error", "warn", "info", "debug"].map(name => [name, console[name]]));
  for (const name of Object.keys(originals)) console[name] = (...args) => { logs.push(args.map(String).join(" ")); };
  let provisioned, same_content, lower, content;
  try {
    provisioned = await call("/api/internal/account-mapping-policy", { ...auth, body: policyBody(current + 1, current) });
    same_content = await call("/api/internal/account-mapping-policy", { ...auth, body: policyBody(current + 1, current + 1) });
    lower = await call("/api/internal/account-mapping-policy", { ...auth, body: policyBody(current, current + 1) });
    const changed = policyOf(FIXTURE_ACCOUNTS.slice(0, -1), INSTANCES, current + 1);
    content = await call("/api/internal/account-mapping-policy", { ...auth, body: { expected_policy_revision: current + 1, policy: changed } });
  } finally { for (const [name, fn] of Object.entries(originals)) console[name] = fn; }
  same("B2-A16", "provision_higher_revision_commits", [provisioned.status, provisioned.body.replaced, provisioned.body.policy_revision], [200, true, current + 1]);
  same("B2-A16", "provision_same_content_noop", [same_content.status, same_content.body.replaced], [200, false]);
  same("B2-A16", "provision_lower_revision_conflict", [lower.status, lower.body.error], [409, "management_policy_revision_conflict"]);
  same("B2-A16", "provision_content_conflict", [content.status, content.body.error], [409, "management_policy_content_conflict"]);
  ok("B2-A16", "provision_no_token_or_payload_in_response", ![provisioned, same_content, lower, content].some(response => /synthetic-provision-token|syn-acct|identity/.test(response.text)));
  ok("B2-A16", "provision_nothing_logged", logs.every(line => !/synthetic-provision-token|syn-acct/.test(line)));
  ok("B2-A16", "provision_response_not_cacheable", [provisioned, lower].every(response => response.cache === "no-store"));

  // Q7 HTTP preflight: a denied entrance stops before its object command.
  await setManagement(store, DISABLED, false);
  const draftBody = text => {
    const [platform, key] = ref(text);
    return { platform, key, identity: store.identity(platform, key), expected_draft_revision: 0, overrides: { income_layer_enabled: false } };
  };
  actions.length = 0;
  snapshot = before();
  const settingsDenied = await call("/api/account-settings", { body: draftBody(DISABLED) });
  same("B2-A09", "http_settings_save_denied_409", [settingsDenied.status, settingsDenied.body.error], [409, "management_disabled"]);
  ok("B2-A09", "http_settings_save_stops_before_save_command", !actions.includes("account_settings_save"));
  const displayDenied = await call("/api/account-settings", { body: draftBody(DISPLAY) });
  same("B2-A09", "http_settings_save_display_only_denied", [displayDenied.status, displayDenied.body.error], [409, "management_not_under_management"]);
  same("B2-A09", "http_denials_write_nothing", before(), snapshot);
  actions.length = 0;
  const riskDenied = await call("/api/risk-profiles", { body: { expected_revision: 0, bindings: [(() => { const [platform, key] = ref(DISABLED); return { platform, target_name: store.instance(platform, key).config.target_name, risk_preference: Object.keys(RISK_TIER_POLICY_BINDINGS)[0] }; })()] } });
  ok("B2-A21", "http_risk_replace_denied_409", riskDenied.status === 409 && DENIALS.includes(riskDenied.body.error));
  ok("B2-A21", "http_risk_replace_stops_before_replace_command", !actions.includes("risk_profile_replace"));
  const approveDenied = await call("/api/account-settings/profile-application/approve", { body: { platform: ref(DISABLED)[0], key: ref(DISABLED)[1], request_key: uuid(), identity: store.identity(...ref(DISABLED)),
    expected_instance_revision: store.state().revision, expected_draft_revision: 0, old_profile: "synthetic-old", new_profile: "synthetic-strategy" } });
  ok("B2-A18", "http_approval_denied_409", approveDenied.status === 409 && DENIALS.includes(approveDenied.body.error));
  ok("B2-A18", "http_approval_stops_before_lookup", !actions.includes("account_settings_profile_application_lookup") && !actions.includes("account_settings_profile_application_approve"));

  // Default sync: denied before any write; eligible positive control keeps ordinary function.
  const syncBody = text => syncInputs(store, text);
  const syncHeaders = { Authorization: "Bearer synthetic-sync-token" };
  actions.length = 0;
  snapshot = before();
  const syncDenied = await call("/api/internal/sync-account-default", { cookie: "", headers: syncHeaders, body: syncBody(DISABLED) });
  same("B2-A18", "http_default_sync_disabled_409", [syncDenied.status, syncDenied.body.ok, syncDenied.body.account_options_sync?.reason], [409, false, "management_disabled"]);
  same("B2-A18", "http_default_sync_denied_zero_writes", before(), snapshot);
  const syncDisplay = await call("/api/internal/sync-account-default", { cookie: "", headers: syncHeaders, body: syncBody(DISPLAY) });
  same("B2-A18", "http_default_sync_display_only_409", [syncDisplay.status, syncDisplay.body.account_options_sync?.reason], [409, "management_not_under_management"]);
  // Without the authority object there is no KV-only write path and no continuity registration.
  const kvWrites = [];
  const spyKv = { async get() { return null; }, async put(...args) { kvWrites.push("put"); }, async delete() { kvWrites.push("delete"); }, async list() { return { keys: [] }; } };
  const [syncPlatform, syncKey] = ref(ENABLED);
  const noObject = { ...base, STRATEGY_SWITCH_CONFIG: spyKv, STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ [syncPlatform]: [store.instance(syncPlatform, syncKey).config] }) };
  const noDo = await call("/api/internal/sync-account-default", { cookie: "", headers: syncHeaders, body: syncBody(ENABLED), bindings: noObject });
  same("B2-A18", "http_default_sync_without_object_fails_closed", [noDo.status, noDo.body.account_options_sync?.synced, noDo.body.account_options_sync?.reason], [409, false, "management_authority_unavailable"]);
  same("B2-A18", "http_default_sync_without_object_no_kv_write", kvWrites, []);
  const syncOk = await call("/api/internal/sync-account-default", { cookie: "", headers: syncHeaders, body: syncBody(ENABLED) });
  same("B2-A18", "http_default_sync_eligible_positive_control", [syncOk.status, syncOk.body.ok, syncOk.body.account_options_sync?.synced], [200, true, true]);
  // The preflight helper every HTTP entrance shares (promotion decisions, paper
  // application create and profile claim use it as the approval route does).
  {
    const { managementPreflight, changedRiskDeployments, riskTargetDeployment } = await import(new URL("application/runtime_instances/management_preflight.js", CONSOLE));
    const probe = async text => managementPreflight(env, [{ platform: ref(text)[0], key: ref(text)[1] }]);
    same("B2-A21", "preflight_eligible_admitted", await probe(ENABLED), null);
    same("B2-A21", "preflight_disabled_denied", (await probe(DISABLED))?.error, "management_disabled");
    same("B2-A09", "preflight_display_only_denied_generic", (await probe(DISPLAY))?.error, "management_not_under_management");
    same("B2-A09", "preflight_unlisted_deployment_unknown", (await managementPreflight(env, [{ platform: "ibkr", key: "syn-not-listed" }]))?.error, "management_status_unknown");
    same("B2-A09", "preflight_unresolved_target_unknown", (await managementPreflight(env, [{ platform: "ibkr", key: null }]))?.error, "management_status_unknown");
    same("B2-A22", "preflight_unbound_object_leaves_decision_to_object", await managementPreflight(base, [{ platform: ref(DISABLED)[0], key: ref(DISABLED)[1] }]), null);
    const options = Object.fromEntries([...new Set(INSTANCES.map(item => item.platform))].map(platform => [platform, INSTANCES.filter(item => item.platform === platform).map(item => item.config)]));
    const kept = { scope_id: "a", platform: "ibkr", target_name: store.instance(...ref(ENABLED)).config.target_name };
    const changed = { scope_id: "b", platform: "ibkr", target_name: store.instance(...ref(DISABLED)).config.target_name };
    const same_json = value => JSON.stringify(value);
    same("B2-A21", "risk_preflight_unchanged_scopes_not_admitted", changedRiskDeployments([kept, changed], [kept, changed], options, same_json), []);
    same("B2-A21", "risk_preflight_every_changed_scope_listed", changedRiskDeployments([kept], [kept, changed], options, same_json), [{ platform: "ibkr", key: ref(DISABLED)[1] }]);
    same("B2-A21", "risk_preflight_removed_scope_listed", changedRiskDeployments([kept, changed], [kept], options, same_json), [{ platform: "ibkr", key: ref(DISABLED)[1] }]);
    same("B2-A09", "risk_preflight_target_naming_none_is_unknown", riskTargetDeployment(options, "ibkr", "syn-none"), { platform: "ibkr", key: null });
  }
  store.close();
}

// B2-A01 / A09 (gate inventory): the strategy-switch entrance asks for a positive
// current local management admission first. The independent activation interlock
// stays off: every case here ends before any workflow dispatch.
{
  const { default: worker, __test } = await import(new URL("worker.js", CONSOLE));
  const unprovisioned = createStore();
  const store = await baselineStore();
  const base = {
    SESSION_SECRET: "synthetic-only-session-key", STRATEGY_SWITCH_ADMIN_LOGINS: "fixture-admin", RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-dispatch-token",
    STRATEGY_SWITCH_STRATEGY_PROFILES_JSON: JSON.stringify([{ profile: "synthetic-strategy", label: "Synthetic", domain: "us_equity", allowed_execution_modes: ["dry_run"], runtime_enabled: false }]),
  };
  const namespaceOf = target => ({ idFromName: name => name, get: () => ({ fetch: (url, init) => target.object.fetch(new Request(url, init)) }) });
  const cookie = `qsl_switch_session=${await __test.makeSession("fixture-admin", [], base)}`;
  const attempt = async (target, text) => {
    const [platform, key] = ref(text);
    const config = target.instance(platform, key).config;
    const before = outbound.count;
    const response = await worker.fetch(new Request("https://console.example/api/switch", { method: "POST", headers: { Cookie: cookie, Origin: "https://console.example", "Content-Type": "application/json" },
      body: JSON.stringify({ platform, target_name: config.target_name, account_selector: config.account_selector, deployment_selector: config.deployment_selector,
        account_scope: config.account_scope, service_name: config.service_name, strategy_profile: "synthetic-strategy", execution_mode: "dry_run",
        variable_scope: "repository", plugin_mode: "none", option_overlay_mode: "current", cash_only_execution_mode: "current", apply: true,
        trigger_platform_sync: true, confirm_apply: "APPLY_AND_SYNC" }) }), { ...base, STRATEGY_SWITCH_RUNTIME_INSTANCES: namespaceOf(target) });
    const body = await response.json();
    same("B2-A21", "switch_zero_external_calls", outbound.count, before, text);
    return { status: response.status, error: body.error, dispatched: body.workflow_dispatched };
  };
  await setManagement(store, DISABLED, false);
  same("B2-A21", "switch_disabled_typed_denial", await attempt(store, DISABLED), { status: 409, error: "management_disabled", dispatched: false });
  const displayOnly = FIXTURE_ACCOUNTS.map(([managementClass, deployments]) => [deployments.includes(ENABLED2) ? "display_only" : managementClass, deployments]);
  assert.equal((await provision(store, policyOf(displayOnly, INSTANCES, POLICY_REVISION + 1), POLICY_REVISION)).status, 200);
  same("B2-A21", "switch_display_only_typed_denial", await attempt(store, ENABLED2), { status: 409, error: "management_not_under_management", dispatched: false });
  same("B2-A21", "switch_unknown_typed_denial", (await attempt(unprovisioned, ENABLED)).error, "management_policy_unavailable");
  const eligible = await attempt(store, ENABLED);
  same("B2-A21", "switch_eligible_reaches_the_interlock_only", [eligible.status, eligible.dispatched, /接通/.test(eligible.error)], [409, false, true]);
  store.close();
  unprovisioned.close();
}

assert.equal(outbound.count, 0, "zero outbound calls");
const report = JSON.stringify({ ...JSON.parse(result.report()), gate_inventory: inventory.map(([entrance, action, enforcement]) => ({ entrance, action, enforcement })) }, null, 2);
console.log(report);
if (process.env.QRT_EVIDENCE_OUT) await (await import("node:fs/promises")).writeFile(process.env.QRT_EVIDENCE_OUT, `${report}\n`);
console.log("account management gates validation passed");
