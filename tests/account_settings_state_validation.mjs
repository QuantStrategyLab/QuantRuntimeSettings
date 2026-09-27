import assert from "node:assert/strict";
import { createAccountSettingsController } from "../web/strategy-switch-console/frontend/src/accountSettingsState.ts";

function settings(key, preference, identity, marker) {
  return {
    platform: "longbridge",
    key,
    identity,
    marker,
    draft: { status: "current", revision: 2, overrides: {} },
    risk: { revision: 4, preference, scope_id: `longbridge--${key}` },
    operations: { save_draft: true, save_risk_preference: true, apply_strategy: false },
    effective: { strategy_profile: { status: "unknown" }, broker_environment: { status: "known", value: "paper" } },
  };
}
const identityA = {
  platform: "longbridge", key: "hk", target_name: "hk", broker_environment: "paper",
  account_selector: "HK", deployment_selector: "hk", account_scope: "HK", service_name: "longbridge-hk-service",
};
const identityB = {
  platform: "longbridge", key: "sg", target_name: "sg", broker_environment: "paper",
  account_selector: "SG", deployment_selector: "sg", account_scope: "SG", service_name: "longbridge-sg-service",
};
const failure = "版本已变化，未覆盖已保存内容。";

const controller = createAccountSettingsController();
const readA = controller.select({ platform: "longbridge", key: "hk" });
const readB = controller.select({ platform: "longbridge", key: "sg" });
assert.equal(controller.applyRead(readB, settings("sg", "BALANCED_COMPOUNDING", identityB, "b-read")), true);
assert.equal(controller.applyRead(readA, settings("hk", "GROWTH_COMPOUNDING", identityA, "a-read")), false, "a late read cannot replace the selected account");
assert.equal(controller.view().settings.marker, "b-read");
assert.equal(controller.view().preference, "BALANCED_COMPOUNDING");

const sameAccount = createAccountSettingsController();
const first = sameAccount.select({ platform: "longbridge", key: "hk" });
const second = sameAccount.start("read");
assert.equal(sameAccount.applyRead(second, settings("hk", "BALANCED_COMPOUNDING", identityA, "second")), true);
assert.equal(sameAccount.applyRead(first, settings("hk", "GROWTH_COMPOUNDING", identityA, "first")), false, "an older read of the same account stays stale");
assert.equal(sameAccount.view().settings.marker, "second");

const saving = createAccountSettingsController();
const loadedA = saving.select({ platform: "longbridge", key: "hk" });
assert.equal(saving.applyRead(loadedA, settings("hk", "BALANCED_COMPOUNDING", identityA, "hk")), true);
assert.equal(saving.edit({ preference: "GROWTH_COMPOUNDING" }), true);
const saveA = saving.startSave("risk");
assert.equal(saveA.body.key, "hk");
assert.equal(saveA.body.risk_preference, "GROWTH_COMPOUNDING");
assert.equal(saveA.body.identity, identityA);
const loadedB = saving.select({ platform: "longbridge", key: "sg" });
assert.equal(saving.requestBody(saveA), null, "the previous account form cannot be sent after switching");
assert.equal(saving.applySave(saveA, settings("hk", "GROWTH_COMPOUNDING", identityA, "late-save")), false);
assert.equal(saving.applyRead(loadedB, settings("sg", "BALANCED_COMPOUNDING", identityB, "sg")), true);
assert.equal(saving.view().settings.key, "sg");
assert.equal(saving.view().preference, "BALANCED_COMPOUNDING");
const saveB = saving.startSave("risk");
assert.ok(saving.requestBody(saveB));
assert.equal(saveB.body.key, "sg");
assert.equal(saveB.body.risk_preference, "BALANCED_COMPOUNDING");
assert.equal(saveB.body.identity, identityB);
assert.equal(saveB.body.platform === "longbridge" && saveB.body.key === "sg" && saveB.body.risk_preference !== "GROWTH_COMPOUNDING", true);

const failed = createAccountSettingsController();
const failedRead = failed.select({ platform: "longbridge", key: "hk" });
assert.equal(failed.applyRead(failedRead, settings("hk", "BALANCED_COMPOUNDING", identityA, "before")), true);
const failedSave = failed.startSave("risk");
assert.equal(failed.fail(failedSave, failure), true);
const refresh = failed.start("refresh");
assert.equal(failed.applyRefresh(refresh, settings("hk", "BALANCED_COMPOUNDING", identityA, "refreshed")), true);
assert.equal(failed.view().notice, failure, "a later fact refresh keeps the failed save notice");
assert.equal(failed.view().settings.marker, "refreshed");
assert.equal(failed.finish(failedSave), false);
assert.equal(failed.view().notice, failure);
console.log("account_settings_state_validation: PASS");
