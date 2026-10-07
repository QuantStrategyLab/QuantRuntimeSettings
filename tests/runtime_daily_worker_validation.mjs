import assert from "node:assert/strict";

import worker, { __test } from "../web/strategy-switch-console/worker.js";

const token = ["runtime", "daily", "sync"].join("-");
const sessionSecret = ["session", "secret"].join("-");
const store = new Map();
const puts = [];
const kv = {
  async get(key) { return store.get(key) ?? null; },
  async put(key, value) { puts.push(key); store.set(key, value); },
  async list(options = {}) {
    const prefix = typeof options.prefix === "string" ? options.prefix : "";
    const limit = Number.isInteger(options.limit) ? options.limit : 1000;
    const names = [...store.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const slice = names.slice(start, start + limit);
    const next = start + slice.length;
    return { keys: slice.map((name) => ({ name })), cursor: next < names.length ? String(next) : undefined };
  },
};
const env = {
  STRATEGY_SWITCH_CONFIG: kv,
  EXECUTION_EVIDENCE_SYNC_TOKEN: token,
  SESSION_SECRET: sessionSecret,
  ALLOWED_GITHUB_LOGINS: "daily-reader",
};
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const observedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const account = {
  key: "lb-paper",
  label: "LB paper",
  target_name: "lb-paper",
  service_name: "longbridge-quant-paper-service",
  account_scope: "paper",
  account_selector: "PAPER",
  deployment_selector: "lb-paper",
  default_strategy_profile: "other_strategy",
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
  default_strategy_profile: "russell_top50_leader_rotation",
};

function saveAccounts(items) {
  store.set("account_options", JSON.stringify({ longbridge: items }));
}

function projection(patch = {}, recordPatch = {}) {
  const { activity: activityPatch, schedule: schedulePatch, ...recordFields } = recordPatch;
  const businessDate = recordFields.business_date || today;
  const observed = recordFields.observed_at || observedAt;
  const status = recordFields.status || "no_submission";
  const activity = activityPatch || "no_submission";
  const record = {
    platform: "longbridge",
    target_key: "longbridge-quant-paper-service|russell_top50_leader_rotation|paper",
    target: {
      service: "longbridge-quant-paper-service",
      strategy_profile: "russell_top50_leader_rotation",
      account_scope: "paper",
    },
    business_date: businessDate,
    timezone: "America/New_York",
    observed_at: observed,
    status,
    kind: "run",
    completeness: "complete",
    execution_lane: "paper",
    schedule: {
      state: "due",
      business_date: businessDate,
      timezone: "America/New_York",
      latest_due_at: observed,
      next_due_at: null,
      grace_ends_at: null,
      publication_grace_ended: true,
      expected_window: "unspecified",
      reason: null,
    },
    runs: [{
      run_id: "run-1",
      source_object: "gs://private-bucket/runtime/run-1.json",
      source_objects: ["gs://private-bucket/runtime/run-1.json"],
      started_at: observed,
      finished_at: observed,
      object_updated_at: observed,
      report_status: "ok",
      execution_lane: "paper",
      activity,
      run_time_known: true,
      evidence: {
        execution_status: activity,
        broker_submission_done: activity === "submitted",
        action_done: false,
        orders_pending_count: 0,
        errors_present: false,
        receipt_outcome: activity,
        receipt_broker_confirmation: activity === "partially_filled" ? "partially_filled" : "not_observed",
      },
    }],
    excluded_reports: [],
    conflicts: [],
    fills: { source: "not_connected", records: [], count: null },
    ...recordFields,
    business_date: businessDate,
    observed_at: observed,
    status,
  };
  record.schedule = { ...record.schedule, business_date: businessDate, ...(schedulePatch || {}) };
  return {
    platform: "longbridge",
    observed_at: observed,
    completeness: "complete",
    read_errors: [],
    records: [record],
    unmatched_reports: [],
    ...patch,
    observed_at: observed,
  };
}

async function post(body, headers = {}, target = env) {
  return worker.fetch(new Request("https://switch.example/api/runtime-daily/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), target);
}

async function get(date, headers = {}, target = env) {
  return worker.fetch(new Request(`https://switch.example/api/runtime-daily?date=${date}`, { headers }), target);
}

saveAccounts([account]);
const before = puts.length;
const disabledPost = await post(projection(), { Authorization: `Bearer ${token}` }, { ...env, RUNTIME_DAILY_READ_MODEL_ENABLED: "false" });
assert.equal(disabledPost.status, 404);
assert.equal((await disabledPost.json()).error, "runtime_daily_disabled");
const disabledGet = await get(today, {}, { ...env, RUNTIME_DAILY_READ_MODEL_ENABLED: undefined });
assert.equal(disabledGet.status, 404);
assert.equal(puts.length, before);

env.RUNTIME_DAILY_READ_MODEL_ENABLED = "true";
const cookie = await __test.makeSession("daily-reader", [], env);
const sessionHeaders = { Cookie: `qsl_switch_session=${cookie}` };
assert.equal((await post(projection())).status, 401);
assert.equal((await post(projection(), sessionHeaders)).status, 401);
assert.equal((await post(projection(), { Authorization: "Bearer wrong-token" })).status, 401);
assert.equal((await get(today)).status, 401);
assert.equal((await get(today, { Authorization: `Bearer ${token}` })).status, 401);

saveAccounts([{ ...otherAccount }]);
const unmapped = await post(projection(), { Authorization: `Bearer ${token}` });
assert.equal(unmapped.status, 409);
assert.equal((await unmapped.json()).error, "runtime_daily_account_unattributed");
saveAccounts([
  account,
  { ...account, key: "lb-paper-2", label: "LB paper 2", target_name: "lb-paper-2", account_selector: "PAPER2", deployment_selector: "lb-paper-2" },
]);
assert.equal((await post(projection(), { Authorization: `Bearer ${token}` })).status, 409);
saveAccounts([{ ...account, account_scope: "PAPER" }]);
assert.equal((await post(projection(), { Authorization: `Bearer ${token}` })).status, 409);
assert.equal([...store.keys()].some((key) => key.startsWith("runtime_daily:")), false);

saveAccounts([account]);
const accountsBefore = store.get("account_options");
assert.equal((await post(projection({}, { target: { service: "other-service", strategy_profile: "russell_top50_leader_rotation", account_scope: "paper" }, target_key: "other-service|russell_top50_leader_rotation|paper" }), { Authorization: `Bearer ${token}` })).status, 400);
assert.equal((await post(projection({}, { timezone: "America/Chicago", schedule: { timezone: "America/Chicago" } }), { Authorization: `Bearer ${token}` })).status, 400);
assert.equal((await post(projection({}, { business_date: "2026-02-31" }), { Authorization: `Bearer ${token}` })).status, 400);
const future = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
assert.equal((await post(projection({}, { observed_at: future }), { Authorization: `Bearer ${token}` })).status, 400);
const tooMany = projection();
tooMany.records[0].runs = Array.from({ length: 21 }, (_, index) => ({ ...tooMany.records[0].runs[0], run_id: `run-${index}` }));
assert.equal((await (await post(tooMany, { Authorization: `Bearer ${token}` })).json()).error, "runtime_daily_run_limit");
const oversized = await post(`{"pad":"${"x".repeat(70_000)}"}`, { Authorization: `Bearer ${token}` });
assert.equal(oversized.status, 413);
assert.equal(store.get("account_options"), accountsBefore);
assert.equal([...store.keys()].some((key) => key.startsWith("runtime_daily:")), false);

const withAccountKey = projection();
withAccountKey.account_key = "lb-paper";
assert.equal((await post(withAccountKey, { Authorization: `Bearer ${token}` })).status, 400);
const orderedDate = "2020-01-10";
const orderedKey = "runtime_daily:" + account.service_name + "|russell_top50_leader_rotation|paper:" + orderedDate;
const auth = { Authorization: "Bearer " + token };
store.delete(orderedKey);
const firstObservation = projection({}, { business_date: orderedDate, observed_at: "2020-01-10T21:00:00Z" });
const writesBeforeFirstObservation = puts.length;
assert.equal((await post(firstObservation, auth)).status, 200);
assert.equal(puts.length, writesBeforeFirstObservation + 1);

// Simulate an equivalent stored object with a different JSON key order.
const firstStored = JSON.parse(store.get(orderedKey));
store.set(orderedKey, JSON.stringify(Object.fromEntries(Object.entries(firstStored).reverse())));
const writesBeforeIdempotentObservation = puts.length;
assert.equal((await post(firstObservation, auth)).status, 200);
assert.equal(puts.length, writesBeforeIdempotentObservation);

const olderObservation = projection({}, { business_date: orderedDate, observed_at: "2020-01-10T20:59:00Z" });
const olderResponse = await post(olderObservation, auth);
assert.equal(olderResponse.status, 409);
assert.equal((await olderResponse.json()).error, "runtime_daily_stale_observation");
assert.equal(puts.length, writesBeforeIdempotentObservation);

const sameTimeConflict = projection({}, { business_date: orderedDate, observed_at: firstObservation.observed_at, status: "failed", activity: "failed" });
const conflictingResponse = await post(sameTimeConflict, auth);
assert.equal(conflictingResponse.status, 409);
assert.equal((await conflictingResponse.json()).error, "runtime_daily_observation_conflict");
assert.equal(puts.length, writesBeforeIdempotentObservation);

const newerObservation = projection({}, { business_date: orderedDate, observed_at: "2020-01-10T21:01:00Z", status: "failed", activity: "failed" });
assert.equal((await post(newerObservation, auth)).status, 200);
assert.equal(puts.length, writesBeforeIdempotentObservation + 1);
assert.equal(JSON.parse(store.get(orderedKey)).observed_at, newerObservation.observed_at);

const mismatchedStored = projection({}, { business_date: "2020-01-11", observed_at: "2020-01-10T21:02:00Z" });
store.set(orderedKey, JSON.stringify(mismatchedStored));
const writesBeforeDateMismatch = puts.length;
const dateMismatchResponse = await post(
  projection({}, { business_date: orderedDate, observed_at: "2020-01-10T21:03:00Z" }),
  auth,
);
assert.equal(dateMismatchResponse.status, 409);
assert.equal((await dateMismatchResponse.json()).error, "runtime_daily_existing_record_invalid");
assert.equal(puts.length, writesBeforeDateMismatch);
store.delete(orderedKey);

const zeroFills = projection();
zeroFills.records[0].fills = { source: "not_connected", records: [], count: 0 };
assert.equal((await post(zeroFills, { Authorization: `Bearer ${token}` })).status, 400);

const partial = await post(projection({}, { status: "partially_filled", activity: "partially_filled" }), { Authorization: `Bearer ${token}` });
assert.equal(partial.status, 200);
const partialBody = await partial.json();
assert.equal(partialBody.account_key, "lb-paper");
assert.equal(partialBody.schema_version, undefined);
assert.equal(partialBody.no_order, undefined);
const partialRead = await (await get(today, sessionHeaders)).json();
assert.equal(partialRead.account_key, "lb-paper");
assert.equal(partialRead.record.status, "partially_filled");
assert.equal(partialRead.record.runs[0].activity, "partially_filled");
assert.equal(partialRead.record.runs[0].evidence, undefined);
assert.equal(partialRead.record.runs[0].source_object, undefined);
assert.equal(partialRead.read_errors, undefined);
assert.equal(partialRead.policy, undefined);
assert.equal(partialRead.current_health, undefined);
assert.equal(partialRead.fills.count, null);
assert.equal(partialRead.fills.records.length, 0);
assert.equal(partialRead.data_status, "fresh");
assert.equal(JSON.stringify(partialRead).includes("gs://"), false);

const unknown = await post(projection({}, { status: "unknown", activity: "unknown", business_date: "2020-01-02", observed_at: "2020-01-02T21:00:00Z" }), { Authorization: `Bearer ${token}` });
assert.equal(unknown.status, 200);
const unknownRead = await (await get("2020-01-02", sessionHeaders)).json();
assert.equal(unknownRead.record.status, "unknown");
assert.equal(unknownRead.record.runs[0].activity, "unknown");
assert.equal(unknownRead.data_status, "historical");
assert.equal(unknownRead.current_health, undefined);
assert.notEqual(unknownRead.record.status, "filled");

const submitted = await post(projection({}, { status: "submitted", activity: "submitted", business_date: "2020-01-03", observed_at: "2020-01-03T21:00:00Z" }), { Authorization: `Bearer ${token}` });
assert.equal(submitted.status, 200);
const submittedRead = await (await get("2020-01-03", sessionHeaders)).json();
assert.equal(submittedRead.record.status, "submitted");
assert.notEqual(submittedRead.record.status, "filled");
assert.equal(submittedRead.data_status, "historical");

store.delete(`runtime_daily:longbridge-quant-paper-service|russell_top50_leader_rotation|paper:${today}`);
const freshUnknown = await post(projection({}, { status: "unknown", activity: "unknown" }), { Authorization: `Bearer ${token}` });
assert.equal(freshUnknown.status, 200);
const freshUnknownRead = await (await get(today, sessionHeaders)).json();
assert.equal(freshUnknownRead.record.status, "unknown");
assert.equal(freshUnknownRead.record.completeness, "complete");
assert.equal(freshUnknownRead.data_status, "fresh");
store.delete(`runtime_daily:longbridge-quant-paper-service|russell_top50_leader_rotation|paper:${today}`);
const freshFailed = await post(projection({}, { status: "failed", activity: "failed" }), { Authorization: `Bearer ${token}` });
assert.equal(freshFailed.status, 200);
const freshFailedRead = await (await get(today, sessionHeaders)).json();
assert.equal(freshFailedRead.record.status, "failed");
assert.equal(freshFailedRead.data_status, "fresh");

const nextDue = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const graceEnds = new Date(Date.now() + 30 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
store.delete(`runtime_daily:longbridge-quant-paper-service|russell_top50_leader_rotation|paper:${today}`);
const planned = await post(projection({}, { schedule: { latest_due_at: observedAt, next_due_at: nextDue, grace_ends_at: graceEnds } }), { Authorization: `Bearer ${token}` });
assert.equal(planned.status, 200);
const plannedRead = await (await get(today, sessionHeaders)).json();
assert.equal(plannedRead.record.schedule.next_due_at, nextDue);
assert.equal(plannedRead.record.schedule.grace_ends_at, graceEnds);
assert.equal(plannedRead.data_status, "fresh");
const futureRun = projection();
futureRun.records[0].runs[0].finished_at = future;
assert.equal((await post(futureRun, { Authorization: `Bearer ${token}` })).status, 400);
assert.equal((await post(projection({}, { observed_at: "2026-02-30T15:00:00Z" }), { Authorization: `Bearer ${token}` })).status, 400);
assert.equal((await post(projection({}, { observed_at: "2026-02-29T21:00:00Z" }), { Authorization: `Bearer ${token}` })).status, 400);
assert.equal((await post(projection({}, { schedule: { next_due_at: "2026-02-30T15:00:00Z" } }), { Authorization: `Bearer ${token}` })).status, 400);
assert.equal((await post(projection({}, { schedule: { grace_ends_at: "2026-04-31T15:04:05-04:00" } }), { Authorization: `Bearer ${token}` })).status, 400);

const expiredAt = new Date(Date.now() - 37 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
store.delete(`runtime_daily:longbridge-quant-paper-service|russell_top50_leader_rotation|paper:${today}`);
const expired = await post(projection({}, { observed_at: expiredAt, status: "failed", activity: "failed" }), { Authorization: `Bearer ${token}` });
assert.equal(expired.status, 200);
const expiredRead = await (await get(today, sessionHeaders)).json();
assert.equal(expiredRead.record.status, "failed");
assert.equal(expiredRead.data_status, "stale");

const missing = await (await get("2020-01-04", sessionHeaders)).json();
assert.equal(missing.data_status, "unavailable");
assert.equal(missing.record, null);
assert.equal(missing.fills, null);
assert.equal(JSON.stringify(missing).includes('"count":0'), false);
assert.equal(store.get("account_options"), accountsBefore);
assert.equal(puts.every((key) => key.startsWith("runtime_daily:")), true);
assert.equal(puts.includes("account_options"), false);

const boolWindow = projection();
boolWindow.records[0].schedule.expected_window = true;
assert.equal((await post(boolWindow, { Authorization: `Bearer ${token}` })).status, 400);

// Shapes from LongBridge project_daily_runtime on 2026-09-25, cron 5 16 * * 1-5 America/New_York.
// expected_window stays the generator enum. publication_grace_ended stays null until the grace path.
const producerEnvelope = {
  platform: "longbridge",
  completeness: "complete",
  read_errors: [],
  unmatched_reports: [],
};
const producerRecord = {
  platform: "longbridge",
  target_key: "longbridge-quant-paper-service|russell_top50_leader_rotation|paper",
  target: {
    service: "longbridge-quant-paper-service",
    strategy_profile: "russell_top50_leader_rotation",
    account_scope: "paper",
  },
  business_date: "2026-09-25",
  timezone: "America/New_York",
  kind: "schedule",
  completeness: "complete",
  execution_lane: "insufficient",
  runs: [],
  excluded_reports: [],
  conflicts: [],
  fills: { source: "not_connected", records: [], count: null },
};
const producerCases = [
  {
    name: "not_due",
    body: {
      ...producerEnvelope,
      observed_at: "2026-09-25T14:00:00Z",
      records: [{
        ...producerRecord,
        observed_at: "2026-09-25T14:00:00Z",
        status: "not_due",
        schedule: {
          state: "not_due",
          business_date: "2026-09-25",
          timezone: "America/New_York",
          latest_due_at: null,
          next_due_at: "2026-09-25T20:05:00Z",
          grace_ends_at: null,
          publication_grace_ended: null,
          expected_window: "unspecified",
          reason: "before_schedule",
        },
      }],
    },
  },
  {
    name: "market_closed",
    body: {
      ...producerEnvelope,
      observed_at: "2026-09-25T20:40:00Z",
      records: [{
        ...producerRecord,
        observed_at: "2026-09-25T20:40:00Z",
        status: "market_closed",
        schedule: {
          state: "market_closed",
          business_date: "2026-09-25",
          timezone: "America/New_York",
          latest_due_at: "2026-09-25T20:05:00Z",
          next_due_at: null,
          grace_ends_at: null,
          publication_grace_ended: null,
          expected_window: "unspecified",
          reason: "market_closed",
        },
      }],
    },
  },
  {
    name: "due",
    body: {
      ...producerEnvelope,
      observed_at: "2026-09-25T20:40:00Z",
      completeness: "incomplete",
      records: [{
        ...producerRecord,
        observed_at: "2026-09-25T20:40:00Z",
        status: "missing_report",
        kind: "incomplete",
        completeness: "incomplete",
        schedule: {
          state: "due",
          business_date: "2026-09-25",
          timezone: "America/New_York",
          latest_due_at: "2026-09-25T20:05:00Z",
          next_due_at: null,
          grace_ends_at: "2026-09-25T20:35:00Z",
          publication_grace_ended: true,
          expected_window: "unspecified",
          reason: "publication_grace_ended",
        },
      }],
    },
  },
];
for (const item of producerCases) {
  const schedule = item.body.records[0].schedule;
  // These producer fixtures are independent examples sharing a KV date key.
  // Clear prior fixture state so equal observed_at values do not model a conflict.
  store.delete(`runtime_daily:${item.body.records[0].target_key}:${item.body.records[0].business_date}`);
  assert.equal(typeof schedule.expected_window, "string");
  assert.notEqual(typeof schedule.expected_window, "boolean");
  const posted = await post(item.body, { Authorization: `Bearer ${token}` });
  assert.equal(posted.status, 200, item.name);
  const stored = JSON.parse(store.get(`runtime_daily:${item.body.records[0].target_key}:${item.body.records[0].business_date}`));
  assert.equal(stored.records[0].schedule.expected_window, schedule.expected_window);
  assert.equal(stored.records[0].schedule.publication_grace_ended, schedule.publication_grace_ended);
  const read = await (await get(item.body.records[0].business_date, sessionHeaders)).json();
  assert.equal(read.record.status, item.body.records[0].status);
  assert.equal(read.record.schedule.state, schedule.state);
  assert.equal(read.record.schedule.expected_window, "unspecified");
  assert.equal(read.record.schedule.publication_grace_ended, schedule.publication_grace_ended);
  assert.equal(read.data_status, "historical");
}

// Legacy LongBridge accepts bounded diagnostics privately; none becomes a public
// reason or a Schwab closed-session attestation, even if the text matches a code.
for (const reason of ["private-diagnostic-must-not-leak", "no_cron_on_business_date", "market_closed"]) {
  const body = structuredClone(producerCases[0].body);
  body.records[0].schedule.reason = reason;
  const key = `runtime_daily:${body.records[0].target_key}:${body.records[0].business_date}`;
  store.delete(key);
  assert.equal((await post(body, { Authorization: `Bearer ${token}` })).status, 200);
  const read = await (await get(body.records[0].business_date, sessionHeaders)).json();
  assert.equal(Object.hasOwn(read.record.schedule, "reason"), false, "LongBridge public schedule shape stays unchanged");
  assert.equal(JSON.stringify(read).includes("private-diagnostic-must-not-leak"), false);
}

const historicalKey = "runtime_daily:longbridge-quant-paper-service|russell_top50_leader_rotation|paper:2020-01-03";
const preserved = store.get(historicalKey);
const readFailureKv = { ...kv, async get(key) { if (key === historicalKey) throw new Error("synthetic read failure"); return kv.get(key); } };
const readFailure = await get("2020-01-03", sessionHeaders, { ...env, STRATEGY_SWITCH_CONFIG: readFailureKv });
assert.equal(readFailure.status, 503);
assert.equal((await readFailure.json()).error, "runtime_daily_read_failed");
for (const invalid of [{ invalid: true }, false, 0]) {
  store.set(historicalKey, JSON.stringify(invalid));
  const invalidRecord = await get("2020-01-03", sessionHeaders);
  assert.equal(invalidRecord.status, 503);
  assert.equal((await invalidRecord.json()).error, "runtime_daily_record_invalid");
}
store.set(historicalKey, preserved);
assert.equal((await get("2020-01-03", sessionHeaders)).status, 200, "UI's 90-day range does not restrict retained older records");

// History coverage reports exactly the stored business dates for the target,
// scoped by the fixed runtime-daily key prefix.
for (const key of [...store.keys()]) if (key.startsWith("runtime_daily:")) store.delete(key);
const coverageDayA = "2026-09-30";
const coverageDayB = "2026-10-01";
assert.equal((await post(projection({}, { business_date: coverageDayA, observed_at: `${coverageDayA}T20:00:00Z` }), { Authorization: `Bearer ${token}` })).status, 200);
assert.equal((await post(projection({}, { business_date: coverageDayB, observed_at: `${coverageDayB}T20:00:00Z` }), { Authorization: `Bearer ${token}` })).status, 200);
const expectedCoverage = { available_from: coverageDayA, available_through: coverageDayB, stored_days: 2, truncated: false };
const coverageRead = await (await get(coverageDayB, sessionHeaders)).json();
assert.deepEqual(coverageRead.history, expectedCoverage);
const coverageUnavailable = await (await get("2020-01-04", sessionHeaders)).json();
assert.deepEqual(coverageUnavailable.history, expectedCoverage, "coverage does not depend on the selected date");
const noListKv = { async get(key) { return store.get(key) ?? null; }, async put(key, value) { store.set(key, value); } };
const noListRead = await (await get(coverageDayB, sessionHeaders, { ...env, STRATEGY_SWITCH_CONFIG: noListKv })).json();
assert.deepEqual(noListRead.history, { available_from: null, available_through: null, stored_days: 0, truncated: false });

console.log("runtime_daily_worker_validation ok");
await import("./runtime_daily_health_integration_validation.mjs");
