import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadOverviewReadModels, mergeOverviewReadModels } from "../web/strategy-switch-console/frontend/src/api.ts";
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
const requestedPaths = [];
globalThis.fetch = async (path, options) => {
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
  globalThis.fetch = originalFetch;
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
assert.match(runtimeEffect, /const selection = selectedAccount[\s\S]*\}, \[selectedAccount\?\.id, selectedAccount\?\.platformKey, selectedAccount\?\.accountKey, runtimeDate, runtimeDate === runtimeToday \? readModelRefreshVersion : 0\]\);/);

console.log("overview refresh validation: PASS");
