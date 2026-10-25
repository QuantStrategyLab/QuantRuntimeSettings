import assert from "node:assert/strict";
import { normalizeAccountFactsHistoryPayload, buildAccountFactsReadModel } from "../web/strategy-switch-console/account_facts.js";
import { performanceBlocks } from "../web/strategy-switch-console/application/console_api/performance.js";
import { validate } from "./console_api_contract_validation.mjs";

const now = Date.parse("2026-10-20T12:00:00Z"), id = "a".repeat(64);
const option = { key: "example-paper", target_name: "example-paper", service_name: "example-service",
  deployment_selector: "example-paper", account_selector: "PAPER", account_scope: "paper", broker_environment: "paper" };
const binding = { ...option, platform: "longbridge", account_key: option.key, target_id: option.key,
  source_binding: { kind: "deployment_scope_token_version", id } };
delete binding.key; delete binding.broker_environment;
const payload = { schema_version: "longbridge_account_snapshot_history.v1", snapshot_schema_version: "longbridge_account_snapshot.v1",
  account_scope: "PAPER", target_id: option.key, source_binding: { kind: "deployment_scope_token_version", status: "bound", id },
  observed_started_at: "2026-10-20T11:58:00Z", observed_finished_at: "2026-10-20T11:59:00Z", observation_date: "2026-10-20",
  snapshot_atomic: false, broker_reported_balances: [{ currency: "USD", net_assets: "10", total_cash: "2" }],
  cash: [{ currency: "USD", available_cash: "2", frozen_cash: "0", settling_cash: "0" }],
  broker_reported_positions_scope: "stocks_only", broker_reported_positions_complete: true,
  broker_reported_positions: [{ symbol: "SYNTH.US", quantity: "-0.125", currency: "USD", market_value: null }] };
const normalize = raw => normalizeAccountFactsHistoryPayload(raw, { now });
const read = (record, at = now) => buildAccountFactsReadModel({ accountOptions: { longbridge: [option] },
  bindings: { schema_version: "qsl_account_facts_bindings.v1", bindings: [binding] },
  storedByAccount: new Map([["longbridge:" + option.key, record]]), now: at }).accounts[0];
const inventory = normalize(payload), row = read(inventory);
assert.equal(row.data_status, "fresh");
assert.equal(row.positions_complete, true);
assert.equal(row.positions[0].market_value, null, "a missing quote is unknown, never zero");
assert.equal(row.positions[0].quantity, "-0.125");
const holdings = account => performanceBlocks({ accounts: [account], histories: [], benchmarks: [],
  range: "ALL", today: "2026-10-20", year: 2026, month: 10, failed: [] }).holdings;
const known = holdings(row);
const validateHoldings = block => validate("holdings", { schema_version: "console_api.v1", scope: "example-paper", range: "ALL", ...block });
validateHoldings(known);
assert.equal(known.rows[0].quantity, -0.125);
assert.equal(known.rows[0].market_value, null); assert.equal(known.rows[0].unrealized_pnl, null);
assert.equal(known.status, "partial", "inventory coverage does not invent a price or P/L");
assert.equal(known.coverage[0].complete, true);

const empty = read(normalize({ ...payload, broker_reported_positions: [] }));
assert.equal(empty.positions_complete, true); assert.deepEqual(empty.positions, []);
const noStocks = holdings(empty);
assert.equal(noStocks.status, "ok"); assert.equal(noStocks.unavailable_reason, null);
assert.deepEqual(noStocks.rows, []); validateHoldings(noStocks);
for (const patch of [
  { broker_reported_positions_complete: false }, { broker_reported_positions_complete: null },
  { broker_reported_positions: null }, { broker_reported_positions: [payload.broker_reported_positions[0], payload.broker_reported_positions[0]] },
  { broker_reported_positions: [{ ...payload.broker_reported_positions[0], currency: "usd" }] },
  { broker_reported_positions: [{ ...payload.broker_reported_positions[0], quantity: "NaN" }] },
]) assert.throws(() => normalize({ ...payload, ...patch }));
const missingRows = { ...payload }; delete missingRows.broker_reported_positions;
assert.throws(() => normalize(missingRows));
const unconfirmed = { ...payload }; delete unconfirmed.broker_reported_positions_complete;
assert.throws(() => normalize(unconfirmed), "null valuation requires an explicit complete inventory marker");
assert.throws(() => normalize({ ...unconfirmed, broker_reported_positions: [] }), "unknown inventories never become known empty");
const stale = read(inventory, now + 37 * 3600000);
assert.equal(stale.data_status, "stale");
assert.equal(stale.positions, undefined); assert.equal(stale.positions_complete, undefined);
assert.equal(holdings({ ...row, positions: undefined, positions_scope: undefined, positions_complete: undefined }).unavailable_reason,
  "positions_not_connected", "an absent inventory remains disconnected");
console.log("account_facts_stock_inventory_validation: PASS (bound stock inventory, nullable price, complete empty vs absent, partial P/L, malformed and stale rejection)");
