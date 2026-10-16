import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import worker, { __test } from "../web/strategy-switch-console/worker.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");
const hash = "a".repeat(64);
const now = Date.now() - 120000;
const at = offset => new Date(now + offset).toISOString();
const start = at(-86400000), end = at(0);
const base = {
  schema_version: "longbridge_account_snapshot_history.v1", snapshot_schema_version: "longbridge_account_snapshot.v1",
  account_scope: "PAPER", target_id: "synthetic-target", snapshot_atomic: false,
  source_binding: { kind: "deployment_scope_token_version", status: "bound", id: hash },
  observed_started_at: start, observed_finished_at: start, observation_date: start.slice(0, 10),
  broker_reported_balances: [{ currency: "USD", net_assets: "100", total_cash: "100" }],
  cash: [{ currency: "USD", available_cash: "100", frozen_cash: "0", settling_cash: "0" }],
};
const flow = { schema_version: "external_flow.v1", windows: [{ currency: "USD", date: end.slice(0, 10), period_start: start, period_end: end,
  source: "longbridge_cashflow", coverage: "complete", records: [{ source_ref: "b".repeat(64), type: "deposit", amount: "100",
    effective_at: at(-43200000), settlement_date: null, transfer_ref: null }] }] };
const latest = { ...base, observed_started_at: end, observed_finished_at: end, observation_date: end.slice(0, 10),
  broker_reported_balances: [{ currency: "USD", net_assets: "215", total_cash: "215" }],
  cash: [{ currency: "USD", available_cash: "215", frozen_cash: "0", settling_cash: "0" }], externalFlow: flow };
const settings = { ACCOUNT_FACTS_READ_MODEL_ENABLED: "true", CONSOLE_EXTERNAL_FLOW_ENABLED: "true",
  ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-sync-token", SESSION_SECRET: "synthetic-session", ALLOWED_GITHUB_LOGINS: "synthetic-reader" };
let outbound = 0;
const mf = new Miniflare({ modules: true, modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08", bindings: settings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: () => { outbound++; throw new Error("external calls forbidden"); },
});
try {
  const kv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG");
  const namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const option = { key: "synthetic", label: "Synthetic", target_name: "synthetic-target", service_name: "synthetic-service",
    deployment_selector: "synthetic-deployment", account_scope: "paper", account_selector: "PAPER", supported_domains: ["us_equity"] };
  const binding = { ...option, platform: "longbridge", account_key: option.key, target_id: "synthetic-target",
    source_binding: { kind: "deployment_scope_token_version", id: hash } };
  delete binding.key; delete binding.label; delete binding.supported_domains;
  await kv.put("account_options", JSON.stringify({ longbridge: [option] }));
  await kv.put("account_facts_bindings", JSON.stringify({ schema_version: "qsl_account_facts_bindings.v1", bindings: [binding] }));
  const env = { ...settings, STRATEGY_SWITCH_CONFIG: kv, STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace };
  const cookie = await __test.makeSession("synthetic-reader", [], settings);
  const post = (body, token = settings.ACCOUNT_FACTS_SYNC_TOKEN, override = {}) => worker.fetch(new Request("https://synthetic.example/api/account-facts/sync", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), { ...env, ...override });
  const accept = async body => { const r = await post(body); assert.equal(r.status, 200, await r.clone().text()); return r.json(); };
  const get = async (path, override = {}) => {
    const r = await worker.fetch(new Request(`https://synthetic.example${path}`, { headers: { Cookie: `qsl_switch_session=${cookie}` } }), { ...env, ...override });
    assert.equal(r.status, 200, await r.clone().text()); return r.json();
  };
  const historyPath = "/api/account-facts/history?platform=longbridge&account_key=synthetic&currency=USD";
  const summaryPath = "/api/performance/summary?scope=synthetic&platform=longbridge";
  await accept(base);
  const { externalFlow, ...legacyLatest } = latest;
  await accept(legacyLatest);
  const before = await get(summaryPath);
  const offBefore = await get(summaryPath, { CONSOLE_EXTERNAL_FLOW_ENABLED: "false" });
  assert.deepEqual(before, offBefore, "ON no source equals OFF through HTTP adapter");
  assert.equal((await post(latest, "wrong-synthetic-token")).status, 401);
  assert.equal((await post(latest, settings.ACCOUNT_FACTS_SYNC_TOKEN, { CONSOLE_EXTERNAL_FLOW_ENABLED: "false" })).status, 409);
  await accept(latest);
  assert.equal((await accept(latest)).unchanged, true);
  assert.deepEqual((await get(historyPath)).externalFlow, flow);
  const summary = await get(summaryPath);
  assert.ok(Math.abs(summary.twr_return_percent - 10) < 1e-10, JSON.stringify(summary));
  assert.equal(summary.cashflow_per_currency[0].approximate, true);
  assert.deepEqual(await get(summaryPath, { CONSOLE_EXTERNAL_FLOW_ENABLED: "false" }), offBefore, "OFF read ignores stored extension");
  const conflict = structuredClone(latest); conflict.externalFlow.windows[0].records[0].amount = "101";
  assert.equal((await post(conflict)).status, 409);
  assert.deepEqual((await get(historyPath)).externalFlow, flow, "conflict cannot change SQLite history");
  const malformed = structuredClone(latest); malformed.externalFlow.windows[0].records[0].source_ref = "raw-private-reference";
  assert.equal((await post(malformed)).status, 400);
  const wrong = structuredClone(latest); wrong.source_binding.id = "c".repeat(64);
  assert.equal((await post(wrong)).status, 409);
  const oversize = structuredClone(latest); oversize.externalFlow.windows[0].records = Array(257).fill(flow.windows[0].records[0]);
  assert.equal((await post(oversize)).status, 400);
  assert.equal(outbound, 0);
  console.log("external_flow_receiver_validation: ok (authenticated synthetic HTTP -> SQLite -> history -> Dietz; no outbound calls)");
} finally { await mf.dispose(); }
