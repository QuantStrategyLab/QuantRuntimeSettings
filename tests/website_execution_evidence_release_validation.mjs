import assert from "node:assert/strict";
import { test } from "node:test";
import { __test } from "../web/strategy-switch-console/worker.js";
import { strategySummary } from "../web/strategy-switch-console/application/console_api/operations.js";

const options = { longbridge: [{ key: "synthetic", target_name: "synthetic", broker_environment: "paper" }] };
const accounts = [{ platform: "longbridge", key: "synthetic" }];
const deps = {
  profiles: async () => [{ profile: "synthetic_profile", domain: "us_equity" }],
  health: async () => Response.json({ data_status: "ready", strategies: [{ profile: "synthetic_profile", status: "healthy", score: 90 }] }),
};
const request = new Request("https://console.example/api/strategies/summary");
const env = { RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-token" };

test("configuration evidence reaches the strategy projection without claiming runtime authority", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ variables: [{ name: "RUNTIME_TARGET_JSON", value: JSON.stringify({ target_name: "synthetic", strategy_profile: "synthetic_profile", execution_mode: "paper", dry_run_only: false }) }] });
  try {
    const current = await __test.loadCurrentStrategies(options, env);
    const result = await strategySummary(request, {}, deps, accounts, current);
    const row = result.strategies[0].configured_accounts[0];
    assert.equal(row.execution_evidence.value, "paper");
    assert.equal(row.execution_evidence.status, "confirmed");
    assert.equal(row.execution_evidence.runtime_observation_status, "unknown");
    assert.equal(result.execution_authority_granted, false);
    assert.equal(result.no_order, true);
  } finally { globalThis.fetch = original; }
});

test("403, server errors and a failed later page remain failures rather than empty configuration", async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, expected] of [[403, "permission_denied"], [500, "read_failed"]]) {
      globalThis.fetch = async () => Response.json({}, { status });
      const current = await __test.loadCurrentStrategies(options, env);
      const result = await strategySummary(request, {}, deps, accounts, current);
      assert.equal(current.longbridge.synthetic.execution_evidence.status, expected);
      assert.equal(result.account_assignment_status, "read_failed");
      assert.equal(result.status, "partial");
      assert.equal(result.account_assignment_read_failures[0].status, expected);
      assert.deepEqual(result.strategies[0].configured_accounts, []);
    }
    globalThis.fetch = async url => String(url).includes("page=2")
      ? Response.json({}, { status: 500 })
      : Response.json({ variables: [{ name: "RUNTIME_TARGET_JSON", value: JSON.stringify({ target_name: "synthetic", strategy_profile: "synthetic_profile", execution_mode: "paper" }) }] }, { headers: { Link: '<https://api.github.com/ignored>; rel="next"' } });
    const current = await __test.loadCurrentStrategies(options, env);
    assert.equal(current.longbridge.synthetic.execution_evidence.status, "read_failed");
    assert.equal(current.longbridge.synthetic.execution_evidence.value, "unknown");
  } finally { globalThis.fetch = original; }
});
