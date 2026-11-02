import assert from "node:assert/strict";
import { runtimeHistoryDates, runtimeHistoryKey, runtimeHistoryCell } from "../web/strategy-switch-console/frontend/src/runtimeHistory.ts";
import { RUNTIME_DAILY_TARGETS } from "../web/strategy-switch-console/runtime_daily_contract.js";

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
