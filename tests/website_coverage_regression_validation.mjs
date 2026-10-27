import assert from "node:assert/strict";
import { test } from "node:test";
import { accountFreshness, currencyTotals, currencyDrawdowns } from "../web/strategy-switch-console/application/console_api/performance_snapshots.js";
import { performanceResponse } from "../web/strategy-switch-console/application/console_api/performance_routes.js";
import { aggregateEquity } from "../web/strategy-switch-console/performance_math.js";
import { maxDrawdown } from "../web/strategy-switch-console/application/console_api/performance.js";

const now = Date.parse("2026-10-27T12:00:00Z");
const account = (key, date = "2026-10-27", changes = {}) => ({
  platform: "synthetic", account_key: key, binding_status: "bound", broker_environment: "live",
  observed_finished_at: `${date}T10:00:00Z`, observation_date: date,
  balances: [{ currency: "USD", net_assets: "100" }], ...changes,
});
const row = accounts => currencyTotals(accounts, accountFreshness(accounts, now))[0];

test("three of eight current balances identify every excluded valuation without changing totals", () => {
  const accounts = Array.from({ length: 8 }, (_, i) => account(`synthetic-${i}`, i < 3 ? "2026-10-27" : "2026-10-26"));
  const total = row(accounts);
  assert.equal(total.total, 300);
  assert.equal(total.account_count, 3);
  assert.equal(total.expected_account_count, 8);
  assert.equal(total.unavailable_reason, "valuation_date_mismatch");
  assert.equal(total.account_coverage.length, 8);
  assert.equal(total.account_coverage.filter(entry => entry.included).length, 3);
  for (const entry of total.account_coverage.slice(3)) {
    assert.equal(entry.unavailable_reason, "valuation_date_mismatch");
    assert.equal(entry.observation_date, "2026-10-26");
    assert.equal(entry.freshness, "fresh", "a different valuation date is not automatically stale");
    assert.equal(entry.account_ref, `synthetic:${entry.account_alias}`);
  }
});

test("snapshot exclusions distinguish missing, identity, invalid amount/date and stale evidence", () => {
  const accounts = [account("current"), account("bad-amount", undefined, { balances: [{ currency: "USD", net_assets: "" }] }),
    account("bad-date", undefined, { observation_date: "not-a-date" }),
    account("duplicate", undefined, { balances: [{ currency: "USD", net_assets: "100" }, { currency: "USD", net_assets: "100" }] }),
    { platform: "synthetic", account_key: "missing", snapshot_unavailable_reason: "identity_mismatch" }];
  const total = row(accounts);
  assert.equal(total.total, 100);
  assert.deepEqual(total.account_coverage.map(entry => entry.unavailable_reason),
    [null, "invalid_balance", "invalid_valuation_date", "duplicate_currency", "identity_mismatch"]);
  assert.equal(total.account_coverage.at(-1).as_of, null);
  assert.equal(total.account_coverage.at(-1).freshness, "unknown");
  const old = row([account("old", "2026-10-20")]);
  assert.equal(old.total, 100, "existing stale subtotal policy is retained");
  assert.equal(old.status, "stale");
  assert.equal(old.account_coverage[0].included, true);
  assert.equal(old.account_coverage[0].unavailable_reason, "snapshot_stale");
});

test("currency coverage separates known other currencies while retaining unknown members", () => {
  const accounts = [account("usd"), account("wallet", undefined, { balances: [{ currency: "USDT", net_assets: "50" }] }),
    { platform: "synthetic", account_key: "unknown" }];
  const totals = currencyTotals(accounts, accountFreshness(accounts, now), ["synthetic:unknown"]);
  for (const total of totals) {
    assert.equal(total.status, "partial");
    assert.equal(total.account_coverage.length, 2);
    assert.equal(total.account_coverage.find(entry => entry.account_alias === "unknown").included, false);
    assert.equal(total.account_coverage.find(entry => entry.account_alias === "unknown").unavailable_reason, "no_snapshot");
  }
  assert.equal(totals[0].account_coverage.some(entry => entry.account_alias === "wallet"), false);
  assert.equal(totals[1].account_coverage.some(entry => entry.account_alias === "usd"), false);
});

const json = (body, status = 200) => Response.json(body, { status });
const defaults = {
  json, readSession: async () => ({ allowed: true }),
  accountOptions: async () => ({ options: { synthetic: [{ key: "synthetic-a", broker_environment: "live" }] } }),
  facts: async () => json({ accounts: [account("synthetic-a")] }),
  history: async () => json({ platform: "synthetic", account_key: "synthetic-a", series: { currency: "USD", points: [] } }),
  benchmarks: async () => json({ points: [] }),
};
const read = async (endpoint, deps = {}, query = "") => {
  const response = await performanceResponse(new Request(`https://synthetic.invalid/api/performance/${endpoint}${query}`), {}, { ...defaults, ...deps });
  return { status: response.status, body: await response.json() };
};

test("all facts-dependent endpoints return retryable 503 for unreadable source, without reading unrelated data", async () => {
  for (const endpoint of ["calendar", "summary", "returns", "assets", "holdings"]) {
    let unrelated = 0;
    const result = await read(endpoint, {
      facts: async () => json({ error: "synthetic-private-source-detail" }, 503),
      wallet: async () => { unrelated++; throw Error("not expected"); },
      history: async () => { unrelated++; throw Error("not expected"); },
      benchmarks: async () => { unrelated++; throw Error("not expected"); },
    });
    assert.equal(result.status, 503, endpoint);
    assert.equal(result.body.status, "unavailable", endpoint);
    assert.equal(result.body.unavailable_reason, "stored_records_unreadable");
    if (endpoint !== "holdings") assert.deepEqual(result.body.coverage.read_failures, ["account_facts_unreadable"]);
    assert.equal(JSON.stringify(result.body).includes("synthetic-private-source-detail"), false);
    assert.equal(unrelated, 0);
  }
});

test("explicitly disabled source stays distinct from read failure", async () => {
  for (const endpoint of ["summary", "assets", "holdings"]) {
    const result = await read(endpoint, { facts: async () => json({ error: "account_facts_disabled" }, 404) });
    assert.equal(result.status, 200);
    assert.notEqual(result.body.status, "unavailable");
    if (endpoint !== "holdings") assert.deepEqual(result.body.coverage.read_failures, []);
    assert.equal(result.body.account_freshness[0].unavailable_reason, "account_facts_disabled");
  }
});

test("native wallet-only assets are independent of common facts service", async () => {
  let factsReads = 0;
  const result = await read("assets", {
    accountOptions: async () => ({ options: { binance: [{ key: "synthetic-wallet", broker_environment: "live" }] } }),
    facts: async () => { factsReads++; throw Error("common source not required"); },
    wallet: async () => json({ currency: "USDT", points: [{ observation_date: "2026-10-27", observed_at: "2026-10-27T10:00:00Z", amount: "50" }] }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.per_currency[0].total, 50);
  assert.equal(factsReads, 0);
});

test("history read failure preserves known balances but exposes partial source status", async () => {
  const result = await read("assets", { history: async () => json({}, 503) });
  assert.equal(result.status, 200);
  assert.equal(result.body.per_currency[0].total, 100);
  assert.equal(result.body.status, "ok", "current balances retain their separate snapshot health");
  assert.equal(result.body.curve_status, "unavailable", "failed history cannot be described as successful empty history");
  assert.equal(result.body.curve_unavailable_reason, "stored_records_unreadable");
  assert.equal(result.body.history_per_currency[0].status, "unavailable");
  assert.deepEqual(result.body.coverage.read_failures, ["synthetic-a"]);
});

test("an unreadable currency history stays distinct from another currency's successful empty history", async () => {
  const result = await read("assets", {
    facts: async () => json({ accounts: [account("synthetic-a", undefined, {
      balances: [{ currency: "USD", net_assets: "100" }, { currency: "HKD", net_assets: "50" }],
    })] }),
    history: async request => new URL(request.url).searchParams.get("currency") === "USD"
      ? json({}, 503) : json({ platform: "synthetic", account_key: "synthetic-a", series: { currency: "HKD", points: [] } }),
  });
  const histories = new Map(result.body.history_per_currency.map(history => [history.currency, history]));
  assert.equal(histories.get("USD").status, "unavailable");
  assert.equal(histories.get("USD").unavailable_reason, "stored_records_unreadable");
  assert.equal(histories.get("HKD").status, "no_data");
  assert.equal(histories.get("HKD").unavailable_reason, "snapshot_history_missing");
});

test("identity failures retain per-account reasons instead of indistinguishable missing snapshots", async () => {
  for (const [changes, reason] of [[{ identity_mismatch: true }, "identity_mismatch"],
    [{ binding_status: "missing" }, "identity_not_bound"], [{ aggregation_status: "duplicate" }, "aggregation_duplicate"],
    [{ aggregation_status: "conflict" }, "aggregation_conflict"]]) {
    const result = await read("assets", {
      accountOptions: async () => ({ options: { synthetic: [{ key: "synthetic-a" }, { key: "synthetic-b" }] } }),
      facts: async () => json({ accounts: [account("synthetic-a"), account("synthetic-b", undefined, changes)] }),
    });
    assert.equal(result.body.per_currency[0].total, 100);
    assert.equal(result.body.per_currency[0].account_coverage.find(entry => entry.account_alias === "synthetic-b").unavailable_reason, reason);
  }
});

test("a missing member withholds currency drawdown rather than certifying its surviving subset", () => {
  const drawdown = currencyDrawdowns([{ id: "present", currency: "USD", points: [
    { date: "2026-10-26", value: 100, externalFlow: 0 }, { date: "2026-10-27", value: 80, externalFlow: 0 },
  ] }, { id: "missing", currency: "USD", points: [] }], "ALL", "2026-10-27", aggregateEquity, maxDrawdown)[0];
  assert.equal(drawdown.max_drawdown.percent, null);
  assert.equal(drawdown.max_drawdown.unavailable_reason, "snapshot_history_missing");
});
