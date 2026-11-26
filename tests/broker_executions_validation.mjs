import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { initializeExecutions, normalizeExecutions, mergeExecutions, putExecutions, readExecutions } from "../web/strategy-switch-console/application/account_facts/executions.js";
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
  quantity: "-1.5", price: "100.25", currency: "USD", commission: "-0.123456789000000001", commission_currency: "EUR", taxes: "0" };
const payload = { schema_version: "broker_executions.v1", target_id: binding.target_id,
  source_binding_id: binding.source_binding.id, account_scope: option.account_scope, account_selector: option.account_selector,
  period: { from: "2026-10-01", to: "2026-10-23" }, observed_at: new Date(Date.now() - 1000).toISOString(),
  source: "ibkr_flex", source_ref: "b".repeat(64), coverage: "reported_executions", records: [record] };
assert.deepEqual(normalizeExecutions(payload, { binding }), payload);
for (const patch of [{ quantity: "0" }, { price: "-1" }, { trade_date: "2026-10-24" },
  { local_time: "2026-10-23T24:00:00" }, { commission: "NaN" }, { time_zone: "not-a-zone" },
  { commission: "-0.1234567890123456789" }, { taxes: "1e-9" }, { quantity: "0.123456789" }]) {
  assert.throws(() => normalizeExecutions({ ...payload, records: [{ ...record, ...patch }] }, { binding }));
}
// US 23/5: an IBKR overnight fill from 20:00 ET carries the next day's trade date.
{
  const zoned = (zone, localTime) => ({ ...payload, records: [{ ...record, local_time: localTime, trade_date: "2026-10-23", time_zone: zone }] });
  assert.equal(normalizeExecutions(zoned("America/New_York", "2026-10-22T20:15:00"), { binding }).records[0].time_zone, "America/New_York");
  assert.throws(() => normalizeExecutions(zoned("UTC", "2026-10-22T20:15:00"), { binding }), undefined, "explicit non-Eastern zone keeps the same-day rule");
  assert.throws(() => normalizeExecutions(zoned("America/Los_Angeles", "2026-10-22T20:15:00"), { binding }));
}
for (const [localTime, tradeDate] of [["2026-10-22T20:00:00", "2026-10-23"], ["2026-10-22T23:59:59", "2026-10-23"],
  ["2026-09-30T21:15:00", "2026-10-01"], ["2026-10-23T02:30:00", "2026-10-23"]]) {
  const overnight = { ...payload, records: [{ ...record, local_time: localTime, trade_date: tradeDate }] };
  assert.equal(normalizeExecutions(overnight, { binding }).records[0].local_time, localTime, `${localTime} -> ${tradeDate} accepted`);
}
for (const [localTime, tradeDate] of [["2026-10-22T19:59:59", "2026-10-23"], ["2026-10-21T22:00:00", "2026-10-23"],
  ["2026-10-23T21:00:00", "2026-10-22"], ["2026-10-22T20:00:00", "2026-10-22T"], ["2026-09-31T20:00:00", "2026-10-02"]]) {
  assert.throws(() => normalizeExecutions({ ...payload, records: [{ ...record, local_time: localTime, trade_date: tradeDate }] }, { binding }),
    undefined, `${localTime} -> ${tradeDate} rejected`);
}
assert.throws(() => normalizeExecutions({ ...payload, account_selector: "U100002" }, { binding }), /execution_identity_mismatch/);
assert.throws(() => normalizeExecutions({ ...payload, coverage: "complete" }, { binding }));
assert.throws(() => normalizeExecutions({ ...payload, records: [record, record] }, { binding }));
assert.throws(() => mergeExecutions(payload, { ...payload, records: [{ ...record, price: "101" }] }), /execution_history_conflict/);
const unknownFee = { ...payload, records: [{ ...record, commission: null, commission_currency: null }] };
assert.equal(mergeExecutions(unknownFee, payload).records[0].commission, record.commission, "known fee may complete an unknown field");
assert.equal(mergeExecutions(payload, unknownFee).records[0].commission_currency, "EUR", "unknown cannot erase a known fee currency");
// Old rows only retain aggregate bounds; they are not evidence of individual reports.
const legacyContext = { ...binding, source_binding_id: binding.source_binding.id };
const legacySql = { exec: query => ({ toArray: () => query.includes("account_execution_reports") ? [] : [{ source_binding_id: binding.source_binding.id,
  context_json: JSON.stringify([binding.platform, binding.target_id, binding.account_scope,
    binding.account_selector, null, null]), payload_json: JSON.stringify(payload) }] }) };
const legacy = readExecutions(legacySql, legacyContext);
assert.equal(legacy.reports[0].period_status, "legacy_aggregate_bounds_unknown");
assert.deepEqual(legacy.reports[0].period, payload.period);

// A version rollback uses the original payload table without interval metadata.
const db = new DatabaseSync(":memory:");
try {
  const sql = { exec(query, ...params) {
    if (query.startsWith("SELECT")) return { toArray: () => db.prepare(query).all(...params) };
    if (params.length) db.prepare(query).run(...params);
    else db.exec(query);
  } };
  initializeExecutions(sql);
  putExecutions(sql, legacyContext, payload);
  const rollbackPeriod = { from: "2026-10-25", to: "2026-10-25" };
  const rollbackPayload = mergeExecutions(payload, { ...payload, period: rollbackPeriod, records: [] });
  db.prepare("UPDATE account_executions SET payload_json = ?").run(JSON.stringify(rollbackPayload));
  let reports = readExecutions(sql, legacyContext).reports;
  assert.deepEqual(reports.map(r => [r.period_status, r.period]), [
    ["legacy_aggregate_bounds_unknown", rollbackPayload.period], ["observed_report", payload.period],
  ]);
  const recoveredPeriod = { from: "2026-10-27", to: "2026-10-27" };
  putExecutions(sql, legacyContext, { ...payload, period: recoveredPeriod, records: [] });
  reports = readExecutions(sql, legacyContext).reports;
  assert.deepEqual(reports.map(r => r.period), [rollbackPayload.period, payload.period, recoveredPeriod]);
} finally { db.close(); }
const rangeSource = { coverage: "reported_executions", reports: [{ observed_at: payload.observed_at, period: payload.period }],
  records: [record, { ...record, execution_ref: "e".repeat(64), trade_date: "2026-08-01", local_time: null }] };
const rangeDeps = { executions: async () => rangeSource, json: body => body };
assert.equal((await executionStatsResponse([{ ...option, platform: "ibkr" }],
  { scope: option.key, range: "1M", today: "2026-10-25" }, {}, rangeDeps)).rows.length, 1);
assert.equal((await executionStatsResponse([{ ...option, platform: "ibkr" }],
  { scope: option.key, range: "ALL", today: "2026-10-25" }, {}, rangeDeps)).rows.length, 2);

// B02: one physical execution seen in two reports (different report_ref) is one
// execution; a supplemental field merges; a genuine disagreement stays visible.
{
  const sib = (key, rows) => ({ option: { ...option, key, platform: "ibkr" },
    source: { coverage: "reported_executions", reports: [{ observed_at: payload.observed_at, period: payload.period }], records: rows } });
  const a = sib("syn-a", [{ ...record, report_ref: "r".repeat(64), commission: null }]);
  const b = sib("syn-b", [{ ...record, report_ref: "s".repeat(64), commission: "1.00" }]);
  const run = async (items, groupOf) => executionStatsResponse(items.map(item => item.option),
    { scope: "all", range: "ALL", today: "2026-10-25", groupOf }, {},
    { executions: async opt => items.find(item => item.option.key === opt.key).source, json: body => body });
  const same = await run([a, b], () => "g1");
  assert.equal(same.reported_execution_count, 1, "two compatible reports of one execution count once");
  assert.equal(same.rows[0].commission, "1.00", "the compatible supplemental field merges");
  const apart = await run([a, b], option => option.key);
  assert.equal(apart.reported_execution_count, 2, "separate physical groups stay separate");
  const clash = sib("syn-b", [{ ...record, report_ref: "s".repeat(64), price: "999.99" }]);
  assert.equal((await run([a, clash], () => "g1")).reported_execution_count, 2, "a genuine conflict is not merged away");

  // Permutations of repeated conflicting versions and optional-field ambiguity
  // yield identical deduplicated/merged totals, per-currency and side counts.
  const perms = list => list.length <= 1 ? [list] : list.flatMap((x, i) => perms([...list.slice(0, i), ...list.slice(i + 1)]).map(rest => [x, ...rest]));
  const v1 = sib("p-1", [{ ...record, report_ref: "1".repeat(64), price: "100.25", commission: null }]);
  const v2a = sib("p-2", [{ ...record, report_ref: "2".repeat(64), price: "999.99", commission: null }]);
  const v2b = sib("p-3", [{ ...record, report_ref: "3".repeat(64), price: "999.99", commission: "1.00" }]);
  for (const order of perms([v1, v2a, v2b])) {
    const out = await run(order, () => "g1");
    assert.equal(out.reported_execution_count, 2, "repeated conflicting version counts once");
    assert.deepEqual(out.per_currency, [{ currency: "USD", reported_execution_count: 2, buy_execution_count: 0, sell_execution_count: 2 }]);
    assert.deepEqual(out.rows.map(r => [r.price, r.commission]), [["100.25", null], ["999.99", "1.00"]]);
    assert.equal(out.coverage.length, 3);
  }
  const optA = sib("o-1", [{ ...record, side: "BUY", report_ref: "4".repeat(64), commission: null, taxes: "0.10" }]);
  const optA2 = sib("o-4", [{ ...record, side: "BUY", report_ref: "5".repeat(64), commission: null, taxes: "0.10" }]);
  const optB = sib("o-2", [{ ...record, side: "BUY", report_ref: "6".repeat(64), commission: "1.00", taxes: null }]);
  const optC = sib("o-3", [{ ...record, side: "BUY", report_ref: "7".repeat(64), commission: "2.00", taxes: null }]);
  let baselineOpt = null;
  for (const order of perms([optA, optB, optC])) {
    const out = await run([...order, optA2], () => "g1");
    assert.equal(out.reported_execution_count, 3);
    assert.deepEqual(out.per_currency, [{ currency: "USD", reported_execution_count: 3, buy_execution_count: 3, sell_execution_count: 0 }]);
    const signature = out.rows.map(r => [r.commission, r.taxes]);
    if (!baselineOpt) baselineOpt = signature;
    else assert.deepEqual(signature, baselineOpt, "optional-field conflict outcome invariant across permutations");
  }

  // Unique compatibility across conflicting versions: a partial observation
  // matching only one version supplements it without creating a third count,
  // while ambiguous partials stay separate.
  const u1 = sib("u-1", [{ ...record, side: "BUY", report_ref: "a".repeat(64), commission: "1.00", taxes: "0.10" }]);
  const u2 = sib("u-2", [{ ...record, side: "BUY", report_ref: "b".repeat(64), commission: "2.00", taxes: "0.20" }]);
  const uPart = sib("u-3", [{ ...record, side: "BUY", report_ref: "c".repeat(64), commission: "1.00", taxes: null }]);
  for (const order of perms([u1, u2, uPart])) {
    const out = await run(order, () => "g1");
    assert.equal(out.reported_execution_count, 2);
    assert.deepEqual(out.per_currency, [{ currency: "USD", reported_execution_count: 2, buy_execution_count: 2, sell_execution_count: 0 }]);
    assert.deepEqual(out.rows.map(r => [r.commission, r.taxes]), [["1.00", "0.10"], ["2.00", "0.20"]]);
    assert.equal(out.coverage.length, 3);
  }
  const u1Part = sib("u-1p", [{ ...record, side: "BUY", report_ref: "d".repeat(64), commission: "1.00", taxes: null }]);
  const uPart2 = sib("u-3p", [{ ...record, side: "BUY", report_ref: "e".repeat(64), commission: null, taxes: "0.10" }]);
  for (const order of perms([u1Part, uPart2, u2])) {
    const out = await run(order, () => "g1");
    assert.equal(out.reported_execution_count, 2);
    assert.deepEqual(out.rows.map(r => [r.commission, r.taxes]), [["1.00", "0.10"], ["2.00", "0.20"]]);
  }
  const uAmbig = sib("u-4", [{ ...record, side: "BUY", report_ref: "f".repeat(64), commission: null, taxes: null, time_zone: "UTC" }]);
  const uAmbigRepeat = sib("u-5", [{ ...record, side: "BUY", report_ref: "9".repeat(64), commission: null, taxes: null, time_zone: "UTC" }]);
  const mixed = await run([u1, u2, uPart, uAmbig, uAmbigRepeat], () => "g1");
  assert.equal(mixed.reported_execution_count, 3);
  assert.deepEqual(mixed.rows.map(r => [r.commission, r.taxes, r.time_zone]), [[null, null, "UTC"], ["1.00", "0.10", null], ["2.00", "0.20", null]]);

  // Two uniquely attributable partials pointing to opposite conflicting versions
  // must not form a partial-only maximal clique across any of the 24 orders.
  const u2Part = sib("u-6", [{ ...record, side: "BUY", report_ref: "8".repeat(64), commission: null, taxes: "0.20" }]);
  for (const order of perms([u1, u2, uPart, u2Part])) {
    const out = await run(order, () => "g1");
    assert.equal(out.reported_execution_count, 2);
    assert.deepEqual(out.per_currency, [{ currency: "USD", reported_execution_count: 2, buy_execution_count: 2, sell_execution_count: 0 }]);
    assert.deepEqual(out.rows.map(r => [r.commission, r.taxes]), [["1.00", "0.10"], ["2.00", "0.20"]]);
    assert.equal(out.coverage.length, 4);
  }
  // Same-version pair of partials + conflicting full version, and mixed with
  // repeated ambiguous observations, both retain exact counts and rows.
  const u1PartTaxes = sib("u-7", [{ ...record, side: "BUY", report_ref: "0".repeat(64), commission: null, taxes: "0.10" }]);
  for (const order of perms([u1, u2, uPart, u1PartTaxes])) {
    const out = await run(order, () => "g1");
    assert.equal(out.reported_execution_count, 2);
    assert.deepEqual(out.per_currency, [{ currency: "USD", reported_execution_count: 2, buy_execution_count: 2, sell_execution_count: 0 }]);
  }
  const mixedBoth = await run([u1, u2, uPart, u2Part, uAmbig, uAmbigRepeat], () => "g1");
  assert.equal(mixedBoth.reported_execution_count, 3);
  assert.deepEqual(mixedBoth.per_currency, [{ currency: "USD", reported_execution_count: 3, buy_execution_count: 3, sell_execution_count: 0 }]);
  assert.deepEqual(mixedBoth.rows.map(r => [r.commission, r.taxes, r.time_zone]), [[null, null, "UTC"], ["1.00", "0.10", null], ["2.00", "0.20", null]]);

  // Two distinct mutually compatible ambiguous observations where one strictly
  // extends the other must both stay separate across all 24 report orders.
  const uAmbigShort = sib("u-8", [{ ...record, side: "BUY", report_ref: "7".repeat(64), commission: null, taxes: null, local_time: null, time_zone: "UTC" }]);
  for (const order of perms([u1, u2, uAmbigShort, uAmbig])) {
    const out = await run(order, () => "g1");
    assert.equal(out.reported_execution_count, 4);
    assert.deepEqual(out.per_currency, [{ currency: "USD", reported_execution_count: 4, buy_execution_count: 4, sell_execution_count: 0 }]);
    assert.equal(out.coverage.length, 4);
  }
  assert.equal((await run([u1, u2, uAmbigShort], () => "g1")).reported_execution_count, 3);
  assert.equal((await run([u1, u2, uAmbig], () => "g1")).reported_execution_count, 3);
  assert.equal((await run([u1, u2, uPart, u2Part, uAmbigShort, uAmbig, uAmbigRepeat], () => "g1")).reported_execution_count, 4);
}

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
  assert.equal(body.rows[0].commission, record.commission, "POST, SQLite and GET preserve every fee digit and its sign");
  assert.equal(body.win_rate_percent, null); assert.equal(body.realized_pnl, null);
  assert.ok(!JSON.stringify(body).includes(option.account_selector), "native account selector is not returned");
  assert.equal((await post({ ...payload, records: [{ ...record, price: "101" }] })).status, 409);
  assert.equal((await (await get()).json()).rows[0].price, "100.25", "conflicting data cannot overwrite executions");
  const firstPeriod = { ...payload, period: { from: "2026-10-25", to: "2026-10-25" }, records: [] };
  const secondPeriod = { ...payload, period: { from: "2026-10-27", to: "2026-10-27" }, records: [] };
  assert.equal((await post(firstPeriod)).status, 200);
  assert.equal((await post(secondPeriod)).status, 200);
  assert.equal((await (await post(secondPeriod)).json()).unchanged, true);
  const intervals = (await (await get()).json()).coverage[0].reports;
  assert.deepEqual(intervals.map(report => report.period), [payload.period, firstPeriod.period, secondPeriod.period]);
  assert.ok(intervals.every(report => report.period_status === "observed_report"));
  assert.equal((await (await get()).json()).coverage[0].reports_truncated, false);
  await setBinding({ ...binding, source_binding: { ...binding.source_binding, id: "d".repeat(64) } });
  assert.equal((await (await get()).json()).status, "not_connected", "rotated unknown source cannot inherit private records");
  await setBinding({ ...binding, source_binding: { ...binding.source_binding, id: "d".repeat(64) }, history_source_binding_ids: [binding.source_binding.id] });
  assert.equal((await (await get()).json()).rows.length, 1, "explicitly qualified history remains readable");
  assert.equal((await post()).status, 409, "qualified old source remains forbidden for new ingress");
  assert.equal(outbound, 0, "execution reads do not request snapshots, history, wallet or benchmark");
  console.log("broker_executions_validation: PASS (real SQLite, identity, exact repeats, conflicts, qualified rotation, fee currencies, no fabricated P/L)");
} finally { await mf.dispose(); }
