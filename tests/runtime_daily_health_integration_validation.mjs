import assert from "node:assert/strict";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { overviewRuntimeHealth, presentRuntimeDaily, runtimeBusinessDate, runtimeDailySelectionEligible, runtimeDailySelectionBinding } from "../web/strategy-switch-console/frontend/src/presentation.ts";
import { RUNTIME_DAILY_TARGET } from "../web/strategy-switch-console/runtime_daily_contract.js";

// Exercise production projection -> local Worker POST/KV/GET -> UI with synthetic
// identities only. No browser session, broker call or external request is used.
const realNow = Date.now;
const realFetch = globalThis.fetch;
let now = Date.parse("2026-10-04T16:00:00Z");
Date.now = () => now;
globalThis.fetch = async () => { throw new Error("External request forbidden in runtime health integration"); };
const instant = seconds => new Date(now + seconds * 1000).toISOString();
const paper = { key: "synthetic-paper", label: "Synthetic paper", target_name: "synthetic-paper", service_name: RUNTIME_DAILY_TARGET.service,
  account_scope: "paper", account_selector: "PAPER", deployment_selector: "synthetic-paper", default_strategy_profile: "other_strategy" };
const live = { ...paper, key: "synthetic-live", label: "Synthetic live", target_name: "synthetic-live", service_name: "longbridge-quant-sg-service",
  account_scope: "sg", account_selector: "SYNTHETIC", deployment_selector: "synthetic-live" };
const options = { longbridge: [paper, live] };
const store = new Map();
const env = {
  RUNTIME_DAILY_READ_MODEL_ENABLED: "true", EXECUTION_EVIDENCE_SYNC_TOKEN: "synthetic-daily-sync",
  SESSION_SECRET: "synthetic-session-only", ALLOWED_GITHUB_LOGINS: "synthetic-reader",
  STRATEGY_SWITCH_CONFIG: { async get(key) { return store.get(key) ?? null; }, async put(key, value) { store.set(key, value); } },
};
const saveOptions = value => store.set("account_options", JSON.stringify(value));
const selectionFor = (platform, accountKey, config = options) => ({ platform, accountKey, dailyBinding: runtimeDailySelectionBinding(config, platform, accountKey) });
const paperSelection = selectionFor("longbridge", paper.key);
const liveSelection = selectionFor("longbridge", live.key);
function runtimeFor(platform, heartbeat = "pass") {
  const entry = {
    observed_at: instant(-10), evidence_valid_for_seconds: 300,
    freshness: { data_status: "ready" }, deployment_freshness: { data_status: "ready" },
    target: { target_id: `synthetic-${platform}`, target: { platform, configured_state: "enabled" },
      monitoring: { runtime_guard: "pass", execution_heartbeat: heartbeat }, disposition: { code: "continue_enabled_monitoring" },
      deployment: { observed_at: instant(-10), runtime_enabled: true, scheduler_state: "enabled" } },
  };
  entry.account_state = __test.projectRuntimeAccountState(entry);
  return entry;
}
function projection() {
  const date = runtimeBusinessDate(now);
  return {
    platform: "longbridge", observed_at: instant(-20), completeness: "complete", read_errors: [], unmatched_reports: [],
    records: [{ platform: "longbridge", target_key: RUNTIME_DAILY_TARGET.target_key,
      target: { service: RUNTIME_DAILY_TARGET.service, strategy_profile: RUNTIME_DAILY_TARGET.strategy_profile, account_scope: "paper" },
      business_date: date, timezone: "America/New_York", observed_at: instant(-20), kind: "run", completeness: "complete",
      status: "no_submission", execution_lane: "paper",
      schedule: { state: "due", business_date: date, timezone: "America/New_York", latest_due_at: instant(-120), next_due_at: instant(3600),
        grace_ends_at: null, publication_grace_ended: true, expected_window: "unspecified", reason: null },
      runs: [{ run_id: "synthetic-run", source_object: "gs://synthetic-only/run.json", source_objects: ["gs://synthetic-only/run.json"],
        started_at: instant(-90), finished_at: instant(-60), object_updated_at: instant(-60), report_status: "ok", execution_lane: "paper",
        activity: "no_submission", run_time_known: true,
        evidence: { execution_status: "no_submission", broker_submission_done: false, action_done: false, orders_pending_count: 0,
          errors_present: false, receipt_outcome: "no_action", receipt_broker_confirmation: "not_observed" } }],
      excluded_reports: [], conflicts: [], fills: { source: "not_connected", records: [], count: null } }],
  };
}
const dailyKey = () => `runtime_daily:${RUNTIME_DAILY_TARGET.target_key}:${runtimeBusinessDate(now)}`;
const post = body => worker.fetch(new Request("https://synthetic.example/api/runtime-daily/sync", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-daily-sync" }, body: JSON.stringify(body),
}), env);
async function read() {
  const session = await __test.makeSession("synthetic-reader", [], env);
  return worker.fetch(new Request(`https://synthetic.example/api/runtime-daily?date=${runtimeBusinessDate(now)}`, {
    headers: { Cookie: `qsl_switch_session=${session}` },
  }), env);
}
const health = (runtime, snapshot, selection = paperSelection) => overviewRuntimeHealth(runtime, snapshot, selection, false, now);
try {
  saveOptions(options);
  assert.equal(runtimeDailySelectionEligible(paperSelection), true);
  assert.equal(runtimeDailySelectionEligible(liveSelection), false, "same platform does not bind live accounts to PAPER daily");
  assert.equal(runtimeDailySelectionBinding({ longbridge: [{ ...live, account_scope: "paper" }] }, "longbridge", live.key), "not_applicable", "scope alone is not the source binding");
  assert.equal(runtimeDailySelectionBinding({ longbridge: [{ ...paper, account_scope: "PAPER" }] }, "longbridge", paper.key), "not_applicable", "scope is exact, not inferred from a name or lane");
  for (const platform of ["binance", "ibkr", "firstrade", "schwab", "longbridge"]) {
    const selection = platform === "longbridge" ? liveSelection : selectionFor(platform, `synthetic-${platform}`);
    assert.equal(health(runtimeFor(platform), null, selection).label, "健康", `${platform}: production normal projection uses its own lifecycle`);
    const notDue = runtimeFor(platform, "not_due");
    assert.equal(notDue.account_state.reason, "check_not_due");
    assert.equal(health(notDue, null, selection).label, "健康", `${platform}: explicit current check_not_due does not need another target's daily report`);
    notDue.observed_at = instant(-301);
    assert.equal(health(notDue, null, selection).label, "异常", `${platform}: not_due cannot mask stale evidence`);
  }
  assert.equal(health(runtimeFor("longbridge", "not_due"), null).label, "异常", "the bound PAPER source still requires its own daily evidence");
  const disabled = runtimeFor("longbridge");
  disabled.target.target.configured_state = "disabled"; disabled.target.deployment.runtime_enabled = false;
  disabled.target.deployment.scheduler_state = "paused"; disabled.target.monitoring.execution_heartbeat = "not_applicable";
  disabled.target.disposition.code = "continue_disabled_validation";
  disabled.account_state = __test.projectRuntimeAccountState(disabled);
  assert.equal(disabled.account_state.health, "normal");
  assert.equal(health(disabled, null).label, "健康", "production disabled agreement does not require a daily execution cycle");
  disabled.target.disposition.code = "parked"; disabled.account_state = __test.projectRuntimeAccountState(disabled);
  assert.equal(disabled.account_state.health, "abnormal");
  assert.equal(health(disabled, null).label, "异常", "parked faults remain abnormal even when activation is disabled");
  assert.equal(health(runtimeFor("longbridge"), null, { platform: "longbridge", accountKey: paper.key }).detail, "周期记录目标绑定未确认", "missing eligibility evidence fails closed");
  const ambiguous = { longbridge: [paper, { ...paper, key: "synthetic-duplicate", target_name: "synthetic-duplicate", account_selector: "PAPER2", deployment_selector: "synthetic-duplicate" }] };
  saveOptions(ambiguous);
  const ambiguousSelection = selectionFor("longbridge", paper.key, ambiguous);
  assert.equal(ambiguousSelection.dailyBinding, "unresolved");
  assert.equal(health(runtimeFor("longbridge"), null, ambiguousSelection).label, "异常");
  assert.equal((await post(projection())).status, 409);
  assert.equal((await read()).status, 409);
  saveOptions(options);

  assert.equal((await post(projection())).status, 200);
  const cleanResponse = await read(); assert.equal(cleanResponse.status, 200);
  const clean = await cleanResponse.json();
  assert.equal(clean.record.runs[0].errors_present, false);
  assert.equal(clean.record.runs[0].evidence, undefined);
  assert.equal(JSON.stringify(clean).includes("gs://"), false);
  assert.equal(health(runtimeFor("longbridge"), clean).label, "健康");
  assert.equal(presentRuntimeDaily(clean, paperSelection).statusLabel, "无交易");
  assert.equal(health(runtimeFor("longbridge", "not_due"), clean, liveSelection).label, "健康", "the other account's PAPER report is ignored by live lifecycle health");
  const wrongTarget = structuredClone(clean); wrongTarget.record.strategy_profile = "other_strategy";
  assert.equal(health(runtimeFor("longbridge"), wrongTarget).detail, "周期记录目标不匹配");
  assert.equal(presentRuntimeDaily(wrongTarget, paperSelection).accountMatched, false);

  for (const [name, mutate] of [
    ["failed activity", run => run.activity = "failed"],
    ["errors despite no_submission", run => run.evidence.errors_present = true],
    ["failed report", run => run.report_status = "failed"],
    ["failed execution", run => run.evidence.execution_status = "failed"],
    ["failed receipt", run => run.evidence.receipt_outcome = "failed"],
    ["unknown result", run => run.activity = "unknown"],
    ["pending submission", run => run.activity = "submitted"],
    ["pending orders", run => run.evidence.orders_pending_count = 1],
  ]) {
    store.delete(dailyKey());
    const conflicting = projection(); mutate(conflicting.records[0].runs[0]);
    const rejected = await post(conflicting);
    assert.equal(rejected.status, 400, name);
    assert.equal((await rejected.json()).error, "runtime_daily_summary_conflict", name);
    assert.equal(store.has(dailyKey()), false, `${name}: no invalid cache write`);
    // A conflicting older stored payload is refused without changing retained data.
    const legacy = JSON.stringify(conflicting); store.set(dailyKey(), legacy);
    const legacyRead = await read(); assert.equal(legacyRead.status, 503, name);
    assert.equal((await legacyRead.json()).error, "runtime_daily_record_invalid", name);
    assert.equal(store.get(dailyKey()), legacy);
  }
  for (const [name, mutate] of [
    ["failed public activity", run => run.activity = "failed"],
    ["public error flag", run => run.errors_present = true],
    ["missing public error evidence", run => delete run.errors_present],
    ["unconfirmed public activity", run => run.activity = "submitted"],
  ]) {
    const conflicting = structuredClone(clean); mutate(conflicting.record.runs[0]);
    assert.equal(health(runtimeFor("longbridge"), conflicting).label, "异常", name);
    assert.notEqual(presentRuntimeDaily(conflicting, paperSelection).statusLabel, "无交易", name);
  }
  const mixedFaults = structuredClone(clean);
  mixedFaults.record.runs = [{ ...clean.record.runs[0], activity: "submitted" }, { ...clean.record.runs[0], activity: "failed" }];
  assert.equal(presentRuntimeDaily(mixedFaults, paperSelection).statusLabel, "异常", "a later fault is not hidden by an earlier pending run");
  for (const status of ["no_signal", "no_rebalance", "filled", "not_due", "market_closed", "outside_window", "within_grace"]) {
    store.delete(dailyKey());
    const conflict = projection(); conflict.records[0].status = status;
    conflict.records[0].runs[0].evidence.errors_present = true;
    assert.equal((await post(conflict)).status, 400, `${status}: errors cannot be hidden by a benign summary`);
  }
  store.delete(dailyKey());
  const failed = projection(); failed.records[0].status = "failed";
  failed.records[0].runs[0].activity = "failed"; failed.records[0].runs[0].evidence.errors_present = true;
  assert.equal((await post(failed)).status, 200, "honest abnormal evidence is still accepted");
  const failedRead = await (await read()).json();
  assert.equal(failedRead.record.runs[0].errors_present, true);
  assert.equal(health(runtimeFor("longbridge"), failedRead).label, "异常");
  assert.equal(presentRuntimeDaily(failedRead, paperSelection).statusLabel, "异常");

  for (const [date, status] of [["2026-10-04T16:00:00Z", "market_closed"], ["2026-10-05T12:00:00Z", "not_due"]]) {
    now = Date.parse(date); store.delete(dailyKey());
    const scheduled = projection(); const record = scheduled.records[0];
    record.kind = "schedule"; record.status = status; record.runs = []; record.execution_lane = "insufficient";
    record.schedule = { ...record.schedule, state: status, latest_due_at: null, next_due_at: instant(60), publication_grace_ended: null };
    assert.equal((await post(scheduled)).status, 200);
    const scheduledRead = await (await read()).json();
    assert.equal(scheduledRead.record.execution_lane, "insufficient", "producer's unobserved lane is preserved");
    assert.equal(health(runtimeFor("longbridge", "not_due"), scheduledRead).label, "健康", "exact bound no-run schedule with explicit future due evidence");
    now += 60_000;
    assert.equal(health(runtimeFor("longbridge", "not_due"), scheduledRead).detail, "运行时间未确认或已到期", "fresh lifecycle cannot extend the source's scheduled window");
    now -= 60_000; store.delete(dailyKey());
    record.schedule.next_due_at = null;
    assert.equal((await post(scheduled)).status, 200);
    assert.equal(health(runtimeFor("longbridge", "not_due"), await (await read()).json()).label, "异常", "weekend/market_closed alone does not supply the missing next due time");
  }
  console.log("runtime daily health integration: PASS (production projection, exact binding, synthetic Worker/KV/UI, conflicts, supplied schedule boundaries)");
} finally {
  Date.now = realNow;
  globalThis.fetch = realFetch;
}
