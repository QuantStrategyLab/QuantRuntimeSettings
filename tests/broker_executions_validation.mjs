import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { normalizeExecutions, mergeExecutions } from "../web/strategy-switch-console/application/account_facts/executions.js";
import { executionStatsResponse } from "../web/strategy-switch-console/application/console_api/executions.js";
const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");
const option = { key: "synthetic-ibkr", label: "Synthetic", account_scope: "synthetic-live",
  target_name: "synthetic-target", service_name: "synthetic-service", deployment_selector: "synthetic-deploy", account_selector: "U100001" };
const binding = { ...option, platform: "ibkr", account_key: option.key, target_id: option.target_name,
  source_binding: { kind: "deployment_runtime_account", id: "a".repeat(64) } };
delete binding.key; delete binding.label;
const record = { execution_ref: "c".repeat(64), report_ref: "b".repeat(64), trade_date: "2026-10-23",
  local_time: "2026-10-23T09:31:00", time_zone: null, symbol: "SYNTH", asset_category: "STK", side: "SELL",
  quantity: "-1.5", price: "100.25", currency: "USD", commission: "-0.35", commission_currency: "EUR", taxes: "0" };
const payload = { schema_version: "broker_executions.v1", target_id: binding.target_id,
  source_binding_id: binding.source_binding.id, account_scope: option.account_scope, account_selector: option.account_selector,
  period: { from: "2026-10-01", to: "2026-10-23" }, observed_at: new Date(Date.now() - 1000).toISOString(),
  source: "ibkr_flex", source_ref: "b".repeat(64), coverage: "reported_executions", records: [record] };
assert.deepEqual(normalizeExecutions(payload, { binding }), payload);
for (const patch of [{ quantity: "0" }, { price: "-1" }, { trade_date: "2026-10-24" },
  { local_time: "2026-10-23T24:00:00" }, { commission: "NaN" }, { time_zone: "not-a-zone" }]) {
  assert.throws(() => normalizeExecutions({ ...payload, records: [{ ...record, ...patch }] }, { binding }));
}
assert.throws(() => normalizeExecutions({ ...payload, account_selector: "U100002" }, { binding }), /execution_identity_mismatch/);
assert.throws(() => normalizeExecutions({ ...payload, coverage: "complete" }, { binding }));
assert.throws(() => normalizeExecutions({ ...payload, records: [record, record] }, { binding }));
assert.throws(() => mergeExecutions(payload, { ...payload, records: [{ ...record, price: "101" }] }), /execution_history_conflict/);
const unknownFee = { ...payload, records: [{ ...record, commission: null, commission_currency: null }] };
assert.equal(mergeExecutions(unknownFee, payload).records[0].commission, "-0.35", "known fee may complete an unknown field");
assert.equal(mergeExecutions(payload, unknownFee).records[0].commission_currency, "EUR", "unknown cannot erase a known fee currency");
const rangeSource = { coverage: "reported_executions", reports: [{ observed_at: payload.observed_at, period: payload.period }],
  records: [record, { ...record, execution_ref: "e".repeat(64), trade_date: "2026-08-01", local_time: null }] };
const rangeDeps = { executions: async () => rangeSource, json: body => body };
assert.equal((await executionStatsResponse([{ ...option, platform: "ibkr" }],
  { scope: option.key, range: "1M", today: "2026-10-25" }, {}, rangeDeps)).rows.length, 1);
assert.equal((await executionStatsResponse([{ ...option, platform: "ibkr" }],
  { scope: option.key, range: "ALL", today: "2026-10-25" }, {}, rangeDeps)).rows.length, 2);

const settings = { SESSION_SECRET: "synthetic-session", ALLOWED_GITHUB_LOGINS: "synthetic-reader",
  ACCOUNT_FACTS_READ_MODEL_ENABLED: "true", IBKR_ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-ibkr-token",
  SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-other-token" };
let outbound = 0;
const mf = new Miniflare({ modules: true, modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08", bindings: settings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  kvNamespaces: ["STRATEGY_SWITCH_CONFIG"], outboundService: () => { outbound++; return new Response("offline", { status: 503 }); } });
try {
  const kv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG"), namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const env = { ...settings, STRATEGY_SWITCH_CONFIG: kv, STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace };
  const setBinding = value => kv.put("account_facts_bindings", JSON.stringify({ schema_version: "qsl_account_facts_bindings.v1", bindings: [value] }));
  await kv.put("account_options", JSON.stringify({ ibkr: [option] })); await setBinding(binding);
  const cookie = await __test.makeSession("synthetic-reader", [], settings);
  const get = (suffix = "", loggedIn = true) => worker.fetch(new Request(
    "https://synthetic.example/api/performance/trades?scope=synthetic-ibkr&platform=ibkr&range=ALL" + suffix,
    { headers: loggedIn ? { Cookie: `qsl_switch_session=${cookie}` } : {} }), env);
  const post = (body = payload, token = settings.IBKR_ACCOUNT_FACTS_SYNC_TOKEN) => worker.fetch(new Request(
    "https://synthetic.example/api/account-facts/executions/sync", { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), env);
  assert.equal((await get("", false)).status, 401);
  assert.equal((await (await get()).json()).reported_execution_count, null, "unconnected is never a confirmed zero");
  assert.equal((await post(payload, "wrong-token")).status, 401);
  assert.equal((await post(payload, settings.SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN)).status, 403);
  assert.equal((await post({ ...payload, account_selector: "U100002" })).status, 409);
  assert.equal((await post({ ...payload, records: [{ ...record, report_ref: "f".repeat(64) }] })).status, 400,
    "incoming rows must belong to the exact collected report");
  let response = await post(); assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).record_count, 1);
  assert.equal((await (await post()).json()).unchanged, true);
  response = await get(); assert.equal(response.status, 200);
  let body = await response.json(); assert.equal(body.status, "partial");
  assert.equal(body.rows.length, 1); assert.equal(body.reported_execution_count, 1);
  assert.equal(body.rows[0].quantity, "-1.5"); assert.equal(body.rows[0].commission_currency, "EUR");
  assert.equal(body.win_rate_percent, null); assert.equal(body.realized_pnl, null);
  assert.ok(!JSON.stringify(body).includes(option.account_selector), "native account selector is not returned");
  assert.equal((await post({ ...payload, records: [{ ...record, price: "101" }] })).status, 409);
  assert.equal((await (await get()).json()).rows[0].price, "100.25", "conflicting data cannot overwrite executions");
  await setBinding({ ...binding, source_binding: { ...binding.source_binding, id: "d".repeat(64) } });
  assert.equal((await (await get()).json()).status, "not_connected", "rotated unknown source cannot inherit private records");
  await setBinding({ ...binding, source_binding: { ...binding.source_binding, id: "d".repeat(64) }, history_source_binding_ids: [binding.source_binding.id] });
  assert.equal((await (await get()).json()).rows.length, 1, "explicitly qualified history remains readable");
  assert.equal((await post()).status, 409, "qualified old source remains forbidden for new ingress");
  assert.equal(outbound, 0, "execution reads do not request snapshots, history, wallet or benchmark");
  console.log("broker_executions_validation: PASS (real SQLite, identity, exact repeats, conflicts, qualified rotation, fee currencies, no fabricated P/L)");
} finally { await mf.dispose(); }
