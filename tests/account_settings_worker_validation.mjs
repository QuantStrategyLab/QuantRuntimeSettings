import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { __test } from "../web/strategy-switch-console/worker.js";

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
  ALLOWED_GITHUB_LOGINS: "settings-admin",
  STRATEGY_SWITCH_ADMIN_LOGINS: "settings-admin",
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify(accountOptions),
};
const adminCookie = `qsl_switch_session=${await __test.makeSession("settings-admin", [], bindings)}`;
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
assert.equal(hkSettings.body.operations.apply_strategy, false);
assert.equal(hkSettings.body.operations.activation, false);
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

await mf.dispose();
console.log("account_settings_worker_validation: PASS");
