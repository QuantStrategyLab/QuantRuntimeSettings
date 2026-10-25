import assert from "node:assert/strict";

import {
  ACCOUNT_FACTS_BINDINGS_SCHEMA,
  ACCOUNT_FACTS_HISTORY_SCHEMA,
  ACCOUNT_FACTS_OPTION_SCOPE,
  ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
  ACCOUNT_FACTS_SOURCE_KIND,
  accountFactsHistoryIdentityMatches,
  buildAccountFactsHistoryReadModel,
  buildAccountFactsReadModel,
  normalizeAccountFactsBindings,
  normalizeAccountFactsHistoryPayload,
  projectAccountFactsHistorySeries,
  projectStoredAccountFacts,
  resolveTrustedAccountFactsBinding,
} from "../web/strategy-switch-console/account_facts.js";

// Synthetic source lineage only: an approved rotation may keep old daily rows
// readable, but nothing here is inferred from payloads or widened for writes.
const currentId = "b".repeat(64);
const historyId = "a".repeat(64);
const unlistedId = "c".repeat(64);
const targetId = "synthetic-lineage";
const account = {
  key: "synthetic-lineage",
  label: "Synthetic lineage",
  target_name: "synthetic-lineage",
  service_name: "synthetic-lineage-service",
  account_scope: ACCOUNT_FACTS_OPTION_SCOPE,
  account_selector: "PAPER",
  deployment_selector: "synthetic-lineage",
};

function bindingPayload(items) {
  return { schema_version: ACCOUNT_FACTS_BINDINGS_SCHEMA, bindings: items };
}

function lineageBinding(patch = {}) {
  return {
    platform: "longbridge",
    account_key: account.key,
    account_scope: account.account_scope,
    target_name: account.target_name,
    service_name: account.service_name,
    deployment_selector: account.deployment_selector,
    account_selector: account.account_selector,
    target_id: targetId,
    source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, id: currentId },
    ...patch,
  };
}

function payloadFor(day, amount, sourceId, patch = {}) {
  return {
    schema_version: ACCOUNT_FACTS_HISTORY_SCHEMA,
    snapshot_schema_version: ACCOUNT_FACTS_SNAPSHOT_SCHEMA,
    account_scope: "PAPER",
    target_id: targetId,
    source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: sourceId },
    observed_started_at: `${day}T10:00:00Z`,
    observed_finished_at: `${day}T10:01:00Z`,
    snapshot_atomic: false,
    observation_date: day,
    broker_reported_balances: [{ currency: "USD", net_assets: amount, total_cash: "1" }],
    cash: [{ currency: "USD", available_cash: "1", frozen_cash: "0", settling_cash: "0" }],
    ...patch,
  };
}

function dayRow({ day, sourceId, amount, patch = {}, target = targetId, scope = ACCOUNT_FACTS_OPTION_SCOPE }) {
  return {
    observation_date: day,
    target_id: target,
    source_binding_id: sourceId,
    account_scope: scope,
    payload: payloadFor(day, amount, sourceId, patch),
  };
}

const approvedBindings = normalizeAccountFactsBindings(bindingPayload([
  lineageBinding({ history_source_binding_ids: [historyId] }),
]));
const approved = approvedBindings.bindings[0];
assert.deepEqual(approved.history_source_binding_ids, [historyId], "normalization preserves explicit lineage");
assert.deepEqual(approved.source_binding, { kind: ACCOUNT_FACTS_SOURCE_KIND, id: currentId });

const currentOnly = normalizeAccountFactsBindings(bindingPayload([lineageBinding()])).bindings[0];
assert.equal(Object.hasOwn(currentOnly, "history_source_binding_ids"), false, "lineage stays absent unless configured");

// Identity metadata: exact target/scope, then current or explicitly listed source.
assert.equal(accountFactsHistoryIdentityMatches(
  { target_id: targetId, source_binding_id: currentId, account_scope: ACCOUNT_FACTS_OPTION_SCOPE }, approved,
), true);
assert.equal(accountFactsHistoryIdentityMatches(
  { target_id: targetId, source_binding_id: historyId, account_scope: ACCOUNT_FACTS_OPTION_SCOPE }, approved,
), true);
assert.equal(accountFactsHistoryIdentityMatches(
  { target_id: targetId, source_binding_id: unlistedId, account_scope: ACCOUNT_FACTS_OPTION_SCOPE }, approved,
), false, "an unlisted old source never matches");
assert.equal(accountFactsHistoryIdentityMatches(
  { target_id: "other-target", source_binding_id: historyId, account_scope: ACCOUNT_FACTS_OPTION_SCOPE }, approved,
), false);
assert.equal(accountFactsHistoryIdentityMatches(
  { target_id: targetId, source_binding_id: historyId, account_scope: "HK" }, approved,
), false);
assert.equal(accountFactsHistoryIdentityMatches(
  { target_id: targetId, source_binding_id: historyId, account_scope: ACCOUNT_FACTS_OPTION_SCOPE }, currentOnly,
), false, "without protected lineage the old source stays excluded");

// Approved A→B rotation: the old day and the new day both remain readable.
const approvedSeries = projectAccountFactsHistorySeries({
  binding: approved,
  currency: "USD",
  days: [
    dayRow({ day: "2026-01-09", sourceId: historyId, amount: "10" }),
    dayRow({ day: "2026-01-10", sourceId: currentId, amount: "11" }),
  ],
});
assert.deepEqual(approvedSeries.points.map((point) => [point.observation_date, point.net_assets]), [
  ["2026-01-09", "10"],
  ["2026-01-10", "11"],
]);
assert.deepEqual(approvedSeries.gap_dates, []);

const approvedHistoryModel = buildAccountFactsHistoryReadModel({
  platform: "longbridge",
  accountKey: account.key,
  currency: "USD",
  option: account,
  binding: approved,
  days: [
    dayRow({ day: "2026-01-09", sourceId: historyId, amount: "10" }),
    dayRow({ day: "2026-01-10", sourceId: currentId, amount: "11" }),
  ],
});
assert.equal(approvedHistoryModel.binding_status, "bound");
assert.deepEqual(approvedHistoryModel.series.points.map((point) => point.net_assets), ["10", "11"]);

// Same stored rows without the explicit list keep the pre-existing rotation behavior.
const rotatedSeries = projectAccountFactsHistorySeries({
  binding: currentOnly,
  currency: "USD",
  days: [
    dayRow({ day: "2026-01-09", sourceId: historyId, amount: "10" }),
    dayRow({ day: "2026-01-10", sourceId: currentId, amount: "11" }),
  ],
});
assert.deepEqual(rotatedSeries.points.map((point) => point.net_assets), ["11"]);

// Unlisted or unverifiable sources stay excluded even when metadata claims them.
const rejectedDays = [
  dayRow({ day: "2026-01-09", sourceId: unlistedId, amount: "10" }),
  // Metadata says a listed source, payload proves a different one.
  dayRow({ day: "2026-01-09", sourceId: historyId, amount: "10", patch: {
    source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: currentId },
  } }),
  dayRow({ day: "2026-01-09", sourceId: currentId, amount: "10", patch: {
    source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: historyId },
  } }),
  dayRow({ day: "2026-01-09", sourceId: historyId, amount: "10", patch: {
    source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, status: "bound", id: unlistedId },
  } }),
  // Metadata matches, payload target or scope drifts.
  dayRow({ day: "2026-01-09", sourceId: historyId, amount: "10", patch: { target_id: "other-target" } }),
  dayRow({ day: "2026-01-09", sourceId: historyId, amount: "10", patch: { account_scope: "HK" } }),
  // Metadata target/scope drift, payload internally consistent.
  dayRow({ day: "2026-01-09", sourceId: historyId, amount: "10", target: "other-target" }),
  dayRow({ day: "2026-01-09", sourceId: historyId, amount: "10", scope: "HK" }),
];
for (const day of rejectedDays) {
  const series = projectAccountFactsHistorySeries({ binding: approved, currency: "USD", days: [day] });
  assert.deepEqual(series.points, [], `rejected lineage day leaked: ${JSON.stringify(day)}`);
}
assert.equal(
  projectAccountFactsHistorySeries({
    binding: approved,
    currency: "USD",
    days: [dayRow({ day: "2026-01-10", sourceId: currentId, amount: "11" })],
  }).points.length,
  1,
  "the current source is unaffected by lineage configuration",
);

// Lineage list shape is closed: non-empty, distinct lowercase 64-hex, never the current id.
const maxIds = Array.from({ length: 64 }, (_, index) => (index + 1).toString(16).padStart(64, "0"));
assert.doesNotThrow(() => normalizeAccountFactsBindings(bindingPayload([
  lineageBinding({ history_source_binding_ids: maxIds }),
])), undefined, "64 distinct prior ids are accepted");
for (const invalid of [
  "a".repeat(64),
  null,
  {},
  [],
  [historyId, historyId],
  [currentId],
  [historyId.toUpperCase()],
  [historyId.slice(1)],
  [123],
  [null],
  [historyId, ""],
  [...maxIds, "f".repeat(64)],
]) {
  assert.throws(
    () => normalizeAccountFactsBindings(bindingPayload([
      lineageBinding({ history_source_binding_ids: invalid }),
    ])),
    /invalid_account_facts_bindings/,
    `invalid lineage list accepted: ${JSON.stringify(invalid)}`,
  );
}

// One source can belong to only one account under a target, current or historical.
for (const conflicting of [
  [
    lineageBinding({ account_key: "synthetic-first", history_source_binding_ids: [historyId] }),
    lineageBinding({ account_key: "synthetic-second", source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, id: historyId } }),
  ],
  [
    lineageBinding({ account_key: "synthetic-first", source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, id: historyId } }),
    lineageBinding({ account_key: "synthetic-second", history_source_binding_ids: [historyId] }),
  ],
  [
    lineageBinding({ account_key: "synthetic-first", history_source_binding_ids: [historyId] }),
    lineageBinding({
      account_key: "synthetic-second",
      source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, id: unlistedId },
      history_source_binding_ids: [historyId],
    }),
  ],
]) {
  assert.throws(
    () => normalizeAccountFactsBindings(bindingPayload(conflicting)),
    /duplicate_account_facts_binding/,
  );
}
assert.doesNotThrow(() => normalizeAccountFactsBindings(bindingPayload([
  lineageBinding({ account_key: "synthetic-first", history_source_binding_ids: [historyId] }),
  lineageBinding({
    account_key: "synthetic-second",
    target_id: "synthetic-other-target",
    source_binding: { kind: ACCOUNT_FACTS_SOURCE_KIND, id: unlistedId },
    history_source_binding_ids: [historyId],
  }),
])), undefined, "the same source id under a different target is a separate namespace");

// Current snapshots and new inbound writes still accept only the current id.
const oldStored = normalizeAccountFactsHistoryPayload(payloadFor("2026-01-09", "10", historyId), {
  enforceObservationWindow: false,
});
assert.throws(() => normalizeAccountFactsHistoryPayload(payloadFor("2026-01-10", "11", historyId), {
  expectedPlatform: "longbridge",
  expectedTargetId: targetId,
  expectedBindingId: currentId,
  expectedOptionScope: ACCOUNT_FACTS_OPTION_SCOPE,
  enforceObservationWindow: false,
}), /account_facts_binding_mismatch/);
assert.throws(() => normalizeAccountFactsHistoryPayload(payloadFor("2026-01-10", "11", currentId, {
  history_source_binding_ids: [historyId],
}), { enforceObservationWindow: false }), /invalid_account_facts_history/,
"inbound payloads cannot declare their own lineage");
assert.deepEqual(resolveTrustedAccountFactsBinding(approvedBindings, targetId, historyId), {
  ok: false,
  reason: "account_facts_binding_unmatched",
});
assert.equal(resolveTrustedAccountFactsBinding(approvedBindings, targetId, currentId).ok, true);
assert.throws(() => projectStoredAccountFacts(oldStored, {
  now: Date.parse("2026-01-10T12:00:00Z"),
  expectedPlatform: "longbridge",
  expectedTargetId: targetId,
  expectedBindingId: currentId,
  expectedOptionScope: ACCOUNT_FACTS_OPTION_SCOPE,
}), /account_facts_binding_mismatch/);

const readModel = buildAccountFactsReadModel({
  accountOptions: { longbridge: [account] },
  bindings: bindingPayload([lineageBinding({ history_source_binding_ids: [historyId] })]),
  storedByAccount: new Map([[`longbridge:${account.key}`, oldStored]]),
  now: Date.parse("2026-01-10T12:00:00Z"),
});
assert.equal(readModel.accounts[0].binding_status, "bound");
assert.equal(readModel.accounts[0].data_status, "unavailable", "old sources never become the current snapshot");
assert.deepEqual(readModel.accounts[0].balances, []);
