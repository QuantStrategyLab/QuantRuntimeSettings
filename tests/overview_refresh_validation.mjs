import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { loadAccountFactsHistory, loadBinanceWalletHistory, loadOverviewReadModels, mergeOverviewReadModels } from "../web/strategy-switch-console/frontend/src/api.ts";
import { overviewRuntimeStatusLabel } from "../web/strategy-switch-console/frontend/src/presentation.ts";
import { startVisibleRefreshLoop } from "../web/strategy-switch-console/frontend/src/requestGate.js";

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

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    dispatch(name) { listeners.get(name)?.(); },
  };
}
const documentTarget = Object.assign(eventTarget(), { visibilityState: "visible" });
const windowTarget = eventTarget();
let intervalCallback;
let intervalDelay;
let clearedInterval;
windowTarget.setInterval = (callback, delay) => { intervalCallback = callback; intervalDelay = delay; return 17; };
windowTarget.clearInterval = (id) => { clearedInterval = id; };
let resolveRefresh;
let refreshCalls = 0;
const stop = startVisibleRefreshLoop(() => {
  refreshCalls += 1;
  return new Promise(resolve => { resolveRefresh = resolve; });
}, { documentTarget, windowTarget, intervalMs: 300_000 });
assert.equal(intervalDelay, 300_000);
assert.equal(refreshCalls, 0);
intervalCallback();
await Promise.resolve();
assert.equal(refreshCalls, 1);
intervalCallback();
windowTarget.dispatch("focus");
assert.equal(refreshCalls, 1);
documentTarget.visibilityState = "hidden";
resolveRefresh();
await new Promise(resolve => setImmediate(resolve));
intervalCallback();
windowTarget.dispatch("focus");
assert.equal(refreshCalls, 1);
documentTarget.visibilityState = "visible";
documentTarget.dispatch("visibilitychange");
await Promise.resolve();
await Promise.resolve();
assert.equal(refreshCalls, 2);
stop();
assert.equal(clearedInterval, 17);
assert.equal(documentTarget.listeners.has("visibilitychange"), false);
assert.equal(windowTarget.listeners.has("focus"), false);
resolveRefresh();
await Promise.resolve();
await Promise.resolve();
intervalCallback();
assert.equal(refreshCalls, 2);

const app = readFileSync(new URL("../web/strategy-switch-console/frontend/src/App.tsx", import.meta.url), "utf8");
const refresh = app.slice(app.indexOf("const refreshOverviewReadModels"), app.indexOf("useEffect(() => {\n        if (model?.session.allowed !== true)"));
assert.match(refresh, /loadOverviewReadModels\(\)/);
assert.match(refresh, /if \(fullReadModelRefreshInFlight\.current\)/);
assert.doesNotMatch(refresh, /loadReadModel\(\)|setUxDraft|setUxDirty/);
assert.match(refresh, /setOverviewReadModelRefreshVersion/);
const fullRefresh = app.slice(app.indexOf("const refresh = useCallback"), app.indexOf("const refreshOverviewReadModels"));
assert.match(fullRefresh, /overviewReadModelEpoch\.current\s*\+=\s*1[\s\S]*?fullReadModelRefreshInFlight\.current\s*=\s*true[\s\S]*?loadReadModel\(\)/);
assert.match(fullRefresh, /if \(gate\.current\.isCurrent\(token\)\)\s*\{\s*fullReadModelRefreshInFlight\.current\s*=\s*false/);
const overview = readFileSync(new URL("../web/strategy-switch-console/frontend/src/OverviewPage.tsx", import.meta.url), "utf8");
const historyEffect = overview.slice(overview.indexOf("const epoch = ++historyEpoch.current"), overview.indexOf("const epoch = ++runtimeEpoch.current"));
assert.match(historyEffect, /chartAccount\?\.id[\s\S]*chartFacts\?\.observed_finished_at/);
assert.doesNotMatch(historyEffect, /selectedFacts\?\.observed_finished_at/);
const runtimeEffect = overview.slice(overview.indexOf("const epoch = ++runtimeEpoch.current"), overview.indexOf("// All-account totals"));
assert.match(runtimeEffect, /runtimeDateSelectable\(runtimeDate, runtimeNow\)/);
assert.match(runtimeEffect, /visible\.some\(account => runtimeDailySelectionEligible/);
assert.match(runtimeEffect, /runtimeDate === runtimeToday \? readModelRefreshVersion : 0/);
assert.match(runtimeEffect, /runtimeEpoch\.current !== epoch/);
assert.match(runtimeEffect, /return cancel/);
assert.match(runtimeEffect, /\[hasDailyAccount, dailyAccountId, runtimeToday, readModelRefreshVersion\]/, "today's health refresh follows the exact daily binding independently of the selected historical day");

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
