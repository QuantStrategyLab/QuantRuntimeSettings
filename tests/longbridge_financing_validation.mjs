import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACCOUNT_FACTS_BINDINGS_SCHEMA,
  ACCOUNT_FACTS_HISTORY_SCHEMA,
  ACCOUNT_FACTS_MAX_MONEY_DIGITS,
  ACCOUNT_FACTS_MAX_MONEY_SCALE,
  ACCOUNT_FACTS_MAX_NATIVE_MONEY_DIGITS,
  ACCOUNT_FACTS_MAX_NATIVE_MONEY_SCALE,
  ACCOUNT_FACTS_PAYLOAD_SCOPE,
  ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
  ACCOUNT_FACTS_SOURCE_KIND,
  IBKR_ACCOUNT_FACTS_HISTORY_SCHEMA,
  IBKR_ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
  IBKR_ACCOUNT_FACTS_SOURCE_KIND,
  buildAccountFactsReadModel,
  normalizeAccountFactsHistoryPayload,
  projectStoredAccountFacts,
} from "../web/strategy-switch-console/account_facts.js";
import {
  longBridgeFinancingDetails,
  longBridgeRiskLevelLabel,
} from "../web/strategy-switch-console/frontend/src/types.ts";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const bindingId = "a".repeat(64);

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function observationDateFrom(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

function historyPayload(patch = {}) {
  const started = patch.observed_started_at || isoMinutesAgo(2);
  const finished = patch.observed_finished_at || isoMinutesAgo(1);
  const balances = patch.broker_reported_balances || [
    { currency: "USD", net_assets: "10", total_cash: "1" },
    { currency: "HKD", net_assets: "3", total_cash: "1" },
  ];
  const cash = patch.cash || [
    { currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" },
    { currency: "HKD", available_cash: "1", frozen_cash: "0", settling_cash: "0" },
  ];
  return {
    schema_version: ACCOUNT_FACTS_HISTORY_SCHEMA,
    snapshot_schema_version: ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
    account_scope: ACCOUNT_FACTS_PAYLOAD_SCOPE,
    target_id: "paper",
    source_binding: {
      kind: ACCOUNT_FACTS_SOURCE_KIND,
      status: "bound",
      id: bindingId,
    },
    snapshot_atomic: false,
    ...patch,
    observed_started_at: started,
    observed_finished_at: finished,
    observation_date: patch.observation_date || observationDateFrom(started),
    broker_reported_balances: balances,
    cash,
  };
}

function ibkrHistory(patch = {}) {
  const started = patch.observed_started_at || isoMinutesAgo(2);
  const finished = patch.observed_finished_at || isoMinutesAgo(1);
  return {
    schema_version: IBKR_ACCOUNT_FACTS_HISTORY_SCHEMA,
    snapshot_schema_version: IBKR_ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
    account_scope: "U16608560",
    target_id: "ibkr-paper",
    source_binding: {
      kind: IBKR_ACCOUNT_FACTS_SOURCE_KIND,
      status: "bound",
      id: bindingId,
    },
    snapshot_atomic: false,
    account_ids: ["U16608560"],
    broker_reported_balances: [{ currency: "USD", net_assets: "10" }],
    cash: [{ currency: "USD", cash_balance: "1", source_tag: "CashBalance" }],
    ...patch,
    observed_started_at: started,
    observed_finished_at: finished,
    observation_date: patch.observation_date || observationDateFrom(started),
  };
}

assert.equal(ACCOUNT_FACTS_MAX_MONEY_DIGITS, 15);
assert.equal(ACCOUNT_FACTS_MAX_MONEY_SCALE, 8);
assert.equal(ACCOUNT_FACTS_MAX_NATIVE_MONEY_DIGITS, 30);
assert.equal(ACCOUNT_FACTS_MAX_NATIVE_MONEY_SCALE, 28);

// Old absent financing payload stays valid.
const withoutFinancing = normalizeAccountFactsHistoryPayload(historyPayload());
assert.equal(Object.hasOwn(withoutFinancing, "financing"), false);
assert.deepEqual(withoutFinancing.broker_reported_balances[0].total_cash, "1");

const validFinancing = [
  {
    currency: "HKD",
    remaining_finance_amount: "0.00",
    risk_level: "1",
  },
  {
    currency: "USD",
    max_finance_amount: "1000.50000000",
    remaining_finance_amount: "-12.25000000",
    init_margin: "0",
    maintenance_margin: "1.25000000",
    margin_call: "0.00000001",
    buy_power: "999.99999999",
    risk_level: "0",
  },
];
const withFinancing = normalizeAccountFactsHistoryPayload(historyPayload({ financing: validFinancing }));
assert.deepEqual(withFinancing.financing.map((row) => row.currency), ["HKD", "USD"]);
assert.equal(withFinancing.financing[1].max_finance_amount, "1000.50000000");
assert.equal(withFinancing.financing[1].remaining_finance_amount, "-12.25000000");
assert.equal(withFinancing.financing[0].remaining_finance_amount, "0.00");
assert.equal(withFinancing.financing[1].risk_level, "0");
assert.equal(withFinancing.broker_reported_balances[0].net_assets, "10");

// Native detail precision beyond primary 15/8 remains accepted for financing only.
const wideFraction = `1.${"0".repeat(27)}1`;
const wideWhole = `${"9".repeat(30)}.12`;
assert.doesNotThrow(() => normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [{ currency: "USD", buy_power: wideFraction }],
})));
assert.doesNotThrow(() => normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [{ currency: "USD", buy_power: wideWhole }],
})));
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [{ currency: "USD", buy_power: `1.${"0".repeat(28)}1` }],
})), /invalid_account_facts_financing/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [{ currency: "USD", buy_power: `${"9".repeat(31)}` }],
})), /invalid_account_facts_financing/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  broker_reported_balances: [{ currency: "USD", net_assets: wideFraction, total_cash: "1" }],
  cash: [{ currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" }],
})), /invalid_account_facts_money_scale/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  broker_reported_balances: [{ currency: "USD", net_assets: `${"9".repeat(16)}`, total_cash: "1" }],
  cash: [{ currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" }],
})), /invalid_account_facts_money_magnitude/);

// risk_level wire strings only; numeric/bool/float/unknown rejected (SDK int→wire is projector-side).
for (const level of ["0", "1", "2", "3"]) {
  assert.equal(normalizeAccountFactsHistoryPayload(historyPayload({
    financing: [{ currency: "USD", risk_level: level }],
  })).financing[0].risk_level, level);
}
for (const rejectedLevel of [0, 1, 2, 3, 1.5, true, false, "4", "03", null, undefined]) {
  assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
    financing: [{ currency: "USD", risk_level: rejectedLevel }],
  })), /invalid_account_facts_financing/);
}

// Client unsorted currencies rejected; already-sorted accepted without reorder.
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [
    { currency: "USD", buy_power: "1" },
    { currency: "HKD", buy_power: "2" },
  ],
})), /invalid_account_facts_financing/);
assert.deepEqual(normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [
    { currency: "HKD", buy_power: "2" },
    { currency: "USD", buy_power: "1" },
  ],
})).financing.map((row) => row.currency), ["HKD", "USD"]);

// Duplicates, unknown fields, currency-only, currency mismatch, empty/non-array.
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [
    { currency: "USD", buy_power: "1" },
    { currency: "USD", buy_power: "2" },
  ],
})), /invalid_account_facts_financing/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [{ currency: "USD", buy_power: "1", debt: "2" }],
})), /invalid_account_facts_financing/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [{ currency: "USD" }],
})), /invalid_account_facts_financing/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [{ currency: "JPY", buy_power: "1" }],
})), /invalid_account_facts_financing/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [],
})), /invalid_account_facts_financing/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  financing: { currency: "USD", buy_power: "1" },
})), /invalid_account_facts_financing/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [{ currency: "USD", buy_power: 1.25 }],
})), /invalid_account_facts_financing/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [{ currency: "USD", buy_power: "1e3" }],
})), /invalid_account_facts_financing/);

// Other platforms reject financing.
assert.throws(() => normalizeAccountFactsHistoryPayload(ibkrHistory({
  financing: [{ currency: "USD", buy_power: "1" }],
})), /invalid_account_facts_history/);

const option = {
  key: "synthetic-lb",
  account_scope: "paper",
  target_name: "paper",
  service_name: "paper",
  deployment_selector: "paper",
  account_selector: "paper",
  broker_environment: "paper",
};
const binding = {
  platform: "longbridge",
  account_key: option.key,
  account_scope: option.account_scope,
  target_name: option.target_name,
  service_name: option.service_name,
  deployment_selector: option.deployment_selector,
  account_selector: option.account_selector,
  target_id: "paper",
  source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, id: bindingId },
};
const stored = projectStoredAccountFacts(withFinancing, {
  expectedPlatform: "longbridge",
  expectedTargetId: "paper",
  expectedBindingId: bindingId,
  expectedOptionScope: "paper",
});
const readModel = buildAccountFactsReadModel({
  accountOptions: { longbridge: [option] },
  bindings: { schema_version: ACCOUNT_FACTS_BINDINGS_SCHEMA, bindings: [binding] },
  storedByAccount: new Map([[`longbridge:${option.key}`, withFinancing]]),
});
const row = readModel.accounts[0];
assert.equal(row.data_status, "fresh");
assert.ok(Array.isArray(row.financing));
assert.equal(row.financing[1].max_finance_amount, "1000.50000000");
assert.equal(Object.hasOwn(row, "account_hash"), false);
assert.equal(readModel.totals.status, "unavailable");
assert.equal(JSON.stringify(readModel).includes("CashMargin"), false);
assert.equal(JSON.stringify(readModel).includes("max_finance_amount"), true);

const staleStored = {
  ...withFinancing,
  observed_started_at: "2020-01-01T00:00:00Z",
  observed_finished_at: "2020-01-01T00:01:00Z",
  observation_date: "2020-01-01",
};
const staleProjected = projectStoredAccountFacts(staleStored, {
  expectedPlatform: "longbridge",
  expectedTargetId: "paper",
  expectedBindingId: bindingId,
  expectedOptionScope: "paper",
});
assert.equal(staleProjected.data_status, "stale");
assert.ok(Array.isArray(staleProjected.financing), "historical stored financing remains intact when stale");
assert.equal(staleProjected.financing[1].max_finance_amount, "1000.50000000");
const staleModel = buildAccountFactsReadModel({
  accountOptions: { longbridge: [option] },
  bindings: { schema_version: ACCOUNT_FACTS_BINDINGS_SCHEMA, bindings: [binding] },
  storedByAccount: new Map([[`longbridge:${option.key}`, staleStored]]),
});
assert.equal(staleModel.accounts[0].data_status, "stale");
assert.equal(Object.hasOwn(staleModel.accounts[0], "financing"), false,
  "stale financing is not exposed on the public read model");
assert.equal(
  longBridgeFinancingDetails({
    platform: "longbridge",
    account_key: option.key,
    binding_status: "bound",
    identity_status: "partial_identity",
    identity_mismatch: false,
    data_status: "stale",
    observed_finished_at: staleStored.observed_finished_at,
    balances: staleStored.broker_reported_balances,
    cash: staleStored.cash,
    financing: staleStored.financing,
    return: { status: "unavailable", reason: "external_cashflow_required" },
  }),
  null,
  "stale financing stays out of the folded UI gate",
);

const unboundModel = buildAccountFactsReadModel({
  accountOptions: { longbridge: [option] },
  bindings: { schema_version: ACCOUNT_FACTS_BINDINGS_SCHEMA, bindings: [] },
  storedByAccount: new Map([[`longbridge:${option.key}`, withFinancing]]),
});
assert.equal(unboundModel.accounts[0].binding_status, "missing");
assert.equal(Object.hasOwn(unboundModel.accounts[0], "financing"), false);
assert.deepEqual(unboundModel.accounts[0].cash, []);

const mismatchBinding = {
  ...binding,
  target_name: "other-target",
};
const mismatchModel = buildAccountFactsReadModel({
  accountOptions: { longbridge: [option] },
  bindings: { schema_version: ACCOUNT_FACTS_BINDINGS_SCHEMA, bindings: [mismatchBinding] },
  storedByAccount: new Map([[`longbridge:${option.key}`, withFinancing]]),
});
assert.equal(mismatchModel.accounts[0].identity_mismatch, true);
assert.equal(Object.hasOwn(mismatchModel.accounts[0], "financing"), false);

const accountFresh = {
  platform: "longbridge",
  account_key: option.key,
  binding_status: "bound",
  identity_status: "partial_identity",
  identity_mismatch: false,
  data_status: "fresh",
  observed_finished_at: stored.observed_finished_at,
  balances: stored.broker_reported_balances,
  cash: stored.cash,
  financing: stored.financing,
  return: { status: "unavailable", reason: "external_cashflow_required" },
};
assert.deepEqual(
  longBridgeFinancingDetails(accountFresh)?.map((item) => item.currency),
  ["HKD", "USD"],
);
assert.equal(longBridgeRiskLevelLabel("0"), "安全");
assert.equal(longBridgeRiskLevelLabel("1"), "中等");
assert.equal(longBridgeRiskLevelLabel("2"), "预警");
assert.equal(longBridgeRiskLevelLabel("3"), "危险");
for (const rejected of [
  { ...accountFresh, data_status: "stale" },
  { ...accountFresh, binding_status: "missing" },
  { ...accountFresh, binding_status: "duplicate" },
  { ...accountFresh, identity_mismatch: true },
  { ...accountFresh, platform: "ibkr" },
  { ...accountFresh, financing: undefined },
  { ...accountFresh, financing: [] },
  {
    ...accountFresh,
    financing: [
      { currency: "USD", buy_power: "1" },
      { currency: "HKD", buy_power: "2" },
    ],
  },
  { ...accountFresh, financing: [{ currency: "USD", risk_level: "0" }, { currency: "USD", risk_level: "1" }] },
]) {
  assert.equal(longBridgeFinancingDetails(rejected), null);
}

const overview = readFileSync(join(root, "web/strategy-switch-console/frontend/src/OverviewPage.tsx"), "utf8");
assert.match(overview, /longBridgeFinancingDetails\(account\.facts\)/);
assert.match(overview, /overview-financing-details/);
assert.match(overview, /t\("融资详情"\)/);
assert.match(overview, /t\(longBridgeRiskLevelLabel\(row\.risk_level\)\)/);
assert.doesNotMatch(overview, /CashMargin|max_finance_amount\s*-|Number\(|parseFloat|toFixed/);
assert.match(overview, /longBridgeCashDetails\(account\.facts\)/);

const locales = readFileSync(join(root, "web/strategy-switch-console/frontend/src/locales.ts"), "utf8");
for (const key of [
  "融资详情", "最大融资金额", "剩余融资金额", "初始保证金", "维持保证金",
  "追缴保证金", "购买力", "风险等级", "安全", "中等", "预警", "危险",
]) {
  assert.match(locales, new RegExp(`"${key}":`));
}

console.log("longbridge_financing_validation ok");
