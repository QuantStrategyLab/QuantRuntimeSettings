import assert from "node:assert/strict";
import worker from "../web/strategy-switch-console/worker.js";
import { createRequire } from "node:module";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cycleHealthSha256, canonicalCycleJson } from "../web/strategy-switch-console/runtime_cycle_health.js";

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
      diagnoses: [...this.sql.exec('SELECT * FROM account_diagnosis_tasks')],
      facts: [...this.sql.exec('SELECT * FROM account_facts_observation')],
      instances: [...this.sql.exec('SELECT * FROM instance_history')],
    }));
    if (c.action === 'fixture_abort') {
      this.sql.exec("CREATE TRIGGER IF NOT EXISTS cycle_abort_insert BEFORE INSERT ON runtime_cycle_health_checkpoint WHEN NEW.revision = " + Number(c.revision) + " BEGIN SELECT RAISE(ABORT, 'synthetic rollback'); END");
      this.sql.exec("CREATE TRIGGER IF NOT EXISTS cycle_abort_update BEFORE UPDATE ON runtime_cycle_health_checkpoint WHEN NEW.revision = " + Number(c.revision) + " BEGIN SELECT RAISE(ABORT, 'synthetic rollback'); END");
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
  assert.equal((await call(undefined)).body.status, "uninitialized", "provisioning alone does not establish a baseline or healthy state");
  const admissionReplay = await provision(initialAdmission);
  assert.equal(admissionReplay.body.result, "unchanged");
  assert.equal(admissionReplay.body.status, "admission_unchanged");
  assert.equal(admissionReplay.body.authority_revision, 1, "exact admission replay does not advance revision");
  await admit();
  const admittedFault = await call(packet("uncertain_fault"));
  assert.equal(admittedFault.status, 200, JSON.stringify(admittedFault));
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
  for (const k of ["observation_sha256", "checkpoint_revision", "authority_revision", "observed_at", "received_at", "checkpoint"]) assert.deepEqual(read.body[k], accepted.body[k], `GET and committed ACK ${k}`);
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
  assert.equal((await call(packet("operational_fault"))).body.checkpoint.state.incidents[0].fault_attempts.length, 2);
  const beforeAbort = await snapshot();
  await command({ action: "fixture_abort", revision: beforeAbort.sources[0].checkpoint_revision + 1 });
  const failed = await call(packet());
  assert.equal(failed.status, 409, "SQLite abort cannot issue success ACK");
  assert.equal(failed.body.ok, false);
  assert.deepEqual(await snapshot(), beforeAbort, "abort after watermark UPDATE rolls both rows back");
  const beforeRestart = (await call()).body;
  await mf.dispose(); await start();
  assert.deepEqual((await call()).body, beforeRestart, "SQLite rollback and original receipt survive restart");
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
  assert.equal(configured.body.checkpoint.state.incidents.length, 2);
  assert.equal(configured.body.checkpoint.baseline_established, false, "first config transition has no established coverage baseline");
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
  const requiredFrom = `${second}.900000Z`;
  await admit({ required_from: requiredFrom });
  const beforeOrigin = await call(packet("weekly_not_due"));
  assert.equal(beforeOrigin.status, 200, JSON.stringify(beforeOrigin));
  assert.equal(beforeOrigin.body.checkpoint.baseline_established, false, "coverage ending before the admitted origin cannot establish baseline");
  assert.equal((await call()).body.status, "incomplete", "future origin cannot return complete");
  const atOrigin = await call(packet("weekly_not_due", requiredFrom));
  assert.equal(atOrigin.status, 200, JSON.stringify(atOrigin));
  assert.equal(atOrigin.body.checkpoint.baseline_established, true, "complete coverage reaching the admitted origin establishes baseline");
  assert.equal((await call()).body.status, "complete");
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
  const full = await snapshot();
  const overflow = await call(packet("operational_fault"));
  assert.equal(overflow.body.error, "cycle_health_history_capacity_requires_support");
  assert.deepEqual(await snapshot(), full, "21st attempt rejects atomically without eviction");
  // CAS admission recheck is authoritative inside the same transaction.
  const staleCommand = { action: "cycle_health_read", source_id: "synthetic.paper", target_id: "longbridge.paper", binding_fingerprint: fingerprint, configuration_sha256: fixture.context.configuration_sha256, required_from: "2026-10-01T00:00:00Z", authority_revision: 1 };
  await admit({ authority_revision: 2 });
  const casResponse = await stub.fetch("https://test-only/", { method: "POST", body: JSON.stringify(staleCommand) });
  assert.equal(casResponse.status, 409);
  assert.equal((await casResponse.json()).error, "cycle_health_admission_changed");
  const legacyExtension = await call(packet(), { endpoint: "/api/internal/sync-runtime-target-lifecycle-source", authorization: baseEnv.EXECUTION_EVIDENCE_SYNC_TOKEN });
  assert.equal(legacyExtension.status, 400, "legacy lifecycle still rejects companion extension");
  const final = await snapshot();
  assert.equal(final.diagnoses.length, 0); assert.equal(final.facts.length, 0); assert.equal(final.instances.length, 0);
  assert.equal(legacyWrites, 0); assert.equal(outbound, 0); assert.equal(directOutbound, 0);
  assert.equal(offlineNetwork.counters.host_external_attempts, 0);
  console.log("runtime cycle-health Worker validation: PASS", { ...offlineNetwork.counters, worker_outbound_attempts: outbound, direct_outbound_attempts: directOutbound, legacy_writes: legacyWrites });
} finally {
  globalThis.fetch = originalFetch;
  try { if (mf) await mf.dispose(); }
  finally { await rm(persist, { recursive: true, force: true }); await offlineNetwork.close(); }
}
