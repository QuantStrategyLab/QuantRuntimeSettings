import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import Ajv from "../web/strategy-switch-console/node_modules/ajv/dist/ajv.js";
import addFormats from "../web/strategy-switch-console/node_modules/ajv-formats/dist/index.js";
import { buildAccountFactsReadModel } from "../web/strategy-switch-console/account_facts.js";
let readout;
try {
  const module = await import("../web/strategy-switch-console/forward_reconciliation.js");
  readout = module.projectForwardReconciliation;
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}
const now = Date.parse("2026-11-05T16:00:00Z");
const snapshot = (at = "2026-11-05T10:00:00-05:00") => ({
  source_as_of: at, timezone: "America/New_York",
  capture_started_at: "2026-11-05T15:00:01Z", capture_finished_at: "2026-11-05T15:00:07Z",
});
const evidence = () => ({ source: snapshot(), baseline: null, later_anchor: snapshot(), notification: null });
const read = (value, clock = now) => { assert.equal(typeof readout, "function", "forward contract missing"); return readout(value, { now: clock }); };

test("redaction: reject private fields and return only fixed errors", () => {
  for (const value of [{ ...evidence(), account_id: "fake-private-sentinel" },
    { ...evidence(), source: { ...snapshot(), alias: "fake-private-sentinel" } },
    { ...evidence(), notification: { status: "pending", requested_at: "2026-11-05T15:01:00Z", confirmed_at: null, receipt: "fake-private-sentinel" } }]) {
    assert.throws(() => read(value), error => error.message === "invalid_forward_reconciliation_evidence");
  }
});
test("fail closed: reject impossible, future, historical and contradictory evidence", () => {
  for (const at of ["2026-02-30T12:00:00-05:00", "2026-11-05T24:00:00-05:00", "2026-11-05T10:00:60-05:00", "2026-11-06T10:00:00-05:00", "2026-11-02T10:00:00-05:00", "2026-11-05T10:00:00+05:99", "2026-11-05T10:00:00Z"]) {
    assert.throws(() => read({ ...evidence(), source: snapshot(at) }), /invalid_forward_reconciliation_evidence/);
  }
  for (const patch of [{ capture_started_at: "2026-11-05T15:00:08Z" }, { capture_finished_at: "2026-11-06T15:00:07Z" }, { timezone: "fake-private-sentinel" }]) {
    assert.throws(() => read({ ...evidence(), source: { ...snapshot(), ...patch } }), /invalid_forward_reconciliation_evidence/);
  }
  assert.throws(() => read({ ...evidence(), baseline: snapshot() }), /invalid_forward_reconciliation_evidence/);
  assert.throws(() => read({ ...evidence(), dimensions: { cash: "MATCHED" } }), /invalid_forward_reconciliation_evidence/);
  assert.throws(() => read(null, NaN), /invalid_forward_reconciliation_evidence/);
});
test("stale snapshots: new generation never refreshes native source time", () => {
  const input = evidence(), before = structuredClone(input);
  const result = read(input);
  assert.equal(result.source_status, "stale");
  assert.deepEqual(result.source, input.source);
  assert.equal(result.generated_at, "2026-11-05T16:00:00.000Z");
  assert.equal(read(input, now + 60000).source_status, "stale");
  assert.deepEqual(input, before);
  result.source.source_as_of = "fake-mutation";
  assert.deepEqual(input, before);
});
test("missing baseline stays missing beside a separately timestamped later anchor", () => {
  const result = read(evidence());
  assert.equal(result.baseline_status, "missing");
  assert.equal(result.baseline_reason, "opening_snapshot_missing");
  assert.equal(result.baseline, null);
  assert.deepEqual(result.later_anchor, snapshot());
  assert.deepEqual(result.dimensions, { positions: "UNRECONCILED", cash: "UNRECONCILED", events: "UNRECONCILED" });
  const baseline = { ...snapshot("2026-11-03T09:00:00-05:00"), capture_started_at: "2026-11-03T14:00:01Z", capture_finished_at: "2026-11-03T14:00:07Z" };
  assert.equal(read({ ...evidence(), baseline }).baseline_status, "present");
  assert.throws(() => read({ ...evidence(), baseline, later_anchor: baseline }), /invalid_forward_reconciliation_evidence/);
});
test("pending notification never becomes delivered without a later receipt", () => {
  const notification = { status: "pending", requested_at: "2026-11-05T15:01:00Z", confirmed_at: null };
  assert.deepEqual(read({ ...evidence(), notification }).notification, notification);
  assert.throws(() => read({ ...evidence(), notification: { ...notification, status: "confirmed" } }), /invalid_forward_reconciliation_evidence/);
  const confirmed = { ...notification, status: "confirmed", confirmed_at: "2026-11-05T15:02:00Z" };
  const result = read({ ...evidence(), notification: confirmed });
  assert.deepEqual(result.notification, confirmed);
  assert.equal(result.dimensions.cash, "UNRECONCILED");
  assert.throws(() => read({ ...evidence(), notification: { ...confirmed, confirmed_at: "2026-11-05T15:00:00Z" } }), /invalid_forward_reconciliation_evidence/);
});
test("existing account read projects unknown rather than trusting unbound stored extensions", () => {
  const model = buildAccountFactsReadModel({ accountOptions: { binance: [{ key: "synthetic-wallet" }] },
    storedByAccount: new Map([["binance:synthetic-wallet", { forward_reconciliation: evidence() }]]), now });
  const result = model.accounts[0].forward_reconciliation;
  assert.ok(result, "existing read projection lacks forward contract");
  assert.equal(result.source_status, "unknown");
  assert.equal(result.source, null);
  assert.equal(result.later_anchor, null);
  assert.equal(result.notification.status, "unknown");
  assert.equal(result.informational_only, true);
  assert.equal(result.dimensions.cash, "UNRECONCILED");
});

test("published schema accepts projection states and rejects financial promotions", () => {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(new URL("../schemas/qsl-forward-reconciliation-read.v1.schema.json", import.meta.url))));
  for (const value of [null, evidence(), { ...evidence(), source: { ...snapshot("2026-11-05T10:59:00-05:00"), capture_started_at: "2026-11-05T15:59:01Z", capture_finished_at: "2026-11-05T15:59:07Z" }, later_anchor: null }]) {
    const result = read(value);
    assert.ok(validate(result), JSON.stringify(validate.errors));
  }
  const result = read(null);
  assert.equal(validate({ ...result, dimensions: { ...result.dimensions, cash: "MATCHED" } }), false);
  assert.equal(validate({ ...result, account_id: "fake-private-sentinel" }), false);
});

test("missing evidence has no generated financial timestamp across repeated reads", () => {
  assert.equal(read(null).generated_at, null);
  assert.deepEqual(read(null), read(null, now + 1000));
});

test("November 3 Hong Kong notice is valid before the UTC date boundary", () => {
  const early = { source_as_of: "2026-11-03T00:30:00+08:00", timezone: "Asia/Hong_Kong",
    capture_started_at: "2026-11-02T16:30:01Z", capture_finished_at: "2026-11-02T16:30:07Z" };
  const notification = { status: "pending", requested_at: "2026-11-02T16:31:00Z", confirmed_at: null };
  assert.deepEqual(read({ source: early, baseline: early, later_anchor: null, notification }).notification, notification);
});
