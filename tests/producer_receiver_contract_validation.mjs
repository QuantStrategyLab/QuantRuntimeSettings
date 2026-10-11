// Real pinned producer output -> authenticated receiver -> SQLite -> read model.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { __test } from "../web/strategy-switch-console/worker.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");
const [ibkrRoot, schwabRoot] = process.argv.slice(2);
assert.ok(ibkrRoot && schwabRoot, "Pass exact pinned IBKR and Schwab checkout paths");
const fixtures = JSON.parse(execFileSync("python3", [
  fileURLToPath(new URL("./generate_producer_contract.py", import.meta.url)),
  "--ibkr", ibkrRoot, "--schwab", schwabRoot, "--now", new Date().toISOString(),
], { encoding: "utf8" }));
const persist = await mkdtemp(join(tmpdir(), "qrs-producer-roundtrip-"));
let outboundCalls = 0;
const nativeFetch = globalThis.fetch;
globalThis.fetch = () => { outboundCalls++; throw new Error("external HTTP forbidden"); };
const settings = {
  SESSION_SECRET: "synthetic-session-only", ALLOWED_GITHUB_LOGINS: "synthetic-reader",
  IBKR_ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-ibkr-token", SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-schwab-token",
  ACCOUNT_FACTS_READ_MODEL_ENABLED: "true",
};
const mf = new Miniflare({
  modules: true, modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08", bindings: settings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  durableObjectsPersist: persist, kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: () => { outboundCalls++; throw new Error("external HTTP forbidden"); },
});
try {
  const kv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG");
  const namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const env = { ...settings, STRATEGY_SWITCH_CONFIG: kv, STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace };
  const cookie = await __test.makeSession("synthetic-reader", [], settings);
  const get = async path => {
    const response = await worker.fetch(new Request(`https://synthetic.example${path}`, {
      headers: { Cookie: `qsl_switch_session=${cookie}` },
    }), env);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  for (const platform of ["ibkr", "schwab"]) {
    const sample = fixtures[platform];
    const extended = sample.archive_future_contract;
    const published = sample.published_current_contract;
    const newer = sample.published_newer_contract;
    const expectedScope = platform === "ibkr" ? "stocks_only" : "strategy_symbols_only";
    const account = {
      key: "synthetic", label: "Synthetic contract", target_name: "synthetic-target",
      service_name: "synthetic-service", deployment_selector: "synthetic-deployment",
      account_scope: platform === "ibkr" ? "live-synthetic" : "live",
      account_selector: platform === "ibkr" ? "U00000001" : "live",
    };
    const binding = {
      platform, account_key: account.key, account_scope: account.account_scope,
      target_name: account.target_name, service_name: account.service_name,
      deployment_selector: account.deployment_selector, account_selector: account.account_selector,
      target_id: "synthetic-target", source_binding: { kind: "deployment_runtime_account", id: extended.source_binding.id },
      ...(platform === "schwab" ? { broker_account_hash: "synthetic-account-hash" } : {}),
    };
    await kv.put("account_options", JSON.stringify({ [platform]: [account] }));
    await kv.put("account_facts_bindings", JSON.stringify({ schema_version: "qsl_account_facts_bindings.v1", bindings: [binding] }));
    const post = (body, token = settings[`${platform.toUpperCase()}_ACCOUNT_FACTS_SYNC_TOKEN`]) => worker.fetch(
      new Request("https://synthetic.example/api/account-facts/sync", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      }), env,
    );
    const read = async () => (await get("/api/account-facts")).accounts.find(row => row.platform === platform);
    const accept = async body => {
      const response = await post(body);
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    // The real current publisher strips both fields; the receiver must still accept it.
    assert.equal(Object.hasOwn(published, "broker_reported_positions"), false);
    assert.equal(Object.hasOwn(published, "broker_reported_positions_scope"), false);
    await accept(published);
    assert.equal(Object.hasOwn(await read(), "positions"), false);
    // Pre-strip archive output is a FUTURE publication contract, never evidence of activation.
    assert.equal(extended.broker_reported_positions_scope, expectedScope);
    const stub = namespace.get(namespace.idFromName("runtime-instances"));
    await accept(extended);
    assert.deepEqual((await read()).positions, extended.broker_reported_positions);
    assert.equal((await read()).positions_scope, expectedScope);
    assert.equal((await accept(extended)).unchanged, true);
    if (platform === "ibkr") assert.equal((await read()).balances[0].net_assets, null);
    else {
      assert.equal(extended.broker_reported_positions[0].currency_source, "owner_confirmed");
      assert.deepEqual((await read()).cash, []);
    }
    // Reject malformed provenance and unknown keys without contaminating accepted data.
    const invalidRows = [
      { ...extended.broker_reported_positions[0], unexpected: "field" },
      { ...extended.broker_reported_positions[0], currency_source: "broker" },
      { ...extended.broker_reported_positions[0], currency_source: null },
      ...(platform === "schwab" ? [{ ...extended.broker_reported_positions[0], currency: "HKD" }] :
        [{ ...extended.broker_reported_positions[0], currency_source: "owner_confirmed" }]),
    ];
    for (const row of invalidRows) {
      const rejected = await post({ ...extended, broker_reported_positions: [row] });
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).error, "invalid_account_facts_positions");
      assert.deepEqual((await read()).positions, extended.broker_reported_positions);
    }
    const valid = extended;
    for (const [body, status] of [
      [{ ...valid, source_binding: { ...valid.source_binding, id: "0".repeat(64) } }, 409],
      [{ ...valid, target_id: "wrong-target" }, 409],
      [{ ...valid, ...(platform === "ibkr" ? { account_ids: ["U00000002"] } : { account_hash: "wrong-hash" }) }, 409],
      [{ ...extended, broker_reported_positions_scope: platform === "ibkr" ? "strategy_symbols_only" : "stocks_only" }, 400],
      [{ ...valid, account_key: "caller-assigned" }, 400],
    ]) {
      assert.equal((await post(body)).status, status);
      assert.deepEqual((await read()).positions, extended.broker_reported_positions);
    }
    assert.equal((await post(extended, "wrong-token")).status, 401);
    // Real newer stripped output removes latest holdings without erasing previous-day evidence.
    await accept(newer);
    const latest = await read();
    assert.equal(latest.data_status, "fresh");
    assert.equal(Object.hasOwn(latest, "positions"), false);
    assert.equal(Object.hasOwn(latest, "positions_scope"), false);
    const context = {
      platform, account_key: account.key, account_scope: account.account_scope,
      account_selector: account.account_selector, target_id: binding.target_id,
      source_binding_id: binding.source_binding.id,
      ...(platform === "schwab" ? { broker_account_hash: binding.broker_account_hash } : {}),
    };
    const response = await stub.fetch("https://runtime-instances/", {
      method: "POST", body: JSON.stringify({ action: "account_facts_history_read", ...context }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const history = await response.json();
    assert.ok(history.days.length >= 2);
    const old = history.days.find(day => day.payload.observation_date === extended.observation_date).payload;
    assert.deepEqual(old.broker_reported_positions, extended.broker_reported_positions);
    assert.equal(old.broker_reported_positions_scope, expectedScope);
    const series = await get(`/api/account-facts/history?platform=${platform}&account_key=${account.key}&currency=USD`);
    if (platform === "ibkr") {
      assert.deepEqual(series.series.points, []);
      assert.equal(series.series.gap_dates.length, history.days.length, "missing assets are never zero");
    } else assert.deepEqual(series.series.points.map(row => row.net_assets), history.days.map(() => "123.45"));
    for (const label of ["missing", "empty", "invalid"]) {
      assert.equal(Object.hasOwn(sample[label], "broker_reported_positions"), false);
      assert.deepEqual(sample[label].broker_reported_balances, newer.broker_reported_balances);
    }
  }
  assert.equal(outboundCalls, 0, "neither receiver nor projections may make external HTTP calls");
  console.log("Pinned contracts passed: stripped IBKR/Schwab accepted; IBKR/Schwab archive accepted with provenance preserved (synthetic/offline).");
} finally {
  await mf.dispose();
  globalThis.fetch = nativeFetch;
  await rm(persist, { recursive: true, force: true });
}
