import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import worker, { __test } from "../web/strategy-switch-console/worker.js";
import {
  ACCOUNT_FACTS_BINDINGS_KEY,
  ACCOUNT_FACTS_BINDINGS_SCHEMA,
  ACCOUNT_FACTS_HISTORY_MAX_DAYS,
  ACCOUNT_FACTS_HISTORY_SCHEMA,
  ACCOUNT_FACTS_OBSERVATION_WINDOW_MS,
  ACCOUNT_FACTS_OPTION_SCOPE,
  ACCOUNT_FACTS_OPTION_SCOPES,
  ACCOUNT_FACTS_PAYLOAD_SCOPE,
  ACCOUNT_FACTS_PAYLOAD_SCOPES,
  ACCOUNT_FACTS_PLATFORM,
  ACCOUNT_FACTS_RETURN_UNAVAILABLE,
  ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
  ACCOUNT_FACTS_SOURCE_KIND,
  ACCOUNT_FACTS_STALE_MS,
  ACCOUNT_FACTS_PLATFORMS,
  IBKR_ACCOUNT_FACTS_HISTORY_SCHEMA,
  IBKR_ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
  IBKR_ACCOUNT_FACTS_SOURCE_KIND,
  IBKR_ACCOUNT_FACTS_PLATFORM,
  SCHWAB_ACCOUNT_FACTS_HISTORY_SCHEMA,
  SCHWAB_ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
  SCHWAB_ACCOUNT_FACTS_SOURCE_KIND,
  SCHWAB_ACCOUNT_FACTS_PLATFORM,
  FIRSTRADE_ACCOUNT_FACTS_PLATFORM,
  FIRSTRADE_ACCOUNT_FACTS_HISTORY_SCHEMA,
  FIRSTRADE_ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
  FIRSTRADE_ACCOUNT_FACTS_SOURCE_KIND,
  accountFactsOptionMatchesBinding,
  accountFactsPlatformForHistory,
  accountFactsScopesMatch,
  accountFactsScopesMatchForPlatform,
  aggregateAccountFactsTotals,
  buildAccountFactsReadModel,
  decideAccountFactsDailyUpsert,
  decideAccountFactsPut,
  historyRetentionCutoff,
  normalizeAccountFactsBindings,
  normalizeAccountFactsHistoryPayload,
  projectAccountFactsHistorySeries,
  projectStoredAccountFacts,
  totalsUnavailableDetail,
} from "../web/strategy-switch-console/account_facts.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");

const root = fileURLToPath(new URL("..", import.meta.url));
const token = ["account", "facts", "sync"].join("-");
const ibkrToken = ["ibkr", "account", "facts", "sync"].join("-");
const schwabToken = ["schwab", "account", "facts", "sync"].join("-");
const sessionSecret = ["session", "secret"].join("-");
const bindingA = "a".repeat(64);
const bindingB = "b".repeat(64);
const bindingHk = "c".repeat(64);
const bindingSg = "d".repeat(64);

assert.deepEqual([...ACCOUNT_FACTS_OPTION_SCOPES], ["paper", "HK", "sg"]);
assert.deepEqual([...ACCOUNT_FACTS_PAYLOAD_SCOPES], ["PAPER", "HK", "SG"]);
assert.equal(accountFactsScopesMatch("paper", "PAPER"), true);
assert.equal(accountFactsScopesMatch("HK", "HK"), true);
assert.equal(accountFactsScopesMatch("sg", "SG"), true);
assert.equal(accountFactsScopesMatch("paper", "HK"), false);
assert.equal(accountFactsScopesMatch("hk", "HK"), false);
assert.equal(accountFactsScopesMatch("HK", "PAPER"), false);
assert.equal(accountFactsScopesMatch("sg", "HK"), false);
assert.deepEqual([...ACCOUNT_FACTS_PLATFORMS], ["longbridge", "ibkr"]);
assert.equal(accountFactsScopesMatchForPlatform("ibkr", "live-u16608560", "live-u16608560"), true);
assert.equal(accountFactsScopesMatchForPlatform("ibkr", "live-u16608560", "U16608560"), false);

const account = {
  key: "lb-paper",
  label: "LB paper",
  target_name: "lb-paper",
  service_name: "longbridge-quant-paper-service",
  account_scope: ACCOUNT_FACTS_OPTION_SCOPE,
  account_selector: "PAPER",
  deployment_selector: "lb-paper",
  supported_domains: ["us_equity"],
};
const hkAccount = {
  key: "hk",
  label: "LB hk",
  target_name: "hk",
  service_name: "longbridge-quant-hk-service",
  account_scope: "HK",
  account_selector: "HK",
  deployment_selector: "HK",
  runtime_status_target_id: "longbridge.hk",
  supported_domains: ["us_equity", "hk_equity"],
};
const sgAccount = {
  key: "sg",
  label: "LB sg",
  target_name: "sg",
  service_name: "longbridge-quant-sg-service",
  account_scope: "sg",
  account_selector: "SG",
  deployment_selector: "lb-sg",
  supported_domains: ["us_equity", "hk_equity"],
};
const otherAccount = {
  ...account,
  key: "lb-other",
  label: "LB other",
  target_name: "lb-other",
  service_name: "longbridge-quant-hk-service",
  account_scope: "hk",
  account_selector: "HK",
  deployment_selector: "lb-hk",
};

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function observationDateFrom(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

function trustedBinding(patch = {}) {
  return {
    platform: ACCOUNT_FACTS_PLATFORM,
    account_key: "lb-paper",
    account_scope: ACCOUNT_FACTS_OPTION_SCOPE,
    target_name: account.target_name,
    service_name: account.service_name,
    deployment_selector: account.deployment_selector,
    account_selector: account.account_selector,
    target_id: "paper",
    source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, id: bindingA },
    ...patch,
  };
}

function historyPayload(patch = {}) {
  const started = patch.observed_started_at || isoMinutesAgo(2);
  const finished = patch.observed_finished_at || isoMinutesAgo(1);
  const balances = patch.broker_reported_balances || [
    { currency: "USD", net_assets: "10", total_cash: "-2.5" },
    { currency: "HKD", net_assets: "3", total_cash: "1" },
  ];
  const cash = patch.cash || [
    { currency: "USD", available_cash: "-2.5", frozen_cash: "0", settling_cash: "0" },
    { currency: "HKD", available_cash: "1", frozen_cash: "0", settling_cash: "0" },
  ];
  return {
    schema_version: ACCOUNT_FACTS_HISTORY_SCHEMA,
    snapshot_schema_version: ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
    account_scope: ACCOUNT_FACTS_PAYLOAD_SCOPE,
    target_id: "paper",
    source_binding: {
      kind: ACCOUNT_FACTS_SOURCE_KIND,
      status: "bound",
      id: bindingA,
    },
    observed_started_at: started,
    observed_finished_at: finished,
    snapshot_atomic: false,
    observation_date: observationDateFrom(started),
    broker_reported_balances: balances,
    cash,
    ...patch,
    observed_started_at: started,
    observed_finished_at: finished,
    observation_date: patch.observation_date || observationDateFrom(started),
    broker_reported_balances: balances,
    cash,
  };
}

// Pure helpers
assert.equal(ACCOUNT_FACTS_OBSERVATION_WINDOW_MS, ACCOUNT_FACTS_STALE_MS);
const freshnessNow = Date.parse("2026-09-30T12:00:00Z");
const freshnessBoundary = freshnessNow - ACCOUNT_FACTS_STALE_MS;
const freshnessBoundaryStart = new Date(freshnessBoundary).toISOString();
const freshnessBoundaryDate = observationDateFrom(freshnessBoundaryStart);
assert.doesNotThrow(() => normalizeAccountFactsHistoryPayload(historyPayload({
  observed_started_at: freshnessBoundaryStart,
  observed_finished_at: freshnessBoundaryStart,
  observation_date: freshnessBoundaryDate,
}), { now: freshnessNow }));
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  observed_started_at: new Date(freshnessBoundary - 1).toISOString(),
  observed_finished_at: new Date(freshnessBoundary - 1).toISOString(),
  observation_date: observationDateFrom(new Date(freshnessBoundary - 1).toISOString()),
}), { now: freshnessNow }), /account_facts_observation_window/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  observed_started_at: new Date(freshnessNow + 6 * 60 * 1000).toISOString(),
  observed_finished_at: new Date(freshnessNow + 6 * 60 * 1000).toISOString(),
  observation_date: observationDateFrom(new Date(freshnessNow + 6 * 60 * 1000).toISOString()),
}), { now: freshnessNow }), /account_facts_future_observation/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  broker_reported_balances: [{ currency: "USD", net_assets: `1.${"0".repeat(101)}`, total_cash: "1" }],
  cash: [{ currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" }],
})), /invalid_account_facts_money_scale/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  broker_reported_balances: [{ currency: "USD", net_assets: `${"9".repeat(16)}`, total_cash: "1" }],
  cash: [{ currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" }],
})), /invalid_account_facts_money_magnitude/);
assert.equal(Object.hasOwn(normalizeAccountFactsHistoryPayload(historyPayload()), "financing"), false);
assert.deepEqual(normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [{ currency: "USD", buy_power: "12.34000000", risk_level: "2" }],
})).financing, [{ currency: "USD", buy_power: "12.34000000", risk_level: "2" }]);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  financing: [{ currency: "USD", buy_power: "1", unknown_native: "2" }],
})), /invalid_account_facts_financing/);
assert.deepEqual(aggregateAccountFactsTotals([{
  binding_status: "bound",
  data_status: "fresh",
  identity_status: "partial_identity",
  target_id: "paper",
  source_binding_id: bindingA,
  balances: [{ currency: "USD", net_assets: "10", total_cash: "1" }],
  cash: [{ currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" }],
}]), {
  status: "unavailable",
  reason: "physical_identity_unverified",
  by_currency: [],
});
assert.match(totalsUnavailableDetail("physical_identity_unverified"), /部分核验/);
assert.equal(decideAccountFactsPut(
  historyPayload({ observed_finished_at: isoMinutesAgo(1), observed_started_at: isoMinutesAgo(2) }),
  historyPayload({
    observed_finished_at: isoMinutesAgo(3),
    observed_started_at: isoMinutesAgo(4),
    broker_reported_balances: [{ currency: "USD", net_assets: "10", total_cash: "1" }],
    cash: [{ currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" }],
  }),
).reason, "account_facts_stale_write");
assert.throws(() => normalizeAccountFactsBindings({
  schema_version: "qsl_account_facts_bindings.v1",
  bindings: [{
    platform: ACCOUNT_FACTS_PLATFORM,
    account_key: "lb-paper",
    account_scope: ACCOUNT_FACTS_OPTION_SCOPE,
    target_id: "paper",
    source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, id: bindingA },
  }],
}), /invalid_account_facts_bindings/, "old bindings without approved option identity fields fail closed");

const persist = await mkdtemp(join(tmpdir(), "qrt-account-facts-"));
const bindingsEnv = {
  SESSION_SECRET: sessionSecret,
  ALLOWED_GITHUB_LOGINS: "facts-reader",
  ACCOUNT_FACTS_SYNC_TOKEN: token,
  IBKR_ACCOUNT_FACTS_SYNC_TOKEN: ibkrToken,
  SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN: schwabToken,
  FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-firstrade-sync",
  ACCOUNT_FACTS_READ_MODEL_ENABLED: "true",
};
const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08",
  bindings: bindingsEnv,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  durableObjectsPersist: persist,
  kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: () => new Response("offline only", { status: 503 }),
});

const kv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG");
const namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
const cookie = await __test.makeSession("facts-reader", [], {
  SESSION_SECRET: sessionSecret,
  ALLOWED_GITHUB_LOGINS: "facts-reader",
});
const sessionHeaders = { Cookie: `qsl_switch_session=${cookie}` };

async function saveAccounts(items) {
  await kv.put("account_options", JSON.stringify({ longbridge: items }));
}

async function saveAccountOptions(options) {
  await kv.put("account_options", JSON.stringify(options));
}

async function saveBindings(items) {
  await kv.put(ACCOUNT_FACTS_BINDINGS_KEY, JSON.stringify({
    schema_version: "qsl_account_facts_bindings.v1",
    bindings: items,
  }));
}

async function runtimeCommand(command) {
  const stub = namespace.get(namespace.idFromName("runtime-instances"));
  const response = await stub.fetch("https://runtime-instances/", {
    method: "POST",
    body: JSON.stringify(command),
  });
  const result = await response.json();
  assert.equal(response.ok, true, JSON.stringify(result));
  return result;
}

function wrapNamespace(action, latch) {
  return {
    idFromName: (name) => namespace.idFromName(name),
    get(id) {
      const stub = namespace.get(id);
      return {
        async fetch(input, init) {
          let command = null;
          if (typeof init?.body === "string") {
            try { command = JSON.parse(init.body); } catch { command = null; }
          }
          if (command?.action === action) await latch.hold();
          return stub.fetch(input, init);
        },
      };
    },
  };
}

function openLatch() {
  let releaseGate = () => {};
  let markEntered = () => {};
  const entered = new Promise((resolve) => { markEntered = resolve; });
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  let seen = false;
  return {
    entered,
    async hold() {
      if (!seen) {
        seen = true;
        markEntered();
      }
      await gate;
    },
    release() { releaseGate(); },
  };
}

async function post(body, headers = {}, envOverride = null) {
  const target = envOverride || {
    ...bindingsEnv,
    STRATEGY_SWITCH_CONFIG: kv,
    STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace,
  };
  return worker.fetch(new Request("https://switch.example/api/account-facts/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), target);
}

async function get(headers = {}, envOverride = null) {
  const target = envOverride || {
    ...bindingsEnv,
    STRATEGY_SWITCH_CONFIG: kv,
    STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace,
  };
  return worker.fetch(new Request("https://switch.example/api/account-facts", { headers }), target);
}

async function getHistory(platform, accountKey, currency, headers = {}, envOverride = null) {
  const target = envOverride || {
    ...bindingsEnv,
    STRATEGY_SWITCH_CONFIG: kv,
    STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace,
  };
  const url = `https://switch.example/api/account-facts/history?platform=${encodeURIComponent(platform)}&account_key=${encodeURIComponent(accountKey)}&currency=${encodeURIComponent(currency)}`;
  return worker.fetch(new Request(url, { headers }), target);
}

await saveAccounts([account, otherAccount]);
await saveBindings([trustedBinding()]);

const env = {
  ...bindingsEnv,
  STRATEGY_SWITCH_CONFIG: kv,
  STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace,
};

assert.equal((await post(historyPayload(), {}, { ...env, ACCOUNT_FACTS_READ_MODEL_ENABLED: "false" })).status, 404);
assert.equal((await post(historyPayload())).status, 401);
assert.equal((await get()).status, 401);
assert.equal((await get(sessionHeaders, { ...env, STRATEGY_SWITCH_RUNTIME_INSTANCES: undefined })).status, 503);
assert.equal((await (await get(sessionHeaders, { ...env, STRATEGY_SWITCH_RUNTIME_INSTANCES: undefined })).json()).error, "account_facts_store_unavailable");

const auth = { Authorization: `Bearer ${token}` };

// A recent completion is accepted even when a snapshot takes over 15 minutes.
const lbFortyMinuteStarted = new Date(Date.now() - 41 * 60 * 1000).toISOString();
const lbFortyMinuteFinished = new Date(Date.now() - 40 * 60 * 1000).toISOString();
const lbFortyMinuteWrite = await post(historyPayload({
  observed_started_at: lbFortyMinuteStarted,
  observed_finished_at: lbFortyMinuteFinished,
  observation_date: observationDateFrom(lbFortyMinuteStarted),
}), auth, env);
assert.equal(lbFortyMinuteWrite.status, 200, "LongBridge observations completed 40 minutes ago remain inside the 36-hour receive window");
const lbFortyMinuteRead = await (await get(sessionHeaders, env)).json();
assert.equal(lbFortyMinuteRead.accounts.find((item) => item.platform === "longbridge" && item.account_key === account.key).data_status, "fresh");

// 1) Newer then older: GET must keep 20, not fall back to 10.
const newer = historyPayload({
  observed_started_at: isoMinutesAgo(2),
  observed_finished_at: isoMinutesAgo(1),
  broker_reported_balances: [
    { currency: "USD", net_assets: "20", total_cash: "1" },
    { currency: "HKD", net_assets: "3", total_cash: "1" },
  ],
  cash: [
    { currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" },
    { currency: "HKD", available_cash: "1", frozen_cash: "0", settling_cash: "0" },
  ],
});
const older = historyPayload({
  observed_started_at: isoMinutesAgo(4),
  observed_finished_at: isoMinutesAgo(3),
  broker_reported_balances: [
    { currency: "USD", net_assets: "10", total_cash: "1" },
    { currency: "HKD", net_assets: "3", total_cash: "1" },
  ],
  cash: [
    { currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" },
    { currency: "HKD", available_cash: "1", frozen_cash: "0", settling_cash: "0" },
  ],
});
assert.equal((await post(newer, auth, env)).status, 200);
const staleWrite = await post(older, auth, env);
assert.equal(staleWrite.status, 409);
assert.equal((await staleWrite.json()).error, "account_facts_stale_write");
const afterStale = await (await get(sessionHeaders, env)).json();
const paperAfterStale = afterStale.accounts.find((item) => item.account_key === "lb-paper");
assert.equal(paperAfterStale.balances.find((row) => row.currency === "USD").net_assets, "20");
assert.equal(afterStale.totals.status, "unavailable");
assert.ok(["physical_identity_unverified", "coverage_incomplete"].includes(afterStale.totals.reason));

// Same finished_at, different content → conflict; identical → idempotent.
const sameTimeA = historyPayload({
  observed_started_at: isoMinutesAgo(2),
  observed_finished_at: newer.observed_finished_at,
  broker_reported_balances: [
    { currency: "USD", net_assets: "21", total_cash: "1" },
    { currency: "HKD", net_assets: "3", total_cash: "1" },
  ],
  cash: newer.cash,
});
const conflict = await post(sameTimeA, auth, env);
assert.equal(conflict.status, 409);
assert.equal((await conflict.json()).error, "account_facts_observation_conflict");
const idempotent = await post(newer, auth, env);
assert.equal(idempotent.status, 200);
assert.equal((await idempotent.json()).unchanged, true);

// Concurrent delayed older put still loses to newer.
const latch = openLatch();
const racedEnv = {
  ...env,
  STRATEGY_SWITCH_RUNTIME_INSTANCES: wrapNamespace("account_facts_put", latch),
};
const racedFinished = new Date(Date.now() - 30 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const racedStarted = new Date(Date.now() - 90 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const racedNewer = historyPayload({
  observed_started_at: racedStarted,
  observed_finished_at: racedFinished,
  observation_date: observationDateFrom(racedStarted),
  broker_reported_balances: [
    { currency: "USD", net_assets: "30", total_cash: "1" },
    { currency: "HKD", net_assets: "3", total_cash: "1" },
  ],
  cash: newer.cash,
});
const racedOlder = historyPayload({
  observed_started_at: isoMinutesAgo(5),
  observed_finished_at: isoMinutesAgo(4),
  broker_reported_balances: [
    { currency: "USD", net_assets: "10", total_cash: "1" },
    { currency: "HKD", net_assets: "3", total_cash: "1" },
  ],
  cash: newer.cash,
});
const first = post(racedNewer, auth, racedEnv);
await latch.entered;
const second = post(racedOlder, auth, racedEnv);
latch.release();
assert.equal((await first).status, 200);
assert.equal((await second).status, 409);
const afterRace = await (await get(sessionHeaders, env)).json();
assert.equal(afterRace.accounts.find((item) => item.account_key === "lb-paper").balances.find((row) => row.currency === "USD").net_assets, "30");

// 3) Scope drift: option paper -> hk makes old PAPER writes/read unavailable.
await saveAccounts([{ ...account, account_scope: "hk" }, otherAccount]);
const driftedWrite = await post(historyPayload({
  observed_started_at: isoMinutesAgo(2),
  observed_finished_at: isoMinutesAgo(1),
}), auth, env);
assert.equal(driftedWrite.status, 409);
assert.equal((await driftedWrite.json()).error, "account_facts_identity_mismatch");
const driftedRead = await (await get(sessionHeaders, env)).json();
const driftedPaper = driftedRead.accounts.find((item) => item.account_key === "lb-paper");
assert.equal(driftedPaper.data_status, "unavailable");
assert.equal(driftedPaper.balances.length, 0);
assert.notEqual(driftedPaper.data_status, "fresh");

await saveAccounts([account, otherAccount]);

// Same key/scope but changed target/service/selectors: old observation must not stay fresh,
// and POST must not enter the DO writer until an external re-bind.
await saveBindings([trustedBinding()]);
const identitySeedFinished = new Date(Date.now() - 25 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const identitySeedStarted = new Date(Date.now() - 85 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
assert.equal((await post(historyPayload({
  observed_started_at: identitySeedStarted,
  observed_finished_at: identitySeedFinished,
  observation_date: observationDateFrom(identitySeedStarted),
  broker_reported_balances: [
    { currency: "USD", net_assets: "20", total_cash: "1" },
    { currency: "HKD", net_assets: "3", total_cash: "1" },
  ],
  cash: [
    { currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" },
    { currency: "HKD", available_cash: "1", frozen_cash: "0", settling_cash: "0" },
  ],
}), auth, env)).status, 200);
const beforeIdentityDrift = await (await get(sessionHeaders, env)).json();
assert.equal(beforeIdentityDrift.accounts.find((item) => item.account_key === "lb-paper").data_status, "fresh");
assert.equal(beforeIdentityDrift.accounts.find((item) => item.account_key === "lb-paper").balances.find((row) => row.currency === "USD").net_assets, "20");

await saveAccounts([{
  ...account,
  target_name: "paper-replacement",
  service_name: "different-paper-service",
  deployment_selector: "paper-replacement",
  account_selector: "PAPER_NEW",
}, otherAccount]);

let doPutCount = 0;
const countingNamespace = {
  idFromName: (name) => namespace.idFromName(name),
  get(id) {
    const stub = namespace.get(id);
    return {
      async fetch(input, init) {
        let command = null;
        if (typeof init?.body === "string") {
          try { command = JSON.parse(init.body); } catch { command = null; }
        }
        if (command?.action === "account_facts_put") doPutCount += 1;
        return stub.fetch(input, init);
      },
    };
  },
};
const identityDriftEnv = {
  ...env,
  STRATEGY_SWITCH_RUNTIME_INSTANCES: countingNamespace,
};
const identityDriftWrite = await post(historyPayload({
  observed_started_at: isoMinutesAgo(2),
  observed_finished_at: isoMinutesAgo(1),
  broker_reported_balances: [
    { currency: "USD", net_assets: "99", total_cash: "1" },
    { currency: "HKD", net_assets: "3", total_cash: "1" },
  ],
  cash: [
    { currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" },
    { currency: "HKD", available_cash: "1", frozen_cash: "0", settling_cash: "0" },
  ],
}), auth, identityDriftEnv);
assert.equal(identityDriftWrite.status, 409);
assert.equal((await identityDriftWrite.json()).error, "account_facts_identity_mismatch");
assert.equal(doPutCount, 0, "identity drift must reject before DO put");
const identityDriftRead = await (await get(sessionHeaders, env)).json();
const driftedTarget = identityDriftRead.accounts.find((item) => item.account_key === "lb-paper");
assert.equal(driftedTarget.data_status, "unavailable");
assert.equal(driftedTarget.identity_mismatch, true);
assert.equal(driftedTarget.identity_status, "missing_identity");
assert.equal(driftedTarget.balances.length, 0);

await saveAccounts([account, otherAccount]);

// LongBridge history cannot bind to binance.
await saveBindings([trustedBinding({ platform: "binance" })]);
assert.throws(() => normalizeAccountFactsBindings({
  schema_version: "qsl_account_facts_bindings.v1",
  bindings: [trustedBinding({ platform: "binance" })],
}), /invalid_account_facts_bindings/);
await saveBindings([trustedBinding()]);

// 2) Coverage incomplete / partial identity never yields all-account by_currency totals.
const model = buildAccountFactsReadModel({
  accountOptions: { longbridge: [account, otherAccount] },
  bindings: { schema_version: "qsl_account_facts_bindings.v1", bindings: [trustedBinding()] },
  storedByAccount: new Map([["longbridge:lb-paper", newer]]),
});
assert.equal(model.totals.status, "unavailable");
assert.equal(model.totals.reason, "coverage_incomplete");
assert.equal(model.accounts.find((item) => item.account_key === "lb-paper").identity_status, "partial_identity");
assert.equal(model.accounts.find((item) => item.account_key === "lb-paper").balances[0].net_assets, "20");

const paperOnlyModel = buildAccountFactsReadModel({
  accountOptions: { longbridge: [{ ...account, label: "Paper broker", broker_environment: "paper" }] },
  bindings: { schema_version: "qsl_account_facts_bindings.v1", bindings: [trustedBinding()] },
  storedByAccount: new Map([["longbridge:lb-paper", newer]]),
});
assert.equal(paperOnlyModel.totals.status, "unavailable");
assert.equal(paperOnlyModel.totals.reason, "no_non_paper_accounts");
assert.equal(paperOnlyModel.accounts[0].data_status, "fresh");
assert.equal(paperOnlyModel.accounts[0].balances[0].net_assets, "20");
assert.equal(paperOnlyModel.accounts[0].broker_environment, "paper");
assert.equal(aggregateAccountFactsTotals([{
  account_scope: "HK",
  broker_environment: "paper",
  label: "Real-looking label",
  binding_status: "bound",
  data_status: "fresh",
  identity_status: "partial_identity",
  balances: [{ currency: "USD", net_assets: "100", total_cash: "10" }],
}]).reason, "no_non_paper_accounts");

// 4) Illegal legacy money becomes unavailable, not 500.
const illegalLegacy = {
  ...newer,
  broker_reported_balances: [{ currency: "USD", net_assets: `1.${"0".repeat(101)}`, total_cash: "1" }],
  cash: [{ currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" }],
};
assert.throws(() => projectStoredAccountFacts(illegalLegacy), /invalid_account_facts_money_scale/);
const legacyModel = buildAccountFactsReadModel({
  accountOptions: { longbridge: [account] },
  bindings: { schema_version: "qsl_account_facts_bindings.v1", bindings: [trustedBinding()] },
  storedByAccount: new Map([["longbridge:lb-paper", illegalLegacy]]),
});
assert.equal(legacyModel.accounts[0].data_status, "unavailable");
assert.equal(legacyModel.accounts[0].balances.length, 0);

const scaleRejected = await post(historyPayload({
  broker_reported_balances: [{ currency: "USD", net_assets: `1.${"0".repeat(101)}`, total_cash: "1" }],
  cash: [{ currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" }],
}), auth, env);
assert.equal(scaleRejected.status, 400);
assert.equal((await scaleRejected.json()).error, "invalid_account_facts_money_scale");

const positiveFinished = new Date(Date.now() - 20 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const positiveStarted = new Date(Date.now() - 80 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const positive = await post(historyPayload({
  observed_started_at: positiveStarted,
  observed_finished_at: positiveFinished,
  observation_date: observationDateFrom(positiveStarted),
  broker_reported_balances: [
    { currency: "USD", net_assets: "12.5", total_cash: "1" },
    { currency: "HKD", net_assets: "3", total_cash: "1" },
  ],
  cash: [
    { currency: "USD", available_cash: "1.25", frozen_cash: "0", settling_cash: "0" },
    { currency: "HKD", available_cash: "1", frozen_cash: "0", settling_cash: "0" },
  ],
}), auth, env);
assert.equal(positive.status, 200);
const read = await (await get(sessionHeaders, env)).json();
assert.equal(read.ok, true);
assert.equal(read.return.reason, "external_cashflow_required");
assert.equal(read.totals.status, "unavailable");
assert.deepEqual(ACCOUNT_FACTS_RETURN_UNAVAILABLE.reason, "external_cashflow_required");
const paper = read.accounts.find((item) => item.account_key === "lb-paper");
assert.equal(paper.data_status, "fresh");
assert.equal(paper.identity_status, "partial_identity");
assert.equal(paper.balances.find((row) => row.currency === "USD").net_assets, "12.5");

const historyGet = await getHistory("longbridge", "lb-paper", "USD", sessionHeaders, env);
assert.equal(historyGet.status, 200);
const historyBody = await historyGet.json();
assert.equal(historyBody.ok, true);
assert.equal(historyBody.binding_status, "bound");
assert.equal(historyBody.identity_status, "partial_identity");
assert.equal(historyBody.series.currency, "USD");
assert.ok(historyBody.series.points.length >= 1);
assert.equal(historyBody.series.points.at(-1).net_assets, "12.5");
assert.equal(historyBody.series.retention_days, ACCOUNT_FACTS_HISTORY_MAX_DAYS);
assert.equal(historyBody.return.reason, "external_cashflow_required");

// Same-day later observation replaces the daily last sample.
const sameDayLaterFinished = new Date(Date.now() - 5 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const sameDayLaterStarted = new Date(Date.now() - 40 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const sameDay = await post(historyPayload({
  observed_started_at: sameDayLaterStarted,
  observed_finished_at: sameDayLaterFinished,
  observation_date: observationDateFrom(sameDayLaterStarted),
  broker_reported_balances: [
    { currency: "USD", net_assets: "13", total_cash: "1" },
    { currency: "HKD", net_assets: "3", total_cash: "1" },
  ],
  cash: [
    { currency: "USD", available_cash: "1.3", frozen_cash: "0", settling_cash: "0" },
    { currency: "HKD", available_cash: "1", frozen_cash: "0", settling_cash: "0" },
  ],
}), auth, env);
assert.equal(sameDay.status, 200);
const sameDayHistory = await (await getHistory("longbridge", "lb-paper", "USD", sessionHeaders, env)).json();
const sameDayPoints = sameDayHistory.series.points.filter((row) => row.observation_date === observationDateFrom(sameDayLaterStarted));
assert.equal(sameDayPoints.length, 1);
assert.equal(sameDayPoints[0].net_assets, "13");

// Option identity drift must not expose prior daily history.
await saveAccounts([{
  ...account,
  target_name: "paper-replacement",
  service_name: "different-paper-service",
  deployment_selector: "paper-replacement",
  account_selector: "PAPER_NEW",
}, otherAccount]);
const remappedHistory = await (await getHistory("longbridge", "lb-paper", "USD", sessionHeaders, env)).json();
assert.equal(remappedHistory.identity_mismatch, true);
assert.equal(remappedHistory.series.points.length, 0);

await saveAccounts([account, otherAccount]);

assert.equal(historyRetentionCutoff("2026-09-29", 366), "2025-09-29");
assert.equal(decideAccountFactsDailyUpsert(null, normalizeAccountFactsHistoryPayload(historyPayload({
  observed_started_at: isoMinutesAgo(4),
  observed_finished_at: isoMinutesAgo(3),
}), { enforceObservationWindow: false })).action, "insert");

const dayA = observationDateFrom(isoMinutesAgo(60 * 24 * 3));
const dayB = observationDateFrom(isoMinutesAgo(60 * 24 * 2));
const dayC = observationDateFrom(isoMinutesAgo(60 * 24 * 1));
function dayPayload(day, amount, patch = {}) {
  return normalizeAccountFactsHistoryPayload(historyPayload({
    observed_started_at: `${day}T10:00:00Z`,
    observed_finished_at: `${day}T10:01:00Z`,
    observation_date: day,
    broker_reported_balances: [{ currency: "USD", net_assets: amount, total_cash: "1" }],
    cash: [{ currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" }],
    ...patch,
  }), { enforceObservationWindow: false, now: Date.parse(`${day}T12:00:00Z`) });
}

const mappedSeries = projectAccountFactsHistorySeries({
  binding: trustedBinding(),
  currency: "USD",
  days: [
    {
      observation_date: dayA,
      target_id: "paper",
      source_binding_id: bindingA,
      account_scope: ACCOUNT_FACTS_OPTION_SCOPE,
      payload: dayPayload(dayA, "10"),
    },
    {
      observation_date: dayC,
      target_id: "paper",
      source_binding_id: bindingA,
      account_scope: ACCOUNT_FACTS_OPTION_SCOPE,
      payload: dayPayload(dayC, "11"),
    },
    {
      observation_date: dayB,
      target_id: "other-target",
      source_binding_id: bindingB,
      account_scope: ACCOUNT_FACTS_OPTION_SCOPE,
      payload: dayPayload(dayB, "99", {
        target_id: "other-target",
        source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: bindingB },
      }),
    },
  ],
});
assert.deepEqual(mappedSeries.points.map((row) => row.net_assets), ["10", "11"]);
assert.ok(mappedSeries.gap_dates.includes(dayB));
assert.equal(mappedSeries.points.some((row) => row.net_assets === "99"), false);

const truncated = projectAccountFactsHistorySeries({
  binding: trustedBinding(),
  currency: "USD",
  maxDays: 2,
  days: [dayA, dayB, dayC].map((day, index) => ({
    observation_date: day,
    target_id: "paper",
    source_binding_id: bindingA,
    account_scope: ACCOUNT_FACTS_OPTION_SCOPE,
    payload: dayPayload(day, String(10 + index)),
  })),
});
assert.equal(truncated.truncated, true);
assert.deepEqual(truncated.points.map((row) => row.observation_date), [dayB, dayC]);

const currencyGap = projectAccountFactsHistorySeries({
  binding: trustedBinding(),
  currency: "JPY",
  days: [{
    observation_date: dayC,
    target_id: "paper",
    source_binding_id: bindingA,
    account_scope: ACCOUNT_FACTS_OPTION_SCOPE,
    payload: dayPayload(dayC, "10"),
  }],
});
assert.equal(currencyGap.points.length, 0);
assert.ok(currencyGap.gap_dates.includes(dayC));

// Three exact LongBridge scopes: paper↔PAPER, hk↔HK, sg↔SG each accept matching pairs.
await saveAccounts([account, hkAccount, sgAccount]);
await saveBindings([
  trustedBinding(),
  {
    platform: ACCOUNT_FACTS_PLATFORM,
    account_key: "hk",
    account_scope: "HK",
    target_name: hkAccount.target_name,
    service_name: hkAccount.service_name,
    deployment_selector: hkAccount.deployment_selector,
    account_selector: hkAccount.account_selector,
    target_id: "hk",
    source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, id: bindingHk },
  },
  {
    platform: ACCOUNT_FACTS_PLATFORM,
    account_key: "sg",
    account_scope: "sg",
    target_name: sgAccount.target_name,
    service_name: sgAccount.service_name,
    deployment_selector: sgAccount.deployment_selector,
    account_selector: sgAccount.account_selector,
    target_id: "sg",
    source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, id: bindingSg },
  },
]);

const hkFinished = new Date(Date.now() - 15 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const hkStarted = new Date(Date.now() - 70 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const hkSync = await post(historyPayload({
  account_scope: "HK",
  target_id: "hk",
  source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: bindingHk },
  observed_started_at: hkStarted,
  observed_finished_at: hkFinished,
  observation_date: observationDateFrom(hkStarted),
  broker_reported_balances: [
    { currency: "HKD", net_assets: "100", total_cash: "20" },
    { currency: "USD", net_assets: "5", total_cash: "1" },
  ],
  cash: [
    { currency: "HKD", available_cash: "20", frozen_cash: "0", settling_cash: "0" },
    { currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" },
  ],
}), auth, env);
assert.equal(hkSync.status, 200);
assert.equal((await hkSync.json()).account_key, "hk");

const sgFinished = new Date(Date.now() - 12 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const sgStarted = new Date(Date.now() - 65 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const sgSync = await post(historyPayload({
  account_scope: "SG",
  target_id: "sg",
  source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: bindingSg },
  observed_started_at: sgStarted,
  observed_finished_at: sgFinished,
  observation_date: observationDateFrom(sgStarted),
  broker_reported_balances: [{ currency: "USD", net_assets: "77", total_cash: "7" }],
  cash: [{ currency: "USD", available_cash: "7", frozen_cash: "0", settling_cash: "0" }],
}), auth, env);
assert.equal(sgSync.status, 200);
assert.equal((await sgSync.json()).account_key, "sg");

const threeScopeRead = await (await get(sessionHeaders, env)).json();
const hkRow = threeScopeRead.accounts.find((item) => item.account_key === "hk");
const sgRow = threeScopeRead.accounts.find((item) => item.account_key === "sg");
const paperRow = threeScopeRead.accounts.find((item) => item.account_key === "lb-paper");
assert.equal(hkRow.binding_status, "bound");
assert.equal(hkRow.data_status, "fresh");
assert.equal(hkRow.identity_status, "partial_identity");
assert.equal(hkRow.account_scope, "HK");
assert.equal(hkRow.balances.find((row) => row.currency === "HKD").net_assets, "100");
assert.equal(sgRow.binding_status, "bound");
assert.equal(sgRow.data_status, "fresh");
assert.equal(sgRow.account_scope, "sg");
assert.equal(sgRow.balances.find((row) => row.currency === "USD").net_assets, "77");
assert.equal(paperRow.binding_status, "bound");
assert.equal(paperRow.data_status, "fresh");
assert.equal(threeScopeRead.return.reason, "external_cashflow_required");

const hkHistory = await (await getHistory("longbridge", "hk", "HKD", sessionHeaders, env)).json();
assert.equal(hkHistory.binding_status, "bound");
assert.equal(hkHistory.series.points.at(-1).net_assets, "100");
const sgHistory = await (await getHistory("longbridge", "sg", "USD", sessionHeaders, env)).json();
assert.equal(sgHistory.binding_status, "bound");
assert.equal(sgHistory.series.points.at(-1).net_assets, "77");

// Cross-scope / cross-source must reject: not "any listed scope is fine".
const crossScopePaperPayloadToHk = await post(historyPayload({
  account_scope: "PAPER",
  target_id: "hk",
  source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: bindingHk },
  observed_started_at: isoMinutesAgo(2),
  observed_finished_at: isoMinutesAgo(1),
}), auth, env);
assert.equal(crossScopePaperPayloadToHk.status, 409);
assert.equal((await crossScopePaperPayloadToHk.json()).error, "account_facts_identity_mismatch");

const crossScopeHkPayloadToPaper = await post(historyPayload({
  account_scope: "HK",
  target_id: "paper",
  source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: bindingA },
  observed_started_at: isoMinutesAgo(2),
  observed_finished_at: isoMinutesAgo(1),
}), auth, env);
assert.equal(crossScopeHkPayloadToPaper.status, 409);
assert.equal((await crossScopeHkPayloadToPaper.json()).error, "account_facts_identity_mismatch");

const crossSourceHkIdOnSgTarget = await post(historyPayload({
  account_scope: "SG",
  target_id: "sg",
  source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: bindingHk },
  observed_started_at: isoMinutesAgo(2),
  observed_finished_at: isoMinutesAgo(1),
}), auth, env);
assert.equal(crossSourceHkIdOnSgTarget.status, 409);
assert.equal((await crossSourceHkIdOnSgTarget.json()).error, "account_facts_binding_unmatched");

assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  account_scope: "LIVE",
}), { enforceObservationWindow: false }), /invalid_account_facts_scope/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  account_scope: "hk",
}), { enforceObservationWindow: false }), /invalid_account_facts_scope/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  account_scope: "HK",
}), { enforceObservationWindow: false, expectedOptionScope: "paper" }), /account_facts_identity_mismatch/);
assert.doesNotThrow(() => normalizeAccountFactsHistoryPayload(historyPayload({
  account_scope: "HK",
  target_id: "hk",
  source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: bindingHk },
}), { enforceObservationWindow: false, expectedOptionScope: "HK" }));
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  account_scope: "HK",
  target_id: "hk",
  source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: bindingHk },
}), { enforceObservationWindow: false, expectedOptionScope: "hk" }), /account_facts_identity_mismatch/);

// Paper regression: prior paper observation remains readable after hk/sg writes.
assert.equal(paperRow.balances.find((row) => row.currency === "USD").net_assets, "13");
const paperHistoryStill = await (await getHistory("longbridge", "lb-paper", "USD", sessionHeaders, env)).json();
assert.equal(paperHistoryStill.binding_status, "bound");
assert.ok(paperHistoryStill.series.points.some((row) => row.net_assets === "13"));

await saveAccounts([account, otherAccount]);
await saveBindings([trustedBinding()]);

const overviewPage = readFileSync(join(root, "web/strategy-switch-console/frontend/src/OverviewPage.tsx"), "utf8");
assert.match(overviewPage, /已取得资产合计（不含已标记模拟账户）/);
assert.match(overviewPage, /summarizeCurrentAccountFacts/);
assert.match(overviewPage, /formatCurrentAmounts\(currentFactsSummary\.excludingPaper\.assets\)/);
assert.match(overviewPage, /accountId === "all"/);
assert.match(overviewPage, /loadAccountFactsHistory|asset-chart/);
assert.match(overviewPage, /loadRuntimeDaily|每日运行记录/);
assert.match(overviewPage, /const freshCashRows = accountFactsDisplayReady\(account\.facts\) \? account\.facts!\.cash : null/);
assert.match(overviewPage, /const cashField = cashFieldForPlatform\(account\.platformKey\)/);
assert.match(overviewPage, /formatAccountFactAmounts\(\s*freshCashRows,\s*cashField,/);
assert.match(overviewPage, /platform === "ibkr" \|\| platform === "schwab" \|\| platform === "firstrade" \? "cash_balance"/);
assert.match(overviewPage, /platform === "ibkr" \|\| platform === "schwab" \|\| platform === "firstrade" \? "现金余额"/);
assert.match(overviewPage, /accountNativeReadout\(account\.platformKey, account\.accountKey, account\.facts,/);
assert.match(overviewPage, /native\.nativeType\s*\? `\$\{t\("账户类型"\)\}: \$\{native\.nativeType\}`/);
assert.match(overviewPage, /const paperConfigured = account\.brokerEnvironment === "paper"/);
assert.match(overviewPage, /t\("模拟账户"\)/);
assert.doesNotMatch(overviewPage, /已取得资产金额|覆盖按配置条目统计|账户资料依据/);
assert.match(overviewPage, /view\.historyDays > 0/);
assert.match(overviewPage, /t\("历史数据范围"\)/);
assert.doesNotMatch(overviewPage, /t\("账户配置"\)/);
const appSource = readFileSync(join(root, "web/strategy-switch-console/frontend/src/App.tsx"), "utf8");
assert.match(appSource, /brokerEnvironment: typeof row\.account\.broker_environment === "string" \? row\.account\.broker_environment : null/);
assert.doesNotMatch(overviewPage, /source-binding|尚未接通|外部资金流未接入|未知不等于零/);
assert.equal(overviewPage.includes('totals?.status === "by_currency"'), false);
assert.equal(overviewPage.includes('id: "cash"'), false);

const ibkrAccount = {
  key: "tqqq",
  label: "tqqq",
  target_name: "tqqq",
  service_name: "interactive-brokers-quant-live-u16608560-service",
  deployment_selector: "live-u16608560",
  account_scope: "live-u16608560",
  account_selector: "U16608560",
  supported_domains: ["us_equity"],
};
const ibkrBinding = {
  platform: IBKR_ACCOUNT_FACTS_PLATFORM,
  account_key: ibkrAccount.key,
  account_scope: ibkrAccount.account_scope,
  target_name: ibkrAccount.target_name,
  service_name: ibkrAccount.service_name,
  deployment_selector: ibkrAccount.deployment_selector,
  account_selector: ibkrAccount.account_selector,
  target_id: "ibkr-u16608560",
  source_binding: { kind: IBKR_ACCOUNT_FACTS_SOURCE_KIND, id: "e".repeat(64) },
};
function ibkrHistory(patch = {}) {
  const started = patch.observed_started_at || isoMinutesAgo(2);
  const finished = patch.observed_finished_at || isoMinutesAgo(1);
  return {
    schema_version: IBKR_ACCOUNT_FACTS_HISTORY_SCHEMA,
    snapshot_schema_version: IBKR_ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
    account_scope: ibkrAccount.account_scope,
    account_ids: [ibkrAccount.account_selector],
    target_id: ibkrBinding.target_id,
    source_binding: {
      kind: IBKR_ACCOUNT_FACTS_SOURCE_KIND,
      status: "bound",
      id: ibkrBinding.source_binding.id,
    },
    observed_started_at: started,
    observed_finished_at: finished,
    snapshot_atomic: false,
    observation_date: observationDateFrom(started),
    broker_reported_balances: [
      { currency: "USD", net_assets: null },
      { currency: "HKD", net_assets: "99.25" },
    ],
    cash: [
      { currency: "USD", cash_balance: "7.50", source_tag: "$LEDGER-CashBalance" },
      { currency: "HKD", cash_balance: "1.25", source_tag: "SettledCash" },
    ],
    ...patch,
    observed_started_at: started,
    observed_finished_at: finished,
    observation_date: patch.observation_date || observationDateFrom(started),
  };
}

const schwabAccount = {
  key: "schwab-placeholder",
  label: "Schwab placeholder",
  target_name: "schwab-placeholder",
  service_name: "schwab-placeholder-service",
  deployment_selector: "schwab-placeholder-deployment",
  account_selector: "schwab-placeholder-selector",
  account_scope: "live",
  broker_environment: "live",
};
const schwabAccountHash = "synthetic-schwab-account-hash";
const schwabBinding = {
  platform: SCHWAB_ACCOUNT_FACTS_PLATFORM,
  account_key: schwabAccount.key,
  account_scope: schwabAccount.account_scope,
  target_name: schwabAccount.target_name,
  service_name: schwabAccount.service_name,
  deployment_selector: schwabAccount.deployment_selector,
  account_selector: schwabAccount.account_selector,
  target_id: "schwab-placeholder-target",
  broker_account_hash: schwabAccountHash,
  source_binding: {
    kind: SCHWAB_ACCOUNT_FACTS_SOURCE_KIND,
    id: "f".repeat(64),
  },
};
function schwabHistory(patch = {}) {
  const started = patch.observed_started_at || isoMinutesAgo(2);
  const finished = patch.observed_finished_at || isoMinutesAgo(1);
  return {
    schema_version: SCHWAB_ACCOUNT_FACTS_HISTORY_SCHEMA,
    snapshot_schema_version: SCHWAB_ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
    account_scope: schwabAccount.account_scope,
    target_id: schwabBinding.target_id,
    source_binding: {
      kind: SCHWAB_ACCOUNT_FACTS_SOURCE_KIND,
      status: "bound",
      id: schwabBinding.source_binding.id,
    },
    observed_started_at: started,
    observed_finished_at: finished,
    snapshot_atomic: false,
    observation_date: observationDateFrom(started),
    broker_reported_balances: [{
      currency: "USD",
      net_assets: "1000.25",
      source_tag: "liquidationValue",
      currency_source: "owner_confirmed",
    }],
    cash: [{
      currency: "USD",
      cash_balance: "250.75",
      source_tag: "cashBalance",
      currency_source: "owner_confirmed",
    }],
    account_hash: schwabAccountHash,
    broker_account_type: { value: "MARGIN", source_tag: "securitiesAccount.type" },
    ...patch,
    observed_started_at: started,
    observed_finished_at: finished,
    observation_date: patch.observation_date || observationDateFrom(started),
  };
}

const normalizedSchwabHistory = normalizeAccountFactsHistoryPayload(schwabHistory(), {
  expectedPlatform: SCHWAB_ACCOUNT_FACTS_PLATFORM,
  expectedTargetId: schwabBinding.target_id,
  expectedBindingId: schwabBinding.source_binding.id,
  expectedOptionScope: schwabBinding.account_scope,
  expectedBrokerAccountHash: schwabAccountHash,
});
assert.deepEqual(normalizedSchwabHistory.broker_account_type, {
  value: "MARGIN",
  source_tag: "securitiesAccount.type",
});
assert.deepEqual(normalizedSchwabHistory.cash, [{
  currency: "USD",
  cash_balance: "250.75",
  source_tag: "cashBalance",
  currency_source: "owner_confirmed",
}]);
const oldSchwabHistory = schwabHistory({ cash: [] });
delete oldSchwabHistory.broker_account_type;
const normalizedOldSchwabHistory = normalizeAccountFactsHistoryPayload(oldSchwabHistory);
assert.deepEqual(normalizedOldSchwabHistory.cash, []);
assert.equal(Object.hasOwn(normalizedOldSchwabHistory, "broker_account_type"), false, "older Schwab history without a type stays readable");
for (const invalidType of [
  { value: "MARGIN1", source_tag: "securitiesAccount.type" },
  { value: "MARGIN\n", source_tag: "securitiesAccount.type" },
  { value: "CASH\r\n", source_tag: "securitiesAccount.type" },
  { value: "CASH\u2028", source_tag: "securitiesAccount.type" },
  { value: "CASH\u2029", source_tag: "securitiesAccount.type" },
  { value: "MARGIN", source_tag: "accountType" },
  { value: "MARGIN", source_tag: "securitiesAccount.type", account_hash: schwabAccountHash },
]) {
  assert.throws(
    () => normalizeAccountFactsHistoryPayload(schwabHistory({ broker_account_type: invalidType })),
    /invalid_account_facts_account_type/,
  );
}
for (const invalidCash of [
  [{ currency: "HKD", cash_balance: "1", source_tag: "cashBalance", currency_source: "owner_confirmed" }],
  [{ currency: "USD", cash_balance: "1", source_tag: "buyingPower", currency_source: "owner_confirmed" }],
  [{ currency: "USD", cash_balance: "1", source_tag: "cashBalance", currency_source: "broker" }],
  [{ currency: "USD", cash_balance: "1", source_tag: "cashBalance", currency_source: "owner_confirmed", available_cash: "1" }],
  [{ currency: "USD", cash_balance: 1, source_tag: "cashBalance", currency_source: "owner_confirmed" }],
  [
    { currency: "USD", cash_balance: "1", source_tag: "cashBalance", currency_source: "owner_confirmed" },
    { currency: "USD", cash_balance: "2", source_tag: "cashBalance", currency_source: "owner_confirmed" },
  ],
]) {
  assert.throws(
    () => normalizeAccountFactsHistoryPayload(schwabHistory({ cash: invalidCash })),
    /invalid_account_facts_cash/,
  );
}
const schwabReadModel = buildAccountFactsReadModel({
  accountOptions: { schwab: [schwabAccount] },
  bindings: { schema_version: ACCOUNT_FACTS_BINDINGS_SCHEMA, bindings: [schwabBinding] },
  storedByAccount: new Map([[`schwab:${schwabAccount.key}`, normalizedSchwabHistory]]),
  now: Date.now(),
});
const schwabReadRow = schwabReadModel.accounts[0];
assert.equal(schwabReadRow.data_status, "fresh");
assert.deepEqual(schwabReadRow.broker_account_type, normalizedSchwabHistory.broker_account_type);
assert.deepEqual(schwabReadRow.cash, normalizedSchwabHistory.cash);
assert.equal(Object.hasOwn(schwabReadRow, "broker_account_hash"), false);
assert.equal(JSON.stringify(schwabReadRow).includes(schwabAccountHash), false);
const oldSchwabReadModel = buildAccountFactsReadModel({
  accountOptions: { schwab: [schwabAccount] },
  bindings: { schema_version: ACCOUNT_FACTS_BINDINGS_SCHEMA, bindings: [schwabBinding] },
  storedByAccount: new Map([[`schwab:${schwabAccount.key}`, normalizedOldSchwabHistory]]),
  now: Date.now(),
});
assert.equal(Object.hasOwn(oldSchwabReadModel.accounts[0], "broker_account_type"), false);
const staleSchwabReadModel = buildAccountFactsReadModel({
  accountOptions: { schwab: [schwabAccount] },
  bindings: { schema_version: ACCOUNT_FACTS_BINDINGS_SCHEMA, bindings: [schwabBinding] },
  storedByAccount: new Map([[`schwab:${schwabAccount.key}`, normalizedSchwabHistory]]),
  now: Date.parse(normalizedSchwabHistory.observed_finished_at) + ACCOUNT_FACTS_STALE_MS + 1,
});
assert.equal(staleSchwabReadModel.accounts[0].data_status, "stale");

assert.equal(accountFactsPlatformForHistory(ibkrHistory()), IBKR_ACCOUNT_FACTS_PLATFORM);
assert.equal(accountFactsOptionMatchesBinding(ibkrAccount, ibkrBinding), true);
assert.throws(() => normalizeAccountFactsBindings({
  schema_version: ACCOUNT_FACTS_BINDINGS_SCHEMA,
  bindings: [{ ...ibkrBinding, source_binding: { ...ibkrBinding.source_binding, kind: ACCOUNT_FACTS_SOURCE_KIND } }],
}), /invalid_account_facts_bindings/);
assert.throws(() => normalizeAccountFactsHistoryPayload({
  ...ibkrHistory(),
  snapshot_schema_version: ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
}), /invalid_account_facts_history/);
assert.throws(() => normalizeAccountFactsHistoryPayload(ibkrHistory({ account_ids: ["DU123", "U16608560"] })), /account_facts_identity_mismatch/);
assert.throws(() => normalizeAccountFactsHistoryPayload(ibkrHistory({ account_ids: ["DU123"] }), {
  expectedPlatform: IBKR_ACCOUNT_FACTS_PLATFORM,
  expectedAccountSelector: ibkrBinding.account_selector,
}), /account_facts_identity_mismatch/);
assert.throws(() => normalizeAccountFactsHistoryPayload(ibkrHistory({
  broker_reported_balances: [{ currency: "BASE", net_assets: "1" }],
})), /invalid_account_facts_balances/);
assert.throws(() => normalizeAccountFactsHistoryPayload(ibkrHistory({
  cash: [{ currency: "USD", cash_balance: "1", source_tag: "UnknownCashTag" }],
})), /invalid_account_facts_cash/);
assert.throws(() => normalizeAccountFactsHistoryPayload(ibkrHistory({
  cash: [{ currency: "BASE", cash_balance: "1", source_tag: "CashBalance" }],
})), /invalid_account_facts_cash/);
assert.throws(() => normalizeAccountFactsHistoryPayload(ibkrHistory({
  cash: [
    { currency: "USD", cash_balance: "1", source_tag: "CashBalance" },
    { currency: "USD", cash_balance: "2", source_tag: "SettledCash" },
  ],
})), /invalid_account_facts_cash/);
const acceptedIbkrHistory = ibkrHistory();
const normalizedIbkrHistory = normalizeAccountFactsHistoryPayload(acceptedIbkrHistory, {
  expectedPlatform: IBKR_ACCOUNT_FACTS_PLATFORM,
  expectedTargetId: ibkrBinding.target_id,
  expectedBindingId: ibkrBinding.source_binding.id,
  expectedOptionScope: ibkrBinding.account_scope,
  expectedAccountSelector: ibkrBinding.account_selector,
});
assert.equal(normalizedIbkrHistory.broker_reported_balances[0].net_assets, null);
assert.deepEqual(normalizedIbkrHistory.account_ids, ["U16608560"]);
assert.throws(() => normalizeAccountFactsHistoryPayload(ibkrHistory({
  broker_account_type: { value: "MARGIN", source_tag: "securitiesAccount.type" },
})), /invalid_account_facts_history/);
assert.doesNotThrow(() => normalizeAccountFactsHistoryPayload(ibkrHistory({
  observed_started_at: freshnessBoundaryStart,
  observed_finished_at: freshnessBoundaryStart,
  observation_date: freshnessBoundaryDate,
}), {
  now: freshnessNow,
  expectedPlatform: IBKR_ACCOUNT_FACTS_PLATFORM,
  expectedAccountSelector: ibkrBinding.account_selector,
}));
assert.throws(() => normalizeAccountFactsHistoryPayload(ibkrHistory({
  observed_started_at: new Date(freshnessBoundary - 1).toISOString(),
  observed_finished_at: new Date(freshnessBoundary - 1).toISOString(),
  observation_date: observationDateFrom(new Date(freshnessBoundary - 1).toISOString()),
}), { now: freshnessNow }), /account_facts_observation_window/);
assert.throws(() => normalizeAccountFactsHistoryPayload(ibkrHistory({
  observed_started_at: new Date(freshnessNow + 6 * 60 * 1000).toISOString(),
  observed_finished_at: new Date(freshnessNow + 6 * 60 * 1000).toISOString(),
  observation_date: observationDateFrom(new Date(freshnessNow + 6 * 60 * 1000).toISOString()),
}), { now: freshnessNow }), /account_facts_future_observation/);

await saveAccountOptions({ longbridge: [account, otherAccount], ibkr: [ibkrAccount] });
await saveBindings([trustedBinding(), ibkrBinding]);
const ibkrAuth = { Authorization: `Bearer ${ibkrToken}` };
assert.equal((await post(ibkrHistory(), auth, env)).status, 403, "the LongBridge token cannot write IBKR history");
assert.equal((await post(historyPayload(), ibkrAuth, env)).status, 403, "the IBKR token cannot write LongBridge history");
assert.equal((await post(ibkrHistory(), ibkrAuth, {
  ...env,
  IBKR_ACCOUNT_FACTS_SYNC_TOKEN: undefined,
})).status, 401, "IBKR writes fail closed when its dedicated token is absent");
assert.equal((await post("not-json", ibkrAuth, {
  ...env,
  ACCOUNT_FACTS_SYNC_TOKEN: ibkrToken,
  IBKR_ACCOUNT_FACTS_SYNC_TOKEN: ibkrToken,
})).status, 503, "equal configured tokens are rejected before reading the body");
const mixedIbkrSchema = ibkrHistory({ snapshot_schema_version: ACCOUNT_FACTS_SNAPSHOT_SCHEMA });
assert.equal((await post(mixedIbkrSchema, ibkrAuth, env)).status, 400);
const wrongIbkrIdentity = await post(ibkrHistory({ account_ids: ["DU123"] }), ibkrAuth, env);
assert.equal(wrongIbkrIdentity.status, 409);
const wrongIbkrScope = await post(ibkrHistory({ account_scope: "U16608560" }), ibkrAuth, env);
assert.equal(wrongIbkrScope.status, 409, "native ID is not an account-scope substitute");
const ibkrFortyMinuteStarted = new Date(Date.now() - 41 * 60 * 1000).toISOString();
const ibkrFortyMinuteFinished = new Date(Date.now() - 40 * 60 * 1000).toISOString();
const ibkrFortyMinuteWrite = await post(ibkrHistory({
  observed_started_at: ibkrFortyMinuteStarted,
  observed_finished_at: ibkrFortyMinuteFinished,
  observation_date: observationDateFrom(ibkrFortyMinuteStarted),
}), ibkrAuth, env);
assert.equal(ibkrFortyMinuteWrite.status, 200, "IBKR observations completed 40 minutes ago remain inside the 36-hour receive window");
const ibkrFortyMinuteRead = await (await get(sessionHeaders, env)).json();
assert.equal(ibkrFortyMinuteRead.accounts.find((item) => item.platform === "ibkr" && item.account_key === ibkrAccount.key).data_status, "fresh");
const ibkrWrite = await post(acceptedIbkrHistory, ibkrAuth, env);
assert.equal(ibkrWrite.status, 200, await ibkrWrite.clone().text());
assert.equal((await ibkrWrite.json()).unchanged, false);
const ibkrIdempotent = await post(acceptedIbkrHistory, ibkrAuth, env);
assert.equal(ibkrIdempotent.status, 200);
assert.equal((await ibkrIdempotent.json()).unchanged, true);
const ibkrStale = await post(ibkrHistory({
  observed_started_at: isoMinutesAgo(4),
  observed_finished_at: isoMinutesAgo(3),
}), ibkrAuth, env);
assert.equal(ibkrStale.status, 409);
const ibkrFacts = await (await get(sessionHeaders, env)).json();
const ibkrRow = ibkrFacts.accounts.find((item) => item.platform === "ibkr" && item.account_key === ibkrAccount.key);
assert.equal(ibkrRow.binding_status, "bound");
assert.equal(ibkrRow.data_status, "fresh");
assert.equal(ibkrRow.balances.find((row) => row.currency === "USD").net_assets, null);
assert.equal(ibkrRow.cash.find((row) => row.currency === "USD").cash_balance, "7.50");
assert.equal(ibkrFacts.totals.status, "unavailable");
const ibkrUsdHistory = await (await getHistory("ibkr", ibkrAccount.key, "USD", sessionHeaders, env)).json();
assert.equal(ibkrUsdHistory.binding_status, "bound");
assert.deepEqual(ibkrUsdHistory.series.points, []);
assert.deepEqual(ibkrUsdHistory.series.gap_dates, [normalizedIbkrHistory.observation_date]);
const ibkrHkdHistory = await (await getHistory("ibkr", ibkrAccount.key, "HKD", sessionHeaders, env)).json();
assert.equal(ibkrHkdHistory.series.points[0].net_assets, "99.25");
assert.equal(ibkrHkdHistory.series.points[0].total_cash, null);

// A server-approved source revision may rotate while the account identity stays fixed.
// Old data must disappear under the new binding until a new-source observation arrives.
const rotatedIbkrBinding = {
  ...ibkrBinding,
  source_binding: { ...ibkrBinding.source_binding, id: "f".repeat(64) },
};
await saveBindings([trustedBinding(), rotatedIbkrBinding]);
const beforeIbkrRefresh = await (await get(sessionHeaders, env)).json();
assert.equal(beforeIbkrRefresh.accounts.find((item) => item.platform === "ibkr" && item.account_key === ibkrAccount.key).data_status, "unavailable");
const ibkrRefreshStarted = new Date(Date.now() - 20_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const ibkrRefreshFinished = new Date(Date.now() - 10_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const refreshedIbkr = await post(ibkrHistory({
  source_binding: { kind: IBKR_ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: rotatedIbkrBinding.source_binding.id },
  observed_started_at: ibkrRefreshStarted,
  observed_finished_at: ibkrRefreshFinished,
  observation_date: observationDateFrom(ibkrRefreshStarted),
}), ibkrAuth, env);
assert.equal(refreshedIbkr.status, 200, await refreshedIbkr.clone().text());
const afterIbkrRefresh = await (await get(sessionHeaders, env)).json();
assert.equal(afterIbkrRefresh.accounts.find((item) => item.platform === "ibkr" && item.account_key === ibkrAccount.key).data_status, "fresh");

const rotatedLbBinding = trustedBinding({ source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, id: "e".repeat(64) } });
await saveBindings([rotatedLbBinding, rotatedIbkrBinding]);
const beforeLbRefresh = await (await get(sessionHeaders, env)).json();
assert.equal(beforeLbRefresh.accounts.find((item) => item.platform === "longbridge" && item.account_key === account.key).data_status, "unavailable");
const lbRefreshStarted = new Date(Date.now() - 4_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const lbRefreshFinished = new Date(Date.now() - 2_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const refreshedLb = await post(historyPayload({
  source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: rotatedLbBinding.source_binding.id },
  observed_started_at: lbRefreshStarted,
  observed_finished_at: lbRefreshFinished,
  observation_date: observationDateFrom(lbRefreshStarted),
}), auth, env);
assert.equal(refreshedLb.status, 200, await refreshedLb.clone().text());
const afterLbRefresh = await (await get(sessionHeaders, env)).json();
assert.equal(afterLbRefresh.accounts.find((item) => item.platform === "longbridge" && item.account_key === account.key).data_status, "fresh");

// Cross-day binding rotation: old daily rows stay stored but are excluded from
// the current account history for both platforms.
const previousDayStart = new Date(Date.now() - 86400000);
previousDayStart.setUTCHours(10, 0, 0, 0);
const previousDayStartedAt = previousDayStart.toISOString().replace(/\.\d{3}Z$/, "Z");
const previousDayFinishedAt = new Date(previousDayStart.getTime() + 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
const rotationLb = {
  ...account,
  key: "lb-history-rotation",
  label: "LB history rotation",
  target_name: "lb-history-rotation",
  service_name: "lb-history-rotation-service",
  deployment_selector: "lb-history-rotation",
};
const rotationLbOldId = "1".repeat(64);
const rotationLbNewId = "2".repeat(64);
const rotationLbOldBinding = trustedBinding({
  account_key: rotationLb.key,
  target_name: rotationLb.target_name,
  service_name: rotationLb.service_name,
  deployment_selector: rotationLb.deployment_selector,
  target_id: "lb-history-rotation",
  source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, id: rotationLbOldId },
});
const rotationLbNewBinding = {
  ...rotationLbOldBinding,
  source_binding: { ...rotationLbOldBinding.source_binding, id: rotationLbNewId },
};
const rotationLbOldHistory = historyPayload({
  target_id: rotationLbOldBinding.target_id,
  source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: rotationLbOldId },
  observed_started_at: previousDayStartedAt,
  observed_finished_at: previousDayFinishedAt,
  observation_date: observationDateFrom(previousDayStartedAt),
  broker_reported_balances: [{ currency: "USD", net_assets: "111", total_cash: "1" }],
  cash: [{ currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" }],
});
await runtimeCommand({
  action: "account_facts_put",
  platform: "longbridge",
  account_key: rotationLb.key,
  account_scope: rotationLb.account_scope,
  account_selector: rotationLb.account_selector,
  target_id: rotationLbOldBinding.target_id,
  source_binding_id: rotationLbOldId,
  history: rotationLbOldHistory,
});

const rotationIbkr = {
  ...ibkrAccount,
  key: "ibkr-history-rotation",
  label: "IBKR history rotation",
  target_name: "ibkr-history-rotation",
  service_name: "ibkr-history-rotation-service",
  deployment_selector: "ibkr-history-rotation",
  account_scope: "live-u12345",
  account_selector: "U12345",
};
const rotationIbkrOldId = "3".repeat(64);
const rotationIbkrNewId = "4".repeat(64);
const rotationIbkrOldBinding = {
  platform: IBKR_ACCOUNT_FACTS_PLATFORM,
  account_key: rotationIbkr.key,
  account_scope: rotationIbkr.account_scope,
  target_name: rotationIbkr.target_name,
  service_name: rotationIbkr.service_name,
  deployment_selector: rotationIbkr.deployment_selector,
  account_selector: rotationIbkr.account_selector,
  target_id: "ibkr-history-rotation",
  source_binding: { kind: IBKR_ACCOUNT_FACTS_SOURCE_KIND, id: rotationIbkrOldId },
};
const rotationIbkrNewBinding = {
  ...rotationIbkrOldBinding,
  source_binding: { ...rotationIbkrOldBinding.source_binding, id: rotationIbkrNewId },
};
const rotationIbkrOldHistory = {
  ...ibkrHistory({ observed_started_at: previousDayStartedAt, observed_finished_at: previousDayFinishedAt }),
  account_scope: rotationIbkr.account_scope,
  account_ids: [rotationIbkr.account_selector],
  target_id: rotationIbkrOldBinding.target_id,
  source_binding: { kind: IBKR_ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: rotationIbkrOldId },
  observation_date: observationDateFrom(previousDayStartedAt),
  broker_reported_balances: [{ currency: "USD", net_assets: "222" }],
  cash: [{ currency: "USD", cash_balance: "2", source_tag: "CashBalance" }],
};
await runtimeCommand({
  action: "account_facts_put",
  platform: "ibkr",
  account_key: rotationIbkr.key,
  account_scope: rotationIbkr.account_scope,
  account_selector: rotationIbkr.account_selector,
  target_id: rotationIbkrOldBinding.target_id,
  source_binding_id: rotationIbkrOldId,
  history: rotationIbkrOldHistory,
});

await saveAccountOptions({
  longbridge: [account, otherAccount, rotationLb],
  ibkr: [ibkrAccount, rotationIbkr],
});
await saveBindings([
  rotatedLbBinding,
  rotatedIbkrBinding,
  rotationLbNewBinding,
  rotationIbkrNewBinding,
]);
const currentDayStartedAt = new Date(Date.now() - 3000).toISOString().replace(/\.\d{3}Z$/, "Z");
const currentDayFinishedAt = new Date(Date.now() - 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const newLbDay = await post(historyPayload({
  target_id: rotationLbNewBinding.target_id,
  source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: rotationLbNewId },
  observed_started_at: currentDayStartedAt,
  observed_finished_at: currentDayFinishedAt,
  observation_date: observationDateFrom(currentDayStartedAt),
  broker_reported_balances: [{ currency: "USD", net_assets: "333", total_cash: "3" }],
  cash: [{ currency: "USD", available_cash: "3", frozen_cash: "0", settling_cash: "0" }],
}), auth, env);
assert.equal(newLbDay.status, 200, await newLbDay.clone().text());
const newIbkrDay = await post({
  ...ibkrHistory({ observed_started_at: currentDayStartedAt, observed_finished_at: currentDayFinishedAt }),
  account_scope: rotationIbkr.account_scope,
  account_ids: [rotationIbkr.account_selector],
  target_id: rotationIbkrNewBinding.target_id,
  source_binding: { kind: IBKR_ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: rotationIbkrNewId },
  observation_date: observationDateFrom(currentDayStartedAt),
  broker_reported_balances: [{ currency: "USD", net_assets: "444" }],
  cash: [{ currency: "USD", cash_balance: "4", source_tag: "CashBalance" }],
}, ibkrAuth, env);
assert.equal(newIbkrDay.status, 200, await newIbkrDay.clone().text());

const rotatedLbHistory = await getHistory("longbridge", rotationLb.key, "USD", sessionHeaders, env);
assert.equal(rotatedLbHistory.status, 200, await rotatedLbHistory.clone().text());
assert.deepEqual((await rotatedLbHistory.json()).series.points.map((point) => point.net_assets), ["333"]);
const rotatedIbkrHistory = await getHistory("ibkr", rotationIbkr.key, "USD", sessionHeaders, env);
assert.equal(rotatedIbkrHistory.status, 200, await rotatedIbkrHistory.clone().text());
assert.deepEqual((await rotatedIbkrHistory.json()).series.points.map((point) => point.net_assets), ["444"]);
const wrongCurrentIbkrContext = await namespace.get(namespace.idFromName("runtime-instances")).fetch("https://runtime-instances/", {
  method: "POST",
  body: JSON.stringify({
    action: "account_facts_history_read",
    platform: "ibkr",
    account_key: rotationIbkr.key,
    account_scope: rotationIbkr.account_scope,
    account_selector: "DU12345",
    target_id: rotationIbkrNewBinding.target_id,
    source_binding_id: rotationIbkrNewId,
  }),
});
assert.equal(wrongCurrentIbkrContext.status, 409);
assert.equal((await wrongCurrentIbkrContext.json()).error, "account_facts_identity_mismatch");

// Query the retained old rows with their former context to prove rotation filtered,
// rather than deleted, the stored evidence.
const retainedLbOld = await runtimeCommand({
  action: "account_facts_history_read",
  platform: "longbridge",
  account_key: rotationLb.key,
  account_scope: rotationLb.account_scope,
  account_selector: rotationLb.account_selector,
  target_id: rotationLbOldBinding.target_id,
  source_binding_id: rotationLbOldId,
});
assert.deepEqual(retainedLbOld.days.map((day) => day.payload.broker_reported_balances[0].net_assets), ["111"]);
const retainedIbkrOld = await runtimeCommand({
  action: "account_facts_history_read",
  platform: "ibkr",
  account_key: rotationIbkr.key,
  account_scope: rotationIbkr.account_scope,
  account_selector: rotationIbkr.account_selector,
  target_id: rotationIbkrOldBinding.target_id,
  source_binding_id: rotationIbkrOldId,
});
assert.deepEqual(retainedIbkrOld.days.map((day) => day.payload.broker_reported_balances[0].net_assets), ["222"]);

assert.match(overviewPage, /selectedCashLabel/);
assert.match(overviewPage, /function cashFieldForPlatform\(platform: string\)/);
assert.match(overviewPage, /longBridgeFinancingDetails\(account\.facts\)/);
assert.match(overviewPage, /overview-financing-details/);
const locales = readFileSync(join(root, "web/strategy-switch-console/frontend/src/locales.ts"), "utf8");
assert.match(locales, /"现金余额": "Cash balance"/);
assert.match(locales, /"融资详情": "Financing details"/);

await saveAccountOptions({ schwab: [schwabAccount] });
await saveBindings([schwabBinding]);
const schwabAuth = { Authorization: `Bearer ${schwabToken}` };
const schwabStored = await post(schwabHistory(), schwabAuth, env);
assert.equal(schwabStored.status, 200, await schwabStored.clone().text());
const schwabFacts = await (await get(sessionHeaders, env)).json();
const schwabOutputRow = schwabFacts.accounts.find((item) => item.platform === "schwab");
assert.equal(schwabOutputRow.data_status, "fresh");
assert.deepEqual(schwabOutputRow.broker_account_type, {
  value: "MARGIN",
  source_tag: "securitiesAccount.type",
});
assert.deepEqual(schwabOutputRow.cash, [{
  currency: "USD",
  cash_balance: "250.75",
  source_tag: "cashBalance",
  currency_source: "owner_confirmed",
}]);
assert.equal(Object.hasOwn(schwabOutputRow, "broker_account_hash"), false);
assert.equal(JSON.stringify(schwabOutputRow).includes(schwabAccountHash), false);
const schwabHistoryRead = await getHistory("schwab", schwabAccount.key, "USD", sessionHeaders, env);
assert.equal(schwabHistoryRead.status, 200, await schwabHistoryRead.clone().text());
assert.equal(JSON.stringify(await schwabHistoryRead.json()).includes(schwabAccountHash), false);

// Synthetic Firstrade producer contract: exact private identity at every boundary.
const ftAccount = { key: "ft-synthetic", label: "Synthetic", target_name: "ft-synthetic",
  service_name: "ft-synthetic-service", deployment_selector: "ft-synthetic-deployment",
  account_selector: "default", account_scope: "live" };
const ftBinding = { platform: FIRSTRADE_ACCOUNT_FACTS_PLATFORM, account_key: ftAccount.key,
  target_name: ftAccount.target_name, service_name: ftAccount.service_name,
  deployment_selector: ftAccount.deployment_selector, account_selector: ftAccount.account_selector,
  account_scope: ftAccount.account_scope, broker_account_id: "synthetic-native-ft",
  target_id: "ft-synthetic-target", source_binding: {kind: FIRSTRADE_ACCOUNT_FACTS_SOURCE_KIND, id: "9".repeat(64)} };
function ftHistory(patch = {}) {
  const started = isoMinutesAgo(2), finished = isoMinutesAgo(1);
  return {schema_version: FIRSTRADE_ACCOUNT_FACTS_HISTORY_SCHEMA,
    snapshot_schema_version: FIRSTRADE_ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
    account_scope: "live", broker_account_id: ftBinding.broker_account_id,
    target_id: ftBinding.target_id, source_binding: {...ftBinding.source_binding, status: "bound"},
    observed_started_at: started, observed_finished_at: finished, snapshot_atomic: false,
    observation_date: observationDateFrom(started),
    broker_reported_balances: [{currency: "USD", net_assets: "12.5"}],
    cash: [{currency: "USD", cash_balance: "0", source_tag: "provider.cash_balance"}], ...patch};
}
assert.equal(accountFactsPlatformForHistory(ftHistory()), "firstrade");
assert.throws(() => normalizeAccountFactsHistoryPayload(ftHistory(), {expectedBrokerAccountId: "other-synthetic"}), /identity_mismatch/);
for (const patch of [
  {broker_account_id: "bad\n"}, {broker_reported_balances: []},
  {broker_reported_balances: [{currency: "USD", net_assets: null}]},
  {broker_reported_balances: [{currency: "USD", net_assets: "1000000000000000"}]},
  {cash: [{currency: "USD", cash_balance: "1", source_tag: "buying_power"}]},
  {cash: [{currency: "HKD", cash_balance: "1", source_tag: "provider.cash_balance"}]},
]) assert.throws(() => normalizeAccountFactsHistoryPayload(ftHistory(patch)));
assert.deepEqual(normalizeAccountFactsHistoryPayload(ftHistory({cash: []})).cash, []);
await saveAccountOptions({firstrade: [ftAccount]});
await saveBindings([ftBinding]);
const ftAuth = {Authorization: "Bearer synthetic-firstrade-sync"};
assert.equal((await post(ftHistory(), schwabAuth, env)).status, 403);
assert.equal((await post(ftHistory({broker_account_id: "wrong-synthetic"}), ftAuth, env)).status, 409);
assert.equal((await post(ftHistory(), ftAuth, {...env, FIRSTRADE_ACCOUNT_FACTS_SYNC_TOKEN: schwabToken})).status, 503);
for (const field of ["BINANCE_ACCOUNT_FACTS_SYNC_TOKEN", "EXECUTION_EVIDENCE_SYNC_TOKEN", "STRATEGY_SWITCH_SYNC_TOKEN"]) {
  assert.equal((await post(ftHistory(), ftAuth, {...env, [field]: "synthetic-firstrade-sync"})).status, 503);
}
const ftStored = await post(ftHistory(), ftAuth, env);
assert.equal(ftStored.status, 200, await ftStored.clone().text());
assert.equal(JSON.stringify(await ftStored.json()).includes(ftBinding.broker_account_id), false);
const ftOutput = await (await get(sessionHeaders, env)).json();
assert.equal(ftOutput.accounts[0].data_status, "fresh");
assert.deepEqual(ftOutput.accounts[0].cash, ftHistory().cash);
assert.equal(JSON.stringify(ftOutput).includes(ftBinding.broker_account_id), false);
const ftHistoryResponse = await getHistory("firstrade", ftAccount.key, "USD", sessionHeaders, env);
assert.equal(ftHistoryResponse.status, 200);
const ftSeries = await ftHistoryResponse.json();
assert.equal(ftSeries.series.points.at(-1).net_assets, "12.5");
assert.equal(JSON.stringify(ftSeries).includes(ftBinding.broker_account_id), false);
// A binding changed to a different native account must hide both current and historical data.
await saveBindings([{...ftBinding, broker_account_id: "other-synthetic"}]);
const changedFt = await get(sessionHeaders, env);
assert.equal((await changedFt.json()).accounts[0].data_status, "unavailable");
const changedFtHistory = await getHistory("firstrade", ftAccount.key, "USD", sessionHeaders, env);
assert.ok(changedFtHistory.status !== 200 || (await changedFtHistory.json()).series.points.length === 0);

const workerSource = readFileSync(join(root, "web/strategy-switch-console/worker.js"), "utf8");
assert.match(workerSource, /account_facts_put/);
assert.match(workerSource, /account_facts_history_read|account_facts_daily/);
assert.match(workerSource, /account_facts_stale_write|decideAccountFactsPut/);
assert.doesNotMatch(workerSource, /writeConfigJson\(env, accountFactsStorageKey/);
assert.doesNotMatch(workerSource, /account_facts:\$\{platform\}/);
assert.match(workerSource, /\/api\/account-facts\/history/);

await mf.dispose();
console.log("account_facts_validation ok");
