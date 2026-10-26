import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { normalizeExternalFlow, mergeExternalFlow } from "../web/strategy-switch-console/application/account_facts/external_flow.js";
import { applyNativeDailyReturns } from "../web/strategy-switch-console/application/console_api/native_daily_returns.js";
import { performanceBlocks } from "../web/strategy-switch-console/application/console_api/performance.js";
import { intervalFlows, applyCashflowPerformance } from "../web/strategy-switch-console/application/console_api/cashflow_performance.js";
const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");
const record = { source_ref: "c".repeat(64), type: "deposit", amount: "100.12345678", effective_date: "2026-10-02", settlement_date: null, transfer_ref: null };
const window = { currency: "USD", date: "2026-10-23", period_start: "2026-09-25", period_end: "2026-10-23",
  time_precision: "date", coverage: "reported", source: "ibkr_flex", records: [record] };
const flow = { schema_version: "external_flow.v2", windows: [window] };
assert.deepEqual(normalizeExternalFlow(flow), flow);
assert.deepEqual(mergeExternalFlow(flow, flow), flow);
assert.equal(intervalFlows(flow, "USD", "2026-10-01T12:00:00Z", "2026-10-02T12:00:00Z"), null, "date-only flows never acquire a Dietz weight or imply zero cash flow");
for (const mutate of [
  w => { w.coverage = "complete"; }, w => { w.records[0].effective_at = "2026-10-02T00:00:00Z"; },
  w => { w.records[0].effective_date = "2026-02-30"; }, w => { w.records[0].effective_date = "2026-09-24"; },
  w => { w.records[0].source_ref = "native-private-id"; }, w => { w.period_start = "2026-09-01"; },
  w => { w.records[0].amount = "-100"; }, w => { w.records[0].type = "dividend"; },
]) { const copy = structuredClone(flow); mutate(copy.windows[0]); assert.throws(() => normalizeExternalFlow(copy)); }
assert.throws(() => normalizeExternalFlow({ ...flow, schema_version: "external_flow.v1" }));
const conflict = structuredClone(flow); conflict.windows[0].records[0].amount = "101";
assert.throws(() => mergeExternalFlow(flow, conflict), /conflict/);
const overlapping = structuredClone(flow); overlapping.windows[0].period_start = "2026-10-01";
assert.equal(mergeExternalFlow(flow, overlapping).windows.length, 2, "overlapping reports preserve stable event identity");
const precise = { schema_version: "external_flow.v1", windows: [{ currency: "USD", date: "2026-10-03",
  period_start: "2026-10-02T12:00:00Z", period_end: "2026-10-03T12:00:00Z", coverage: "complete", source: "ibkr_flex",
  records: [{ ...record, source_ref: "d".repeat(64), effective_at: "2026-10-03T12:00:00Z" }] }] };
delete precise.windows[0].records[0].effective_date;
assert.equal(intervalFlows(mergeExternalFlow(precise, flow), "USD", precise.windows[0].period_start, precise.windows[0].period_end).length, 1, "v1 exact-time facts remain usable after the v2 upgrade");

// Exercise the production calculation order: date-only facts cannot erase native returns.
const nativeRow = (date, value) => ({ status: "available", method: "native_ibkr_twr", source: "ChangeInNAV.twr",
  unit: "ratio", currency: "USD", period: { from: date, to: date }, value });
const nativeInput = { accounts: [{ platform: "ibkr", account_key: "synthetic-ibkr", return: { daily: [nativeRow("2026-10-22", "0.1"), nativeRow("2026-10-23", "-0.05")] } }],
  histories: [{ id: "synthetic-ibkr", currency: "USD", externalFlow: flow, points: [{ date: "2026-10-22", value: 100, observed_at: "2026-10-22T12:00:00Z" },
    { date: "2026-10-23", value: 1100, observed_at: "2026-10-23T12:00:00Z" }] }], range: "ALL", today: "2026-10-24", year: 2026, month: 10, failed: [], benchmarks: [] };
const result = applyNativeDailyReturns(applyCashflowPerformance(performanceBlocks(nativeInput), nativeInput, { CONSOLE_EXTERNAL_FLOW_ENABLED: "true" }), nativeInput);
assert.ok(Math.abs(result.summary.twr_return_percent - 4.5) < 1e-10);
assert.deepEqual(result.returns.points.map(p => p.daily_return_percent), [10, -5]);
assert.equal(result.assets.points.at(-1).value, 1100);
assert.equal(result.summary.amount, null, "unknown money P/L is not manufactured from a dated deposit");

const option = { key: "synthetic-ibkr", label: "Synthetic", account_scope: "synthetic-live", target_name: "synthetic-target",
  service_name: "synthetic-service", deployment_selector: "synthetic-deploy", account_selector: "U100001" };
const binding = { ...option, platform: "ibkr", account_key: option.key, target_id: option.target_name,
  source_binding: { kind: "deployment_runtime_account", id: "a".repeat(64) } };
delete binding.key; delete binding.label;
const payload = { schema_version: "account_external_flow.v1", target_id: binding.target_id, source_binding_id: binding.source_binding.id,
  account_scope: option.account_scope, account_selector: option.account_selector, externalFlow: flow };
const settings = { SESSION_SECRET: "synthetic-session", ALLOWED_GITHUB_LOGINS: "synthetic-reader", ACCOUNT_FACTS_READ_MODEL_ENABLED: "true",
  CONSOLE_EXTERNAL_FLOW_ENABLED: "false", IBKR_ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-ibkr-token", SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-other-token" };
let outbound = 0;
const mf = new Miniflare({ modules: true, modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)), compatibilityDate: "2026-06-08", bindings: settings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  kvNamespaces: ["STRATEGY_SWITCH_CONFIG"], outboundService: () => { outbound++; throw new Error("offline"); } });
try {
  const kv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG"), namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const env = { ...settings, STRATEGY_SWITCH_CONFIG: kv, STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace };
  const setBinding = value => kv.put("account_facts_bindings", JSON.stringify({ schema_version: "qsl_account_facts_bindings.v1", bindings: [value] }));
  await kv.put("account_options", JSON.stringify({ ibkr: [option] })); await setBinding(binding);
  const cookie = await __test.makeSession("synthetic-reader", [], settings);
  const get = path => worker.fetch(new Request(`https://synthetic.example${path}`, { headers: { Cookie: `qsl_switch_session=${cookie}` } }), env);
  const post = (body = payload, token = settings.IBKR_ACCOUNT_FACTS_SYNC_TOKEN, override = {}) => worker.fetch(new Request(
    "https://synthetic.example/api/account-facts/external-flow/sync", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), { ...env, ...override });
  const factsBefore = await (await get("/api/account-facts")).json();
  assert.equal((await post(payload, "wrong")).status, 401);
  assert.equal((await post(payload, settings.SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN)).status, 409);
  assert.equal((await post({ ...payload, account_selector: "U100002" })).status, 409);
  assert.equal((await post({ ...payload, account_key: option.key })).status, 400);
  assert.equal((await post({ ...payload, externalFlow: precise })).status, 409, "the existing switch still blocks exact-time flow ingress and calculation");
  let response = await post(); assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).record_count, 1);
  assert.equal((await (await post()).json()).unchanged, true);
  const history = await (await get("/api/account-facts/history?platform=ibkr&account_key=synthetic-ibkr&currency=USD")).json();
  assert.deepEqual(history.externalFlow, flow);
  assert.deepEqual(await (await get("/api/account-facts")).json(), factsBefore, "historical flows never fabricate a current balance or observation time");
  assert.equal((await post({ ...payload, externalFlow: conflict })).status, 409);
  assert.deepEqual((await (await get("/api/account-facts/history?platform=ibkr&account_key=synthetic-ibkr&currency=USD")).json()).externalFlow, flow);
  const rotated = { ...binding, source_binding: { ...binding.source_binding, id: "e".repeat(64) } };
  await setBinding(rotated);
  assert.equal((await post()).status, 409);
  assert.equal((await (await get("/api/account-facts/history?platform=ibkr&account_key=synthetic-ibkr&currency=USD")).json()).externalFlow, undefined);
  assert.equal(outbound, 0);
  console.log("external_flow_date_precision_validation: PASS (native dates, authenticated HTTP, real SQLite, no snapshot mutation, conflicts, source isolation)");
} finally { await mf.dispose(); }
