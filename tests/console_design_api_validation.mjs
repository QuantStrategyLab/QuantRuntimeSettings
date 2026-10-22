import assert from "node:assert/strict";
import "./console_strategy_execution_validation.mjs";
import { todaySummary, strategySummary, businessDate, notificationLog } from "../web/strategy-switch-console/application/console_api/operations.js";
import { runControls } from "../web/strategy-switch-console/application/console_api/run_controls.js";
import { inbox } from "../web/strategy-switch-console/application/console_api/routes.js";
import { canonicalItem, decisionHistoryRows, shortId } from "../web/strategy-switch-console/application/console_api/presentation.js";
import { consoleApiFixture } from "../web/strategy-switch-console/frontend/scripts/console-api-synthetic.mjs";
import { validate } from "./console_api_contract_validation.mjs";
import { runtimeDailyBusinessDate, RUNTIME_DAILY_TIMEZONE } from "../web/strategy-switch-console/runtime_daily_contract.js";

const now = Date.parse("2026-10-15T16:30:00Z");
assert.equal(businessDate(now), "2026-10-16", "today follows the backend business timezone");
const account = { key: "synthetic-alpha", platform: "longbridge", default_strategy_profile: "synthetic-growth" };
const request = new Request("https://console.example/api/runtime/today");
const binding = { platform: account.platform, account_key: account.key, target_key: "synthetic-target", status: "bound" };
const record = { business_date: runtimeDailyBusinessDate(now), target_key: binding.target_key, observed_at: new Date(now).toISOString(),
  completeness: "complete",
  status: "no_signal", runs: [{ run_id: "synthetic-run", started_at: null, finished_at: null,
    activity: "no_signal", execution_lane: "paper", errors_present: false }] };
const dailyBody = { account_key: account.key, platform: account.platform, date: runtimeDailyBusinessDate(now), data_status: "fresh",
  read_error_count: 0, read_error_codes: [], unmatched_count: 0, record };
const deps = { dailyBindings: async () => [binding], daily: async req => {
  assert.equal(new URL(req.url).searchParams.get("date"), "2026-10-15");
  return Response.json(dailyBody);
} };
let result = await todaySummary(request, {}, deps, [account], now);
validate("today_runs", result);
assert.equal(result.accounts[0].activity, "no_signal");
assert.equal(result.accounts[0].run_count, 1);
assert.equal(result.status, "ok");
result = await todaySummary(request, {}, deps, [account, { key: "synthetic-unbound", platform: "ibkr" }], now);
assert.equal(result.status, "partial");
assert.equal(result.counts.runs, null, "incomplete coverage must not report a total of zero or one");
assert.equal(result.accounts[1].run_count, null);
for (const [body, status] of [
  [{ ...dailyBody, record: null }, "no_data"],
  [{ ...dailyBody, data_status: "stale" }, "stale"],
  [{ ...dailyBody, record: { ...record, completeness: "incomplete" } }, "partial"],
  [{ ...dailyBody, read_error_count: 1 }, "partial"],
  [{ ...dailyBody, account_key: "synthetic-other" }, "read_failed"],
  [{ ...dailyBody, record: { ...record, business_date: "2026-10-14" } }, "read_failed"],
]) {
  result = await todaySummary(request, {}, { ...deps, daily: async () => Response.json(body) }, [account], now);
  assert.equal(result.accounts[0].status, status);
  if (status === "partial") assert.equal(result.counts.runs, null, "incomplete reports do not certify a total");
  validate("today_runs", result);
}
result = await todaySummary(request, {}, { ...deps, daily: async () => new Response(null, { status: 503 }) }, [account], now);
assert.equal(result.status, "read_failed");
assert.equal(result.counts.runs, null);
result = await todaySummary(request, {}, { ...deps, dailyBindings: async () => [] }, [account], now);
assert.equal(result.accounts[0].status, "not_connected");

// Reproduce the UTC/Shanghai date lead and both New York midnight offsets.
for (const [instant, expected] of [
  ["2026-10-15T22:24:00Z", "2026-10-15"],
  ["2026-07-16T03:59:59Z", "2026-07-15"],
  ["2026-07-16T04:00:00Z", "2026-07-16"],
  ["2026-01-16T04:59:59Z", "2026-01-15"],
  ["2026-01-16T05:00:00Z", "2026-01-16"],
]) {
  const clock = Date.parse(instant);
  assert.equal(runtimeDailyBusinessDate(clock), expected);
  const reads = [];
  const summary = await todaySummary(request, {}, { ...deps, daily: async req => {
    const date = new URL(req.url).searchParams.get("date");
    reads.push(date);
    if (date > expected) return Response.json({ error: "invalid_runtime_daily_date" }, { status: 400 });
    return Response.json({ ...dailyBody, date, record: null });
  } }, [account], clock);
  assert.deepEqual(reads, [expected]);
  assert.equal(summary.timezone, RUNTIME_DAILY_TIMEZONE);
  assert.equal(summary.date, expected);
  assert.equal(summary.accounts[0].status, "no_data", "a missing record is not a storage failure or a successful run");
  assert.equal(summary.counts.runs, null);
  validate("today_runs", summary);
}

const strategies = await strategySummary(request, {}, {
  profiles: async () => [{ profile: "synthetic-growth", domain: "us_equity", allowed_execution_modes: ["paper"] }],
  health: async () => Response.json({ data_status: "stale", computed_at: "2026-10-01T00:00:00Z",
    strategies: [{ profile: "synthetic-growth", status: "watch", score: 50 }] }),
}, [account], { longbridge: { [account.key]: { strategy_profile: "synthetic-growth" } } });
validate("strategy_summary", strategies);
assert.equal(strategies.status, "stale");
assert.equal(strategies.strategies[0].configured_accounts[0].account_alias, account.key);
assert.match(strategies.coverage, /not_runtime_deployment/);
validate("notification_log", await notificationLog());
assert.equal((await notificationLog()).items.length, 0);

let preflights = 0;
const controlDeps = { dispatchAvailable: true, stopReady: async () => { preflights++; return true; },
  resumeTarget: async () => ({ runtime_target_sha256: "a".repeat(64) }), profileState: async () => ({ ready: true }) };
result = await runControls(account, { admin: false }, controlDeps);
assert.equal(preflights, 0, "reader must not execute control preflights");
for (const action of Object.values(result.actions)) assert.deepEqual([action.enabled, action.reason], [false, "admin_required"]);
result = await runControls(account, { admin: true }, controlDeps);
validate("run_controls", result);
assert.equal(result.actions.stop.enabled, true);
assert.equal(result.actions.approve_application.enabled, true);
assert.equal(result.actions.enable.enabled, false, "generic activation stays disconnected");
assert.equal(result.actions.resume.enabled, false, "another platform cannot use Binance recovery");
result = await runControls({ ...account, platform: "binance" }, { admin: true }, controlDeps);
assert.equal(result.actions.resume.enabled, true);
assert.match(result.resume_binding.runtime_target_sha256, /^[a-f0-9]{64}$/);
result = await runControls(account, { admin: true }, { ...controlDeps, stopReady: async () => false, profileState: async () => ({ reason: "account_settings_identity_conflict" }) });
assert.equal(result.actions.stop.enabled, false);
assert.equal(result.actions.approve_application.reason, "account_settings_identity_conflict");
result = await runControls(account, { admin: true }, { ...controlDeps, stopReady: async () => { throw Error("unreadable"); } });
assert.equal(result.actions.stop.enabled, false);
assert.equal(result.status, "partial");

const paperTicket = { ticket_id: "synthetic-paper", strategy_profile: "synthetic-paper-strategy", confirmation_execution_mode: "paper", state: "awaiting_human",
  decision_binding: { kind: "promotion", subject_id: "synthetic-paper", material_sha256: "a".repeat(64) } };
const empty = async () => Response.json({ data_status: "ready" });
const queue = await inbox(request, {}, { owner: empty, recovery: empty, credential: empty,
  promotion: async () => Response.json({ data_status: "ready", tickets: [paperTicket], applications: [paperTicket] }) });
validate("inbox", queue);
assert.equal(queue.items.length, 1, "paper application has one inbox entry");
assert.equal(queue.items[0].category, "paper_account_application");
assert.equal(queue.items[0].affects_live, false);
assert.ok(queue.items[0].diff.length > 0);
assert.ok(queue.items[0].diff.every(row => row.affects_live === false), "paper diff rows cannot claim a live-account effect");
assert.deepEqual(queue.items[0].decision_binding, paperTicket.decision_binding);
const accepted = canonicalItem({ ...paperTicket, state: "human_accepted", application: { broker_environment: "paper", status: "uncertain" } }, "strategy_promotion");
assert.equal(accepted.status, "decided", "uncertain application must not invite another adoption");
assert.equal(accepted.application_status, "uncertain");
const history = await decisionHistoryRows([{ request_key: "synthetic-decision", kind: "promotion", subject_id: paperTicket.ticket_id,
  material_key: "a".repeat(64), decided_at: "2026-10-16T00:30:00Z", action: "accept", actor: "synthetic-owner",
  target_json: JSON.stringify({ confirmation: { execution_mode: "paper" } }) }]);
assert.equal(history[0].category, "paper_account_application");
assert.equal(history[0].item_short_id, queue.items[0].short_id);
assert.equal(history[0].short_id, shortId("synthetic-decision", "CH"));
assert.notEqual(shortId("same-prefix-a"), shortId("same-prefix-b"));

for (const scenario of ["api-ready", "api-empty", "api-partial", "api-stale", "api-not-connected", "api-read-failed"])
  for (const [path, schema] of [["/api/runtime/today", "today_runs"], ["/api/strategies/summary", "strategy_summary"],
    ["/api/notifications/send-log", "notification_log"], ["/api/accounts/run-controls", "run_controls"]]) {
    const fixture = consoleApiFixture(path, new URLSearchParams(), scenario, "GET", now);
    validate(fixture.status === 503 ? "read_failed" : schema, fixture.body);
  }
console.log("console_design_api_validation: PASS");

await import("./console_notification_receipts_validation.mjs");
await import("./console_grouping_runs_validation.mjs");
