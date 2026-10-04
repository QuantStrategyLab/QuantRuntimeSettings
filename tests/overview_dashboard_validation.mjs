import assert from "node:assert/strict";
import { overviewRuntimeHealth, presentRuntimeDaily, runtimeDateBounds, runtimeDateSelectable, RETURN_INDEX_LEGEND } from "../web/strategy-switch-console/frontend/src/presentation.ts";
import { translate } from "../web/strategy-switch-console/frontend/src/locales.ts";

const now = Date.parse("2026-10-04T16:00:00Z");
const instant = offset => new Date(now + offset * 1000).toISOString();
const selection = { platform: "longbridge", accountKey: "synthetic-paper" };
const runtime = {
  observed_at: instant(-60), evidence_valid_for_seconds: 300,
  freshness: { data_status: "ready" }, deployment_freshness: { data_status: "ready" },
  account_state: { scope: "monitoring_only", limit: "not_trading_or_books", activation: "enabled", health: "normal" },
  target: { deployment: { observed_at: instant(-60), runtime_enabled: true, scheduler_state: "enabled" } },
};
const daily = {
  ok: true, account_key: selection.accountKey, date: "2026-10-04", timezone: "America/New_York", data_status: "fresh",
  record: {
    business_date: "2026-10-04", observed_at: instant(-30), kind: "run", completeness: "complete", status: "no_submission", execution_lane: "paper",
    schedule: { state: "due", latest_due_at: instant(-120), next_due_at: instant(3600), publication_grace_ended: true },
    runs: [{ started_at: instant(-90), finished_at: instant(-60), activity: "no_submission", execution_lane: "paper" }],
  }, fills: { source: "not_connected", records: [], count: null }, read_error_count: 0, unmatched_count: 0,
};
const clone = value => structuredClone(value);
const health = (r = runtime, d = daily, s = selection, mismatch = false, time = now) => overviewRuntimeHealth(r, d, s, mismatch, time);
const mixedZones = clone(daily);
mixedZones.record.schedule.latest_due_at = "2026-10-04T15:20:00Z";
mixedZones.record.runs = [
  { started_at: "2026-10-04T14:59:00Z", finished_at: "2026-10-04T15:00:00Z", activity: "no_submission", execution_lane: "paper" },
  { started_at: "2026-10-04T11:29:00-04:00", finished_at: "2026-10-04T11:30:00-04:00", activity: "no_submission", execution_lane: "paper" },
];
assert.equal(health(runtime, mixedZones).label, "健康", "valid timezone offsets are ordered by instant, not text");
assert.equal(health(runtime, mixedZones).lastSuccessAt, "2026-10-04T11:30:00-04:00");
const noSchedule = clone(daily);
noSchedule.record.schedule = { state: "unevaluable", latest_due_at: null, next_due_at: null, grace_ends_at: null, publication_grace_ended: null };
assert.equal(health(runtime, noSchedule).label, "异常", "a complete run cannot fill an unknown scheduling evidence gap");
delete noSchedule.record.schedule;
assert.equal(health(runtime, noSchedule).label, "异常", "missing schedule cannot prove current cycle health");
assert.equal(health().label, "健康");
assert.equal(health().lastSuccessAt, instant(-60));
for (const [name, mutate] of [
  ["missing source timestamp", r => delete r.observed_at],
  ["missing source validity", r => delete r.evidence_valid_for_seconds],
  ["expired source", r => r.observed_at = instant(-301)],
  ["future source", r => r.observed_at = instant(1)],
  ["stale source", r => r.freshness.data_status = "stale"],
  ["disabled", r => r.account_state.activation = "disabled"],
  ["unknown activation", r => r.account_state.activation = "unknown"],
  ["runtime failure", r => r.account_state.health = "abnormal"],
  ["monitoring unknown", r => r.account_state.health = "unknown"],
  ["missing deployment timestamp", r => delete r.target.deployment.observed_at],
  ["expired deployment", r => r.target.deployment.observed_at = instant(-301)],
  ["future deployment", r => r.target.deployment.observed_at = instant(1)],
  ["scheduler paused", r => r.target.deployment.scheduler_state = "paused"],
]) {
  const r = clone(runtime); mutate(r); assert.equal(health(r).label, "异常", name);
}
assert.equal(health(null).label, "异常");
assert.equal(health(runtime, null).label, "异常", "monitoring green alone cannot prove a cycle");
assert.equal(health(runtime, daily, selection, true).detail, "账户身份不匹配");
for (const [name, mutate] of [
  ["wrong account", d => d.account_key = "other"],
  ["wrong date", d => d.date = "2026-10-03"],
  ["wrong business date", d => d.record.business_date = "2026-10-03"],
  ["wrong timezone", d => d.timezone = "UTC"],
  ["stale daily", d => d.data_status = "stale"],
  ["future daily", d => d.record.observed_at = instant(1)],
  ["incomplete", d => d.record.completeness = "incomplete"],
  ["read failure", d => d.read_error_count = 1],
  ["unmatched record", d => d.unmatched_count = 1],
  ["conflict", d => d.record.conflict_count = 1],
  ["missing run end", d => d.record.runs[0].finished_at = null],
  ["future run end", d => d.record.runs[0].finished_at = instant(1)],
  ["run reversed", d => d.record.runs[0].started_at = instant(-10)],
  ["due report not completed", d => d.record.schedule.latest_due_at = instant(-10)],
  ["future latest due", d => d.record.schedule.latest_due_at = instant(1)],
  ["due without verified grace", d => { d.record.schedule.latest_due_at = instant(-10); delete d.record.schedule.publication_grace_ended; }],
  ["next cycle overdue", d => d.record.schedule.next_due_at = instant(-10)],
  ["dry-run lane", d => d.record.execution_lane = "dry_run"],
  ["mixed run lane", d => d.record.runs[0].execution_lane = "dry_run"],
]) {
  const d = clone(daily); mutate(d); assert.equal(health(runtime, d).label, "异常", name);
}
for (const status of ["failed", "blocked", "unknown", "submitted", "broker_acknowledged", "partially_filled", "dry_run", "shadow", "validation", "missing_report"]) {
  const d = clone(daily); d.record.status = status; assert.equal(health(runtime, d).label, "异常", status);
}
assert.equal(health(runtime, daily, { platform: "binance", accountKey: selection.accountKey }).label, "异常");
for (const status of ["not_due", "market_closed", "outside_window"]) {
  const d = clone(daily);
  d.record = { ...d.record, kind: "schedule", status, runs: [], schedule: { state: status, next_due_at: instant(60) } };
  assert.equal(health(runtime, d).label, "健康", status);
  const waitingRuntime = clone(runtime); waitingRuntime.account_state.health = "unknown"; waitingRuntime.account_state.reason = "check_not_due";
  waitingRuntime.target.monitoring = { runtime_guard: "pass", execution_heartbeat: "not_due" };
  assert.equal(health(waitingRuntime, d).label, "健康", "verified not-due evidence does not require a monitoring success");
  waitingRuntime.target.monitoring.runtime_guard = "unknown";
  assert.equal(health(waitingRuntime, d).label, "异常", "not-due heartbeat cannot hide an unknown guard");
  assert.equal(health(runtime, d, selection, false, now + 60_000).label, "异常", `${status} due boundary`);
  d.record.schedule.next_due_at = null;
  assert.equal(health(runtime, d).label, "异常", `${status} unknown due time`);
}
const grace = clone(daily);
grace.record = { ...grace.record, kind: "schedule", status: "within_grace", runs: [], schedule: { state: "within_grace", grace_ends_at: instant(60), publication_grace_ended: false } };
assert.equal(health(runtime, grace).label, "健康");
assert.equal(health(runtime, grace, selection, false, now + 60_000).label, "异常");
grace.record.schedule.publication_grace_ended = true;
assert.equal(health(runtime, grace).label, "异常");
const overdue = clone(daily);
overdue.record.schedule.latest_due_at = instant(-10);
assert.equal(health(runtime, overdue).lastSuccessAt, instant(-60), "overdue evidence retains the last completed cycle time");
overdue.record.schedule.grace_ends_at = instant(60);
overdue.record.schedule.publication_grace_ended = false;
assert.equal(health(runtime, overdue).detail, "已启用，仍在允许延迟内");
assert.deepEqual(runtimeDateBounds(now), { min: "2026-07-07", max: "2026-10-04" });
for (const date of ["2026-07-07", "2026-10-04"]) assert.equal(runtimeDateSelectable(date, now), true);
for (const date of ["2026-07-06", "2026-10-05", "2026-02-30", "2026-09-31", "", "2026-1-1"]) assert.equal(runtimeDateSelectable(date, now), false, date);
const boundary = Date.parse("2026-10-05T04:00:00Z");
assert.equal(runtimeDateBounds(boundary - 1).max, "2026-10-04");
assert.equal(runtimeDateBounds(boundary).max, "2026-10-05");
assert.equal(runtimeDateSelectable("2026-02-29", Date.parse("2026-03-01T16:00:00Z")), false);
assert.equal(runtimeDateSelectable("2024-02-29", Date.parse("2024-03-01T16:00:00Z")), true);
assert.equal(presentRuntimeDaily({ ...daily, record: null, data_status: "unavailable" }, selection, daily.date).statusLabel, "无记录");
assert.equal(presentRuntimeDaily(daily, selection, "2026-10-03").available, false, "late responses cannot appear under a different selected date");
assert.equal(presentRuntimeDaily(daily, { platform: "ibkr", accountKey: selection.accountKey }, daily.date).statusLabel, "无记录");
assert.deepEqual(RETURN_INDEX_LEGEND, ["标普500", "纳斯达克", "道琼斯", "罗素"]);
for (const detail of [health().detail, health(null).detail, health(runtime, null).detail, health(runtime, grace).detail]) assert.notEqual(translate(detail, "en"), detail);
console.log("overview dashboard validation: PASS (date, identity, freshness, due/grace and cycle evidence)");
