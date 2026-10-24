import assert from "node:assert/strict";
import { accountFactsForDisplay, verifiedCurrentAccountAssets } from "../web/strategy-switch-console/frontend/src/types.ts";
import { buildAccountFactsReadModel } from "../web/strategy-switch-console/account_facts.js";

const now = Date.parse("2026-10-08T10:00:00Z");
function input(specs) {
  const options = [], bindings = [], stored = new Map();
  for (const [index, spec] of specs.entries()) {
    const key = `synthetic-${index}`;
    const option = { key, target_name: key, service_name: `${key}-service`,
      deployment_selector: key, account_selector: "default", account_scope: "live",
      broker_environment: spec.paper ? "paper" : "live" };
    const binding = { ...option, platform: "firstrade", account_key: key,
      broker_account_id: spec.identity, target_id: key,
      source_binding: { kind: "deployment_runtime_account", id: String(index + 1).repeat(64) } };
    delete binding.key; delete binding.broker_environment;
    options.push(option); bindings.push(binding);
    if (spec.missing) continue;
    const start = new Date(now - (spec.stale ? 40 * 3600000 : (spec.minutes || 2) * 60000)).toISOString();
    const finish = new Date(Date.parse(start) + 60000).toISOString();
    stored.set(`firstrade:${key}`, { schema_version: "firstrade_account_snapshot_history.v1",
      snapshot_schema_version: "firstrade_account_snapshot.v1", account_scope: "live",
      target_id: key, source_binding: { ...binding.source_binding, status: "bound" },
      broker_account_id: spec.wrongIdentity || spec.identity,
      observed_started_at: start, observed_finished_at: finish,
      observation_date: start.slice(0, 10), snapshot_atomic: false,
      broker_reported_balances: [{ currency: spec.currency || "USD", net_assets: spec.amount || "0.1" }],
      cash: spec.cash === undefined ? [] : [{ currency: spec.currency || "USD", cash_balance: spec.cash,
        source_tag: "provider.cash_balance" }] });
  }
  return { now, accountOptions: { firstrade: options },
    bindings: { schema_version: "qsl_account_facts_bindings.v1", bindings }, storedByAccount: stored };
}
const model = specs => buildAccountFactsReadModel(input(specs));
const complete = model([
  { identity: "synthetic-native-a", amount: "0.1", cash: "0" },
  { identity: "synthetic-native-b", amount: "0.2", cash: "-0.1" },
  { identity: "synthetic-native-c", currency: "HKD", amount: "999999999999999.99999999" },
]);
assert.deepEqual(complete.totals, { status: "by_currency", reason: null, by_currency: [
  { currency: "HKD", net_assets: "999999999999999.99999999", available_cash: null, cash_balance: null, account_count: 1 },
  { currency: "USD", net_assets: "0.3", available_cash: null, cash_balance: "-0.1", account_count: 2 },
] });
assert.equal(JSON.stringify(complete).includes("synthetic-native"), false, "no native identity leaks into any public field");
const duplicate = model([{ identity: "synthetic-same", amount: "3", cash: "0" },
  { identity: "synthetic-same", amount: "3", cash: "0" }]);
assert.equal(duplicate.totals.by_currency[0].net_assets, "3");
assert.equal(duplicate.totals.by_currency[0].account_count, 1);
assert.deepEqual(duplicate.accounts.map(row => row.aggregation_status), ["included", "duplicate"]);
for (const second of [{ amount: "4" }, { amount: "3", cash: "1" }, { amount: "3", paper: true }]) {
  const conflict = model([{ identity: "synthetic-same", amount: "3" }, { identity: "synthetic-same", ...second }]);
  assert.equal(conflict.totals.status, "unavailable");
  assert.equal(conflict.totals.reason, "duplicate_account_mapping");
  assert.ok(conflict.accounts.every(row => row.aggregation_status === "conflict"));
}
for (const failure of [{ missing: true }, { stale: true }, { wrongIdentity: "synthetic-wrong" }]) {
  assert.equal(model([{ identity: "synthetic-a" }, { identity: "synthetic-b", ...failure }]).totals.reason,
    "coverage_incomplete");
}
const paper = model([{ identity: "synthetic-live", amount: "1" }, { identity: "synthetic-paper", amount: "900", paper: true }]);
assert.equal(paper.totals.by_currency[0].net_assets, "1");
const missingCash = model([{ identity: "synthetic-a", cash: "0" }, { identity: "synthetic-b" }]);
assert.equal(missingCash.totals.status, "by_currency", "missing cash does not block known asset totals");
assert.equal(missingCash.totals.by_currency[0].cash_balance, null, "missing cash is never zero");
console.log("account facts totals: PASS (native dedup, conflict, precision, paper, freshness and privacy)");

for (const older of [{minutes: 10}, {stale: true}]) {
  const latest = model([
    {identity: "synthetic-same", amount: "2", cash: "0", ...older},
    {identity: "synthetic-same", amount: "3", cash: "1"},
  ]);
  assert.equal(latest.totals.status, "by_currency", "older aliases cannot block the latest verified account observation");
  assert.equal(latest.totals.by_currency[0].net_assets, "3");
  assert.equal(latest.totals.by_currency[0].cash_balance, "1");
  assert.deepEqual(latest.accounts.map(row => row.aggregation_status), ["duplicate", "included"]);
}

const textEquivalent = model([{identity: "synthetic-same", amount: "3", cash: "0"},
  {identity: "synthetic-same", amount: "3.00", cash: "-0.000"}]);
assert.equal(textEquivalent.totals.status, "by_currency");
assert.equal(textEquivalent.totals.by_currency[0].net_assets, "3");
const offsetInput = input([{identity: "synthetic-same", amount: "3"}, {identity: "synthetic-same", amount: "4"}]);
const offsetHistory = offsetInput.storedByAccount.get("firstrade:synthetic-1");
offsetHistory.observed_finished_at = "2026-10-08T17:59:00+08:00";
assert.equal(buildAccountFactsReadModel(offsetInput).totals.reason, "duplicate_account_mapping");
for (const older of [{stale: true}, {minutes: 35 * 60}]) {
  const snapshot = {...model([{identity: "synthetic-same", amount: "2", ...older},
    {identity: "synthetic-same", amount: "3"}]), account_options_revision: 7};
  const displayNow = now + 2 * 3600000;
  const rows = snapshot.accounts.map(row => ({id: `${row.platform}:${row.account_key}`, platform: row.platform,
    brokerEnvironment: row.broker_environment, facts: accountFactsForDisplay(row, displayNow)}));
  assert.deepEqual(verifiedCurrentAccountAssets(snapshot, rows, displayNow, 7), [{currency: "USD", amount: "3"}],
    "actual read model through local display expiry: old duplicate must not block the latest valid snapshot");
  assert.equal(verifiedCurrentAccountAssets(snapshot, rows, now + 40 * 3600000, 7), null,
    "the contributing latest snapshot still expires normally");
}

// WEB-GAP-FIX-01: explain actual asset-total membership without exposing balances/identity.
const coverage = complete.asset_coverage;
assert.equal(coverage.scope, "account_facts_totals");
assert.equal(coverage.source, "validated_account_facts_snapshot");
assert.equal(coverage.totals_status, "by_currency");
assert.equal(coverage.totals_reason, null);
assert.equal(coverage.accounts.length, complete.accounts.length);
for (const row of coverage.accounts) {
  assert.deepEqual(Object.keys(row).sort(), ["platform", "account_key", "status", "reason", "observation_date", "observed_finished_at"].sort());
  assert.equal(row.status, "included");
  assert.equal(row.reason, null);
  const fact = complete.accounts.find(a => a.account_key === row.account_key);
  assert.equal(row.observation_date, fact.observation_date);
  assert.equal(row.observed_finished_at, fact.observed_finished_at);
}
assert.deepEqual(duplicate.asset_coverage.accounts.map(a => [a.status, a.reason]),
  [["included", null], ["excluded", "duplicate_account"]]);
assert.equal(paper.asset_coverage.accounts[1].reason, "paper_account");
assert.equal(paper.asset_coverage.accounts[1].status, "excluded");
assert.ok(missingCash.asset_coverage.accounts.every(a => a.status === "included"));
assert.equal(model([{identity: "synthetic-zero", amount: "0"}]).asset_coverage.accounts[0].status, "included");
for (const [failure, reason] of [[{missing: true}, "snapshot_missing_or_invalid"],
  [{stale: true}, "snapshot_stale"], [{wrongIdentity: "private-wrong"}, "snapshot_missing_or_invalid"]]) {
  const result = model([{identity: "synthetic-a"}, {identity: "synthetic-b", ...failure}]);
  assert.deepEqual(result.asset_coverage.accounts.map(a => [a.status, a.reason]),
    [["blocked", "aggregate_coverage_incomplete"], ["unavailable", reason]]);
  assert.equal(result.asset_coverage.accounts[1].observation_date === null, !failure.stale);
  assert.equal(result.totals.by_currency.length, 0);
}
const conflictCoverage = model([{identity: "synthetic-same", amount: "3"}, {identity: "synthetic-same", amount: "4"}]);
assert.ok(conflictCoverage.asset_coverage.accounts.every(a => a.status === "unavailable" && a.reason === "duplicate_account_mapping"));
for (const [change, reason] of [
  [x => { x.bindings = null; }, "binding_missing"],
  [x => { x.accountOptions.firstrade[0].service_name = "different-service"; }, "identity_mismatch"],
  [x => { x.storedByAccount.get("firstrade:synthetic-0").broker_reported_balances[0].net_assets = null; }, "snapshot_missing_or_invalid"],
]) {
  const spec = input([{identity: "private-native"}]);
  change(spec);
  const result = buildAccountFactsReadModel(spec);
  assert.equal(result.asset_coverage.accounts[0].reason, reason);
  assert.equal(JSON.stringify(result.asset_coverage).includes("private"), false);
}
const separate = buildAccountFactsReadModel({accountOptions: {binance: [{key: "synthetic-wallet"}]}});
assert.deepEqual(separate.asset_coverage.accounts, [{platform: "binance", account_key: "synthetic-wallet",
  status: "unavailable", reason: "source_not_supported", observation_date: null, observed_finished_at: null}]);
assert.deepEqual(buildAccountFactsReadModel().asset_coverage.accounts, []);

const sharedBinding = input([{identity: "synthetic-a"}, {identity: "synthetic-b"}]);
sharedBinding.bindings.bindings[1].target_id = sharedBinding.bindings.bindings[0].target_id;
sharedBinding.bindings.bindings[1].source_binding.id = sharedBinding.bindings.bindings[0].source_binding.id;
assert.throws(() => buildAccountFactsReadModel(sharedBinding), /duplicate_account_facts_binding/, "invalid bindings are rejected before projection");
// A valid LongBridge channel snapshot does not establish a physical broker identity.
const channel = input([{identity: "private-channel"}]);
const option = {...channel.accountOptions.firstrade[0], account_scope: "HK", account_selector: "HK"};
const binding = {...channel.bindings.bindings[0], platform: "longbridge", account_scope: "HK", account_selector: "HK"};
delete binding.broker_account_id;
binding.source_binding = {...binding.source_binding, kind: "deployment_scope_token_version"};
const stored = {...channel.storedByAccount.get("firstrade:synthetic-0"),
  schema_version: "longbridge_account_snapshot_history.v1", snapshot_schema_version: "longbridge_account_snapshot.v1",
  account_scope: "HK", broker_reported_balances: [{currency: "USD", net_assets: "1", total_cash: "0"}],
  cash: [{currency: "USD", available_cash: "0", frozen_cash: "0", settling_cash: "0"}]};
delete stored.broker_account_id;
stored.source_binding = {...binding.source_binding, status: "bound"};
const channelModel = buildAccountFactsReadModel({now, accountOptions: {longbridge: [option]},
  bindings: {...channel.bindings, bindings: [binding]}, storedByAccount: new Map([["longbridge:synthetic-0", stored]])});
assert.equal(channelModel.accounts[0].data_status, "fresh");
assert.equal(channelModel.asset_coverage.accounts[0].reason, "physical_identity_unverified");


const missingAsset = input([{identity: "private-native"}]);
const ibkrOption = {...missingAsset.accountOptions.firstrade[0], account_selector: "U00000001"};
const ibkrBinding = {...missingAsset.bindings.bindings[0], platform: "ibkr", account_selector: "U00000001"};
delete ibkrBinding.broker_account_id;
const ibkrStored = {...missingAsset.storedByAccount.get("firstrade:synthetic-0"),
  schema_version: "ibkr_account_snapshot_history.v1", snapshot_schema_version: "ibkr_account_snapshot.v1",
  account_ids: ["U00000001"], broker_reported_balances: [{currency: "USD", net_assets: null}],
  cash: [{currency: "USD", cash_balance: "1", source_tag: "TotalCashBalance"}]};
delete ibkrStored.broker_account_id;
const missingAssetModel = buildAccountFactsReadModel({now, accountOptions: {ibkr: [ibkrOption]},
  bindings: {...missingAsset.bindings, bindings: [ibkrBinding]}, storedByAccount: new Map([["ibkr:synthetic-0", ibkrStored]])});
assert.equal(missingAssetModel.accounts[0].data_status, "fresh");
assert.equal(missingAssetModel.asset_coverage.accounts[0].reason, "net_assets_missing");

console.log("asset coverage: PASS (membership, blockers, timestamps, missing semantics and privacy)");
