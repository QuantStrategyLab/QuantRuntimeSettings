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

const duplicateConfigKey = summarizeCurrentAccountFacts([
  { id: "longbridge:duplicate-key", platform: "longbridge", brokerEnvironment: "live", facts: liveUsd },
  { id: "longbridge:duplicate-key", platform: "longbridge", brokerEnvironment: "live", facts: liveUsd },
]);
assert.deepEqual(duplicateConfigKey.live.assets, [{ currency: "USD", amount: "100.1" }],
  "repeated rows for the same platform/config key contribute their shared snapshot only once");
assert.equal(duplicateConfigKey.duplicateConfigurationKeys, 1);
assert.equal(duplicateConfigKey.duplicateConfigurationConflicts, 0);

const conflictingDuplicateConfigKey = summarizeCurrentAccountFacts([
  { id: "longbridge:duplicate-conflict", platform: "longbridge", brokerEnvironment: "live", facts: liveUsd },
  { id: "longbridge:duplicate-conflict", platform: "longbridge", brokerEnvironment: "live", facts: liveHkd },
]);
assert.deepEqual(conflictingDuplicateConfigKey.excludingPaper.assets, [],
  "conflicting snapshots for a repeated configuration key are excluded rather than choosing or summing either value");
assert.equal(conflictingDuplicateConfigKey.live.missing, 1,
  "conflicting duplicate facts remain visible as one uncovered configuration key");
assert.equal(conflictingDuplicateConfigKey.duplicateConfigurationConflicts, 1);

const conflictingDuplicateEnvironment = summarizeCurrentAccountFacts([
  { id: "longbridge:environment-conflict", platform: "longbridge", brokerEnvironment: "live", facts: null,
    walletValuation: { amount: "15", currency: "USD" } },
  { id: "longbridge:environment-conflict", platform: "longbridge", brokerEnvironment: "paper", facts: null,
    walletValuation: { amount: "15", currency: "USD" } },
]);
assert.deepEqual(conflictingDuplicateEnvironment.excludingPaper.assets, [],
  "a live/paper environment conflict excludes the shared wallet amount");
assert.deepEqual(conflictingDuplicateEnvironment.paper.assets, []);
assert.equal(conflictingDuplicateEnvironment.unknown.missing, 1,
  "an environment-conflicted configuration key remains visible as missing");
assert.equal(conflictingDuplicateEnvironment.duplicateConfigurationConflicts, 1);

const conflictingFactsWithMatchingWallet = summarizeCurrentAccountFacts([
  { id: "longbridge:facts-conflict", platform: "longbridge", brokerEnvironment: "live", facts: liveUsd,
    walletValuation: { amount: "15", currency: "USD" } },
  { id: "longbridge:facts-conflict", platform: "longbridge", brokerEnvironment: "live", facts: liveHkd,
    walletValuation: { amount: "15", currency: "USD" } },
]);
assert.deepEqual(conflictingFactsWithMatchingWallet.live.assets, [],
  "facts conflicts exclude wallet values too, even when both wallet snapshots match");
assert.deepEqual(conflictingFactsWithMatchingWallet.live.availableCash, []);
assert.equal(conflictingFactsWithMatchingWallet.live.missing, 1);
assert.equal(conflictingFactsWithMatchingWallet.duplicateConfigurationConflicts, 1);

for (const [configuredEnvironment, sourceEnvironment] of [["live", "paper"], ["paper", "live"]]) {
  const conflict = summarizeCurrentAccountFacts([{
    id: "longbridge:source-environment-conflict", platform: "longbridge", brokerEnvironment: configuredEnvironment,
    facts: facts({ environment: sourceEnvironment, balances: [{ currency: "USD", net_assets: "900" }],
      cash: [{ currency: "USD", available_cash: "300" }] }),
    walletValuation: { currency: "USDT", amount: "7" },
  }]);
  assert.deepEqual(conflict.excludingPaper.assets, [], "environment conflicts exclude both facts and wallet amounts");
  assert.deepEqual(conflict.excludingPaper.availableCash, []);
  assert.equal(conflict.unknown.missing, 1);
  assert.equal(conflict.unknown.cashMissing, 1);
}
const independentWallet = summarizeCurrentAccountFacts([
  { id: "binance:wallet-bound", platform: "binance", brokerEnvironment: null,
    facts: facts({ platform: "binance", binding: "missing", balances: [], cash: [] }),
    walletValuation: { currency: "USDT", amount: "5" } },
  { id: "longbridge:no-report", platform: "longbridge", brokerEnvironment: null,
    facts: facts({ status: "unavailable", balances: [], cash: [] }) },
  { id: "firstrade:no-source", platform: "firstrade", brokerEnvironment: null,
    facts: facts({ platform: "firstrade", binding: "missing", balances: [], cash: [] }) },
]);
assert.equal(independentWallet.excludingPaper.covered, 1);
assert.equal(independentWallet.excludingPaper.unbound, 1,
  "a wallet validated by its own source is not unbound merely because the generic receiver does not accept Binance");
assert.equal(independentWallet.excludingPaper.missing, 2);
assert.equal(independentWallet.excludingPaper.missing - independentWallet.excludingPaper.unbound, 1,
  "the bound account with no report must remain a separate coverage gap");

console.log("overview current aggregation: PASS (currency, environment, freshness, bindings, cash semantics, wallet and duplicate rows)");
