import assert from "node:assert/strict";
import { summarizeCurrentAccountFacts } from "../web/strategy-switch-console/frontend/src/types.ts";

const facts = ({
  platform = "longbridge", scope = "HK", environment = "live", status = "fresh",
  binding = "bound", balances = [], cash = [],
} = {}) => ({
  platform, account_key: "synthetic", binding_status: binding, identity_status: "partial_identity",
  identity_mismatch: false, data_status: status, broker_environment: environment,
  target_id: "synthetic-target", source_binding_id: "synthetic-binding", account_scope: scope,
  observation_date: "2026-10-08", observed_started_at: "2026-10-08T00:00:00Z",
  observed_finished_at: "2026-10-08T00:01:00Z", balances, cash,
  return: { status: "unavailable", reason: "external_cashflow_required" },
});

const liveUsd = facts({ balances: [{ currency: "USD", net_assets: "100.10" }],
  cash: [{ currency: "USD", available_cash: "20.1", frozen_cash: "0", settling_cash: "0" }] });
const liveHkd = facts({ balances: [{ currency: "HKD", net_assets: "50" }],
  cash: [{ currency: "HKD", available_cash: "10", frozen_cash: "0", settling_cash: "0" }] });
const ibkr = facts({ platform: "ibkr", balances: [{ currency: "USD", net_assets: "25.90" }],
  cash: [{ currency: "USD", cash_balance: "12.25", source_tag: "CashBalance" }] });
const paper = facts({ platform: "longbridge", scope: "paper", environment: "paper",
  balances: [{ currency: "USD", net_assets: "900" }],
  cash: [{ currency: "USD", available_cash: "300", frozen_cash: "0", settling_cash: "0" }] });
const unknown = facts({ scope: "HK", environment: null, balances: [{ currency: "USD", net_assets: "7.5" }],
  cash: [{ currency: "USD", available_cash: "1.25", frozen_cash: "0", settling_cash: "0" }] });
const stale = facts({ status: "stale", balances: [{ currency: "USD", net_assets: "999" }],
  cash: [{ currency: "USD", available_cash: "999", frozen_cash: "0", settling_cash: "0" }] });
const unbound = facts({ binding: "missing", balances: [{ currency: "USD", net_assets: "888" }],
  cash: [{ currency: "USD", available_cash: "888", frozen_cash: "0", settling_cash: "0" }] });
const result = summarizeCurrentAccountFacts([
  { id: "lb-live-1", platform: "longbridge", brokerEnvironment: "live", facts: liveUsd },
  { id: "lb-live-2", platform: "longbridge", brokerEnvironment: "live", facts: liveHkd },
  { id: "ibkr-live", platform: "ibkr", brokerEnvironment: "live", facts: ibkr },
  { id: "lb-paper", platform: "longbridge", brokerEnvironment: "paper", facts: paper },
  { id: "lb-unknown", platform: "longbridge", brokerEnvironment: null, facts: unknown },
  { id: "lb-stale", platform: "longbridge", brokerEnvironment: "live", facts: stale },
  { id: "lb-unbound", platform: "longbridge", brokerEnvironment: "live", facts: unbound },
  { id: "binance-wallet", platform: "binance", brokerEnvironment: null, facts: null,
    walletValuation: { amount: "0.125", currency: "USDT" } },
]);

assert.deepEqual(result.live.assets, [
  { currency: "HKD", amount: "50" }, { currency: "USD", amount: "126" },
]);
assert.deepEqual(result.unknown.assets, [
  { currency: "USD", amount: "7.5" }, { currency: "USDT", amount: "0.125" },
]);
assert.deepEqual(result.paper.assets, [{ currency: "USD", amount: "900" }]);
assert.equal(result.live.accounts, 5);
assert.equal(result.live.covered, 3);
assert.equal(result.live.unbound, 1);
assert.equal(result.live.missing, 2, "stale and unbound account values are excluded and counted missing");
assert.equal(result.live.cashUnbound, 1, "unbound cash facts are reported in their own coverage count");
assert.equal(result.live.cashMissing, 2, "cash coverage gaps include the unbound account as well as stale data");
assert.deepEqual(result.live.availableCash, [{ currency: "HKD", amount: "10" }, { currency: "USD", amount: "20.1" }]);
assert.deepEqual(result.live.cashBalance, [{ currency: "USD", amount: "12.25" }]);
assert.deepEqual(result.paper.availableCash, [{ currency: "USD", amount: "300" }]);
assert.deepEqual(result.unknown.availableCash, [{ currency: "USD", amount: "1.25" }]);
assert.equal(result.unknown.cashAccounts, 1, "Binance wallet valuation is not treated as a cash balance");
assert.deepEqual(result.excludingPaper.assets, [
  { currency: "HKD", amount: "50" }, { currency: "USD", amount: "133.5" },
  { currency: "USDT", amount: "0.125" },
], "the all-account asset total sums live and unknown environments by currency");
assert.deepEqual(result.excludingPaper.availableCash, [
  { currency: "HKD", amount: "10" }, { currency: "USD", amount: "21.35" },
], "available cash sums live and unknown environments without mixing cash-balance semantics");
assert.deepEqual(result.excludingPaper.cashBalance, [{ currency: "USD", amount: "12.25" }]);
assert.equal(result.excludingPaper.accounts, 7);
assert.equal(result.excludingPaper.covered, 5, "stale and unbound accounts remain missing, not zero-valued");
assert.equal(result.excludingPaper.missing, 2);
assert.equal(result.excludingPaper.assets.some(row => row.currency === "USD" && row.amount === "1033.5"), false,
  "the configured paper amount is excluded from the all-account total");

const duplicateCurrency = summarizeCurrentAccountFacts([{
  id: "duplicate", platform: "longbridge", brokerEnvironment: "live",
  facts: facts({ balances: [
    { currency: "USD", net_assets: "5" }, { currency: "USD", net_assets: "6" },
  ] }),
}]);
assert.deepEqual(duplicateCurrency.live.assets, [], "ambiguous duplicate currency rows are not added");
assert.equal(duplicateCurrency.live.covered, 0);
assert.equal(duplicateCurrency.live.missing, 1);

console.log("overview current aggregation: PASS (currency, environment, freshness, bindings, cash semantics, wallet and duplicate rows)");
