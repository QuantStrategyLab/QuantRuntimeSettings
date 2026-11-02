import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountSettingsOperationReason, accountSettingsSaveBlockReason, decisionSourceDegradedLabels, decisionSourceFailureLabels, listDailyDecisions, presentRuntimeDaily, promotionMaterialNotes } from "../web/strategy-switch-console/frontend/src/presentation.ts";
import { createAccountSettingsController, refreshAccountSettingsReadback } from "../web/strategy-switch-console/frontend/src/accountSettingsState.ts";
import { translate } from "../web/strategy-switch-console/frontend/src/locales.ts";
import postcss from "../web/strategy-switch-console/frontend/node_modules/postcss/lib/postcss.js";

assert.deepEqual(promotionMaterialNotes(null), ["未提供比较材料，无法查看方案差异。", "未提供限制材料，请先查看原始方案。"]);
assert.deepEqual(promotionMaterialNotes({ comparison: { status: "unavailable" }, limitations: [] }), ["比较结果暂不可用，无法查看方案差异。", "材料未列出限制条件，请先查看原始方案。"]);
assert.deepEqual(promotionMaterialNotes({ comparison: { status: "comparable" }, limitations: ["source limitation"] }), ["比较材料已提供，详情见方案。", "限制材料已提供，详情见方案。"]);
assert.deepEqual(promotionMaterialNotes({ comparison: "{\"status\":\"comparable\"}", limitations: "[]" }), ["比较材料状态未确认。", "未提供限制材料，请先查看原始方案。"], "arbitrary JSON text is never parsed into evidence");
const ready = value => ({ value: { data_status: "ready", ...value } });
const decisions = listDailyDecisions({ language: "zh", profiles: [], promotions: ready({ tickets: [{ ticket_id: "synthetic-1", state: "awaiting_human", research_summary: null }] }), owners: { error: new Error("synthetic unavailable") }, recovery: ready({ recoveries: [] }), accountsFor: () => [{ platform: "longbridge", key: "synthetic", label: "Synthetic account" }] });
assert.equal(decisions.blocked, true);
assert.equal(decisions.items.length, 1, "available decisions remain visible when another source is blocked");
assert.deepEqual(decisions.sources, { promotions: "ready", owners: "failed", recovery: "ready" });
assert.deepEqual(decisions.items[0].materialNotes, promotionMaterialNotes(null));
assert.equal(decisions.items[0].reference, "synthetic-1");
assert.deepEqual(listDailyDecisions({ language: "zh", profiles: [], promotions: ready({ tickets: [] }), owners: ready({ candidates: [] }), recovery: ready({ recoveries: [] }), accountsFor: () => [] }).sources, { promotions: "ready", owners: "ready", recovery: "ready" });
assert.equal(listDailyDecisions({ language: "zh", profiles: [], promotions: { value: { data_status: "stale", tickets: [] } }, owners: ready({ candidates: [] }), recovery: null, accountsFor: () => [] }).sources.promotions, "stale");
assert.equal(listDailyDecisions({ language: "zh", profiles: [], promotions: ready({ tickets: [] }), owners: ready({ candidates: [] }), recovery: null, accountsFor: () => [] }).sources.recovery, "missing");
const softUnavailable = listDailyDecisions({ language: "zh", profiles: [], promotions: ready({ tickets: [] }), owners: { value: { data_status: "unavailable", candidates: [], errors: ["control_plane_not_ready"] } }, recovery: { value: { data_status: "unavailable", recoveries: [] } }, accountsFor: () => [] });
assert.equal(softUnavailable.blocked, true);
assert.deepEqual(decisionSourceFailureLabels(softUnavailable.sources), []);
assert.deepEqual(decisionSourceDegradedLabels(softUnavailable.sources), ["负责人决定", "对账恢复"]);
const hardFailed = listDailyDecisions({ language: "zh", profiles: [], promotions: ready({ tickets: [] }), owners: { error: "boom" }, recovery: ready({ recoveries: [] }), accountsFor: () => [] });
assert.deepEqual(decisionSourceFailureLabels(hardFailed.sources), ["负责人决定"]);
assert.deepEqual(decisionSourceDegradedLabels(hardFailed.sources), []);


const settings = { platform: "longbridge", key: "synthetic", identity: { platform: "longbridge", key: "synthetic" }, draft: { status: "current", revision: 2, overrides: {} }, risk: { revision: 4, preference: "BALANCED_COMPOUNDING" }, operations: { save_draft: true, save_risk_preference: true }, effective: {} };
assert.equal(accountSettingsSaveBlockReason(settings, "ready", "draft"), null);
assert.equal(accountSettingsSaveBlockReason(settings, "stale", "draft"), "请重新读取成功后再保存。");
assert.equal(accountSettingsSaveBlockReason(settings, "refreshing", "risk"), "正在重新读取设置，完成后可保存。");
assert.equal(accountSettingsSaveBlockReason({ ...settings, draft: { revision: null } }, "ready", "draft"), "设置版本未确认，请重新读取后再保存。");
assert.equal(accountSettingsSaveBlockReason({ ...settings, identity: null }, "ready", "risk"), "缺少账户来源，不能保存。");
assert.equal(accountSettingsSaveBlockReason({ ...settings, identity: "untrusted" }, "ready", "draft"), "缺少账户来源，不能保存。");
assert.equal(accountSettingsSaveBlockReason({ ...settings, draft: { ...settings.draft, status: "identity_conflict" } }, "ready", "draft"), "请重新读取并确认当前账户来源。");
assert.equal(accountSettingsSaveBlockReason({ ...settings, operations: { save_draft: false, save_draft_reason: "admin_required" } }, "ready", "draft"), "当前登录不能保存这项设置。");
assert.equal(accountSettingsOperationReason("strategy_application_not_connected"), "策略应用与账户启用操作尚未接通。");
assert.equal(accountSettingsOperationReason("unknown_unsafe_reason"), "这项操作暂不可用。");

const controller = createAccountSettingsController();
const read = controller.select({ platform: "longbridge", key: "synthetic" });
assert.equal(controller.applyRead(read, settings), true);
controller.edit({ cashMode: "floor", floor: "25", ratio: "0", percent: "0", floorTouched: true, ratioTouched: true });
const before = structuredClone(controller.view());
controller.abandon(controller.start("refresh"));
assert.deepEqual(controller.view(), before, "failed re-read keeps saved values and the unsaved draft");
const reread = controller.start("refresh");
assert.equal(controller.applyRefresh(reread, { ...settings, draft: { ...settings.draft, revision: 3 } }), true);
assert.equal(controller.view().draft.floor, "25");
assert.equal(controller.view().review.draft, true, "re-read recovery still requires review after CAS changes");
assert.equal(controller.startSave("cash"), null);

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const loaded = () => { const c = createAccountSettingsController(); const op = c.select({ platform: "longbridge", key: "synthetic" }); c.applyRead(op, structuredClone(settings)); c.edit({ cashMode: "floor", floor: "25", ratio: "0", percent: "0", floorTouched: true, ratioTouched: true }); return c; };
const failedRefresh = loaded();
const failedBefore = structuredClone(failedRefresh.view());
assert.deepEqual(await refreshAccountSettingsReadback(failedRefresh, failedRefresh.start("refresh"), async () => { throw new Error("synthetic read failure"); }), { status: "failed", message: "账户设置暂时读不到。" });
assert.deepEqual(failedRefresh.view(), failedBefore);
assert.deepEqual(await refreshAccountSettingsReadback(failedRefresh, failedRefresh.start("refresh"), async () => ({ ...settings, key: "another-account" })), { status: "failed", message: "设置读回与所选账户不一致，请重新读取。" });
assert.deepEqual(failedRefresh.view(), failedBefore, "HTTP-200 wrong-account read-back cannot replace saved values or local edits");
for (const status of [401, 403]) assert.deepEqual(await refreshAccountSettingsReadback(failedRefresh, failedRefresh.start("refresh"), async () => { throw Object.assign(new Error("synthetic denied"), { status }); }), { status: "failed", message: "没有权限读取这项设置。" });
assert.deepEqual(await refreshAccountSettingsReadback(failedRefresh, failedRefresh.start("refresh"), async () => settings), { status: "ready" });
assert.equal(failedRefresh.view().draft.floor, "25");
assert.equal(failedRefresh.requestBody(failedRefresh.startSave("cash")).expected_draft_revision, 2);
assert.deepEqual(failedRefresh.requestBody(failedRefresh.startSave("cash")).identity, settings.identity);

for (const settle of ["resolve", "reject"]) {
  const c = loaded(); const d = deferred(); const result = refreshAccountSettingsReadback(c, c.start("refresh"), () => d.promise);
  const newRead = c.select({ platform: "longbridge", key: "new-account" });
  c.applyRead(newRead, { ...settings, key: "new-account", identity: { platform: "longbridge", key: "new-account" } });
  const current = structuredClone(c.view());
  if (settle === "resolve") d.resolve(settings); else d.reject(new Error("late failure"));
  assert.deepEqual(await result, { status: "superseded" });
  assert.deepEqual(c.view(), current, `late ${settle} cannot mutate the newly selected account`);
}
const interrupted = loaded();
const interruptedRead = deferred();
const interruptedOp = interrupted.start("refresh");
const interruptedResult = refreshAccountSettingsReadback(interrupted, interruptedOp, () => interruptedRead.promise);
interrupted.abandon(interruptedOp);
const interruptedView = structuredClone(interrupted.view());
interruptedRead.resolve(settings);
assert.deepEqual(await interruptedResult, { status: "superseded" });
assert.deepEqual(interrupted.view(), interruptedView, "cancelled same-account refresh cannot apply or clear draft state");

const newerSave = loaded(); const olderRead = deferred();
const olderResult = refreshAccountSettingsReadback(newerSave, newerSave.start("refresh"), () => olderRead.promise);
const currentSave = newerSave.startSave("cash");
assert.equal(newerSave.markSaving(currentSave, "draft"), true);
const savingView = structuredClone(newerSave.view());
olderRead.reject(new Error("late read failure"));
assert.deepEqual(await olderResult, { status: "superseded" });
assert.deepEqual(newerSave.view(), savingView, "superseded recovery cannot clear the current save lock or draft");
for (const mutation of [{ draft: { ...settings.draft, revision: 3 } }, { identity: { platform: "longbridge", key: "synthetic", broker_environment: "paper" } }]) {
  const c = loaded();
  assert.deepEqual(await refreshAccountSettingsReadback(c, c.start("refresh"), async () => ({ ...settings, ...mutation })), { status: "ready" });
  assert.equal(c.view().draft.floor, "25"); assert.equal(c.view().review.draft, true);
  assert.equal(c.startSave("cash"), null, "CAS or identity drift must keep the original review gate");
  const reviewing = structuredClone(c.view());
  await refreshAccountSettingsReadback(c, c.start("refresh"), async () => { throw new Error("synthetic failed read after conflict"); });
  assert.deepEqual(c.view(), reviewing, "failed recovery cannot clear an existing review requirement");
}
const afterFailedSave = loaded();
const failedSave = afterFailedSave.startSave("cash");
afterFailedSave.markSaving(failedSave, "draft");
afterFailedSave.fail(failedSave, "版本已变化，未覆盖已保存内容。");
const failedSaveView = structuredClone(afterFailedSave.view());
await refreshAccountSettingsReadback(afterFailedSave, afterFailedSave.start("refresh"), async () => { throw new Error("synthetic recovery read failed"); });
assert.deepEqual(afterFailedSave.view(), failedSaveView, "the existing failed-save notice, draft and locks survive a failed recovery read");

const unmatched = presentRuntimeDaily(null, { platform: "ibkr", accountKey: "synthetic", dailyBinding: "not_applicable" });
assert.equal(unmatched.statusLabel, "未接入");
assert.deepEqual(unmatched.statusDetails, ["该账户尚未接入此日报来源"]);
assert.equal(unmatched.fillsLabel, "未接入");
const unresolved = presentRuntimeDaily(null, { platform: "longbridge", accountKey: "synthetic", dailyBinding: "unresolved" });
assert.equal(unresolved.statusLabel, "待确认");
assert.deepEqual(unresolved.statusDetails, ["周期记录目标绑定未确认"]);
const liveSrc = (file) => readFileSync(new URL(`../web/strategy-switch-console/frontend/src/${file}`, import.meta.url), "utf8");
const controlsSource = liveSrc("pages/accounts/ControlsTab.tsx");
assert.match(controlsSource, /stop: submitStop,\s*resume: submitResume,/, "independent stop and resume controls must have their own handlers");
assert.match(controlsSource, /const disabled = busy !== null \|\| [^;]*!action\.enabled;/, "control buttons are gated by the per-action eligibility");
assert.match(controlsSource, /<button[^>]+disabled=\{disabled\}[^>]+onClick=\{\(\) => void handlers\[name\]\(\)\}/);
assert.match(controlsSource, /onClick=\{reload\}>\{t\("common\.refresh"\)\}/, "controls keep an explicit refresh action");
assert.doesNotMatch(controlsSource, /readState/, "settings read availability cannot hide independent stop controls");
for (const file of ["pages/accounts/RiskPreference.tsx", "pages/accounts/AccountDeclaration.tsx"]) {
  const source = liveSrc(file);
  assert.equal((source.match(/const refresh = controller\.start\("refresh"\);\s*const result = await refreshAccountSettingsReadback/g) || []).length, 1, `${file}: the failed-save recovery path re-reads settings before releasing saves`);
  assert.equal((source.match(/if \(result.status === "superseded"\) return;/g) || []).length, 1, `${file}: the recovery path ignores interrupted reads`);
}
for (const key of [...promotionMaterialNotes(null), ...promotionMaterialNotes({ comparison: { status: "comparable" }, limitations: [] }), unmatched.statusDetails[0], accountSettingsOperationReason("strategy_application_not_connected"), accountSettingsSaveBlockReason(settings, "stale", "draft")]) assert.notEqual(translate(key, "en"), key, key);

const dynamicLabels = ["Synthetic account A", "实际账户名称", "{count} 项待办", "<b>account text</b>", "unknown_scope_enum"];
for (const label of dynamicLabels) {
  const result = listDailyDecisions({ language: "en", profiles: [], promotions: ready({ tickets: [{ ticket_id: "display-label", state: "awaiting_human" }] }), owners: ready({ candidates: [] }), recovery: ready({ recoveries: [] }), accountsFor: () => [{ platform: "longbridge", key: "display-label", label }] });
  assert.equal(result.items[0].accountChoices[0].label, label, "explicit account display data remains verbatim, including names resembling enums");
}
const scope = listDailyDecisions({ language: "en", profiles: [], promotions: ready({ tickets: [{ ticket_id: "many", state: "awaiting_human" }] }), owners: ready({ candidates: [] }), recovery: ready({ recoveries: [] }), accountsFor: () => [{ platform: "longbridge", key: "a", label: "Account A" }, { platform: "longbridge", key: "b", label: "Account B" }] }).items[0];
assert.equal(translate(scope.accountLine, "en"), "Several accounts can be selected");

const css = postcss.parse(liveSrc("app/app.css"));
const property = (selector, name) => {
  let result;
  css.walkRules(selector, rule => {
    if (rule.parent.type !== "root") return;
    rule.walkDecls(name, declaration => { result = declaration.value; });
  });
  return result;
};
assert.equal(property(":focus-visible", "outline"), "2px solid var(--accent)", "keyboard focus retains a strong visible indicator");
assert.equal(property(".segmented .segment.active", "color"), "var(--ink)", "selected segment text uses the primary ink colour");
assert.equal(property(".segmented .segment.active", "background"), "var(--surface)");
const luminance = hex => {
  const values = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
};
const tokens = postcss.parse(liveSrc("app/tokens.css"));
const declsFor = selector => {
  let variables;
  tokens.walkRules(selector, rule => { if (rule.parent.type === "root") variables = Object.fromEntries(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])); });
  return variables;
};
const lightTokens = declsFor(":root");
for (const selector of [":root", ':root[data-theme="dark"]']) {
  const themed = declsFor(selector);
  assert.ok(themed);
  const variables = { ...lightTokens, ...themed };
  const resolve = value => { for (let i = 0; i < 8 && /^var\(/.test(value); i++) value = variables[value.match(/^var\((--[\w-]+)/)[1]]; return value; };
  const l1 = luminance(resolve(variables["--ink"])), l2 = luminance(resolve(variables["--surface"]));
  assert.ok((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) >= 4.5, `selected segment text meets normal-text contrast in ${selector}`);
}
console.log("workflow clarity validation: PASS (partial sources, explicit materials, read-back/CAS preservation and source eligibility)");
