import assert from "node:assert/strict";
import { test } from "node:test";
import * as facts from "../web/strategy-switch-console/account_facts.js";
import * as daily from "../web/strategy-switch-console/runtime_daily_contract.js";
import { accountFactsResponse, accountFactsHistoryResponse } from "../web/strategy-switch-console/application/account_facts/read.js";
import { todaySummary, strategySummary } from "../web/strategy-switch-console/application/console_api/operations.js";
import { configuredStrategyExecution, strategyTargetExecution } from "../web/strategy-switch-console/application/console_api/strategy_execution.js";
import { performanceResponse } from "../web/strategy-switch-console/application/console_api/performance_routes.js";
import { validate } from "./console_api_contract_validation.mjs";

const json = (body, status = 200) => Response.json(body, { status });
const request = path => new Request(`https://synthetic.invalid${path}`);
const now = Date.parse("2026-10-22T22:00:00Z"), date = "2026-10-22";
const account = { key: "synthetic-account", platform: "longbridge" };
const profile = { profile: "synthetic-strategy", domain: "us_equity" };
const baseDeps = {
  json, readSession: async () => ({ allowed: true }), hasConfigStore: () => true,
  hasRuntimeInstanceStore: () => true, loadAccountOptionsConfig: async () => ({ options: {} }),
  loadAccountFactsBindings: async () => null, loadStoredAccountFactsMap: async () => new Map(),
};
for (const [field, code] of [["loadAccountOptionsConfig", "account_options_unreadable"],
  ["loadAccountFactsBindings", "account_facts_bindings_unreadable"]]) {
  for (const history of [false, true]) test(`facts ${history ? "history" : "snapshot"}: ${field} failure is not an empty success`, async () => {
    let storageReads = 0;
    const deps = { ...baseDeps, [field]: async () => { throw Error("private-provider-diagnostic-sentinel"); },
      loadStoredAccountFactsMap: async () => { storageReads++; return new Map(); },
      runtimeInstanceCommand: async () => { storageReads++; return {}; } };
    const req = request("/api/account-facts/history?platform=ibkr&account_key=synthetic&currency=USD");
    const env = { ACCOUNT_FACTS_READ_MODEL_ENABLED: "true" };
    const response = history ? await accountFactsHistoryResponse(req, env, new URL(req.url), deps)
      : await accountFactsResponse(req, env, deps);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: code });
    assert.equal(storageReads, 0);
  });
}

test("cash: retain native fields, negative and real zero; missing is unknown", () => {
  const projected = { broker_reported_balances: [
    { currency: "HKD", net_assets: "10", total_cash: "-2.30" },
    { currency: "SGD", net_assets: "20" }, { currency: "USD", net_assets: "30" }],
  cash: [{ currency: "SGD", available_cash: "100", frozen_cash: "0", settling_cash: "0" },
    { currency: "USD", cash_balance: "0" }] };
  assert.deepEqual(facts.accountFactsCashByCurrency(projected), [
    { currency: "HKD", amount: "-2.30", status: "known", source_field: "balances.total_cash", unavailable_reason: null },
    { currency: "SGD", amount: null, status: "unknown", source_field: null, unavailable_reason: "cash_balance_not_reported" },
    { currency: "USD", amount: "0", status: "known", source_field: "cash.cash_balance", unavailable_reason: null },
  ]);
  assert.deepEqual(facts.accountFactsCashByCurrency(null), []);
});

test("cash: real read model projects absent Firstrade cash without exposing native identity", () => {
  const option = { key: "synthetic-ft", account_scope: "live", account_selector: "default",
    target_name: "synthetic-ft", service_name: "synthetic-service", deployment_selector: "synthetic-ft" };
  const binding = { ...option, platform: "firstrade", account_key: option.key, target_id: "synthetic-ft",
    broker_account_id: "synthetic-native-private", source_binding: { kind: "deployment_runtime_account", id: "f".repeat(64) } };
  delete binding.key;
  const payload = { schema_version: "firstrade_account_snapshot_history.v1",
    snapshot_schema_version: "firstrade_account_snapshot.v1", account_scope: "live", target_id: binding.target_id,
    source_binding: { ...binding.source_binding, status: "bound" }, broker_account_id: binding.broker_account_id,
    observed_started_at: "2026-10-22T21:58:00Z", observed_finished_at: "2026-10-22T21:59:00Z",
    observation_date: date, snapshot_atomic: false,
    broker_reported_balances: [{ currency: "USD", net_assets: "10" }], cash: [] };
  const model = facts.buildAccountFactsReadModel({ now, accountOptions: { firstrade: [option] },
    bindings: { schema_version: facts.ACCOUNT_FACTS_BINDINGS_SCHEMA, bindings: [binding] },
    storedByAccount: new Map([["firstrade:synthetic-ft", payload]]) });
  assert.equal(model.accounts[0].data_status, "fresh");
  assert.deepEqual(model.accounts[0].cash, []);
  assert.deepEqual(model.accounts[0].cash_by_currency, [
    { currency: "USD", amount: null, status: "unknown", source_field: null, unavailable_reason: "cash_balance_not_reported" },
  ]);
  assert.ok(!JSON.stringify(model).includes(binding.broker_account_id));
});

const record = patch => ({ business_date: date, target_key: "synthetic-target", observed_at: "2026-10-22T21:59:00Z",
  status: "no_signal", completeness: "complete", conflict_count: 0,
  runs: [{ run_id: "synthetic-run", activity: "no_signal", errors_present: false,
    started_at: "2026-10-22T21:58:00Z", finished_at: "2026-10-22T21:59:00Z", execution_lane: "dry_run" }], ...patch });
const body = patch => ({ account_key: account.key, platform: account.platform, date, data_status: "fresh",
  read_error_count: 0, read_error_codes: [], unmatched_count: 0, record: record(), ...patch });
const summarize = async (value, status = 200) => todaySummary(request("/api/runtime/today"), {}, {
  dailyBindings: async () => [{ ...account, account_key: account.key, status: "bound", target_key: "synthetic-target" }],
  daily: async req => { assert.equal(req.method, "GET"); return json(value, status); },
}, [account], now);

test("runtime diagnostics distinguish coverage from I/O and preserve partial runs", async () => {
  const coverage = body({ read_error_count: 1, read_error_codes: ["coverage_unconfirmed"],
    record: record({ completeness: "incomplete", status: "read_incomplete" }) });
  assert.equal(daily.runtimeDailyReadDiagnostics(coverage).read_status, "partial");
  const partial = await summarize(coverage);
  assert.equal(partial.accounts[0].read_status, "partial");
  assert.deepEqual(partial.accounts[0].read_error_codes, ["coverage_unconfirmed"]);
  assert.equal(partial.accounts[0].run_count, 1);
  assert.equal(partial.counts.runs, null);
  validate("today_runs", partial);
  for (const activity of ["failed", "blocked"]) {
    const result = await summarize(body({ read_error_count: 1, read_error_codes: ["report_read_error"],
      record: record({ status: activity, runs: [{ ...record().runs[0], activity, errors_present: true }] }) }));
    assert.equal(result.accounts[0].read_status, "partial");
    assert.equal(result.accounts[0].read_failure_reason, "source_read_error");
    assert.equal(result.accounts[0].run_status, activity);
    assert.equal(result.accounts[0].run_count, 1);
    assert.equal(result.counts.runs, null);
  }
});

test("runtime: no record plus read failure is not no_data; transport and binding errors stay distinct", async () => {
  const missing = await summarize(body({ record: null, read_error_count: 1, read_error_codes: ["read_failed"] }));
  assert.equal(missing.accounts[0].status, "read_failed");
  assert.equal(missing.accounts[0].read_status, "read_failed");
  assert.equal(missing.accounts[0].run_count, null);
  const empty = await summarize(body({ record: null, data_status: "unavailable" }));
  assert.equal(empty.accounts[0].status, "no_data");
  assert.equal(empty.accounts[0].read_status, "no_data");
  for (const [status, reason] of [[401, "unauthorized"], [403, "unauthorized"], [503, "source_read_error"]]) {
    const response = await summarize({ error: "private-provider-diagnostic-sentinel" }, status);
    assert.equal(response.accounts[0].read_status, "read_failed");
    assert.equal(response.accounts[0].read_failure_reason, reason);
    assert.ok(!JSON.stringify(response).includes("private-provider"));
  }
  const mismatch = await summarize(body({ date: "2026-10-21" }));
  assert.equal(mismatch.accounts[0].read_failure_reason, "daily_binding_mismatch");
  const unknown = await summarize(body({ read_error_count: undefined, unmatched_count: undefined }));
  assert.equal(unknown.accounts[0].read_status, "unknown");
  assert.equal(unknown.accounts[0].read_error_count, null);
  assert.equal(unknown.counts.runs, null);
});

test("health: per-strategy time and source are separate from snapshot time; missing score stays null", async () => {
  const snapshotTime = "2026-10-22T21:59:00Z", itemTime = "2026-10-01";
  const snapshot = { data_status: "ready", computed_at: snapshotTime, errors: [], strategies: [{
    profile: profile.profile, status: "watch", score: 0, as_of: itemTime,
    freshness: { status: "stale", age_seconds: 1814400 }, source_revision: "a".repeat(40),
    components: { performance: 0, risk: null, decay: null, stability: null, operations: null },
  }] };
  const summary = await strategySummary(request("/api/strategies/summary"), {}, {
    profiles: async () => [profile, { ...profile, profile: "synthetic-missing" }],
    health: async () => json(snapshot),
  }, [], {});
  const row = summary.strategies[0];
  assert.equal(summary.as_of, snapshotTime);
  assert.equal(row.health_as_of, itemTime);
  assert.equal(row.health_score, 0);
  assert.equal(row.health_freshness.status, "stale");
  assert.equal(row.status, "stale");
  assert.equal(row.health_source, "stored_strategy_health_snapshot");
  assert.equal(row.health_source_revision, "a".repeat(40));
  assert.equal(row.health_components.performance, 0);
  const missing = summary.strategies[1];
  assert.equal(missing.health_score, null);
  assert.equal(missing.health_as_of, null);
  assert.equal(missing.health_source_revision, null);
  assert.equal(missing.health_freshness.status, "unknown");
  assert.equal(summary.health_score_scale.methodology, "not_provided");
  validate("strategy_summary", summary);
});

test("mode labels require explicit target and consistent broker environment, never alias/profile inference", () => {
  for (const [mode, dry, environment, label] of [
    ["live", false, "live", "live"], ["paper", false, "paper", "paper"],
    ["live", true, "live", "dry_run"], ["live", false, "paper", "unknown"],
    ["paper", false, "live", "unknown"], ["live", false, null, "unknown"],
    ["paper", null, "paper", "unknown"],
  ]) {
    const target = { execution_mode: mode, dry_run_only: dry };
    const current = { ...target, source: "RUNTIME_TARGET_JSON", strategy_execution: strategyTargetExecution(target) };
    const result = configuredStrategyExecution(current, profile, "longbridge", { broker_environment: environment });
    assert.equal(result.execution_label, label);
    assert.equal(result.broker_environment, environment);
    assert.equal(result.runtime_observation_status, "unknown");
  }
  const inferred = configuredStrategyExecution({ source: "STRATEGY_PROFILE", execution_mode: "paper" },
    profile, "longbridge", { target_name: "paper", broker_environment: "paper" });
  assert.equal(inferred.execution_label, "unknown");
  assert.equal(inferred.mode_unavailable_reason, "explicit_target_mode_missing");
});

test("six performance APIs: failed facts cannot masquerade as absent holdings/fills", async () => {
  const options = { longbridge: [{ key: account.key, broker_environment: "live" }] };
  const deps = { json, readSession: baseDeps.readSession, accountOptions: async () => ({ options }),
    facts: async () => json({ error: "synthetic-failure" }, 503), history: async () => json({ series: { points: [] } }),
    benchmarks: async () => json({ series: [] }), wallet: async () => { throw Error("unexpected-wallet"); } };
  for (const endpoint of ["calendar", "summary", "returns", "assets", "holdings", "trades"]) {
    const response = await performanceResponse(request(`/api/performance/${endpoint}`), {}, deps);
    const result = await response.json();
    assert.equal(response.status, 200);
    if (endpoint === "trades") {
      assert.equal(result.status, "not_connected");
      assert.equal(result.unavailable_reason, "fills_not_connected");
    } else {
      assert.equal(result.status, "unavailable", endpoint);
      assert.equal(result.unavailable_reason, "stored_records_unreadable", endpoint);
    }
  }
  const fact = { account_key: account.key, platform: account.platform, binding_status: "bound",
    positions: [{ symbol: "SYNTH", currency: "USD", quantity: "1", market_value: "10" }],
    positions_scope: "broker_reported", balances: [{ currency: "USD", net_assets: "10" }] };
  const valid = await performanceResponse(request("/api/performance/holdings"), {}, { ...deps,
    facts: async () => json({ accounts: [fact] }), history: async () => json({}, 503),
    benchmarks: async () => json({}, 503) });
  const result = await valid.json();
  assert.equal(result.status, "partial");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].unrealized_pnl, null);
});
