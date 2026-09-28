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
  ACCOUNT_FACTS_HISTORY_SCHEMA,
  ACCOUNT_FACTS_OPTION_SCOPE,
  ACCOUNT_FACTS_PAYLOAD_SCOPE,
  ACCOUNT_FACTS_PLATFORM,
  ACCOUNT_FACTS_RETURN_UNAVAILABLE,
  ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
  ACCOUNT_FACTS_SOURCE_KIND,
  aggregateAccountFactsTotals,
  buildAccountFactsReadModel,
  decideAccountFactsPut,
  normalizeAccountFactsBindings,
  normalizeAccountFactsHistoryPayload,
  projectStoredAccountFacts,
  totalsUnavailableDetail,
} from "../web/strategy-switch-console/account_facts.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");

const root = fileURLToPath(new URL("..", import.meta.url));
const token = ["account", "facts", "sync"].join("-");
const sessionSecret = ["session", "secret"].join("-");
const bindingA = "a".repeat(64);
const bindingB = "b".repeat(64);

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
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  broker_reported_balances: [{ currency: "USD", net_assets: `1.${"0".repeat(101)}`, total_cash: "1" }],
  cash: [{ currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" }],
})), /invalid_account_facts_money_scale/);
assert.throws(() => normalizeAccountFactsHistoryPayload(historyPayload({
  broker_reported_balances: [{ currency: "USD", net_assets: `${"9".repeat(16)}`, total_cash: "1" }],
  cash: [{ currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" }],
})), /invalid_account_facts_money_magnitude/);
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

async function saveBindings(items) {
  await kv.put(ACCOUNT_FACTS_BINDINGS_KEY, JSON.stringify({
    schema_version: "qsl_account_facts_bindings.v1",
    bindings: items,
  }));
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

const overviewPage = readFileSync(join(root, "web/strategy-switch-console/frontend/src/OverviewPage.tsx"), "utf8");
assert.match(overviewPage, /全部账户总额|totalsUnavailableDetail/);
assert.match(overviewPage, /accountId === "all"/);
assert.equal(overviewPage.includes('totals?.status === "by_currency"'), false);
assert.equal(overviewPage.includes('id: "cash"'), false);

const workerSource = readFileSync(join(root, "web/strategy-switch-console/worker.js"), "utf8");
assert.match(workerSource, /account_facts_put/);
assert.match(workerSource, /account_facts_stale_write|decideAccountFactsPut/);
assert.doesNotMatch(workerSource, /writeConfigJson\(env, accountFactsStorageKey/);
assert.doesNotMatch(workerSource, /account_facts:\$\{platform\}/);

await mf.dispose();
console.log("account_facts_validation ok");
