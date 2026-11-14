// N1 five-route read projections (docs/desk-n1-read-projection-contract.md).
//
// Handler-level checks use fake sources and a fixed clock; the worker-level
// checks drive the real routes through worker.fetch with a spy runtime store
// and config store, and assert that only the three allowlisted read-only
// commands are reached, with zero writes and zero outbound fetches.
// DESK_N1_WRITE_FIXTURES=1 rewrites the golden fixtures from these scenarios.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { coverage, freshness, known, partial, unknown, utcInstant } from "../web/strategy-switch-console/application/desk/n1.js";
import { deskAccountsResponse } from "../web/strategy-switch-console/application/desk/accounts.js";
import { bookSparkline, deskOverviewResponse, lastRun, overviewTotals, runsToday } from "../web/strategy-switch-console/application/desk/overview.js";
import {
  deskPerformanceResponse, performanceProjection, performanceQuery, performanceWindow, decimal,
} from "../web/strategy-switch-console/application/desk/performance.js";
import { deskRibbonResponse, nextScheduledRun, ribbonBusinessDates, ribbonDate, ribbonTape, tapeOutcome } from "../web/strategy-switch-console/application/desk/ribbon.js";
import {
  catalogFingerprint, deskSwitchStrategiesResponse, switchStrategiesTargetId,
} from "../web/strategy-switch-console/application/desk/switch_strategies.js";
import { rangeStart } from "../web/strategy-switch-console/performance_math.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const ajv = new (require("ajv/dist/2020").default)({ strict: false, allErrors: true });
require("ajv-formats")(ajv);
const schemaDir = new URL("../schemas/desk/", import.meta.url);
for (const file of readdirSync(schemaDir).filter(file => file.endsWith(".json") && file !== "manifest.json")) {
  ajv.addSchema(JSON.parse(readFileSync(new URL(file, schemaDir), "utf8")));
}
const conforms = (name, data) => {
  const check = ajv.getSchema(`https://schemas.example.invalid/qsl/desk/n1-${name}.json`);
  assert.ok(check(data), `${name}: ${ajv.errorsText(check.errors)}`);
};
const fixtureDir = new URL("./fixtures/desk/", import.meta.url);
const WRITE = process.env.DESK_N1_WRITE_FIXTURES === "1";
const golden = (name, scenario, body) => {
  const url = new URL(`n1-${name}.${scenario}.json`, fixtureDir);
  if (WRITE) writeFileSync(url, `${JSON.stringify(body, null, 2)}\n`);
  assert.deepEqual(body, JSON.parse(readFileSync(url, "utf8")), `n1-${name}.${scenario} golden payload drifted`);
};

// ---------------------------------------------------------------- fake world
const NOW = Date.parse("2030-01-08T15:00:00Z"); // Tue; NY 10:00, Shanghai 23:00.
const ID = (n) => String(n).repeat(64);
const READS = new Set(["account_facts_list", "account_facts_history_read", "credential_maintenance_read"]);

function account(index, { currency = "USD", amount = "1000", paper = false, staleHours = 0, identity = `fake-native-${index}` } = {}) {
  const key = `fake-${index}`;
  const option = { key, target_name: `target${index}`, service_name: `${key}-service`, deployment_selector: key,
    account_selector: "default", account_scope: "live", broker_environment: paper ? "paper" : "live", supported_domains: ["us_equity"] };
  const binding = { ...option, platform: "firstrade", account_key: key, broker_account_id: identity, target_id: key,
    source_binding: { kind: "deployment_runtime_account", id: ID(index + 1) } };
  delete binding.key; delete binding.broker_environment; delete binding.supported_domains;
  const snapshot = (date, value, finishedAt) => ({ schema_version: "firstrade_account_snapshot_history.v1",
    snapshot_schema_version: "firstrade_account_snapshot.v1", account_scope: "live", target_id: key,
    source_binding: { ...binding.source_binding, status: "bound" }, broker_account_id: identity,
    observed_started_at: new Date(Date.parse(finishedAt) - 60000).toISOString(), observed_finished_at: finishedAt,
    observation_date: date, snapshot_atomic: false, broker_reported_balances: [{ currency, net_assets: value }], cash: [] });
  const currentAt = new Date(NOW - staleHours * 3600000 - 120000).toISOString();
  return { key, option, binding, current: snapshot(currentAt.slice(0, 10), amount, currentAt), snapshot };
}

function historyDays(acct, values) {
  // One stored day per value, ending yesterday (Shanghai business dates, weekdays only).
  const days = [];
  let cursor = Date.parse("2030-01-07T00:00:00Z");
  for (let index = values.length - 1; index >= 0; index -= 1) {
    while ([0, 6].includes(new Date(cursor).getUTCDay())) cursor -= 86400000;
    const date = new Date(cursor).toISOString().slice(0, 10);
    days.unshift({ observation_date: date, target_id: acct.key, account_scope: "live", source_binding_id: acct.binding.source_binding.id,
      payload: acct.snapshot(date, values[index], `${date}T21:00:00.000Z`) });
    cursor -= 86400000;
  }
  return days;
}

const PROFILES = [
  { profile: "fake_growth", label: "Fake Growth", domain: "us_equity", allowed_execution_modes: ["live", "paper", "dry_run"],
    lifecycle_stage: "live_enabled", runtime_enabled: true, can_switch_live: true },
  { profile: "fake_research", label: "Fake Research", domain: "us_equity", allowed_execution_modes: ["paper", "dry_run"], lifecycle_stage: "research_active" },
  { profile: "fake_crypto", label: "Fake Crypto", domain: "crypto", allowed_execution_modes: ["live"], lifecycle_stage: "live_enabled" },
];

function summaryFor(accounts, date, { runs = true, status = "ok", completeness = "complete" } = {}) {
  return { date, accounts: accounts.map(acct => ({ platform: "firstrade", account_alias: acct.key, status, unavailable_reason: null, completeness,
    as_of: `${date}T14:30:00Z`,
    runs: runs ? [{ id: `run-${acct.key}`, started_at: `${date}T14:31:00Z`, finished_at: `${date}T14:32:00Z`, activity: "no_signal", errors_present: false }] : [] })) };
}

function world({ accounts = [account(0), account(1)], config = true, facts = true, credential = "7", history = null, summaries = {},
  profiles = PROFILES } = {}) {
  const calls = [];
  const options = { firstrade: accounts.map(acct => acct.option) };
  const bindings = { schema_version: "qsl_account_facts_bindings.v1", bindings: accounts.map(acct => acct.binding) };
  const stored = new Map(accounts.filter(acct => acct.current).map(acct => [`firstrade:${acct.key}`, acct.current]));
  const deps = {
    auth: async () => ({ allowed: true, login: "fake-reader" }),
    now: () => NOW,
    options: async () => { calls.push("options"); if (!config) throw Error("down"); return { options: accounts.length ? options : {}, revision: 3 }; },
    profiles: async () => { calls.push("profiles"); if (!profiles) throw Error("down"); return profiles; },
    domains: (platform, option) => option.supported_domains,
    eligibility: __test.deskStrategyEligibility,
    factsBindings: async () => { if (!facts) throw Error("down"); return bindings; },
    factsStored: async () => { calls.push("account_facts_list"); if (!facts) throw Error("down"); return stored; },
    command: async (env, command) => {
      calls.push(command.action);
      assert.ok(READS.has(command.action), `non-read command ${command.action}`);
      if (command.action === "credential_maintenance_read") {
        if (!credential) throw Error("down");
        return { id: "ibkr_flex", expires_at: "2030-01-15T00:00:00.000Z", phase: credential };
      }
      if (command.action === "account_facts_history_read") {
        const acct = accounts.find(item => item.key === command.account_key);
        const values = history?.[command.account_key];
        if (values === "fail") throw Error("down");
        return { ok: true, days: values ? historyDays(acct, values) : [] };
      }
      throw Error("unexpected");
    },
    runtimeDay: async (request, env, list, date, options) => { calls.push(`runtime:${date}`); if (options !== undefined) calls.push(`options:${date}:${JSON.stringify(options)}`); if (summaries[date] === "fail") throw Error("down"); return summaries[date] ?? summaryFor(accounts, date); },
  };
  return { deps, calls, env: { ACCOUNT_FACTS_READ_MODEL_ENABLED: "true" } };
}

const get = (path, init = {}) => new Request(`https://console.example${path}`, init);
async function body(response, status = 200) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  return response.json();
}
const assertNoPrivate = (payload) => {
  const text = JSON.stringify(payload);
  for (const secret of ["fake-native-", ID(1), ID(2), "default\""]) assert.ok(!text.includes(secret), `private value leaked: ${secret.slice(0, 12)}`);
};

// ---------------------------------------------------------------- N1 helpers
assert.equal(utcInstant("2030-01-08T23:00:00+08:00"), "2030-01-08T15:00:00Z", "an offset is honoured, not dropped");
assert.equal(utcInstant("2030-01-08T15:00:00"), null, "no zone is rejected");
assert.equal(utcInstant("2030-02-30T00:00:00Z"), null);
assert.deepEqual(known([], NOW, coverage("verified_empty", 0, 0)).coverage.state, "verified_empty");
assert.throws(() => known([1], NOW, coverage("partial", 1, 2)), /complete coverage/);
assert.throws(() => partial([1], NOW, coverage("complete", 1, 1)), /partial coverage/);
assert.ok(!("value" in unknown("read_failed")), "unknown never carries a value");
assert.deepEqual(freshness([], { now: NOW, ttlSeconds: 60 }), { data_status: "unavailable", age_seconds: null });
assert.deepEqual(freshness(["2030-01-08T14:00:00Z"], { now: NOW, ttlSeconds: 60 }), { data_status: "stale", age_seconds: 3600 });
assert.deepEqual(freshness(["2030-01-08T14:59:00Z"], { now: NOW, ttlSeconds: 3600 }), { data_status: "ready", age_seconds: 60 });

// ---------------------------------------------------------------- routes: method/auth/query/target
for (const handler of [deskRibbonResponse, deskOverviewResponse, deskAccountsResponse, deskPerformanceResponse]) {
  const { deps } = world();
  assert.equal((await handler(get("/api/desk/x", { method: "POST" }), {}, deps)).status, 404, "GET only");
  const denied = { ...deps, auth: async () => { throw new (await import("../web/strategy-switch-console/application/desk/http.js")).DeskError("login_required", 401); } };
  assert.equal((await handler(get("/api/desk/x"), {}, denied)).status, 401);
}
for (const path of ["/api/desk/overview?x=1", "/api/desk/accounts?x=1"]) {
  const { deps } = world();
  const handler = path.includes("overview") ? deskOverviewResponse : deskAccountsResponse;
  assert.equal((await handler(get(path), {}, deps)).status, 400);
}
assert.equal(switchStrategiesTargetId("/api/desk/switch/targets/firstrade%2Ftarget0/strategies"), "firstrade/target0");
assert.equal(switchStrategiesTargetId("/api/desk/switch/targets/firstrade%252Ftarget0/strategies"), null, "decoded once only");
assert.equal(switchStrategiesTargetId("/api/desk/switch/targets/firstrade/target0/strategies"), null);
assert.equal(switchStrategiesTargetId("/api/desk/switch/targets"), null);

// ---------------------------------------------------------------- A. switch strategies
{
  const { deps, env } = world();
  const ok = await body(await deskSwitchStrategiesResponse(get("/api/desk/switch/targets/firstrade%2Ftarget0/strategies"), env, deps));
  conforms("switch-strategies", ok);
  assert.equal(ok.schema_version, "qsl.desk.switch_strategies.v2");
  assert.deepEqual(ok.switchable, { allowed: false, reason_code: "switch_not_connected" });
  assert.equal(ok.domain.status, "known");
  const byProfile = Object.fromEntries(ok.strategies.value.map(row => [row.profile, row]));
  assert.deepEqual([byProfile.fake_crypto.eligibility.value, byProfile.fake_crypto.reason], ["blocked", "domain_not_supported"],
    "a provably blocked row is kept, not filtered away");
  assert.equal(ok.catalog_revision.value.kind, "projection_fingerprint");
  assert.match(ok.catalog_revision.value.value, /^[0-9a-f]{64}$/);
  golden("switch-strategies", "ok", ok);
  // Same semantics in a different order: same fingerprint; a relevant change: a new one.
  const rows = ok.strategies.value;
  const base = { targetId: "firstrade/target0", platform: "firstrade", supportedDomains: ["us_equity"], domain: "us_equity" };
  const a = await catalogFingerprint({ ...base, rows });
  assert.equal(a.value, (await catalogFingerprint({ ...base, rows: [...rows].reverse() })).value);
  assert.notEqual(a.value, (await catalogFingerprint({ ...base, rows: rows.map(row => ({ ...row, lifecycle_stage: "frozen" })) })).value);
  assert.equal((await deskSwitchStrategiesResponse(get("/api/desk/switch/targets/firstrade%2Fnope/strategies"), env, deps)).status, 404);
  assert.equal((await deskSwitchStrategiesResponse(get("/api/desk/switch/targets/firstrade%2Ftarget0/strategies?x=1"), env, deps)).status, 400);

  // Several domains: never pick the first one; eligibility cannot be proven.
  const multi = world({ accounts: [account(0)] });
  multi.deps.domains = () => ["us_equity", "crypto"];
  const degraded = await body(await deskSwitchStrategiesResponse(get("/api/desk/switch/targets/firstrade%2Ftarget0/strategies"), multi.env, multi.deps));
  conforms("switch-strategies", degraded);
  assert.equal(degraded.domain.status, "unknown");
  assert.equal(degraded.catalog_revision.status, "unknown", "no fingerprint for an incomplete projection");
  golden("switch-strategies", "degraded", degraded);

  // A row the existing checks cannot classify stays, as unknown, and the list is partial.
  const part = world({ accounts: [account(0)], profiles: [...PROFILES, { profile: "fake_dca", label: "Fake DCA", domain: "us_equity", allowed_execution_modes: ["live"], lifecycle_stage: "live_enabled" }] });
  part.deps.eligibility = (platform, option, profile, ...rest) => profile.profile === "fake_dca" ? null : __test.deskStrategyEligibility(platform, option, profile, ...rest);
  const partialBody = await body(await deskSwitchStrategiesResponse(get("/api/desk/switch/targets/firstrade%2Ftarget0/strategies"), part.env, part.deps));
  conforms("switch-strategies", partialBody);
  assert.equal(partialBody.strategies.status, "partial");
  assert.deepEqual(partialBody.strategies.coverage, { state: "partial", included: 3, total: 4, reasons: ["coverage_incomplete"] });
  assert.equal(partialBody.strategies.value.find(row => row.profile === "fake_dca").eligibility.status, "unknown");
  golden("switch-strategies", "partial", partialBody);

  const empty = world({ accounts: [account(0)], profiles: [] });
  const emptyBody = await body(await deskSwitchStrategiesResponse(get("/api/desk/switch/targets/firstrade%2Ftarget0/strategies"), empty.env, empty.deps));
  conforms("switch-strategies", emptyBody);
  assert.equal(emptyBody.strategies.coverage.state, "verified_empty");
  golden("switch-strategies", "empty", emptyBody);

  const unreadable = world({ accounts: [account(0)], profiles: null });
  const failed = await body(await deskSwitchStrategiesResponse(get("/api/desk/switch/targets/firstrade%2Ftarget0/strategies"), unreadable.env, unreadable.deps));
  assert.equal(failed.strategies.status, "unknown", "an unreadable catalog is not an empty catalog");
  conforms("switch-strategies", failed);
}

// ---------------------------------------------------------------- B. ribbon
{
  assert.deepEqual(ribbonBusinessDates("2030-01-08", NOW), ["2030-01-07", "2030-01-08"], "a UTC day spans two NY business days");
  assert.deepEqual(ribbonBusinessDates("2030-01-08", Date.parse("2030-01-08T03:00:00Z")), ["2030-01-07"], "never beyond NY today");
  assert.equal(ribbonDate(new URL("https://x/api/desk/ribbon"), NOW), "2030-01-08", "default is the UTC day");
  for (const bad of ["?date=2030-02-30", "?date=2030-1-1", "?date=2030-01-09", "?other=1", "?date=2030-01-01&date=2030-01-02"]) {
    assert.throws(() => ribbonDate(new URL(`https://x/api/desk/ribbon${bad}`), NOW), /invalid/);
  }
  assert.equal(tapeOutcome({ activity: "filled", errors_present: false }), "filled");
  assert.equal(tapeOutcome({ activity: "submitted", errors_present: false }), null, "transport acceptance is not a fill");
  assert.equal(tapeOutcome({ activity: "no_signal", errors_present: true }), "error");
  assert.equal(tapeOutcome({ activity: "no_rebalance", errors_present: false }), "no_op");

  const { deps, env, calls } = world();
  const ok = await body(await deskRibbonResponse(get("/api/desk/ribbon"), env, deps));
  conforms("ribbon", ok);
  assert.deepEqual(ok.alert_badge, unknown("not_supported", coverage("unavailable", 0, null, ["not_supported"])), "no alerts store: unknown, never 0");
  assert.equal(ok.console_state.mode.status, "unknown");
  assert.equal(ok.console_state.mode.reason, "not_supported");
  assert.equal(ok.date_basis, "utc_day");
  assert.equal(ok.tape.status, "known");
  assert.ok(ok.tape.value.every(entry => entry.source_timezone === "America/New_York"));
  assert.ok(ok.tape.value.every(entry => entry.at.slice(0, 10) === "2030-01-08"), "only instants inside the UTC day");
  assert.ok(ok.sessions.every(session => session.state === "unknown" && session.holiday === null));
  assert.equal(ok.next_run.status, "unknown");
  assert.notEqual(ok.freshness.age_seconds, 0, "freshness is the stored observation age, not generated_at");
  assert.deepEqual(calls.filter(call => call.startsWith("runtime:")), ["runtime:2030-01-07", "runtime:2030-01-08"]);
  golden("ribbon", "ok", ok);

  const stale = world({ summaries: { "2030-01-07": "fail" } });
  const degraded = await body(await deskRibbonResponse(get("/api/desk/ribbon"), stale.env, stale.deps));
  conforms("ribbon", degraded);
  assert.equal(degraded.tape.status, "partial");
  assert.ok(degraded.tape.coverage.reasons.includes("read_failed"));
  golden("ribbon", "degraded", degraded);

  const accounts = [account(0), account(1)];
  const half = world({ accounts, summaries: { "2030-01-07": summaryFor(accounts.slice(0, 1), "2030-01-07"), "2030-01-08": summaryFor(accounts.slice(0, 1), "2030-01-08") } });
  const partialBody = await body(await deskRibbonResponse(get("/api/desk/ribbon"), half.env, half.deps));
  conforms("ribbon", partialBody);
  assert.equal(partialBody.tape.status, "partial");
  assert.deepEqual([partialBody.tape.coverage.included, partialBody.tape.coverage.total], [1, 2]);
  golden("ribbon", "partial", partialBody);

  const none = world({ accounts: [] });
  const emptyBody = await body(await deskRibbonResponse(get("/api/desk/ribbon?date=2030-01-07"), none.env, none.deps));
  conforms("ribbon", emptyBody);
  assert.equal(emptyBody.tape.coverage.state, "verified_empty");
  golden("ribbon", "empty", emptyBody);

  // A newer response time cannot refresh an old stored observation.
  const old = ribbonTape({ days: [{ date: "2030-01-07", summary: { accounts: [{ platform: "firstrade", account_alias: "fake-0", status: "stale", completeness: "complete", as_of: "2030-01-05T00:00:00Z", runs: [] }] } }],
    accounts: [{ platform: "firstrade", key: "fake-0", target_id: "firstrade/target0" }], date: "2030-01-08", readAt: NOW });
  assert.equal(old.tape.status, "stale");
  // Stale and incomplete: freshness never stands in for complete source coverage.
  const staleIncomplete = { platform: "firstrade", account_alias: "fake-0", status: "stale", completeness: "incomplete", as_of: "2030-01-05T00:00:00Z", runs: [] };
  const gap = ribbonTape({ days: [{ date: "2030-01-07", summary: { accounts: [staleIncomplete] } }],
    accounts: [{ platform: "firstrade", key: "fake-0", target_id: "firstrade/target0" }], date: "2030-01-08", readAt: NOW });
  assert.notEqual(gap.tape.coverage.state, "verified_empty", "an incomplete stale record is not a verified empty tape");
  assert.notEqual(gap.tape.status, "known");
  assert.notEqual(gap.tape.status, "stale");
  const gapRuns = runsToday({ targets: [{ platform: "firstrade", key: "fake-0" }], summary: { accounts: [{ ...staleIncomplete, runs: [{ id: "r", started_at: "2030-01-08T14:31:00Z", finished_at: "2030-01-08T14:32:00Z" }] }] },
    businessDate: "2030-01-08", now: NOW });
  assert.equal(gapRuns.status, "unknown", "an incomplete record does not count toward runs today");
  // Last run: only a fully read record may report "no run"; anything else stays unknown.
  const fullNoRun = { ...staleIncomplete, status: "ok", completeness: "complete", as_of: "2030-01-08T14:30:00Z" };
  assert.equal(lastRun(null, null, NOW).status, "unknown", "a failed daily read is not 'no run'");
  assert.equal(lastRun({ accounts: [] }, null, NOW).status, "unknown", "a missing record is not 'no run'");
  assert.equal(lastRun({ accounts: [staleIncomplete] }, staleIncomplete, NOW).status, "unknown", "an incomplete record is not 'no run'");
  assert.equal(lastRun({ accounts: [{ status: "read_failed" }] }, { status: "read_failed" }, NOW).reason, "read_failed");
  const verifiedNone = lastRun({ accounts: [fullNoRun] }, fullNoRun, NOW);
  assert.deepEqual([verifiedNone.status, verifiedNone.value], ["known", null], "a complete record with no finished run is a known null");
  assert.equal(freshness(old.observed, { now: NOW, ttlSeconds: 36 * 3600, staleKnown: old.stale }).data_status, "stale");
  const failedConfig = world({ config: false });
  const unreadable = await body(await deskRibbonResponse(get("/api/desk/ribbon"), failedConfig.env, failedConfig.deps));
  conforms("ribbon", unreadable);
  assert.equal(unreadable.tape.status, "unknown");
}

// ---------------------------------------------------------------- C. accounts
{
  const { deps, env } = world();
  const ok = await body(await deskAccountsResponse(get("/api/desk/accounts"), env, deps));
  conforms("accounts", ok);
  const [broker] = ok.brokers.value;
  assert.equal(broker.connectivity.reason, "not_supported");
  assert.equal(broker.heartbeat.reason, "not_supported");
  assert.equal(broker.last_order.reason, "not_supported");
  assert.equal(broker.config.state, "unknown");
  assert.equal(broker.config.drift_count.status, "unknown", "no readback: drift is unknown, never synced/0");
  assert.equal(broker.data_freshness.data_status, "ready");
  assert.deepEqual(broker.credential.expiry, { status: "unknown", reason: "not_supported" }, "no expiry source for this platform");
  assertNoPrivate(ok);
  golden("accounts", "ok", ok);

  const staleWorld = world({ accounts: [account(0, { staleHours: 40 }), account(1)], credential: null });
  const degraded = await body(await deskAccountsResponse(get("/api/desk/accounts"), staleWorld.env, staleWorld.deps));
  conforms("accounts", degraded);
  assert.equal(degraded.brokers.value[0].data_freshness.data_status, "stale");
  golden("accounts", "degraded", degraded);

  const missing = account(1); delete missing.current;
  const partWorld = world({ accounts: [account(0), missing] });
  const partialBody = await body(await deskAccountsResponse(get("/api/desk/accounts"), partWorld.env, partWorld.deps));
  conforms("accounts", partialBody);
  assert.deepEqual(partialBody.brokers.value[0].data_freshness, { data_status: "unavailable", age_seconds: null },
    "one target without a stored snapshot: no ready freshness for the broker");
  golden("accounts", "partial", partialBody);

  const none = world({ accounts: [] });
  const emptyBody = await body(await deskAccountsResponse(get("/api/desk/accounts"), none.env, none.deps));
  conforms("accounts", emptyBody);
  assert.equal(emptyBody.brokers.coverage.state, "verified_empty");
  golden("accounts", "empty", emptyBody);

  const down = world({ config: false });
  const failed = await body(await deskAccountsResponse(get("/api/desk/accounts"), down.env, down.deps));
  conforms("accounts", failed);
  assert.equal(failed.brokers.status, "unknown", "an unreadable configuration is not zero brokers");
  const disabled = world();
  const off = await body(await deskAccountsResponse(get("/api/desk/accounts"), {}, disabled.deps));
  assert.equal(off.brokers.value[0].data_freshness.data_status, "unavailable", "a disabled facts model is not fresh");
}

// ---------------------------------------------------------------- D. performance
{
  // Closed-window date table (Asia/Shanghai business dates).
  for (const [range, end, start] of [["6M", "2024-08-31", "2024-02-29"], ["6M", "2025-08-31", "2025-02-28"], ["1M", "2025-03-31", "2025-02-28"],
    ["6M", "2025-01-15", "2024-07-15"], ["3M", "2026-05-31", "2026-02-28"], ["1Y", "2024-02-29", "2023-02-28"], ["YTD", "2030-01-08", "2030-01-01"]]) {
    assert.equal(performanceWindow(range, end, null).start, start, `${range} from ${end}`);
  }
  assert.deepEqual(performanceWindow("ALL", "2030-01-08", "2029-06-01"), { start: "2029-06-01", end: "2030-01-08" });
  assert.deepEqual(performanceWindow("ALL", "2030-01-08", null), { start: null, end: "2030-01-08" });
  for (const [range, end, start] of [["1m", "2026-03-31", "2026-02-28"], ["3m", "2026-05-31", "2026-02-28"], ["1y", "2024-02-29", "2023-02-28"],
    ["ytd", "2026-05-31", "2026-01-01"], ["all", "2026-05-31", "0000-01-01"]]) assert.equal(rangeStart(range, end), start, "legacy ranges unchanged");
  assert.deepEqual(performanceQuery(new URL("https://x/api/desk/performance")), { range: "6M", scope: "all" }, "Desk default is 6M");
  for (const [query, status] of [["?scope=strategy", 422], ["?scope=strategy&target_id=firstrade%2Ftarget0", 422], ["?scope=account", 400],
    ["?range=2M", 400], ["?range=6m", 400], ["?range=6M&range=1M", 400], ["?x=1", 400], ["?target_id=firstrade%2Ftarget0", 400]]) {
    const { deps } = world();
    assert.equal((await deskPerformanceResponse(get(`/api/desk/performance${query}`), {}, deps)).status, status, query);
  }
  assert.equal(decimal(-0.0000001), "0");
  assert.equal(decimal(0.1 + 0.2), "0.3");

  // Stored history without qualified cash flows: never a return curve.
  const series = { "fake-0": ["1000", "1010", "1005", "1020"], "fake-1": ["2000", "2010", "2020", "2030"] };
  const { deps, env, calls } = world({ history: series });
  const ok = await body(await deskPerformanceResponse(get("/api/desk/performance"), env, deps));
  conforms("performance", ok);
  assert.equal(ok.range, "6M");
  assert.equal(ok.equity.status, "unknown");
  assert.equal(ok.equity.reason, "source_unavailable", "asset change is not presented as TWR");
  assert.deepEqual(ok.return_basis, { kind: "nav_change_unadjusted", per_target: { "firstrade/target0": "nav_change_unadjusted", "firstrade/target1": "nav_change_unadjusted" } });
  for (const key of ["sharpe", "sortino", "volatility_ann_ratio", "time_under_water_days", "vs_benchmark_pts"]) assert.equal(ok.risk[key].reason, "not_supported");
  for (const key of ["scorecard", "contribution", "monthly"]) assert.equal(ok[key].status, "unknown", `${key} is unknown, not []`);
  assert.equal(ok.history.retention_days, 366);
  assert.equal(ok.history.truncated_by, "inception", "4 stored days cannot claim a complete 6M window");
  assert.ok(calls.filter(call => call === "account_facts_history_read").length === 2);
  golden("performance", "ok", ok);

  // Mixed currency: no combined curve, no FX.
  const mixed = world({ accounts: [account(0), account(1, { currency: "HKD" })], history: series });
  const degraded = await body(await deskPerformanceResponse(get("/api/desk/performance?range=1M"), mixed.env, mixed.deps));
  conforms("performance", degraded);
  assert.equal(degraded.equity.reason, "mixed_currency");
  golden("performance", "degraded", degraded);

  // One cohort member unreadable: incomplete cohort, never a shrunken total.
  const half = world({ history: { "fake-0": series["fake-0"], "fake-1": "fail" } });
  const partialBody = await body(await deskPerformanceResponse(get("/api/desk/performance?range=3M"), half.env, half.deps));
  conforms("performance", partialBody);
  assert.equal(partialBody.equity.status, "unknown");
  assert.deepEqual([partialBody.equity.coverage.included, partialBody.equity.coverage.total], [1, 2]);
  assert.equal(partialBody.return_basis.kind, "mixed");
  golden("performance", "partial", partialBody);

  const none = world({ accounts: [] });
  const emptyBody = await body(await deskPerformanceResponse(get("/api/desk/performance?range=ALL"), none.env, none.deps));
  conforms("performance", emptyBody);
  assert.equal(emptyBody.history.requested_from, null);
  golden("performance", "empty", emptyBody);

  // The qualified builder: known flows, single currency, complete cohort.
  const points = (values, flows) => values.map((value, index) => ({ date: `2030-01-0${index + 1}`, value, externalFlow: flows[index], observed_at: `2030-01-0${index + 1}T21:00:00Z` }));
  const member = { target_id: "firstrade/target0", failure: null, truncated: false,
    series: [{ currency: "USD", points: points([100, 110, 99, 120], [0, 0, 0, 10]) }] };
  const q = performanceProjection({ members: [member], range: "ALL", end: "2030-01-05", now: NOW });
  assert.equal(q.equity.status, "known");
  assert.deepEqual(q.equity.value.portfolio_indexed, ["100", "110", "99", "110"], "rebased to 100, flow-adjusted");
  assert.deepEqual(q.equity.value.drawdown_ratio, ["0", "0", "-0.1", "0"]);
  assert.equal(q.risk.return_ratio.value, "0.1");
  assert.equal(q.risk.max_drawdown_ratio.value, "-0.1", "loss is non-positive");
  assert.equal(q.risk.worst_day_ratio.value, "-0.1");
  assert.equal(q.equity.observed_at, "2030-01-04T21:00:00Z", "stored observation, not generated_at");
  const gapMember = { ...member, series: [{ currency: "USD", points: points([100, 110, 99, 120], [0, 0, 0, 10]).map((p, i) => i === 2 ? { ...p, date: "2030-01-10" } : i === 3 ? { ...p, date: "2030-01-11" } : p) }] };
  const gapped = performanceProjection({ members: [gapMember], range: "ALL", end: "2030-01-12", now: NOW });
  assert.deepEqual(gapped.equity.value.gap_dates, ["2030-01-10"], "break before the observation after a gap");
  assert.equal(gapped.equity.value.gap_semantics, "break_before_observation");
  const truncated = performanceProjection({ members: [member], range: "6M", end: "2030-01-05", now: NOW });
  assert.equal(truncated.equity.status, "partial", "a window before inception is partial, never a full 6M");
  const staleQ = performanceProjection({ members: [member], range: "ALL", end: "2030-01-20", now: NOW });
  assert.equal(staleQ.equity.status, "stale");
  const unknownFlow = performanceProjection({ members: [{ ...member, series: [{ currency: "USD", points: points([100, 110, 99, 120], [0, null, 0, 0]) }] }], range: "ALL", end: "2030-01-05", now: NOW });
  assert.equal(unknownFlow.equity.status, "unknown");
  assert.equal(unknownFlow.risk.return_ratio.status, "unknown", "no UI-side fallback source exists");
}

// ---------------------------------------------------------------- E. overview
{
  const { deps, env } = world();
  const ok = await body(await deskOverviewResponse(get("/api/desk/overview"), env, deps));
  conforms("overview", ok);
  assert.equal(ok.totals.status, "complete");
  assert.equal(ok.totals.nav, "2000", "single currency, verified identities: combined NAV");
  assert.equal(ok.reporting_currency, "USD");
  assert.equal(ok.totals.runs_today.status, "partial", "no schedule source: runs are never complete");
  assert.equal(ok.totals.runs_today.value.expected, null);
  assert.equal(ok.totals.runs_today.value.source_timezone, "America/New_York");
  assert.equal(ok.totals.config_drift.status, "unknown");
  assert.equal(ok.needs_you.status, "partial", "pending decisions are not read: never a complete to-do list");
  assert.equal(ok.needs_you.value[0].kind, "credential_expiring");
  assert.equal(ok.book.value[0].config.drift_count.status, "unknown");
  assert.equal(ok.book.value[0].nav.status, "known");
  assertNoPrivate(ok);
  golden("overview", "ok", ok);

  const mixedWorld = world({ accounts: [account(0), account(1, { currency: "HKD", amount: "8000" })], credential: null });
  const degraded = await body(await deskOverviewResponse(get("/api/desk/overview"), mixedWorld.env, mixedWorld.deps));
  conforms("overview", degraded);
  assert.equal(degraded.totals.nav, null, "no server FX");
  assert.deepEqual(degraded.totals.excluded_reasons, ["fx_unavailable"]);
  assert.ok(degraded.totals.coverage.reasons.includes("mixed_currency"));
  assert.equal(degraded.reporting_currency, "USD");
  assert.equal(degraded.book.value.find(row => row.target_id === "firstrade/target1").nav.currency, "HKD", "native NAV per account");
  assert.equal(degraded.needs_you.status, "unknown");
  golden("overview", "degraded", degraded);

  const missing = account(1); delete missing.current;
  const partWorld = world({ accounts: [account(0), missing] });
  const partialBody = await body(await deskOverviewResponse(get("/api/desk/overview"), partWorld.env, partWorld.deps));
  conforms("overview", partialBody);
  assert.equal(partialBody.totals.status, "partial");
  assert.equal(partialBody.totals.nav, null, "partially known NAV is not a total");
  golden("overview", "partial", partialBody);

  const none = world({ accounts: [], credential: "not_due" });
  const emptyBody = await body(await deskOverviewResponse(get("/api/desk/overview"), none.env, none.deps));
  conforms("overview", emptyBody);
  assert.equal(emptyBody.book.coverage.state, "verified_empty");
  assert.equal(emptyBody.needs_you.status, "partial", "an empty partial list is not 'nothing to do'");
  golden("overview", "empty", emptyBody);

  const t = overviewTotals({ targets: [{ id: "firstrade/target0", platform: "firstrade", key: "fake-0", config: {} }], facts: { ok: false }, now: NOW });
  assert.equal(t.totals.status, "unavailable");
  assert.equal(runsToday({ targets: [{ platform: "firstrade", key: "fake-0" }], summary: null, businessDate: "2030-01-08", now: NOW }).status, "unknown");
}

// ---------------------------------------------------------------- E2. overview: stored data already read is projected
{
  // Per-account 30-day sparkline (frozen contract §3.3 book[].sparkline_30d) from the same
  // stored daily history the curve reads: net-asset strings oldest→newest, the history
  // series' own calendar gap dates, never interpolated, fewer than 2 points → no history.
  const series = { "fake-0": ["1000", "1010", "1005.5", "1020"], "fake-1": ["2000"] };
  const { deps, env, calls } = world({ history: series });
  const withHistory = await body(await deskOverviewResponse(get("/api/desk/overview"), env, deps));
  conforms("overview", withHistory);
  const [first, second] = withHistory.book.value;
  assert.deepEqual(first.sparkline_30d, {
    points: ["1000", "1010", "1005.5", "1020"], dates_from: "2030-01-02", dates_to: "2030-01-07", gap_dates: ["2030-01-05", "2030-01-06"],
  }, "stored net assets drawn on their own dates");
  assert.deepEqual(second.sparkline_30d, { points: [], dates_from: null, dates_to: null, gap_dates: [] }, "one stored day is not a curve");
  assert.equal(calls.filter(call => call === "account_facts_history_read").length, 2, "one stored history read per account, shared with the curve");
  assert.equal(withHistory.equity_curve.status, "unknown", "a sparkline never turns asset change into a return curve");
  assertNoPrivate(withHistory);

  const empty = { points: [], dates_from: null, dates_to: null, gap_dates: [] };
  const usd = { status: "known", currency: "USD", amount: "1020" };
  const member = (points, extra = {}) => ({ target_id: "firstrade/target0", failure: null, truncated: false,
    series: [{ currency: "USD", gapDates: [], points: points.map(([date, text]) => ({ date, text, value: Number(text) })) }], ...extra });
  const two = [["2030-01-06", "1000"], ["2030-01-07", "1001"]];
  assert.deepEqual(bookSparkline(member(two), usd, "2030-01-08").points, ["1000", "1001"]);
  assert.deepEqual(bookSparkline(member(two, { failure: "read_failed" }), usd, "2030-01-08"), empty, "an unread history draws nothing");
  assert.deepEqual(bookSparkline(member(two, { failure: "identity_unverified" }), usd, "2030-01-08"), empty, "an unverified identity draws nothing");
  assert.deepEqual(bookSparkline(null, usd, "2030-01-08"), empty, "no history read for this account");
  assert.deepEqual(bookSparkline(member(two), { status: "unknown", reason: "not_supported" }, "2030-01-08"), empty, "no NAV currency to match");
  assert.deepEqual(bookSparkline(member(two), { ...usd, currency: "HKD" }, "2030-01-08"), empty, "a different currency is never mixed in");
  const windowed = bookSparkline(member([["2029-12-01", "900"], ["2029-12-09", "950"], ["2029-12-10", "960"], ["2030-01-08", "1000"]]), usd, "2030-01-08");
  assert.deepEqual([windowed.points, windowed.dates_from, windowed.dates_to], [["960", "1000"], "2029-12-10", "2030-01-08"], "only the last 30 stored days");
  assert.deepEqual(bookSparkline(member([["2030-01-06", "1e3"], ["2030-01-07", "1001"]]), usd, "2030-01-08"), empty, "an unexpected amount text fails closed");
  const gapped = bookSparkline({ ...member(two), series: [{ currency: "USD", gapDates: ["2029-11-01", "2030-01-06"], points: [
    { date: "2030-01-05", text: "1", value: 1 }, { date: "2030-01-07", text: "2", value: 2 }] }] }, usd, "2030-01-08");
  assert.deepEqual(gapped.gap_dates, ["2030-01-06"], "gap dates are clipped to the drawn window");
  const failedHistory = world({ history: { "fake-0": "fail", "fake-1": ["2000", "2001"] } });
  const failedBody = await body(await deskOverviewResponse(get("/api/desk/overview"), failedHistory.env, failedHistory.deps));
  conforms("overview", failedBody);
  assert.deepEqual(failedBody.book.value[0].sparkline_30d, empty, "a failed history read is never drawn");
  assert.deepEqual(failedBody.book.value[1].sparkline_30d.points, ["2000", "2001"]);

  // A stored runtime-daily record that was read but is incomplete: its finished runs are
  // a verified subset (partial), and the reason is coverage, never "source unavailable".
  const incomplete = { platform: "firstrade", account_alias: "fake-0", status: "partial", completeness: "incomplete",
    unavailable_reason: "runtime_daily_incomplete", as_of: "2030-01-08T14:40:00Z",
    runs: [{ id: "r1", started_at: "2030-01-08T14:31:00Z", finished_at: "2030-01-08T14:32:00Z", activity: "no_signal", errors_present: false },
      { id: "r2", started_at: "2030-01-08T14:35:00Z", finished_at: null, activity: null, errors_present: false }] };
  const partRun = lastRun({ accounts: [incomplete] }, incomplete, NOW);
  assert.equal(partRun.status, "partial", "finished runs in an incomplete record are a verified subset");
  assert.deepEqual(partRun.value, { at: "2030-01-08T14:32:00Z", outcome: "no_op" });
  assert.deepEqual(partRun.coverage, { state: "partial", included: 0, total: 1, reasons: ["coverage_incomplete"] });
  assert.equal(partRun.observed_at, "2030-01-08T14:40:00Z", "the stored observation, never the response time");
  const staleIncompleteRun = { ...incomplete, status: "stale", unavailable_reason: "runtime_daily_stale" };
  const staleIncompleteRead = lastRun({ accounts: [staleIncompleteRun] }, staleIncompleteRun, NOW);
  assert.deepEqual([staleIncompleteRead.status, staleIncompleteRead.reason], ["unknown", "coverage_incomplete"],
    "a partial read has no age: a stale incomplete record never hides its staleness behind a run time");
  const noFinished = { ...incomplete, runs: [incomplete.runs[1]] };
  const noFinishedRun = lastRun({ accounts: [noFinished] }, noFinished, NOW);
  assert.deepEqual([noFinishedRun.status, noFinishedRun.reason], ["unknown", "coverage_incomplete"], "an incomplete record without a finished run is not 'no run'");
  const notConnected = { platform: "firstrade", account_alias: "fake-0", status: "not_connected", completeness: null, as_of: null, runs: [] };
  assert.equal(lastRun({ accounts: [notConnected] }, notConnected, NOW).reason, "source_unavailable", "no record stays source unavailable");
  const conflict = { ...notConnected, status: "partial", unavailable_reason: "runtime_daily_binding_conflict" };
  assert.equal(lastRun({ accounts: [conflict] }, conflict, NOW).reason, "source_unavailable", "an unread conflicting binding is not a coverage read");
  const target = [{ platform: "firstrade", key: "fake-0" }];
  const runsIncomplete = runsToday({ targets: target, summary: { accounts: [incomplete] }, businessDate: "2030-01-08", now: NOW });
  assert.deepEqual([runsIncomplete.status, runsIncomplete.reason], ["unknown", "coverage_incomplete"], "runs today: an incomplete record is a coverage gap");
  assert.equal(runsToday({ targets: target, summary: { accounts: [notConnected] }, businessDate: "2030-01-08", now: NOW }).reason, "source_unavailable");
  const tapeAccounts = [{ platform: "firstrade", key: "fake-0", target_id: "firstrade/target0" }];
  const incompleteTape = ribbonTape({ days: [{ date: "2030-01-07", summary: { accounts: [{ ...incomplete, runs: [] }] } }], accounts: tapeAccounts, date: "2030-01-08", readAt: NOW });
  assert.deepEqual([incompleteTape.tape.status, incompleteTape.tape.reason], ["unknown", "coverage_incomplete"], "tape: read but incomplete is a coverage gap");
  const missingTape = ribbonTape({ days: [{ date: "2030-01-07", summary: { accounts: [notConnected] } }], accounts: tapeAccounts, date: "2030-01-08", readAt: NOW });
  assert.equal(missingTape.tape.reason, "source_unavailable");

  // Overview end-to-end with an incomplete record for one account.
  const mixedRuns = world({ summaries: { "2030-01-08": { date: "2030-01-08", accounts: [incomplete,
    { ...summaryFor([account(1)], "2030-01-08").accounts[0] }] } } });
  const mixedBody = await body(await deskOverviewResponse(get("/api/desk/overview"), mixedRuns.env, mixedRuns.deps));
  conforms("overview", mixedBody);
  assert.equal(mixedBody.book.value[0].last_run.status, "partial");
  assert.equal(mixedBody.book.value[1].last_run.status, "known");
  assert.deepEqual([mixedBody.totals.runs_today.value.done, mixedBody.totals.runs_today.coverage.included], [1, 1], "runs today still counts complete records only");
}

// ---------------------------------------------------------------- S2 corrections: coverage, failures, observation time
{
  const tapeAccounts = [{ platform: "firstrade", key: "fake-0", target_id: "firstrade/target0" }];
  const day = (accounts, date = "2030-01-07") => [{ date, summary: { accounts } }];
  // F1: a missing record on a weekend is not a verified-empty tape.
  const weekendMissing = { platform: "firstrade", account_alias: "fake-0", status: "no_data", unavailable_reason: "non_trading_weekend",
    completeness: null, as_of: null, runs: [] };
  const weekendTape = ribbonTape({ days: day([weekendMissing], "2030-01-05"), accounts: tapeAccounts, date: "2030-01-05", readAt: NOW });
  assert.notEqual(weekendTape.tape.status, "known", "a weekend without a record is not a known tape");
  assert.notEqual(weekendTape.tape.coverage.state, "verified_empty", "a weekend does not prove that nothing ran");
  assert.deepEqual([weekendTape.tape.status, weekendTape.tape.reason, weekendTape.tape.coverage.included], ["unknown", "source_unavailable", 0]);
  const weekendRuns = runsToday({ targets: [{ platform: "firstrade", key: "fake-0" }], summary: { accounts: [weekendMissing] }, businessDate: "2030-01-05", now: NOW });
  assert.equal(weekendRuns.status, "unknown", "no weekend zero runs");

  // #3: a summary of only failed rows stays read_failed, never source_unavailable or empty.
  const failedRow = (key) => ({ platform: "firstrade", account_alias: key, status: "read_failed", unavailable_reason: "stored_records_unreadable",
    completeness: null, as_of: null, runs: [] });
  const targets2 = [{ platform: "firstrade", key: "fake-0" }, { platform: "firstrade", key: "fake-1" }];
  const failedOnly = runsToday({ targets: targets2, summary: { accounts: [failedRow("fake-0"), failedRow("fake-1")] }, businessDate: "2030-01-08", now: NOW });
  assert.deepEqual([failedOnly.status, failedOnly.reason, failedOnly.coverage.reasons], ["unknown", "read_failed", ["read_failed"]]);
  assert.notEqual(failedOnly.coverage.state, "verified_empty");
  const covered = summaryFor([account(1)], "2030-01-08").accounts[0];
  const mixedFail = runsToday({ targets: targets2, summary: { accounts: [failedRow("fake-0"), covered] }, businessDate: "2030-01-08", now: NOW });
  assert.equal(mixedFail.status, "partial");
  assert.deepEqual([mixedFail.value.done, mixedFail.value.expected, mixedFail.value.pending], [1, null, null], "no invented totals");
  assert.ok(mixedFail.coverage.reasons.includes("read_failed") && mixedFail.coverage.reasons.includes("coverage_incomplete"));
  const failedTape = ribbonTape({ days: day([failedRow("fake-0")]), accounts: tapeAccounts, date: "2030-01-08", readAt: NOW });
  assert.deepEqual([failedTape.tape.status, failedTape.tape.reason], ["unknown", "read_failed"]);

  // #23: a stale incomplete record keeps its stored observation; the request time is never substituted.
  const staleIncomplete = { platform: "firstrade", account_alias: "fake-0", status: "stale", completeness: "incomplete",
    unavailable_reason: "runtime_daily_stale", as_of: "2030-01-08T03:00:00Z",
    runs: [{ id: "early", started_at: "2030-01-08T01:00:00Z", finished_at: "2030-01-08T01:05:00Z", activity: "no_signal", errors_present: false }] };
  const historical = ribbonTape({ days: day([staleIncomplete]), accounts: tapeAccounts, date: "2030-01-08", readAt: NOW });
  assert.equal(historical.tape.status, "partial");
  assert.equal(historical.tape.observed_at, "2030-01-08T03:00:00Z", "the stored observation, not the request time");
  assert.notEqual(historical.tape.observed_at, utcInstant(NOW));
  assert.deepEqual(historical.observed, ["2030-01-08T03:00:00Z"], "freshness keeps the stale incomplete record's observation");
  assert.deepEqual(freshness(historical.observed, { now: NOW, ttlSeconds: 36 * 3600, staleKnown: historical.stale }), { data_status: "stale", age_seconds: 43200 });
  // Mixed coverage: one complete, one stale incomplete: oldest stored observation of both.
  const twoAccounts = [...tapeAccounts, { platform: "firstrade", key: "fake-1", target_id: "firstrade/target1" }];
  const mixedTape = ribbonTape({ days: day([staleIncomplete, { ...covered, as_of: "2030-01-08T14:30:00Z" }]), accounts: twoAccounts, date: "2030-01-08", readAt: NOW });
  assert.deepEqual([mixedTape.tape.status, mixedTape.tape.coverage.included, mixedTape.tape.coverage.total], ["partial", 1, 2]);
  assert.equal(mixedTape.tape.observed_at, "2030-01-08T03:00:00Z");
  // A covered record without a usable observation instant has no time basis, never "now".
  const noInstant = ribbonTape({ days: day([{ ...covered, account_alias: "fake-0", as_of: "not-an-instant", runs: [] }]), accounts: tapeAccounts, date: "2030-01-08", readAt: NOW });
  assert.deepEqual([noInstant.tape.status, noInstant.tape.reason], ["unknown", "time_basis_unavailable"]);

  // F3: when every displayed fact is stale, Overview freshness keeps their age; totals are not upgraded.
  const allStale = world({ accounts: [account(0, { staleHours: 40 }), account(1, { staleHours: 50 })] });
  const allStaleBody = await body(await deskOverviewResponse(get("/api/desk/overview"), allStale.env, allStale.deps));
  conforms("overview", allStaleBody);
  assert.equal(allStaleBody.freshness.data_status, "stale");
  assert.equal(allStaleBody.freshness.age_seconds, 50 * 3600 + 120, "the oldest stored observation's age");
  assert.equal(allStaleBody.totals.data_age_seconds, allStaleBody.freshness.age_seconds);
  assert.deepEqual([allStaleBody.totals.status, allStaleBody.totals.nav], ["unavailable", null], "stale facts never make a total");
  assert.ok(allStaleBody.book.value.every(row => row.nav.status === "stale" && Number.isInteger(row.nav.age_seconds)), "stale NAV keeps its age");
  const mixedAge = world({ accounts: [account(0, { staleHours: 40 }), account(1)] });
  const mixedAgeBody = await body(await deskOverviewResponse(get("/api/desk/overview"), mixedAge.env, mixedAge.deps));
  conforms("overview", mixedAgeBody);
  assert.deepEqual([mixedAgeBody.freshness.data_status, mixedAgeBody.freshness.age_seconds], ["stale", 40 * 3600 + 120]);
  assert.deepEqual([mixedAgeBody.totals.status, mixedAgeBody.totals.nav], ["partial", null], "partial facts are never a total");
}

// ---------------------------------------------------------------- S2 #6: next scheduled observation (option 1/1a)
{
  const today = "2030-01-08";
  const accts = [{ platform: "firstrade", key: "fake-0", target_id: "firstrade/target0" }, { platform: "firstrade", key: "fake-1", target_id: "firstrade/target1" }];
  const schedule = (next_due_at, extra = {}) => ({ state: "not_due", business_date: today, timezone: "America/New_York", next_due_at, ...extra });
  const row = (key, next, extra = {}) => ({ platform: "firstrade", account_alias: key, status: "ok", completeness: "complete", unavailable_reason: null,
    as_of: "2030-01-08T14:30:00Z", read_error_codes: [], runs: [], schedule: typeof next === "object" && next !== null ? next : schedule(next), ...extra });
  const next = (rows) => nextScheduledRun({ summary: { accounts: rows }, accounts: accts, businessDate: today, now: NOW });
  // Every account has a future candidate: known earliest, with the oldest stored observation.
  const both = next([row("fake-0", "2030-01-08T20:55:00Z"), row("fake-1", "2030-01-08T19:30:00Z", { as_of: "2030-01-08T14:00:00Z" })]);
  assert.deepEqual([both.status, both.value, both.observed_at, both.coverage.state], ["known",
    { target_id: "firstrade/target1", kind: "scheduled_run", due_at: "2030-01-08T19:30:00Z" }, "2030-01-08T14:00:00Z", "complete"]);
  // An offset is honoured: 14:20-05:00 is 19:20Z, earlier than 19:30Z.
  const offset = next([row("fake-0", "2030-01-08T14:20:00-05:00"), row("fake-1", "2030-01-08T19:30:00Z")]);
  assert.deepEqual([offset.value.target_id, offset.value.due_at], ["firstrade/target0", "2030-01-08T19:20:00Z"]);
  // A time already past at request time is not an upcoming run (valid for its observation, expired now).
  const expired = next([row("fake-0", "2030-01-08T14:45:00Z"), row("fake-1", "2030-01-08T19:30:00Z")]);
  assert.equal(expired.status, "partial", "an expired candidate leaves coverage incomplete");
  assert.deepEqual([expired.value.target_id, expired.coverage.included, expired.coverage.total], ["firstrade/target1", 1, 2]);
  const exactlyNow = next([row("fake-0", utcInstant(NOW)), row("fake-1", utcInstant(NOW))]);
  assert.deepEqual([exactlyNow.status, exactlyNow.reason], ["unknown", "source_unavailable"], "due exactly now is not upcoming");
  // Partial account coverage: earliest observed candidate, partial, never known.
  const half = next([row("fake-0", "2030-01-08T20:55:00Z")]);
  assert.deepEqual([half.status, half.coverage.state, half.coverage.reasons], ["partial", "partial", ["coverage_incomplete"]]);
  // Stale complete records: stale with their age.
  const staleBoth = next([row("fake-0", "2030-01-08T20:55:00Z", { status: "stale", as_of: "2030-01-07T00:00:00Z" }), row("fake-1", "2030-01-08T19:30:00Z")]);
  assert.deepEqual([staleBoth.status, staleBoth.age_seconds, staleBoth.observed_at], ["stale", 54000 + 86400, "2030-01-07T00:00:00Z"]);
  // Missing, null, conflicting, disabled, unevaluable, schedule-unverified, wrong day: unknown, never "no run".
  const cases = {
    "null next due": [row("fake-0", null), row("fake-1", null)],
    "no schedule field (legacy summary)": [row("fake-0", null, { schedule: undefined }), row("fake-1", null, { schedule: null })],
    "unevaluable": [row("fake-0", schedule("2030-01-08T20:55:00Z", { state: "unevaluable" })), row("fake-1", schedule("2030-01-08T20:55:00Z", { state: "unevaluable" }))],
    "schedule unverified": [row("fake-0", "2030-01-08T20:55:00Z", { read_error_codes: ["schedule_unverified"] }), row("fake-1", "2030-01-08T20:55:00Z", { read_error_codes: ["target_disabled"] })],
    "binding conflict": [row("fake-0", "2030-01-08T20:55:00Z", { status: "partial", completeness: null, unavailable_reason: "runtime_daily_binding_conflict", as_of: null }),
      row("fake-1", "2030-01-08T20:55:00Z", { status: "not_connected", completeness: null, as_of: null })],
    "duplicate rows": [row("fake-0", "2030-01-08T20:55:00Z"), row("fake-0", "2030-01-08T21:55:00Z"), row("fake-1", "2030-01-08T20:55:00Z", { status: "no_data", completeness: null, as_of: null })],
    "previous NY business day": [row("fake-0", schedule("2030-01-08T20:55:00Z", { business_date: "2030-01-07" })), row("fake-1", schedule("2030-01-08T20:55:00Z", { timezone: "UTC" }))],
    "unparseable instant": [row("fake-0", "2030-01-08T20:55:00"), row("fake-1", "tomorrow")],
  };
  // Review B1: instants keep nonzero milliseconds, so ordering is chronological, never lexical.
  // "19:30:00.500Z" sorts before "19:30:00Z" as a string but is the later instant.
  for (const rows of [[row("fake-0", "2030-01-08T19:30:00Z"), row("fake-1", "2030-01-08T19:30:00.500Z")],
    [row("fake-1", "2030-01-08T19:30:00.500Z"), row("fake-0", "2030-01-08T19:30:00Z")]]) {
    const whole = next(rows);
    assert.deepEqual([whole.status, whole.value], ["known", { target_id: "firstrade/target0", kind: "scheduled_run", due_at: "2030-01-08T19:30:00Z" }],
      "known: the whole second beats the later fractional instant regardless of row order");
  }
  const fractionalFirst = next([row("fake-0", "2030-01-08T19:30:00.500Z"), row("fake-1", "2030-01-08T19:30:00.250Z")]);
  assert.deepEqual([fractionalFirst.value.target_id, fractionalFirst.value.due_at], ["firstrade/target1", "2030-01-08T19:30:00.250Z"]);
  const accts3 = [...accts, { platform: "firstrade", key: "fake-2", target_id: "firstrade/target2" }];
  const partialFraction = nextScheduledRun({ summary: { accounts: [row("fake-0", "2030-01-08T19:30:00Z"), row("fake-1", "2030-01-08T19:30:00.500Z")] },
    accounts: accts3, businessDate: today, now: NOW });
  assert.deepEqual([partialFraction.status, partialFraction.value.target_id, partialFraction.value.due_at, partialFraction.coverage.included, partialFraction.coverage.total],
    ["partial", "firstrade/target0", "2030-01-08T19:30:00Z", 2, 3], "partial: the same chronological earliest candidate");
  // Equal instants, however written, fall back to the target id only then.
  const tie = next([row("fake-1", "2030-01-08T19:30:00.000Z"), row("fake-0", "2030-01-08T14:30:00-05:00")]);
  assert.deepEqual([tie.status, tie.value.target_id, tie.value.due_at], ["known", "firstrade/target0", "2030-01-08T19:30:00Z"]);
  const fractionTie = next([row("fake-1", "2030-01-08T19:30:00.500Z"), row("fake-0", "2030-01-08T14:30:00.5-05:00")]);
  assert.deepEqual([fractionTie.value.target_id, fractionTie.value.due_at], ["firstrade/target0", "2030-01-08T19:30:00.500Z"]);
  // A fractional offset instant is still normalized to UTC before ordering.
  const fractionOffset = next([row("fake-0", "2030-01-08T14:29:59.750-05:00"), row("fake-1", "2030-01-08T19:30:00Z")]);
  assert.deepEqual([fractionOffset.value.target_id, fractionOffset.value.due_at], ["firstrade/target0", "2030-01-08T19:29:59.750Z"]);
  // Past-time rejection keeps millisecond precision at the request instant.
  const subSecond = next([row("fake-0", "2030-01-08T14:59:59.999Z"), row("fake-1", "2030-01-08T15:00:00.001Z")]);
  assert.deepEqual([subSecond.status, subSecond.value.target_id, subSecond.value.due_at, subSecond.coverage.included], ["partial", "firstrade/target1", "2030-01-08T15:00:00.001Z", 1]);
  // The oldest stored observation is chosen chronologically too.
  const oldest = next([row("fake-0", "2030-01-08T20:55:00Z", { as_of: "2030-01-08T14:00:00.500Z" }), row("fake-1", "2030-01-08T19:30:00Z", { as_of: "2030-01-08T14:00:00Z" })]);
  assert.deepEqual([oldest.status, oldest.observed_at], ["known", "2030-01-08T14:00:00Z"]);
  const oldestFraction = next([row("fake-0", "2030-01-08T20:55:00Z", { as_of: "2030-01-08T14:00:00Z" }), row("fake-1", "2030-01-08T19:30:00Z", { as_of: "2030-01-08T13:59:59.900Z" })]);
  assert.equal(oldestFraction.observed_at, "2030-01-08T13:59:59.900Z");
  for (const [label, rows] of Object.entries(cases)) {
    const read = next(rows);
    assert.equal(read.status, "unknown", `${label}: unknown`);
    assert.equal("value" in read, false, `${label}: an unknown read carries no value, so no "no next run"`);
    assert.notEqual(read.coverage.state, "verified_empty", `${label}: null never proves no future run`);
  }
  const incompleteRows = [row("fake-0", "2030-01-08T20:55:00Z", { status: "partial", completeness: "incomplete" }), row("fake-1", "2030-01-08T20:55:00Z", { status: "partial", completeness: "incomplete" })];
  assert.equal(next(incompleteRows).reason, "coverage_incomplete", "an incomplete record's schedule is not trusted");
  assert.equal(next([{ ...row("fake-0", null), status: "read_failed" }, row("fake-1", null)]).reason, "read_failed");
  assert.equal(nextScheduledRun({ summary: null, accounts: accts, businessDate: today, now: NOW }).reason, "read_failed");

  // Route: only today's NY business-day read opts in; the same number of reads is made.
  const scheduled = { date: today, accounts: [row("fake-0", "2030-01-08T20:55:00Z"), row("fake-1", "2030-01-08T19:30:00Z")] };
  const scheduledWorld = world({ summaries: { [today]: scheduled } });
  const ribbon = await body(await deskRibbonResponse(get("/api/desk/ribbon"), scheduledWorld.env, scheduledWorld.deps));
  conforms("ribbon", ribbon);
  assert.deepEqual([ribbon.next_run.status, ribbon.next_run.value.due_at, ribbon.next_run.value.target_id], ["known", "2030-01-08T19:30:00Z", "firstrade/target1"]);
  assert.deepEqual(scheduledWorld.calls.filter(call => /^(runtime|options):/.test(call)),
    ["runtime:2030-01-07", "runtime:2030-01-08", 'options:2030-01-08:{"schedule":true}'], "one read per business day; only today opts in");
  const partialWorld = world({ summaries: { [today]: { date: today, accounts: [row("fake-0", "2030-01-08T20:55:00Z")] } } });
  const partialRibbon = await body(await deskRibbonResponse(get("/api/desk/ribbon"), partialWorld.env, partialWorld.deps));
  conforms("ribbon", partialRibbon);
  assert.equal(partialRibbon.next_run.status, "partial");
  // Route, B1: the fractional-second case keeps one read per business day and the chronological earliest.
  const fractionalWorld = world({ summaries: { [today]: { date: today, accounts: [row("fake-0", "2030-01-08T19:30:00Z"), row("fake-1", "2030-01-08T19:30:00.500Z")] } } });
  const fractionalRibbon = await body(await deskRibbonResponse(get("/api/desk/ribbon"), fractionalWorld.env, fractionalWorld.deps));
  conforms("ribbon", fractionalRibbon);
  assert.deepEqual([fractionalRibbon.next_run.status, fractionalRibbon.next_run.value.due_at, fractionalRibbon.next_run.value.target_id], ["known", "2030-01-08T19:30:00Z", "firstrade/target0"]);
  assert.deepEqual(fractionalWorld.calls.filter(call => /^(runtime|options):/.test(call)),
    ["runtime:2030-01-07", "runtime:2030-01-08", 'options:2030-01-08:{"schedule":true}'], "fractional instants add no read");
  const pastWorld = world({ summaries: { [today]: scheduled } });
  const pastDay = await body(await deskRibbonResponse(get("/api/desk/ribbon?date=2030-01-06"), pastWorld.env, pastWorld.deps));
  conforms("ribbon", pastDay);
  assert.equal(pastDay.next_run.status, "unknown", "a past UTC day does not read today's schedule");
  assert.equal(pastWorld.calls.some(call => call.startsWith("options:")), false, "and makes no opt-in read");
  // Overview counts stay unknown: neighbouring schedule instants are not a full-day count.
  const overviewWorld = world({ summaries: { [today]: scheduled } });
  const overview = await body(await deskOverviewResponse(get("/api/desk/overview"), overviewWorld.env, overviewWorld.deps));
  assert.deepEqual([overview.totals.runs_today.value.expected, overview.totals.runs_today.value.pending], [null, null]);
  assert.equal(overviewWorld.calls.some(call => call.startsWith("options:")), false, "overview does not opt in");
  // Worker deps pass the opt-in through to the existing reader; the default output is unchanged.
  const workerDeps = __test.deskN1Deps();
  const req = get("/api/desk/ribbon");
  const optedIn = await workerDeps.runtimeDay(req, {}, [{ platform: "firstrade", key: "fake-0" }], today, { schedule: true });
  const legacy = await workerDeps.runtimeDay(req, {}, [{ platform: "firstrade", key: "fake-0" }], today);
  assert.equal(optedIn.accounts[0].schedule, null, "no record read: schedule is null, not invented");
  assert.equal("schedule" in legacy.accounts[0], false, "legacy summary unchanged without the opt-in");
}

// ---------------------------------------------------------------- worker-level: exact routes, read allowlist, zero writes
{
  const accts = [account(0), account(1)];
  const actions = [];
  let kvPuts = 0;
  const kv = {
    async get(key) { return key === "account_facts_bindings" ? JSON.stringify({ schema_version: "qsl_account_facts_bindings.v1", bindings: accts.map(a => a.binding) }) : null; },
    async put() { kvPuts += 1; throw Error("no writes"); }, async delete() { kvPuts += 1; throw Error("no writes"); }, async list() { return { keys: [] }; },
  };
  const runtime = {
    idFromName: name => name,
    get: () => ({ async fetch(url, init = {}) {
      if (!init.body) return Response.json({ initialized: true, account_options: { firstrade: accts.map(a => a.option) }, revision: 3 });
      const command = JSON.parse(init.body);
      actions.push(command.action);
      if (command.action === "account_facts_list") return Response.json({ observations: accts.map(a => ({ platform: "firstrade", account_key: a.key, payload: a.current })) });
      if (command.action === "account_facts_history_read") return Response.json({ ok: true, days: historyDays(accts.find(a => a.key === command.account_key), ["1000", "1001"]) });
      if (command.action === "credential_maintenance_read") return Response.json({ id: "ibkr_flex", expires_at: null, phase: "unknown" });
      return Response.json({ error: "not_allowed_in_test" }, { status: 500 });
    } }),
  };
  const env = { SESSION_SECRET: "fake-desk-session", ALLOWED_GITHUB_LOGINS: "fake-reader", ACCOUNT_FACTS_READ_MODEL_ENABLED: "true",
    STRATEGY_SWITCH_CONFIG: kv, STRATEGY_SWITCH_RUNTIME_INSTANCES: runtime };
  const cookie = await __test.makeSession("fake-reader", [], env);
  const headers = { Cookie: `qsl_switch_session=${cookie}` };
  const realFetch = globalThis.fetch;
  let outbound = 0;
  globalThis.fetch = async () => { outbound += 1; throw Error("no provider or network call"); };
  try {
    const paths = { ribbon: "/api/desk/ribbon", overview: "/api/desk/overview", accounts: "/api/desk/accounts",
      performance: "/api/desk/performance", "switch-strategies": "/api/desk/switch/targets/firstrade%2Ftarget0/strategies" };
    for (const [name, path] of Object.entries(paths)) {
      const response = await worker.fetch(get(path, { headers }), env, { waitUntil() {} });
      const payload = await body(response);
      assert.equal(payload.schema_version, `qsl.desk.${name.replace("-", "_")}.v2`, `${path} routes to the N1 handler`);
      conforms(name, payload);
      assertNoPrivate(payload);
      assert.equal((await worker.fetch(get(path), env, { waitUntil() {} })).status, 401, `${path} requires a session`);
      assert.equal((await worker.fetch(get(path, { method: "POST", headers }), env, { waitUntil() {} })).status, 404, `${path} is GET only`);
    }
    // Exact matching: neighbouring desk routes keep their own handlers and versions.
    const targets = await (await worker.fetch(get("/api/desk/switch/targets", { headers }), env, { waitUntil() {} })).json();
    assert.equal(targets.schema_version, "qsl.desk.switch_targets.v1");
    const trailing = await worker.fetch(get("/api/desk/ribbon/", { headers }), env, { waitUntil() {} });
    assert.notEqual(trailing.headers.get("Content-Type")?.includes("json") && (await trailing.clone().json().catch(() => ({}))).schema_version, "qsl.desk.ribbon.v2");
    // The read wrapper refuses everything outside the named allowlist before any transport.
    const before = actions.length;
    for (const action of ["account_facts_put", "account_facts_history_put", "desk_readback_start", "credential_maintenance_save", "account_period_return_read"]) {
      await assert.rejects(__test.deskN1ReadCommand(env, { action }), /desk_read_command_not_allowed/);
    }
    assert.equal(actions.length, before, "a refused command never reaches the store");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual([...new Set(actions)].sort(), ["account_facts_history_read", "account_facts_list", "credential_maintenance_read"]);
  assert.equal(kvPuts, 0, "zero config-store writes");
  assert.equal(outbound, 0, "zero outbound provider/collector fetches");
  assert.deepEqual([...__test.DESK_N1_READ_COMMANDS], ["account_facts_list", "account_facts_history_read", "credential_maintenance_read"]);
}

// The frozen v1 contract stays byte-for-byte recoverable from its indented copy.
{
  const frozen = readFileSync(new URL("../docs/desk-api-contract-v1-frozen.md", import.meta.url), "utf8");
  const start = frozen.indexOf("checks.\n\n") + "checks.\n\n".length;
  const recovered = frozen.slice(start).split(/(?<=\n)/).map(line => (line.trim() ? line.slice(4) : line)).join("");
  assert.equal(createHash("sha256").update(recovered, "utf8").digest("hex"),
    "45e5b9f79ad623425becc6b506b6b082086f2e98a905a6c7e7193cab948a91fe", "frozen v1 contract bytes changed");
}

console.log("Desk N1 projection validation passed: five read routes, golden payloads, read allowlist and zero writes");
