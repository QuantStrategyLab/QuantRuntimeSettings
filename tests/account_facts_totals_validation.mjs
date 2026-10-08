import assert from "node:assert/strict";
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
    const start = new Date(now - (spec.stale ? 40 * 3600000 : 120000)).toISOString();
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
