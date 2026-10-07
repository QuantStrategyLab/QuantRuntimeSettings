import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { loadAccountFactsHistory, loadBinanceWalletHistory, loadReadModel, loadRuntimeDaily } from "../web/strategy-switch-console/frontend/src/api.ts";
import { overviewRuntimeStatusLabel, runtimeDailySelectionEligible, runtimeDailySnapshotMatchesSelection, runtimeDateSelectable } from "../web/strategy-switch-console/frontend/src/presentation.ts";

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
const historyEffect = overview.slice(overview.indexOf("const epoch = ++historyEpoch.current"), overview.indexOf("const todayAccounts ="));
assert.match(historyEffect, /chartAccount\?\.id[\s\S]*chartFacts\?\.observed_finished_at/);
assert.doesNotMatch(historyEffect, /selectedFacts\?\.observed_finished_at/);
const runtimeEffect = overview.slice(overview.lastIndexOf("  useEffect(() => {", overview.indexOf("const todayAccounts =")), overview.indexOf("  useEffect(() => {", overview.indexOf("const todayAccounts =")));
assert.match(runtimeEffect, /runtimeDateSelectable\(runtimeDate, runtimeNow\)/);
assert.match(runtimeEffect, /visible\.filter\(account => runtimeDailySelectionEligible/);
assert.doesNotMatch(runtimeEffect.slice(runtimeEffect.indexOf("}, [")), /runtimeToday/, "crossing midnight alone does not trigger a GET");
assert.doesNotMatch(overview, /previousToday|setRuntimeDate\(date =>/, "the clock never rewrites the selected day");
assert.match(runtimeEffect, /if \(!active\) return/);
assert.match(runtimeEffect, /return \(\) => \{ active = false; \}/);
assert.match(runtimeEffect, /readModelRefreshVersion/);

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
    runtimeDailySelectionEligible, runtimeDailySnapshotMatchesSelection, runtimeDateSelectable, loadRuntimeDaily,
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
  assert.equal(dailyPending.length - opening, 4, "the clock alone does not reload historical or current data");
  pinned.render({ readModelRefreshVersion: 1 });
  assert.equal(dailyPending.length - opening, 8, "explicit readback loads selected history and the actual current day");
  pinned.unmount();
  const future = dailyHarness(); const futureStart = dailyPending.length;
  future.render({ runtimeDate: "2026-10-07" });
  assert.equal(dailyPending.length - futureStart, 2, "a future selected date is not requested");
  future.render({ runtimeToday: "2026-10-07", runtimeNow: Date.parse("2026-10-07T04:01:00Z") });
  assert.equal(dailyPending.length - futureStart, 2, "a clock tick making a date selectable must not trigger reads");
  future.render({ readModelRefreshVersion: 1 });
  assert.equal(dailyPending.length - futureStart, 4, "explicit refresh loads the newly current day once per account");
  future.unmount();
  console.log("daily hook races: PASS (dedupe, shared today result, history/current separation, selection and date races, binding, refresh, identity match and midnight)");
} finally {
  globalThis.fetch = originalFetch;
}

await import("./console_load_lifecycle_validation.mjs");
