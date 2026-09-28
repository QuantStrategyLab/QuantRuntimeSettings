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

const editors = createAccountSettingsController();
const editorRead = editors.select({ platform: "longbridge", key: "hk" });
assert.equal(editors.applyRead(editorRead, settings("hk", "BALANCED_COMPOUNDING", identityA, "base")), true);
assert.equal(editors.edit({ floor: "12.50", floorTouched: true, preference: "GROWTH_COMPOUNDING" }), true);
const riskSave = editors.startSave("risk");
assert.equal(Object.hasOwn(riskSave.body, "overrides"), false);
assert.equal(editors.edit({ floor: "15", floorTouched: true }), true);
assert.equal(editors.applySave(riskSave, settings("hk", "GROWTH_COMPOUNDING", identityA, "risk-saved"), "risk-saved"), true);
assert.equal(editors.view().preference, "GROWTH_COMPOUNDING");
assert.equal(editors.view().draft.floor, "15");
assert.equal(editors.view().draft.floorTouched, true);
const cashSave = editors.startSave("draft");
assert.equal(cashSave.body.overrides.reserved_cash_floor, "15");
assert.equal(Object.hasOwn(cashSave.body, "risk_preference"), false);
assert.equal(editors.edit({ preference: "CAPITAL_PRESERVATION" }), true);
const cashPayload = settings("hk", "GROWTH_COMPOUNDING", identityA, "cash-saved");
cashPayload.draft.overrides = { reserved_cash_floor: "15" };
assert.equal(editors.applySave(cashSave, cashPayload, "已保存，尚未应用"), true);
assert.equal(editors.view().preference, "CAPITAL_PRESERVATION");
assert.equal(editors.view().draft.floor, "15");
assert.equal(editors.view().draft.floorTouched, false);
assert.equal(editors.view().notice, "已保存，尚未应用");

const refreshKeeps = createAccountSettingsController();
const refreshRead = refreshKeeps.select({ platform: "longbridge", key: "hk" });
assert.equal(refreshKeeps.applyRead(refreshRead, settings("hk", "BALANCED_COMPOUNDING", identityA, "before-refresh")), true);
assert.equal(refreshKeeps.edit({ floor: "8", floorTouched: true, clearFloor: false, preference: "CAPITAL_PRESERVATION" }), true);
const failedRisk = refreshKeeps.startSave("risk");
assert.equal(refreshKeeps.fail(failedRisk, failure), true);
const refreshOp = refreshKeeps.start("refresh");
assert.equal(refreshKeeps.applyRefresh(refreshOp, settings("hk", "BALANCED_COMPOUNDING", identityA, "after-refresh")), true);
assert.equal(refreshKeeps.view().draft.floor, "8");
assert.equal(refreshKeeps.view().draft.floorTouched, true);
assert.equal(refreshKeeps.view().preference, "CAPITAL_PRESERVATION");
assert.equal(refreshKeeps.view().notice, failure);
assert.equal(refreshKeeps.edit({ floor: "", floorTouched: false, clearFloor: false, preference: "BALANCED_COMPOUNDING" }), true);
assert.equal(refreshKeeps.view().draft.floorTouched, false);
assert.equal(refreshKeeps.view().preference, "BALANCED_COMPOUNDING");

const conflicted = createAccountSettingsController();
const conflictRead = conflicted.select({ platform: "longbridge", key: "hk" });
const conflictPayload = settings("hk", "BALANCED_COMPOUNDING", identityA, "conflict");
conflictPayload.draft.status = "identity_conflict";
conflictPayload.draft.overrides = { reserved_cash_floor: "4" };
assert.equal(conflicted.applyRead(conflictRead, conflictPayload), true);
assert.equal(conflicted.edit({ floor: "9", floorTouched: true }), true);
assert.equal(conflicted.startSave("draft"), null);
const missingIdentity = settings("hk", "BALANCED_COMPOUNDING", identityA, "missing");
delete missingIdentity.identity;
const missing = createAccountSettingsController();
const missingRead = missing.select({ platform: "longbridge", key: "hk" });
assert.equal(missing.applyRead(missingRead, missingIdentity), true);
assert.equal(missing.edit({ floor: "1", floorTouched: true }), true);
assert.equal(missing.startSave("draft"), null);
assert.equal(missing.startSave("risk"), null);
console.log("account_settings_state_validation: PASS");
