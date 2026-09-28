import assert from "node:assert/strict";
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
    overrides: { strategy_profile: "draft-only-profile" },
  },
});
assert.equal(namedDraft.status, 200);
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
assert.equal(conflicted.body.draft.overrides.strategy_profile, "draft-only-profile");
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
assert.equal(retained.body.draft.overrides.strategy_profile, "draft-only-profile");
const hkConfig = (await call("/api/admin/runtime-instances")).body.instances.find((item) => item.key === "hk").config;
assert.equal(hkConfig.default_strategy_profile, "russell_top50_leader_rotation");
assert.equal(JSON.stringify(hkConfig).includes("draft-only-profile"), false);
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
    overrides: { strategy_profile: "raced-draft" },
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
assert.equal(JSON.stringify(sgAfterRace.body.draft.overrides).includes("raced-draft"), false);

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
    overrides: { option_overlay_enabled: false },
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

await mf.dispose();

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
  outboundService: () => new Response(JSON.stringify({
    variables: [{ name: "LONGBRIDGE_RESERVED_CASH_RATIO", value: "0.25" }],
  }), { status: 200, headers: { "Content-Type": "application/json" } }),
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
const known = await knownCall("/api/account-settings?platform=longbridge&key=sg");
assert.equal(known.status, 200);
assert.equal(known.body.effective.reserved_cash_ratio.status, "known");
assert.equal(known.body.effective.reserved_cash_ratio.value, "0.25");
const missing = await knownCall("/api/account-settings?platform=longbridge&key=hk");
assert.equal(missing.body.effective.reserved_cash_ratio.value, "0.25");
await knownMf.dispose();
console.log("account_settings_worker_validation: PASS");
