import assert from "node:assert/strict";
import { createAccountSettingsController, pendingDraftOverrides, refreshAccountSettingsReadback } from "../web/strategy-switch-console/frontend/src/accountSettingsState.ts";

function settings(key, preference, identity, marker) {
  return {
    ok: true, adopted: false, no_order: true, execution_authority_granted: false,
    platform: "longbridge",
    key,
    identity,
    marker,
    draft: { status: "current", revision: 2, identity, current_identity: identity, overrides: {} },
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
assert.deepEqual(saveA.body.identity, identityA);
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
assert.deepEqual(saveB.body.identity, identityB);
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
const riskSaved = settings("hk", "GROWTH_COMPOUNDING", identityA, "risk-saved");
riskSaved.risk.revision = 5;
assert.equal(editors.applySave(riskSave, riskSaved, "risk-saved"), true);
assert.equal(editors.view().preference, "GROWTH_COMPOUNDING");
assert.equal(editors.view().draft.floor, "15");
assert.equal(editors.view().draft.floorTouched, true);
const cashSave = editors.startSave("draft");
assert.equal(cashSave.body.overrides.reserved_cash_floor, "15");
assert.equal(Object.hasOwn(cashSave.body, "risk_preference"), false);
assert.equal(editors.edit({ preference: "CAPITAL_PRESERVATION" }), true);
const cashPayload = settings("hk", "GROWTH_COMPOUNDING", identityA, "cash-saved");
cashPayload.draft.revision = 3;
cashPayload.risk.revision = 5;
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

const sameRefresh = createAccountSettingsController();
const before = sameRefresh.select({ platform: "longbridge", key: "hk" });
assert.equal(sameRefresh.applyRead(before, settings("hk", "GROWTH_COMPOUNDING", identityA, "before")), true);
assert.equal(sameRefresh.edit({ floor: "15", floorTouched: true, clearFloor: false, preference: "" }), true);
const refreshSame = sameRefresh.start("refresh");
const refreshed = settings("hk", "GROWTH_COMPOUNDING", identityA, "after");
refreshed.effective = { strategy_profile: { status: "known", value: "russell_top50_leader_rotation" }, broker_environment: { status: "known", value: "live" }, reserved_cash_floor: { status: "known", value: "20" } };
assert.equal(sameRefresh.applyRefresh(refreshSame, refreshed), true);
assert.equal(sameRefresh.view().draft.floor, "15");
assert.equal(sameRefresh.view().draft.floorTouched, true);
assert.equal(sameRefresh.view().preference, "");
assert.equal(sameRefresh.view().settings.effective.strategy_profile.value, "russell_top50_leader_rotation");
assert.equal(sameRefresh.view().settings.effective.reserved_cash_floor.value, "20");
const staleRefresh = sameRefresh.start("refresh");
const switched = sameRefresh.select({ platform: "longbridge", key: "sg" });
assert.equal(sameRefresh.applyRead(switched, settings("sg", "BALANCED_COMPOUNDING", identityB, "sg")), true);
assert.equal(sameRefresh.applyRefresh(staleRefresh, refreshed), false);
assert.equal(sameRefresh.view().settings.key, "sg");
assert.equal(sameRefresh.view().settings.marker, "sg");

const incomeKeep = createAccountSettingsController();
const incomeRead = incomeKeep.select({ platform: "longbridge", key: "hk" });
assert.equal(incomeKeep.applyRead(incomeRead, settings("hk", "BALANCED_COMPOUNDING", identityA, "income")), true);
assert.equal(incomeKeep.edit({ income: "true", incomeTouched: true, preference: "CAPITAL_PRESERVATION" }), true);
const incomeRisk = incomeKeep.startSave("risk");
const incomeRiskPayload = settings("hk", "CAPITAL_PRESERVATION", identityA, "income-saved");
incomeRiskPayload.risk.revision = 5;
assert.equal(incomeKeep.applySave(incomeRisk, incomeRiskPayload, "风险偏好已保存，不改变执行限额或启用状态。"), true);
assert.equal(incomeKeep.view().draft.income, "true");
assert.equal(incomeKeep.view().draft.incomeTouched, true);
assert.equal(incomeKeep.view().preference, "CAPITAL_PRESERVATION");

const drifted = createAccountSettingsController();
const driftedRead = drifted.select({ platform: "longbridge", key: "hk" });
assert.equal(drifted.applyRead(driftedRead, settings("hk", "BALANCED_COMPOUNDING", identityA, "base")), true);
assert.equal(drifted.edit({ floor: "8", floorTouched: true, income: "false", incomeTouched: true, preference: "GROWTH_COMPOUNDING" }), true);
const driftedRefresh = drifted.start("refresh");
const driftedPayload = settings("hk", "BALANCED_COMPOUNDING", identityA, "new-effective");
driftedPayload.draft.revision = 9;
driftedPayload.risk.revision = 11;
driftedPayload.effective = { strategy_profile: { status: "known", value: "after" }, income_layer_enabled: { status: "known", value: true } };
assert.equal(drifted.applyRefresh(driftedRefresh, driftedPayload), true);
assert.equal(drifted.view().draft.floor, "8");
assert.equal(drifted.view().draft.income, "false");
assert.equal(drifted.view().preference, "GROWTH_COMPOUNDING");
assert.equal(drifted.view().settings.effective.strategy_profile.value, "after");
assert.equal(drifted.view().review.draft, true);
assert.equal(drifted.view().review.risk, true);
const repeatedDriftRefresh = drifted.start("refresh");
assert.equal(drifted.applyRefresh(repeatedDriftRefresh, driftedPayload), true);
assert.equal(drifted.view().review.draft, true, "repeated refresh must preserve unacknowledged draft conflict");
assert.equal(drifted.view().review.risk, true, "repeated refresh must preserve unacknowledged risk conflict");
assert.equal(drifted.startSave("draft"), null);
assert.equal(drifted.startSave("risk"), null);
assert.equal(drifted.acknowledgeReview("draft"), true);
const rebound = drifted.startSave("draft");
assert.equal(rebound.body.expected_draft_revision, 9);
assert.equal(rebound.body.overrides.reserved_cash_floor, "8");
assert.equal(rebound.body.overrides.income_layer_enabled, false);
assert.equal(drifted.startSave("risk"), null);
assert.equal(drifted.revertRisk(), true);
assert.equal(drifted.view().preference, "BALANCED_COMPOUNDING");
assert.equal(drifted.view().review.risk, false);
assert.equal(drifted.view().draft.incomeTouched, true);

const sameRevision = createAccountSettingsController();
const sameRevisionRead = sameRevision.select({ platform: "longbridge", key: "hk" });
assert.equal(sameRevision.applyRead(sameRevisionRead, settings("hk", "BALANCED_COMPOUNDING", identityA, "same")), true);
assert.equal(sameRevision.edit({ income: "clear", incomeTouched: true }), true);
const sameRevisionRefresh = sameRevision.start("refresh");
const sameRevisionPayload = settings("hk", "BALANCED_COMPOUNDING", identityA, "same-refresh");
sameRevisionPayload.effective = { income_layer_enabled: { status: "known", value: false } };
assert.equal(sameRevision.applyRefresh(sameRevisionRefresh, sameRevisionPayload), true);
assert.equal(sameRevision.view().review.draft, false);
assert.equal(sameRevision.view().draft.income, "clear");
const clearSave = sameRevision.startSave("draft");
assert.equal(clearSave.body.expected_draft_revision, 2);
assert.equal(clearSave.body.overrides.income_layer_enabled, null);
assert.equal(Object.hasOwn(clearSave.body.overrides, "reserved_cash_floor"), false);

const identityDrift = createAccountSettingsController();
const identityRead = identityDrift.select({ platform: "longbridge", key: "hk" });
assert.equal(identityDrift.applyRead(identityRead, settings("hk", "BALANCED_COMPOUNDING", identityA, "identity")), true);
assert.equal(identityDrift.edit({ income: "true", incomeTouched: true }), true);
const identityRefresh = identityDrift.start("refresh");
const identityPayload = settings("hk", "BALANCED_COMPOUNDING", { ...identityA, account_selector: "HK2" }, "identity-next");
identityPayload.effective = { income_layer_enabled: { status: "known", value: false } };
assert.equal(identityDrift.applyRefresh(identityRefresh, identityPayload), true);
assert.equal(identityDrift.view().draft.income, "true");
assert.equal(identityDrift.view().settings.effective.income_layer_enabled.value, false);
assert.equal(identityDrift.view().review.draft, true);
assert.equal(identityDrift.view().review.risk, false);
assert.equal(identityDrift.startSave("draft"), null);
assert.equal(identityDrift.revertDraft(), true);
assert.equal(identityDrift.view().draft.incomeTouched, false);
assert.equal(identityDrift.view().review.draft, false);

// Saving one group must not silently adopt a changed version for unsaved edits in another.
for (const kind of ["risk", "draft"]) {
  const c = createAccountSettingsController();
  c.applyRead(c.select({ platform: "longbridge", key: "hk" }), settings("hk", "BALANCED_COMPOUNDING", identityA, "initial"));
  c.edit({ floor: "15", floorTouched: true, preference: "GROWTH_COMPOUNDING" });
  const op = c.startSave(kind);
  const response = settings("hk", kind === "risk" ? "GROWTH_COMPOUNDING" : "BALANCED_COMPOUNDING", identityA, "external-change");
  response.draft.revision = kind === "risk" ? 33 : 3;
  response.risk.revision = kind === "risk" ? 5 : 44;
  if (kind === "draft") response.draft.overrides = { reserved_cash_floor: "15" };
  c.applySave(op, response, "saved");
  const other = kind === "risk" ? "draft" : "risk";
  assert.equal(c.view().review[other], true);
  assert.equal(c.startSave(other), null);
}
const retryClear = createAccountSettingsController();
retryClear.applyRead(retryClear.select({ platform: "longbridge", key: "hk" }), settings("hk", "BALANCED_COMPOUNDING", identityA, "initial"));
retryClear.edit({ preference: "" });
retryClear.applyUnavailable(retryClear.start("refresh"), "unavailable");
assert.equal(retryClear.startSave("risk"), null);
assert.equal(retryClear.riskDirty(), true, "failed refresh still warns before discarding an unsaved clear");
retryClear.applyRefresh(retryClear.start("refresh"), settings("hk", "BALANCED_COMPOUNDING", identityA, "retry"));
assert.equal(retryClear.view().preference, "", "read retry preserves an unsaved preference clear");

const ratioOnly = createAccountSettingsController();
const ratioBase = settings("hk", "BALANCED_COMPOUNDING", identityA, "ratio");
ratioBase.draft.overrides = { reserved_cash_floor: "10" };
ratioOnly.applyRead(ratioOnly.select({ platform: "longbridge", key: "hk" }), ratioBase);
assert.equal(ratioOnly.startSave("cash"), null, "an unedited floor-only draft does not send a ratio");
assert.equal(ratioOnly.startSave("draft"), null);
ratioOnly.edit({ cashMode: "both", floor: "10", ratio: "0.25", percent: "25", floorTouched: true, ratioTouched: true });
const bothSave = ratioOnly.startSave("cash");
assert.equal(bothSave.body.overrides.reserved_cash_floor, "10");
assert.equal(bothSave.body.overrides.reserved_cash_ratio, "0.25");
assert.equal(Object.hasOwn(bothSave.body.overrides, "income_layer_enabled"), false);
ratioOnly.edit({ income: "false", incomeTouched: true });
const incomeOnly = ratioOnly.startSave("income");
assert.equal(incomeOnly.body.overrides.income_layer_enabled, false);
assert.equal(Object.hasOwn(incomeOnly.body.overrides, "reserved_cash_ratio"), false);
const incomeResponse = settings("hk", "BALANCED_COMPOUNDING", identityA, "income-saved");
incomeResponse.draft.revision = 3;
incomeResponse.draft.overrides = { reserved_cash_floor: "10", income_layer_enabled: false };
assert.equal(ratioOnly.applySave(incomeOnly, incomeResponse, "saved"), true);
assert.equal(ratioOnly.view().draft.cashMode, "both");
assert.equal(ratioOnly.view().draft.ratio, "0.25");
const repeated = createAccountSettingsController();
repeated.applyRead(repeated.select({ platform: "longbridge", key: "hk" }), settings("hk", "BALANCED_COMPOUNDING", identityA, "repeat"));
repeated.edit({ cashMode: "floor", floor: "9", ratio: "0", percent: "0", floorTouched: true, ratioTouched: true });
const ratioDrifted = settings("hk", "BALANCED_COMPOUNDING", identityA, "repeat-next");
ratioDrifted.draft.revision = 9;
assert.equal(repeated.applyRefresh(repeated.start("refresh"), ratioDrifted), true);
assert.equal(repeated.view().review.draft, true);
assert.equal(repeated.applyRefresh(repeated.start("refresh"), ratioDrifted), true);
assert.equal(repeated.view().review.draft, true, "another refresh keeps an unconfirmed conflict");
assert.equal(repeated.view().draft.floor, "9");
assert.equal(repeated.startSave("cash"), null);
const closed = createAccountSettingsController();
const closedPayload = settings("hk", "BALANCED_COMPOUNDING", identityA, "closed");
closedPayload.operations = { save_draft: false, save_risk_preference: false, apply_strategy: false, activation: false };
closed.applyRead(closed.select({ platform: "longbridge", key: "hk" }), closedPayload);
closed.edit({ cashMode: "ratio", floor: "0", ratio: "1", percent: "100", floorTouched: true, ratioTouched: true, preference: "GROWTH_COMPOUNDING" });
assert.equal(closed.startSave("cash"), null);
assert.equal(closed.startSave("draft"), null);
assert.equal(closed.startSave("risk"), null);
const illegal = createAccountSettingsController();
illegal.applyRead(illegal.select({ platform: "longbridge", key: "hk" }), settings("hk", "BALANCED_COMPOUNDING", identityA, "illegal"));
illegal.edit({ cashMode: "ratio", floor: "0", ratio: "1.2", percent: "120", floorTouched: true, ratioTouched: true });
assert.equal(illegal.startSave("cash"), null);
const inherit = createAccountSettingsController();
const inherited = settings("hk", "BALANCED_COMPOUNDING", identityA, "inherit");
inherited.draft.overrides = { reserved_cash_floor: "10", reserved_cash_ratio: "0.2" };
inherit.applyRead(inherit.select({ platform: "longbridge", key: "hk" }), inherited);
inherit.edit({ cashMode: "inherit", floor: "", ratio: "", percent: "", floorTouched: true, ratioTouched: true, clearFloor: true, clearRatio: true });
const inheritSave = inherit.startSave("cash");
assert.equal(inheritSave.body.overrides.reserved_cash_floor, null);
assert.equal(inheritSave.body.overrides.reserved_cash_ratio, null);
const protectedRead = createAccountSettingsController();
protectedRead.applyRead(protectedRead.select({ platform: "longbridge", key: "hk" }), settings("hk", "BALANCED_COMPOUNDING", identityA, "fail"));
protectedRead.edit({ cashMode: "ratio", floor: "0", ratio: "0.1", percent: "10", floorTouched: true, ratioTouched: true, preference: "" });
protectedRead.applyUnavailable(protectedRead.start("refresh"), "unavailable");
assert.equal(protectedRead.view().draft.ratio, "0.1");
assert.equal(protectedRead.view().preference, "");
assert.equal(protectedRead.riskDirty(), true);
const clearedPercent = createAccountSettingsController();
clearedPercent.applyRead(clearedPercent.select({ platform: "longbridge", key: "hk" }), settings("hk", "BALANCED_COMPOUNDING", identityA, "cleared-percent"));
clearedPercent.edit({ cashMode: "ratio", floor: "0", ratio: "0.25", percent: "", floorTouched: true, ratioTouched: true });
assert.equal(clearedPercent.startSave("cash"), null, "clearing the percent does not save the previous ratio");
const exactPercent = createAccountSettingsController();
exactPercent.applyRead(exactPercent.select({ platform: "longbridge", key: "hk" }), settings("hk", "BALANCED_COMPOUNDING", identityA, "exact-percent"));
exactPercent.edit({ cashMode: "ratio", floor: "0", ratio: "1", percent: "100.0000000000000000001", floorTouched: true, ratioTouched: true });
assert.equal(exactPercent.startSave("cash"), null, "a percent above 100 does not fall back to the previous ratio");
const legalPercent = createAccountSettingsController();
legalPercent.applyRead(legalPercent.select({ platform: "longbridge", key: "hk" }), settings("hk", "BALANCED_COMPOUNDING", identityA, "legal-percent"));
legalPercent.edit({ cashMode: "ratio", floor: "0", ratio: "", percent: "100.000", floorTouched: true, ratioTouched: true });
assert.equal(legalPercent.startSave("cash").body.overrides.reserved_cash_ratio, "1");
const grouped = createAccountSettingsController();
grouped.applyRead(grouped.select({ platform: "longbridge", key: "hk" }), settings("hk", "BALANCED_COMPOUNDING", identityA, "grouped"));
grouped.edit({ cashMode: "ratio", floor: "0", ratio: "0.1", percent: "10", floorTouched: true, ratioTouched: true, income: "true", incomeTouched: true });
const groupedCash = grouped.startSave("cash");
assert.equal(Object.hasOwn(groupedCash.body.overrides, "income_layer_enabled"), false);
const groupedSaved = settings("hk", "BALANCED_COMPOUNDING", identityA, "grouped-saved");
groupedSaved.draft.revision = 3;
groupedSaved.draft.overrides = { reserved_cash_floor: "0", reserved_cash_ratio: "0.1" };
assert.equal(grouped.applySave(groupedCash, groupedSaved, "已保存，尚未应用"), true);
assert.equal(grouped.view().draft.incomeTouched, true);
assert.equal(grouped.view().draft.income, "true");
const groupedRefresh = grouped.start("refresh");
assert.equal(grouped.applyRefresh(groupedRefresh, groupedSaved), true);
assert.equal(grouped.view().draft.incomeTouched, true);
assert.equal(grouped.view().draft.income, "true");
const layered = createAccountSettingsController();
const layeredBase = settings("hk", "BALANCED_COMPOUNDING", identityA, "layered");
layeredBase.operations.save_option_draft = true;
layered.applyRead(layered.select({ platform: "longbridge", key: "hk" }), layeredBase);
layered.edit({ strategy: "russell", strategyTouched: true, option: "false", optionTouched: true, income: "true", incomeTouched: true, cashMode: "floor", floor: "3", ratio: "0", percent: "0", floorTouched: true, ratioTouched: true });
const strategyOnly = layered.startSave("strategy");
assert.equal(strategyOnly.body.overrides.strategy_profile, "russell");
assert.equal(Object.hasOwn(strategyOnly.body.overrides, "option_overlay_enabled"), false);
assert.equal(Object.hasOwn(strategyOnly.body.overrides, "income_layer_enabled"), false);
assert.equal(Object.hasOwn(strategyOnly.body.overrides, "reserved_cash_floor"), false);
const optionOnly = layered.startSave("option");
assert.equal(optionOnly.body.overrides.option_overlay_enabled, false);
assert.equal(Object.hasOwn(optionOnly.body.overrides, "strategy_profile"), false);
assert.equal(Object.hasOwn(optionOnly.body.overrides, "reserved_cash_floor"), false);
const layeredSaved = settings("hk", "BALANCED_COMPOUNDING", identityA, "layered-saved");
layeredSaved.operations.save_option_draft = true;
layeredSaved.draft.revision = 3;
layeredSaved.draft.overrides = { option_overlay_enabled: false };
assert.equal(layered.applySave(optionOnly, layeredSaved, "saved"), true);
assert.equal(layered.view().draft.strategy, "russell");
assert.equal(layered.view().draft.strategyTouched, true);
assert.equal(layered.view().draft.income, "true");
assert.equal(layered.view().draft.floor, "3");
assert.equal(layered.applyRefresh(layered.start("refresh"), layeredSaved), true);
assert.equal(layered.view().draft.strategyTouched, true);
assert.equal(layered.view().draft.incomeTouched, true);
assert.equal(layered.view().draft.cashMode, "floor");
layered.edit({ option: "clear", optionTouched: true });
const strategyClearsOption = layered.startSave("strategy");
assert.equal(strategyClearsOption.body.overrides.strategy_profile, "russell");
assert.equal(strategyClearsOption.body.overrides.option_overlay_enabled, null);
const optionClosed = createAccountSettingsController();
const optionClosedBase = settings("hk", "BALANCED_COMPOUNDING", identityA, "option-closed");
optionClosedBase.operations.save_option_draft = false;
optionClosed.applyRead(optionClosed.select({ platform: "longbridge", key: "hk" }), optionClosedBase);
optionClosed.edit({ option: "true", optionTouched: true });
assert.equal(optionClosed.startSave("option"), null, "a new option value stays closed when the bound profile does not define one");
optionClosed.edit({ option: "clear", optionTouched: true });
assert.equal(optionClosed.startSave("option").body.overrides.option_overlay_enabled, null);

const baseDcaDraft = {
  strategy: "ibit_smart_dca", floor: "", ratio: "", percent: "", income: "", option: "",
  dcaMode: "smart", dcaAmount: "75.25", dcaProfile: "ibit_smart_dca",
  strategyTouched: true, incomeTouched: false, optionTouched: false, floorTouched: false, ratioTouched: false,
  dcaTouched: true, clearStrategy: false, clearFloor: false, clearRatio: false, clearDca: false, cashMode: "", acknowledge: false,
};
assert.deepEqual(pendingDraftOverrides(baseDcaDraft, "strategy"), {
  dca_mode: "smart", dca_base_investment_usd: "75.25", strategy_profile: "ibit_smart_dca",
}, "DCA settings and strategy are submitted as one draft group");
for (const amount of ["", "0", "-2", "1e2", "Infinity", "1.2.3", "1".repeat(33)]) {
  assert.equal(pendingDraftOverrides({ ...baseDcaDraft, dcaAmount: amount }, "strategy"), null, `invalid DCA amount ${amount}`);
}
assert.deepEqual(pendingDraftOverrides({ ...baseDcaDraft, clearStrategy: true, clearDca: true }, "strategy"), {
  dca_mode: null, dca_base_investment_usd: null, strategy_profile: null,
}, "clearing a selected DCA draft clears both its fields and its strategy binding");

const dcaSave = createAccountSettingsController();
const dcaSettings = settings("hk", "BALANCED_COMPOUNDING", identityA, "dca-before");
dcaSettings.current_dca_supported = true;
dcaSettings.effective = {
  strategy_profile: { status: "known", value: "ibit_smart_dca" },
  dca_mode: { status: "known", value: "fixed" },
  dca_base_investment_usd: { status: "known", value: "50" },
};
assert.equal(dcaSave.applyRead(dcaSave.select({ platform: "longbridge", key: "hk" }), dcaSettings), true);
assert.equal(dcaSave.view().draft.dcaAmount, "50", "only the current supported profile is prefilled from current settings");
assert.equal(dcaSave.edit({ strategy: "ibit_smart_dca", strategyTouched: true, dcaProfile: "ibit_smart_dca", dcaMode: "fixed", dcaAmount: "50", dcaTouched: true }), true);
const dcaSaveOp = dcaSave.startSave("strategy");
assert.equal(dcaSave.requestBody(dcaSaveOp).overrides.dca_base_investment_usd, "50");
assert.equal(dcaSave.edit({ dcaAmount: "75", floor: "20", floorTouched: true, income: "true", incomeTouched: true, option: "false", optionTouched: true }), true);
const dcaSaved = settings("hk", "BALANCED_COMPOUNDING", identityA, "dca-saved");
dcaSaved.current_dca_supported = true;
dcaSaved.draft.revision = 3;
dcaSaved.draft.overrides = { strategy_profile: "ibit_smart_dca", dca_mode: "fixed", dca_base_investment_usd: "50" };
dcaSaved.effective = dcaSettings.effective;
assert.equal(dcaSave.applySave(dcaSaveOp, dcaSaved, "草案已保存"), true);
assert.equal(dcaSave.view().draft.dcaAmount, "75", "a save response cannot replace a newer DCA amount typed while saving");
assert.equal(dcaSave.view().draft.floor, "20");
assert.equal(dcaSave.view().draft.income, "true");
assert.equal(dcaSave.view().draft.option, "false");
assert.equal(dcaSave.view().draft.dcaTouched, true);

const switchDcaAccount = createAccountSettingsController();
const switchDcaRead = switchDcaAccount.select({ platform: "longbridge", key: "hk" });
assert.equal(switchDcaAccount.applyRead(switchDcaRead, dcaSettings), true);
switchDcaAccount.edit({ strategy: "ibit_smart_dca", strategyTouched: true, dcaProfile: "ibit_smart_dca", dcaMode: "smart", dcaAmount: "75", dcaTouched: true });
const lateDcaSave = switchDcaAccount.startSave("strategy");
const selectOther = switchDcaAccount.select({ platform: "longbridge", key: "sg" });
assert.equal(switchDcaAccount.applySave(lateDcaSave, dcaSaved, "late"), false, "a late DCA save cannot rebind another account");
assert.equal(switchDcaAccount.applyRead(selectOther, settings("sg", "BALANCED_COMPOUNDING", identityB, "sg-after-dca")), true);
assert.equal(switchDcaAccount.view().settings.key, "sg");
assert.equal(switchDcaAccount.view().draft.dcaAmount, "");
// Match the page's synchronous startSave -> markSaving -> POST sequence while
// deliberately retaining a render's old view for consecutive same-turn calls.
function singleFlightController() {
  const c = createAccountSettingsController();
  c.applyRead(c.select({ platform: "longbridge", key: "hk" }), settings("hk", "BALANCED_COMPOUNDING", identityA, "single-flight"));
  c.edit({ cashMode: "floor", floor: "25", ratio: "0", percent: "0", floorTouched: true, ratioTouched: true, preference: "GROWTH_COMPOUNDING" });
  return c;
}
function saveDispatch(c, capturedView, kind, posts) {
  if (capturedView.saving) return null;
  const op = c.startSave(kind);
  const body = c.requestBody(op);
  if (!op || !body || !c.markSaving(op, kind === "risk" ? "risk" : "draft")) return null;
  const currentBody = c.requestBody(op);
  if (!currentBody) return null;
  posts.push(structuredClone(currentBody));
  return op;
}
const sameTurnResults = [];
for (const [firstKind, nextKind] of [["cash", "cash"], ["risk", "risk"], ["cash", "risk"], ["risk", "cash"]]) {
  const c = singleFlightController(); const capturedView = c.view(); const posts = [];
  const firstOp = saveDispatch(c, capturedView, firstKind, posts);
  const nextOp = saveDispatch(c, capturedView, nextKind, posts);
  sameTurnResults.push({ firstKind, nextKind, posts: posts.length, duplicateBlocked: nextOp === null, firstStillCurrent: c.isCurrent(firstOp) });
  if (posts.length === 1) {
    assert.deepEqual(c.requestBody(firstOp).identity, identityA);
    assert.equal(firstKind === "risk" ? posts[0].expected_risk_revision : posts[0].expected_draft_revision, firstKind === "risk" ? 4 : 2);
    assert.equal(c.view().saving, firstKind === "risk" ? "risk" : "draft");
  }
}
console.log("same-turn save dispatch:", JSON.stringify(sameTurnResults));
assert.ok(sameTurnResults.every(row => row.posts === 1 && row.duplicateBlocked && row.firstStillCurrent), "consecutive cash/risk and cross-kind calls must dispatch once without invalidating the first operation");

for (const [firstKind, nextKind] of [["cash", "cash"], ["risk", "risk"], ["cash", "risk"], ["risk", "cash"]]) {
  const c = singleFlightController(); const capturedView = c.view(); const posts = [];
  let resolveResponse;
  const response = new Promise(resolve => { resolveResponse = resolve; });
  const submitPending = async kind => {
    const op = saveDispatch(c, capturedView, kind, posts);
    if (!op) return false;
    try { return c.applySave(op, await response, "synthetic saved"); }
    finally { c.finish(op); }
  };
  const firstPending = submitPending(firstKind);
  const nextPending = submitPending(nextKind);
  assert.equal(posts.length, 1, "a pending promise prevents same-turn same-kind or cross-kind POSTs");
  assert.equal(await nextPending, false);
  const saved = settings("hk", firstKind === "risk" ? "GROWTH_COMPOUNDING" : "BALANCED_COMPOUNDING", identityA, "pending complete");
  if (firstKind === "cash") { saved.draft.revision = 3; saved.draft.overrides = { reserved_cash_floor: "25", reserved_cash_ratio: "0" }; }
  else saved.risk.revision = 5;
  resolveResponse(saved);
  assert.equal(await firstPending, true, "the original pending save response remains applicable");
  assert.equal(c.view().saving, "");
  assert.equal(c.view().settings.marker, "pending complete");
}

for (const kind of ["cash", "risk"]) {
  const c = singleFlightController(); const posts = []; const firstOp = saveDispatch(c, c.view(), kind, posts);
  const beforeRepeatMark = structuredClone(c.view());
  assert.equal(c.markSaving(firstOp, kind === "risk" ? "risk" : "draft"), false, "the same operation cannot mark saving twice for another dispatch");
  assert.deepEqual(c.view(), beforeRepeatMark);
  assert.equal(c.isCurrent(firstOp), true, "rejecting a duplicate must preserve the first operation token");
  assert.equal(c.startSave(kind), null, "pending same-account saves are blocked before gate.begin");
  assert.equal(c.isCurrent(firstOp), true);
  if (kind === "cash") c.revertCash(); else c.revertRisk();
  assert.equal(c.startSave(kind), null, "cancelling local edits does not remove an in-flight save lock");
  assert.equal(c.isCurrent(firstOp), true);
  assert.equal(c.fail(firstOp, "synthetic failed save"), true);
  c.edit(kind === "cash" ? { cashMode: "floor", floor: "30", ratio: "0", percent: "0", floorTouched: true, ratioTouched: true } : { preference: "GROWTH_COMPOUNDING" });
  const retry = saveDispatch(c, c.view(), kind, posts);
  assert.ok(retry, "a failed save permits a new explicit attempt");
  const retrying = structuredClone(c.view());
  assert.equal(c.finish(firstOp), false);
  assert.equal(c.fail(firstOp, "late failure"), false);
  assert.equal(c.applySave(firstOp, settings("hk", "BALANCED_COMPOUNDING", identityA, "late response"), "late"), false);
  assert.deepEqual(c.view(), retrying, "late completion/failure/finally cannot clear the newer lock or replace its edits");
  assert.equal(posts.length, 2, "only the original and explicitly retried attempts are sent");
  assert.equal(c.finish(retry), true);
  assert.equal(c.view().saving, "");
}

for (const kind of ["cash", "risk"]) {
  const c = singleFlightController(); const posts = []; const oldOp = saveDispatch(c, c.view(), kind, posts);
  c.applyRead(c.select({ platform: "longbridge", key: "sg" }), settings("sg", "BALANCED_COMPOUNDING", identityB, "new account"));
  c.edit({ cashMode: "floor", floor: "35", ratio: "0", percent: "0", floorTouched: true, ratioTouched: true, preference: "GROWTH_COMPOUNDING" });
  const newOp = saveDispatch(c, c.view(), kind, posts); assert.ok(newOp);
  const newSaving = structuredClone(c.view());
  assert.equal(c.applySave(oldOp, settings("hk", "GROWTH_COMPOUNDING", identityA, "old account late"), "late"), false);
  assert.equal(c.fail(oldOp, "old account late failure"), false);
  assert.equal(c.finish(oldOp), false);
  c.abandon(oldOp);
  assert.deepEqual(c.view(), newSaving, "switching and abandoning an old operation cannot clear another account's save lock");
  assert.equal(c.isCurrent(newOp), true);
  assert.equal(c.requestBody(newOp).key, "sg");
  assert.deepEqual(c.requestBody(newOp).identity, identityB);
}
const saveKinds = ["draft", "cash", "income", "option", "strategy", "risk"];
for (const firstKind of saveKinds) for (const nextKind of saveKinds) {
  const c = createAccountSettingsController();
  const payload = settings("hk", "BALANCED_COMPOUNDING", identityA, "all-kinds");
  payload.operations.save_option_draft = true;
  const read = c.select({ platform: "longbridge", key: "hk" }); c.applyRead(read, payload);
  c.edit({ strategy: "synthetic-profile", strategyTouched: true, cashMode: "floor", floor: "25", ratio: "0", percent: "0", floorTouched: true, ratioTouched: true, income: "true", incomeTouched: true, option: "false", optionTouched: true, preference: "GROWTH_COMPOUNDING" });
  const firstOp = c.startSave(firstKind); assert.ok(firstOp);
  assert.equal(c.markSaving(firstOp, firstKind === "risk" ? "risk" : "draft"), true);
  const locked = structuredClone(c.view()); const body = c.requestBody(firstOp);
  assert.equal(c.startSave(nextKind), null, `${firstKind} -> ${nextKind} is blocked without beginning a new gate token`);
  c.abandon(read);
  assert.equal(c.isCurrent(firstOp), true, "cleanup of the original read cannot abandon a save");
  assert.equal(c.requestBody(firstOp), body);
  assert.deepEqual(c.view(), locked);
}

// A successful HTTP response is not an acknowledgement until it matches the
// immutable submitted identity, authority revision and requested field group.
function acknowledgementCase(kind = "cash", base = null, edit = null, unresolvedSaves = new Map()) {
  const c = createAccountSettingsController(unresolvedSaves);
  const initial = base || settings("hk", "BALANCED_COMPOUNDING", structuredClone(identityA), "ack-before");
  initial.operations.save_option_draft = true;
  c.applyRead(c.select({ platform: "longbridge", key: "hk" }), initial);
  c.edit(edit || (kind === "risk" ? { preference: "GROWTH_COMPOUNDING" } : {
    cashMode: "floor", floor: "42", ratio: "0", percent: "0", floorTouched: true, ratioTouched: true,
  }));
  const op = c.startSave(kind); assert.ok(op);
  assert.equal(c.markSaving(op, kind === "risk" ? "risk" : "draft"), true);
  const ack = structuredClone(initial);
  ack.marker = "ack-after";
  if (kind === "risk") {
    ack.risk.preference = op.body.risk_preference;
    ack.risk.revision += 1;
  } else {
    const before = JSON.stringify(ack.draft.overrides);
    if (ack.draft.status === "identity_conflict") ack.draft.overrides = {};
    for (const [key, value] of Object.entries(op.body.overrides)) {
      if (value === null) delete ack.draft.overrides[key]; else ack.draft.overrides[key] = value;
    }
    if (initial.draft.status !== "current" || before !== JSON.stringify(ack.draft.overrides)) ack.draft.revision += 1;
    ack.draft.status = "current";
    ack.draft.identity = structuredClone(op.body.identity);
    ack.draft.current_identity = structuredClone(op.body.identity);
  }
  return { c, op, ack, initial };
}

const invalidAcknowledgements = [
  ["old values and revision", ({ ack }) => { ack.draft.revision = 2; ack.draft.overrides = {}; }],
  ["missing submitted value", ({ ack }) => { delete ack.draft.overrides.reserved_cash_floor; }],
  ["wrong submitted value", ({ ack }) => { ack.draft.overrides.reserved_cash_floor = "41"; }],
  ["number instead of decimal string", ({ ack }) => { ack.draft.overrides.reserved_cash_floor = 42; }],
  ["incomplete cash pair", ({ ack }) => { delete ack.draft.overrides.reserved_cash_ratio; }],
  ["same key different identity", ({ ack }) => { ack.identity.service_name = "other-service"; }],
  ["draft identity conflict", ({ ack }) => { ack.draft.identity.account_selector = "OTHER"; }],
  ["draft current identity conflict", ({ ack }) => { ack.draft.current_identity.account_scope = "OTHER"; }],
  ["missing identity", ({ ack }) => { delete ack.identity; }],
  ["missing draft identity", ({ ack }) => { delete ack.draft.identity; }],
  ["wrong platform", ({ ack }) => { ack.platform = "ibkr"; }],
  ["wrong key", ({ ack }) => { ack.key = "sg"; }],
  ["malformed API success", value => { value.ack = {}; }],
  ["explicitly failed response", ({ ack }) => { ack.ok = false; }],
  ["missing success flag", ({ ack }) => { delete ack.ok; }],
  ["unsafe adoption", ({ ack }) => { ack.adopted = true; }],
  ["unsafe order flag", ({ ack }) => { ack.no_order = false; }],
  ["unsafe execution flag", ({ ack }) => { ack.execution_authority_granted = true; }],
  ["missing draft", ({ ack }) => { delete ack.draft; }],
  ["missing unsubmitted risk baseline", ({ ack }) => { delete ack.risk; }],
  ["wrong unsubmitted risk scope", ({ ack }) => { ack.risk.scope_id = "longbridge--sg"; }],
  ["wrong draft status", ({ ack }) => { ack.draft.status = "identity_conflict"; }],
  ["array overrides", ({ ack }) => { ack.draft.overrides = []; }],
  ["unchanged revision after mutation", ({ ack }) => { ack.draft.revision = 2; }],
  ["jumped revision", ({ ack }) => { ack.draft.revision = 4; }],
  ["negative revision", ({ ack }) => { ack.draft.revision = -1; }],
  ["string revision", ({ ack }) => { ack.draft.revision = "3"; }],
  ["non-integer revision", ({ ack }) => { ack.draft.revision = 3.5; }],
  ["unsafe integer revision", ({ ack }) => { ack.draft.revision = Number.MAX_SAFE_INTEGER + 1; }],
];
for (const [label, alter] of invalidAcknowledgements) {
  const value = acknowledgementCase();
  value.c.edit({ floor: "43", income: "true", incomeTouched: true, preference: "CAPITAL_PRESERVATION" });
  const before = structuredClone(value.c.view());
  const previousSettings = value.c.view().settings;
  alter(value);
  assert.equal(value.c.applySave(value.op, value.ack, "草案已保存"), false, `${label} cannot acknowledge the save`);
  assert.equal(value.c.view().settings, previousSettings, `${label} must not replace settings`);
  assert.deepEqual(value.c.view().draft, before.draft, `${label} must retain every edit`);
  assert.equal(value.c.view().preference, before.preference);
  assert.equal(value.c.view().notice, "状态未知");
  assert.equal(value.c.view().noticeGroup, "");
  assert.equal(value.c.finish(value.op), true, "the existing page finally path must still synchronize the notice");
  assert.equal(value.c.view().notice, "状态未知");
  assert.equal(value.c.view().saving, "");
}

for (const [label, alter] of [
  ["old preference", ({ ack }) => { ack.risk.preference = "BALANCED_COMPOUNDING"; }],
  ["same revision after preference change", ({ ack }) => { ack.risk.revision = 4; }],
  ["jumped risk revision", ({ ack }) => { ack.risk.revision = 6; }],
  ["wrong scope", ({ ack }) => { ack.risk.scope_id = "longbridge--sg"; }],
  ["missing risk", ({ ack }) => { delete ack.risk; }],
  ["missing unsubmitted draft baseline", ({ ack }) => { delete ack.draft; }],
]) {
  const value = acknowledgementCase("risk"); const before = structuredClone(value.c.view()); alter(value);
  assert.equal(value.c.applySave(value.op, value.ack, "偏好已保存"), false, label);
  assert.deepEqual(value.c.view().settings, before.settings);
  assert.equal(value.c.view().preference, "GROWTH_COMPOUNDING");
  assert.equal(value.c.riskDirty(), true);
  assert.equal(value.c.view().notice, "状态未知");
}

for (const field of Object.keys(identityA)) {
  const value = acknowledgementCase(); value.ack.identity[field] = `different-${field}`;
  assert.equal(value.c.applySave(value.op, value.ack, "草案已保存"), false, `identity field ${field} is bound`);
}

for (const field of ["income_layer_enabled", "option_overlay_enabled"]) {
  const kind = field === "income_layer_enabled" ? "income" : "option";
  const edit = field === "income_layer_enabled" ? { income: "false", incomeTouched: true } : { option: "false", optionTouched: true };
  const good = acknowledgementCase(kind, null, edit);
  assert.equal(good.c.applySave(good.op, good.ack, "草案已保存"), true);
  const bad = acknowledgementCase(kind, null, edit); bad.ack.draft.overrides[field] = "false";
  assert.equal(bad.c.applySave(bad.op, bad.ack, "草案已保存"), false, "layer values must retain their boolean type");
}
for (const clearField of ["reserved_cash_floor", "reserved_cash_ratio", "income_layer_enabled", "option_overlay_enabled", "strategy_profile", "dca_mode", "dca_base_investment_usd"]) {
  const base = settings("hk", "BALANCED_COMPOUNDING", structuredClone(identityA), "clear-before");
  base.draft.overrides = { reserved_cash_floor: "7", reserved_cash_ratio: "0.2", income_layer_enabled: true, option_overlay_enabled: true, strategy_profile: "ibit_smart_dca", dca_mode: "fixed", dca_base_investment_usd: "50" };
  const edit = { cashMode: "inherit", floorTouched: true, ratioTouched: true, income: "clear", incomeTouched: true, option: "clear", optionTouched: true, strategyTouched: true, clearStrategy: true, clearDca: true };
  const value = acknowledgementCase("draft", base, edit);
  value.ack.draft.overrides[clearField] = null;
  assert.equal(value.c.applySave(value.op, value.ack, "草案已保存"), false, `${clearField}: null must be deleted in saved overrides`);
  const good = acknowledgementCase("draft", structuredClone(base), edit);
  assert.equal(good.c.applySave(good.op, good.ack, "草案已保存"), true, `${clearField}: actual absence acknowledges deletion`);
}
for (const [label, base, edit] of [
  ["current no-op", { status: "current", revision: 2, overrides: { reserved_cash_floor: "42", reserved_cash_ratio: "0" } }, { cashMode: "floor", floor: "42", floorTouched: true, ratioTouched: true }],
  ["new empty clear still creates revision", { status: "empty", revision: 0, overrides: {}, identity: null }, { cashMode: "inherit", floorTouched: true, ratioTouched: true }],
  ["explicit identity rebind", { status: "identity_conflict", revision: 2, overrides: { income_layer_enabled: true }, identity: identityB }, { cashMode: "inherit", floorTouched: true, ratioTouched: true, acknowledge: true }],
]) {
  const initial = settings("hk", "BALANCED_COMPOUNDING", structuredClone(identityA), label);
  initial.draft = { ...initial.draft, ...base };
  const value = acknowledgementCase("cash", initial, edit);
  assert.equal(value.c.applySave(value.op, value.ack, "草案已保存"), true, label);
}
for (const increment of [0, 1]) {
  const value = acknowledgementCase("risk", null, { preference: "BALANCED_COMPOUNDING" });
  value.ack.risk.revision = 4 + increment;
  assert.equal(value.c.applySave(value.op, value.ack, "偏好已保存"), true, "same risk enum may refresh server binding metadata");
}
for (const preference of ["BALANCED_COMPOUNDING", null]) {
  const base = settings("hk", preference, structuredClone(identityA), "risk-clear");
  const value = acknowledgementCase("risk", base, { preference: "" });
  value.ack.risk.revision = preference ? 5 : 4;
  assert.equal(value.c.applySave(value.op, value.ack, "偏好已保存"), true, "risk clear must match null and the registry revision rule");
}
{
  const value = acknowledgementCase();
  assert.notEqual(value.op.body.identity, value.initial.identity, "request identity must be deeply copied");
  value.initial.identity.service_name = "mutated-after-start";
  value.initial.draft.revision = 99;
  value.initial.draft.overrides.reserved_cash_floor = "999";
  value.c.edit({ floor: "45", income: "true", incomeTouched: true });
  assert.equal(value.op.body.identity.service_name, identityA.service_name);
  assert.equal(value.c.applySave(value.op, value.ack, "草案已保存"), true, "validation uses the save-start snapshot");
  assert.equal(value.c.view().draft.floor, "45");
  assert.equal(value.c.view().draft.floorTouched, true);
  assert.equal(value.c.view().draft.incomeTouched, true);
}
{
  const value = acknowledgementCase();
  value.op.body.overrides.reserved_cash_floor = "99";
  value.ack.draft.overrides.reserved_cash_floor = "99";
  assert.equal(value.c.applySave(value.op, value.ack, "草案已保存"), false, "mutating the exposed request cannot rewrite the private acknowledgement binding");
}
{
  const value = acknowledgementCase();
  value.ack.identity = Object.fromEntries(Object.entries(value.ack.identity).reverse());
  value.ack.instance_revision = 91;
  value.ack.effective = { strategy_profile: { status: "unknown" } };
  assert.equal(value.c.applySave(value.op, value.ack, "草案已保存"), true, "identity property order, unrelated instance revision and unknown GitHub configuration do not change a valid DO acknowledgement");
}
{
  const value = acknowledgementCase();
  value.c.abandon(value.op);
  const newer = value.c.start("refresh");
  value.c.applyRefresh(newer, settings("hk", "BALANCED_COMPOUNDING", identityA, "new-session-read"));
  const before = structuredClone(value.c.view());
  assert.equal(value.c.applySave(value.op, {}, "草案已保存"), false);
  assert.equal(value.c.finish(value.op), false);
  assert.deepEqual(value.c.view(), before, "an invalidated operation cannot set unknown in a newer controller epoch");
}
{
  const value = acknowledgementCase();
  value.c.fail(value.op, "状态未知");
  value.c.applyRefresh(value.c.start("refresh"), value.ack);
  assert.equal(value.c.view().settings.draft.overrides.reserved_cash_floor, "42");
  assert.equal(value.c.view().notice, "状态未知", "matching current saved values do not prove which request wrote them");
}
// The full ACK refreshes the other authority too, so it cannot roll that
// baseline back or change its contents without a revision advance.
for (const [label, kind, alter] of [
  ["risk revision rollback", "cash", ({ ack }) => { ack.risk.revision = 0; ack.risk.preference = "CAPITAL_PRESERVATION"; }],
  ["risk same-revision value change", "cash", ({ ack }) => { ack.risk.preference = "CAPITAL_PRESERVATION"; }],
  ["draft revision rollback", "risk", ({ ack }) => { ack.draft = { status: "empty", revision: 0, identity: null, current_identity: identityA, overrides: {} }; }],
  ["draft same-revision value change", "risk", ({ ack }) => { ack.draft.overrides.income_layer_enabled = false; }],
  ["draft same-revision identity change", "risk", ({ ack }) => { ack.draft.identity = { ...identityA, service_name: "other-service" }; }],
  ["draft same-revision current identity change", "risk", ({ ack }) => { ack.draft.current_identity = { ...identityA, account_scope: "OTHER" }; }],
  ["draft same-revision status change", "risk", ({ ack }) => { ack.draft.status = "identity_conflict"; }],
]) {
  const value = acknowledgementCase(kind);
  value.c.edit({ income: "true", incomeTouched: true, preference: "GROWTH_COMPOUNDING" });
  const before = structuredClone(value.c.view()); alter(value);
  assert.equal(value.c.applySave(value.op, value.ack, "saved"), false, label);
  assert.deepEqual(value.c.view().settings, before.settings, `${label} cannot replace the other saved baseline`);
  assert.deepEqual(value.c.view().draft, before.draft);
  assert.equal(value.c.view().preference, before.preference);
  assert.equal(value.c.view().notice, "状态未知");
}
for (const kind of ["cash", "risk"]) {
  const value = acknowledgementCase(kind);
  value.c.edit({ income: "true", incomeTouched: true, preference: "GROWTH_COMPOUNDING" });
  if (kind === "cash") {
    value.ack.risk.revision = 7;
    value.ack.risk.preference = "CAPITAL_PRESERVATION";
  } else {
    value.ack.draft.revision = 5;
    value.ack.draft.overrides = { reserved_cash_floor: "9" };
  }
  assert.equal(value.c.applySave(value.op, value.ack, "saved"), true, "a higher unsubmitted authority revision is a legitimate concurrent observation");
  assert.equal(value.c.view().review[kind === "cash" ? "risk" : "draft"], true);
  assert.equal(value.c.view().noticeGroup, kind);
  assert.equal(value.c.view().draft.incomeTouched, true);
  assert.equal(value.c.view().preference, "GROWTH_COMPOUNDING");
}
console.log("account_settings_state_validation: PASS");

// Lost responses stay bound to the original object across explicit reads/remounts.
for (const kind of ["cash", "risk"]) {
  const store = new Map();
  const value = acknowledgementCase(kind, null, null, store);
  assert.equal(value.c.fail(value.op, "lost response", true), true);
  assert.equal(value.c.acknowledgeReview(kind === "risk" ? "risk" : "draft"), false);
  value.c.revertDraft(); value.c.revertRisk();
  assert.equal(value.c.startSave(kind), null, "editor reset cannot release an unknown save");
  const failed = await refreshAccountSettingsReadback(value.c, value.c.start("refresh"), async () => { throw new Error("synthetic offline failure"); });
  assert.equal(failed.status, "failed"); assert.equal(store.size, 1);
  value.c.applyRefresh(value.c.start("refresh"), value.initial);
  assert.equal(value.c.startSave(kind), null, "HTTP200 with old values does not close a pending save");
  const remounted = createAccountSettingsController(store);
  const selected = remounted.select({ platform: "longbridge", key: "hk" });
  remounted.applyRead(selected, value.initial);
  assert.equal(remounted.view().notice, "状态未知");
  assert.equal(remounted.startSave(kind), null, "navigation preserves unknown submission state");
  const impostor = structuredClone(value.ack); impostor.identity.account_scope = "OTHER";
  remounted.applyRefresh(remounted.start("refresh"), impostor);
  assert.equal(store.size, 1, "same values from a changed original identity cannot close the request");
  const trusted = await refreshAccountSettingsReadback(remounted, remounted.start("refresh"), async () => value.ack);
  assert.equal(trusted.status, "ready"); assert.equal(store.size, 0);
  assert.equal(remounted.view().notice, kind === "risk" ? "偏好已保存" : "草案已保存");
  assert.equal(remounted.view().review[kind === "risk" ? "risk" : "draft"], false);
  assert.equal(remounted.view().settings.adopted, false);
  assert.equal(remounted.view().settings.execution_authority_granted, false);
}
console.log("account settings unknown-save readback: PASS");

{
  const store = new Map(); const first = acknowledgementCase("cash", null, null, store);
  const remounted = createAccountSettingsController(store);
  remounted.applyRead(remounted.select({ platform: "longbridge", key: "hk" }), first.ack);
  assert.equal(store.size, 0, "trusted read can close a submitted save while its response is still delayed");
  remounted.edit({ cashMode: "floor", floor: "43", ratio: "0", percent: "0", floorTouched: true, ratioTouched: true });
  const second = remounted.startSave("cash"); assert.ok(second);
  remounted.markSaving(second, "draft"); const pending = store.get("longbridge:hk");
  assert.equal(first.c.applySave(first.op, first.ack, "late first ACK"), false);
  assert.equal(first.c.fail(first.op, "late first failure", true), false);
  assert.equal(store.get("longbridge:hk"), pending, "old component's late callback cannot release/replace a newer save");
  assert.equal(remounted.startSave("cash"), null);
}
console.log("account settings remount/late-save ownership: PASS");
