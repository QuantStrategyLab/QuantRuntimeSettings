import assert from "node:assert/strict";
import { test } from "node:test";
import { todaySummary } from "../web/strategy-switch-console/application/console_api/operations.js";

const now = Date.parse("2026-10-22T12:00:00Z");
const date = "2026-10-22";
const accounts = Array.from({ length: 8 }, (_, index) => ({
  platform: index < 2 ? "longbridge" : "ibkr", key: `synthetic-${index}`,
}));
const bindingFor = account => ({
  platform: account.platform, account_key: account.key,
  target_key: `synthetic-service|synthetic-strategy|${account.key}`, status: "bound",
});
const runFor = (account, activity = "no_signal") => ({
  run_id: `synthetic-run-${account.key}`, started_at: "2026-10-22T11:00:00Z",
  finished_at: "2026-10-22T11:01:00Z", activity,
  execution_lane: "dry_run", errors_present: activity === "failed",
});
function dailyBody(account, overrides = {}, recordOverrides = {}) {
  return {
    account_key: account.key, platform: account.platform, date, data_status: "fresh",
    read_error_count: 0, unmatched_count: 0,
    record: {
      business_date: date, target_key: bindingFor(account).target_key,
      observed_at: "2026-10-22T11:02:00Z", status: "no_signal",
      completeness: "complete", conflict_count: 0, runs: [runFor(account)],
      ...recordOverrides,
    },
    ...overrides,
  };
}
async function summarize({ selected = accounts, bindings = selected.map(bindingFor),
  read = account => Response.json(dailyBody(account)), at = now } = {}) {
  const reads = [];
  const env = {};
  const summary = await todaySummary(new Request("https://console.example/api/runtime/today", {
    headers: { "x-synthetic-observer": "read-only" },
  }), env, {
    dailyBindings: async actualEnv => {
      assert.equal(actualEnv, env);
      return bindings;
    },
    daily: async (request, actualEnv) => {
      assert.equal(actualEnv, env);
      assert.equal(request.method, "GET");
      assert.equal(request.headers.get("x-synthetic-observer"), "read-only");
      const url = new URL(request.url);
      assert.equal(url.origin, "https://console.example");
      assert.equal(url.pathname, "/api/runtime-daily");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["account_key", "date", "include_history", "platform"]);
      assert.equal(url.searchParams.get("include_history"), "false");
      const account = selected.find(item => item.platform === url.searchParams.get("platform")
        && item.key === url.searchParams.get("account_key"));
      assert.ok(account);
      reads.push({ account, date: url.searchParams.get("date") });
      return read(account, url);
    },
  }, selected, at);
  assert.equal(summary.no_order, true);
  assert.equal(summary.execution_authority_granted, false);
  assert.equal(summary.coverage, "configured_accounts_existing_bound_daily_records");
  assert.equal(summary.counts.configured, selected.length);
  assert.equal(summary.accounts.length, selected.length);
  assert.equal(Object.values(summary.counts.by_state).reduce((total, count) => total + count, 0), selected.length);
  return { summary, reads };
}

test("two observed accounts remain visible with six unbound accounts; an unknown cohort total stays null", async () => {
  const { summary, reads } = await summarize({
    bindings: accounts.slice(0, 2).map(bindingFor),
    read: account => Response.json(dailyBody(account, {}, account === accounts[1]
      ? { status: "failed", runs: [runFor(account, "failed")] } : {})),
  });
  assert.equal(summary.status, "partial");
  assert.equal(summary.counts.observed, 2);
  assert.equal(summary.counts.runs, null);
  assert.equal(reads.length, 2);
  assert.ok(reads.every(read => read.date === date));
  assert.deepEqual(summary.accounts.slice(0, 2).map(account => account.run_count), [1, 1]);
  assert.deepEqual(summary.accounts.slice(0, 2).flatMap(account => account.runs.map(run => run.id)),
    accounts.slice(0, 2).map(account => runFor(account).run_id));
  assert.equal(summary.counts.by_state.succeeded, 1);
  assert.equal(summary.counts.by_state.failed, 1);
  assert.equal(summary.counts.by_state.not_connected, 6);
  for (const account of summary.accounts.slice(2)) {
    assert.equal(account.status, "not_connected");
    assert.equal(account.unavailable_reason, "runtime_daily_not_connected");
    assert.equal(account.run_count, null);
    assert.equal(account.as_of, null);
    assert.deepEqual(account.runs, []);
  }
});

test("disabled or unresolved daily bindings do not create observations or inferred runs", async () => {
  for (const bindings of [[], accounts.map(account => ({ ...bindingFor(account), status: "unresolved" }))]) {
    const { summary, reads } = await summarize({ bindings });
    assert.equal(reads.length, 0);
    assert.equal(summary.status, "partial");
    assert.equal(summary.as_of, null);
    assert.equal(summary.counts.observed, 0);
    assert.equal(summary.counts.runs, null);
    assert.equal(summary.counts.by_state.succeeded, 0);
    assert.equal(summary.counts.by_state.not_connected, 8);
  }
});

for (const [name, overrides, recordOverrides] of [
  ["incomplete record", {}, { completeness: "incomplete" }],
  ["source read errors", { read_error_count: 1 }, {}],
  ["unmatched reports", { unmatched_count: 1 }, {}],
  ["conflicting reports", {}, { conflict_count: 1 }],
]) test(`${name} preserves observed reports without declaring a complete total or success`, async () => {
  const reports = [runFor(accounts[0]), { ...runFor(accounts[0]), run_id: "synthetic-second-run" }];
  const { summary } = await summarize({ selected: [accounts[0]],
    read: account => Response.json(dailyBody(account, overrides, { ...recordOverrides, runs: reports })),
  });
  assert.equal(summary.status, "partial");
  assert.equal(summary.counts.observed, 1);
  assert.equal(summary.counts.runs, null);
  assert.equal(summary.accounts[0].status, "partial");
  assert.equal(summary.accounts[0].unavailable_reason, "runtime_daily_incomplete");
  assert.equal(summary.accounts[0].completeness, "incomplete");
  assert.equal(summary.accounts[0].run_count, 2);
  assert.deepEqual(summary.accounts[0].runs.map(run => run.id), reports.map(run => run.run_id));
  assert.equal(summary.counts.by_state.succeeded, 0);
  assert.equal(summary.counts.by_state.unknown, 1);
});

test("a read failure retains other accounts' observed reports instead of inventing zero or success", async () => {
  const { summary } = await summarize({ selected: accounts.slice(0, 2),
    read: account => account === accounts[0] ? Response.json(dailyBody(account)) : new Response(null, { status: 503 }),
  });
  assert.equal(summary.status, "read_failed");
  assert.equal(summary.counts.observed, 1);
  assert.equal(summary.counts.runs, null);
  assert.equal(summary.accounts[0].run_count, 1);
  assert.equal(summary.accounts[1].run_count, null);
  assert.equal(summary.accounts[1].unavailable_reason, "stored_records_unreadable");
  assert.equal(summary.counts.by_state.read_failed, 1);
});

test("a bound account without today's record is missing, not a known zero-run day", async () => {
  const { summary } = await summarize({ selected: [accounts[0]],
    read: account => Response.json(dailyBody(account, { record: null, data_status: "unavailable" })),
  });
  assert.equal(summary.accounts[0].status, "no_data");
  assert.equal(summary.accounts[0].unavailable_reason, "today_record_missing");
  assert.equal(summary.market_session, "trading_day");
  assert.equal(summary.counts.observed, 0);
  assert.equal(summary.counts.runs, null);
  assert.equal(summary.counts.by_state.no_data, 1);
});

test("a weekend without records is a non-trading day, not missing data", async () => {
  const saturday = Date.parse("2026-10-24T12:00:00Z");
  const { summary } = await summarize({ selected: [accounts[2]],
    at: saturday,
    read: account => Response.json(dailyBody(account, { date: "2026-10-24", record: null, data_status: "unavailable" },
      { business_date: "2026-10-24" })),
  });
  assert.equal(summary.market_session, "weekend");
  assert.equal(summary.accounts[0].status, "no_data");
  assert.equal(summary.accounts[0].unavailable_reason, "non_trading_weekend");
});

test("ambiguous ownership never reads or merges reports across bindings", async () => {
  const binding = bindingFor(accounts[0]);
  const { summary, reads } = await summarize({ selected: [accounts[0]],
    bindings: [binding, { ...binding, target_key: "synthetic-other|strategy|scope" }],
  });
  assert.equal(reads.length, 0);
  assert.equal(summary.counts.observed, 0);
  assert.equal(summary.counts.runs, null);
  assert.equal(summary.accounts[0].status, "partial");
  assert.equal(summary.accounts[0].unavailable_reason, "runtime_daily_binding_conflict");
  assert.equal(summary.accounts[0].run_status, "unknown");
});

for (const [name, overrides, recordOverrides] of [
  ["account", { account_key: "synthetic-other" }, {}],
  ["platform", { platform: "synthetic-other" }, {}],
  ["response date", { date: "2026-10-21" }, {}],
  ["record date", {}, { business_date: "2026-10-21" }],
  ["target", {}, { target_key: "synthetic-other|strategy|scope" }],
]) test(`mismatched ${name} cannot become an observed run`, async () => {
  const { summary } = await summarize({ selected: [accounts[0]],
    read: account => Response.json(dailyBody(account, overrides, recordOverrides)),
  });
  assert.equal(summary.status, "read_failed");
  assert.equal(summary.counts.observed, 0);
  assert.equal(summary.counts.runs, null);
  assert.equal(summary.accounts[0].run_status, "read_failed");
  assert.deepEqual(summary.accounts[0].runs, []);
});

for (const [instant, expectedDate] of [
  ["2026-10-22T02:00:00Z", "2026-10-21"],
  ["2026-11-01T03:59:59Z", "2026-10-31"],
  ["2026-11-01T06:30:00Z", "2026-11-01"],
]) test(`today follows New York's business date at ${instant}, not the browser's date`, async () => {
  const { summary, reads } = await summarize({ selected: [accounts[0]], at: Date.parse(instant),
    read: account => Response.json(dailyBody(account, { date: expectedDate }, { business_date: expectedDate })),
  });
  assert.equal(summary.date, expectedDate);
  assert.equal(summary.timezone, "America/New_York");
  assert.equal(reads[0].date, expectedDate);
  assert.equal(summary.status, "ok");
});

test("a complete eight-account cohort totals only stored reports, including an observed not-due day", async () => {
  const { summary } = await summarize({ read: account => Response.json(dailyBody(account, {},
    account === accounts[7] ? { status: "not_due", runs: [] } : {})),
  });
  assert.equal(summary.status, "ok");
  assert.equal(summary.counts.observed, 8);
  assert.equal(summary.counts.runs, 7);
  assert.equal(summary.counts.by_state.succeeded, 7);
  assert.equal(summary.counts.by_state.not_run, 1);
  assert.equal(summary.accounts[7].run_count, 0);
});

test("a stale same-day failure remains stale and failed, never a fresh successful run", async () => {
  const { summary } = await summarize({ selected: [accounts[0]],
    read: account => Response.json(dailyBody(account, { data_status: "stale" },
      { status: "failed", runs: [runFor(account, "failed")] })),
  });
  assert.equal(summary.status, "partial");
  assert.equal(summary.accounts[0].status, "stale");
  assert.equal(summary.accounts[0].unavailable_reason, "runtime_daily_stale");
  assert.equal(summary.accounts[0].run_status, "failed");
  assert.equal(summary.counts.observed, 1);
  assert.equal(summary.accounts[0].run_count, 1);
  assert.equal(summary.counts.by_state.failed, 1);
  assert.equal(summary.counts.by_state.succeeded, 0);
});

test("an incomplete blocked report remains blocked instead of failed or successful", async () => {
  const { summary } = await summarize({ selected: [accounts[0]],
    read: account => Response.json(dailyBody(account, {}, { status: "blocked", completeness: "incomplete",
      block_reason_code: "market_closed", runs: [{ ...runFor(account, "blocked"), errors_present: true }] })),
  });
  assert.equal(summary.counts.observed, 1);
  assert.equal(summary.counts.runs, null);
  assert.equal(summary.accounts[0].run_count, 1);
  assert.equal(summary.accounts[0].run_status_reason, "market_closed");
  assert.equal(summary.counts.by_state.blocked, 1);
  assert.equal(summary.counts.by_state.failed, 0);
  assert.equal(summary.counts.by_state.succeeded, 0);
});
