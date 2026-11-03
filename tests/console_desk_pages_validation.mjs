// Desk (Meridian) P1 pages: switch state machine, access failures, credential
// reminder rules and the 403 wording. Pure modules + source checks; synthetic only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AccessError, HttpError } from "../web/strategy-switch-console/frontend/src/api/client.ts";
import { classifySessionFailure, deskAccess, isOpenSession } from "../web/strategy-switch-console/frontend/src/desk/shell/access.ts";
import {
  INITIAL_STRATEGY_FLOW, STRATEGY_FILTERS, SWITCH_STEPS, catalogCounts, filterCatalog,
  isPaperOnly, previousStep, strategyFlowReducer,
} from "../web/strategy-switch-console/frontend/src/desk/strategies/model.ts";
import {
  REMINDER_PHASES, credentialNeed, credentialNeeds, normalizeCredentialPhase, reminderCounts,
} from "../web/strategy-switch-console/frontend/src/desk/credentials/model.ts";
import { DESK_MESSAGES, deskTranslate } from "../web/strategy-switch-console/frontend/src/desk/i18n/index.ts";
import { deskRoute } from "../web/strategy-switch-console/frontend/src/desk/components/stateModel.ts";

const source = path => readFileSync(new URL(`../web/strategy-switch-console/frontend/src/desk/${path}`, import.meta.url), "utf8");
const en = (key, params) => deskTranslate("en", key, params);

// ---------------------------------------------------------------- switch machine
const target = { type: "select_target", targetId: "schwab/core" };
let state = strategyFlowReducer(INITIAL_STRATEGY_FLOW, target);
assert.equal(state.step, "strategy");
assert.equal(state.targetId, "schwab/core");
assert.equal(state.preview, null);

// Blocked catalog entries stay on the strategy step and never reach preview.
const blocked = strategyFlowReducer(state, { type: "select_strategy", profile: "trend_break", eligibility: "blocked", reason: "no_live_data" });
assert.equal(blocked.step, "strategy");
assert.equal(blocked.blockedReason, "no_live_data");
assert.equal(blocked.preview, null);
assert.equal(strategyFlowReducer(blocked, { type: "preview_ready", preview: { targetId: "schwab/core", profile: "trend_break", current: null, after: {}, mode: null } }), blocked, "blocked never previews");

// Eligible entries advance to preview; preview only advances from preview.
const previewing = strategyFlowReducer(state, { type: "select_strategy", profile: "trend_break", eligibility: "eligible", reason: null });
assert.equal(previewing.step, "preview");
assert.equal(previewing.profile, "trend_break");
assert.equal(strategyFlowReducer(previewing, { type: "request_confirm", allowed: true, reason: null }), previewing, "no confirm without a preview");

const preview = { targetId: "schwab/core", profile: "trend_break", current: null, after: { profile: "trend_break" }, mode: "paper" };
const confirming = strategyFlowReducer(previewing, { type: "preview_ready", preview });
assert.equal(confirming.step, "confirm");
assert.equal(confirming.preview, preview);
assert.equal(strategyFlowReducer(state, { type: "preview_ready", preview }), state, "preview_ready ignored outside preview");

// A disabled confirm never reaches verify and keeps the reason.
const refused = strategyFlowReducer(confirming, { type: "request_confirm", allowed: false, reason: "switch_not_connected" });
assert.equal(refused.step, "confirm");
assert.equal(refused.blockedReason, "switch_not_connected");
assert.equal(strategyFlowReducer(confirming, { type: "request_confirm", allowed: true, reason: null }).step, "verify");
assert.equal(strategyFlowReducer(confirming, { type: "forbidden" }).step, "confirm");
assert.equal(strategyFlowReducer(confirming, { type: "forbidden" }).forbidden, true);

// Back walks one step and clears the stale preview; reset returns to the target step.
assert.equal(previousStep("target"), "target");
assert.deepEqual(SWITCH_STEPS.map(previousStep), ["target", "target", "strategy", "preview", "confirm"]);
const backFromConfirm = strategyFlowReducer(confirming, { type: "back" });
assert.equal(backFromConfirm.step, "preview");
assert.equal(backFromConfirm.preview, null);
assert.equal(backFromConfirm.blockedReason, null);
assert.equal(strategyFlowReducer({ ...confirming, step: "verify" }, { type: "back" }).preview, preview);
assert.deepEqual(strategyFlowReducer(confirming, { type: "reset" }), INITIAL_STRATEGY_FLOW);

// Counts are over catalog entries, not running targets; filters follow the same rule.
const catalog = [
  { profile: "a", eligibility: "eligible", allowed_execution_modes: ["paper", "live"] },
  { profile: "b", eligibility: "eligible", allowed_execution_modes: ["paper"] },
  { profile: "c", eligibility: "no_live", allowed_execution_modes: ["paper"] },
  { profile: "d", eligibility: "blocked", allowed_execution_modes: [] },
];
assert.deepEqual(STRATEGY_FILTERS, ["all", "eligible", "paper", "blocked"]);
assert.deepEqual(catalogCounts(catalog), { all: 4, eligible: 2, paper: 2, blocked: 1 });
assert.deepEqual(catalogCounts([]), { all: 0, eligible: 0, paper: 0, blocked: 0 });
assert.equal(isPaperOnly(catalog[1]), true);
assert.equal(isPaperOnly(catalog[0]), false);
assert.equal(isPaperOnly(catalog[3]), false);
assert.deepEqual(filterCatalog(catalog, "all").map(o => o.profile), ["a", "b", "c", "d"]);
assert.deepEqual(filterCatalog(catalog, "eligible").map(o => o.profile), ["a", "b"]);
assert.deepEqual(filterCatalog(catalog, "paper").map(o => o.profile), ["b", "c"]);
assert.deepEqual(filterCatalog(catalog, "blocked").map(o => o.profile), ["d"]);
assert.notEqual(filterCatalog(catalog, "all"), catalog, "the catalog array is never mutated or aliased");

// ------------------------------------------------------- 401 vs 403 vs network
const failures = [
  classifySessionFailure(new AccessError(401)),
  classifySessionFailure(new AccessError(403)),
  classifySessionFailure(new TypeError("Failed to fetch")),
];
assert.deepEqual(failures, ["unauthorized", "forbidden", "network"]);
assert.equal(new Set(failures).size, 3, "the three failures stay distinct");
assert.equal(classifySessionFailure({ status: 401 }), "unauthorized");
assert.equal(classifySessionFailure({ status: 403 }), "forbidden");
assert.equal(classifySessionFailure(new HttpError(500, null)), "network");
assert.equal(classifySessionFailure(null), "network");
assert.equal(classifySessionFailure(undefined), "network");

assert.equal(deskAccess({ state: "failed", failure: "unauthorized" }), "login");
assert.equal(deskAccess({ state: "failed", failure: "forbidden" }), "denied");
assert.equal(deskAccess({ state: "failed", failure: "network" }), "error");
assert.equal(deskAccess({ state: "failed" }), "error", "an unknown cause is a read failure, not a permission problem");

// --------------------------------------------------------------- fail closed
for (const session of [
  { state: "loading" },
  { state: "failed" },
  { state: "failed", failure: "network" },
  { state: "ready" },
  { state: "ready", result: {} },
  { state: "ready", result: { data: null } },
  { state: "ready", result: { data: "open" } },
  { state: "ready", result: { data: [] } },
  { state: "ready", result: { data: {} } },
  { state: "ready", result: { data: { authenticated: true } } },
  { state: "ready", result: { data: { allowed: true } } },
  { state: "ready", result: { data: { authenticated: true, allowed: "true" } } },
  { state: "ready", result: { data: { authenticated: 1, allowed: 1 } } },
  { state: "ready", result: { data: { authenticated: false, allowed: true } } },
  { state: "ready", result: { data: { authenticated: true, allowed: false } } },
]) {
  assert.notEqual(deskAccess(session), "open", JSON.stringify(session));
  assert.equal(isOpenSession(session), false, JSON.stringify(session));
}
assert.equal(deskAccess({ state: "ready", result: { data: { authenticated: true, allowed: true } } }), "open");
assert.equal(isOpenSession({ state: "ready", result: { data: { authenticated: true, allowed: true } } }), true);

// The page body is only reachable through the open gate; no early content branch.
const deskApp = source("DeskApp.tsx");
assert.match(deskApp, /const content = access === "open" \? pageContent/);
assert.match(deskApp, /access === "loading" \?/);
assert.doesNotMatch(deskApp, /access !== "loading" \? pageContent/, "no inverse gate");

// Action-level 403 stays in the page, and a switch that is not allowed cannot confirm.
const strategies = source("pages/StrategiesPage.tsx");
assert.match(strategies, /!admin \|\| flow\.forbidden \? <InlineForbidden/);
assert.match(strategies, /disabled=\{!admin \|\| switchable\?\.allowed !== true\}/);

// ---------------------------------------------------- credential needs-you rules
const t = en;
const expiry = { status: "known", at: "2026-11-09T14:00:00Z", source: "manual" };
const item = (id, phase) => ({ id, label: `Credential ${id}`, phase, expiry });
const quiet = [item("c30", "30"), item("cunknown", "unknown"), item("cnotdue", "not_due"), item("c14", "14")];
assert.deepEqual(credentialNeeds(quiet, t, "en"), [], "30, unknown, not_due and legacy 14 create no Needs-you item");
assert.equal(credentialNeed(item("c30", "30"), t, "en"), null);
assert.equal(credentialNeed(item("cunknown", "unknown"), t, "en"), null);
assert.equal(credentialNeed(item("c14", "14"), t, "en"), null, "14 maps to 30, not to a reminder phase");

const due = credentialNeeds([item("c7", "7"), item("c1", "1"), item("cexp", "expired")], t, "en");
assert.deepEqual(due.map(entry => entry.id), ["credential:c7", "credential:c1", "credential:cexp"]);
assert.deepEqual(due.map(entry => entry.kind), ["credential_expiring", "credential_expiring", "credential_expiring"]);
assert.deepEqual(due.map(entry => entry.severity), ["warning", "warning", "critical"]);
assert.equal(due[0].action.route, "#/desk/accounts?tab=credentials&credential=c7");
assert.equal(due[0].target_id, null);
for (const entry of due) assert.match(entry.title, /Credential c/);

// Input order is kept, and only the due phases survive a mixed list.
const mixed = credentialNeeds([item("a", "expired"), item("b", "30"), item("c", "1"), item("d", "unknown"), item("e", "7")], t, "en");
assert.deepEqual(mixed.map(entry => entry.id), ["credential:a", "credential:c", "credential:e"]);

// ------------------------------------------------------ reminder strip has no 14
assert.deepEqual(REMINDER_PHASES, ["not_due", "30", "7", "1", "expired", "unknown"]);
assert.equal(REMINDER_PHASES.includes("14"), false);
assert.deepEqual(reminderCounts([{ phase: "14" }, { phase: "30" }]), { not_due: 0, "30": 2, "7": 0, "1": 0, expired: 0, unknown: 0 });
assert.equal(normalizeCredentialPhase("14"), "30");
assert.equal(normalizeCredentialPhase("15"), "unknown");
const strip = source("components/CredentialsReminderStrip.tsx");
assert.match(strip, /REMINDER_PHASES\.map/);
assert.doesNotMatch(strip, /["'`]14["'`]/, "the strip has no 14 segment");
for (const language of ["zh", "en"]) {
  assert.equal(Object.keys(DESK_MESSAGES[language]).includes("credentials.reminder.14"), false, language);
}

// Needs-you mock routes are old console paths and must land on the desk hash routes.
assert.equal(deskRoute("/accounts?tab=credentials&credential=cred_schwab_oauth"), "#/desk/accounts?tab=credentials&credential=cred_schwab_oauth");
assert.equal(deskRoute("/overview?target=ibkr/soxl"), "#/desk/overview?target=ibkr/soxl");
assert.equal(deskRoute("#/desk/switch?target=schwab/core"), "#/desk/switch?target=schwab/core");
assert.equal(deskRoute("/nope"), "#/desk/overview");

// ------------------------------------------------------------ 403 never "account"
for (const language of ["zh", "en"]) {
  for (const [key, value] of Object.entries(DESK_MESSAGES[language])) {
    assert.doesNotMatch(value, /this account/i, `${language} ${key}`);
  }
}
assert.equal(DESK_MESSAGES.zh["access.denied"], "当前登录身份没有访问权限。");
assert.equal(DESK_MESSAGES.en["access.denied"], "This sign-in does not have access.");
assert.match(DESK_MESSAGES.zh["access.denied"], /当前登录身份/);
assert.doesNotMatch(DESK_MESSAGES.zh["access.denied"], /这个账号|此账户|该账户|该帐号|此账号/);
assert.match(DESK_MESSAGES.en["access.denied"], /sign-in/);
for (const file of ["pages/AuthPage.tsx", "pages/StrategiesPage.tsx", "DeskApp.tsx", "shell/DeskShell.tsx"]) {
  assert.doesNotMatch(source(file), /this account/i, file);
}

console.log("console_desk_pages_validation: PASS (switch machine, access failures, credential rules; synthetic only)");
