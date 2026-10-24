import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __test } from "../web/strategy-switch-console/worker.js";
import { todaySummary, strategySummary } from "../web/strategy-switch-console/application/console_api/operations.js";
import { performanceBlocks } from "../web/strategy-switch-console/application/console_api/performance.js";
import { settingsDiff } from "../web/strategy-switch-console/application/console_api/presentation.js";
import { consoleApiResponse, inbox } from "../web/strategy-switch-console/application/console_api/routes.js";
import { runControls } from "../web/strategy-switch-console/application/console_api/run_controls.js";
import { m0Subjects, mixedReturns, healthStates, controls, controlReasons, quotaDirectory, quotaInbox, runtimeRecords } from "./fixtures/console-gaps.ts";
import { validate } from "./console_api_contract_validation.mjs";

const request = new Request("https://synthetic.invalid/api/runtime/today");
const projected = __test.projectM0ResearchDashboardForRead({
  generated_at: m0Subjects.source_generated_at, computed_at: m0Subjects.source_computed_at,
  subjects: m0Subjects.subjects, policy: m0Subjects.policy, errors: [],
}, m0Subjects.source_ledger_sha256, new Date(m0Subjects.viewed_at));
assert.deepEqual(projected, m0Subjects, "12 subjects and nested observations match the existing M0 projection");
assert.equal(projected.subjects.flatMap(s => s.observations).length, 12);
assert.ok(projected.subjects.every(s => s.observations.every(o => o.research_context.state === "context_only")));
assert.ok(!Object.hasOwn(projected, "items"), "do not invent an alternative research endpoint/shape");
const expired = __test.projectM0ResearchDashboardForRead({ subjects: projected.subjects, policy: projected.policy, errors: [] },
  "a".repeat(64), new Date("2026-10-18T00:00:00Z"));
assert.equal(expired.data_status, "stale");
assert.equal(expired.summary.fresh_observation_count, 0);

validate("returns", mixedReturns);
validate("strategy_summary", healthStates);
validate("run_controls", controls);
validate("directory_status", quotaDirectory);
validate("inbox", quotaInbox);
const blocks = performanceBlocks({ accounts: [], today: "2026-10-16", year: 2026, month: 10,
  histories: [{ id: "synthetic-usd-a", currency: "USD", points: [{ date: "2026-10-01", value: 100 }] },
    { id: "synthetic-usd-b", currency: "USD", points: [{ date: "2026-10-02", value: 200 }] },
    { id: "synthetic-usdt", currency: "USDT", points: mixedReturns.per_currency[1].points.map(p => ({ ...p, value: 100 * (1 + p.value / 100), externalFlow: null })) }] });
assert.equal(blocks.returns.unavailable_reason, "mixed_currency");
assert.equal(blocks.returns.per_currency.find(e => e.currency === "USDT").points.length, 0, "unknown deposits do not become a return curve");
assert.equal(blocks.assets.history_per_currency.find(e => e.currency === "USDT").points.length, 7);
const usdReturn = blocks.returns.per_currency.find(e => e.currency === "USD");
assert.deepEqual(usdReturn.points, []);
const usdHistory = blocks.assets.history_per_currency.find(e => e.currency === "USD");
assert.deepEqual(usdHistory.points.map(p => p.date), ["2026-10-01", "2026-10-02"]);
assert.ok(usdHistory.points.every(p => p.partial));
assert.deepEqual(usdHistory.points[0].missing_accounts, ["synthetic-usd-b"]);
assert.deepEqual(usdHistory.points[1].forward_filled_accounts, ["synthetic-usd-a"]);
assert.equal(usdHistory.coverage.omitted_dates, 0);
assert.equal(usdReturn.return_kind, "unadjusted_asset_ratio");
assert.deepEqual(blocks.assets.history_per_currency.find(e => e.currency === "USD").points.map(p => p.value), [100, 300]);
assert.equal(blocks.summary.twr_return_percent, null);
assert.equal(blocks.summary.max_drawdown.percent, null);
assert.equal(blocks.summary.amount, null, "USD and USDT cannot form a combined amount");

// Ten synthetic account identities, including four IBKR aliases and two brokers with the same live alias.
const accounts = [
  ...["alpha", "beta", "gamma", "delta"].map(key => ({ key: `synthetic-${key}`, platform: "ibkr" })),
  ...["paper", "live", "hk"].map(key => ({ key: `synthetic-${key}`, platform: "longbridge" })),
  { key: "live", platform: "schwab" }, { key: "live", platform: "firstrade" }, { key: "synthetic-wallet", platform: "binance" },
].map((a, i) => ({ ...a, default_strategy_profile: `synthetic-old-${i}` }));
const current = Object.fromEntries([...new Set(accounts.map(a => a.platform))].map(platform => [platform,
  Object.fromEntries(accounts.filter(a => a.platform === platform).map(a => [a.key, { strategy_profile: `synthetic-current-${accounts.indexOf(a)}` }]))]));
const strategyDeps = { profiles: async () => accounts.map((_, i) => ({ profile: `synthetic-current-${i}`, domain: "us_equity" })),
  health: async () => Response.json({ data_status: "ready", strategies: [] }) };
const summary = await strategySummary(request, {}, strategyDeps, accounts, current);
validate("strategy_summary", summary);
const refs = summary.strategies.flatMap(s => s.configured_accounts.map(a => a.account_ref));
assert.equal(refs.length, 10);
assert.equal(new Set(refs).size, 10);
assert.equal(refs.filter(r => r.startsWith("ibkr:")).length, 4);
assert.ok(refs.includes("schwab:live") && refs.includes("firstrade:live"));
assert.equal(summary.account_assignment_status, "complete");
const missing = await strategySummary(request, {}, strategyDeps, accounts, {});
assert.equal(missing.account_assignment_status, "unavailable");
assert.equal(missing.strategies.flatMap(s => s.configured_accounts).length, 0, "defaults cannot substitute for missing current identity");
for (const status of ["review", "watch", "critical"]) {
  const observed = await strategySummary(request, {}, { ...strategyDeps, health: async () => Response.json({ data_status: "ready",
    strategies: [{ profile: "synthetic-current-0", status, score: 50 }] }) }, accounts, current);
  assert.equal(observed.strategies[0].health_status, status);
}

const holdings = performanceBlocks({ accounts: accounts.map(a => ({ account_key: a.key, platform: a.platform })),
  histories: [], today: "2026-10-16", year: 2026, month: 10 }).holdings;
assert.equal(new Set(holdings.coverage.map(a => a.account_ref)).size, 10);
assert.equal(holdings.rows.length, 0);
assert.ok(holdings.coverage.every(a => a.scope === "not_connected"));
const legacyHoldings = performanceBlocks({ accounts: [{ account_key: "synthetic-legacy" }], histories: [],
  today: "2026-10-16", year: 2026, month: 10 }).holdings;
assert.deepEqual(legacyHoldings.coverage, [{ account_alias: "synthetic-legacy", scope: "not_connected" }]);

for (const body of runtimeRecords) {
  const today = await todaySummary(request, {}, { dailyBindings: async () => [{ platform: body.platform, account_key: body.account_key,
    status: "bound", target_key: body.record.target_key }], daily: async () => Response.json(body) },
  [{ platform: body.platform, key: body.account_key }], Date.parse("2026-10-15T22:00:00Z"));
  assert.equal(today.date, body.date);
  assert.equal(today.accounts[0].activity, body.record.status);
  assert.equal(today.accounts[0].runs[0].activity, body.record.runs[0].activity);
  assert.equal(today.accounts[0].status, "partial");
  assert.equal(today.counts.runs, null, "blocked or incomplete observations cannot certify a zero-failure total");
}
for (const effective of [{}, { reserved_cash_floor: { status: "unknown", value: "0" } },
  { income_layer_enabled: { status: "unknown", value: false } }]) {
  const rows = settingsDiff({ draft: { overrides: {} }, effective });
  assert.ok(rows.every(r => r.current_status === "unknown" && r.current === null && r.draft === null));
}
const known = settingsDiff({ effective: { income_layer_enabled: { status: "known", value: false },
  reserved_cash_floor: { status: "known", value: "0" } } });
assert.equal(known.find(r => r.field === "income_layer_enabled").current, false);
assert.equal(known.find(r => r.field === "reserved_cash_floor").current, "0");

const empty = async () => Response.json({ data_status: "ready" });
const quota = async () => Response.json({ data_status: "unavailable", errors: ["kv_list_daily_limit_exceeded"] });
const queue = await inbox(request, {}, { owner: quota, promotion: quota, recovery: quota, credential: empty });
assert.equal(queue.status, "read_failed");
assert.equal(queue.items.length, 0);
assert.ok(queue.sources.slice(0, 3).every(s => s.status === "read_failed"));
const history = await consoleApiResponse(new Request("https://synthetic.invalid/api/account-settings/history?platform=schwab&account=live"), {}, {
  json: (b, s = 200) => Response.json(b, { status: s }), readSession: async () => ({ allowed: true, login: "synthetic-reader" }),
  accountOptions: async () => ({ options: { schwab: [{ key: "live" }] } }),
  command: async () => ({ approvals: [] }), audit: async () => [],
});
const historyBody = await history.json();
validate("settings_history", historyBody);
assert.equal(historyBody.status, "partial");
assert.equal(historyBody.items.length, 0);
assert.equal(historyBody.availability.effect_verification.unavailable_reason, "effect_verification_not_recorded");

for (const reason of controlReasons.filter(r => r !== "available")) {
  const result = await runControls({ key: "synthetic-paper", platform: "longbridge" }, { admin: true }, {
    dispatchAvailable: false, profileState: async () => ({ reason }),
  });
  assert.deepEqual(result.actions.approve_application, { enabled: false, reason, requires_confirmation: true });
}
const controlSource = readFileSync(new URL("../web/strategy-switch-console/application/console_api/run_controls.js", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../web/strategy-switch-console/worker.js", import.meta.url), "utf8");
const reasons = [...controlSource.matchAll(/(?:blocked\(|reason: )"([a-z_]+)"/g),
  ...workerSource.slice(workerSource.indexOf("    profileState: async () => {")).split("\n  });")[0].matchAll(/reason: "([a-z_]+)"/g)].map(m => m[1]);
assert.deepEqual([...new Set(reasons)].sort(), [...controlReasons].sort(), "handoff reasons cover every current control gate");
console.log("console_gap_contract_validation: PASS (M0 12, currency 7, ten identities, failure/unknown/control semantics)");
