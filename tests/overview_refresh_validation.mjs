import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { loadAccountFactsHistory, loadBinanceWalletHistory, loadRuntimeDaily, loadOverviewReadModels, mergeOverviewReadModels } from "../web/strategy-switch-console/frontend/src/api.ts";
import { overviewRuntimeStatusLabel, runtimeDailyAccountDateKey, runtimeDailySelectionEligible, runtimeDailySnapshotMatchesSelection, runtimeDateSelectable } from "../web/strategy-switch-console/frontend/src/presentation.ts";

const monitored = {
  scope: "monitoring_only",
  limit: "not_trading_or_books",
  health: "normal",
  activation: "enabled",
  reason: "monitoring_agrees",
};
assert.equal(overviewRuntimeStatusLabel(monitored, "ready"), "监测正常");
assert.equal(overviewRuntimeStatusLabel({ ...monitored, activation: "disabled" }, "ready"), "已停用");
assert.equal(overviewRuntimeStatusLabel({ ...monitored, health: "unknown", activation: "disabled" }, "ready"), "待确认");
assert.equal(overviewRuntimeStatusLabel({ ...monitored, health: "abnormal", activation: "enabled" }, "ready"), "异常");
assert.equal(overviewRuntimeStatusLabel({ ...monitored, health: "unknown", activation: "unknown", reason: "source_not_fresh" }, "stale"), "待确认");

const current = {
  config: { value: { draft: "keep" } },
  research: { value: { draft: "user edit" } },
  runtime: { value: { version: 1 } },
  accountFacts: { value: { version: 1 } },
  binanceFacts: { value: { report: null } },
};
const merged = mergeOverviewReadModels(current, {
  runtime: { value: { version: 2 }, error: null },
  accountFacts: { value: { version: 2 }, error: null },
  binanceFacts: { value: { report: { assets: [] } }, error: null },
});
assert.equal(merged.config, current.config);
assert.equal(merged.research, current.research);
assert.deepEqual(merged.runtime.value, { version: 2 });
assert.deepEqual(merged.accountFacts.value, { version: 2 });
assert.deepEqual(merged.binanceFacts.value, { report: { assets: [] } });
assert.equal(mergeOverviewReadModels(null, { runtime: { value: null, error: null }, accountFacts: { value: null, error: null } }), null);

const originalFetch = globalThis.fetch;
const denyNetwork = async () => { throw new Error("external network is forbidden in overview refresh validation"); };
const requestedPaths = [];
globalThis.fetch = async (path, options) => {
  assert.ok(["/api/runtime-target-lifecycle", "/api/account-facts", "/api/binance-account-facts"].includes(path), "only the exact internal overview reads are mocked");
  assert.equal(options.method, "GET");
  requestedPaths.push([path, options.method, options.cache]);
  const payload = path === "/api/runtime-target-lifecycle" ? { data_status: "ready" } : { data_status: "fresh" };
  return { status: 200, ok: true, json: async () => payload };
};
try {
  const updates = await loadOverviewReadModels();
  assert.deepEqual(requestedPaths, [
    ["/api/runtime-target-lifecycle", "GET", "no-store"],
    ["/api/account-facts", "GET", "no-store"],
    ["/api/binance-account-facts", "GET", "no-store"],
  ]);
  assert.equal(updates.runtime.value.data_status, "ready");
  assert.equal(updates.accountFacts.value.data_status, "fresh");
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
const historyEffect = overview.slice(overview.indexOf("const epoch = ++historyEpoch.current"), overview.indexOf("const epoch = ++runtimeEpoch.current"));
assert.match(historyEffect, /chartAccount\?\.id[\s\S]*chartFacts\?\.observed_finished_at/);
assert.doesNotMatch(historyEffect, /selectedFacts\?\.observed_finished_at/);
const runtimeEffect = overview.slice(overview.indexOf("const epoch = ++runtimeEpoch.current"), overview.indexOf("// All-account totals"));
assert.match(runtimeEffect, /runtimeDateSelectable\(runtimeDate, runtimeNow\)/);
assert.match(runtimeEffect, /visible\.filter\(account => runtimeDailySelectionEligible/);
assert.doesNotMatch(runtimeEffect, /runtimeDate === runtimeToday \? readModelRefreshVersion : 0/, "crossing midnight cannot change a fetch dependency");
assert.doesNotMatch(overview, /previousToday|setRuntimeDate\(date =>/, "the clock never rewrites the selected day");
assert.match(runtimeEffect, /runtimeEpoch\.current !== epoch/);
assert.match(runtimeEffect, /return cancel/);
assert.match(runtimeEffect, /\[dailyAccountsKey, readModelRefreshVersion\]/, "today health reads only on opening, exact binding changes, or explicit readback");

// Execute the actual history hook and dependency list without a browser or a
// provider. This is a hook lifecycle harness, not full React rendering evidence.
const hookStart = overview.lastIndexOf("  useEffect(() => {", overview.indexOf("const epoch = ++historyEpoch.current"));
const hookEnd = overview.indexOf("  useEffect(() => {", hookStart + 1);
const historyHook = overview.slice(hookStart, hookEnd).trim();
assert.match(historyHook, /^useEffect\(\(\) => \{/);
assert.match(historyHook, /\]\);$/);
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
const pending = [];
globalThis.fetch = (path, options) => {
  assert.equal(options.method, "GET", "history recovery cannot perform writes");
  assert.equal(options.cache, "no-store");
  assert.ok(/^\/api\/(?:account-facts\/history\?platform=longbridge&account_key=synthetic-[ab]&currency=(?:USD|EUR)|binance-account-facts\/history\?account_key=synthetic-wallet)$/.test(path), "only synthetic internal history reads are mocked");
  return new Promise((resolve, reject) => pending.push({ path, resolve, reject }));
};
function historyHarness(accountKey = "synthetic-a", walletChartSelected = false) {
  const state = { history: null, walletHistory: null, error: null, loading: false, key: "" };
  let dependencies;
  let cancel;
  let mounted = true;
  const context = createContext({
    Error,
    historyEpoch: { current: 0 },
    chartAccount: { id: accountKey, platformKey: walletChartSelected ? "binance" : "longbridge", accountKey },
    chartFacts: { observed_finished_at: "2026-10-06T00:00:00Z" },
    binanceFacts: { value: { report: { observed_finished_at: "2026-10-06T00:00:00Z" } } },
    walletChartSelected, currency: walletChartSelected ? "USDT" : "USD", chart: "assets",
    requestedHistoryKey: "synthetic-history", readModelRefreshVersion: 0,
    setHistory: value => { state.history = value; },
    setWalletHistory: value => { state.walletHistory = value; },
    setHistoryError: value => { state.error = value; },
    setHistoryLoading: value => { state.loading = value; },
    setHistoryKey: value => { state.key = value; },
    loadAccountFactsHistory, loadBinanceWalletHistory,
    useEffect(effect, next) {
      if (dependencies && next.length === dependencies.length && next.every((value, index) => Object.is(value, dependencies[index]))) return;
      cancel?.();
      dependencies = Array.from(next);
      cancel = effect();
    },
  });
  return {
    state,
    render(patch = {}) { assert.equal(mounted, true); Object.assign(context, patch); runInContext(historyHook, context, { timeout: 1000 }); },
    unmount() { mounted = false; cancel?.(); },
  };
}
function respond(index, payload, status = 200) {
  pending[index].resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
}
try {
  const failed = historyHarness();
  failed.render();
  const first = pending.length - 1;
  respond(first, { ok: false, error: "synthetic-history-unavailable" }, 503);
  await flush();
  assert.equal(failed.state.error, "http_503");
  assert.equal(failed.state.loading, false);
  failed.render({ readModelRefreshVersion: 1 });
  assert.equal(pending.length, first + 2, "a visible refresh retries history after 503 even when the facts timestamp is unchanged");
  failed.render({ readModelRefreshVersion: 1 });
  assert.equal(pending.length, first + 2, "same refresh render does not duplicate its in-flight GET");
  respond(first + 1, { marker: "recovered-history" });
  await flush();
  assert.equal(failed.state.history.marker, "recovered-history");
  assert.equal(failed.state.error, null);
  assert.equal(failed.state.loading, false);
  failed.unmount();

  const switched = historyHarness();
  switched.render();
  const oldAccount = pending.length - 1;
  switched.render({ chartAccount: { id: "synthetic-b", platformKey: "longbridge", accountKey: "synthetic-b" } });
  const newAccount = pending.length - 1;
  respond(newAccount, { marker: "new-account" });
  await flush();
  respond(oldAccount, { marker: "old-account" });
  await flush();
  assert.equal(switched.state.history.marker, "new-account", "a late previous-account response cannot replace the current history");
  switched.render({ currency: "EUR" });
  assert.match(pending.at(-1).path, /account_key=synthetic-b&currency=EUR$/);
  const beforeUnmount = structuredClone(switched.state);
  switched.unmount();
  respond(pending.length - 1, { marker: "after-unmount" });
  await flush();
  assert.deepEqual(switched.state, beforeUnmount, "unmount cancels late history state updates");

  const wallet = historyHarness("synthetic-wallet", true);
  wallet.render();
  const oldWallet = pending.length - 1;
  respond(oldWallet, { ok: false }, 503);
  await flush();
  wallet.render({ readModelRefreshVersion: 1 });
  assert.equal(pending.length, oldWallet + 2, "same-timestamp refresh also retries wallet history");
  respond(oldWallet + 1, { marker: "recovered-wallet" });
  await flush();
  assert.equal(wallet.state.walletHistory.marker, "recovered-wallet");
  wallet.render({ readModelRefreshVersion: 2 });
  const cancelledWallet = pending.length - 1;
  wallet.render({ chart: "return" });
  const requestsBeforeCancel = pending.length;
  wallet.render({ readModelRefreshVersion: 3 });
  assert.equal(pending.length, requestsBeforeCancel, "return mode must not request asset history");
  respond(cancelledWallet, { marker: "late-wallet-after-mode-change" });
  await flush();
  assert.equal(wallet.state.walletHistory, null);
  assert.equal(wallet.state.error, null, "a cancelled history request cannot set an error in return mode");
  wallet.unmount();
} finally {
  globalThis.fetch = originalFetch;
}

console.log("overview refresh validation: PASS");

// Execute both actual daily hooks against deferred synthetic reads. Keys include
// platform even when account names match; no broker/network service is contacted.
const runtimeHookStart = overview.lastIndexOf("  useEffect(() => {", overview.indexOf("const epoch = ++runtimeEpoch.current"));
const runtimeHookEnd = overview.indexOf("  const dailyAccountsKey", runtimeHookStart);
const runtimeHook = overview.slice(runtimeHookStart, runtimeHookEnd).trim();
const currentHookStart = overview.indexOf("  useEffect(() => {", runtimeHookEnd);
const currentHookEnd = overview.indexOf("  useEffect(() => {", currentHookStart + 1);
const currentHook = overview.slice(currentHookStart, currentHookEnd).trim();
const syntheticAccounts = ["longbridge", "schwab"].map(platform => ({ id: `${platform}:synthetic-same`, platformKey: platform, accountKey: "synthetic-same", runtimeDailyBinding: "bound" }));
const syntheticTargets = {
  longbridge: "longbridge-quant-paper-service|russell_top50_leader_rotation|paper",
  schwab: "charles-schwab-quant-service|soxl_soxx_trend_income|live",
};
const dailyPending = [];
globalThis.fetch = (path, options) => {
  assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store");
  assert.match(path, /^\/api\/runtime-daily\?date=2026-10-0[567]&platform=(longbridge|schwab)&account_key=synthetic-same$/);
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
function dailyHarness(today = false) {
  let state = {}; let dependencies; let cancel; let mounted = true;
  const update = value => { state = typeof value === "function" ? value(state) : value; };
  const context = createContext({
    Error, Object, JSON, runtimeEpoch: { current: 0 },
    runtimeDate: "2026-10-06", runtimeToday: "2026-10-06", runtimeNow: Date.parse("2026-10-06T21:00:00Z"),
    accountId: "all", visible: syntheticAccounts, accounts: syntheticAccounts, readModelRefreshVersion: 0,
    dailyAccountsKey: "synthetic-two-bound-targets", setRuntimeDaily: update, setCurrentDaily: update,
    runtimeDailyAccountDateKey, runtimeDailySelectionEligible, runtimeDailySnapshotMatchesSelection, runtimeDateSelectable, loadRuntimeDaily,
    useEffect(effect, next) {
      if (dependencies && next.length === dependencies.length && next.every((value, index) => Object.is(value, dependencies[index]))) return;
      cancel?.(); dependencies = Array.from(next); cancel = effect();
    },
  });
  return {
    get state() { return state; },
    get selectedDate() { return context.runtimeDate; },
    render(patch = {}) { assert.equal(mounted, true); Object.assign(context, patch); runInContext(today ? currentHook : runtimeHook, context, { timeout: 1000 }); },
    unmount() { mounted = false; cancel?.(); },
  };
}
const lbKey = runtimeDailyAccountDateKey("longbridge", "synthetic-same", "2026-10-06");
const schwabKey = runtimeDailyAccountDateKey("schwab", "synthetic-same", "2026-10-06");
try {
  const daily = dailyHarness(); daily.render();
  assert.equal(dailyPending.length, 2, "all-account view reads both bound targets independently");
  assert.notEqual(lbKey, schwabKey);
  dailyRespond(0, "paper-success"); dailyRespond(1, "schwab-error", 503); await flush();
  assert.equal(daily.state[lbKey].value.marker, "paper-success");
  assert.equal(daily.state[schwabKey].value, null); assert.ok(daily.state[schwabKey].error);
  daily.render({ accountId: syntheticAccounts[1].id, visible: [syntheticAccounts[1]] });
  const oldSchwab = dailyPending.length - 1;
  daily.render({ accountId: "all", visible: syntheticAccounts });
  const currentLb = dailyPending.length - 2; const currentSchwab = dailyPending.length - 1;
  dailyRespond(currentSchwab, "schwab-success"); await flush();
  dailyPending[oldSchwab].reject(new Error("late old account failure")); dailyRespond(currentLb, "paper-error", 503); await flush();
  assert.equal(daily.state[schwabKey].value.marker, "schwab-success", "late failure from the old selection cannot replace the new account result");
  assert.equal(daily.state[schwabKey].error, null); assert.ok(daily.state[lbKey].error);
  daily.render({ runtimeDate: "2026-10-05" });
  const oldDayLb = dailyPending.length - 2;
  daily.render({ runtimeDate: "2026-10-06" });
  const newDayLb = dailyPending.length - 2; const newDaySchwab = dailyPending.length - 1;
  dailyRespond(newDayLb, "new-day-paper"); dailyRespond(newDaySchwab, "new-day-schwab"); dailyRespond(oldDayLb, "late-old-day"); await flush();
  assert.equal(daily.state[lbKey].value.marker, "new-day-paper");
  daily.render({ readModelRefreshVersion: 1 });
  const wrongIdentity = dailyPending.length - 1;
  dailyRespond(wrongIdentity, "wrong-platform", 200, { platform: "longbridge" }); await flush();
  assert.equal(daily.state[schwabKey].value, null); assert.equal(daily.state[schwabKey].error, "runtime_daily_selection_mismatch");
  daily.render({ readModelRefreshVersion: 2 }); const afterUnmount = dailyPending.length - 1;
  daily.unmount(); const stopped = JSON.stringify(daily.state); dailyRespond(afterUnmount, "late-unmount"); await flush();
  assert.equal(JSON.stringify(daily.state), stopped);

  const current = dailyHarness(true); const firstCurrent = dailyPending.length;
  current.render({ runtimeDate: "2026-10-05", visible: [syntheticAccounts[1]], accountId: syntheticAccounts[1].id });
  assert.equal(dailyPending.length - firstCurrent, 2, "today health reads both accounts while the selected card shows history");
  assert.ok(dailyPending.slice(firstCurrent).every(item => item.path.includes("date=2026-10-06")));
  current.render({ readModelRefreshVersion: 1 }); const freshCurrent = dailyPending.length - 2;
  dailyRespond(freshCurrent, "today-paper"); dailyRespond(freshCurrent + 1, "today-schwab");
  dailyRespond(firstCurrent, "old-today-paper", 503); dailyRespond(firstCurrent + 1, "old-today-schwab"); await flush();
  assert.equal(current.state[lbKey].value.marker, "today-paper"); assert.equal(current.state[schwabKey].value.marker, "today-schwab");
  const beforeUnresolved = dailyPending.length;
  current.render({ dailyAccountsKey: "schwab-unresolved", accounts: [syntheticAccounts[0], { ...syntheticAccounts[1], runtimeDailyBinding: "unresolved" }] });
  assert.equal(dailyPending.length, beforeUnresolved + 1, "unresolved Schwab binding cannot start a daily fetch");
  assert.equal(current.state[schwabKey], undefined); current.unmount();
  const pinned = dailyHarness(); const opening = dailyPending.length;
  pinned.render({ runtimeDate: "2026-10-05", readModelRefreshVersion: 4 });
  assert.equal(dailyPending.length, opening + 2);
  pinned.render({ runtimeToday: "2026-10-07", runtimeNow: Date.parse("2026-10-07T04:01:00Z") });
  assert.equal(pinned.selectedDate, "2026-10-05", "crossing New York midnight keeps the chosen historical date");
  assert.equal(dailyPending.length, opening + 2, "local midnight creates no historical-data GET");
  pinned.render({ readModelRefreshVersion: 5 });
  assert.equal(dailyPending.length, opening + 4, "explicit readback may refresh the selected historical data");
  pinned.unmount();

  const atMidnight = dailyHarness(true); const atOpening = dailyPending.length;
  atMidnight.render();
  assert.equal(dailyPending.length, atOpening + 2);
  atMidnight.render({ runtimeToday: "2026-10-07", runtimeNow: Date.parse("2026-10-07T04:01:00Z") });
  assert.equal(atMidnight.selectedDate, "2026-10-06", "the selected date remains the opened date across midnight");
  assert.equal(dailyPending.length, atOpening + 2, "today-health clock changes do not fetch a new day");
  assert.equal(atMidnight.state[runtimeDailyAccountDateKey("longbridge", "synthetic-same", "2026-10-07")], undefined, "yesterday's record is not current-day evidence");
  atMidnight.render({ readModelRefreshVersion: 1 });
  assert.equal(dailyPending.length, atOpening + 4);
  assert.ok(dailyPending.slice(atOpening + 2).every(item => item.path.includes("date=2026-10-07")), "explicit readback loads the actual current day");
  atMidnight.unmount();
  console.log("daily hook races: PASS (platform/account/date isolation, all accounts, history versus today, refresh, mismatch, late success/failure and unmount)");
} finally {
  globalThis.fetch = originalFetch;
}

await import("./console_load_lifecycle_validation.mjs");
