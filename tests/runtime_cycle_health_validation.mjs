import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalCycleJson, cycleHealthSha256, normalizeCycleHealth, normalizeCycleInstant, compareCycleInstants, cycleCoverageComplete, reduceCycleCheckpoint } from "../web/strategy-switch-console/runtime_cycle_health.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/runtime_cycle_health.v1.synthetic.json", import.meta.url)));
const context = fixture.context;
const byName = Object.fromEntries(fixture.cases.map(c => [c.name, c]));
const normalize = (health, observed_at = byName.microsecond_no_action.observed_at) => normalizeCycleHealth(health, { ...context, observed_at });
assert.equal(fixture.provenance.synthetic, true);
assert.equal(fixture.provenance.regenerated, true);
for (const p of fixture.parity) assert.equal(`cycle.${await cycleHealthSha256([context.target_id, context.source_binding_id, context.configuration_sha256, p.instant])}`, p.cycle_id, "actual Python cycle_id microsecond parity");
for (const c of fixture.cases) {
  const h = await normalize(c.health, c.observed_at);
  assert.equal(canonicalCycleJson(h), canonicalCycleJson(c.health));
  const state = reduceCycleCheckpoint(context, h);
  const reference = structuredClone(state);
  for (const i of reference.incidents) for (const a of i.fault_attempts) delete a.configuration_sha256;
  assert.deepEqual(reference, c.expected_state, `actual Python reducer parity: ${c.name}`);
}
assert.equal(compareCycleInstants("2026-10-05T15:00:00.000001Z", "2026-10-05T15:00:00Z"), 1);
assert.equal(compareCycleInstants("2026-10-05T15:00:00.000001Z", "2026-10-05T15:00:00.000002Z"), -1);
for (const s of ["2026-02-30T00:00:00Z", "2026-10-05T15:00:00.000Z", "2026-10-05T15:00:00.000000Z", "2026-10-05T15:00:00+00:00", "2026-10-05T24:00:00Z", "0000-01-01T00:00:00Z", null]) assert.throws(() => normalizeCycleInstant(s));
const base = byName.microsecond_no_action.health;
for (const mutate of [
  h => { h.extra = true; }, h => { h.schema_version = "other"; }, h => { delete h.schedule; },
  h => { h.configuration_sha256 = "x".repeat(64); },
  h => { h.configuration_sha256 = [h.configuration_sha256]; h.cycles = []; },
  h => { h.schedule.state = [h.schedule.state]; },
  h => { h.schedule.timezone = null; }, h => { h.schedule.timezone = "Not/A-Timezone"; },
  h => { h.schedule.reason = "publication_grace_ended"; },
  h => { h.schedule.latest_due_at = "2026-10-09T00:00:00Z"; },
  h => { h.schedule.next_due_at = "2026-10-01T00:00:00Z"; },
  h => { h.schedule.deadline_at = "2026-10-01T00:00:00Z"; },
  h => { h.coverage.through = "2026-10-05T15:00:30Z"; },
  h => { h.coverage.read_count = 2; }, h => { h.coverage.listed_count = 1.1; },
  h => { h.coverage.limit_hit = "false"; }, h => { h.cycles[0].cycle_id = "cycle." + "0".repeat(64); },
  h => { h.cycles[0].outcome = "unknown"; }, h => { h.cycles[0].execution_state = "terminal_confirmed"; },
  h => { h.cycles[0].receipt_ref = null; }, h => { h.cycles[0].completed_at = "2026-10-08T00:00:00Z"; },
  h => { h.cycles[0].completed_at = "2026-10-05T14:00:00Z"; },
  h => { h.cycles[0].correlation = "verified"; }, h => { h.cycles = Array(21).fill(h.cycles[0]); },
  h => { h.resolutions = [{ evidence_ref: "a".repeat(64), kind: "current_state_reconciled" }]; },
  h => { h.cycles.push({ ...h.cycles[0], outcome: "no_signal" }); },
]) { const h = structuredClone(base); mutate(h); await assert.rejects(normalize(h)); }
const badMissing = structuredClone(byName.due_missing_report.health);
badMissing.coverage.limit_hit = true;
await assert.rejects(normalize(badMissing), /invalid_missing_report/);
for (const reason of ["missing_timezone", "invalid_timezone"]) {
  const h = structuredClone(base); h.schedule = { ...h.schedule, state: "unevaluable", reason, timezone: null };
  await normalize(h);
}
assert.equal(cycleCoverageComplete(byName.capped.health.coverage), false);
assert.equal(cycleCoverageComplete(byName.incomplete.health.coverage), false);
assert.equal(cycleCoverageComplete({ ...base.coverage, listed_count: 41, read_count: 20, limit_hit: true }), false, "actual LB final page cap bound is accepted as incomplete");
let state = reduceCycleCheckpoint(context, byName.uncertain_fault.health);
for (const name of ["microsecond_no_action", "weekly_not_due", "monthly_before_schedule", "closed_session", "incomplete", "capped"]) {
  state = reduceCycleCheckpoint(context, byName[name].health, state);
  assert.equal(state.unresolved_count, 1, `${name} cannot clear a fault`);
}
state = reduceCycleCheckpoint(context, byName.operational_fault.health, state);
assert.equal(state.incidents[0].category, "execution_uncertainty", "highest severity survives a later operational attempt");
assert.equal(state.incidents[0].fault_attempts.length, 2);
const fault = byName.operational_fault.health.cycles[0];
const resolved = structuredClone(reduceCycleCheckpoint(context, byName.operational_fault.health));
resolved.incidents[0].fault_attempts[0].resolution_ref = "a".repeat(64);
resolved.incidents[0].resolution_history.push({ evidence_ref: "a".repeat(64), verified_through: fixture.cases[0].observed_at });
const replay = reduceCycleCheckpoint(context, byName.operational_fault.health, resolved);
assert.equal(replay.unresolved_count, 0, "known exact replay does not resurrect a resolved attempt");
const late = { ...fault, receipt_ref: "execution-receipt." + "f".repeat(32), completed_at: "2026-10-05T15:00:01Z", execution_state: "unresolved" };
const lateState = reduceCycleCheckpoint(context, { ...base, cycles: [late] }, replay);
assert.equal(lateState.unresolved_count, 1, "late newly discovered evidence is never covered by an old resolution");
assert.equal(lateState.incidents[0].latest_fault_at, fault.completed_at, "latest fault watermark and severity are independent");
const cfg = { ...base, configuration_sha256: "4".repeat(64), cycles: [{ ...fault, receipt_ref: "execution-receipt." + "e".repeat(32), cycle_id: `cycle.${await cycleHealthSha256([context.target_id, context.source_binding_id, "4".repeat(64), fault.scheduled_for])}` }] };
const transition = reduceCycleCheckpoint(context, cfg, state);
assert.equal(transition.incidents.length, 2, "configuration transitions retain old faults");
assert.throws(() => reduceCycleCheckpoint({ ...context, source_binding_id: "5".repeat(64) }, base, transition), /binding_changed/);
assert.throws(() => reduceCycleCheckpoint(context, { ...base, cycles: [{ ...fault, outcome: "no_action" }] }, state), /receipt_conflict/);
let full = null;
for (let i = 0; i < 25; i++) full = reduceCycleCheckpoint(context, { ...base, cycles: [{ ...fault, receipt_ref: `execution-receipt.${i.toString(16).padStart(32, "0")}` }] }, full);
full = reduceCycleCheckpoint(context, { ...base, cycles: [late] }, full);
assert.equal(full.incidents[0].fault_attempts.length, 26, "the pure reducer retains more than twenty attempts without eviction");
let manyIncidents = null;
for (let i = 0; i < 21; i++) manyIncidents = reduceCycleCheckpoint(context, { ...base, cycles: [{ ...fault, cycle_id: `cycle.${i.toString(16).padStart(64, "0")}`, receipt_ref: `execution-receipt.${i.toString(16).padStart(32, "0")}` }] }, manyIncidents);
assert.equal(manyIncidents.incidents.length, 21, "the pure reducer retains more than twenty incidents without eviction");
console.log("runtime cycle-health pure validation: PASS (Python vectors, strict wire/time, retained fault attempts)");
