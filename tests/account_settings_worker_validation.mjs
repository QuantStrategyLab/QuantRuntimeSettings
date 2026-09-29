import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { __test } from "../web/strategy-switch-console/worker.js";

const observedAuditFields = {
  draft: { overrides: { reserved_cash_floor: "10", income_layer_enabled: false } },
  risk: { preference: "BALANCED_COMPOUNDING" },
};
const savedAuditFields = {
  draft: { overrides: { reserved_cash_floor: "0", reserved_cash_ratio: "0.1", income_layer_enabled: true } },
  risk: { preference: "GROWTH_COMPOUNDING" },
};
assert.deepEqual(__test.accountSettingsAuditChanges(observedAuditFields, savedAuditFields, {
  overrides: { reserved_cash_floor: "0", reserved_cash_ratio: "0.1" },
}), ["cash_draft"], "a cash save does not take credit for a concurrent risk or income change");
assert.deepEqual(__test.accountSettingsAuditChanges(observedAuditFields, savedAuditFields, {
  risk_change: "set",
}), ["risk_saved"], "a risk save does not take credit for a concurrent cash change");
assert.deepEqual(__test.accountSettingsAuditChanges(observedAuditFields, savedAuditFields, {
  overrides: { income_layer_enabled: true },
}), ["income_draft"]);
assert.deepEqual(__test.accountSettingsAuditChanges(observedAuditFields, { ...savedAuditFields, risk: { preference: null } }, {
  risk_change: "clear",
}), ["risk_cleared"]);
assert.deepEqual(__test.accountSettingsAuditChanges({
  draft: { overrides: { option_overlay_enabled: true, strategy_profile: "a", income_layer_enabled: false } },
  risk: { preference: null },
}, {
  draft: { overrides: { option_overlay_enabled: false, strategy_profile: "b", income_layer_enabled: true } },
  risk: { preference: null },
}, { overrides: { option_overlay_enabled: false } }), ["option_draft"], "an option save does not take credit for a concurrent strategy or income change");
assert.deepEqual(__test.accountSettingsAuditChanges({
  draft: { overrides: { strategy_profile: "a", reserved_cash_floor: "1" } },
  risk: { preference: null },
}, {
  draft: { overrides: { strategy_profile: "b", reserved_cash_floor: "2" } },
  risk: { preference: null },
}, { overrides: { strategy_profile: "b" } }), ["strategy_draft"]);
const normalizedCatalog = __test.normalizeStrategyProfilesPayload([
  { profile: "nasdaq_sp500_smart_dca", label: "dca", domain: "cn_equity", allowed_execution_modes: ["paper", "live"] },
  { profile: "cn_ok", label: "ok", label_zh: "好", label_en: "OK", domain: "cn_equity", allowed_execution_modes: ["paper"], option_overlay_enabled: true },
  { profile: "dry_only", label: "dry", domain: "cn_equity", allowed_execution_modes: ["dry_run"] },
  { profile: "frozen_one", label: "frozen", domain: "cn_equity", allowed_execution_modes: ["live"], frozen: true },
  { profile: "us_only", label: "us", domain: "us_equity", allowed_execution_modes: ["paper", "live"] },
  { profile: "blank_modes", label: "blank", domain: "cn_equity", allowed_execution_modes: [] },
  { profile: "missing_domain", label: "missing", allowed_execution_modes: ["paper", "live"] },
  { profile: "forged_domain", label: "forged", domain_explicit: true, allowed_execution_modes: ["paper", "live"] },
]);
assert.equal(normalizedCatalog.find((item) => item.profile === "missing_domain").domain, "us_equity");
assert.equal(normalizedCatalog.find((item) => item.profile === "missing_domain").domain_explicit, false);
assert.equal(normalizedCatalog.find((item) => item.profile === "forged_domain").domain_explicit, false);
assert.equal(Object.prototype.propertyIsEnumerable.call(normalizedCatalog.find((item) => item.profile === "cn_ok"), "domain_explicit"), false);
assert.equal(normalizedCatalog.find((item) => item.profile === "cn_ok").domain_explicit, true);
assert.equal(normalizedCatalog.find((item) => item.profile === "frozen_one").frozen, true);
const draftChoices = __test.accountDraftStrategyChoices("qmt", { supported_domains: ["cn_equity"] }, normalizedCatalog);
assert.deepEqual(draftChoices.map((item) => item.profile), ["cn_ok"]);
assert.equal(draftChoices[0].option_overlay_enabled, true);
assert.equal(Object.hasOwn(draftChoices[0], "allocations"), false);
const explicitUsChoices = __test.accountDraftStrategyChoices("longbridge", { supported_domains: ["us_equity"] }, normalizedCatalog);
assert.equal(explicitUsChoices.some((item) => item.profile === "us_only"), true);
assert.equal(explicitUsChoices.some((item) => item.profile === "missing_domain" || item.profile === "forged_domain" || item.profile === "frozen_one"), false);
const draftObserved = { platform: "longbridge", config: { supported_domains: ["us_equity"] }, draft: { overrides: {} } };
const draftProfiles = __test.normalizeStrategyProfilesPayload([
  { profile: "supported", label: "Supported", domain: "us_equity", allowed_execution_modes: ["paper"], option_overlay_enabled: true },
  { profile: "plain", label: "Plain", domain: "us_equity", allowed_execution_modes: ["paper"], option_overlay_enabled: false },
]);
assert.doesNotThrow(() => __test.assertAccountDraftPatch(draftProfiles, draftObserved, { strategy_profile: "supported" }, ""));
assert.throws(() => __test.assertAccountDraftPatch(draftProfiles, draftObserved, { strategy_profile: "missing" }, ""), /account_settings_strategy_rejected/);
assert.throws(() => __test.assertAccountDraftPatch(__test.normalizeStrategyProfilesPayload([{ profile: "hk_paper", label: "HK", domain: "hk_equity", allowed_execution_modes: ["paper", "live"], option_overlay_enabled: true }]), draftObserved, { strategy_profile: "hk_paper" }, ""), /account_settings_strategy_rejected/);
assert.throws(() => __test.assertAccountDraftPatch(draftProfiles, draftObserved, { option_overlay_enabled: true }, ""), /account_settings_option_rejected/);
assert.doesNotThrow(() => __test.assertAccountDraftPatch(draftProfiles, { ...draftObserved, draft: { overrides: { strategy_profile: "supported" } } }, { option_overlay_enabled: false }, ""));
assert.throws(() => __test.assertAccountDraftPatch(draftProfiles, { ...draftObserved, draft: { overrides: { strategy_profile: "supported", option_overlay_enabled: false } } }, { strategy_profile: "plain" }, ""), /account_settings_option_strategy_conflict/);
assert.doesNotThrow(() => __test.assertAccountDraftPatch(draftProfiles, { ...draftObserved, draft: { overrides: { option_overlay_enabled: false } } }, { strategy_profile: "plain", option_overlay_enabled: null }, ""));
const cryptoProfiles = __test.normalizeStrategyProfilesPayload([
  { profile: "with_options", label: "With", domain: "crypto", allowed_execution_modes: ["paper", "live"], option_overlay_enabled: true },
]);
const qmtProfiles = __test.normalizeStrategyProfilesPayload([
  { profile: "with_options", label: "With", domain: "cn_equity", allowed_execution_modes: ["paper", "live"], option_overlay_enabled: true },
]);
for (const [platform, profiles, config] of [
  ["binance", cryptoProfiles, { supported_domains: ["crypto"] }],
  ["qmt", qmtProfiles, { supported_domains: ["cn_equity"] }],
]) {
  const bound = { platform, config, draft: { status: "current", overrides: { strategy_profile: "with_options" } } };
  assert.throws(() => __test.assertAccountDraftPatch(profiles, bound, { option_overlay_enabled: true }, ""), /account_settings_option_rejected/, platform);
  assert.doesNotThrow(() => __test.assertAccountDraftPatch(profiles, { ...bound, draft: { status: "current", overrides: { strategy_profile: "with_options", option_overlay_enabled: true } } }, { option_overlay_enabled: null }, ""));
}
const conflictProfiles = __test.normalizeStrategyProfilesPayload([
  { profile: "with_options", label: "With", domain: "us_equity", allowed_execution_modes: ["paper", "live"], option_overlay_enabled: true },
  { profile: "plain", label: "Plain", domain: "us_equity", allowed_execution_modes: ["paper"], option_overlay_enabled: false },
]);
const conflictObserved = {
  platform: "longbridge",
  config: { supported_domains: ["us_equity"] },
  draft: { status: "identity_conflict", overrides: { strategy_profile: "with_options", option_overlay_enabled: false } },
};
assert.throws(() => __test.assertAccountDraftPatch(conflictProfiles, conflictObserved, { option_overlay_enabled: true }, "plain", { acknowledgeIdentityConflict: true }), /account_settings_option_rejected/);
assert.doesNotThrow(() => __test.assertAccountDraftPatch(conflictProfiles, conflictObserved, { strategy_profile: "with_options", option_overlay_enabled: true }, "plain", { acknowledgeIdentityConflict: true }));

const dcaProfileA = "nasdaq_sp500_smart_dca";
const dcaProfileB = "ibit_smart_dca";
const dcaProfiles = __test.normalizeStrategyProfilesPayload([
  { profile: dcaProfileA, label: "DCA A", domain: "us_equity", allowed_execution_modes: ["paper"] },
  { profile: dcaProfileB, label: "DCA B", domain: "us_equity", allowed_execution_modes: ["paper"] },
  { profile: "plain", label: "Plain", domain: "us_equity", allowed_execution_modes: ["paper"] },
  { profile: dcaProfileA, label: "DCA A", domain: "us_equity", allowed_execution_modes: ["dry_run"] },
]);
const dcaObserved = { platform: "longbridge", config: { supported_domains: ["us_equity"] }, draft: { status: "current", overrides: {} } };
assert.equal(__test.accountDraftStrategyChoices("longbridge", dcaObserved.config, dcaProfiles).find((item) => item.profile === dcaProfileA).dca_supported, true);
assert.equal(__test.accountDraftStrategyChoices("qmt", { supported_domains: ["us_equity"] }, dcaProfiles).some((item) => item.dca_supported), false,
  "DCA capability is scoped to supported platforms and does not trust a candidate label");
const dcaCurrentOnly = __test.normalizeStrategyProfilesPayload([
  { profile: dcaProfileA, label: "DCA A", domain: "us_equity", allowed_execution_modes: ["dry_run"] },
]);
assert.equal(__test.accountDraftStrategyChoices("longbridge", dcaObserved.config, dcaCurrentOnly).length, 0,
  "a current DCA profile can remain editable without becoming a selectable candidate");
assert.doesNotThrow(() => __test.assertAccountDraftPatch(dcaCurrentOnly, dcaObserved, {
  strategy_profile: dcaProfileA, dca_mode: "smart", dca_base_investment_usd: "75.25",
}, dcaProfileA));
assert.throws(() => __test.assertAccountDraftPatch(dcaCurrentOnly, dcaObserved, {
  dca_mode: "smart", dca_base_investment_usd: "75.25",
}, dcaProfileA), /account_settings_dca_rejected/, "DCA edits must bind a strategy profile explicitly");
for (const partial of [
  { strategy_profile: dcaProfileA, dca_mode: null, dca_base_investment_usd: "75" },
  { strategy_profile: dcaProfileA, dca_mode: "fixed", dca_base_investment_usd: null },
]) assert.throws(() => __test.assertAccountDraftPatch(dcaCurrentOnly, dcaObserved, partial, dcaProfileA), /account_settings_dca_rejected/,
  "DCA fields must be both cleared or both set to valid values");
for (const invalid of ["", "0", "-1", "1e2", "Infinity", "1.2.3", "1".repeat(33)]) {
  assert.throws(() => __test.assertAccountDraftPatch(dcaCurrentOnly, dcaObserved, {
    strategy_profile: dcaProfileA, dca_mode: "fixed", dca_base_investment_usd: invalid,
  }, dcaProfileA), /invalid_account_setting_overrides/);
}
for (const invalid of [true, 75, false]) {
  assert.throws(() => __test.assertAccountDraftPatch(dcaCurrentOnly, dcaObserved, {
    strategy_profile: dcaProfileA, dca_mode: "fixed", dca_base_investment_usd: invalid,
  }, dcaProfileA), /invalid_account_setting_overrides/);
}
const priorDca = { ...dcaObserved, draft: { status: "current", overrides: { strategy_profile: dcaProfileA, dca_mode: "fixed", dca_base_investment_usd: "50" } } };
assert.throws(() => __test.assertAccountDraftPatch(dcaProfiles, priorDca, { strategy_profile: "plain" }, dcaProfileA), /account_settings_dca_rejected/,
  "switching from DCA to a normal strategy must clear saved DCA values in the same patch");
assert.throws(() => __test.assertAccountDraftPatch(dcaProfiles, dcaObserved, { strategy_profile: "plain" }, dcaProfileA), /account_settings_dca_rejected/,
  "leaving the current DCA profile also requires an explicit clear even without saved overrides");
assert.doesNotThrow(() => __test.assertAccountDraftPatch(dcaProfiles, priorDca, {
  strategy_profile: "plain", dca_mode: null, dca_base_investment_usd: null,
}, dcaProfileA));
assert.throws(() => __test.assertAccountDraftPatch(dcaProfiles, priorDca, { strategy_profile: dcaProfileB }, dcaProfileA), /account_settings_dca_rejected/,
  "switching DCA profiles cannot inherit the former profile's amount");
assert.doesNotThrow(() => __test.assertAccountDraftPatch(dcaProfiles, priorDca, {
  strategy_profile: dcaProfileB, dca_mode: "smart", dca_base_investment_usd: "80",
}, dcaProfileA));
assert.doesNotThrow(() => __test.assertAccountDraftPatch(dcaProfiles, priorDca, {
  strategy_profile: null, dca_mode: null, dca_base_investment_usd: null,
}, dcaProfileA), "clearing a pending DCA strategy and fields returns to the current profile");
assert.doesNotThrow(() => __test.assertAccountDraftPatch(dcaProfiles, priorDca, { option_overlay_enabled: null }, dcaProfileA),
  "an independent option clear does not require rebinding an existing DCA strategy");

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");

function account(key) {
  return {
    key, label: `LongBridge ${key}`, target_name: key, runtime_status_target_id: `longbridge.${key}`,
    account_selector: key.toUpperCase(), deployment_selector: key, account_scope: key.toUpperCase(),
    service_name: `longbridge-${key}-service`, supported_domains: ["us_equity"],
    broker_environment: "paper", default_execution_mode: "live",
    default_strategy_profile: "russell_top50_leader_rotation",
  };
}
const accountOptions = { longbridge: [account("hk"), account("sg")] };
const bindings = {
  SESSION_SECRET: "account-settings-fixture-session",
  ALLOWED_GITHUB_LOGINS: "settings-admin,settings-viewer",
  STRATEGY_SWITCH_ADMIN_LOGINS: "settings-admin",
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify(accountOptions),
};
const adminCookie = `qsl_switch_session=${await __test.makeSession("settings-admin", [], bindings)}`;
const viewerCookie = `qsl_switch_session=${await __test.makeSession("settings-viewer", [], bindings)}`;
const persist = await mkdtemp(join(tmpdir(), "qrt-account-settings-"));
let outbound = 0;
const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08",
  bindings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  durableObjectsPersist: persist,
  kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: () => { outbound += 1; return new Response("offline only", { status: 503 }); },
});
async function call(endpoint, { method = "GET", body, cookie = adminCookie, origin = "https://switch.example" } = {}) {
  const response = await mf.dispatchFetch(`https://switch.example${endpoint}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  return { status: response.status, body: payload };
}
function openLatch() {
  let releaseGate = () => {};
  let markEntered = () => {};
  const entered = new Promise((resolve) => { markEntered = resolve; });
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  let seen = false;
  return {
    entered,
    async hold() {
      if (!seen) {
        seen = true;
        markEntered();
      }
      await gate;
    },
    release() { releaseGate(); },
  };
}
function waitFor(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 5000); }),
  ]).finally(() => clearTimeout(timer));
}
function wrapNamespace(namespace, action, latch) {
  return {
    idFromName: (name) => namespace.idFromName(name),
    get(id) {
      const stub = namespace.get(id);
      return {
        async fetch(input, init) {
          let command = null;
          if (typeof init?.body === "string") {
            try { command = JSON.parse(init.body); } catch { command = null; }
          }
          if (command?.action === action) await latch.hold();
          return stub.fetch(input, init);
        },
      };
    },
  };
}
function throwOnAction(namespace, action) {
  return {
    idFromName: (name) => namespace.idFromName(name),
    get(id) {
      const stub = namespace.get(id);
      return {
        async fetch(input, init) {
          let command = null;
          if (typeof init?.body === "string") {
            try { command = JSON.parse(init.body); } catch { command = null; }
          }
          if (command?.action === action) throw new Error("durable object down");
          return stub.fetch(input, init);
        },
      };
    },
  };
}
async function workerCall(env, endpoint, { method = "GET", body } = {}) {
  const response = await worker.fetch(new Request(`https://switch.example${endpoint}`, {
    method,
    headers: {
      Cookie: adminCookie,
      Origin: "https://switch.example",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  return { status: response.status, body: payload };
}

const bareStore = new Map();
const bareKv = {
  async get(key) { return bareStore.get(key) || null; },
  async put(key, value) { bareStore.set(key, value); },
};
const bareEnv = { ...bindings, STRATEGY_SWITCH_CONFIG: bareKv };
const originalFetch = globalThis.fetch;
let workflowCalls = 0;
globalThis.fetch = async (...args) => {
  workflowCalls += 1;
  return originalFetch(...args);
};
try {
  const bareRead = await workerCall(bareEnv, "/api/risk-profiles");
  const bareWrite = await workerCall(bareEnv, "/api/risk-profiles", {
    method: "POST",
    body: { bindings: [{ platform: "longbridge", target_name: "hk", risk_preference: "BALANCED_COMPOUNDING" }] },
  });
  const bareSettings = await workerCall(bareEnv, "/api/account-settings", {
    method: "POST",
    body: { platform: "longbridge", key: "hk", overrides: { income_layer_enabled: false }, expected_draft_revision: 0, identity: {} },
  });
  assert.equal(bareRead.status, 503);
  assert.equal(bareWrite.status, 503);
  assert.equal(bareSettings.status, 503);
  assert.equal(bareStore.has("risk_profile_bindings"), false);
  assert.equal(workflowCalls, 0, "missing durable object does not dispatch a workflow");
} finally {
  globalThis.fetch = originalFetch;
}

const kv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG");
await kv.put("risk_profile_bindings", "{");
const blocked = await call("/api/risk-profiles");
assert.equal(blocked.status, 409);
assert.equal(blocked.body.reason, "risk_profile_bindings_invalid");
const validBindings = await __test.buildRiskProfileBindings(
  { bindings: [{ platform: "longbridge", target_name: "hk", risk_preference: "BALANCED_COMPOUNDING" }] },
  accountOptions,
  "settings-admin",
);
await kv.put("risk_profile_bindings", JSON.stringify({
  schema_version: "qsl.risk_profile_binding_registry.v1",
  bindings: validBindings,
}));
const imported = await call("/api/risk-profiles");
assert.equal(imported.status, 200);
assert.equal(imported.body.revision, 0);
assert.equal(imported.body.bindings[0].profile_selection.risk_preference, "BALANCED_COMPOUNDING");
assert.match(imported.body.bindings[0].binding_sha256, /^[0-9a-f]{64}$/);
assert.equal(imported.body.no_order, true);
assert.equal(imported.body.execution_authority_granted, false);
const tampered = JSON.parse(await kv.get("risk_profile_bindings"));
tampered.bindings[0].profile_selection.risk_preference = "GROWTH_COMPOUNDING";
await kv.put("risk_profile_bindings", JSON.stringify(tampered));
const afterTamper = await call("/api/risk-profiles");
assert.equal(afterTamper.status, 200);
assert.equal(afterTamper.body.bindings[0].profile_selection.risk_preference, "BALANCED_COMPOUNDING");
assert.equal(afterTamper.body.revision, 0);

assert.equal((await call("/api/admin/runtime-instances", {
  method: "POST",
  body: { action: "initialize", expected_revision: 0, confirm: "IMPORT_EXISTING_CONFIG" },
})).status, 200);
const hkSettings = await call("/api/account-settings?platform=longbridge&key=hk");
assert.equal(hkSettings.status, 200);
assert.equal(hkSettings.body.effective.strategy_profile.status, "unknown");
assert.equal(Object.hasOwn(hkSettings.body.effective.strategy_profile, "value"), false);
assert.equal(hkSettings.body.effective.broker_environment.status, "known");
assert.equal(hkSettings.body.effective.broker_environment.value, "paper");
assert.equal(hkSettings.body.operations.save_draft, true);
assert.equal(hkSettings.body.operations.save_draft_reason, "available");
assert.equal(hkSettings.body.operations.apply_strategy, false);
assert.equal(hkSettings.body.operations.activation, false);
assert.equal(hkSettings.body.operations.activation_reason, "strategy_application_not_connected");
assert.equal(hkSettings.body.effective.reserved_cash_ratio.status, "unknown");
assert.equal(Object.hasOwn(hkSettings.body.effective.reserved_cash_ratio, "value"), false);
assert.equal(hkSettings.body.adopted, false);
assert.equal(hkSettings.body.no_order, true);
assert.equal(hkSettings.body.execution_authority_granted, false);
assert.equal(hkSettings.body.risk.preference, "BALANCED_COMPOUNDING");
const beforeConfig = (await call("/api/admin/runtime-instances")).body.instances.find((item) => item.key === "hk").config;
const workflowBefore = outbound;
const firstDraft = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "hk",
    expected_draft_revision: hkSettings.body.draft.revision,
    identity: hkSettings.body.identity,
    overrides: { income_layer_enabled: false, reserved_cash_floor: "0" },
  },
});
assert.equal(firstDraft.status, 200);
assert.equal(firstDraft.body.adopted, false);
assert.equal(firstDraft.body.draft.overrides.income_layer_enabled, false);
assert.equal(firstDraft.body.draft.overrides.reserved_cash_floor, "0");
const omitted = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "hk",
    expected_draft_revision: firstDraft.body.draft.revision,
    identity: firstDraft.body.identity,
    overrides: { income_layer_enabled: false },
  },
});
assert.equal(omitted.status, 200);
assert.equal(omitted.body.draft.overrides.reserved_cash_floor, "0");
assert.equal(omitted.body.draft.overrides.income_layer_enabled, false);
const cleared = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "hk",
    expected_draft_revision: omitted.body.draft.revision,
    identity: omitted.body.identity,
    overrides: { reserved_cash_floor: null },
  },
});
assert.equal(cleared.status, 200);
assert.equal(Object.hasOwn(cleared.body.draft.overrides, "reserved_cash_floor"), false);
assert.equal(cleared.body.draft.overrides.income_layer_enabled, false);
const numericZero = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "hk",
    expected_draft_revision: cleared.body.draft.revision,
    identity: cleared.body.identity,
    overrides: { reserved_cash_floor: 0 },
  },
});
assert.equal(numericZero.status, 400);
const afterNumeric = await call("/api/account-settings?platform=longbridge&key=hk");
assert.equal(Object.hasOwn(afterNumeric.body.draft.overrides, "reserved_cash_floor"), false);
assert.equal(afterNumeric.body.draft.overrides.income_layer_enabled, false);
const afterConfig = (await call("/api/admin/runtime-instances")).body.instances.find((item) => item.key === "hk").config;
assert.equal(afterConfig.default_strategy_profile, beforeConfig.default_strategy_profile);
assert.equal(JSON.stringify(afterConfig), JSON.stringify(beforeConfig));
assert.equal(outbound, workflowBefore, "draft saves do not dispatch a workflow");

const sgBeforePreference = await call("/api/account-settings?platform=longbridge&key=sg");
const sgPreference = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    identity: sgBeforePreference.body.identity,
    expected_risk_revision: sgBeforePreference.body.risk.revision,
    risk_preference: "CAPITAL_PRESERVATION",
  },
});
assert.equal(sgPreference.status, 200);
assert.equal(sgPreference.body.risk.preference, "CAPITAL_PRESERVATION");
const hkAfterSg = await call("/api/account-settings?platform=longbridge&key=hk");
assert.equal(hkAfterSg.body.risk.preference, "BALANCED_COMPOUNDING");
const staleRisk = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "hk",
    identity: hkAfterSg.body.identity,
    expected_risk_revision: 0,
    risk_preference: "GROWTH_COMPOUNDING",
  },
});
assert.equal(staleRisk.status, 409);
assert.equal(staleRisk.body.error, "risk_profile_revision_conflict");
assert.equal((await call("/api/account-settings?platform=longbridge&key=hk")).body.risk.preference, "BALANCED_COMPOUNDING");

const namedDraft = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "hk",
    expected_draft_revision: hkAfterSg.body.draft.revision,
    identity: hkAfterSg.body.identity,
    overrides: { strategy_profile: "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve" },
  },
});
assert.equal(namedDraft.status, 200);
assert.equal(namedDraft.body.adopted, false);
const instanceBeforeIdentity = await call("/api/admin/runtime-instances");
const identityChange = await call("/api/admin/runtime-instances", {
  method: "POST",
  body: {
    action: "set_broker_environment",
    expected_revision: instanceBeforeIdentity.body.revision,
    platform: "longbridge",
    key: "hk",
    broker_environment: "live",
  },
});
assert.equal(identityChange.status, 200);
const conflicted = await call("/api/account-settings?platform=longbridge&key=hk");
assert.equal(conflicted.body.draft.status, "identity_conflict");
assert.equal(conflicted.body.draft.overrides.strategy_profile, "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve");
assert.equal(conflicted.body.identity.broker_environment, "live");
const staleIdentity = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "hk",
    expected_draft_revision: conflicted.body.draft.revision,
    identity: namedDraft.body.identity,
    overrides: { strategy_profile: "should-not-apply" },
  },
});
assert.equal(staleIdentity.status, 409);
assert.equal(staleIdentity.body.error, "account_settings_identity_conflict");
const retained = await call("/api/account-settings?platform=longbridge&key=hk");
assert.equal(retained.body.draft.status, "identity_conflict");
assert.equal(retained.body.draft.overrides.strategy_profile, "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve");
const hkConfig = (await call("/api/admin/runtime-instances")).body.instances.find((item) => item.key === "hk").config;
assert.equal(hkConfig.default_strategy_profile, "russell_top50_leader_rotation");
assert.equal(JSON.stringify(hkConfig).includes("soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve"), false);
assert.equal(JSON.stringify(hkConfig).includes("should-not-apply"), false);

const liveNamespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
const liveKv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG");
const sgBeforeReplace = await call("/api/account-settings?platform=longbridge&key=sg");
const replaceLatch = openLatch();
const replaceRevision = sgBeforeReplace.body.risk.revision;
const replaceEnv = { ...bindings, STRATEGY_SWITCH_CONFIG: liveKv, STRATEGY_SWITCH_RUNTIME_INSTANCES: wrapNamespace(liveNamespace, "risk_profile_replace", replaceLatch) };
let replacePending = worker.fetch(new Request("https://switch.example/api/risk-profiles", {
  method: "POST",
  headers: { Cookie: adminCookie, Origin: "https://switch.example", "Content-Type": "application/json" },
  body: JSON.stringify({
    expected_revision: replaceRevision,
    bindings: [{ platform: "longbridge", target_name: "hk", risk_preference: "GROWTH_COMPOUNDING" }],
  }),
}), replaceEnv);
try {
  await waitFor(replaceLatch.entered, "risk profile replace");
  const single = await call("/api/account-settings", {
    method: "POST",
    body: {
      platform: "longbridge", key: "sg",
      identity: sgBeforeReplace.body.identity,
      expected_risk_revision: replaceRevision,
      risk_preference: "GROWTH_COMPOUNDING",
    },
  });
  assert.equal(single.status, 200);
  replaceLatch.release();
  const replaceRaced = await replacePending;
  replacePending = null;
  assert.equal(replaceRaced.status, 409);
  assert.equal((await replaceRaced.json()).error, "risk_profile_revision_conflict");
} finally {
  replaceLatch.release();
  if (replacePending) await replacePending.catch(() => {});
}
const afterReplaceRace = await call("/api/risk-profiles");
assert.equal(afterReplaceRace.body.bindings.find((item) => item.scope_id === "longbridge--sg").profile_selection.risk_preference, "GROWTH_COMPOUNDING");
assert.equal(afterReplaceRace.body.bindings.find((item) => item.scope_id === "longbridge--hk").profile_selection.risk_preference, "BALANCED_COMPOUNDING");

const draftLatch = openLatch();
const draftRead = await call("/api/account-settings?platform=longbridge&key=sg");
const draftEnv = { ...bindings, STRATEGY_SWITCH_CONFIG: liveKv, STRATEGY_SWITCH_RUNTIME_INSTANCES: wrapNamespace(liveNamespace, "account_settings_save", draftLatch) };
let draftPending = worker.fetch(new Request("https://switch.example/api/account-settings", {
  method: "POST",
  headers: { Cookie: adminCookie, Origin: "https://switch.example", "Content-Type": "application/json" },
  body: JSON.stringify({
    platform: "longbridge", key: "sg",
    expected_draft_revision: draftRead.body.draft.revision,
    identity: draftRead.body.identity,
    overrides: { strategy_profile: "russell_top50_leader_rotation" },
  }),
}), draftEnv);
try {
  await waitFor(draftLatch.entered, "account draft save");
  const instances = await call("/api/admin/runtime-instances");
  const bumped = await call("/api/admin/runtime-instances", {
    method: "POST",
    body: {
      action: "set_broker_environment",
      expected_revision: instances.body.revision,
      platform: "longbridge",
      key: "sg",
      broker_environment: "live",
    },
  });
  assert.equal(bumped.status, 200);
  draftLatch.release();
  const draftRaced = await draftPending;
  draftPending = null;
  assert.equal(draftRaced.status, 409);
  assert.equal((await draftRaced.json()).error, "account_settings_identity_conflict");
} finally {
  draftLatch.release();
  if (draftPending) await draftPending.catch(() => {});
}
const sgAfterRace = await call("/api/account-settings?platform=longbridge&key=sg");
assert.equal(sgAfterRace.body.draft.status, "empty");
assert.equal(sgAfterRace.body.draft.overrides.strategy_profile, undefined);

const failingStore = new Map();
const failingKv = {
  async get(key) { return failingStore.get(key) || null; },
  async put(key, value) { failingStore.set(key, value); },
};
const failingRevision = (await call("/api/risk-profiles")).body.revision;
const failingWrite = await workerCall({
  ...bindings,
  STRATEGY_SWITCH_CONFIG: failingKv,
  STRATEGY_SWITCH_RUNTIME_INSTANCES: throwOnAction(liveNamespace, "risk_profile_replace"),
}, "/api/risk-profiles", {
  method: "POST",
  body: {
    expected_revision: failingRevision,
    bindings: [{ platform: "longbridge", target_name: "hk", risk_preference: "GROWTH_COMPOUNDING" }],
  },
});
assert.equal(failingWrite.status, 503);
assert.equal(failingStore.has("risk_profile_bindings"), false);
assert.equal((await call("/api/account-settings?platform=longbridge&key=hk")).body.risk.preference, "BALANCED_COMPOUNDING");

const mirrorStore = new Map();
const mirrorKv = {
  async get(key) { return mirrorStore.get(key) || null; },
  async put() { throw new Error("mirror unavailable"); },
};
const mirrorRead = await call("/api/account-settings?platform=longbridge&key=sg");
const mirrorWrite = await workerCall({
  ...bindings,
  STRATEGY_SWITCH_CONFIG: mirrorKv,
  STRATEGY_SWITCH_RUNTIME_INSTANCES: liveNamespace,
}, "/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    identity: mirrorRead.body.identity,
    expected_risk_revision: mirrorRead.body.risk.revision,
    risk_preference: "CAPITAL_PRESERVATION",
  },
});
assert.equal(mirrorWrite.status, 200);
assert.equal(mirrorWrite.body.adopted, false);
assert.equal(mirrorStore.has("risk_profile_bindings"), false);
assert.equal((await call("/api/account-settings?platform=longbridge&key=sg")).body.risk.preference, "CAPITAL_PRESERVATION");
assert.equal((await call("/api/account-settings?platform=longbridge&key=hk")).body.risk.preference, "BALANCED_COMPOUNDING");
assert.equal(outbound, workflowBefore, "preference saves do not dispatch a workflow");

const hkBound = await call("/api/account-settings?platform=longbridge&key=hk");
const sgBound = await call("/api/account-settings?platform=longbridge&key=sg");
const missingIdentity = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "hk",
    expected_risk_revision: hkBound.body.risk.revision,
    risk_preference: "GROWTH_COMPOUNDING",
  },
});
assert.equal(missingIdentity.status, 400);
assert.equal(missingIdentity.body.error, "account_settings_identity_required");
const wrongDeployment = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "hk",
    identity: { ...hkBound.body.identity, deployment_selector: "other-route" },
    expected_risk_revision: hkBound.body.risk.revision,
    risk_preference: "GROWTH_COMPOUNDING",
  },
});
assert.equal(wrongDeployment.status, 409);
assert.equal(wrongDeployment.body.error, "account_settings_identity_conflict");
const wrongScope = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    identity: { ...sgBound.body.identity, account_scope: "OTHER" },
    expected_risk_revision: sgBound.body.risk.revision,
    risk_preference: null,
  },
});
assert.equal(wrongScope.status, 409);
assert.equal(wrongScope.body.error, "account_settings_identity_conflict");
assert.equal((await call("/api/account-settings?platform=longbridge&key=hk")).body.risk.preference, "BALANCED_COMPOUNDING");
assert.equal((await call("/api/account-settings?platform=longbridge&key=sg")).body.risk.preference, "CAPITAL_PRESERVATION");

async function raceRiskWrite(accountKey, body, nextEnvironment) {
  const latch = openLatch();
  const env = { ...bindings, STRATEGY_SWITCH_CONFIG: liveKv, STRATEGY_SWITCH_RUNTIME_INSTANCES: wrapNamespace(liveNamespace, "account_settings_save", latch) };
  let pending = worker.fetch(new Request("https://switch.example/api/account-settings", {
    method: "POST",
    headers: { Cookie: adminCookie, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), env);
  try {
    await waitFor(latch.entered, `${accountKey} risk identity`);
    const instances = await call("/api/admin/runtime-instances");
    const changed = await call("/api/admin/runtime-instances", {
      method: "POST",
      body: {
        action: "set_broker_environment",
        expected_revision: instances.body.revision,
        platform: "longbridge",
        key: accountKey,
        broker_environment: nextEnvironment,
      },
    });
    assert.equal(changed.status, 200);
    latch.release();
    const raced = await pending;
    pending = null;
    assert.equal(raced.status, 409);
    assert.equal((await raced.json()).error, "account_settings_identity_conflict");
  } finally {
    latch.release();
    if (pending) await pending.catch(() => {});
  }
}
await raceRiskWrite("hk", {
  platform: "longbridge", key: "hk",
  identity: hkBound.body.identity,
  expected_risk_revision: hkBound.body.risk.revision,
  risk_preference: "GROWTH_COMPOUNDING",
}, "paper");
const sgAfterSetRace = await call("/api/account-settings?platform=longbridge&key=sg");
await raceRiskWrite("sg", {
  platform: "longbridge", key: "sg",
  identity: sgAfterSetRace.body.identity,
  expected_risk_revision: sgAfterSetRace.body.risk.revision,
  risk_preference: null,
}, "paper");
assert.equal((await call("/api/account-settings?platform=longbridge&key=hk")).body.risk.preference, "BALANCED_COMPOUNDING");
assert.equal((await call("/api/account-settings?platform=longbridge&key=sg")).body.risk.preference, "CAPITAL_PRESERVATION");

const cashAccount = await call("/api/account-settings?platform=longbridge&key=sg");
assert.equal(cashAccount.body.effective.income_layer_enabled.status, "unknown");
assert.equal(Object.hasOwn(cashAccount.body.effective.income_layer_enabled, "value"), false);
assert.equal(cashAccount.body.effective.option_overlay_enabled.status, "unknown");
assert.equal(Object.hasOwn(cashAccount.body.effective.option_overlay_enabled, "value"), false);
const cashBefore = outbound;
const configBeforeCash = JSON.stringify((await call("/api/admin/runtime-instances")).body.instances.find((item) => item.key === "sg").config);
for (const value of ["-1", "NaN", "Infinity", "1e2", "1.2.3", " 1", "1 ", ""]) {
  const rejectedAmount = await call("/api/account-settings", {
    method: "POST",
    body: {
      platform: "longbridge", key: "sg",
      expected_draft_revision: cashAccount.body.draft.revision,
      identity: cashAccount.body.identity,
      overrides: { reserved_cash_floor: value },
    },
  });
  assert.equal(rejectedAmount.status, 400, value);
}
const optionWrite = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: cashAccount.body.draft.revision,
    identity: cashAccount.body.identity,
    overrides: { option_overlay_enabled: "yes" },
  },
});
assert.equal(optionWrite.status, 400);
assert.equal(outbound, cashBefore, "rejected cash and option writes do not dispatch");
const exactCash = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: cashAccount.body.draft.revision,
    identity: cashAccount.body.identity,
    overrides: { reserved_cash_floor: "0.10" },
  },
});
assert.equal(exactCash.status, 200);
assert.equal(exactCash.body.draft.overrides.reserved_cash_floor, "0.10");
assert.equal(exactCash.body.adopted, false);
const zeroCash = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: exactCash.body.draft.revision,
    identity: exactCash.body.identity,
    overrides: { reserved_cash_floor: "0" },
  },
});
assert.equal(zeroCash.status, 200);
assert.equal(zeroCash.body.draft.overrides.reserved_cash_floor, "0");
assert.equal(outbound, cashBefore, "accepted cash drafts do not dispatch");
assert.equal(JSON.stringify((await call("/api/admin/runtime-instances")).body.instances.find((item) => item.key === "sg").config), configBeforeCash);

const ratioStart = await call("/api/account-settings?platform=longbridge&key=sg");
assert.equal(ratioStart.body.effective.reserved_cash_ratio.status, "unknown");
for (const value of ["-0.1", "NaN", "Infinity", "1.1", "1e-1", " 0.1", "0.1 ", "", ".5", "1.000000000000000000001"]) {
  const rejectedRatio = await call("/api/account-settings", {
    method: "POST",
    body: {
      platform: "longbridge", key: "sg",
      expected_draft_revision: ratioStart.body.draft.revision,
      identity: ratioStart.body.identity,
      overrides: { reserved_cash_ratio: value },
    },
  });
  assert.equal(rejectedRatio.status, 400, value);
}
const ratioBefore = outbound;
const explicitZero = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: ratioStart.body.draft.revision,
    identity: ratioStart.body.identity,
    overrides: { reserved_cash_floor: "0", reserved_cash_ratio: "0" },
  },
});
assert.equal(explicitZero.status, 200);
assert.equal(explicitZero.body.draft.overrides.reserved_cash_ratio, "0");
assert.equal(explicitZero.body.draft.overrides.reserved_cash_floor, "0");
assert.equal(explicitZero.body.effective.reserved_cash_ratio.status, "unknown");
assert.equal(explicitZero.body.adopted, false);
const fullShare = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: explicitZero.body.draft.revision,
    identity: explicitZero.body.identity,
    overrides: { reserved_cash_floor: "0", reserved_cash_ratio: "1" },
  },
});
assert.equal(fullShare.status, 200);
assert.equal(fullShare.body.draft.overrides.reserved_cash_ratio, "1");
assert.equal(fullShare.body.effective.reserved_cash_floor.status, ratioStart.body.effective.reserved_cash_floor.status);
const paddedOne = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: fullShare.body.draft.revision,
    identity: fullShare.body.identity,
    overrides: { reserved_cash_floor: "0", reserved_cash_ratio: "1.000" },
  },
});
assert.equal(paddedOne.status, 200);
assert.equal(paddedOne.body.draft.overrides.reserved_cash_ratio, "1.000");
const fraction = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: paddedOne.body.draft.revision,
    identity: fullShare.body.identity,
    overrides: { reserved_cash_floor: "15", reserved_cash_ratio: "0.25" },
  },
});
assert.equal(fraction.status, 200);
assert.equal(fraction.body.draft.overrides.reserved_cash_ratio, "0.25");
assert.equal(fraction.body.draft.overrides.reserved_cash_floor, "15");
assert.equal(fraction.body.effective.reserved_cash_ratio.status, "unknown");
const staleRatio = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: fraction.body.draft.revision - 1,
    identity: fraction.body.identity,
    overrides: { reserved_cash_ratio: "0.5" },
  },
});
assert.equal(staleRatio.status, 409);
const riskKeepsRatio = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    identity: fraction.body.identity,
    expected_risk_revision: fraction.body.risk.revision,
    risk_preference: "CAPITAL_PRESERVATION",
  },
});
assert.equal(riskKeepsRatio.status, 200);
assert.equal(riskKeepsRatio.body.draft.overrides.reserved_cash_ratio, "0.25");
const clearedRatio = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: riskKeepsRatio.body.draft.revision,
    identity: riskKeepsRatio.body.identity,
    overrides: { reserved_cash_ratio: null },
  },
});
assert.equal(clearedRatio.status, 200);
assert.equal(Object.hasOwn(clearedRatio.body.draft.overrides, "reserved_cash_ratio"), false);
assert.equal(clearedRatio.body.draft.overrides.reserved_cash_floor, "15");
assert.equal(outbound, ratioBefore, "ratio drafts do not dispatch");
const viewerRead = await call("/api/account-settings?platform=longbridge&key=sg", { cookie: viewerCookie });
assert.equal(viewerRead.status, 200);
assert.equal(viewerRead.body.operations.save_draft, false);
assert.equal(viewerRead.body.operations.save_risk_preference, false);
assert.equal(viewerRead.body.operations.save_draft_reason, "admin_required");
assert.equal(viewerRead.body.operations.apply_strategy, false);
assert.equal(viewerRead.body.operations.activation, false);
const viewerBefore = outbound;
const viewerWrite = await call("/api/account-settings", {
  method: "POST",
  cookie: viewerCookie,
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: viewerRead.body.draft.revision,
    identity: viewerRead.body.identity,
    overrides: { reserved_cash_ratio: "0.1" },
  },
});
assert.equal(viewerWrite.status, 403);
assert.equal(outbound, viewerBefore, "closed operations do not post a draft");

async function accountAudit() {
  return (await call("/api/admin/config")).body.auditLog.filter((entry) => entry.action === "save_account_settings");
}
const auditBefore = await accountAudit();
const hkAudit = await call("/api/account-settings?platform=longbridge&key=sg");
const cashAudit = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: hkAudit.body.draft.revision,
    identity: hkAudit.body.identity,
    overrides: { reserved_cash_floor: "0", reserved_cash_ratio: "0.1" },
  },
});
assert.equal(cashAudit.status, 200);
assert.equal(cashAudit.body.adopted, false);
assert.equal(cashAudit.body.audit_logged, true);
assert.equal(cashAudit.body.draft.overrides.reserved_cash_ratio, "0.1");
const incomeAudit = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: cashAudit.body.draft.revision,
    identity: cashAudit.body.identity,
    overrides: { income_layer_enabled: true },
  },
});
assert.equal(incomeAudit.status, 200);
assert.equal(incomeAudit.body.audit_logged, true);
assert.equal(incomeAudit.body.draft.overrides.income_layer_enabled, true);
assert.equal(incomeAudit.body.draft.overrides.reserved_cash_ratio, "0.1");
const riskAudit = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    identity: incomeAudit.body.identity,
    expected_risk_revision: incomeAudit.body.risk.revision,
    risk_preference: "GROWTH_COMPOUNDING",
  },
});
assert.equal(riskAudit.status, 200);
assert.equal(riskAudit.body.audit_logged, true);
assert.equal(riskAudit.body.adopted, false);
const clearAudit = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    identity: riskAudit.body.identity,
    expected_risk_revision: riskAudit.body.risk.revision,
    risk_preference: null,
  },
});
assert.equal(clearAudit.status, 200);
assert.equal(clearAudit.body.audit_logged, true);
assert.equal(clearAudit.body.risk.preference, null);
const savedAudit = await accountAudit();
assert.equal(savedAudit.length, auditBefore.length + 4);
assert.deepEqual(savedAudit[0].changes, ["risk_cleared"]);
assert.deepEqual(savedAudit[1].changes, ["risk_saved"]);
assert.deepEqual(savedAudit[2].changes, ["income_draft"]);
assert.deepEqual(savedAudit[3].changes, ["cash_draft"]);
assert.equal(savedAudit[0].login, "settings-admin");
assert.equal(savedAudit[0].platform, "longbridge");
assert.equal(savedAudit[0].key, "sg");
assert.equal(savedAudit[0].risk_revision, clearAudit.body.risk.revision);
assert.equal(savedAudit[3].draft_revision, cashAudit.body.draft.revision);
assert.equal(JSON.stringify(savedAudit[0]).includes("reserved_cash"), false);
assert.equal(JSON.stringify(savedAudit[0]).includes("secret"), false);
const repeatedAudit = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: clearAudit.body.draft.revision,
    identity: clearAudit.body.identity,
    overrides: { reserved_cash_floor: "0", reserved_cash_ratio: "0.1" },
  },
});
assert.equal(repeatedAudit.status, 200);
assert.equal(repeatedAudit.body.audit_logged, false);
assert.equal((await accountAudit()).length, savedAudit.length);
const conflictedAudit = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: repeatedAudit.body.draft.revision - 1,
    identity: repeatedAudit.body.identity,
    overrides: { reserved_cash_ratio: "0.2" },
  },
});
assert.equal(conflictedAudit.status, 409);
const deniedAudit = await call("/api/account-settings", {
  method: "POST",
  cookie: viewerCookie,
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: repeatedAudit.body.draft.revision,
    identity: repeatedAudit.body.identity,
    overrides: { reserved_cash_ratio: "0.2" },
  },
});
assert.equal(deniedAudit.status, 403);
assert.equal((await accountAudit()).length, savedAudit.length);
assert.equal((await call("/api/account-settings?platform=longbridge&key=sg")).body.draft.overrides.reserved_cash_ratio, "0.1");
const auditCountBeforeMiss = (await accountAudit()).length;
const missedKv = {
  async get(key) { return liveKv.get(key); },
  async put(key, value, options) {
    if (key === "audit_log") throw new Error("audit unavailable");
    return liveKv.put(key, value, options);
  },
};
const missed = await workerCall({
  ...bindings,
  STRATEGY_SWITCH_CONFIG: missedKv,
  STRATEGY_SWITCH_RUNTIME_INSTANCES: liveNamespace,
}, "/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: repeatedAudit.body.draft.revision,
    identity: repeatedAudit.body.identity,
    overrides: { income_layer_enabled: false },
  },
});
assert.equal(missed.status, 200);
assert.equal(missed.body.audit_logged, false);
assert.equal(missed.body.adopted, false);
assert.equal(missed.body.draft.overrides.income_layer_enabled, false);
const missedRead = await call("/api/account-settings?platform=longbridge&key=sg");
assert.equal(missedRead.body.draft.overrides.income_layer_enabled, false);
assert.equal(missedRead.body.draft.overrides.reserved_cash_ratio, "0.1");
assert.equal((await accountAudit()).length, auditCountBeforeMiss);

const catalogIds = missedRead.body.strategy_options.map((item) => item.profile);
assert.equal(catalogIds.includes("global_etf_rotation"), false);
assert.equal(catalogIds.some((id) => String(id).startsWith("hk_")), false);
assert.equal(catalogIds.includes("russell_top50_leader_rotation"), true);
assert.equal(missedRead.body.strategy_options.find((item) => item.profile === "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve").option_overlay_enabled, false);
assert.equal(missedRead.body.operations.save_option_draft, false);
assert.equal(missedRead.body.operations.activation, false);
assert.equal(missedRead.body.adopted, false);
const outboundBeforeStrategy = outbound;
const unknownStrategy = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: missedRead.body.draft.revision,
    identity: missedRead.body.identity,
    overrides: { strategy_profile: "not_a_profile" },
  },
});
assert.equal(unknownStrategy.status, 400);
const crossMarket = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: missedRead.body.draft.revision,
    identity: missedRead.body.identity,
    overrides: { strategy_profile: "hk_global_etf_tactical_rotation" },
  },
});
assert.equal(crossMarket.status, 400);
assert.equal(outbound, outboundBeforeStrategy);
const plainStrategy = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: missedRead.body.draft.revision,
    identity: missedRead.body.identity,
    overrides: { strategy_profile: "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve" },
  },
});
assert.equal(plainStrategy.status, 200);
assert.equal(plainStrategy.body.adopted, false);
assert.equal(plainStrategy.body.operations.apply_strategy, false);
assert.equal(plainStrategy.body.operations.save_option_draft, false);
assert.equal(plainStrategy.body.draft.overrides.strategy_profile, "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve");
assert.equal(plainStrategy.body.draft.overrides.income_layer_enabled, false);
assert.equal(plainStrategy.body.draft.overrides.reserved_cash_ratio, "0.1");
assert.equal(plainStrategy.body.audit_logged, true);
assert.deepEqual(plainStrategy.body.changes || (await accountAudit())[0].changes, ["strategy_draft"]);
const rejectedOption = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: plainStrategy.body.draft.revision,
    identity: plainStrategy.body.identity,
    overrides: { option_overlay_enabled: true },
  },
});
assert.equal(rejectedOption.status, 400);
const supportingStrategy = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: plainStrategy.body.draft.revision,
    identity: plainStrategy.body.identity,
    overrides: { strategy_profile: "russell_top50_leader_rotation" },
  },
});
assert.equal(supportingStrategy.status, 200);
assert.equal(supportingStrategy.body.operations.save_option_draft, true);
assert.equal(supportingStrategy.body.operations.save_option_draft_reason, "available");
assert.equal(supportingStrategy.body.adopted, false);
const optionDraft = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: supportingStrategy.body.draft.revision,
    identity: supportingStrategy.body.identity,
    overrides: { option_overlay_enabled: false },
  },
});
assert.equal(optionDraft.status, 200);
assert.equal(optionDraft.body.adopted, false);
assert.equal(optionDraft.body.draft.overrides.option_overlay_enabled, false);
assert.equal(optionDraft.body.draft.overrides.strategy_profile, "russell_top50_leader_rotation");
assert.equal(optionDraft.body.effective.option_overlay_enabled.status, "unknown");
assert.equal(optionDraft.body.audit_logged, true);
assert.deepEqual((await accountAudit())[0].changes, ["option_draft"]);
const blockedSwitch = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: optionDraft.body.draft.revision,
    identity: optionDraft.body.identity,
    overrides: { strategy_profile: "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve" },
  },
});
assert.equal(blockedSwitch.status, 400);
const stillCombined = await call("/api/account-settings?platform=longbridge&key=sg");
assert.equal(stillCombined.body.draft.overrides.strategy_profile, "russell_top50_leader_rotation");
assert.equal(stillCombined.body.draft.overrides.option_overlay_enabled, false);
const incomeKeepsOption = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: stillCombined.body.draft.revision,
    identity: stillCombined.body.identity,
    overrides: { income_layer_enabled: true },
  },
});
assert.equal(incomeKeepsOption.status, 200);
assert.equal(incomeKeepsOption.body.draft.overrides.income_layer_enabled, true);
assert.equal(incomeKeepsOption.body.draft.overrides.option_overlay_enabled, false);
assert.equal(incomeKeepsOption.body.draft.overrides.strategy_profile, "russell_top50_leader_rotation");
assert.deepEqual((await accountAudit())[0].changes, ["income_draft"]);
const explicitClear = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: incomeKeepsOption.body.draft.revision,
    identity: incomeKeepsOption.body.identity,
    overrides: { strategy_profile: "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve", option_overlay_enabled: null },
  },
});
assert.equal(explicitClear.status, 200);
assert.equal(explicitClear.body.draft.overrides.strategy_profile, "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve");
assert.equal(Object.hasOwn(explicitClear.body.draft.overrides, "option_overlay_enabled"), false);
assert.equal(explicitClear.body.draft.overrides.income_layer_enabled, true);
const staleOption = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: optionDraft.body.draft.revision,
    identity: explicitClear.body.identity,
    overrides: { option_overlay_enabled: null },
  },
});
assert.equal(staleOption.status, 409);
const viewerStrategy = await call("/api/account-settings", {
  method: "POST",
  cookie: viewerCookie,
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: explicitClear.body.draft.revision,
    identity: explicitClear.body.identity,
    overrides: { strategy_profile: "russell_top50_leader_rotation" },
  },
});
assert.equal(viewerStrategy.status, 403);
assert.equal(outbound, outboundBeforeStrategy);
assert.equal((await call("/api/account-settings?platform=longbridge&key=sg")).body.effective.strategy_profile.status, "unknown");

const supportedBeforeConflict = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: explicitClear.body.draft.revision,
    identity: explicitClear.body.identity,
    overrides: { strategy_profile: "russell_top50_leader_rotation" },
  },
});
assert.equal(supportedBeforeConflict.status, 200);
assert.equal(supportedBeforeConflict.body.operations.save_option_draft, true);
const optionBeforeConflict = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: supportedBeforeConflict.body.draft.revision,
    identity: supportedBeforeConflict.body.identity,
    overrides: { option_overlay_enabled: true },
  },
});
assert.equal(optionBeforeConflict.status, 200);
assert.equal(optionBeforeConflict.body.draft.overrides.option_overlay_enabled, true);
const instancesBeforeConflict = await call("/api/admin/runtime-instances");
const flippedEnvironment = optionBeforeConflict.body.identity.broker_environment === "live" ? "paper" : "live";
const identityFlip = await call("/api/admin/runtime-instances", {
  method: "POST",
  body: {
    action: "set_broker_environment",
    expected_revision: instancesBeforeConflict.body.revision,
    platform: "longbridge",
    key: "sg",
    broker_environment: flippedEnvironment,
  },
});
assert.equal(identityFlip.status, 200);
const conflictedSettings = await call("/api/account-settings?platform=longbridge&key=sg");
assert.equal(conflictedSettings.body.draft.status, "identity_conflict");
assert.equal(conflictedSettings.body.draft.overrides.strategy_profile, "russell_top50_leader_rotation");
assert.equal(conflictedSettings.body.operations.save_option_draft, false);
assert.equal(conflictedSettings.body.operations.activation, false);
const optionOnlyAck = await call("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    expected_draft_revision: conflictedSettings.body.draft.revision,
    identity: conflictedSettings.body.identity,
    acknowledge_identity_conflict: true,
    overrides: { option_overlay_enabled: true },
  },
});
assert.equal(optionOnlyAck.status, 400);
assert.equal(optionOnlyAck.body.error, "account_settings_option_rejected");
const afterOptionReject = await call("/api/account-settings?platform=longbridge&key=sg");
assert.equal(afterOptionReject.body.draft.revision, conflictedSettings.body.draft.revision);
assert.equal(afterOptionReject.body.draft.status, "identity_conflict");
assert.equal(afterOptionReject.body.draft.overrides.strategy_profile, "russell_top50_leader_rotation");
assert.equal(afterOptionReject.body.draft.overrides.option_overlay_enabled, true);

await mf.dispose();

const dcaFetches = [];
let sgDcaVariables = [
  { name: "STRATEGY_PROFILE", value: "nasdaq_sp500_smart_dca" },
  { name: "DCA_MODE", value: "smart" },
  { name: "DCA_BASE_INVESTMENT_USD", value: "250" },
];
let hkDcaVariables = [
  { name: "STRATEGY_PROFILE", value: "russell_top50_leader_rotation" },
  { name: "DCA_MODE", value: "fixed" },
  { name: "DCA_BASE_INVESTMENT_USD", value: "1000" },
];
const knownPersist = await mkdtemp(join(tmpdir(), "qrt-account-settings-ratio-"));
const knownMf = new Miniflare({
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08",
  bindings: { ...bindings, RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-ratio-token" },
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  durableObjectsPersist: knownPersist,
  kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: (request) => {
    const url = String(request?.url || "");
    dcaFetches.push(url);
    const extra = url.includes("/environments/longbridge-sg/") ? sgDcaVariables
      : url.includes("/environments/longbridge-hk/") ? hkDcaVariables
      : [];
    return new Response(JSON.stringify({
      variables: [{ name: "LONGBRIDGE_RESERVED_CASH_RATIO", value: "0.25" }, ...extra],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
});
async function knownCall(endpoint, body) {
  const response = await knownMf.dispatchFetch(`https://switch.example${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: adminCookie,
      Origin: "https://switch.example",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
assert.equal((await knownCall("/api/admin/runtime-instances", { action: "initialize", expected_revision: 0, confirm: "IMPORT_EXISTING_CONFIG" })).status, 200);
dcaFetches.length = 0;
const known = await knownCall("/api/account-settings?platform=longbridge&key=sg");
assert.equal(known.status, 200);
assert.equal(known.body.effective.reserved_cash_ratio.status, "known");
assert.equal(known.body.effective.reserved_cash_ratio.value, "0.25");
assert.equal(known.body.effective.strategy_profile.value, "nasdaq_sp500_smart_dca");
assert.equal(known.body.effective.dca_mode.status, "known");
assert.equal(known.body.effective.dca_mode.value, "smart");
assert.equal(known.body.effective.dca_base_investment_usd.status, "known");
assert.equal(known.body.effective.dca_base_investment_usd.value, "250");
assert.equal(known.body.effective.dca_mode.applied, undefined);
const sgReads = dcaFetches.filter((url) => url.includes("/environments/longbridge-sg/"));
assert.equal(sgReads.length, 1);
assert.equal(sgReads.some((url) => url.includes("DCA_MODE")), false);
assert.equal(known.body.current_dca_supported, true);
const savedDcaFixed = await knownCall("/api/account-settings", { platform: "longbridge", key: "sg", identity: known.body.identity,
  expected_draft_revision: known.body.draft.revision,
  overrides: { strategy_profile: "nasdaq_sp500_smart_dca", dca_mode: "fixed", dca_base_investment_usd: "75.25" } });
assert.equal(savedDcaFixed.status, 200);
assert.equal(savedDcaFixed.body.no_order, true);
assert.equal(savedDcaFixed.body.execution_authority_granted, false);
const fixedReadback = await knownCall("/api/account-settings?platform=longbridge&key=sg");
assert.equal(fixedReadback.body.draft.overrides.dca_mode, "fixed");
assert.equal(fixedReadback.body.draft.overrides.dca_base_investment_usd, "75.25");
const rejectedDcaSwitch = await knownCall("/api/account-settings", { platform: "longbridge", key: "sg", identity: fixedReadback.body.identity,
  expected_draft_revision: fixedReadback.body.draft.revision, overrides: { strategy_profile: "russell_top50_leader_rotation" } });
assert.equal(rejectedDcaSwitch.status, 400, "a DCA-to-normal profile change must clear both DCA fields atomically");
const savedDcaSmart = await knownCall("/api/account-settings", { platform: "longbridge", key: "sg", identity: fixedReadback.body.identity,
  expected_draft_revision: fixedReadback.body.draft.revision,
  overrides: { strategy_profile: "nasdaq_sp500_smart_dca", dca_mode: "smart", dca_base_investment_usd: "90" } });
assert.equal(savedDcaSmart.status, 200);
const smartReadback = await knownCall("/api/account-settings?platform=longbridge&key=sg");
assert.equal(smartReadback.body.draft.overrides.dca_mode, "smart");
assert.equal(smartReadback.body.draft.overrides.dca_base_investment_usd, "90");
const invalidDcaAmount = await knownCall("/api/account-settings", { platform: "longbridge", key: "sg", identity: smartReadback.body.identity,
  expected_draft_revision: smartReadback.body.draft.revision,
  overrides: { strategy_profile: "nasdaq_sp500_smart_dca", dca_mode: "fixed", dca_base_investment_usd: "1e2" } });
assert.equal(invalidDcaAmount.status, 400);
for (const overrides of [
  { strategy_profile: "nasdaq_sp500_smart_dca", dca_mode: null, dca_base_investment_usd: "75" },
  { strategy_profile: "nasdaq_sp500_smart_dca", dca_mode: "fixed", dca_base_investment_usd: null },
]) {
  const partialDca = await knownCall("/api/account-settings", { platform: "longbridge", key: "sg", identity: smartReadback.body.identity,
    expected_draft_revision: smartReadback.body.draft.revision, overrides });
  assert.equal(partialDca.status, 400);
  const unchangedDca = await knownCall("/api/account-settings?platform=longbridge&key=sg");
  assert.equal(unchangedDca.body.draft.revision, smartReadback.body.draft.revision, "a rejected partial DCA update does not advance the draft revision");
  assert.equal(unchangedDca.body.draft.overrides.dca_mode, "smart");
  assert.equal(unchangedDca.body.draft.overrides.dca_base_investment_usd, "90");
}
const missing = await knownCall("/api/account-settings?platform=longbridge&key=hk");
assert.equal(missing.body.effective.reserved_cash_ratio.value, "0.25");
assert.equal(missing.body.effective.strategy_profile.value, "russell_top50_leader_rotation");
assert.equal(Object.hasOwn(missing.body.effective, "dca_mode"), false);
assert.equal(Object.hasOwn(missing.body.effective, "dca_base_investment_usd"), false);
hkDcaVariables = [
  { name: "STRATEGY_PROFILE", value: "crypto_btc_dca" },
  { name: "DCA_MODE", value: "smart" },
  { name: "DCA_BASE_INVESTMENT_USD", value: "400" },
];
const namedOnly = await knownCall("/api/account-settings?platform=longbridge&key=hk");
assert.equal(namedOnly.body.effective.strategy_profile.value, "crypto_btc_dca");
assert.equal(Object.hasOwn(namedOnly.body.effective, "dca_mode"), false);
assert.equal(Object.hasOwn(namedOnly.body.effective, "dca_base_investment_usd"), false);
hkDcaVariables = [
  { name: "STRATEGY_PROFILE", value: "nasdaq_sp500_smart_dca" },
  { name: "DCA_MODE", value: "weekly" },
  { name: "DCA_BASE_INVESTMENT_USD", value: "0" },
];
const incomplete = await knownCall("/api/account-settings?platform=longbridge&key=hk");
assert.equal(incomplete.body.effective.dca_mode.status, "unknown");
assert.equal(Object.hasOwn(incomplete.body.effective.dca_mode, "value"), false);
assert.equal(incomplete.body.effective.dca_base_investment_usd.status, "unknown");
assert.equal(Object.hasOwn(incomplete.body.effective.dca_base_investment_usd, "value"), false);
assert.equal(JSON.stringify(incomplete.body.effective).includes("1000"), false);
hkDcaVariables = [
  { name: "STRATEGY_PROFILE", value: "ibit_smart_dca" },
  { name: "DCA_MODE", value: "fixed" },
  { name: "DCA_BASE_INVESTMENT_USD", value: "80" },
];
const rebound = await knownCall("/api/account-settings?platform=longbridge&key=hk");
assert.equal(rebound.body.effective.strategy_profile.value, "ibit_smart_dca");
assert.equal(rebound.body.effective.dca_mode.value, "fixed");
assert.equal(rebound.body.effective.dca_base_investment_usd.value, "80");
const stillSg = await knownCall("/api/account-settings?platform=longbridge&key=sg");
assert.equal(stillSg.body.effective.dca_mode.value, "smart");
assert.equal(stillSg.body.effective.dca_base_investment_usd.value, "250");
await knownMf.dispose();

const profileApplicationVariables = {
  hk: [
    { name: "STRATEGY_PROFILE", value: "synthetic_current_profile" },
    { name: "RUNTIME_TARGET_ENABLED", value: "false" },
  ],
  sg: [
    { name: "STRATEGY_PROFILE", value: "synthetic_current_profile" },
    { name: "RUNTIME_TARGET_ENABLED", value: "false" },
  ],
};
const profileApplicationProfiles = [
  { profile: "synthetic_current_profile", label: "Current", domain: "us_equity", allowed_execution_modes: ["paper"] },
  { profile: "synthetic_next_profile", label: "Next", domain: "us_equity", allowed_execution_modes: ["paper"] },
  { profile: "synthetic_other_profile", label: "Other", domain: "us_equity", allowed_execution_modes: ["paper"] },
];
const profileApplicationOidcKeyPair = await webcrypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const profileApplicationOidcJwk = {
  ...await webcrypto.subtle.exportKey("jwk", profileApplicationOidcKeyPair.publicKey),
  kid: "synthetic-github-oidc-key",
  use: "sig",
  alg: "RS256",
};
const profileApplicationWorkflowSha = "a".repeat(40);
const profileApplicationWorkflowRef = "QuantStrategyLab/QuantRuntimeSettings/.github/workflows/apply-approved-hk-profile.yml@refs/heads/main";
let profileApplicationJwksMode = "ok";
let profileApplicationRedirectFollowed = false;
function profileApplicationBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}
async function profileApplicationOidcToken(claimOverrides = {}, headerOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: profileApplicationOidcJwk.kid, ...headerOverrides };
  const claims = {
    iss: "https://token.actions.githubusercontent.com",
    aud: "qrs-profile-application",
    repository: "QuantStrategyLab/QuantRuntimeSettings",
    ref: "refs/heads/main",
    workflow_ref: profileApplicationWorkflowRef,
    workflow_sha: profileApplicationWorkflowSha,
    run_id: "36550000001",
    run_attempt: "1",
    event_name: "workflow_dispatch",
    iat: now,
    nbf: now,
    exp: now + 300,
    ...claimOverrides,
  };
  const signingInput = `${profileApplicationBase64Url(JSON.stringify(header))}.${profileApplicationBase64Url(JSON.stringify(claims))}`;
  const signature = await webcrypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", profileApplicationOidcKeyPair.privateKey, new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${profileApplicationBase64Url(signature)}`;
}
const profileApplicationBindings = {
  ...bindings,
  ACCOUNT_SETTINGS_PROFILE_APPLICATION_WORKFLOW_SHA: profileApplicationWorkflowSha,
  RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-profile-application-token",
  STRATEGY_SWITCH_STRATEGY_PROFILES_JSON: JSON.stringify(profileApplicationProfiles),
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ longbridge: [
    { ...account("hk"), variable_scope: "environment", github_environment: "longbridge-hk" },
    { ...account("sg"), variable_scope: "environment", github_environment: "longbridge-sg" },
  ] }),
};
const profileApplicationPersist = await mkdtemp(join(tmpdir(), "qrt-profile-application-"));
let profileApplicationVariableReads = 0;
const profileApplicationMf = new Miniflare({
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08",
  bindings: profileApplicationBindings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  durableObjectsPersist: profileApplicationPersist,
  kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: (request) => {
    const url = String(request?.url || "");
    if (url === "https://token.actions.githubusercontent.com/.well-known/jwks") {
      if (profileApplicationJwksMode === "redirect") return new Response(null, { status: 302, headers: { Location: "https://attacker.example/jwks" } });
      if (profileApplicationJwksMode === "failure") return new Response("unavailable", { status: 503 });
      if (profileApplicationJwksMode === "oversized") return new Response("x".repeat(40 * 1024), { status: 200 });
      if (profileApplicationJwksMode === "wrong-key") return new Response(JSON.stringify({ keys: [{ ...profileApplicationOidcJwk, n: "AQAB" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ keys: [profileApplicationOidcJwk] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("attacker.example")) profileApplicationRedirectFollowed = true;
    profileApplicationVariableReads += 1;
    const values = url.includes("/environments/longbridge-sg/")
      ? profileApplicationVariables.sg
      : profileApplicationVariables.hk;
    return new Response(JSON.stringify({ variables: values }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
});
async function profileApplicationCall(endpoint, { method = "GET", body, cookie = adminCookie, origin = "https://switch.example" } = {}) {
  const response = await profileApplicationMf.dispatchFetch(`https://switch.example${endpoint}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function profileApplicationOidcCall(token, body) {
  const response = await profileApplicationMf.dispatchFetch("https://switch.example/api/internal/account-settings/profile-application/claim", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function profileApplicationOidcStreamCall(token, stream, { workflowSha = profileApplicationWorkflowSha, namespace } = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (resource) => {
    if (String(resource) === "https://token.actions.githubusercontent.com/.well-known/jwks") {
      return new Response(JSON.stringify({ keys: [profileApplicationOidcJwk] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error("unexpected outbound request in streamed-body test");
  };
  try {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const request = new Request("https://switch.example/api/internal/account-settings/profile-application/claim", {
      method: "POST", headers, body: stream, duplex: "half",
    });
    const response = await worker.fetch(request, {
      ...profileApplicationBindings,
      ACCOUNT_SETTINGS_PROFILE_APPLICATION_WORKFLOW_SHA: workflowSha,
      STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace || { idFromName() { return "unused"; }, get() { throw new Error("DO should not be reached"); } },
    }, { waitUntil() {} });
    return { status: response.status, body: await response.json() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}
let unauthenticatedBodyPulls = 0;
const unauthenticatedBody = new ReadableStream({
  pull(controller) { unauthenticatedBodyPulls += 1; controller.enqueue(new Uint8Array([123])); },
}, { highWaterMark: 0 });
assert.equal((await profileApplicationOidcStreamCall("", unauthenticatedBody)).status, 401,
  "missing authorization is rejected before reading the request body");
assert.equal(unauthenticatedBodyPulls, 0, "unauthenticated chunked bodies are not consumed");
let missingPinBodyPulls = 0;
const missingPinBody = new ReadableStream({
  pull(controller) { missingPinBodyPulls += 1; controller.enqueue(new Uint8Array([123])); },
}, { highWaterMark: 0 });
assert.equal((await profileApplicationOidcStreamCall(await profileApplicationOidcToken(), missingPinBody, { workflowSha: "" })).status, 503,
  "without a trusted workflow SHA, the endpoint is closed");
assert.equal(missingPinBodyPulls, 0, "missing trusted configuration is rejected before reading the request body");
const profileApplicationNamespace = await profileApplicationMf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
async function profileApplicationDo(action, fields = {}) {
  const stub = profileApplicationNamespace.get(profileApplicationNamespace.idFromName("runtime-instances"));
  const response = await stub.fetch("https://runtime-instances/", {
    method: "POST",
    body: JSON.stringify({ action, actor: "settings-admin", ...fields }),
  });
  return { status: response.status, body: await response.json() };
}
assert.equal((await profileApplicationCall("/api/admin/runtime-instances", {
  method: "POST", body: { action: "initialize", expected_revision: 0, confirm: "IMPORT_EXISTING_CONFIG" },
})).status, 200);
assert.equal((await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", cookie: null, body: {},
})).status, 401);
assert.equal((await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", cookie: viewerCookie, body: {},
})).status, 403);
assert.equal((await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", origin: "https://attacker.example", body: {},
})).status, 403);
assert.equal((await profileApplicationCall("/api/account-settings/profile-application/claim", {
  method: "POST", body: {},
})).status, 404, "claim remains an internal DO action, with no public route");
assert.equal((await profileApplicationCall("/api/admin/runtime-instances", {
  method: "POST", body: { action: "account_settings_profile_application_claim" },
})).status, 400, "the public runtime-instance API must not forward internal profile-application actions");
const profileApplicationInitial = await profileApplicationCall("/api/account-settings?platform=longbridge&key=hk");
assert.equal(profileApplicationInitial.status, 200);
assert.equal(profileApplicationInitial.body.effective.strategy_profile.value, "synthetic_current_profile");
const profileApplicationDraft = await profileApplicationCall("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "hk",
    identity: profileApplicationInitial.body.identity,
    expected_draft_revision: profileApplicationInitial.body.draft.revision,
    overrides: { strategy_profile: "synthetic_next_profile", income_layer_enabled: false },
  },
});
assert.equal(profileApplicationDraft.status, 200);
const profileApplicationRequest = {
  platform: "longbridge",
  key: "hk",
  request_key: "00000000-0000-4000-8000-000000000041",
  identity: profileApplicationDraft.body.identity,
  expected_instance_revision: profileApplicationDraft.body.instance_revision,
  expected_draft_revision: profileApplicationDraft.body.draft.revision,
  old_profile: "synthetic_current_profile",
  new_profile: "synthetic_next_profile",
};
profileApplicationVariables.hk[1].value = "true";
const enabledProfileApproval = await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", body: profileApplicationRequest,
});
assert.equal(enabledProfileApproval.status, 409, "a true runtime target flag must reject approval");
profileApplicationVariables.hk[1].value = "false";
const wrongCurrentProfile = await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", body: { ...profileApplicationRequest, old_profile: "synthetic_other_profile" },
});
assert.equal(wrongCurrentProfile.status, 409, "approval must bind the trusted current profile");
const unselectableProfile = await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", body: { ...profileApplicationRequest, new_profile: "invented_profile" },
});
assert.equal(unselectableProfile.status, 409, "approval cannot expand beyond the account's selectable catalog");
const incompleteIdentityProfileApproval = await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", body: { ...profileApplicationRequest, identity: { ...profileApplicationRequest.identity, service_name: "" } },
});
assert.equal(incompleteIdentityProfileApproval.status, 400);
const staleInstanceProfileApproval = await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", body: { ...profileApplicationRequest, expected_instance_revision: profileApplicationRequest.expected_instance_revision - 1 },
});
assert.equal(staleInstanceProfileApproval.status, 409);
const mixedFieldProfileApproval = await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", body: profileApplicationRequest,
});
assert.equal(mixedFieldProfileApproval.status, 409, "approval must reject a draft with fields beyond strategy_profile");
const profileOnlyDraft = await profileApplicationCall("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "hk",
    identity: profileApplicationDraft.body.identity,
    expected_draft_revision: profileApplicationDraft.body.draft.revision,
    overrides: { income_layer_enabled: null },
  },
});
assert.equal(profileOnlyDraft.status, 200);
profileApplicationRequest.expected_draft_revision = profileOnlyDraft.body.draft.revision;
profileApplicationVariables.hk[1].value = "0";
const nonLiteralFalseApproval = await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", body: profileApplicationRequest,
});
assert.equal(nonLiteralFalseApproval.status, 409, "only the exact GitHub variable value 'false' may pass the disabled check");
profileApplicationVariables.hk[1].value = "false";
const approvedProfileApplication = await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", body: profileApplicationRequest,
});
assert.equal(approvedProfileApplication.status, 200, JSON.stringify(approvedProfileApplication.body));
assert.equal(approvedProfileApplication.body.application.status, "approved");
assert.equal(approvedProfileApplication.body.application.old_profile, "synthetic_current_profile");
assert.equal(approvedProfileApplication.body.application.new_profile, "synthetic_next_profile");
assert.equal(approvedProfileApplication.body.application.runtime_applied, false);
assert.equal(approvedProfileApplication.body.no_order, true);
assert.equal(approvedProfileApplication.body.execution_authority_granted, false);
const readsAtApproval = profileApplicationVariableReads;
const replayedProfileApproval = await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", body: profileApplicationRequest,
});
assert.equal(replayedProfileApproval.status, 200);
assert.equal(replayedProfileApproval.body.replayed, true);
assert.equal(profileApplicationVariableReads, readsAtApproval, "same request key replay must not need another external read");
const conflictingProfileApproval = await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", body: { ...profileApplicationRequest, new_profile: "synthetic_other_profile" },
});
assert.equal(conflictingProfileApproval.status, 409, "same request key with different contents must conflict");
assert.equal((await profileApplicationCall("/api/account-settings?platform=longbridge&key=hk")).body.operations.apply_strategy, false);

const hkClaim = {
  request_key: profileApplicationRequest.request_key,
  identity: profileApplicationRequest.identity,
  expected_instance_revision: profileApplicationRequest.expected_instance_revision,
  expected_draft_revision: profileApplicationRequest.expected_draft_revision,
  old_profile: profileApplicationRequest.old_profile,
  new_profile: profileApplicationRequest.new_profile,
  current_profile: "synthetic_current_profile",
  runtime_target_enabled: false,
  workflow_run_id: "36550000001",
  workflow_run_attempt: "1",
};
const claimBody = { request_key: hkClaim.request_key };
const approvedOidcRecord = await profileApplicationDo("account_settings_profile_application_lookup", {
  request_key: hkClaim.request_key,
});
assert.equal(approvedOidcRecord.body.application.status, "approved");
const approvedOidcAccount = await profileApplicationDo("account_settings_read", {
  platform: "longbridge", key: "hk",
});
assert.equal(approvedOidcAccount.body.identity.target_name, "hk");
for (const [label, config] of [
  ["repository-scoped variables", { ...approvedOidcAccount.body.config, variable_scope: "repository" }],
  ["wrong GitHub environment", { ...approvedOidcAccount.body.config, github_environment: "longbridge-sg" }],
]) {
  const commands = [];
  const scopeMismatchNamespace = {
    idFromName() { return "runtime-instances"; },
    get() {
      return { async fetch(_url, init = {}) {
        const command = JSON.parse(init.body || "{}");
        commands.push(command.action);
        if (command.action === "account_settings_profile_application_lookup") {
          return new Response(JSON.stringify(approvedOidcRecord.body), { status: 200 });
        }
        if (command.action === "account_settings_read") {
          return new Response(JSON.stringify({ ...approvedOidcAccount.body, config }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false, error: "unexpected_action" }), { status: 400 });
      } };
    },
  };
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(claimBody))); controller.close(); },
  });
  const rejected = await profileApplicationOidcStreamCall(await profileApplicationOidcToken(), body, { namespace: scopeMismatchNamespace });
  assert.equal(rejected.status, 409, `${label} must reject before claim`);
  assert.equal(rejected.body.error, "account_settings_profile_application_target_conflict");
  assert.deepEqual(commands, ["account_settings_profile_application_lookup", "account_settings_read"],
    `${label} must not invoke the DO claim action`);
  const stillApproved = await profileApplicationDo("account_settings_profile_application_lookup", {
    request_key: hkClaim.request_key,
  });
  assert.equal(stillApproved.body.application.status, "approved", `${label} leaves the approval unclaimed`);
}
let oversizeBytesPulled = 0;
let oversizeBodyCanceled = false;
const oversizeBody = new ReadableStream({
  pull(controller) {
    const chunk = new Uint8Array(64 * 1024);
    oversizeBytesPulled += chunk.byteLength;
    controller.enqueue(chunk);
    if (oversizeBytesPulled >= 2 * 1024 * 1024) controller.close();
  },
  cancel() { oversizeBodyCanceled = true; },
}, { highWaterMark: 0 });
assert.equal((await profileApplicationOidcStreamCall(await profileApplicationOidcToken(), oversizeBody)).status, 413,
  "chunked request bodies without Content-Length are limited while streaming");
assert.ok(oversizeBytesPulled < 2 * 1024 * 1024, "the oversize producer is stopped before its full 2 MiB body is emitted");
assert.equal(oversizeBodyCanceled, true, "an oversized request stream is canceled");
let stalledBodyCanceled = false;
const stalledBody = new ReadableStream({
  pull() {},
  cancel() { stalledBodyCanceled = true; },
}, { highWaterMark: 0 });
const stalledBodyStartedAt = Date.now();
assert.equal((await profileApplicationOidcStreamCall(await profileApplicationOidcToken(), stalledBody)).status, 408,
  "an authenticated stalled body times out");
assert.ok(Date.now() - stalledBodyStartedAt < 3000, "the request-body timeout is finite");
assert.equal(stalledBodyCanceled, true, "a stalled request stream is canceled on timeout");
assert.equal((await profileApplicationOidcCall(await profileApplicationOidcToken(), {
  ...claimBody, workflow_run_id: "36559999999",
})).status, 400, "the request body cannot supply run identity or other fields");
assert.equal((await profileApplicationOidcCall("not-a-jwt", claimBody)).status, 401);
const invalidOidcClaimCases = [
  { iss: "https://attacker.example" },
  { aud: "https://switch.example" },
  { repository: "attacker/QuantRuntimeSettings" },
  { ref: "refs/heads/feature" },
  { workflow_ref: "QuantStrategyLab/QuantRuntimeSettings/.github/workflows/other.yml@refs/heads/main" },
  { job_workflow_ref: "QuantStrategyLab/QuantRuntimeSettings/.github/workflows/reusable.yml@refs/heads/main" },
  { workflow_sha: "b".repeat(40) },
  { event_name: "pull_request" },
  { run_id: 36550000001 },
  { run_attempt: "0" },
  { iat: Math.floor(Date.now() / 1000) + 600 },
  { nbf: Math.floor(Date.now() / 1000) + 600 },
  { exp: Math.floor(Date.now() / 1000) - 60 },
];
for (const invalidClaims of invalidOidcClaimCases) {
  assert.equal((await profileApplicationOidcCall(await profileApplicationOidcToken(invalidClaims), claimBody)).status, 401,
    `invalid GitHub OIDC claim rejected: ${Object.keys(invalidClaims).join(",")}`);
}
assert.equal((await profileApplicationOidcCall(await profileApplicationOidcToken({}, { alg: "HS256" }), claimBody)).status, 401,
  "only RS256 signatures are accepted");
assert.equal((await profileApplicationOidcCall(await profileApplicationOidcToken({}, { kid: "unknown-key" }), claimBody)).status, 401,
  "unknown signing keys are rejected");
assert.equal((await profileApplicationOidcCall("x".repeat(8193), claimBody)).status, 401,
  "oversized JWTs are rejected");
const badSignatureToken = await profileApplicationOidcToken();
const badSignatureParts = badSignatureToken.split(".");
badSignatureParts[2] = `${badSignatureParts[2].startsWith("A") ? "B" : "A"}${badSignatureParts[2].slice(1)}`;
assert.equal((await profileApplicationOidcCall(badSignatureParts.join("."), claimBody)).status, 401,
  "an invalid RS256 signature is rejected");
for (const jwksMode of ["redirect", "failure", "oversized"]) {
  profileApplicationJwksMode = jwksMode;
  const jwksFailure = await profileApplicationOidcCall(await profileApplicationOidcToken(), claimBody);
  assert.equal(jwksFailure.status, 503, `JWKS ${jwksMode} fails closed: ${JSON.stringify(jwksFailure.body)}`);
  if (jwksMode === "redirect") assert.equal(profileApplicationRedirectFollowed, false, "JWKS redirects are never followed");
}
profileApplicationJwksMode = "wrong-key";
assert.equal((await profileApplicationOidcCall(await profileApplicationOidcToken(), claimBody)).status, 401,
  "a different JWK under the expected kid cannot validate the signature");
profileApplicationJwksMode = "ok";
assert.equal((await profileApplicationDo("account_settings_profile_application_lookup", {
  request_key: hkClaim.request_key,
})).body.application.status, "approved", "failed authentication never consumes the approval");
const invalidDisabledClaim = await profileApplicationDo("account_settings_profile_application_claim", {
  ...hkClaim, runtime_target_enabled: true,
});
assert.equal(invalidDisabledClaim.status, 409);
const invalidIdentityClaim = await profileApplicationDo("account_settings_profile_application_claim", {
  ...hkClaim, identity: { ...hkClaim.identity, service_name: "other-service" }, workflow_run_id: "36550000002",
});
assert.equal(invalidIdentityClaim.status, 409);
profileApplicationVariables.hk[1].value = "true";
assert.equal((await profileApplicationOidcCall(await profileApplicationOidcToken(), claimBody)).status, 409,
  "the OIDC route refuses to consume when the target is not exactly disabled");
profileApplicationVariables.hk[1].value = "false";
profileApplicationVariables.hk[0].value = "synthetic_drifted_profile";
assert.equal((await profileApplicationOidcCall(await profileApplicationOidcToken(), claimBody)).status, 409,
  "the OIDC route refuses to consume after current-profile drift");
profileApplicationVariables.hk[0].value = "synthetic_current_profile";
const oidcToken = await profileApplicationOidcToken();
const competingClaims = await Promise.all([
  profileApplicationOidcCall(oidcToken, claimBody),
  profileApplicationOidcCall(oidcToken, claimBody),
]);
const successfulClaim = competingClaims.find((result) => result.status === 200 && result.body.claimed === true);
const replayedConcurrentClaim = competingClaims.find((result) => result.status === 200 && result.body.claimed === false);
assert.ok(successfulClaim, "exactly one concurrent OIDC request must acquire the claim");
assert.ok(replayedConcurrentClaim?.body.replayed, "a concurrent same-run replay reads but does not reacquire the claim");
assert.equal(successfulClaim.body.application.status, "claimed");
assert.equal(successfulClaim.body.application.workflow_run_id, "36550000001");
assert.equal(successfulClaim.body.application.runtime_applied, false);
assert.equal(successfulClaim.body.no_order, true);
assert.equal(successfulClaim.body.execution_authority_granted, false);
const winningClaimRequest = hkClaim;
const replayedClaim = await profileApplicationDo("account_settings_profile_application_claim", winningClaimRequest);
assert.equal(replayedClaim.status, 200);
assert.equal(replayedClaim.body.claimed, false, "same-run replay only reads the existing claim record");
assert.equal(replayedClaim.body.replayed, true);
assert.equal((await profileApplicationDo("account_settings_profile_application_claim", {
  ...winningClaimRequest, workflow_run_attempt: "2",
})).status, 409, "a new attempt cannot replay a previous claim as fresh authorization");
const secondRunClaim = await profileApplicationDo("account_settings_profile_application_claim", {
  ...winningClaimRequest, workflow_run_id: "36550000003",
});
assert.equal(secondRunClaim.status, 409, "a claimed application cannot be claimed by a second run");
assert.equal((await profileApplicationOidcCall(await profileApplicationOidcToken({ run_attempt: "2" }), claimBody)).status, 409,
  "a GitHub rerun with a different attempt cannot replay the original claim");
const changedHkAfterClaim = await profileApplicationCall("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "hk",
    identity: profileOnlyDraft.body.identity,
    expected_draft_revision: profileOnlyDraft.body.draft.revision,
    overrides: { strategy_profile: "synthetic_other_profile" },
  },
});
assert.equal(changedHkAfterClaim.status, 200);
const blockedByClaimedHk = await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST",
  body: {
    ...profileApplicationRequest,
    request_key: "00000000-0000-4000-8000-000000000045",
    expected_draft_revision: changedHkAfterClaim.body.draft.revision,
    new_profile: "synthetic_other_profile",
  },
});
assert.equal(blockedByClaimedHk.status, 409, "draft drift must never release a claimed application");
const claimedHkRecord = await profileApplicationDo("account_settings_profile_application_lookup", {
  request_key: profileApplicationRequest.request_key,
});
assert.equal(claimedHkRecord.body.application.status, "claimed");

const sgProfileSettings = await profileApplicationCall("/api/account-settings?platform=longbridge&key=sg");
const sgProfileDraft = await profileApplicationCall("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    identity: sgProfileSettings.body.identity,
    expected_draft_revision: sgProfileSettings.body.draft.revision,
    overrides: { strategy_profile: "synthetic_next_profile" },
  },
});
assert.equal(sgProfileDraft.status, 200);
const sgProfileRequest = {
  platform: "longbridge", key: "sg",
  request_key: "00000000-0000-4000-8000-000000000042",
  identity: sgProfileDraft.body.identity,
  expected_instance_revision: sgProfileDraft.body.instance_revision,
  expected_draft_revision: sgProfileDraft.body.draft.revision,
  old_profile: "synthetic_current_profile",
  new_profile: "synthetic_next_profile",
};
assert.equal((await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", body: sgProfileRequest,
})).status, 200);
const foreignTargetOidcClaim = await profileApplicationOidcCall(oidcToken, { request_key: sgProfileRequest.request_key });
assert.equal(foreignTargetOidcClaim.status, 409, "the fixed HK endpoint refuses an approved non-HK target before claim");
assert.equal((await profileApplicationDo("account_settings_profile_application_lookup", {
  request_key: sgProfileRequest.request_key,
})).body.application.status, "approved", "foreign-target rejection leaves the approval unclaimed");
const changedSgDraft = await profileApplicationCall("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    identity: sgProfileDraft.body.identity,
    expected_draft_revision: sgProfileDraft.body.draft.revision,
    overrides: { strategy_profile: "synthetic_other_profile" },
  },
});
assert.equal(changedSgDraft.status, 200);
const sgClaim = {
  request_key: sgProfileRequest.request_key,
  identity: sgProfileRequest.identity,
  expected_instance_revision: sgProfileRequest.expected_instance_revision,
  expected_draft_revision: sgProfileRequest.expected_draft_revision,
  old_profile: sgProfileRequest.old_profile,
  new_profile: sgProfileRequest.new_profile,
  current_profile: "synthetic_current_profile",
  runtime_target_enabled: false,
  workflow_run_id: "36550000004",
  workflow_run_attempt: "1",
};
const driftedDraftClaim = await profileApplicationDo("account_settings_profile_application_claim", sgClaim);
assert.equal(driftedDraftClaim.status, 409, "draft revision drift must reject the atomic claim");
const rebasedSgRequest = {
  ...sgProfileRequest,
  request_key: "00000000-0000-4000-8000-000000000043",
  expected_draft_revision: changedSgDraft.body.draft.revision,
  new_profile: "synthetic_other_profile",
};
const rebasedSgApproval = await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST", body: rebasedSgRequest,
});
assert.equal(rebasedSgApproval.status, 200, "a valid new draft may be approved after the old approval is invalidated");
assert.equal(rebasedSgApproval.body.application.status, "approved");
const invalidatedSgApproval = await profileApplicationDo("account_settings_profile_application_lookup", {
  request_key: sgProfileRequest.request_key,
});
assert.equal(invalidatedSgApproval.status, 200);
assert.equal(invalidatedSgApproval.body.application.status, "invalidated", "a stale unclaimed approval must be retained in a terminal state");
assert.equal((await profileApplicationDo("account_settings_profile_application_claim", sgClaim)).status, 409,
  "an invalidated approval can never be claimed");
const liveInstances = await profileApplicationCall("/api/admin/runtime-instances");
const changedInstance = await profileApplicationCall("/api/admin/runtime-instances", {
  method: "POST",
  body: {
    action: "set_broker_environment",
    expected_revision: liveInstances.body.revision,
    platform: "longbridge", key: "sg", broker_environment: "live",
  },
});
assert.equal(changedInstance.status, 200);
const reboundSgSettings = await profileApplicationCall("/api/account-settings?platform=longbridge&key=sg");
const reboundSgDraft = await profileApplicationCall("/api/account-settings", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    identity: reboundSgSettings.body.identity,
    expected_draft_revision: reboundSgSettings.body.draft.revision,
    acknowledge_identity_conflict: true,
    overrides: { strategy_profile: "synthetic_other_profile" },
  },
});
assert.equal(reboundSgDraft.status, 200);
const identityReboundApproval = await profileApplicationCall("/api/account-settings/profile-application/approve", {
  method: "POST",
  body: {
    platform: "longbridge", key: "sg",
    request_key: "00000000-0000-4000-8000-000000000044",
    identity: reboundSgDraft.body.identity,
    expected_instance_revision: reboundSgDraft.body.instance_revision,
    expected_draft_revision: reboundSgDraft.body.draft.revision,
    old_profile: "synthetic_current_profile", new_profile: "synthetic_other_profile",
  },
});
assert.equal(identityReboundApproval.status, 200, "identity/revision drift also releases only a stale unclaimed approval");
const invalidatedByIdentityDrift = await profileApplicationDo("account_settings_profile_application_lookup", {
  request_key: rebasedSgRequest.request_key,
});
assert.equal(invalidatedByIdentityDrift.body.application.status, "invalidated");
const driftedInstanceClaim = await profileApplicationDo("account_settings_profile_application_claim", {
  ...sgClaim,
  request_key: rebasedSgRequest.request_key,
  new_profile: rebasedSgRequest.new_profile,
  expected_draft_revision: rebasedSgRequest.expected_draft_revision,
});
assert.equal(driftedInstanceClaim.status, 409, "instance revision and account identity drift must reject the claim");
await profileApplicationMf.dispose();
console.log("account_settings_worker_validation: PASS");
