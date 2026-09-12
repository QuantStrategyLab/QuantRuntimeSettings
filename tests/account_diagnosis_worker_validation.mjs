import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import worker, { __test } from "../web/strategy-switch-console/worker.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");

const targetId = "binance.crypto_live_pool_rotation";
const now = new Date().toISOString();
const account = {
  key: "default",
  label: "Binance",
  target_name: "crypto_live_pool_rotation",
  runtime_status_target_id: targetId,
  supported_domains: ["crypto"],
  service_name: "binance-platform",
  default_execution_mode: "live",
};
const bindings = {
  SESSION_SECRET: "synthetic-only-session-key",
  STRATEGY_SWITCH_ADMIN_LOGINS: "fixture-admin",
  ALLOWED_GITHUB_LOGINS: "fixture-reader",
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ binance: [account] }),
  EXECUTION_EVIDENCE_SYNC_TOKEN: "synthetic-lifecycle-token",
  ACCOUNT_DIAGNOSIS_SYNC_TOKEN: "synthetic-diagnosis-token",
  ACCOUNT_DIAGNOSIS_AUTO_ENABLED: "false",
  RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-dispatch-token",
};
const adminCookie = `qsl_switch_session=${await __test.makeSession("fixture-admin", [], bindings)}`;
const persist = await mkdtemp(join(tmpdir(), "qrt-account-diagnosis-"));
const dispatches = [];
let failDispatch = false;
const options = {
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08",
  bindings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  durableObjectsPersist: persist,
  kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: async request => {
    dispatches.push({ url: request.url, body: await request.text() });
    return new Response(null, { status: failDispatch ? 503 : 204 });
  },
};
let mf = new Miniflare(options);
let autoMf;
let autoPersist;

async function call(endpoint, { method = "GET", body, cookie = adminCookie, origin = "https://console.example", headers = {} } = {}) {
  const response = await mf.dispatchFetch(`https://console.example${endpoint}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* no body */ }
  return { status: response.status, body: payload };
}

function lifecycleSource({ runtimeGuard = "pass", heartbeat = "pass", runtimeEnabled = true, scheduler = "enabled", configuredState = "enabled", sourceId = "binance-account-diagnosis-fixture", platform = "binance", sourceTargetId = targetId, generatedAt = new Date().toISOString(), computedAt = generatedAt } = {}) {
  return {
    schema_version: "qsl_runtime_target_lifecycle_source_snapshot.v1",
    source_id: sourceId,
    generated_at: generatedAt,
    computed_at: computedAt,
    data_status: "ready",
    targets: [{
      target_id: sourceTargetId,
      target: { platform, configured_state: configuredState, execution_mode: platform === "binance" ? "live" : "dry_run" },
      monitoring: { runtime_guard: runtimeGuard, execution_heartbeat: heartbeat },
      disposition: {
        code: runtimeGuard === "attention" || heartbeat === "attention" || runtimeGuard === "unavailable" || heartbeat === "unavailable"
          ? "parked" : configuredState === "disabled" ? "continue_disabled_validation" : "continue_enabled_monitoring",
        reason_code: runtimeGuard === "attention" ? "runtime_guard_attention"
          : heartbeat === "attention" ? "execution_heartbeat_attention"
            : runtimeGuard === "unavailable" || heartbeat === "unavailable" ? "monitoring_unavailable" : "none",
      },
      no_order: true,
      deployment: {
        observed_at: now,
        runtime_enabled: runtimeEnabled,
        scheduler_state: scheduler,
        strategy_profile: null,
        execution_mode: platform === "binance" ? "live" : "dry_run",
      },
    }],
    errors: [],
  };
}

try {
  let seeded = await call("/api/internal/sync-runtime-target-lifecycle-source", {
    method: "POST", cookie: "", origin: "",
    headers: { Authorization: "Bearer synthetic-lifecycle-token" },
    body: lifecycleSource(),
  });
  assert.equal(seeded.status, 200);

  const staleOtherPlatform = await call("/api/internal/sync-runtime-target-lifecycle-source", {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-lifecycle-token" },
    body: lifecycleSource({ sourceId: "qmt-stale-fixture", platform: "qmt", sourceTargetId: "qmt.cn_pool", generatedAt: "2020-01-01T00:00:00Z", computedAt: "2020-01-01T00:00:00Z" }),
  });
  assert.equal(staleOtherPlatform.status, 200);

  let incidentHealthy = await call("/api/account-diagnosis", {
    method: "POST", body: { platform: "binance", key: "default", trigger: "incident" },
  });
  assert.equal(incidentHealthy.status, 409);
  assert.equal(incidentHealthy.body.error, "account_diagnosis_incident_requires_attention");
  assert.equal(dispatches.length, 0);

  const manual = await call("/api/account-diagnosis", {
    method: "POST", body: { platform: "binance", key: "default", trigger: "manual_check" },
  });
  assert.equal(manual.status, 202);
  assert.equal(manual.body.status, "queued");
  assert.match(manual.body.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(dispatches.length, 1);
  assert.match(dispatches[0].url, /QuantStrategyLab\/AIAuditBridge\/actions\/workflows\/codex_audit\.yml\/dispatches$/);
  assert.deepEqual(JSON.parse(dispatches[0].body), { ref: "main", inputs: { account_diagnosis_request_id: manual.body.request_id } });

  const duplicate = await call("/api/account-diagnosis", {
    method: "POST", body: { platform: "binance", key: "default", trigger: "manual_check" },
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.request_id, manual.body.request_id);
  assert.equal(duplicate.body.deduplicated, true);
  assert.equal(dispatches.length, 1);

  const publicRead = await call(`/api/account-diagnosis?platform=binance&key=default`);
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.body.task.request_id, manual.body.request_id);
  assert.equal("checks" in publicRead.body.task, false);

  const internalRead = await call(`/api/internal/account-diagnosis/${manual.body.request_id}`, {
    cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-diagnosis-token" },
  });
  assert.equal(internalRead.status, 200);
  assert.deepEqual(Object.keys(internalRead.body).sort(), [
    "checks", "key", "observed_at", "platform", "request_id", "status", "target_id", "trigger",
  ].sort());
  assert.equal(internalRead.body.target_id, targetId);
  assert.deepEqual(internalRead.body.checks, {
    configured_state: "enabled", runtime_enabled: true, scheduler_state: "enabled",
    runtime_guard: "pass", execution_heartbeat: "pass", freshness: "ready",
  });

  const claimBody = { request_id: manual.body.request_id, status: "running", workflow_run_id: "100", workflow_run_attempt: "1" };
  const claims = await Promise.all([
    call(`/api/internal/account-diagnosis/${manual.body.request_id}`, { method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-diagnosis-token" }, body: claimBody }),
    call(`/api/internal/account-diagnosis/${manual.body.request_id}`, { method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-diagnosis-token" }, body: claimBody }),
  ]);
  assert.deepEqual(claims.map(item => item.status).sort(), [200, 200]);
  assert.deepEqual(claims.map(item => item.body.claimed).sort(), [false, true]);

  const callback = await call(`/api/internal/account-diagnosis/${manual.body.request_id}`, {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-diagnosis-token" },
    body: { request_id: manual.body.request_id, status: "succeeded", workflow_run_id: "100", workflow_run_attempt: "1", job_id: "job_ABC-123", summary: "已完成只读诊断，建议复查运行状态。", reason_code: "diagnosis_ready" },
  });
  assert.equal(callback.status, 200);
  assert.equal(callback.body.ok, true);
  assert.equal(dispatches.length, 2);
  assert.match(dispatches[1].url, /QuantStrategyLab\/BinancePlatform\/actions\/workflows\/runtime-target-lifecycle\.yml\/dispatches$/);
  assert.deepEqual(JSON.parse(dispatches[1].body), { ref: "main" });

  seeded = await call("/api/internal/sync-runtime-target-lifecycle-source", {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-lifecycle-token" },
    body: lifecycleSource({ runtimeGuard: "attention", heartbeat: "pass", runtimeEnabled: true, scheduler: "enabled" }),
  });
  assert.equal(seeded.status, 200);
  const attentionRead = await call("/api/account-diagnosis?platform=binance&key=default");
  assert.equal(attentionRead.body.task.recheck_status, "attention");

  seeded = await call("/api/internal/sync-runtime-target-lifecycle-source", {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-lifecycle-token" },
    body: lifecycleSource({ runtimeGuard: "unavailable", heartbeat: "pass", runtimeEnabled: true, scheduler: "enabled" }),
  });
  assert.equal(seeded.status, 200);
  const unavailableRead = await call("/api/account-diagnosis?platform=binance&key=default");
  assert.equal(unavailableRead.body.task.recheck_status, "unavailable");

  seeded = await call("/api/internal/sync-runtime-target-lifecycle-source", {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-lifecycle-token" },
    body: lifecycleSource({ runtimeGuard: "pass", heartbeat: "not_due", runtimeEnabled: true }),
  });
  assert.equal(seeded.status, 200);
  const completedRead = await call("/api/account-diagnosis?platform=binance&key=default");
  assert.equal(completedRead.status, 200);
  assert.equal(completedRead.body.task.recheck_status, "passed");

  seeded = await call("/api/internal/sync-runtime-target-lifecycle-source", {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-lifecycle-token" },
    body: lifecycleSource({ configuredState: "disabled", runtimeGuard: "pass", heartbeat: "not_applicable", runtimeEnabled: false, scheduler: "paused" }),
  });
  assert.equal(seeded.status, 200);
  const disabledIncident = await call("/api/account-diagnosis", {
    method: "POST", body: { platform: "binance", key: "default", trigger: "incident" },
  });
  assert.equal(disabledIncident.status, 409);
  const disabledManual = await call("/api/account-diagnosis", {
    method: "POST", body: { platform: "binance", key: "default", trigger: "manual_check" },
  });
  assert.equal(disabledManual.status, 202);

  const duplicateCallback = await call(`/api/internal/account-diagnosis/${manual.body.request_id}`, {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-diagnosis-token" },
    body: { request_id: manual.body.request_id, status: "succeeded", workflow_run_id: "100", workflow_run_attempt: "1", job_id: "job_ABC-123", summary: "已完成只读诊断，建议复查运行状态。", reason_code: "diagnosis_ready" },
  });
  assert.equal(duplicateCallback.status, 200);
  assert.equal(dispatches.length, 3);

  const wrongToken = await call(`/api/internal/account-diagnosis/${manual.body.request_id}`, { cookie: "", origin: "", headers: { Authorization: "Bearer wrong" } });
  assert.equal(wrongToken.status, 401);
  const extraField = await call("/api/account-diagnosis", { method: "POST", body: { platform: "binance", key: "default", trigger: "manual_check", prompt: "do anything" } });
  assert.equal(extraField.status, 400);
  const wrongTarget = await call("/api/account-diagnosis", { method: "POST", body: { platform: "binance", key: "missing", trigger: "manual_check" } });
  assert.equal(wrongTarget.status, 409);

  seeded = await call("/api/internal/sync-runtime-target-lifecycle-source", {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-lifecycle-token" },
    body: lifecycleSource({ runtimeGuard: "pass", heartbeat: "pass", runtimeEnabled: true, scheduler: "paused" }),
  });
  assert.equal(seeded.status, 200);
  assert.equal(dispatches.length, 3);
  const incident = await call("/api/account-diagnosis", {
    method: "POST", body: { platform: "binance", key: "default", trigger: "incident" },
  });
  assert.equal(incident.status, 202);
  assert.notEqual(incident.body.request_id, manual.body.request_id);

  seeded = await call("/api/internal/sync-runtime-target-lifecycle-source", {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-lifecycle-token" },
    body: lifecycleSource({ runtimeGuard: "attention", heartbeat: "attention", runtimeEnabled: false }),
  });
  assert.equal(seeded.status, 200);
  failDispatch = true;
  const uncertain = await call("/api/account-diagnosis", {
    method: "POST", body: { platform: "binance", key: "default", trigger: "manual_check" },
  });
  assert.equal(uncertain.status, 502);
  assert.equal(uncertain.body.task.dispatch_state, "unknown");
  failDispatch = false;
  const uncertainClaim = await call(`/api/internal/account-diagnosis/${uncertain.body.request_id}`, {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-diagnosis-token" },
    body: { request_id: uncertain.body.request_id, status: "running", workflow_run_id: "101", workflow_run_attempt: "1" },
  });
  assert.deepEqual(uncertainClaim.body, { ok: true, claimed: true });
  const uncertainResult = await call(`/api/internal/account-diagnosis/${uncertain.body.request_id}`, {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-diagnosis-token" },
    body: { request_id: uncertain.body.request_id, status: "unknown", workflow_run_id: "101", workflow_run_attempt: "1", summary: "结果未知。", reason_code: "codex_unavailable" },
  });
  assert.equal(uncertainResult.status, 200);
  const secondUncertainClaim = await call(`/api/internal/account-diagnosis/${uncertain.body.request_id}`, {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-diagnosis-token" },
    body: { request_id: uncertain.body.request_id, status: "running", workflow_run_id: "102", workflow_run_attempt: "1" },
  });
  assert.deepEqual(secondUncertainClaim.body, { ok: true, claimed: false });

  seeded = await call("/api/internal/sync-runtime-target-lifecycle-source", {
    method: "POST", cookie: "", origin: "", headers: { Authorization: "Bearer synthetic-lifecycle-token" },
    body: lifecycleSource({ sourceId: "binance-account-diagnosis-fixture", generatedAt: "2020-01-01T00:00:00Z", computedAt: "2020-01-01T00:00:00Z" }),
  });
  assert.equal(seeded.status, 200);
  const staleIncident = await call("/api/account-diagnosis", {
    method: "POST", body: { platform: "binance", key: "default", trigger: "incident" },
  });
  assert.equal(staleIncident.status, 202, "a stale target record is a diagnosable known exception");
  const staleRead = await call("/api/account-diagnosis?platform=binance&key=default");
  assert.equal(staleRead.status, 200, "task progress remains readable with a stale later check");
  assert.equal(staleRead.body.task.request_id, staleIncident.body.request_id);

  autoPersist = await mkdtemp(join(tmpdir(), "qrt-account-diagnosis-auto-"));
  autoMf = new Miniflare({
    ...options,
    bindings: { ...bindings, ACCOUNT_DIAGNOSIS_AUTO_ENABLED: "true" },
    durableObjectsPersist: autoPersist,
  });
  async function autoCall(endpoint, { method = "GET", body, headers = {} } = {}) {
    const response = await autoMf.dispatchFetch(`https://console.example${endpoint}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* no body */ }
    return { status: response.status, body: payload };
  }
  const autoDispatchCount = dispatches.length;
  const [autoSeed, autoSeedDifferentFingerprint] = await Promise.all([
    autoCall("/api/internal/sync-runtime-target-lifecycle-source", {
      method: "POST", headers: { Authorization: "Bearer synthetic-lifecycle-token" },
      body: lifecycleSource({ sourceId: "binance-auto-diagnosis-fixture", runtimeGuard: "attention", runtimeEnabled: false }),
    }),
    autoCall("/api/internal/sync-runtime-target-lifecycle-source", {
      method: "POST", headers: { Authorization: "Bearer synthetic-lifecycle-token" },
      body: lifecycleSource({ sourceId: "binance-auto-diagnosis-different-fixture", runtimeGuard: "pass", heartbeat: "attention", runtimeEnabled: true }),
    }),
  ]);
  assert.equal(autoSeed.status, 200);
  assert.equal(autoSeedDifferentFingerprint.status, 200);
  assert.equal(dispatches.length, autoDispatchCount + 1, "different auto fingerprints still share one target-level 24-hour quota");

  const revision = await call("/api/admin/runtime-instances");
  assert.equal(revision.status, 200);
  assert.equal(revision.body.revision, 0);
  assert.equal(revision.body.initialized, false);
  console.log("account diagnosis validation: PASS (Binance-only binding, strict auth, dedupe, atomic claim, callback binding, one no-input recheck dispatch, no account mutation)");
} finally {
  await mf.dispose();
  if (autoMf) await autoMf.dispose();
  await rm(persist, { recursive: true, force: true });
  if (autoPersist) await rm(autoPersist, { recursive: true, force: true });
}
