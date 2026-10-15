import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { loadReadModel, loadRuntimeDaily } from "../web/strategy-switch-console/frontend/src/api.ts";
import { overviewRuntimeStatusLabel, runtimeDailySelectionEligible, runtimeDailySelectionFromAccount, runtimeDailySnapshotMatchesSelection, runtimeDateSelectable } from "../web/strategy-switch-console/frontend/src/presentation.ts";
import { loadOverviewUsdRates, resetOverviewUsdRatesCache } from "../web/strategy-switch-console/frontend/src/overviewUsd.ts";

const monitored = {
  scope: "monitoring_only",
  limit: "not_trading_or_books",
  health: "normal",
  activation: "enabled",
  reason: "monitoring_agrees",
};
assert.equal(overviewRuntimeStatusLabel(monitored, "ready"), "健康");
assert.equal(overviewRuntimeStatusLabel({ ...monitored, activation: "disabled" }, "ready"), "健康");
assert.equal(overviewRuntimeStatusLabel({ ...monitored, health: "unknown", activation: "disabled" }, "ready"), "异常");
assert.equal(overviewRuntimeStatusLabel({ ...monitored, health: "abnormal", activation: "enabled" }, "ready"), "异常");
assert.equal(overviewRuntimeStatusLabel({ ...monitored, health: "unknown", activation: "unknown", reason: "source_not_fresh" }, "stale"), "异常");

const originalFetch = globalThis.fetch;
const denyNetwork = async () => { throw new Error("external network is forbidden in overview refresh validation"); };
const requestedPaths = [];
globalThis.fetch = async (path, options) => {
  const unused = ["/api/strategy-health", "/api/execution-evidence", "/api/research-tasks", "/api/runtime-catalog", "/api/m0-research", "/api/adaptive-selection"];
  assert.ok(!unused.includes(path), `${path} has no overview consumer and must not delay loading`);
  assert.ok(["/api/session", "/api/config", "/api/runtime-target-lifecycle", "/api/control-plane", "/api/ux1/draft", "/api/owner-decisions", "/api/reconciliation-recovery", "/api/research-promotion-tickets", "/api/account-facts", "/api/binance-account-facts"].includes(path), "only current read-model sources are mocked");
  assert.equal(options.method, "GET");
  requestedPaths.push([path, options.method, options.cache]);
  const payload = path === "/api/session" ? { allowed: true, admin: false } : path === "/api/runtime-target-lifecycle" ? { data_status: "ready" } : { data_status: "fresh" };
  return { status: 200, ok: true, json: async () => payload };
};
try {
  const model = await loadReadModel();
  assert.deepEqual(requestedPaths.map(([path]) => path), ["/api/session", "/api/config", "/api/runtime-target-lifecycle", "/api/control-plane", "/api/ux1/draft", "/api/owner-decisions", "/api/reconciliation-recovery", "/api/research-promotion-tickets", "/api/account-facts", "/api/binance-account-facts"]);
  assert.equal(model.runtime.value.data_status, "ready");
  assert.equal(model.accountFacts.value.data_status, "fresh");
  assert.equal("health" in model, false);
  assert.equal("evidence" in model, false);
  assert.equal("tasks" in model, false);
  assert.equal("catalog" in model, false);
  assert.equal("market" in model, false);
  assert.equal("adaptive" in model, false);
} finally {
  globalThis.fetch = denyNetwork;
}

const app = readFileSync(new URL("../web/strategy-switch-console/frontend/src/App.tsx", import.meta.url), "utf8");
assert.doesNotMatch(app, /startVisibleRefreshLoop|window\.setInterval/, "the App must not install background or focus-driven network refreshes");
const fullRefresh = app.slice(app.indexOf("const refresh = useCallback"), app.indexOf("useEffect(() => { void refresh(); }, []);"));
assert.match(fullRefresh, /gate\.current\.begin\(\)/);
assert.match(fullRefresh, /if \(!gate\.current\.isCurrent\(token\)\)/);
assert.match(fullRefresh, /setModel\(next\);\s*setOverviewReadModelRefreshVersion/, "explicit readback refreshes overview detail data in the same batch as the model");
assert.match(app, /useEffect\(\(\) => \{ void refresh\(\); \}, \[\]\)/, "boot load is mount-only");
const overview = readFileSync(new URL("../web/strategy-switch-console/frontend/src/OverviewPage.tsx", import.meta.url), "utf8");
const runtimeEffect = overview.slice(overview.lastIndexOf("  useEffect(() => {", overview.indexOf("const todayAccounts =")), overview.indexOf("  useEffect(() => {", overview.indexOf("const todayAccounts =")));
assert.match(runtimeEffect, /runtimeDateSelectable\(runtimeDate, runtimeNow\)/);
assert.match(runtimeEffect, /visible\.filter\(account => runtimeDailySelectionEligible/);
assert.match(runtimeEffect.slice(runtimeEffect.indexOf("}, [")), /runtimeToday/, "the New York business-day rollover refreshes current daily data");
assert.match(overview, /selectedRuntimeDate \|\| runtimeToday/, "the default date follows today while a manually selected date remains pinned");
assert.match(runtimeEffect, /if \(!active\) return/);
assert.match(runtimeEffect, /return \(\) => \{ active = false; \}/);
assert.match(runtimeEffect, /readModelRefreshVersion/);

// Execute the current performance hook to preserve stale-response protection.
const charts = readFileSync(new URL("../web/strategy-switch-console/frontend/src/PerformanceCharts.tsx", import.meta.url), "utf8");
const hookStart = charts.lastIndexOf("  useEffect(() => {", charts.indexOf("const current = ++epoch.current"));
const hookEnd = charts.indexOf("  const data =", hookStart);
const historyHook = charts.slice(hookStart, hookEnd).trim();
assert.match(charts, /a\.facts\?\.observed_finished_at/);
assert.match(charts, /rates, refreshVersion/);
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
const pending = [];
function historyHarness() {
  const state = { loaded: null };
  let dependencies, cancel;
  const context = createContext({
    epoch: { current: 0 }, members: [{ id: 'synthetic-a' }], rates: {}, requestKey: 'a:0',
    setLoaded: value => { state.loaded = value; },
    loadPerformanceData: (members, rates) => new Promise(resolve => pending.push({ members, rates, resolve })),
    useEffect(effect, next) {
      if (dependencies && next.every((value,index)=>Object.is(value,dependencies[index]))) return;
      cancel?.(); dependencies = Array.from(next); cancel = effect();
    },
  });
  return { state, render(patch = {}) { Object.assign(context,patch); runInContext(historyHook,context); }, unmount() { cancel?.(); } };
}
const harness = historyHarness();
harness.render();
assert.equal(pending.length,1);
harness.render();
assert.equal(pending.length,1,'same scope does not duplicate in-flight history reads');
harness.render({ requestKey:'a:1' });
assert.equal(pending.length,2,'explicit refresh retries history without requiring a timestamp change');
pending[1].resolve({ marker:'recovered' }); await flush();
pending[0].resolve({ marker:'old' }); await flush();
assert.equal(harness.state.loaded.data.marker,'recovered','late old responses are discarded');
harness.render({ requestKey:'b:1', members:[{id:'synthetic-b'}] });
assert.equal(pending[2].members[0].id,'synthetic-b');
harness.unmount();
pending[2].resolve({marker:'after-unmount'}); await flush();
assert.equal(harness.state.loaded.data.marker,'recovered','unmount invalidates pending reads');
globalThis.fetch = originalFetch;

console.log("overview refresh validation: PASS");

// Execute the single production daily effect against deferred synthetic reads.
const runtimeHookStart = overview.lastIndexOf("  useEffect(() => {", overview.indexOf("const todayAccounts ="));
const runtimeHookEnd = overview.indexOf("  useEffect(() => {", runtimeHookStart + 1);
const runtimeHook = overview.slice(runtimeHookStart, runtimeHookEnd).trim()
  .replace("new Map<string, { account: OverviewAccount; date: string }>()", "new Map()");
const syntheticAccounts = ["longbridge", "schwab"].map(platform => ({ id: `${platform}:synthetic-same`, platformKey: platform, accountKey: "synthetic-same", runtimeDailyBinding: "bound" }));
const syntheticTargets = {
  longbridge: "longbridge-quant-paper-service|russell_top50_leader_rotation|paper",
  schwab: "charles-schwab-quant-service|soxl_soxx_trend_income|live",
};
const dailyPending = [];
globalThis.fetch = (path, options) => {
  assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store");
  assert.match(path, /^\/api\/runtime-daily\?date=2026-10-0[4-7]&platform=(longbridge|schwab)&account_key=synthetic-same$/);
  return new Promise((resolve, reject) => dailyPending.push({ path, resolve, reject }));
};
function dailyRespond(index, marker = "ok", status = 200, patch = {}) {
  const request = dailyPending[index]; const url = new URL(request.path, "https://synthetic.example");
  const platform = url.searchParams.get("platform");
  request.resolve({ ok: status === 200, status, json: async () => ({
    ok: true, platform, account_key: "synthetic-same", target_key: syntheticTargets[platform],
    date: url.searchParams.get("date"), timezone: "America/New_York", data_status: "unavailable", record: null, fills: null, marker, ...patch,
  }) });
}
function dailyHarness() {
  let state = {}; let dependencies; let cancel; let mounted = true;
  const update = value => { state = typeof value === "function" ? value(state) : value; };
  const context = createContext({
    Error, Object, JSON, Map,
    runtimeDate: "2026-10-06", runtimeToday: "2026-10-06", runtimeNow: Date.parse("2026-10-06T21:00:00Z"),
    accountId: "all", visible: syntheticAccounts, accounts: syntheticAccounts, readModelRefreshVersion: 0,
    setRuntimeDaily: update, runtimeDailyRequestKey: (platform, account, binding, date) => JSON.stringify([platform, account, binding, date]),
    runtimeDailySelectionEligible, runtimeDailySelectionFromAccount, runtimeDailySnapshotMatchesSelection, runtimeDateSelectable, loadRuntimeDaily,
    useEffect(effect, next) {
      if (dependencies && next.length === dependencies.length && next.every((value, index) => Object.is(value, dependencies[index]))) return;
      cancel?.(); dependencies = Array.from(next); cancel = effect();
    },
  });
  return {
    get state() { return state; },
    context,
    get selectedDate() { return context.runtimeDate; },
    render(patch = {}) { assert.equal(mounted, true); Object.assign(context, patch); runInContext(runtimeHook, context, { timeout: 1000 }); },
    unmount() { mounted = false; cancel?.(); },
  };
}
const dailyKey = (account, date) => JSON.stringify([account.platformKey, account.accountKey, account.runtimeDailyBinding, date]);
const lbTodayKey = dailyKey(syntheticAccounts[0], "2026-10-06");
const schwabTodayKey = dailyKey(syntheticAccounts[1], "2026-10-06");
const schwabHistoryKey = dailyKey(syntheticAccounts[1], "2026-10-05");
try {
  const daily = dailyHarness(); daily.render();
  assert.equal(dailyPending.length, 2, "when selected date is today, each account has one GET shared by history and health cards");
  assert.ok(dailyPending.every(item => item.path.includes("date=2026-10-06")));
  dailyRespond(0, "paper-success"); dailyRespond(1, "schwab-success"); await flush();
  assert.equal(daily.state[lbTodayKey].value.marker, "paper-success");
  assert.strictEqual(
    daily.state[dailyKey(syntheticAccounts[0], daily.context.runtimeDate)],
    daily.state[dailyKey(syntheticAccounts[0], daily.context.runtimeToday)],
    "history and the health card consume one state entry when their dates match",
  );
  assert.equal(daily.state[schwabTodayKey].value.marker, "schwab-success");
  const historyStart = dailyPending.length;
  daily.render({ runtimeDate: "2026-10-05", visible: [syntheticAccounts[1]], accountId: syntheticAccounts[1].id });
  assert.equal(dailyPending.length - historyStart, 3, "historical selection reads its visible account while today's health reads all accounts");
  assert.equal(dailyPending.slice(historyStart).filter(item => item.path.includes("date=2026-10-05")).length, 1);
  assert.equal(dailyPending.slice(historyStart).filter(item => item.path.includes("date=2026-10-06")).length, 2);
  const oldHistory = historyStart + 2;
  daily.render({ accountId: "all", visible: syntheticAccounts });
  const freshStart = dailyPending.length - 4;
  dailyRespond(freshStart, "new-today-paper"); dailyRespond(freshStart + 1, "new-today-schwab");
  dailyRespond(freshStart + 2, "new-history-paper"); dailyRespond(freshStart + 3, "new-history-schwab");
  dailyPending[oldHistory].reject(new Error("late old selection")); await flush();
  assert.ok(daily.state[lbTodayKey]?.value, JSON.stringify(daily.state[lbTodayKey]));
  assert.equal(daily.state[lbTodayKey].value.marker, "new-today-paper");
  assert.equal(daily.state[schwabTodayKey].value.marker, "new-today-schwab");
  assert.equal(daily.state[schwabHistoryKey].value.marker, "new-history-schwab", "old selection response cannot replace current daily data");

  daily.render({ runtimeDate: "2026-10-04" });
  const oldDateRequest = dailyPending.length - 1;
  daily.render({ runtimeDate: "2026-10-05" });
  const newDateStart = dailyPending.length - 4;
  dailyRespond(newDateStart, "date-paper"); dailyRespond(newDateStart + 1, "date-schwab");
  dailyRespond(newDateStart + 2, "date-history-paper"); dailyRespond(newDateStart + 3, "date-history");
  dailyRespond(oldDateRequest, "late-old-date"); await flush();
  assert.equal(daily.state[schwabHistoryKey].value.marker, "date-history");

  daily.render({ readModelRefreshVersion: 1 });
  const staleRefreshStart = dailyPending.length - 4;
  daily.render({ readModelRefreshVersion: 2 });
  const freshRefreshStart = dailyPending.length - 4;
  dailyRespond(freshRefreshStart, "refresh-paper"); dailyRespond(freshRefreshStart + 1, "refresh-schwab");
  dailyRespond(freshRefreshStart + 2, "refresh-history-paper");
  const wrongIdentity = freshRefreshStart + 3;
  dailyRespond(wrongIdentity, "wrong-platform", 200, { platform: "longbridge" }); await flush();
  assert.equal(daily.state[schwabHistoryKey].value, null);
  assert.equal(daily.state[schwabHistoryKey].error, "runtime_daily_selection_mismatch");
  dailyRespond(staleRefreshStart + 3, "late-before-refresh"); await flush();
  assert.equal(daily.state[schwabHistoryKey].value, null, "a late response from before explicit refresh cannot replace its result");

  const changedBindingAccounts = [syntheticAccounts[0], { ...syntheticAccounts[1], runtimeDailyBinding: "unresolved" }];
  const beforeBinding = dailyPending.length;
  const staleBoundSchwab = staleRefreshStart + 1;
  daily.render({ accounts: changedBindingAccounts, visible: changedBindingAccounts });
  assert.equal(dailyPending.length, beforeBinding + 2, "an unresolved source binding has no historical or current daily read");
  assert.equal(daily.state[dailyKey(changedBindingAccounts[1], "2026-10-05")], undefined);
  dailyRespond(staleBoundSchwab, "late-old-binding"); await flush();
  assert.equal(daily.state[schwabTodayKey], undefined, "a late result from the old binding cannot restore the old key");

  daily.render({ readModelRefreshVersion: 3 }); const afterUnmount = dailyPending.length - 1;
  daily.unmount(); const stopped = JSON.stringify(daily.state); dailyRespond(afterUnmount, "late-unmount"); await flush();
  assert.equal(JSON.stringify(daily.state), stopped);

  const pinned = dailyHarness(); const opening = dailyPending.length;
  pinned.render({ runtimeDate: "2026-10-05" });
  assert.equal(dailyPending.length - opening, 4);
  pinned.render({ runtimeToday: "2026-10-07", runtimeNow: Date.parse("2026-10-07T04:01:00Z") });
  assert.equal(pinned.selectedDate, "2026-10-05", "crossing New York midnight keeps the chosen historical date");
  assert.equal(dailyPending.length - opening, 8, "the New York business-day rollover reloads current and selected historical records");
  pinned.render({ readModelRefreshVersion: 1 });
  assert.equal(dailyPending.length - opening, 12, "explicit readback reloads selected history and the actual current day");
  pinned.unmount();
  const future = dailyHarness(); const futureStart = dailyPending.length;
  future.render({ runtimeDate: "2026-10-07" });
  assert.equal(dailyPending.length - futureStart, 2, "a future selected date is not requested");
  future.render({ runtimeToday: "2026-10-07", runtimeNow: Date.parse("2026-10-07T04:01:00Z") });
  assert.equal(dailyPending.length - futureStart, 4, "a business-day rollover requests that newly current date");
  future.render({ readModelRefreshVersion: 1 });
  assert.equal(dailyPending.length - futureStart, 6, "explicit refresh reloads the current day once per account");
  future.unmount();
  console.log("daily hook races: PASS (dedupe, shared today result, history/current separation, selection and date races, binding, refresh, identity match and midnight)");
} finally {
  globalThis.fetch = originalFetch;
}

// Run the actual FX effect and production loader. A failed initial request must
// recover on the existing explicit readback refresh without adding polling.
const fxHookStart = overview.indexOf("  useEffect(() => {", overview.indexOf("const [overviewUsdRates"));
const fxHookEnd = overview.indexOf("  // Prefer [] over null", fxHookStart);
const fxHook = overview.slice(fxHookStart, fxHookEnd).trim();
function fxHarness(loader = loadOverviewUsdRates) {
  const state = { rates: {}, updates: 0 };
  let dependencies; let cancel; let mounted = true;
  const context = createContext({
    readModelRefreshVersion: 0, OVERVIEW_USD_RATES: {}, loadOverviewUsdRates: loader,
    setOverviewUsdRates(value) { state.rates = value; state.updates += 1; },
    useEffect(effect, next) {
      if (dependencies && next.length === dependencies.length && next.every((value, index) => Object.is(value, dependencies[index]))) return;
      cancel?.(); dependencies = Array.from(next); cancel = effect();
    },
  });
  return {
    state,
    render(patch = {}) { assert.equal(mounted, true); Object.assign(context, patch); runInContext(fxHook, context, { timeout: 1000 }); },
    unmount() { mounted = false; cancel?.(); },
  };
}
const fxPending = [];
globalThis.fetch = (path, options) => {
  assert.equal(path, "/api/overview-fx", "FX refresh reads only the existing same-origin endpoint");
  assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store");
  return new Promise(resolve => fxPending.push(resolve));
};
resetOverviewUsdRatesCache();
try {
  const recovery = fxHarness(); recovery.render();
  assert.equal(fxPending.length, 1);
  fxPending[0](new Response(JSON.stringify({ ok: false, error: "overview_fx_upstream_unavailable" }), { status: 502 }));
  await flush();
  assert.deepEqual({ ...recovery.state.rates }, {}, "failed FX never manufactures conversion rates");
  recovery.render();
  assert.equal(fxPending.length, 1, "the same refresh version does not retry a failed FX read");
  recovery.render({ readModelRefreshVersion: 1 });
  assert.equal(fxPending.length, 2, "explicit readback refresh retries FX after its initial failure");
  recovery.render({ readModelRefreshVersion: 1 });
  assert.equal(fxPending.length, 2, "same-version renders do not duplicate an in-flight FX read");
  fxPending[1](new Response(JSON.stringify({ base: "USD", rates: { HKD: 8, SGD: 2 } }), { status: 200 }));
  await flush();
  assert.deepEqual({ ...recovery.state.rates }, { HKD: "0.125", SGD: "0.5" }, "recovered reference rates reach the overview");
  recovery.render({ readModelRefreshVersion: 2 }); await flush();
  assert.equal(fxPending.length, 2, "explicit refresh preserves the production loader's successful cache");
  recovery.unmount();

  // Controlled deferred loader results exercise effect cancellation itself,
  // separately from the production loader's shared in-flight/cache behavior.
  const deferred = [];
  const races = fxHarness(() => new Promise(resolve => deferred.push(resolve)));
  races.render(); races.render({ readModelRefreshVersion: 1 });
  assert.equal(deferred.length, 2);
  deferred[1]({ HKD: "0.125" }); await flush();
  deferred[0]({ HKD: "0.1" }); await flush();
  assert.deepEqual({ ...races.state.rates }, { HKD: "0.125" }, "late pre-refresh FX cannot overwrite current rates");
  assert.equal(races.state.updates, 1, "cancelled prior FX effects cannot publish state");
  races.render({ readModelRefreshVersion: 2 });
  const beforeUnmount = JSON.stringify(races.state);
  races.unmount(); deferred[2]({ SGD: "0.5" }); await flush();
  assert.equal(JSON.stringify(races.state), beforeUnmount, "unmount cancels late FX state updates");
  console.log("FX hook recovery and races: PASS");
} finally {
  resetOverviewUsdRatesCache(); globalThis.fetch = originalFetch;
}

await import("./console_load_lifecycle_validation.mjs");
