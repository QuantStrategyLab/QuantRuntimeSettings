import assert from "node:assert/strict";
import { performanceResponse } from "../web/strategy-switch-console/application/console_api/performance_routes.js";
import { validate } from "./console_api_contract_validation.mjs";

const sourceTime = new Date(Date.now() - 60_000).toISOString();
const fact = { platform: "ibkr", account_key: "synthetic-alpha", binding_status: "bound",
  aggregation_status: "included", broker_environment: "live", observed_finished_at: sourceTime,
  observation_date: sourceTime.slice(0, 10), balances: [{ currency: "USD", net_assets: "100" }],
  positions_scope: "stocks_only",
  positions: [{ symbol: "SYNTHETIC", currency: "USD", quantity: "2", market_value: "24", avg_cost: "10" }] };
const reads = { history: 0, wallet: 0, benchmarks: 0 };
const deps = {
  json: (body, status = 200) => Response.json(body, { status }),
  readSession: async () => ({ allowed: true }),
  accountOptions: async () => ({ options: {
    ibkr: [{ key: fact.account_key, broker_environment: "live" }],
    binance: [{ key: "synthetic-wallet", broker_environment: "live" }],
  } }),
  facts: async () => Response.json({ accounts: [fact] }),
  history: async () => { reads.history++; throw Error("unrelated history failed"); },
  wallet: async () => { reads.wallet++; throw Error("unrelated wallet failed"); },
  benchmarks: async () => { reads.benchmarks++; throw Error("unrelated benchmark failed"); },
};
const request = scope => new Request(`https://synthetic.invalid/api/performance/holdings?${scope}`);
for (const query of ["scope=synthetic-alpha&platform=ibkr", "scope=all"]) {
  const response = await performanceResponse(request(query), {}, deps);
  assert.equal(response.status, 200, "unrelated history cannot hide existing current positions");
  const body = await response.json();
  validate("holdings", body);
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].unrealized_pnl, 4);
  assert.equal(body.rows[0].as_of, sourceTime);
  assert.equal(body.rows[0].coverage, "stocks_only");
  assert.equal(body.status, "partial", "partial inventory scope is never promoted to a full inventory");
  assert.equal(body.coverage.length, query === "scope=all" ? 2 : 1);
}
assert.deepEqual(reads, { history: 0, wallet: 0, benchmarks: 0 });

for (const changes of [{ binding_status: "missing" }, { identity_mismatch: true },
  { aggregation_status: "duplicate" }, { aggregation_status: "conflict" }]) {
  const response = await performanceResponse(request("scope=synthetic-alpha&platform=ibkr"), {}, {
    ...deps, facts: async () => Response.json({ accounts: [{ ...fact, ...changes }] }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.rows.length, 0, "identity and duplicate protections survive source isolation");
}
assert.deepEqual(reads, { history: 0, wallet: 0, benchmarks: 0 });
const unknownEnvironment = await performanceResponse(request("scope=synthetic-alpha&platform=ibkr"), {}, {
  ...deps, facts: async () => Response.json({ accounts: [{ ...fact, broker_environment: null,
    aggregation_status: "partial_identity" }] }),
});
assert.equal((await unknownEnvironment.json()).rows.length, 1,
  "current scoped rows remain visible for the selected account without inventing its environment");
for (const source of [async () => Response.json({ error: "private-source-error" }, { status: 503 }),
  async () => { throw Error("private-source-error"); }]) {
  const response = await performanceResponse(request("scope=synthetic-alpha&platform=ibkr"), {}, {
    ...deps, facts: source,
  });
  assert.equal(response.status, 503, "an unreadable current source must remain unavailable");
  const body = await response.json();
  assert.equal(body.status, "unavailable");
  assert.ok(!body.rows?.length);
  assert.ok(!JSON.stringify(body).includes("private-source-error"));
}
assert.deepEqual(reads, { history: 0, wallet: 0, benchmarks: 0 });
const disabled = await performanceResponse(request("scope=synthetic-alpha&platform=ibkr"), {}, {
  ...deps, facts: async () => Response.json({ error: "account_facts_disabled" }, { status: 404 }),
});
assert.equal(disabled.status, 200, "the existing explicit model-disabled behavior is preserved");
assert.equal((await disabled.json()).rows.length, 0);
console.log("console_holdings_source_isolation_validation: PASS (current positions survive unrelated source failures; synthetic only)");
