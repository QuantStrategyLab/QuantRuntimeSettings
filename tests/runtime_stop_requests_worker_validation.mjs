import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import worker, { __test } from "../web/strategy-switch-console/worker.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");
const originalFetch = globalThis.fetch;
const probePath = fileURLToPath(new URL("./helpers/runtime_stop_workflow_probe.py", import.meta.url));

function account(extra = {}) {
  return {
    key: "hk", label: "Synthetic HK", target_name: "hk",
    variable_scope: "environment", github_environment: "longbridge-hk",
    deployment_selector: "synthetic-hk", account_scope: "HK",
    account_selector: "synthetic-account", service_name: "longbridge-quant-hk-service",
    runtime_status_target_id: "longbridge.hk",
    supported_domains: ["hk_equity"], broker_environment: "paper",
    default_execution_mode: "live", default_strategy_profile: "retired-synthetic-profile",
    ...extra,
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

function waitFor(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 5000); }),
  ]).finally(() => clearTimeout(timer));
}

function wrapNamespace(namespace, action, latch) {
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

function throwOnAction(namespace, action) {
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
          if (command?.action === action) throw new Error("durable object down");
          return stub.fetch(input, init);
        },
      };
    },
  };
}

async function start(options) {
  const persist = await mkdtemp(join(tmpdir(), "qrt-hk-stop-"));
  const bindings = {
    SESSION_SECRET: "hk-stop-fixture-session",
    ALLOWED_GITHUB_LOGINS: "settings-admin",
    STRATEGY_SWITCH_ADMIN_LOGINS: "settings-admin",
    RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-only-dispatch-value",
    EXECUTION_EVIDENCE_SYNC_TOKEN: "synthetic-lifecycle-token",
    STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ longbridge: [options] }),
  };
  const mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
    compatibilityDate: "2026-06-08",
    bindings,
    durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
    durableObjectsPersist: persist,
    kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
    outboundService: () => new Response("offline only", { status: 503 }),
  });
  const cookie = `qsl_switch_session=${await __test.makeSession("settings-admin", [], bindings)}`;
  async function call(endpoint, { method = "GET", body, headers = {} } = {}) {
    const response = await mf.dispatchFetch(`https://switch.example${endpoint}`, {
      method,
      headers: {
        Cookie: cookie,
        Origin: "https://switch.example",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
    return { status: response.status, body: payload };
  }
  const namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const kv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG");
  return { mf, persist, bindings, cookie, call, namespace, kv };
}

function stopFetch(mode, bodies) {
  return async (url, init) => {
    if (!String(url).includes("/actions/workflows/manual-runtime-stop.yml/dispatches")) {
      return new Response("offline only", { status: 503 });
    }
    bodies.push({ url: String(url), body: String(init?.body || "") });
    if (mode.hold) await mode.hold;
    if (mode.outcome === "reject") return new Response("synthetic-sensitive-provider-error", { status: 422 });
    if (mode.outcome === "unknown") return new Response("synthetic-sensitive-provider-error", { status: 503 });
    if (mode.outcome === "throw") throw new Error("synthetic timeout");
    return new Response(null, { status: 204 });
  };
}

async function workerRead(env, { cookie = "", origin } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  const response = await worker.fetch(new Request("https://switch.example/api/runtime-stop?platform=longbridge&target_name=hk", {
    method: "GET",
    headers,
  }), env);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  return { status: response.status, body: payload };
}

async function workerStop(env, cookie, body, { origin = "https://switch.example" } = {}) {
  const headers = { Cookie: cookie, "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  const response = await worker.fetch(new Request("https://switch.example/api/runtime-stop", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }), env);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  return { status: response.status, body: payload, text };
}

async function initialize(call) {
  const created = await call("/api/admin/runtime-instances", {
    method: "POST",
    body: { action: "initialize", expected_revision: 0, confirm: "IMPORT_EXISTING_CONFIG" },
  });
  assert.equal(created.status, 200);
}

const stopBody = { platform: "longbridge", target_name: "hk", confirm: "STOP_ONLY" };

try {
  const incomplete = await start(account({ github_environment: undefined }));
  try {
    await initialize(incomplete.call);
    const bodies = [];
    globalThis.fetch = stopFetch({ outcome: "accept" }, bodies);
    const denied = await workerStop({
      ...incomplete.bindings,
      STRATEGY_SWITCH_RUNTIME_INSTANCES: incomplete.namespace,
      STRATEGY_SWITCH_CONFIG: incomplete.kv,
    }, incomplete.cookie, stopBody);
    assert.equal(denied.status, 400);
    assert.equal(denied.body.error, "hk_stop_identity_incomplete");
    assert.equal(bodies.length, 0);
  } finally {
    await incomplete.mf.dispose();
  }

  const claimed = await start(account());
  try {
    await initialize(claimed.call);
    const bodies = [];
    globalThis.fetch = stopFetch({ outcome: "accept" }, bodies);
    const baseEnv = {
      ...claimed.bindings,
      STRATEGY_SWITCH_RUNTIME_INSTANCES: claimed.namespace,
      STRATEGY_SWITCH_CONFIG: claimed.kv,
    };
    const browserRead = await workerRead(baseEnv, { cookie: claimed.cookie });
    assert.equal(browserRead.status, 200);
    assert.equal(browserRead.body.phase, null);
    assert.equal(browserRead.body.request_succeeded, false);
    const anonymousRead = await workerRead(baseEnv);
    assert.equal(anonymousRead.status, 401);
    const crossRead = await workerRead(baseEnv, { cookie: claimed.cookie, origin: "https://other.example" });
    assert.equal(crossRead.status, 403);
    const missingOriginPost = await workerStop(baseEnv, claimed.cookie, stopBody, { origin: null });
    assert.equal(missingOriginPost.status, 403);
    assert.equal(bodies.length, 0);
    const placeholder = await workerStop({
      ...baseEnv,
      STRATEGY_SWITCH_RUNTIME_INSTANCES: throwOnAction(claimed.namespace, "hk_stop_claim"),
    }, claimed.cookie, stopBody);
    assert.equal(placeholder.status, 503);
    assert.equal(bodies.length, 0);

    const latch = openLatch();
    let pending = workerStop({
      ...baseEnv,
      STRATEGY_SWITCH_RUNTIME_INSTANCES: wrapNamespace(claimed.namespace, "hk_stop_claim", latch),
    }, claimed.cookie, { ...stopBody, request_id: crypto.randomUUID() });
    try {
      await waitFor(latch.entered, "hk stop claim");
      const instances = await claimed.call("/api/admin/runtime-instances");
      const changed = await claimed.call("/api/admin/runtime-instances", {
        method: "POST",
        body: {
          action: "set_broker_environment",
          expected_revision: instances.body.revision,
          platform: "longbridge",
          key: "hk",
          broker_environment: "live",
        },
      });
      assert.equal(changed.status, 200);
      latch.release();
      const raced = await pending;
      pending = null;
      assert.equal(raced.status, 409);
      assert.equal(raced.body.error, "hk_stop_source_conflict");
      assert.equal(bodies.length, 0);
    } finally {
      latch.release();
      if (pending) await pending.catch(() => {});
    }

    const mode = { outcome: "accept", hold: null };
    let releaseHold = () => {};
    mode.hold = new Promise((resolve) => { releaseHold = resolve; });
    globalThis.fetch = stopFetch(mode, bodies);
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    let finished = 0;
    const track = (promise) => promise.then((result) => { finished += 1; return result; });
    const overlapped = [track(workerStop(baseEnv, claimed.cookie, { ...stopBody, request_id: firstId })), track(workerStop(baseEnv, claimed.cookie, { ...stopBody, request_id: secondId }))];
    await waitFor(new Promise((resolve) => {
      const timer = setInterval(() => {
        if (finished >= 1 && bodies.length >= 1) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    }), "hk stop overlap");
    assert.equal(bodies.length, 1);
    releaseHold();
    const overlappedResults = await Promise.all(overlapped);
    assert.equal(bodies.length, 1);
    assert.deepEqual(overlappedResults.map((item) => item.status).sort(), [200, 409]);
    const accepted = overlappedResults.find((item) => item.status === 200);
    assert.equal(accepted.body.platform_applied, false);
    assert.equal(accepted.body.request_succeeded, false);
    assert.equal(accepted.body.configured, false);
    assert.equal(accepted.body.phase, "accepted");
    assert.equal(accepted.body.dispatch_result, "accepted");
    assert.equal(accepted.body.workflow_run_id, null);
    const dispatched = JSON.parse(bodies[0].body);
    assert.equal(dispatched.inputs.apply_hk_stop, "true");
    assert.equal(dispatched.inputs.confirm, "STOP_ONLY");
    const probe = spawnSync("python3", [probePath], { input: JSON.stringify(dispatched), encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr || "synthetic HK workflow probe failed");
    assert.match(probe.stdout, /one HK stop request, application remains unverified/);
    const replay = await workerStop(baseEnv, claimed.cookie, { ...stopBody, request_id: accepted.body.request_id });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.reused, true);
    assert.equal(replay.body.request_id, accepted.body.request_id);
    assert.equal(bodies.length, 1);
    const blocked = await workerStop(baseEnv, claimed.cookie, { ...stopBody, request_id: crypto.randomUUID() });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, "hk_stop_request_pending");
    assert.equal(bodies.length, 1);
  } finally {
    await claimed.mf.dispose();
  }

  const unknownRun = await start(account());
  try {
    await initialize(unknownRun.call);
    const bodies = [];
    globalThis.fetch = stopFetch({ outcome: "unknown" }, bodies);
    const env = {
      ...unknownRun.bindings,
      STRATEGY_SWITCH_RUNTIME_INSTANCES: unknownRun.namespace,
      STRATEGY_SWITCH_CONFIG: unknownRun.kv,
    };
    const unknown = await workerStop(env, unknownRun.cookie, { ...stopBody, request_id: crypto.randomUUID() });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.phase, "unknown");
    assert.equal(unknown.body.dispatch_result, "unknown");
    assert.equal(unknown.body.platform_applied, false);
    assert.equal(unknown.body.request_succeeded, false);
    assert.equal(unknown.text.includes("synthetic-sensitive-provider-error"), false);
    assert.equal(bodies.length, 1);
    const again = await workerStop(env, unknownRun.cookie, { ...stopBody, request_id: crypto.randomUUID() });
    assert.equal(again.status, 409);
    assert.equal(bodies.length, 1);
    const fresh = new Date().toISOString();
    const seeded = await unknownRun.call("/api/internal/sync-runtime-target-lifecycle-source", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic-lifecycle-token" },
      body: lifecycleSource({ generatedAt: fresh, computedAt: fresh }),
    });
    assert.equal(seeded.status, 200);
    const observed = await unknownRun.call("/api/runtime-stop?platform=longbridge&target_name=hk");
    assert.equal(observed.body.phase, "unknown");
    assert.equal(observed.body.request_succeeded, false);
    assert.equal(observed.body.runtime_observation.status, "unknown");
    assert.equal(observed.body.runtime_observation.request_succeeded, false);
    const instances = await unknownRun.call("/api/admin/runtime-instances");
    const changedIdentity = await unknownRun.call("/api/admin/runtime-instances", {
      method: "POST",
      body: {
        action: "set_broker_environment",
        expected_revision: instances.body.revision,
        platform: "longbridge",
        key: "hk",
        broker_environment: "live",
      },
    });
    assert.equal(changedIdentity.status, 200);
    const shifted = await unknownRun.call("/api/runtime-stop?platform=longbridge&target_name=hk");
    assert.equal(shifted.body.phase, "unknown");
    assert.equal(shifted.body.request_succeeded, false);
    assert.equal(shifted.body.runtime_observation.status, "unknown");
    const shiftedAgain = await workerStop(env, unknownRun.cookie, { ...stopBody, request_id: crypto.randomUUID() });
    assert.equal(shiftedAgain.status, 409);
    assert.equal(bodies.length, 1);
    const wrong = await unknownRun.call("/api/internal/sync-runtime-target-lifecycle-source", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic-lifecycle-token" },
      body: lifecycleSource({ targetId: "longbridge.other", generatedAt: fresh, computedAt: fresh }),
    });
    assert.equal(wrong.status, 200);
    const wrongRead = await unknownRun.call("/api/runtime-stop?platform=longbridge&target_name=hk");
    assert.equal(wrongRead.body.phase, "unknown");
    assert.equal(wrongRead.body.runtime_observation.status, "unknown");
    const stale = await unknownRun.call("/api/internal/sync-runtime-target-lifecycle-source", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic-lifecycle-token" },
      body: lifecycleSource({ generatedAt: "2020-01-01T00:00:00Z", computedAt: "2020-01-01T00:00:00Z" }),
    });
    assert.equal(stale.status, 200);
    const staleRead = await unknownRun.call("/api/runtime-stop?platform=longbridge&target_name=hk");
    assert.equal(staleRead.body.runtime_observation.status, "unknown");
    assert.equal(staleRead.body.request_succeeded, false);
    await unknownRun.mf.dispose();
    const restarted = new Miniflare({
      modules: true,
      modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
      scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
      compatibilityDate: "2026-06-08",
      bindings: unknownRun.bindings,
      durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
      durableObjectsPersist: unknownRun.persist,
      kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
      outboundService: () => new Response("offline only", { status: 503 }),
    });
    try {
      const restartedNamespace = await restarted.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
      const restartedKv = await restarted.getKVNamespace("STRATEGY_SWITCH_CONFIG");
      const afterRestart = [];
      globalThis.fetch = stopFetch({ outcome: "accept" }, afterRestart);
      const retried = await workerStop({
        ...unknownRun.bindings,
        STRATEGY_SWITCH_RUNTIME_INSTANCES: restartedNamespace,
        STRATEGY_SWITCH_CONFIG: restartedKv,
      }, unknownRun.cookie, { ...stopBody, request_id: crypto.randomUUID() });
      assert.equal(retried.status, 409);
      assert.equal(afterRestart.length, 0);
    } finally {
      await restarted.dispose();
    }
  } finally {
    await unknownRun.mf.dispose().catch(() => {});
  }

  const rejectedRun = await start(account());
  try {
    await initialize(rejectedRun.call);
    const bodies = [];
    globalThis.fetch = stopFetch({ outcome: "reject" }, bodies);
    const env = {
      ...rejectedRun.bindings,
      STRATEGY_SWITCH_RUNTIME_INSTANCES: rejectedRun.namespace,
      STRATEGY_SWITCH_CONFIG: rejectedRun.kv,
    };
    const requestA = crypto.randomUUID();
    const requestB = crypto.randomUUID();
    const rejectedA = await workerStop(env, rejectedRun.cookie, { ...stopBody, request_id: requestA });
    assert.equal(rejectedA.status, 200);
    assert.equal(rejectedA.body.phase, "rejected");
    assert.equal(rejectedA.body.dispatch_result, "rejected");
    assert.equal(rejectedA.body.request_id, requestA);
    assert.equal(rejectedA.body.request_succeeded, false);
    assert.equal(rejectedA.text.includes("synthetic-sensitive-provider-error"), false);
    assert.equal(bodies.length, 1);
    const rejectedB = await workerStop(env, rejectedRun.cookie, { ...stopBody, request_id: requestB });
    assert.equal(rejectedB.status, 200);
    assert.equal(rejectedB.body.phase, "rejected");
    assert.equal(rejectedB.body.request_id, requestB);
    assert.equal(bodies.length, 2);
    const replayA = await workerStop(env, rejectedRun.cookie, { ...stopBody, request_id: requestA });
    assert.equal(replayA.status, 200);
    assert.equal(replayA.body.reused, true);
    assert.equal(replayA.body.request_id, requestA);
    assert.equal(replayA.body.phase, "rejected");
    assert.equal(bodies.length, 2);
    const replayB = await workerStop(env, rejectedRun.cookie, { ...stopBody, request_id: requestB });
    assert.equal(replayB.body.request_id, requestB);
    assert.equal(replayB.body.phase, "rejected");
    assert.equal(bodies.length, 2);
    const instances = await rejectedRun.call("/api/admin/runtime-instances");
    const changed = await rejectedRun.call("/api/admin/runtime-instances", {
      method: "POST",
      body: {
        action: "set_broker_environment",
        expected_revision: instances.body.revision,
        platform: "longbridge",
        key: "hk",
        broker_environment: "live",
      },
    });
    assert.equal(changed.status, 200);
    const conflicted = await workerStop(env, rejectedRun.cookie, { ...stopBody, request_id: requestA });
    assert.equal(conflicted.status, 409);
    assert.equal(conflicted.body.error, "hk_stop_identity_conflict");
    assert.equal(bodies.length, 2);
    const restored = await rejectedRun.call("/api/admin/runtime-instances", {
      method: "POST",
      body: {
        action: "set_broker_environment",
        expected_revision: changed.body.revision,
        platform: "longbridge",
        key: "hk",
        broker_environment: "paper",
      },
    });
    assert.equal(restored.status, 200);
    const restoredA = await workerStop(env, rejectedRun.cookie, { ...stopBody, request_id: requestA });
    assert.equal(restoredA.status, 200);
    assert.equal(restoredA.body.request_id, requestA);
    assert.equal(restoredA.body.phase, "rejected");
    assert.equal(bodies.length, 2);
    await rejectedRun.mf.dispose();
    const restarted = new Miniflare({
      modules: true,
      modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
      scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
      compatibilityDate: "2026-06-08",
      bindings: rejectedRun.bindings,
      durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
      durableObjectsPersist: rejectedRun.persist,
      kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
      outboundService: () => new Response("offline only", { status: 503 }),
    });
    try {
      const restartedNamespace = await restarted.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
      const afterRestart = [];
      globalThis.fetch = stopFetch({ outcome: "reject" }, afterRestart);
      const replayAfterRestart = await workerStop({
        ...rejectedRun.bindings,
        STRATEGY_SWITCH_RUNTIME_INSTANCES: restartedNamespace,
        STRATEGY_SWITCH_CONFIG: await restarted.getKVNamespace("STRATEGY_SWITCH_CONFIG"),
      }, rejectedRun.cookie, { ...stopBody, request_id: requestA });
      assert.equal(replayAfterRestart.status, 200);
      assert.equal(replayAfterRestart.body.request_id, requestA);
      assert.equal(replayAfterRestart.body.phase, "rejected");
      assert.equal(afterRestart.length, 0);
    } finally {
      await restarted.dispose();
    }
  } finally {
    await rejectedRun.mf.dispose().catch(() => {});
  }

  const lostRecord = await start(account());
  try {
    await initialize(lostRecord.call);
    const bodies = [];
    globalThis.fetch = stopFetch({ outcome: "accept" }, bodies);
    const env = {
      ...lostRecord.bindings,
      STRATEGY_SWITCH_CONFIG: lostRecord.kv,
      STRATEGY_SWITCH_RUNTIME_INSTANCES: throwOnAction(lostRecord.namespace, "hk_stop_record"),
    };
    const lost = await workerStop(env, lostRecord.cookie, stopBody);
    assert.equal(lost.status, 200);
    assert.equal(lost.body.persisted, false);
    assert.equal(lost.body.phase, "reserved");
    assert.equal(lost.body.platform_applied, false);
    assert.equal(bodies.length, 1);
    const second = await workerStop({
      ...lostRecord.bindings,
      STRATEGY_SWITCH_CONFIG: lostRecord.kv,
      STRATEGY_SWITCH_RUNTIME_INSTANCES: lostRecord.namespace,
    }, lostRecord.cookie, { ...stopBody, request_id: crypto.randomUUID() });
    assert.equal(second.status, 409);
    assert.equal(bodies.length, 1);
    await lostRecord.mf.dispose();
    const restarted = new Miniflare({
      modules: true,
      modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
      scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
      compatibilityDate: "2026-06-08",
      bindings: lostRecord.bindings,
      durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
      durableObjectsPersist: lostRecord.persist,
      kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
      outboundService: () => new Response("offline only", { status: 503 }),
    });
    try {
      const restartedNamespace = await restarted.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
      const afterRestart = [];
      globalThis.fetch = stopFetch({ outcome: "accept" }, afterRestart);
      const retried = await workerStop({
        ...lostRecord.bindings,
        STRATEGY_SWITCH_RUNTIME_INSTANCES: restartedNamespace,
        STRATEGY_SWITCH_CONFIG: await restarted.getKVNamespace("STRATEGY_SWITCH_CONFIG"),
      }, lostRecord.cookie, stopBody);
      assert.equal(retried.status, 409);
      assert.equal(afterRestart.length, 0);
    } finally {
      await restarted.dispose();
    }
  } finally {
    await lostRecord.mf.dispose().catch(() => {});
  }

  console.log("runtime stop requests: one HK dispatch is claimed before send; unknown, conflict, and failed result writes do not dispatch again");
} finally {
  globalThis.fetch = originalFetch;
}

function lifecycleSource({ targetId = "longbridge.hk", generatedAt, computedAt }) {
  return {
    schema_version: "qsl_runtime_target_lifecycle_source_snapshot.v1",
    source_id: "longbridge-hk-stop-fixture",
    generated_at: generatedAt,
    computed_at: computedAt,
    data_status: "ready",
    targets: [{
      target_id: targetId,
      target: { platform: "longbridge", configured_state: "disabled", execution_mode: "dry_run" },
      monitoring: { runtime_guard: "pass", execution_heartbeat: "not_applicable" },
      disposition: { code: "continue_disabled_validation", reason_code: "none" },
      no_order: true,
      deployment: {
        observed_at: generatedAt,
        runtime_enabled: false,
        scheduler_state: "paused",
        strategy_profile: null,
        execution_mode: "dry_run",
      },
    }],
    errors: [],
  };
}
