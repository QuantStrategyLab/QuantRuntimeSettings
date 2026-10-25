import assert from "node:assert/strict";
import { performanceResponse } from "../web/strategy-switch-console/application/console_api/performance_routes.js";
import { validate } from "./console_api_contract_validation.mjs";
const key = "synthetic-wallet";
const observed = new Date(Date.now() - 60000).toISOString();
const report = { platform: "binance", account_key: key, scope: "spot+flexible_earn",
  observed_finished_at: observed, assets: [{ asset: "BTC", quantity: "0.25" }, { asset: "USDT", quantity: "10" }],
  uncovered_scopes: ["funding", "margin", "futures", "locked_earn"] };
let unrelatedReads = 0;
const deps = {
  json: (body, status = 200) => Response.json(body, { status }),
  readSession: async () => ({ allowed: true }),
  accountOptions: async () => ({ options: { binance: [{ key, broker_environment: "live" }] } }),
  facts: async () => { unrelatedReads++; throw Error("unrelated common facts unavailable"); },
  binanceCurrent: async () => Response.json({ ok: true, report_status: "available", report }),
  history: async () => { throw Error("history must not be read"); },
  wallet: async () => { throw Error("wallet history must not be read"); },
  benchmarks: async () => { throw Error("benchmark must not be read"); },
};
const request = new Request("https://synthetic.test/api/performance/holdings?scope=" + key + "&platform=binance");
const read = async (overrides = {}) => {
  const response = await performanceResponse(request, {}, { ...deps, ...overrides });
  return { status: response.status, body: await response.json() };
};
let result = await read();
assert.equal(result.status, 200);
validate("holdings", result.body);
assert.equal(unrelatedReads, 0, "the selected native Binance source is independent of common facts");
assert.equal(result.body.rows.length, 2);
for (const row of result.body.rows) {
  assert.equal(row.currency, "", "the native quantity source supplies no quote currency");
  assert.equal(row.market_value, null);
  assert.equal(row.avg_cost, null);
  assert.equal(row.unrealized_pnl, null);
  assert.equal(row.coverage, "spot+flexible_earn");
  assert.equal(row.as_of, observed);
}
assert.equal(result.body.rows.find(x => x.symbol === "BTC").quantity, 0.25);
assert.equal(result.body.status, "partial");
for (const changed of [{ account_key: "another-account" }, { platform: "other" }, { scope: "futures" }]) {
  result = await read({ binanceCurrent: async () => Response.json({ report_status: "available", report: { ...report, ...changed } }) });
  assert.equal(result.body.rows.length, 0);
}
result = await read({ binanceCurrent: async () => Response.json({ report_status: "missing", report: null }) });
assert.equal(result.status, 200);
assert.equal(result.body.rows.length, 0);
result = await read({ binanceCurrent: async () => Response.json({ report_status: "available", report: { ...report, assets: [] } }) });
assert.equal(result.body.rows.length, 0);
assert.equal(result.body.coverage[0].complete, true, "an explicitly known empty covered scope remains known");
for (const source of [async () => { throw Error("private error"); }, async () => Response.json({}, { status: 503 }),
  async () => Response.json({ report_status: "unavailable", report: null })]) {
  result = await read({ binanceCurrent: source });
  assert.equal(result.status, 503);
  assert.equal(result.body.status, "unavailable");
  assert.ok(!JSON.stringify(result).includes("private error"));
}
const ibkr = { platform: "ibkr", account_key: "synthetic-equity", binding_status: "bound",
  observed_finished_at: observed, positions_scope: "stocks_only", positions_complete: true,
  positions: [{ symbol: "SYNTHETIC", currency: "USD", quantity: "2", market_value: "24", avg_cost: "10" }] };
result = await (async () => {
  const response = await performanceResponse(new Request("https://synthetic.test/api/performance/holdings?scope=all"), {}, {
    ...deps,
    accountOptions: async () => ({ options: { binance: [{ key }], ibkr: [{ key: ibkr.account_key }] } }),
    facts: async () => Response.json({ accounts: [ibkr] }),
    binanceCurrent: async () => { throw Error("private Binance error"); },
  });
  return { status: response.status, body: await response.json() };
})();
assert.equal(result.status, 200, "one provider read failure must not hide another provider's current positions");
assert.equal(result.body.rows.length, 1);
assert.equal(result.body.rows[0].symbol, "SYNTHETIC");
assert.equal(result.body.status, "partial");
assert.equal(result.body.coverage.find(x => x.platform === "binance").unavailable_reason, "stored_records_unreadable");
console.log("console_binance_current_holdings_validation: PASS (native quantities only; no wallet valuation or invented PnL)");
