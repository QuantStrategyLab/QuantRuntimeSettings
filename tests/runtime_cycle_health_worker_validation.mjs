import assert from "node:assert/strict";
import worker from "../web/strategy-switch-console/worker.js";
import { createRequire } from "node:module";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cycleHealthSha256, canonicalCycleJson, reduceCycleCheckpoint } from "../web/strategy-switch-console/runtime_cycle_health.js";

const absent = await worker.fetch(new Request("https://console.example/api/internal/runtime-cycle-health-source?source_id=synthetic.paper&target_id=longbridge.paper", {
  headers: { Authorization: "Bearer synthetic-cycle-token", "X-QSL-Source-Binding-ID": "1".repeat(64) },
}), { ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-cycle-token" });
assert.equal(absent.status, 503, "companion read must reject missing independent admission/storage");

const { offlineNetwork } = await import("./human_decisions_offline_harness.mjs?runtime-cycle-health");
const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");
const fixture = JSON.parse(await readFile(new URL("./fixtures/runtime_cycle_health.v1.synthetic.json", import.meta.url)));
const byName = Object.fromEntries(fixture.cases.map(c => [c.name, c.health]));
const account = { key: "synthetic-paper", label: "Synthetic PAPER", target_name: "synthetic-paper", runtime_status_target_id: "longbridge.paper", account_selector: "PAPER", deployment_selector: "synthetic-paper", service_name: "synthetic-paper-service", account_scope: "paper", supported_domains: ["us_equity"] };
const bound = { platform: "longbridge", account_key: account.key, account_scope: account.account_scope, target_name: account.target_name, service_name: account.service_name, deployment_selector: account.deployment_selector, account_selector: account.account_selector, target_id: "synthetic-facts-target", source_binding: { kind: "deployment_scope_token_version", id: fixture.context.source_binding_id } };
const fingerprint = await cycleHealthSha256({ binding: bound, runtime_status_target_id: account.runtime_status_target_id });
const token = "synthetic-cycle-token";
const adminToken = "synthetic-cycle-admin-token";
const baseEnv = { ACCOUNT_FACTS_SYNC_TOKEN: token, IBKR_ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-ibkr-token", SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN: "synthetic-schwab-token", EXECUTION_EVIDENCE_SYNC_TOKEN: "synthetic-lifecycle-token", STRATEGY_SWITCH_SYNC_TOKEN: adminToken, STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ longbridge: [account] }) };
const path = "/api/internal/runtime-cycle-health-source";
const provisionPath = "/api/internal/runtime-cycle-health-admission";
const query = "?source_id=synthetic.paper&target_id=longbridge.paper";
const persist = await mkdtemp(join(tmpdir(), "qrs-cycle-health-"));
const scriptPath = fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url));
const source = await readFile(scriptPath, "utf8");
// Only the test subclass can seed independent authority or inject SQLite faults.
const testClass = `
export class SyntheticCycleRuntimeInstances extends RuntimeInstances {
  async fetch(request) {
    const c = request.method === 'POST' ? await request.clone().json() : {};
    if (c.action === 'fixture_admit') {
      this.sql.exec('INSERT INTO runtime_cycle_health_source (source_id, target_id, binding_fingerprint, configuration_sha256, authority_revision, required_from) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET target_id=excluded.target_id, binding_fingerprint=excluded.binding_fingerprint, configuration_sha256=excluded.configuration_sha256, authority_revision=excluded.authority_revision, required_from=excluded.required_from', c.source_id, c.target_id, c.binding_fingerprint, c.configuration_sha256, c.authority_revision, c.required_from);
      return new Response('{}');
    }
    if (c.action === 'fixture_snapshot') return new Response(JSON.stringify({
      sources: [...this.sql.exec('SELECT * FROM runtime_cycle_health_source ORDER BY source_id')],
      checkpoints: [...this.sql.exec('SELECT * FROM runtime_cycle_health_checkpoint ORDER BY target_id, binding_fingerprint')],
      incidents: [...this.sql.exec('SELECT * FROM runtime_cycle_health_incident ORDER BY target_id, binding_fingerprint, cycle_id')],
      attempts: [...this.sql.exec('SELECT * FROM runtime_cycle_health_attempt ORDER BY history_id')],
      diagnoses: [...this.sql.exec('SELECT * FROM account_diagnosis_tasks')],
      facts: [...this.sql.exec('SELECT * FROM account_facts_observation')],
      instances: [...this.sql.exec('SELECT * FROM instance_history')],
    }));
    if (c.action === 'fixture_abort') {
      this.sql.exec("CREATE TRIGGER IF NOT EXISTS cycle_abort_insert BEFORE INSERT ON runtime_cycle_health_checkpoint WHEN NEW.revision = " + Number(c.revision) + " BEGIN SELECT RAISE(ABORT, 'synthetic rollback'); END");
      this.sql.exec("CREATE TRIGGER IF NOT EXISTS cycle_abort_update BEFORE UPDATE ON runtime_cycle_health_checkpoint WHEN NEW.revision = " + Number(c.revision) + " BEGIN SELECT RAISE(ABORT, 'synthetic rollback'); END");
      return new Response('{}');
    }
    if (c.action === 'fixture_clear_abort') {
      this.sql.exec('DROP TRIGGER IF EXISTS cycle_abort_insert'); this.sql.exec('DROP TRIGGER IF EXISTS cycle_abort_update');
      return new Response('{}');
    }
    if (c.action === 'fixture_legacy_checkpoint') {
      this.sql.exec('INSERT INTO runtime_cycle_health_checkpoint (target_id, binding_fingerprint, source_id, revision, payload_json) VALUES (?, ?, ?, ?, ?)', c.target_id, c.binding_fingerprint, c.source_id, c.revision, JSON.stringify(c.checkpoint));
      this.sql.exec('UPDATE runtime_cycle_health_source SET checkpoint_revision = ? WHERE source_id = ?', c.revision, c.source_id);
      return new Response('{}');
    }
    return super.fetch(request);
  }
}`;
let outbound = 0, legacyWrites = 0;
const options = {
  cf: false,
  modules: true, modulesRules: [{ type: "ESModule", include: ["**/*.js"] }], scriptPath, script: source + testClass,
  compatibilityDate: "2026-06-08", bindings: baseEnv,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "SyntheticCycleRuntimeInstances", useSQLite: true } },
  durableObjectsPersist: persist, kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: () => { outbound++; return new Response("offline only", { status: 503 }); },
};
let mf, namespace, stub;
const values = new Map([["account_facts_bindings", JSON.stringify({ schema_version: "qsl_account_facts_bindings.v1", bindings: [bound] })]]);
const kv = { async get(k) { return values.get(k) || null; }, async put() { legacyWrites++; throw new Error("unexpected legacy write"); }, async list() { throw new Error("unexpected legacy list"); } };
async function start() {
  mf = new Miniflare(options);
  namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  stub = namespace.get(namespace.idFromName("runtime-instances"));
}
const originalFetch = globalThis.fetch;
let directOutbound = 0;
async function call(body, { env = {}, authorization = token, binding = bound.source_binding.id, endpoint = path, search = query } = {}) {
  const response = await worker.fetch(new Request(`https://console.example${endpoint}${body === undefined ? search : ""}`, {
    method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${authorization}`, "X-QSL-Source-Binding-ID": binding, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { ...baseEnv, STRATEGY_SWITCH_CONFIG: kv, STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace, ...env });
  return { status: response.status, body: await response.json() };
}
async function provision(body, { env = {}, authorization = adminToken, binding = bound.source_binding.id } = {}) {
  const response = await worker.fetch(new Request(`https://console.example${provisionPath}`, {
    method: "POST", headers: { Authorization: `Bearer ${authorization}`, "X-QSL-Source-Binding-ID": binding, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), { ...baseEnv, STRATEGY_SWITCH_CONFIG: kv, STRATEGY_SWITCH_RUNTIME_INSTANCES: namespace, ...env });
  return { status: response.status, body: await response.json() };
}
async function command(c) { return (await stub.fetch("https://test-only/", { method: "POST", body: JSON.stringify(c) })).json(); }
const snapshot = () => command({ action: "fixture_snapshot" });
async function historyPages({ binding = bound.source_binding.id } = {}) {
  const pages = []; let cursor = null;
  do {
    const search = query + (cursor ? `&history_cursor=${encodeURIComponent(cursor)}` : "");
    const response = await call(undefined, { binding, search });
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.body.schema_version, "qsl_runtime_cycle_health_checkpoint.v2");
    assert.equal(response.body.checkpoint?.state?.history_complete, false, "summary never claims full history");
    pages.push(response.body.history_page);
    cursor = response.body.history_page.next_cursor;
  } while (cursor);
  return pages;
}
const admit = (overrides = {}) => command({ action: "fixture_admit", source_id: "synthetic.paper", target_id: "longbridge.paper", binding_fingerprint: fingerprint, configuration_sha256: fixture.context.configuration_sha256, authority_revision: 1, required_from: "2026-10-01T00:00:00Z", ...overrides });
const second = new Date(Date.now() - 30_000).toISOString().slice(0, 19);
let sequence = 1;
const nextInstant = () => `${second}.${String(sequence++).padStart(6, "0")}Z`;
function packet(name = "microsecond_no_action", instant = nextInstant()) {
  const health = structuredClone(byName[name]); health.coverage.through = instant;
  // Keep the immutable Python fixture unchanged; transport tests use a fresh
  // synthetic receive window so a future CI date cannot expire next_due_at.
  health.schedule.next_due_at = `${new Date(Date.parse(instant) + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19)}Z`;
  return { schema_version: "qsl_runtime_target_lifecycle_source_snapshot.v1", source_id: "synthetic.paper", generated_at: instant, computed_at: instant, data_status: "ready", errors: [], targets: [{ target_id: "longbridge.paper", target: { platform: "longbridge", configured_state: "enabled", execution_mode: "paper" }, monitoring: { runtime_guard: "pass", execution_heartbeat: "pass" }, disposition: { code: "continue_enabled_monitoring", reason_code: "none" }, no_order: true, cycle_health: health }] };
}
function historicalPacket(from, through, observedAt = nextInstant(), name = "weekly_not_due") {
  const value = packet(name, observedAt);
  value.targets[0].cycle_health.coverage.from = from;
  value.targets[0].cycle_health.coverage.through = through;
  return value;
}
function legacyMaximumCheckpoint(bindingId) {
  const template = byName.uncertain_fault.cycles[0];
  const incidents = Array.from({ length: 20 }, (_, incidentIndex) => {
    const cycleId = `cycle.${String(incidentIndex + 1).padStart(64, "0")}`;
    const fault_attempts = Array.from({ length: 20 }, (_, attemptIndex) => {
      const n = incidentIndex * 20 + attemptIndex;
      const scheduledFor = `2026-10-01T00:${String(attemptIndex).padStart(2, "0")}:00Z`;
      return {
        cycle: { ...structuredClone(template), cycle_id: cycleId, scheduled_for: scheduledFor,
          completed_at: scheduledFor, receipt_ref: `execution-receipt.${n.toString(16).padStart(32, "0")}` },
        configuration_sha256: fixture.context.configuration_sha256, resolution_ref: null,
      };
    });
    return { cycle: fault_attempts[0].cycle, fault_attempts, resolution_history: [] };
  });
  return { schema_version: "qsl.runtime_cycle_health_checkpoint.v1", target_id: fixture.context.target_id,
    source_binding_id: bindingId, incidents };
}
try {
  await start();
  globalThis.fetch = async () => { directOutbound++; throw new Error("direct Worker outbound forbidden"); };
  const initialAdmission = {
    source_id: "synthetic.paper", target_id: "longbridge.paper",
    configuration_sha256: fixture.context.configuration_sha256,
    required_from: "2026-10-01T00:00:00Z", expected_authority_revision: 0,
  };
  for (const options of [
    { authorization: token },
    { authorization: token, env: { STRATEGY_SWITCH_SYNC_TOKEN: token } },
    { authorization: baseEnv.EXECUTION_EVIDENCE_SYNC_TOKEN, env: { STRATEGY_SWITCH_SYNC_TOKEN: baseEnv.EXECUTION_EVIDENCE_SYNC_TOKEN } },
    { binding: "0".repeat(64) },
  ]) assert.ok((await provision(initialAdmission, options)).status >= 400, "source token, aliased admin token, and wrong binding cannot provision");
  assert.equal((await snapshot()).sources.length, 0, "failed provisioning attempts make no admission row");
  const admitted = await provision(initialAdmission);
  assert.equal(admitted.status, 200, JSON.stringify(admitted));
  assert.equal(admitted.body.status, "admission_configured", "provision response reports administration state, not runtime health");
  assert.equal(admitted.body.adopted, false);
  assert.equal("healthy" in admitted.body, false, "admission cannot claim health or establish baseline");
  const uninitialized = await call(undefined);
  assert.equal(uninitialized.body.status, "uninitialized", "provisioning alone does not establish a baseline or healthy state");
  assert.equal(uninitialized.body.checkpoint, null);
  assert.equal(uninitialized.body.configuration_sha256, fixture.context.configuration_sha256);
  assert.equal(uninitialized.body.source_binding_id, bound.source_binding.id);
  assert.equal(uninitialized.body.checkpoint_revision, 0);
  assert.equal(uninitialized.body.observed_at, null);
  assert.equal(uninitialized.body.observation_sha256, null);
  assert.equal(uninitialized.body.received_at, null);
  assert.equal(uninitialized.body.required_from, initialAdmission.required_from);
  const admissionReplay = await provision(initialAdmission);
  assert.equal(admissionReplay.body.result, "unchanged");
  assert.equal(admissionReplay.body.status, "admission_unchanged");
  assert.equal(admissionReplay.body.authority_revision, 1, "exact admission replay does not advance revision");
  await admit();
  const admittedFault = await call(packet("uncertain_fault"));
  assert.equal(admittedFault.status, 200, JSON.stringify(admittedFault));
  assert.equal(admittedFault.body.configuration_sha256, fixture.context.configuration_sha256);
  assert.equal(admittedFault.body.source_binding_id, bound.source_binding.id);
  const beforeProvisionChange = await snapshot();
  const candidateA = { ...initialAdmission, configuration_sha256: "4".repeat(64), required_from: "2026-09-30T00:00:00Z", expected_authority_revision: 1 };
  const candidateB = { ...candidateA, configuration_sha256: "5".repeat(64) };
  const concurrentProvision = await Promise.all([provision(candidateA), provision(candidateB)]);
  assert.deepEqual(concurrentProvision.map(r => r.status).sort(), [200, 409], "revision CAS allows only one concurrent provisioning update");
  const winnerRequest = concurrentProvision[0].status === 200 ? candidateA : candidateB;
  const winner = concurrentProvision.find(r => r.status === 200);
  assert.equal(winner.body.authority_revision, 2);
  const afterProvisionChange = await snapshot();
  assert.deepEqual(afterProvisionChange.checkpoints, beforeProvisionChange.checkpoints, "configuration update retains the exact old checkpoint");
  assert.equal(afterProvisionChange.sources[0].observed_at, beforeProvisionChange.sources[0].observed_at, "same binding update preserves observation watermark");
  assert.equal((await provision(winnerRequest)).body.result, "unchanged", "lost-response replay is idempotent at the current revision");
  const beforeRejectedProvision = await snapshot();
  assert.equal((await provision({ ...winnerRequest, expected_authority_revision: 1, configuration_sha256: "6".repeat(64) })).status, 409,
    "stale competing authority revision is rejected");
  assert.equal((await provision({ ...winnerRequest, expected_authority_revision: 2, required_from: "2026-10-02T00:00:00Z" })).body.error,
    "cycle_health_baseline_range_shrink_rejected", "a later baseline cannot clip prior covered history");
  assert.equal((await provision({ ...winnerRequest, source_id: "synthetic.replacement", expected_authority_revision: 2 })).status, 409,
    "source identity cannot be silently replaced");
  assert.deepEqual(await snapshot(), beforeRejectedProvision, "stale, shrinking and source-replacement requests make no writes");
  const nextBound = { ...bound, source_binding: { ...bound.source_binding, id: "6".repeat(64) } };
  const nextBindingFingerprint = await cycleHealthSha256({ binding: nextBound, runtime_status_target_id: account.runtime_status_target_id });
  values.set("account_facts_bindings", JSON.stringify({ schema_version: "qsl_account_facts_bindings.v1", bindings: [nextBound] }));
  const bindingChange = await provision({ ...winnerRequest, expected_authority_revision: 2 }, { binding: nextBound.source_binding.id });
  assert.equal(bindingChange.status, 200, JSON.stringify(bindingChange));
  assert.equal(bindingChange.body.authority_revision, 3);
  const changedBindingRead = await call(undefined, { binding: nextBound.source_binding.id });
  assert.equal(changedBindingRead.body.status, "blocked");
  assert.equal(changedBindingRead.body.continuity, "unconfirmed");
  assert.equal(changedBindingRead.body.prior_partitions.length, 1, "binding change exposes rather than drops old partition");
  const afterBindingChange = await snapshot();
  assert.equal(afterBindingChange.sources[0].binding_fingerprint, nextBindingFingerprint);
  assert.equal(afterBindingChange.sources[0].observed_at, null, "new binding starts a separate observation watermark");
  assert.deepEqual(afterBindingChange.checkpoints, beforeProvisionChange.checkpoints, "binding transition preserves old checkpoint bytes");
  values.set("account_facts_bindings", JSON.stringify({ schema_version: "qsl_account_facts_bindings.v1", bindings: [bound] }));
  assert.equal((await provision({ ...winnerRequest, expected_authority_revision: 3 }, { binding: bound.source_binding.id })).body.error,
    "cycle_health_binding_partition_reuse_requires_support", "A-to-B-to-A cannot overwrite or strand the retained A checkpoint");
  assert.deepEqual(await snapshot(), afterBindingChange, "rejected prior-binding reuse preserves the B admission and both checkpoint history and watermarks");
  values.set("account_facts_bindings", JSON.stringify({ schema_version: "qsl_account_facts_bindings.v1", bindings: [nextBound] }));
  values.set("account_facts_bindings", JSON.stringify({ schema_version: "qsl_account_facts_bindings.v1", bindings: [bound] }));
  await mf.dispose(); await rm(persist, { recursive: true, force: true }); options.durableObjectsPersist = persist; await start();
  const missing = packet();
  for (const p of [undefined, missing]) assert.equal((await call(p)).body.error, "cycle_health_source_not_admitted");
  assert.equal((await snapshot()).sources.length, 0, "a body cannot self-enroll");
  await admit();
  assert.equal((await call()).body.status, "uninitialized");
  await admit({ required_from: "" });
  for (const p of [undefined, packet()]) assert.equal((await call(p)).body.error, "cycle_health_baseline_not_admitted");
  await admit();
  const legacyState = reduceCycleCheckpoint({ target_id: fixture.context.target_id, source_binding_id: bound.source_binding.id }, byName.uncertain_fault);
  await command({ action: "fixture_legacy_checkpoint", target_id: "longbridge.paper", binding_fingerprint: fingerprint,
    source_id: "synthetic.paper", revision: 1,
    checkpoint: { configuration_sha256: fixture.context.configuration_sha256, required_from: "2026-10-01T00:00:00Z", baseline_established: true, state: legacyState } });
  const migratedLegacy = await call();
  assert.equal(migratedLegacy.body.schema_version, "qsl_runtime_cycle_health_checkpoint.v2");
  assert.equal(migratedLegacy.body.checkpoint.state.fault_attempt_count, 1, "legacy B1 attempts migrate before readback");
  assert.equal((await historyPages()).flatMap(p => p.items).length, 1, "legacy fault detail is available in the archive page");
  const pristine = await snapshot();
  for (const opts of [
    { authorization: "wrong" }, { authorization: baseEnv.EXECUTION_EVIDENCE_SYNC_TOKEN },
    { authorization: baseEnv.IBKR_ACCOUNT_FACTS_SYNC_TOKEN }, { binding: "" }, { binding: "0".repeat(64) },
    { env: { IBKR_ACCOUNT_FACTS_SYNC_TOKEN: token } }, { env: { SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN: token } },
    { env: { EXECUTION_EVIDENCE_SYNC_TOKEN: token } }, { env: { BINANCE_ACCOUNT_FACTS_SYNC_TOKEN: token } },
    { env: { STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ longbridge: [account, { ...account, key: "duplicate" }] }) } },
    { env: { STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ longbridge: [account], ibkr: [{ ...account, key: "cross-platform-duplicate" }] }) } },
    { env: { STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ longbridge: [{ ...account, service_name: "wrong-service" }] }) } },
    { search: "?source_id=synthetic.paper&target_id=synthetic-facts-target" },
    { search: query + "&source_id=synthetic.paper" },
  ]) { assert.ok((await call(undefined, opts)).status >= 400); if (!opts.search) assert.ok((await call(packet(), opts)).status >= 400); }
  for (const mutate of [
    p => { p.account_key = account.key; }, p => { p.targets.push(p.targets[0]); },
    p => { p.targets[0].target.execution_mode = "live"; }, p => { p.targets[0].target_id = bound.target_id; },
    p => { p.source_id = "unadmitted.source"; }, p => { p.targets[0].cycle_health.configuration_sha256 = "4".repeat(64); },
    p => { p.generated_at = nextInstant(); }, p => { p.targets[0].cycle_health.resolutions = [{ kind: "current_state_reconciled", evidence_ref: "a".repeat(64) }]; },
    p => { delete p.targets[0].cycle_health; }, p => { p.targets[0].cycle_health.coverage.through = nextInstant(); },
    p => { p.computed_at = p.generated_at = "2000-01-01T00:00:00Z"; p.targets[0].cycle_health.coverage.through = p.computed_at; },
    p => { p.computed_at = p.generated_at = "9999-01-01T00:00:00Z"; p.targets[0].cycle_health.coverage.through = p.computed_at; },
  ]) { const p = packet(); mutate(p); assert.ok((await call(p)).status >= 400); }
  assert.deepEqual(await snapshot(), pristine, "every admission rejection has zero durable writes");
  const trustedBindings = values.get("account_facts_bindings");
  values.delete("account_facts_bindings");
  for (const p of [undefined, packet()]) assert.equal((await call(p)).body.error, "cycle_health_binding_mismatch");
  values.set("account_facts_bindings", trustedBindings);
  assert.deepEqual(await snapshot(), pristine);
  const first = packet("uncertain_fault");
  const accepted = await call(first);
  assert.equal(accepted.status, 200, JSON.stringify(accepted));
  assert.equal(accepted.body.result, "stored");
  assert.equal(accepted.body.checkpoint.state.unresolved_count, 1);
  assert.equal(accepted.body.adopted, false);
  assert.equal(accepted.body.execution_authority_granted, false);
  const initial = await snapshot();
  const read = await call();
  for (const k of ["observation_sha256", "checkpoint_revision", "authority_revision", "configuration_sha256", "source_binding_id", "observed_at", "received_at", "checkpoint"]) assert.deepEqual(read.body[k], accepted.body[k], `GET and committed ACK ${k}`);
  assert.equal(accepted.body.observation_sha256, await cycleHealthSha256(first));
  const retry = await call(first);
  assert.equal(retry.body.result, "unchanged");
  assert.equal(retry.body.received_at, accepted.body.received_at);
  assert.deepEqual(await snapshot(), initial, "equal replay cannot renew freshness or touch rows");
  const conflict = structuredClone(first); conflict.targets[0].monitoring.runtime_guard = "attention"; conflict.targets[0].disposition = { code: "parked", reason_code: "runtime_guard_attention" };
  assert.equal((await call(conflict)).status, 409);
  assert.deepEqual(await snapshot(), initial);
  const older = packet("operational_fault", `${second}.000001Z`);
  assert.equal((await call(older)).body.error, "cycle_health_stale_observation");
  const newest = packet("operational_fault");
  const intermediate = packet("microsecond_no_action");
  // Send a strictly newer packet first: the queued older delivery must fail.
  const concurrent = await Promise.all([call(intermediate), call(newest)]);
  assert.deepEqual(concurrent.map(r => r.status), [200, 409]);
  assert.equal((await call()).body.observed_at, intermediate.computed_at);
  for (const name of ["weekly_not_due", "monthly_before_schedule", "closed_session", "incomplete", "capped", "microsecond_no_action"]) {
    const r = await call(packet(name)); assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.body.checkpoint.state.unresolved_count, 1);
  }
  // Even a newly observed operational fault from an older slot remains retained.
  assert.ok((await call(packet("operational_fault"))).body.checkpoint.state.fault_attempt_count >= 2);
  assert.ok((await historyPages()).flatMap(p => p.items).length >= 2, "fault attempts remain individually readable after summary compaction");
  const beforeAbort = await snapshot();
  await command({ action: "fixture_abort", revision: beforeAbort.sources[0].checkpoint_revision + 1 });
  const failed = await call(packet());
  assert.equal(failed.status, 409, "SQLite abort cannot issue success ACK");
  assert.equal(failed.body.ok, false);
  assert.deepEqual(await snapshot(), beforeAbort, "abort after watermark UPDATE rolls both rows back");
  const beforeRestart = (await call()).body;
  await mf.dispose(); await start();
  assert.deepEqual((await call()).body, beforeRestart, "SQLite rollback and original receipt survive restart");
  await command({ action: "fixture_clear_abort" });
  const addSyntheticFault = async i => {
    const observation = packet("operational_fault");
    const health = observation.targets[0].cycle_health;
    const cycle = health.cycles[0];
    const scheduledFor = new Date(Date.parse(second) - (i + 1) * 60_000).toISOString().replace(".000Z", "Z");
    cycle.scheduled_for = scheduledFor;
    cycle.completed_at = new Date(Date.parse(scheduledFor) + 1_000).toISOString().replace(".000Z", "Z");
    cycle.receipt_ref = `execution-receipt.${(0xabc000 + i).toString(16).padStart(32, "0")}`;
    cycle.cycle_id = `cycle.${await cycleHealthSha256([fixture.context.target_id, bound.source_binding.id, health.configuration_sha256, scheduledFor])}`;
    const instant = nextInstant();
    observation.computed_at = observation.generated_at = instant;
    health.coverage.through = instant;
    health.schedule.next_due_at = `${new Date(Date.parse(instant) + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19)}Z`;
    const result = await call(observation);
    assert.equal(result.status, 200, `synthetic fault ${i}: ${JSON.stringify(result.body)}`);
    return observation;
  };
  let finalFault;
  for (let i = 0; i < 52; i++) finalFault = await addSyntheticFault(i);
  const overflowSummary = (await call()).body.checkpoint.state;
  assert.ok(overflowSummary.fault_attempt_count >= 53, "more than twenty faults are accepted without raising the per-packet budget");
  assert.ok(overflowSummary.incident_count >= 52);
  assert.ok(overflowSummary.unresolved_count >= 52, "ordinary success or storage compaction does not clear unresolved faults");
  const firstPage = await call();
  assert.equal(firstPage.body.history_page.items.length, 50);
  assert.equal(firstPage.body.history_page.complete, false);
  const oldCursor = firstPage.body.history_page.next_cursor;
  const highwater = firstPage.body.history_page.snapshot_through_id;
  const conflictPacket = structuredClone(finalFault);
  conflictPacket.generated_at = conflictPacket.computed_at = nextInstant();
  conflictPacket.targets[0].cycle_health.coverage.through = conflictPacket.computed_at;
  conflictPacket.targets[0].cycle_health.cycles[0].outcome = "no_action";
  const beforeArchivedConflict = await snapshot();
  assert.equal((await call(conflictPacket)).body.error, "cycle_health_fault_receipt_conflict");
  assert.deepEqual(await snapshot(), beforeArchivedConflict, "attempt reinterpretation rolls back source watermark, archive, and summary");
  await addSyntheticFault(52);
  const secondPageAtOldSnapshot = await call(undefined, { search: query + `&history_cursor=${encodeURIComponent(oldCursor)}` });
  assert.equal(secondPageAtOldSnapshot.body.history_page.snapshot_through_id, highwater, "cursor retains the first page highwater");
  assert.equal(secondPageAtOldSnapshot.body.history_page.complete, true);
  assert.ok(secondPageAtOldSnapshot.body.history_page.items.every(item => item.history_id <= highwater), "later inserts do not shift an in-flight page walk");
  const allPages = await historyPages();
  const allArchivedAttempts = allPages.flatMap(p => p.items);
  assert.ok(allPages.length >= 2);
  assert.equal(allArchivedAttempts.length, (await snapshot()).attempts.length, "bounded pages expose every archived attempt exactly once");
  assert.equal(new Set(allArchivedAttempts.map(item => item.history_id)).size, allArchivedAttempts.length);
  assert.ok(allArchivedAttempts.every((item, i) => !i || allArchivedAttempts[i - 1].history_id < item.history_id));
  // Use a different fresh DO partition for transitions, capacity and route smoke.
  await mf.dispose(); options.durableObjectsPersist = false; await start(); await admit();
  const realKv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG");
  await realKv.put("account_facts_bindings", values.get("account_facts_bindings"));
  const smoke = packet("uncertain_fault");
  const smokeResponse = await mf.dispatchFetch(`https://console.example${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "X-QSL-Source-Binding-ID": bound.source_binding.id, "Content-Type": "application/json" }, body: JSON.stringify(smoke) });
  assert.equal(smokeResponse.status, 200, await smokeResponse.clone().text());
  const changedConfig = "4".repeat(64);
  await admit({ configuration_sha256: changedConfig, authority_revision: 2 });
  assert.equal((await call()).body.status, "blocked", "changed config cannot hide a retained fault");
  assert.equal((await call(packet())).body.error, "cycle_health_configuration_not_admitted");
  const cfgPacket = packet("operational_fault");
  cfgPacket.targets[0].cycle_health.configuration_sha256 = changedConfig;
  const cfgCycle = cfgPacket.targets[0].cycle_health.cycles[0];
  cfgCycle.receipt_ref = "execution-receipt." + "e".repeat(32);
  cfgCycle.cycle_id = `cycle.${await cycleHealthSha256([fixture.context.target_id, bound.source_binding.id, changedConfig, cfgCycle.scheduled_for])}`;
  const configured = await call(cfgPacket);
  assert.equal(configured.status, 200, JSON.stringify(configured));
  assert.equal(configured.body.checkpoint.state.incident_count, 2);
  assert.equal(configured.body.checkpoint.baseline_established, true, "a complete first observation establishes a new configuration baseline from required_from");
  assert.equal(configured.body.checkpoint.covered_through, cfgPacket.computed_at);
  const oldPartition = (await snapshot()).checkpoints[0];
  const newBound = { ...bound, source_binding: { ...bound.source_binding, id: "5".repeat(64) } };
  const newFp = await cycleHealthSha256({ binding: newBound, runtime_status_target_id: account.runtime_status_target_id });
  values.set("account_facts_bindings", JSON.stringify({ schema_version: "qsl_account_facts_bindings.v1", bindings: [newBound] }));
  assert.equal((await call(undefined, { binding: newBound.source_binding.id })).body.error, "cycle_health_source_not_admitted");
  await admit({ configuration_sha256: changedConfig, authority_revision: 3, binding_fingerprint: newFp });
  const changedRead = await call(undefined, { binding: newBound.source_binding.id });
  assert.equal(changedRead.body.status, "blocked");
  assert.equal(changedRead.body.continuity, "unconfirmed");
  assert.equal(changedRead.body.prior_partitions[0].checkpoint.state.unresolved_count, 2);
  const changedPacket = packet("weekly_not_due"); changedPacket.targets[0].cycle_health.configuration_sha256 = changedConfig;
  const changedResult = await call(changedPacket, { binding: newBound.source_binding.id });
  assert.equal(changedResult.status, 200, JSON.stringify(changedResult));
  assert.ok((await snapshot()).checkpoints.some(r => canonicalCycleJson(r) === canonicalCycleJson(oldPartition)), "binding change preserves exact old partition");
  assert.equal((await call(undefined, { binding: newBound.source_binding.id })).body.status, "blocked", "new empty partition never hides previous faults");
  await mf.dispose(); options.durableObjectsPersist = false; await start();
  values.set("account_facts_bindings", JSON.stringify({ schema_version: "qsl_account_facts_bindings.v1", bindings: [bound] }));
  await admit();
  const requiredFrom = `${second}.000002Z`;
  await admit({ required_from: requiredFrom });
  const beforeOrigin = await call(packet("weekly_not_due", `${second}.000001Z`));
  assert.equal(beforeOrigin.status, 200, JSON.stringify(beforeOrigin));
  assert.equal(beforeOrigin.body.checkpoint.baseline_established, false, "coverage ending before the admitted origin cannot establish baseline");
  assert.equal((await call()).body.status, "incomplete", "future origin cannot return complete");
  const originPacket = packet("weekly_not_due", requiredFrom);
  const atOrigin = await call(originPacket);
  assert.equal(atOrigin.status, 200, JSON.stringify(atOrigin));
  assert.equal(atOrigin.body.checkpoint.baseline_established, true, "complete coverage reaching the admitted origin establishes baseline");
  assert.equal((await call()).body.status, "complete");
  const firstCoveredThrough = atOrigin.body.covered_through;
  const partial = await call(packet("incomplete"));
  assert.equal(partial.status, 200, JSON.stringify(partial));
  assert.equal(partial.body.coverage_complete, false);
  assert.equal(partial.body.covered_through, firstCoveredThrough, "partial coverage cannot advance the acknowledged watermark");
  assert.equal(partial.body.coverage_incomplete_reason, "scan_incomplete");
  assert.equal((await call()).body.status, "incomplete", "a prior baseline does not make a partial latest cycle complete");
  const gapPacket = packet("weekly_not_due", `${new Date(Date.parse(firstCoveredThrough) + 120_000).toISOString().slice(0, 19)}Z`);
  gapPacket.targets[0].cycle_health.coverage.from = `${new Date(Date.parse(firstCoveredThrough) + 60_000).toISOString().slice(0, 19)}Z`;
  const gap = await call(gapPacket);
  assert.equal(gap.status, 200, JSON.stringify(gap));
  assert.equal(gap.body.coverage_complete, false);
  assert.equal(gap.body.covered_through, firstCoveredThrough, "coverage gap preserves the previous continuous watermark");
  assert.equal(gap.body.coverage_incomplete_reason, "coverage_gap");
  const resumedPacket = packet("weekly_not_due", `${new Date(Date.parse(firstCoveredThrough) + 180_000).toISOString().slice(0, 19)}Z`);
  resumedPacket.targets[0].cycle_health.coverage.from = firstCoveredThrough;
  const resumed = await call(resumedPacket);
  assert.equal(resumed.body.coverage_complete, true, "overlapping complete coverage resumes from the previous watermark");
  assert.equal(resumed.body.covered_through, resumedPacket.computed_at);
  await mf.dispose(); options.durableObjectsPersist = false; await start(); await admit();
  const missed = await call(packet("multiple_missed_slots"));
  assert.equal(missed.status, 200, JSON.stringify(missed));
  assert.equal(missed.body.checkpoint.state.unresolved_count, 2, "multiple missed slots commit as independent retained incidents");
  assert.equal((await call(packet("capped"))).body.checkpoint.state.unresolved_count, 2);
  await mf.dispose(); options.durableObjectsPersist = false; await start(); await admit();
  for (let i = 0; i < 20; i++) {
    const p = packet("operational_fault"); p.targets[0].cycle_health.cycles[0].receipt_ref = `execution-receipt.${i.toString(16).padStart(32, "0")}`;
    assert.equal((await call(p)).status, 200);
  }
  const twentyFirst = packet("operational_fault");
  twentyFirst.targets[0].cycle_health.cycles[0].receipt_ref = `execution-receipt.${(20).toString(16).padStart(32, "0")}`;
  const overflow = await call(twentyFirst);
  assert.equal(overflow.status, 200, "history archives beyond the former twenty-attempt cap");
  assert.equal(overflow.body.checkpoint.state.fault_attempt_count, 21);
  assert.equal((await snapshot()).attempts.length, 21, "all attempts remain stored in SQLite");
  // CAS admission recheck is authoritative inside the same transaction.
  const staleCommand = { action: "cycle_health_read", source_id: "synthetic.paper", target_id: "longbridge.paper", binding_fingerprint: fingerprint, configuration_sha256: fixture.context.configuration_sha256, required_from: "2026-10-01T00:00:00Z", authority_revision: 1 };
  await admit({ authority_revision: 2 });
  const casResponse = await stub.fetch("https://test-only/", { method: "POST", body: JSON.stringify(staleCommand) });
  assert.equal(casResponse.status, 409);
  assert.equal((await casResponse.json()).error, "cycle_health_admission_changed");
  const legacyExtension = await call(packet(), { endpoint: "/api/internal/sync-runtime-target-lifecycle-source", authorization: baseEnv.EXECUTION_EVIDENCE_SYNC_TOKEN });
  assert.equal(legacyExtension.status, 400, "legacy lifecycle still rejects companion extension");
  // Current observation time and historical coverage endpoint are independent:
  // a fresh, complete page can advance old coverage in bounded contiguous chunks.
  await mf.dispose(); options.durableObjectsPersist = false; await start(); await admit();
  const chunkOne = historicalPacket("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");
  const chunkOneAck = await call(chunkOne);
  assert.equal(chunkOneAck.status, 200, JSON.stringify(chunkOneAck));
  assert.equal(chunkOneAck.body.observed_at, chunkOne.computed_at, "freshness/order use this observation's current generation time");
  assert.equal(chunkOneAck.body.covered_through, "2026-10-02T00:00:00Z", "coverage progress uses the historical page endpoint");
  assert.notEqual(chunkOne.computed_at, chunkOne.targets[0].cycle_health.coverage.through);
  const chunkTwo = historicalPacket("2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z");
  const chunkTwoAck = await call(chunkTwo);
  assert.equal(chunkTwoAck.status, 200, JSON.stringify(chunkTwoAck));
  assert.equal(chunkTwoAck.body.covered_through, "2026-10-03T00:00:00Z", "contiguous historical chunk advances from the prior watermark");
  const incompleteChunk = historicalPacket("2026-10-03T00:00:00Z", "2026-10-04T00:00:00Z", nextInstant(), "incomplete");
  const incompleteChunkAck = await call(incompleteChunk);
  assert.equal(incompleteChunkAck.status, 200, JSON.stringify(incompleteChunkAck));
  assert.equal(incompleteChunkAck.body.covered_through, "2026-10-03T00:00:00Z");
  assert.equal(incompleteChunkAck.body.coverage_incomplete_reason, "scan_incomplete");
  const gapChunk = historicalPacket("2026-10-05T00:00:00Z", "2026-10-06T00:00:00Z");
  const gapChunkAck = await call(gapChunk);
  assert.equal(gapChunkAck.status, 200, JSON.stringify(gapChunkAck));
  assert.equal(gapChunkAck.body.covered_through, "2026-10-03T00:00:00Z");
  assert.equal(gapChunkAck.body.coverage_incomplete_reason, "coverage_gap");
  const futureCoverage = historicalPacket("2026-10-06T00:00:00Z", "2026-10-06T00:00:00Z");
  futureCoverage.targets[0].cycle_health.coverage.through = `${futureCoverage.computed_at.slice(0, 19)}Z`;
  futureCoverage.targets[0].cycle_health.coverage.from = "2026-10-06T00:00:00Z";
  futureCoverage.computed_at = futureCoverage.generated_at = "9999-01-01T00:00:00Z";
  assert.equal((await call(futureCoverage)).body.error, "cycle_health_observation_age", "future observation timestamps remain rejected before coverage evaluation");
  const freshFutureCoverage = historicalPacket("2026-10-06T00:00:00Z", "2026-10-06T00:00:00Z");
  freshFutureCoverage.targets[0].cycle_health.coverage.through = `${new Date(Date.parse(freshFutureCoverage.computed_at) + 60_000).toISOString().slice(0, 19)}Z`;
  assert.equal((await call(freshFutureCoverage)).body.error, "cycle_health_future_coverage", "a fresh packet cannot claim coverage beyond its observation time");
  const completedAfterCutoff = historicalPacket("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", nextInstant(), "uncertain_fault");
  const historicalCycle = completedAfterCutoff.targets[0].cycle_health.cycles[0];
  historicalCycle.scheduled_for = "2026-10-01T01:00:00Z";
  historicalCycle.completed_at = "2026-10-03T01:00:00Z";
  historicalCycle.cycle_id = `cycle.${await cycleHealthSha256([fixture.context.target_id, bound.source_binding.id,
    completedAfterCutoff.targets[0].cycle_health.configuration_sha256, historicalCycle.scheduled_for])}`;
  assert.equal((await call(completedAfterCutoff)).body.error, "cycle_health_completion_chronology", "a cycle completion after the historical page endpoint is rejected");
  const final = await snapshot();
  assert.equal(final.diagnoses.length, 0); assert.equal(final.facts.length, 0); assert.equal(final.instances.length, 0);
  // The prior B1 checkpoint's full 20 x 20 envelope migrates transactionally
  // into SQLite history without truncation.
  await mf.dispose(); options.durableObjectsPersist = false; await start(); await admit();
  await command({ action: "fixture_legacy_checkpoint", target_id: "longbridge.paper", binding_fingerprint: fingerprint,
    source_id: "synthetic.paper", revision: 1,
    checkpoint: { configuration_sha256: fixture.context.configuration_sha256, required_from: "2026-10-01T00:00:00Z",
      baseline_established: true, state: legacyMaximumCheckpoint(bound.source_binding.id) } });
  const migratedMaximum = await call();
  assert.equal(migratedMaximum.status, 200, JSON.stringify(migratedMaximum));
  assert.equal(migratedMaximum.body.checkpoint.state.incident_count, 20);
  assert.equal(migratedMaximum.body.checkpoint.state.fault_attempt_count, 400, "legacy migration retains all 400 allowed attempts");
  const migratedRows = (await historyPages()).flatMap(p => p.items);
  assert.equal(migratedRows.length, 400);
  assert.equal(new Set(migratedRows.map(row => row.attempt_key)).size, 400);

  // A malformed sibling row must roll back an earlier valid row's migration.
  await mf.dispose(); options.durableObjectsPersist = false; await start(); await admit();
  const migrationStateBefore = await snapshot();
  await command({ action: "fixture_legacy_checkpoint", target_id: "longbridge.paper", binding_fingerprint: "0".repeat(64),
    source_id: "synthetic.paper", revision: 1,
    checkpoint: { configuration_sha256: fixture.context.configuration_sha256, required_from: "2026-10-01T00:00:00Z",
      baseline_established: true, state: legacyMaximumCheckpoint(bound.source_binding.id) } });
  await command({ action: "fixture_legacy_checkpoint", target_id: "longbridge.paper", binding_fingerprint: "f".repeat(64),
    source_id: "synthetic.paper", revision: 1,
    checkpoint: { configuration_sha256: fixture.context.configuration_sha256, required_from: "2026-10-01T00:00:00Z",
      baseline_established: true, state: { schema_version: "qsl.runtime_cycle_health_checkpoint.v1", incidents: [{ fault_attempts: [null] }] } } });
  const migrationBeforeRead = await snapshot();
  assert.notDeepEqual(migrationBeforeRead, migrationStateBefore);
  const rejectedMigration = await call();
  assert.equal(rejectedMigration.status, 409);
  assert.equal(rejectedMigration.body.error, "cycle_health_checkpoint_invalid");
  assert.deepEqual(await snapshot(), migrationBeforeRead, "a bad legacy sibling rolls back every earlier row copied during GET");
  assert.equal(legacyWrites, 0); assert.equal(outbound, 0); assert.equal(directOutbound, 0);
  assert.equal(offlineNetwork.counters.host_external_attempts, 0);
  console.log("runtime cycle-health Worker validation: PASS", { ...offlineNetwork.counters, worker_outbound_attempts: outbound, direct_outbound_attempts: directOutbound, legacy_writes: legacyWrites });
} finally {
  globalThis.fetch = originalFetch;
  try { if (mf) await mf.dispose(); }
  finally { await rm(persist, { recursive: true, force: true }); await offlineNetwork.close(); }
}
