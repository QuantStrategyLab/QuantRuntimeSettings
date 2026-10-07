import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { overviewRuntimeHealth, presentRuntimeDaily, runtimeDateBounds, runtimeDateSelectable, RETURN_INDEX_LEGEND } from "../web/strategy-switch-console/frontend/src/presentation.ts";
import { translate } from "../web/strategy-switch-console/frontend/src/locales.ts";
import { RUNTIME_DAILY_TARGET, runtimeDailyTarget } from "../web/strategy-switch-console/runtime_daily_contract.js";
import "./overview_current_aggregation_validation.mjs";

const overviewSource = readFileSync(new URL("../web/strategy-switch-console/frontend/src/OverviewPage.tsx", import.meta.url), "utf8");
assert.equal((overviewSource.match(/amountOrDash\(totalCash\)/g) || []).length, 1,
  "the selected-account cash metric renders its amount exactly once");
assert.match(overviewSource, /currentFactsSummary\.excludingPaper\.assets/);
assert.match(overviewSource, /currentFactsSummary\.excludingPaper\.cashBalance/);
assert.match(overviewSource, /currentFactsSummary\.excludingPaper\.availableCash/);

const now = Date.parse("2026-10-04T16:00:00Z");
const instant = offset => new Date(now + offset * 1000).toISOString();
const selection = { platform: "longbridge", accountKey: "synthetic-paper", dailyBinding: "bound" };
const runtime = {
  observed_at: instant(-60), evidence_valid_for_seconds: 300,
  freshness: { data_status: "ready" }, deployment_freshness: { data_status: "ready" },
  account_state: { scope: "monitoring_only", limit: "not_trading_or_books", activation: "enabled", health: "normal" },
  target: {
    target: { configured_state: "enabled" },
    monitoring: { runtime_guard: "pass", execution_heartbeat: "pass" },
    disposition: { code: "continue_enabled_monitoring" },
    deployment: { observed_at: instant(-60), runtime_enabled: true, scheduler_state: "enabled" },
  },
};
const daily = {
  ok: true, account_key: selection.accountKey, date: "2026-10-04", timezone: "America/New_York", data_status: "fresh",
  record: {
    ...RUNTIME_DAILY_TARGET,
    business_date: "2026-10-04", observed_at: instant(-30), kind: "run", completeness: "complete", status: "no_submission", execution_lane: "paper",
    schedule: { state: "due", latest_due_at: instant(-120), next_due_at: instant(3600), publication_grace_ended: true },
    runs: [{ started_at: instant(-90), finished_at: instant(-60), activity: "no_submission", execution_lane: "paper", errors_present: false }],
  }, fills: { source: "not_connected", records: [], count: null }, read_error_count: 0, unmatched_count: 0,
  history: { available_from: "2026-07-10", available_through: "2026-10-04", stored_days: 87, truncated: true },
};
const clone = value => structuredClone(value);
const health = (r = runtime, d = daily, s = selection, mismatch = false, time = now) => overviewRuntimeHealth(r, d, s, mismatch, time);
const mixedZones = clone(daily);
mixedZones.record.schedule.latest_due_at = "2026-10-04T15:20:00Z";
mixedZones.record.runs = [
  { started_at: "2026-10-04T14:59:00Z", finished_at: "2026-10-04T15:00:00Z", activity: "no_submission", execution_lane: "paper", errors_present: false },
  { started_at: "2026-10-04T11:29:00-04:00", finished_at: "2026-10-04T11:30:00-04:00", activity: "no_submission", execution_lane: "paper", errors_present: false },
];
assert.equal(health(runtime, mixedZones).label, "健康", "valid timezone offsets are ordered by instant, not text");
assert.equal(health(runtime, mixedZones).lastSuccessAt, "2026-10-04T11:30:00-04:00");
const binance = { platform: "binance", accountKey: "synthetic-binance", dailyBinding: "not_applicable" };
assert.equal(health(runtime, null, binance).label, "健康", "a fresh platform lifecycle result does not require the LongBridge-only daily feed");
assert.equal(health(runtime, null, binance).detail, "运行监测正常，已启用。");
const platformNotDue = clone(runtime);
platformNotDue.account_state.health = "unknown";
platformNotDue.account_state.reason = "check_not_due";
platformNotDue.target.monitoring.execution_heartbeat = "not_due";
assert.equal(health(platformNotDue, null, binance).label, "健康", "fresh explicit platform check_not_due evidence can wait without turning TTL into a schedule");
assert.equal(health(platformNotDue, null, binance).detail, "尚未到检查时间");
const stalePlatformNotDue = clone(platformNotDue);
stalePlatformNotDue.observed_at = instant(-301);
assert.equal(health(stalePlatformNotDue, null, binance).label, "异常", "a not-due result cannot mask stale monitoring evidence");
const noDueProof = clone(platformNotDue);
noDueProof.target.monitoring.runtime_guard = "unavailable";
assert.equal(health(noDueProof, null, binance).label, "异常", "a not-due heartbeat cannot mask an unavailable runtime guard");
const wrongDueState = clone(platformNotDue);
wrongDueState.target.monitoring.execution_heartbeat = "pass";
assert.equal(health(wrongDueState, null, binance).label, "异常", "check_not_due requires matching source-level heartbeat evidence");
const disabledRuntime = clone(runtime);
disabledRuntime.account_state.activation = "disabled";
disabledRuntime.target.target.configured_state = "disabled";
disabledRuntime.target.deployment.runtime_enabled = false;
disabledRuntime.target.deployment.scheduler_state = "paused";
disabledRuntime.target.monitoring.execution_heartbeat = "not_applicable";
disabledRuntime.target.disposition.code = "continue_disabled_validation";
assert.equal(health(disabledRuntime, null, binance).label, "健康", "a correctly configured, freshly validated disabled account is not a runtime failure");
assert.equal(health(disabledRuntime, null, binance).detail, "运行监测正常，已停用。");
const unverifiedDisabled = clone(disabledRuntime);
unverifiedDisabled.target.disposition.code = "parked";
assert.equal(health(unverifiedDisabled, null, binance).label, "异常", "a disabled target with a parked disposition remains abnormal");
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
assert.equal(health(runtime, null, binance, true).label, "异常", "identity mismatches stay abnormal for non-LongBridge platforms");
const staleBinance = clone(runtime);
staleBinance.observed_at = instant(-301);
assert.equal(health(staleBinance, null, binance).label, "异常", "Binance freshness is checked independently of daily cycle data");
const staleDeploymentReadback = clone(runtime);
staleDeploymentReadback.deployment_freshness.data_status = "stale";
assert.equal(health(staleDeploymentReadback, null, binance).label, "异常", "a current monitoring timestamp cannot mask stale deployment evidence");
const unavailableDeploymentReadback = clone(runtime);
unavailableDeploymentReadback.deployment_freshness.data_status = "unavailable";
assert.equal(health(unavailableDeploymentReadback, null, binance).label, "异常", "a current monitoring timestamp cannot mask unavailable deployment evidence");
const abnormalBinance = clone(runtime);
abnormalBinance.account_state.health = "abnormal";
assert.equal(health(abnormalBinance, null, binance).label, "异常", "platform monitoring failure remains abnormal");
for (const [name, mutate] of [
  ["configured enabled", r => r.target.target.configured_state = "enabled"],
  ["runtime switch enabled", r => r.target.deployment.runtime_enabled = true],
  ["scheduler enabled", r => r.target.deployment.scheduler_state = "enabled"],
  ["heartbeat applicable", r => r.target.monitoring.execution_heartbeat = "pass"],
  ["non-disabled disposition", r => r.target.disposition.code = "continue_enabled_monitoring"],
]) {
  const r = clone(disabledRuntime); mutate(r);
  assert.equal(health(r, null, binance).label, "异常", `disabled state evidence mismatch: ${name}`);
}
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
assert.equal(health(runtime, daily, { platform: "binance", accountKey: selection.accountKey, dailyBinding: "not_applicable" }).label, "健康", "a non-LongBridge status is sourced from its platform lifecycle, not an unrelated daily snapshot");
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
const sundayMarketClosed = clone(daily);
sundayMarketClosed.date = "2026-10-04";
sundayMarketClosed.record = { ...sundayMarketClosed.record, business_date: "2026-10-04", kind: "schedule", status: "market_closed", runs: [], schedule: { state: "market_closed", next_due_at: instant(3600) } };
assert.equal(health(runtime, sundayMarketClosed).label, "健康", "Sunday is healthy only because the upstream LongBridge schedule explicitly reports market_closed with a future next due time");
assert.equal(health(runtime, sundayMarketClosed, selection, false, now + 3600_000).label, "异常", "the upstream market-closed window does not remain healthy after its next due time");
// The null-next-due exception belongs only to explicit, current-day Schwab facts.
const schwabSelection = { platform: "schwab", accountKey: "synthetic-schwab", dailyBinding: "bound" };
for (const [status, reason] of [["not_due", "no_cron_on_business_date"], ["market_closed", "market_closed"]]) {
  const closed = clone(daily);
  Object.assign(closed, { platform: "schwab", target_key: runtimeDailyTarget("schwab").target_key, account_key: schwabSelection.accountKey });
  Object.assign(closed.record, runtimeDailyTarget("schwab"), { status, kind: "schedule", runs: [], execution_lane: "insufficient" });
  closed.record.schedule = { state: status, reason, business_date: closed.date, timezone: "America/New_York",
    latest_due_at: status === "market_closed" ? instant(-120) : null, next_due_at: null,
    grace_ends_at: null, publication_grace_ended: null, expected_window: "unspecified" };
  assert.equal(health(runtime, closed, schwabSelection).label, "健康", reason);
  for (const [name, mutate] of [
    ["missing reason", d => delete d.record.schedule.reason],
    ["null reason", d => d.record.schedule.reason = null],
    ["arbitrary reason", d => d.record.schedule.reason = "calendar_guess"],
    ["before_schedule without next", d => d.record.schedule.reason = "before_schedule"],
    ["missing schedule date", d => delete d.record.schedule.business_date],
    ["wrong schedule date", d => d.record.schedule.business_date = "2026-10-03"],
    ["missing schedule timezone", d => delete d.record.schedule.timezone],
    ["wrong schedule timezone", d => d.record.schedule.timezone = "UTC"],
    ["previous NY observation", d => d.record.observed_at = "2026-10-04T03:59:59Z"],
    ["missing explicit next", d => delete d.record.schedule.next_due_at],
    ["malformed next", d => d.record.schedule.next_due_at = "bad-time"],
    ["past next", d => d.record.schedule.next_due_at = instant(-1)],
    ["missing grace", d => delete d.record.schedule.grace_ends_at],
    ["unverified grace", d => delete d.record.schedule.publication_grace_ended],
    ["grace conflict", d => d.record.schedule.publication_grace_ended = false],
    ["future latest", d => d.record.schedule.latest_due_at = instant(1)],
    ["latest after observation", d => d.record.schedule.latest_due_at = instant(-1)],
    ["other-day latest", d => d.record.schedule.latest_due_at = "2026-10-03T20:00:00Z"],
    ["wrong schedule state", d => d.record.schedule.state = "outside_window"],
    ["wrong kind", d => d.record.kind = "run"],
    ["missing platform", d => delete d.platform],
    ["wrong account", d => d.account_key = "other"],
    ["wrong target", d => d.record.strategy_profile = "other"],
    ["dry-run lane", d => d.record.execution_lane = "dry_run"],
  ]) {
    const altered = clone(closed); mutate(altered);
    assert.equal(health(runtime, altered, schwabSelection).label, "异常", `${reason}: ${name}`);
  }
  const legacy = clone(closed);
  Object.assign(legacy, { platform: "longbridge", target_key: RUNTIME_DAILY_TARGET.target_key, account_key: selection.accountKey });
  Object.assign(legacy.record, RUNTIME_DAILY_TARGET);
  assert.equal(health(runtime, legacy).label, "异常", "Schwab-only closed reasons cannot broaden the original LongBridge contract");
  for (const status of ["failed", "blocked", "unknown", "submitted", "broker_acknowledged", "partially_filled"]) {
    const changed = clone(closed); changed.record.status = status;
    assert.equal(health(runtime, changed, schwabSelection).label, "异常", `${reason}: ${status} cannot become healthy`);
  }
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
const historyView = presentRuntimeDaily(daily, selection, daily.date);
assert.equal(historyView.historyFrom, "2026-07-10");
assert.equal(historyView.historyThrough, "2026-10-04");
assert.equal(historyView.historyDays, 87);
assert.equal(historyView.historyTruncated, true);
assert.equal(presentRuntimeDaily({ ...daily, record: null, data_status: "unavailable" }, selection, daily.date).historyDays, 87, "coverage shows even when the selected day has no record");
const noHistoryView = presentRuntimeDaily({ ...daily, history: undefined }, selection, daily.date);
assert.deepEqual([noHistoryView.historyFrom, noHistoryView.historyThrough, noHistoryView.historyDays, noHistoryView.historyTruncated], [null, null, 0, false]);
assert.equal(presentRuntimeDaily(daily, selection, "2026-10-03").available, false, "late responses cannot appear under a different selected date");
assert.equal(presentRuntimeDaily(daily, { platform: "ibkr", accountKey: selection.accountKey, dailyBinding: "not_applicable" }, daily.date).statusLabel, "未接入");
assert.deepEqual(RETURN_INDEX_LEGEND, ["标普500", "纳斯达克100", "道琼斯工业平均指数", "罗素2000"]);
for (const detail of [health().detail, health(null).detail, health(runtime, null).detail, health(runtime, grace).detail]) assert.notEqual(translate(detail, "en"), detail);
console.log("overview dashboard validation: PASS (date, identity, freshness, due/grace and cycle evidence)");
