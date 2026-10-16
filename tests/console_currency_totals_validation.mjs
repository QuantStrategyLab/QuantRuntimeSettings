import assert from "node:assert/strict";
import { performanceBlocks } from "../web/strategy-switch-console/application/console_api/performance.js";
const now = Date.parse("2026-10-16T12:00:00Z");
const account = (key, currency, value, at = "2026-10-16T10:00:00Z") => ({
  platform: "synthetic", account_key: key, binding_status: "bound",
  observed_finished_at: at, observation_date: at.slice(0, 10),
  balances: [{ currency, net_assets: String(value) }],
});
const input = { accounts: [account("alpha", "USD", 100), account("beta", "USD", 200), account("wallet", "USDT", 50)],
  histories: [], now, today: "2026-10-16", year: 2026, month: 10 };
const mixed = performanceBlocks(input);
assert.deepEqual(mixed.assets.per_currency.map(({ currency, total, account_count }) => ({ currency, total, account_count })), [
  { currency: "USD", total: 300, account_count: 2 }, { currency: "USDT", total: 50, account_count: 1 },
]);
assert.equal(mixed.assets.currency, null);
assert.deepEqual(mixed.assets.points, [], "no cross-currency asset series");
const single = performanceBlocks({ ...input, accounts: [account("alpha", "USD", 0)] });
assert.equal(single.assets.per_currency[0].total, 0, "known zero is retained");
assert.equal(single.assets.per_currency[0].status, "ok");
assert.equal(single.assets.per_currency[0].as_of, "2026-10-16T10:00:00Z");
const empty = performanceBlocks({ ...input, accounts: [] });
assert.deepEqual(empty.assets.per_currency, []);
assert.equal(empty.assets.unavailable_reason, "no_snapshot");
assert.deepEqual(empty.assets.freshness_summary, { fresh: 0, stale: 0, unknown: 0, threshold_hours: 36 });
const old = account("old", "USD", 900, "2026-10-10T10:00:00Z");
const partial = performanceBlocks({ ...input, accounts: [input.accounts[0], old, { platform: "synthetic", account_key: "unknown" }] });
assert.equal(partial.assets.per_currency[0].total, 100, "different valuation dates are never silently added");
assert.equal(partial.assets.per_currency[0].status, "partial");
assert.equal(partial.assets.per_currency[0].unavailable_reason, "valuation_date_mismatch");
assert.equal(partial.assets.per_currency[0].account_count, 1);
assert.equal(partial.assets.per_currency[0].expected_account_count, 2);
assert.deepEqual(partial.assets.freshness_summary, { fresh: 1, stale: 1, unknown: 1, threshold_hours: 36 });
assert.equal(partial.assets.account_freshness[0].stale, false);
assert.equal(partial.assets.account_freshness[1].stale, true);
assert.equal(partial.assets.account_freshness[2].stale, null);
assert.equal(partial.holdings.status, "no_data", "one stale account cannot mark the table stale");
assert.equal(partial.holdings.coverage[0].freshness, "fresh");
assert.equal(partial.holdings.coverage[1].freshness, "stale");
assert.equal(partial.holdings.as_of, null, "no misleading oldest-account table timestamp");
for (const [threshold, fresh] of [[1, false], [2, true], [36, true], ["invalid", true], [-1, true]]) {
  const data = performanceBlocks({ ...input, accounts: [input.accounts[0]], freshnessThresholdHours: threshold });
  assert.equal(data.assets.account_freshness[0].fresh, fresh);
}
const legacy = performanceBlocks({ ...input, accounts: [{ account_key: "legacy" }] });
assert.deepEqual(legacy.holdings.coverage, [{ account_alias: "legacy", scope: "not_connected" }]);
assert.equal(legacy.assets.account_freshness[0].platform, null);
assert.equal(legacy.assets.account_freshness[0].account_ref, null, "missing identity remains unknown");
const noValue = performanceBlocks({ ...input, accounts: [account("unknown-value", "USD", " ")] });
assert.equal(noValue.assets.per_currency[0].total, null, "missing amount never becomes zero");
assert.equal(noValue.assets.per_currency[0].unavailable_reason, "no_snapshot");
const future = performanceBlocks({ ...input, accounts: [account("future", "USD", 50, "2026-10-17T10:00:00Z")] });
assert.equal(future.assets.account_freshness[0].freshness, "unknown");
assert.equal(future.assets.per_currency[0].total, null);
const excluded = performanceBlocks({ ...input, failed: ["missing"] });
assert.equal(excluded.assets.per_currency[0].status, "partial");
assert.equal(excluded.assets.per_currency[0].unavailable_reason, "incomplete_account_coverage");
const duplicate = account("duplicate", "USD", 100);
duplicate.balances.push({ currency: "USD", net_assets: "100" });
assert.equal(performanceBlocks({ ...input, accounts: [duplicate] }).assets.per_currency[0].total, null);
const history = (currency, points) => ({ id: currency, currency, points });
const points = [{ date: "2026-10-14", value: 100, externalFlow: 0 }, { date: "2026-10-15", value: 80, externalFlow: 0 }];
const drawdowns = performanceBlocks({ ...input, histories: [history("USD", points), history("USDT", points)] });
assert.ok(Math.abs(drawdowns.summary.per_currency[0].max_drawdown.percent - 20) < 1e-10);
assert.equal(drawdowns.summary.max_drawdown.percent, null, "no combined currency drawdown");
for (const [observations, reason] of [[[], "no_snapshot"], [[points[0]], "insufficient_history"], [points.map(({ externalFlow, ...p }) => p), "no_cashflow_data"]]) {
  const data = performanceBlocks({ ...input, histories: [history("USD", observations)] });
  assert.equal(data.summary.max_drawdown.unavailable_reason, reason);
  assert.equal(data.summary.metric_reasons.twr, reason);
  assert.equal(data.summary.twr_return_percent, null);
  assert.equal(data.summary.per_currency[0].max_drawdown.unavailable_reason, reason);
}
// The read-only adapter must use current balances even with no common history date.
const { performanceResponse } = await import("../web/strategy-switch-console/application/console_api/performance_routes.js");
const deps = {
  json: (body, status = 200) => Response.json(body, { status }), readSession: async () => ({ allowed: true }),
  accountOptions: async () => ({ options: { synthetic: [{ key: "alpha" }], binance: [{ key: "wallet" }] } }),
  facts: async () => Response.json({ accounts: [input.accounts[0]] }),
  history: async () => Response.json({ platform: "synthetic", account_key: "alpha", series: { currency: "USD", points: [] } }),
  wallet: async () => Response.json({ currency: "USDT", points: [{ observation_date: "2026-10-16", observed_at: "2026-10-16T10:00:00Z", amount: "50" }] }),
  benchmarks: async () => Response.json({ points: [] }),
};
const request = new Request("https://console.example/api/performance/assets");
const response = await performanceResponse(request, { CONSOLE_ACCOUNT_FRESHNESS_HOURS: "1" }, deps);
assert.equal(response.status, 200);
const body = await response.json();
assert.equal(body.per_currency.find((r) => r.currency === "USD").total, 100);
assert.notEqual(body.per_currency.find((r) => r.currency === "USD").unavailable_reason, "incomplete_account_coverage", "history failures do not remove valid current snapshots");
assert.equal(body.per_currency.find((r) => r.currency === "USDT").total, 50);
assert.equal(body.freshness_summary.threshold_hours, 1);
assert.equal(body.account_freshness.find((r) => r.platform === "binance").as_of, "2026-10-16T10:00:00Z");
assert.equal((await performanceResponse(new Request(request.url, { method: "POST" }), {}, deps)).status, 405);
assert.equal((await performanceResponse(request, {}, { ...deps, readSession: async () => null })).status, 401);
console.log("console_currency_totals_validation: PASS (native totals, zero/empty/partial, timestamp thresholds, per-account flags, qualified drawdown, honest reasons, read-only adapter)");
