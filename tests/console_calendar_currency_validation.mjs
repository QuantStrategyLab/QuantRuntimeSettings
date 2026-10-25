import assert from "node:assert/strict";
import { performanceResponse } from "../web/strategy-switch-console/application/console_api/performance_routes.js";

const json = (body, status = 200) => Response.json(body, { status });
const start = "2026-10-22T12:00:00.000Z", end = "2026-10-23T12:00:00.000Z";
const fact = { platform: "ibkr", account_key: "synthetic-usd", binding_status: "bound",
  observed_finished_at: end, observation_date: "2026-10-23",
  balances: [{ currency: "USD", net_assets: "215" }] };
const deps = {
  json, readSession: async () => ({ allowed: true }),
  accountOptions: async () => ({ options: {
    ibkr: [{ key: fact.account_key }], binance: [{ key: "synthetic-crypto" }],
  } }),
  facts: async () => json({ accounts: [fact] }),
  history: async () => json({ platform: fact.platform, account_key: fact.account_key,
    series: { currency: "USD", points: [
      { observation_date: "2026-10-22", net_assets: "100", currency: "USD", observed_finished_at: start },
      { observation_date: "2026-10-23", net_assets: "215", currency: "USD", observed_finished_at: end },
    ] },
    externalFlow: { schema_version: "external_flow.v1", windows: [{ currency: "USD", date: "2026-10-23",
      period_start: start, period_end: end, source: "ibkr_flex", coverage: "complete",
      records: [{ source_ref: "a".repeat(64), type: "deposit", amount: "100",
        effective_at: "2026-10-23T00:00:00.000Z", settlement_date: null, transfer_ref: null }] }] },
  }),
  wallet: async () => json({ currency: "USDT", points: [
    { observation_date: "2026-10-23", amount: "100", observed_at: end },
    { observation_date: "2026-10-24", amount: "110", observed_at: "2026-10-24T12:00:00.000Z" },
    { observation_date: "2026-10-25", amount: "121", observed_at: "2026-10-25T12:00:00.000Z" },
  ] }),
  benchmarks: async () => json({ points: [] }),
};
const env = { CONSOLE_EXTERNAL_FLOW_ENABLED: "true" };
export { deps as syntheticCalendarDeps, env as syntheticCalendarEnv };
const get = (query = "", overrides = {}) => performanceResponse(new Request(
  `https://console.example/api/performance/calendar?scope=all&range=ALL&year=2026&month=10${query}`), env, { ...deps, ...overrides });
const usd = await (await get()).json();
assert.deepEqual(usd.available_currencies, ["USD", "USDT"]);
assert.equal(usd.currency, "USD", "default calendar chooses one native currency, never adds USD and USDT");
assert.ok(Math.abs(usd.cells.find(cell => cell.date === "2026-10-23").return_percent - 10) < 1e-10,
  "selected-currency calendar consumes the existing flow adjustment, not the deposit as a gain");
assert.equal(usd.cells.find(cell => cell.date === "2026-10-23").amount, 15);
assert.equal(usd.cells.find(cell => cell.date === "2026-10-24").unavailable_reason, "non_trading_weekend");
const crypto = await (await get("&currency=USDT")).json();
assert.equal(crypto.currency, "USDT");
assert.deepEqual(crypto.coverage.currencies, ["USDT"]);
assert.equal(crypto.cells.find(cell => cell.date === "2026-10-24").amount, 10, "crypto weekend observation remains visible");
assert.equal(crypto.cells.find(cell => cell.date === "2026-10-24").return_percent, null,
  "missing crypto cashflows do not turn an asset change into TWR");
assert.equal(crypto.value_kind, "asset_change");
const missingFacts = await (await get("&currency=USDT", { facts: async () => json({}, 503) })).json();
assert.equal(missingFacts.cells.find(cell => cell.date === "2026-10-24").amount, 10,
  "an unrelated unknown broker member cannot turn the observed crypto weekend into a stock closure");
assert.ok(missingFacts.coverage.read_failures.includes("account_facts_unreadable"));
assert.equal(missingFacts.coverage.trading_dates, "calendar_days");
assert.equal((await get("&currency=EUR")).status, 400, "unknown selection is rejected rather than silently showing another currency");
const failed = await (await get("&currency=USD", { history: async () => json({}, 503) })).json();
assert.ok(failed.coverage.read_failures.includes(fact.account_key));
assert.equal(failed.status, "unavailable", "source failure is retained, never changed to an empty successful calendar");
const other = await performanceResponse(new Request("https://console.example/api/performance/summary?scope=all&range=ALL"), env, deps);
assert.equal((await other.json()).unavailable_reason, "mixed_currency", "calendar selection does not invent a cross-currency portfolio return");
console.log("console_calendar_currency_validation: PASS (currency separation, cashflow adjustment, crypto weekend, source failure, invalid selection)");
