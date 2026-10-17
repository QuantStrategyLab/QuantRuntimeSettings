import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "../web/strategy-switch-console/frontend/node_modules/typescript/lib/typescript.js";
import React from "../web/strategy-switch-console/frontend/node_modules/react/index.js";
import { renderToStaticMarkup } from "../web/strategy-switch-console/frontend/node_modules/react-dom/server.node.js";
import { zh as pageZh, en as pageEn } from "../web/strategy-switch-console/frontend/src/i18n/pages/decisions.ts";
import { zhCN } from "../web/strategy-switch-console/frontend/src/i18n/zh-CN.ts";
import { en as coreEn } from "../web/strategy-switch-console/frontend/src/i18n/en.ts";
import { validate } from "./console_api_contract_validation.mjs";
import { recoveryBinding } from "../web/strategy-switch-console/frontend/src/operations.ts";
import { displayName } from "../web/strategy-switch-console/display_names.js";
import { decorateQueue } from "../web/strategy-switch-console/application/console_api/presentation.js";
import { inbox } from "../web/strategy-switch-console/application/console_api/inbox.js";
import { recoveryMaterialPresentation, currentReconciliationObservationPresentation } from "../web/strategy-switch-console/application/console_api/reconciliation_presentation.js";

// Exercise the production aggregation/freshness functions with in-memory inputs.
// No Worker, storage adapter, KV, server, or network is instantiated.
const workerText = readFileSync(new URL("../web/strategy-switch-console/worker.js", import.meta.url), "utf8");
function productionFunction(name, dependencies = {}) {
  const start = workerText.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const code = workerText.slice(start, workerText.indexOf("\n}", start) + 2);
  return new Function(...Object.keys(dependencies), `return (${code});`)(...Object.values(dependencies));
}
const now = Date.parse("2001-10-17T04:05:00Z");
const old = "2001-09-20T18:37:32Z";
const observed = "2001-09-20T18:37:27Z";
const digest = "a".repeat(64);
const schema = "qsl_reconciliation_recovery_dashboard.v1";
const empty = productionFunction("emptyReconciliationRecoveryPayload", {
  RECONCILIATION_RECOVERY_DASHBOARD_SCHEMA_VERSION: schema,
  currentReconciliationObservationPresentation,
});
const recovery = {
  recovery_id: "synthetic-recovery", strategy_profile: "soxl_soxx_trend_income",
  platform: "synthetic-platform", target_name: "synthetic-private-account",
  readiness: "awaiting_human_confirmation", reconciliation_state: "RECONCILE_ONLY",
  candidate_sha256: digest, dual_review: { evidence_binding_sha256: digest },
  first_observed_at: observed, last_observed_at: observed, blocker_codes: [],
};
const historicalSource = {
  source_id: "synthetic.recovery", generated_at: old, computed_at: old,
  data_status: "ready", recoveries: [recovery], errors: [],
};
async function aggregate(sources, result) {
  return productionFunction("aggregateReconciliationRecoverySources", {
    readReconciliationRecoverySources: async () => structuredClone(sources),
    readReconciliationRecoveryConfirmation: async () => structuredClone(result),
    reconciliationRecoveryStaleTtlSeconds: () => 1800,
    Date: class extends Date { static now() { return now; } },
    controlPlaneSnapshotFreshness: productionFunction("controlPlaneSnapshotFreshness"),
    reconciliationRecoveryEvidenceFreshness: productionFunction("reconciliationRecoveryEvidenceFreshness"),
    earliestControlPlaneTimestamp: productionFunction("earliestControlPlaneTimestamp"),
    uniqueStrings: productionFunction("uniqueStrings"),
    recoveryDecisionMaterialKey: async () => "b".repeat(64),
    emptyReconciliationRecoveryPayload: empty,
    RECONCILIATION_RECOVERY_DASHBOARD_SCHEMA_VERSION: schema,
    recoveryMaterialPresentation, currentReconciliationObservationPresentation,
  })({});
}
const confirmation = { candidate_sha256: digest, dual_review_binding_sha256: digest };
const decided = await aggregate([historicalSource], { confirmation, error: null });
assert.equal(decided.recoveries[0].presentation.material_kind, "historical_recovery_approval_material");
assert.equal(decided.recoveries[0].presentation.decision_status, "approved");
assert.deepEqual(decided.recoveries[0].confirmation, confirmation);
assert.equal(decided.generated_at, old);
assert.equal(decided.computed_at, old);
assert.equal(decided.recoveries[0].presentation.last_observed_at, observed);
assert.equal(decided.recoveries[0].presentation.source_generated_at, old);
assert.equal(decided.data_status, "stale");
assert.deepEqual(decided.errors, ["reconciliation_recovery_source_stale", "reconciliation_recovery_evidence_stale"]);
assert.equal(recoveryBinding(decided.recoveries[0]), null);

const undecided = await aggregate([historicalSource], { confirmation: null, error: null });
assert.equal(undecided.recoveries[0].presentation.material_kind, "recovery_approval_material");
assert.equal(undecided.recoveries[0].presentation.decision_status, "undecided");
assert.equal(undecided.summary.awaiting_human_confirmation, 0);
assert.deepEqual(undecided.errors, decided.errors);
assert.equal(recoveryBinding(undecided.recoveries[0]), null);
const failed = await aggregate([historicalSource], { confirmation: null, error: "reconciliation_recovery_confirmation_invalid" });
assert.equal(failed.recoveries[0].presentation.decision_status, "unknown");
assert.equal(failed.recoveries[0].presentation.material_kind, "recovery_approval_material");
assert.ok(failed.errors.includes("reconciliation_recovery_confirmation_invalid"));
const mismatch = await aggregate([historicalSource], { confirmation: { ...confirmation, candidate_sha256: "c".repeat(64) }, error: null });
assert.equal(mismatch.recoveries[0].presentation.decision_status, "undecided", "unbound decisions never classify material as historical");
const rejected = await aggregate([historicalSource], { rejection: confirmation, error: null });
assert.equal(rejected.recoveries[0].presentation.decision_status, "rejected");
assert.equal(rejected.recoveries[0].presentation.material_kind, "historical_recovery_approval_material");

for (const payload of [decided, undecided, failed, empty("snapshot_unavailable"), await aggregate([], {})]) {
  const current = payload.current_reconciliation_observation;
  assert.equal(current.connection_status, "not_connected");
  assert.equal(current.data_status, "unknown");
  assert.equal(current.comparison_status, "unknown");
  assert.equal(current.last_observed_at, null);
  assert.equal(current.status_label.zh, "未接入 / 未知");
  assert.equal(current.status_label.en, "Not connected / unknown");
}
const freshTime = new Date(now).toISOString();
const freshSource = { ...historicalSource, generated_at: freshTime, computed_at: freshTime,
  recoveries: [{ ...recovery, first_observed_at: freshTime, last_observed_at: freshTime }] };
const pending = await aggregate([freshSource], { confirmation: null, error: null });
assert.equal(pending.data_status, "ready");
assert.equal(pending.summary.awaiting_human_confirmation, 1);
assert.ok(recoveryBinding(pending.recoveries[0]), "fresh confirmation gates retain their existing behavior");
assert.equal(pending.current_reconciliation_observation.data_status, "unknown", "even fresh approval material is not a current observation");

// A separately supplied, already validated observation can coexist for display.
// This fixture does not install a production observation receiver or collector.
const independent = { data_status: "ready", generated_at: freshTime, computed_at: freshTime,
  observations: [{ last_observed_at: freshTime, comparison_status: "matched" }] };
const coexist = { ...decided, current_reconciliation_observation: currentReconciliationObservationPresentation(independent) };
assert.equal(coexist.current_reconciliation_observation.data_status, "ready");
assert.equal(coexist.current_reconciliation_observation.comparison_status, "matched");
assert.equal(coexist.data_status, "stale");
assert.deepEqual(coexist.errors, decided.errors);
assert.equal(coexist.recoveries[0].recovery.last_observed_at, observed);

async function inboxFor(payload) {
  const response = body => async () => Response.json(body);
  return inbox(new Request("https://synthetic.invalid/api/console/inbox"), {}, {
    recovery: response(decorateQueue(payload, "recoveries", "reconciliation_recovery")),
    owner: response({ data_status: "ready", candidates: [] }),
    promotion: response({ data_status: "ready", tickets: [] }),
    credential: response({ requires_action: false }),
  });
}
for (const payload of [decided, undecided, coexist]) {
  const result = await inboxFor(payload);
  validate("inbox", result);
  validate("recovery_material_presentation", result.items[0].presentation);
  validate("current_reconciliation_observation", result.sources.find(row => row.source === "recovery").current_reconciliation_observation);
  assert.equal(result.status, "partial", "historical stale remains part of inbox coverage");
  const source = result.sources.find(row => row.source === "recovery");
  assert.equal(source.status, "stale");
  assert.deepEqual(source.current_reconciliation_observation, payload.current_reconciliation_observation);
  assert.deepEqual(result.items[0].presentation, payload.recoveries[0].presentation);
}
assert.equal((await inboxFor(failed)).status, "read_failed");

// Render the actual production component in both languages, without a browser.
const componentUrl = new URL("../web/strategy-switch-console/frontend/src/pages/decisions/ReconciliationMaterials.tsx", import.meta.url);
let component = ts.transpileModule(readFileSync(componentUrl, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
}).outputText;
for (const [specifier, url] of Object.entries({
  "react/jsx-runtime": "../web/strategy-switch-console/frontend/node_modules/react/jsx-runtime.js",
  "../../../../display_names.js": "../web/strategy-switch-console/display_names.js",
})) component = component.replaceAll(`from "${specifier}"`, `from "${new URL(url, import.meta.url).href}"`);
const { ReconciliationMaterials } = await import(`data:text/javascript;base64,${Buffer.from(component).toString("base64")}`);
const renderedInboxes = new Map(await Promise.all([decided, failed, coexist].map(async payload => [payload, await inboxFor(payload)])));
for (const result of renderedInboxes.values()) result.items[0].account_alias = recovery.target_name;
const pageText = readFileSync(new URL("../web/strategy-switch-console/frontend/src/pages/decisions/DecisionsPage.tsx", import.meta.url), "utf8");
assert.ok(pageText.includes("<ReconciliationMaterials"), "the production inbox page mounts the material display");
for (const match of readFileSync(componentUrl, "utf8").matchAll(/"(reconciliation\.[a-z_]+)"/g)) {
  assert.ok(pageZh[match[1]] && pageEn[match[1]], `bilingual copy required: ${match[1]}`);
}
function render(payload, language, error = null) {
  const data = payload ? renderedInboxes.get(payload) : null;
  const t = (key, values = {}) => ({ ...(language === "zh" ? zhCN : coreEn), ...(language === "zh" ? pageZh : pageEn) }[key] || key).replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
  return renderToStaticMarkup(React.createElement(ReconciliationMaterials, { data: error ? null : data, language, t }));
}
for (const language of ["zh", "en"]) {
  const html = render(decided, language);
  assert.ok(html.includes(language === "zh" ? "历史恢复审批材料" : "Historical recovery approval material"));
  assert.ok(html.includes(language === "zh" ? "未接入 / 未知" : "Not connected / unknown"));
  assert.ok(html.includes(observed));
  assert.ok(html.includes(old));
  assert.ok(html.includes(decided.recoveries[0].presentation.decision_status_label[language]));
  assert.ok(html.includes(displayName("strategies", recovery.strategy_profile, language, "fallback")));
  assert.ok(!html.includes(recovery.strategy_profile));
  assert.ok(!html.includes(recovery.target_name));
  assert.ok(!html.includes("<button"), "material history never adds decision actions");
  const coexistHtml = render(coexist, language);
  assert.ok(coexistHtml.includes(coexist.current_reconciliation_observation.status_label[language]));
  assert.ok(coexistHtml.includes(observed));
  assert.ok(render(failed, language).includes(failed.recoveries[0].presentation.decision_status_label[language]));
  assert.ok(render(null, language).includes((language === "zh" ? pageZh : pageEn)["reconciliation.not_connected"]));
  assert.ok(!render(decided, language, "read_failed").includes("Historical recovery approval material"));
}
assert.equal(historicalSource.recoveries[0].last_observed_at, observed, "inputs remain unchanged");
console.log("reconciliation_material_presentation_validation: PASS (synthetic only; network=0; KV=0)");
