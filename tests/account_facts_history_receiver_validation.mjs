import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import worker, { __test, RuntimeInstances } from "../web/strategy-switch-console/worker.js";
import { normalizeAccountFactsBindings, historyRetentionCutoff } from "../web/strategy-switch-console/account_facts.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");
const currentId = "a".repeat(64), priorId = "b".repeat(64), unknownId = "c".repeat(64);
const now = Date.now(), today = new Date(now).toISOString().slice(0, 10);
const dateAgo = days => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
const settings = { ACCOUNT_FACTS_READ_MODEL_ENABLED: "true", SESSION_SECRET: "synthetic-session",
  ALLOWED_GITHUB_LOGINS: "synthetic-reader", ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-longbridge-token",
  IBKR_ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-ibkr-token", SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-schwab-token",
  FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-firstrade-token" };
const platforms = ["longbridge", "ibkr", "schwab", "firstrade"];
const tokenFor = platform => settings[platform === "longbridge" ? "ACCOUNT_FACTS_SYNC_TOKEN"
  : `${platform.toUpperCase()}_ACCOUNT_FACTS_SYNC_TOKEN`];
const fixtures = platforms.map(platform => {
  const option = { key: `synthetic-${platform}`, label: "Synthetic", target_name: `synthetic-${platform}`,
    service_name: `synthetic-${platform}-service`, deployment_selector: `synthetic-${platform}-deploy`,
    account_scope: platform === "longbridge" ? "paper" : "live",
    account_selector: platform === "ibkr" ? "U100001" : platform === "longbridge" ? "PAPER" : "live" };
  const binding = { platform, account_key: option.key, account_scope: option.account_scope,
    target_name: option.target_name, service_name: option.service_name, deployment_selector: option.deployment_selector,
    account_selector: option.account_selector, target_id: option.target_name,
    source_binding: { kind: platform === "longbridge" ? "deployment_scope_token_version" : "deployment_runtime_account", id: currentId },
    history_source_binding_ids: [priorId],
    ...(platform === "schwab" ? { broker_account_hash: "d".repeat(64) } : {}),
    ...(platform === "firstrade" ? { broker_account_id: "SYNTH100001" } : {}) };
  return { platform, option, binding };
});
normalizeAccountFactsBindings({ schema_version: "qsl_account_facts_bindings.v1", bindings: fixtures.map(f => f.binding) });

function payload(fixture, days = 10, sourceId = priorId) {
  const { platform, binding } = fixture;
  const start = days === 0 ? new Date(now - 120000).toISOString() : `${dateAgo(days)}T10:00:00Z`;
  return { schema_version: `${platform}_account_snapshot_history.v1`, snapshot_schema_version: `${platform}_account_snapshot.v1`,
    account_scope: platform === "longbridge" ? "PAPER" : binding.account_scope,
    target_id: binding.target_id, source_binding: { kind: binding.source_binding.kind, status: "bound", id: sourceId },
    observed_started_at: start, observed_finished_at: days === 0 ? start : `${dateAgo(days)}T10:01:00Z`,
    snapshot_atomic: false, observation_date: start.slice(0, 10),
    broker_reported_balances: [{ currency: "USD", net_assets: "123.45",
      ...(platform === "longbridge" ? { total_cash: "1" } : {}),
      ...(platform === "schwab" ? { source_tag: "liquidationValue", currency_source: "owner_confirmed" } : {}) }],
    cash: platform === "longbridge" ? [{ currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" }]
      : [{ currency: "USD", cash_balance: "1", source_tag: { ibkr: "TotalCashBalance", schwab: "cashBalance", firstrade: "provider.cash_balance" }[platform],
        ...(platform === "schwab" ? { currency_source: "owner_confirmed" } : {}) }],
    ...(platform === "ibkr" ? { account_ids: [binding.account_selector] } : {}),
    ...(platform === "schwab" ? { account_hash: binding.broker_account_hash } : {}),
    ...(platform === "firstrade" ? { broker_account_id: binding.broker_account_id } : {}) };
}

// Exercise the actual storage method and audit all SQL: archive mode must not
// touch latest or run retention deletion, even if older rows already exist.
{
  const fixture = fixtures[0], b = fixture.binding, statements = [];
  const instance = Object.create(RuntimeInstances.prototype);
  instance.sql = { exec(sql) { statements.push(sql); return { toArray: () => [] }; } };
  instance.pruneAccountFactsDaily = () => { throw new Error("historical ingestion must not prune"); };
  const command = { action: "account_facts_history_put", platform: b.platform, account_key: b.account_key,
    account_scope: b.account_scope, account_selector: b.account_selector, target_id: b.target_id,
    source_binding_id: currentId, history_source_binding_ids: [priorId], history: payload(fixture) };
  assert.equal(instance.putAccountFactsHistoricalObservation(command).unchanged, false);
  assert.ok(statements.some(sql => /INSERT INTO account_facts_daily/.test(sql)));
  assert.ok(statements.every(sql => !/\b(?:UPDATE|DELETE)\b|ON CONFLICT|account_facts_observation/.test(sql)),
    "history-only storage issues a plain daily insert, no latest access, replacement or pruning");
  assert.throws(() => instance.putAccountFactsHistoricalObservation({ ...command, history: payload(fixture, 10, unknownId) }),
    /account_facts_binding_unmatched/, "storage independently refuses a payload-declared unapproved source");
}

let outbound = 0;
const mf = new Miniflare({ modules: true, modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08", bindings: settings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: () => { outbound++; throw new Error("external calls forbidden"); } });
try {
  const kv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG");
  const namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const env = { ...settings, STRATEGY_SWITCH_CONFIG: kv, STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace };
  const saveBindings = bindings => kv.put("account_facts_bindings", JSON.stringify({ schema_version: "qsl_account_facts_bindings.v1", bindings }));
  await saveBindings(fixtures.map(f => f.binding));
  await kv.put("account_options", JSON.stringify(Object.fromEntries(fixtures.map(f => [f.platform, [f.option]]))));
  const post = (fixture, body, { normal = false, token = tokenFor(fixture.platform), extraEnv = {} } = {}) => worker.fetch(new Request(
    `https://synthetic.example/api/account-facts/${normal ? "sync" : "history/sync"}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), { ...env, ...extraEnv });
  const command = async (fixture, action) => {
    const b = fixture.binding;
    const response = await namespace.get(namespace.idFromName("runtime-instances")).fetch("https://runtime-instances/", {
      method: "POST", body: JSON.stringify({ action, platform: b.platform, account_key: b.account_key,
        account_scope: b.account_scope, account_selector: b.account_selector, target_id: b.target_id,
        source_binding_id: b.source_binding.id,
        ...(action === "account_facts_history_read" ? { history_source_binding_ids: b.history_source_binding_ids } : {}),
        ...(b.broker_account_hash ? { broker_account_hash: b.broker_account_hash } : {}),
        ...(b.broker_account_id ? { broker_account_id: b.broker_account_id } : {}) }) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const first = fixtures[0], old = payload(first);
  let response = await post(first, old);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).historical, true);
  assert.equal((await command(first, "account_facts_read")).observation, null,
    "history-only ingress must not create a latest observation");

  for (const fixture of fixtures) {
    const historical = payload(fixture), current = payload(fixture, 0, currentId);
    response = await post(fixture, current, { normal: true });
    assert.equal(response.status, 200, await response.clone().text());
    const latestBefore = await command(fixture, "account_facts_read");
    response = await post(fixture, historical);
    assert.equal(response.status, 200, await response.clone().text());
    const ack = await response.json();
    assert.equal(ack.account_key, fixture.binding.account_key);
    assert.equal(ack.observation_date, historical.observation_date);
    assert.equal(ack.observed_finished_at, historical.observed_finished_at);
    const history = await command(fixture, "account_facts_history_read");
    const stored = history.days.find(day => day.observation_date === historical.observation_date);
    assert.equal(stored.payload.observed_started_at, historical.observed_started_at);
    assert.equal(stored.payload.observed_finished_at, historical.observed_finished_at);
    assert.equal(stored.source_binding_id, priorId);
    response = await post(fixture, historical);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).unchanged, true);
    const currentSourceOldDay = payload(fixture, 9, currentId);
    assert.equal((await post(fixture, currentSourceOldDay)).status, 200);
    const beforeRejects = await command(fixture, "account_facts_history_read");
    for (const changed of [
      { ...historical, broker_reported_balances: historical.broker_reported_balances.map(b => ({ ...b, net_assets: "999" })) },
      { ...historical, observed_finished_at: `${historical.observation_date}T10:02:00Z` },
      { ...historical, observed_finished_at: `${historical.observation_date}T10:00:30Z` },
      { ...historical, source_binding: { ...historical.source_binding, id: currentId } },
    ]) assert.equal((await post(fixture, changed)).status, 409, "existing historical dates never replace different data/source/time");
    assert.deepEqual(await command(fixture, "account_facts_history_read"), beforeRejects, "all conflicts leave SQLite history intact");
    assert.deepEqual(await command(fixture, "account_facts_read"), latestBefore, "latest payload and original dates/source stay unchanged");
    assert.equal((await post(fixture, historical, { normal: true })).status, 400, "normal sync still refuses old observations");
    assert.equal((await post(fixture, payload(fixture, 0, priorId), { normal: true })).status, 409,
      "ordinary sync keeps current-source-only binding even when prior-source history is approved");
    assert.equal((await post(fixture, payload(fixture, 10, unknownId))).status, 409);
    if (fixture.platform === "ibkr") assert.equal((await post(fixture, { ...payload(fixture, 8), account_ids: ["U100002"] })).status, 409);
    if (fixture.platform === "schwab") assert.equal((await post(fixture, { ...payload(fixture, 8), account_hash: "e".repeat(64) })).status, 409);
    if (fixture.platform === "firstrade") assert.equal((await post(fixture, { ...payload(fixture, 8), broker_account_id: "SYNTH100002" })).status, 409);
  }

  assert.equal((await post(first, payload(first, 8), { token: "not-the-token" })).status, 401);
  assert.equal((await post(first, payload(first, 8), { token: settings.IBKR_ACCOUNT_FACTS_SYNC_TOKEN })).status, 403);
  assert.equal((await post(first, payload(first, 8), { extraEnv: { ACCOUNT_FACTS_READ_MODEL_ENABLED: "false" } })).status, 404);
  for (const patch of [{ account_key: "caller" }, { platform: "longbridge" }, { history_source_binding_ids: [unknownId] },
    { target_id: "unknown-target" }, { account_scope: "HK" }, { snapshot_atomic: true },
    { externalFlow: { schema_version: "external_flow.v1", windows: [] } }]) {
    assert.ok((await post(first, { ...payload(first, 8), ...patch })).status >= 400);
  }
  const future = new Date(Date.now() + 60000).toISOString();
  response = await post(first, { ...payload(first, 8), observed_started_at: future, observed_finished_at: future, observation_date: future.slice(0, 10) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "account_facts_future_observation");
  response = await post(first, payload(first, 0, currentId));
  assert.equal(response.status, 400, "today is reserved for ordinary sync even if its timestamp is already past");
  assert.equal((await response.json()).error, "account_facts_history_out_of_range");
  response = await post(first, payload(first, 366));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "account_facts_history_out_of_range");
  assert.equal((await post(first, payload(first, 365))).status, 200, "the existing 366-date retention boundary is accepted");
  const historyBefore = await command(first, "account_facts_history_read");
  assert.equal(historyBefore.days[0].observation_date, historyRetentionCutoff(today));
  assert.equal((await post(first, payload(first, 8))).status, 200);
  const afterInsert = await command(first, "account_facts_history_read");
  assert.ok(historyBefore.days.every(oldDay => afterInsert.days.some(day => JSON.stringify(day) === JSON.stringify(oldDay))),
    "historical inserts do not prune or rewrite any existing day");
  await kv.put("account_options", JSON.stringify({ longbridge: [{ ...first.option, account_selector: "HK" }] }));
  assert.equal((await post(first, payload(first, 6, currentId))).status, 409, "current account-option identity is required for backfill");
  await kv.put("account_options", JSON.stringify(Object.fromEntries(fixtures.map(f => [f.platform, [f.option]]))));

  const cookie = await __test.makeSession("synthetic-reader", [], settings);
  response = await worker.fetch(new Request(`https://synthetic.example/api/account-facts/history?platform=longbridge&account_key=${first.option.key}&currency=USD`,
    { headers: { Cookie: `qsl_switch_session=${cookie}` } }), env);
  assert.equal(response.status, 200);
  const publicHistory = await response.json();
  assert.ok(publicHistory.series.points.some(point => point.observation_date === old.observation_date),
    "the existing authenticated historical read model serves the qualified backfilled day");

  // Removing prior-source authorization immediately stops new backfill writes.
  await saveBindings(fixtures.map(f => { const b = { ...f.binding }; delete b.history_source_binding_ids; return b; }));
  assert.equal((await post(first, payload(first, 7))).status, 409);
  assert.equal((await post(first, payload(first, 7, currentId))).status, 200);
  assert.equal((await post(first, payload(first, 0, priorId), { normal: true })).status, 409,
    "normal sync never accepts a historical source, even for a fresh payload");
  assert.equal(outbound, 0);
  console.log("account_facts_history_receiver_validation: PASS (real SQLite, four platforms, original timestamps, append-only conflicts, qualified sources, 366 days, latest isolated, normal sync unchanged)");
} finally { await mf.dispose(); }
