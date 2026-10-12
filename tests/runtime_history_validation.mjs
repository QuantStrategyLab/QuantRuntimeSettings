import assert from "node:assert/strict";
import { runtimeHistoryDates, runtimeHistoryKey, runtimeHistoryCell } from "../web/strategy-switch-console/frontend/src/runtimeHistory.ts";
import { RUNTIME_DAILY_TARGETS } from "../web/strategy-switch-console/runtime_daily_contract.js";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { createContext, runInContext } from "node:vm";
import { loadRuntimeDaily } from "../web/strategy-switch-console/frontend/src/api.ts";
import { runtimeDailySelectionEligible, runtimeDailySnapshotMatchesSelection } from "../web/strategy-switch-console/frontend/src/presentation.ts";

const now = Date.parse("2026-10-13T17:00:00Z");
const target = RUNTIME_DAILY_TARGETS.schwab;
const selection = { platform: "schwab", accountKey: "synthetic-history", dailyBinding: "bound", target };
const date = "2026-10-12";
const snapshot = { ok: true, platform: target.platform, target_key: target.target_key, account_key: selection.accountKey, timezone: "America/New_York", date,
  data_status: "historical", read_error_count: 0, unmatched_count: 0,
  record: { ...target, status: "no_submission", kind: "execution", execution_lane: "live", business_date: date, observed_at: "2026-10-12T20:00:00Z", completeness: "complete", conflict_count: 0,
    runs: [{ run_id: "synthetic-run", started_at: null, finished_at: null, activity: "no_submission", execution_lane: "live", errors_present: false }] }, fills: null };
const cell = value => runtimeHistoryCell(value, selection, date, now);
assert.equal(cell(snapshot).tone, "ok");
assert.equal(cell(snapshot).label, "无交易", "a complete cycle with no order remains no trading, never a fill");
for (const patch of [null, { ...snapshot, record: null }, { ...snapshot, account_key: "other" }, { ...snapshot, target_key: "other" }, { ...snapshot, date: "2026-10-11" }, { ...snapshot, timezone: "UTC" }, { ...snapshot, data_status: "stale" }, { ...snapshot, data_status: "unavailable" }, { ...snapshot, record: { ...snapshot.record, business_date: "2026-10-11" } }, { ...snapshot, record: { ...snapshot.record, observed_at: "2026-10-14T20:00:00Z" } }]) assert.equal(cell(patch).tone, "unknown");
assert.equal(runtimeHistoryCell(snapshot, { ...selection, dailyBinding: "unresolved" }, date, now).tone, "unknown");
assert.equal(runtimeHistoryCell(snapshot, { ...selection, target: { ...target, strategy_profile: "other", target_key: "other" } }, date, now).tone, "unknown");
for (const patch of [{ ...snapshot, read_error_count: 1 }, { ...snapshot, unmatched_count: 1 }, { ...snapshot, record: { ...snapshot.record, completeness: "partial" } }, { ...snapshot, record: { ...snapshot.record, conflict_count: 1 } }, { ...snapshot, record: { ...snapshot.record, status: "partially_filled" } }]) assert.equal(cell(patch).tone, "partial");
assert.equal(cell({ ...snapshot, record: { ...snapshot.record, runs: [{ ...snapshot.record.runs[0], errors_present: true }] } }).tone, "error", "run failure cannot be masked by no_submission summary");
assert.equal(cell({ ...snapshot, record: { ...snapshot.record, runs: [{ ...snapshot.record.runs[0], issue: "unconfirmed" }] } }).tone, "partial");
assert.equal(cell({ ...snapshot, record: { ...snapshot.record, runs: [] } }).tone, "partial", "a complete summary without any run cannot become a verified cycle");
assert.ok(cell({ ...snapshot, record: { ...snapshot.record, execution_lane: "dry_run" } }).details.includes("只读演练"), "dry-run evidence stays explicitly distinguished");
for (const status of ["not_due", "market_closed", "missing_report", "unknown", "new_unreviewed_status"]) assert.equal(cell({ ...snapshot, record: { ...snapshot.record, status } }).tone, "unknown");
assert.deepEqual(runtimeHistoryDates("bad"), []);
assert.deepEqual(runtimeHistoryDates("2026-02-30"), []);
const dates = runtimeHistoryDates("2026-03-09");
assert.equal(dates.length, 14); assert.equal(dates[0], "2026-02-24"); assert.equal(dates.at(-1), "2026-03-09");
assert.equal(new Set(dates).size, 14, "New York DST crossing still uses unique calendar dates");
assert.ok(runtimeHistoryDates("2024-03-01").includes("2024-02-29"));
assert.notEqual(runtimeHistoryKey(selection, date), runtimeHistoryKey({ ...selection, target: { ...target, target_key: "other" } }, date));
assert.notEqual(runtimeHistoryKey(selection, date), runtimeHistoryKey({ ...selection, accountKey: "other" }, date));
console.log("runtime history validation: PASS (synthetic calendar, target/date identity, stale/missing evidence, complete/partial/failure and no-trading semantics)");

// Execute the actual new historical hook: assert request bounds and cancellation
// through real GET/no-store API code. This is lifecycle evidence, not browser QA.
const source = readFileSync(new URL("../web/strategy-switch-console/frontend/src/RuntimeHistoryPanel.tsx", import.meta.url), "utf8");
const start = source.indexOf("  useEffect(() => {");
const hook = stripTypeScriptTypes(source.slice(start, source.indexOf("  return <section", start)));
const originalFetch = globalThis.fetch;
const pending = [];
globalThis.fetch = (url, options) => {
  assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store"); assert.equal(options.credentials, "same-origin");
  assert.ok(String(url).startsWith("/api/runtime-daily?"), "the new panel only reads the existing local daily API");
  return new Promise(resolve => pending.push({ url: new URL(url, "https://synthetic.invalid"), resolve }));
};
const flush = () => new Promise(resolve => setImmediate(resolve));
let cancel, dependencies, history = {};
const context = createContext({ JSON, Promise, Math, runtimeHistoryDates, runtimeHistoryKey, runtimeDailySelectionEligible, runtimeDailySnapshotMatchesSelection, loadRuntimeDaily,
  selectionKey: JSON.stringify([selection, selection, { ...selection, accountKey: "unbound", dailyBinding: "unresolved" }]), today: "2026-10-13", refreshVersion: 0,
  setHistory(next) { history = typeof next === "function" ? next(history) : next; },
  useEffect(effect, next) { if (dependencies && next.every((value, index) => Object.is(value, dependencies[index]))) return; cancel?.(); dependencies = Array.from(next); cancel = effect(); },
});
function respond(index, selected = selection, mismatch = false) {
  const date = pending[index].url.searchParams.get("date");
  const value = { ...snapshot, date, platform: selected.platform, target_key: selected.target.target_key, account_key: mismatch ? "wrong-account" : selected.accountKey,
    record: { ...snapshot.record, ...selected.target, business_date: date, observed_at: `${date}T20:00:00Z` } };
  pending[index].resolve(new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }));
}
try {
  runInContext(hook, context); assert.equal(pending.length, 4, "four prior-day reads in flight, deduplicated across duplicate rows");
  assert.ok(pending.every(item => item.url.searchParams.get("date") !== context.today), "today is left to the shared existing overview read");
  respond(0); await flush(); assert.equal(pending.length, 5, "completion releases one queued historical read");
  cancel(); for (let index = 1; index < 5; index++) respond(index); await flush();
  assert.equal(pending.length, 5, "unmount stops queued reads"); assert.equal(Object.keys(history).length, 1, "unmounted responses do not update state");
  const changed = { ...selection, accountKey: "synthetic-changed", target: { ...target, service: "synthetic-other", target_key: "synthetic-other|soxl_soxx_trend_income|live" } };
  context.selectionKey = JSON.stringify([changed]); runInContext(hook, context); assert.equal(pending.length, 9); assert.equal(Object.keys(history).length, 0);
  respond(5, changed, true); await flush();
  assert.equal(Object.values(history)[0].value, null); assert.equal(Object.values(history)[0].error, true, "identity mismatch produces a grey error entry");
  const beforeRefresh = pending.length;
  context.refreshVersion++; runInContext(hook, context); assert.equal(pending.length, beforeRefresh + 4);
  respond(6, changed); await flush(); assert.equal(Object.keys(history).length, 0, "a previous refresh's delayed response is discarded");
  const beforeDay = pending.length;
  context.today = "2026-10-14"; runInContext(hook, context); assert.equal(pending.length, beforeDay + 4, "business-date rollover starts the next historical window");
  assert.equal(pending[beforeDay].url.searchParams.get("date"), "2026-10-01");
  const beforeUnbound = pending.length;
  context.selectionKey = JSON.stringify([{ ...selection, dailyBinding: "unresolved" }]); runInContext(hook, context); assert.equal(pending.length, beforeUnbound, "unbound targets never trigger historical reads");
  assert.equal(Object.keys(history).length, 0);
  console.log("runtime history hook: PASS (GET/no-store, dedupe, bounded concurrency, reused today, cancelled/late responses, refresh, midnight and identity failure)");
} finally { cancel?.(); globalThis.fetch = originalFetch; }
