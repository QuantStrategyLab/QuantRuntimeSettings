import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { __test, initializeDirectory } from "./helpers/directory_worker.mjs";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");
const targetId = "binance.crypto_live_pool_rotation";
const longbridgeAccounts = ["paper", "hk", "sg"].map(key => ({ key, label: `LongBridge ${key}`, target_name: key,
  runtime_status_target_id: `longbridge.${key}`, supported_domains: [key === "sg" ? "us_equity" : "hk_equity"],
  service_name: `longbridge-quant-${key}-service`, broker_environment: key === "paper" ? "paper" : "live",
  default_execution_mode: "live" }));
const account = { key: "default", label: "Binance", target_name: "crypto_live_pool_rotation", runtime_status_target_id: targetId,
  supported_domains: ["crypto"], service_name: "binance-platform", default_execution_mode: "live" };
const nativeBinding = { schema_version: "qrs.account-diagnosis-native.v1", project: "QuantStrategyLab/QuantRuntimeSettings",
  resource: "https://native.invalid", audience: "quant-fixture", provider: "dot", profile: "account-diagnosis",
  model: "synthetic-model", worker: "synthetic-quant-worker" };
const bindings = { SESSION_SECRET: "synthetic-only-session-key", STRATEGY_SWITCH_ADMIN_LOGINS: "fixture-admin",
  ALLOWED_GITHUB_LOGINS: "fixture-reader", STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ binance: [account], longbridge: longbridgeAccounts }),
  EXECUTION_EVIDENCE_SYNC_TOKEN: "synthetic-lifecycle-token", ACCOUNT_DIAGNOSIS_SYNC_TOKEN: "synthetic-diagnosis-token",
  ACCOUNT_DIAGNOSIS_AUTO_ENABLED: "false", RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-dispatch-token",
  ACCOUNT_DIAGNOSIS_NATIVE_BINDING_JSON: JSON.stringify(nativeBinding) };
const cookie = `qsl_switch_session=${await __test.makeSession("fixture-admin", [], bindings)}`;
const nativeCalls = [], rechecks = [], records = new Map(), idempotency = new Map();
let loseSubmit = false, loseCancel = false, loseLookup = false, replyFault = null, serverLifetime = 600, mutate = record => record;
const output = () => ({ status: "succeeded", summary: "Synthetic read-only diagnosis completed.", reason_code: "diagnosis_ready",
  advisory_only: true, execution_authority_granted: false });
async function nativeService(request) {
  const url = new URL(request.url), path = url.pathname;
  const body = request.method === "GET" ? undefined : await request.json();
  nativeCalls.push({ method: request.method, path, body, key: request.headers.get("Idempotency-Key"),
    request_sha: request.headers.get("X-Request-SHA256") });
  assert.equal(request.headers.has("Authorization"), false, "old dispatch/callback token is never forwarded as AI authority");
  if (replyFault) return replyFault();
  let record;
  if (path === "/v1/tasks" && request.method === "POST") {
    const key = request.headers.get("Idempotency-Key");
    assert.ok(!idempotency.has(key), "caller must not POST again even with the original key");
    const id = `task-${records.size + 1}`;
    record = { id, owner: nativeBinding.project, provider: "dot", result_kind: "advisory", revision: 1,
      request: body, status: "queued", worker: null, attempt: null, deadline: Date.now()/1000 + serverLifetime, output: null };
    records.set(id, record); idempotency.set(key, id);
    if (loseSubmit) throw new Error("private fixture response lost after submit");
  } else if (path === "/v1/tasks/lookup") {
    if (loseLookup) throw new Error("private fixture lookup unavailable");
    const id = idempotency.get(request.headers.get("Idempotency-Key"));
    if (!id) return new Response("{}", { status: 404 });
    const digest = await __test.sha256Hex(__test.canonicalResearchTaskJson(records.get(id).request));
    assert.equal(request.headers.get("X-Request-SHA256"), digest);
    return Response.json({ id });
  } else if (path.endsWith("/cancel")) {
    record = records.get(path.split("/")[3]);
    record.status = record.worker ? "cancel_requested" : "cancelled";
    if (loseCancel) throw new Error("private fixture cancellation acknowledgement lost");
  } else {
    record = records.get(path.split("/")[3]);
  }
  if (!record) return new Response("{}", { status: 404 });
  return Response.json(mutate(structuredClone(record)));
}
function source({ platform = "binance", target = targetId, guard = "pass", heartbeat = "pass", configured = "enabled",
  enabled = true, scheduler = "enabled", stamp = new Date().toISOString(), sourceId = "diagnosis-fixture" } = {}) {
  return { schema_version: "qsl_runtime_target_lifecycle_source_snapshot.v1", source_id: sourceId, generated_at: stamp,
    computed_at: stamp, data_status: "ready", targets: [{ target_id: target,
      target: { platform, configured_state: configured, execution_mode: platform === "binance" ? "live" : "dry_run" },
      monitoring: { runtime_guard: guard, execution_heartbeat: heartbeat },
      disposition: { code: ["attention", "unavailable"].includes(guard) || ["attention", "unavailable"].includes(heartbeat) ? "parked" : configured === "disabled" ? "continue_disabled_validation" : "continue_enabled_monitoring",
        reason_code: guard === "attention" ? "runtime_guard_attention" : heartbeat === "attention" ? "execution_heartbeat_attention" : guard === "unavailable" || heartbeat === "unavailable" ? "monitoring_unavailable" : "none" },
      no_order: true, deployment: { observed_at: stamp, runtime_enabled: enabled, scheduler_state: scheduler,
        strategy_profile: null, execution_mode: platform === "binance" ? "live" : "dry_run" } }], errors: [] };
}
let mf, persist, runtimeOptions, groups = 0;
async function group(name, fn) { await fn(); groups++; console.log(`PASS ${groups}: ${name}`); }
async function reset({ native = true, transport = true, auto = false, extra = {} } = {}) {
  if (mf) await mf.dispose();
  if (persist) await rm(persist, { recursive: true, force: true });
  persist = await mkdtemp(join(tmpdir(), "qrt-account-native-"));
  records.clear(); idempotency.clear(); nativeCalls.length = 0; rechecks.length = 0;
  loseSubmit = false; loseCancel = false; loseLookup = false; replyFault = null; serverLifetime = 600; mutate = record => record;
  const env = { ...bindings, ACCOUNT_DIAGNOSIS_AUTO_ENABLED: String(auto), ...extra };
  if (!native) delete env.ACCOUNT_DIAGNOSIS_NATIVE_BINDING_JSON;
  runtimeOptions = { cf: false, modules: true, modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
    compatibilityDate: "2026-06-08", bindings: env,
    ...(native && transport ? { serviceBindings: { ACCOUNT_DIAGNOSIS_NATIVE_TRANSPORT: nativeService } } : {}),
    durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
    durableObjectsPersist: persist, kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
    outboundService: async request => { rechecks.push({ url: request.url, body: await request.text() });
      assert.doesNotMatch(request.url, /codex_audit/); return new Response(null, { status: 204 }); },
  };
  mf = new Miniflare(runtimeOptions);
  await initializeDirectory(mf);
}
async function restart(extra = {}) {
  await mf.dispose();
  runtimeOptions = { ...runtimeOptions, bindings: { ...runtimeOptions.bindings, ...extra } };
  mf = new Miniflare(runtimeOptions);
  await initializeDirectory(mf);
}
async function command(body) {
  const namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
  const response = await namespace.get(namespace.idFromName("runtime-instances")).fetch("https://fixture.invalid/", {
    method: "POST", body: JSON.stringify({ actor: "synthetic-state-fixture", ...body }),
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function call(path, { method = "GET", body, auth = "user", origin = "https://console.example" } = {}) {
  const response = await mf.dispatchFetch(`https://console.example${path}`, { method,
    headers: { ...(auth === "user" ? { Cookie: cookie } : auth === "internal" ? { Authorization: "Bearer synthetic-diagnosis-token" } :
      auth === "source" ? { Authorization: "Bearer synthetic-lifecycle-token" } : {}),
      ...(origin ? { Origin: origin } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
const seed = value => call("/api/internal/sync-runtime-target-lifecycle-source", { method: "POST", auth: "source", origin: "", body: source(value) });
const create = (platform = "binance", key = "default", trigger = "manual_check") => call("/api/account-diagnosis", { method: "POST", body: { platform, key, trigger } });
const readback = (id, action = "readback", more = {}) => call(`/api/internal/account-diagnosis/${id}`, {
  method: "POST", auth: "internal", origin: "", body: { request_id: id, action, ...more } });
const taskFor = requestId => records.get(idempotency.get(`qrs-account-diagnosis:${requestId}`));
function running(record) { Object.assign(record, { status: "running", worker: nativeBinding.worker, attempt: `attempt-${record.id}` }); }
function complete(record) { running(record); Object.assign(record, { status: "completed", output: output() }); }
const posts = () => nativeCalls.filter(item => item.method === "POST" && item.path === "/v1/tasks").length;
try {
  await group("unbound and wrong-project native context never spends old dispatch authority", async () => {
    await reset({ native: false }); await seed();
    assert.equal((await create()).status, 503); assert.equal(nativeCalls.length, 0); assert.equal(rechecks.length, 0);
    await reset({ transport: false }); await seed();
    assert.equal((await create()).status, 503); assert.equal(posts(), 0);
    await reset({ extra: { ACCOUNT_DIAGNOSIS_NATIVE_BINDING_JSON: JSON.stringify({ ...nativeBinding, project: "Pigbibi/PersonalAIService" }) } });
    await seed(); assert.equal((await create()).status, 503); assert.equal(posts(), 0);
  });
  await group("original auth, same-origin, body and target qualification gates", async () => {
    await reset(); await seed();
    assert.equal((await call("/api/account-diagnosis?platform=binance&key=default", { auth: "none" })).status, 401);
    assert.equal((await call("/api/account-diagnosis", { method: "POST", body: { platform: "binance", key: "default", trigger: "manual_check" }, origin: "https://wrong.invalid" })).status, 403);
    assert.equal((await call("/api/account-diagnosis", { method: "POST", body: { platform: "binance", key: "default", trigger: "manual_check", task_id: "forged" } })).status, 400);
    assert.equal((await create("binance", "missing")).status, 409);
    assert.equal((await create("binance", "default", "incident")).status, 409);
    assert.equal(posts(), 0);
  });
  await group("one actual generic task, same business identity and dedupe", async () => {
    const created = await create(); assert.equal(created.status, 202, JSON.stringify({ reply: created.body, nativeCalls }));
    const id = created.body.request_id, record = taskFor(id);
    assert.equal(record.request.mode, "agent"); assert.equal(record.request.profile, nativeBinding.profile);
    assert.equal(record.request.materials[0].request_id, id);
    assert.match(record.request.objective, /Do not access accounts/);
    assert.equal((await create()).body.request_id, id); assert.equal(posts(), 1);
    assert.equal((await readback(id, "readback", { status: "succeeded", summary: "forged" })).status, 400);
    assert.equal((await call(`/api/internal/account-diagnosis/${id}`, { method: "POST", auth: "internal", origin: "", body: { request_id: id, status: "running", workflow_run_id: "100", workflow_run_attempt: "1" } })).status, 400);
    assert.equal(rechecks.length, 0);
    running(record); assert.equal((await readback(id)).body.task.status, "running");
    complete(record); const accepted = await readback(id); assert.equal(accepted.body.task.status, "succeeded");
    assert.equal(rechecks.length, 1); assert.match(rechecks[0].url, /BinancePlatform\/actions\/workflows\/runtime-target-lifecycle\.yml\/dispatches$/);
    assert.equal((await readback(id)).body.replayed, true); assert.equal(rechecks.length, 1);
    const publicRead = await call("/api/account-diagnosis?platform=binance&key=default");
    assert.equal(publicRead.body.task.status, "succeeded"); assert.ok(!("native" in publicRead.body.task));
  });
  await group("LongBridge exact paper/hk/sg identity and deterministic target recheck", async () => {
    for (const key of ["paper", "hk", "sg"]) {
      await seed({ platform: "longbridge", target: `longbridge.${key}`, sourceId: `lb-${key}`, guard: key === "hk" ? "attention" : "pass", enabled: key !== "hk", scheduler: key === "hk" ? "paused" : "enabled" });
      const created = await create("longbridge", key); assert.equal(created.status, 202);
      const record = taskFor(created.body.request_id); assert.equal(record.request.materials[0].target_id, `longbridge.${key}`);
      complete(record); assert.equal((await readback(created.body.request_id)).body.task.status, "succeeded");
      assert.match(rechecks.at(-1).url, /LongBridgePlatform\/actions\/workflows\/runtime-target-lifecycle\.yml\/dispatches$/);
      assert.deepEqual(JSON.parse(rechecks.at(-1).body), { ref: "main", inputs: { target: key } });
    }
    assert.equal((await create("longbridge", "paper", "incident")).status, 409);
    assert.equal((await create("longbridge", "hk", "incident")).status, 200);
  });
  await group("lost POST acknowledgement retains intent and readonly lookup recovers original ID", async () => {
    await reset(); await seed(); loseSubmit = true;
    const first = await create(); assert.equal(first.status, 502); const id = first.body.request_id;
    assert.equal((await command({ action: "diagnosis_read", request_id: id })).task.status, "unknown");
    assert.equal((await create()).body.request_id, id); assert.equal(posts(), 1);
    loseSubmit = false; const held = await readback(id); assert.equal(held.body.task.status, "queued");
    assert.equal(posts(), 1); assert.ok(nativeCalls.some(item => item.path === "/v1/tasks/lookup"));
    complete(taskFor(id)); assert.equal((await readback(id)).body.task.status, "succeeded");
  });
  await group("wrong service project/provider/revision/request/task/claim never adopts", async () => {
    for (const [field, value] of [["owner", "Pigbibi/PhotoStory"], ["provider", "wrong"], ["revision", 2], ["request", {}], ["id", "wrong"], ["worker", "wrong"], ["attempt", "changed"]]) {
      await reset(); await seed(); const made = await create(), id = made.body.request_id, record = taskFor(id);
      running(record); assert.equal((await readback(id)).status, 200); complete(record);
      mutate = reply => ({ ...reply, [field]: value });
      assert.equal((await readback(id)).status, 409); assert.equal(rechecks.length, 0); assert.equal(posts(), 1);
    }
  });
  await group("invalid output schema/authority/summary does not become a positive report", async () => {
    for (const bad of [{ status: "succeeded" }, { ...output(), execution_authority_granted: true }, { ...output(), summary: "x".repeat(601) }]) {
      await reset(); await seed(); const made = await create(), id = made.body.request_id;
      complete(taskFor(id)); taskFor(id).output = bad;
      assert.equal((await readback(id)).status, 400); assert.equal(rechecks.length, 0);
    }
  });
  await group("cancel and expiry preserve original identity and never claim worker stopped", async () => {
    for (const kind of ["cancel", "expiry", "lost-cancel"]) {
      await reset(); await seed();
      if (kind === "expiry") serverLifetime = 1;
      const made = await create(), id = made.body.request_id, record = taskFor(id);
      running(record); assert.equal((await readback(id)).status, 200);
      if (kind === "expiry") await new Promise(resolve => setTimeout(resolve, 1100));
      if (kind === "lost-cancel") loseCancel = true;
      const getsBefore = nativeCalls.filter(item => item.method === "GET").length;
      const stopped = await readback(id, kind === "expiry" ? "readback" : "cancel");
      assert.equal(nativeCalls.filter(item => item.method === "GET").length, getsBefore, "known ID cancellation/expired stored deadline uses zero GET");
      assert.equal(stopped.body.task.status, "unknown"); assert.equal(rechecks.length, 0);
      await readback(id, "cancel");
      assert.equal(nativeCalls.filter(item => item.path.endsWith("/cancel")).length, 1);
      assert.equal(posts(), 1);
    }
  });
  await group("automatic switch and per-target quotas share the original native path", async () => {
    await reset({ auto: true });
    await Promise.all([seed({ guard: "attention", enabled: false, sourceId: "auto-a" }), seed({ heartbeat: "attention", sourceId: "auto-b" })]);
    assert.equal(posts(), 1); assert.equal(rechecks.length, 0);
    await seed({ platform: "longbridge", target: "longbridge.hk", guard: "attention", sourceId: "auto-lb" });
    assert.equal(posts(), 2);
    await seed({ platform: "longbridge", target: "longbridge.paper", sourceId: "normal-paper" });
    await seed({ platform: "longbridge", target: "longbridge.sg", configured: "disabled", enabled: false, scheduler: "paused", heartbeat: "not_applicable", sourceId: "paused-sg" });
    assert.equal(posts(), 2);
    await seed({ guard: "attention", enabled: false, sourceId: "auto-repeat" }); assert.equal(posts(), 2);
  });
  await group("original DTO, internal read-only projection and recheck freshness stay stable", async () => {
    await reset(); await seed(); const made = await create(), id = made.body.request_id;
    const internal = await call(`/api/internal/account-diagnosis/${id}`, { auth: "internal", origin: "" });
    assert.deepEqual(Object.keys(internal.body).sort(), ["checks", "key", "observed_at", "platform", "request_id", "status", "target_id", "trigger"].sort());
    assert.equal((await call(`/api/internal/account-diagnosis/${id}`, { auth: "none" })).status, 401);
    complete(taskFor(id)); await readback(id);
    for (const [change, expected] of [[{ guard: "attention" }, "attention"], [{ guard: "unavailable" }, "unavailable"], [{ heartbeat: "not_due" }, "passed"]]) {
      await new Promise(resolve => setTimeout(resolve, 10)); await seed(change);
      const read = await call("/api/account-diagnosis?platform=binance&key=default");
      assert.equal(read.body.task.recheck_status, expected);
      assert.equal("checks" in read.body.task, false); assert.equal("native" in read.body.task, false);
    }
    await seed({ configured: "disabled", enabled: false, scheduler: "paused", heartbeat: "not_applicable" });
    assert.equal((await create("binance", "default", "incident")).status, 409);
    assert.equal((await create()).status, 202);
    await seed({ stamp: "2020-01-01T00:00:00Z" });
    assert.equal((await create("binance", "default", "incident")).status, 200, "stale changed fingerprint keeps unclosed original task");
    assert.equal(posts(), 2);
    assert.equal((await call("/api/account-diagnosis?platform=binance&key=default")).status, 200);
  });
  await group("unknown remains reserved across24h and a new fingerprint", async () => {
    await reset(); await seed(); loseSubmit = true; const made = await create(), id = made.body.request_id;
    const stored = await command({ action: "diagnosis_read", request_id: id });
    await command({ action: "diagnosis_native_save", request_id: id, native: { ...stored.task.native, phase: "hold" },
      status: "unknown", summary: "", reason_code: "", updated_at: "2000-01-01T00:00:00Z" });
    await seed({ guard: "attention" });
    const second = await create(); assert.equal(second.body.request_id, id); assert.equal(posts(), 1);
  });
  await group("restart preserves known task and config drift cannot replace it", async () => {
    await reset(); await seed(); const made = await create(), id = made.body.request_id;
    running(taskFor(id)); await readback(id); await restart(); complete(taskFor(id));
    assert.equal((await readback(id)).body.task.status, "succeeded"); assert.equal(posts(), 1);
    await restart({ ACCOUNT_DIAGNOSIS_NATIVE_BINDING_JSON: JSON.stringify({ ...nativeBinding, audience: "changed" }) });
    assert.equal((await readback(id)).status, 409); assert.equal(posts(), 1);
  });
  await group("concurrent creation/readback consumes once without concurrent recheck", async () => {
    await reset(); await seed();
    const made = await Promise.all([create(), create()]);
    assert.equal(new Set(made.map(item => item.body.request_id)).size, 1); assert.equal(posts(), 1);
    const id = made[0].body.request_id; complete(taskFor(id));
    const done = await Promise.all([readback(id), readback(id)]);
    assert.ok(done.every(item => item.status === 200)); assert.equal(rechecks.length, 1);
  });
  await group("retired legacy identity remains readable but cannot acquire a native task", async () => {
    await reset(); await seed();
    const made = await command({ action: "diagnosis_create", request_id: "11111111-1111-4111-8111-111111111111", platform: "binance", key: "default", target_id: targetId,
      trigger: "manual_check", observed_at: new Date().toISOString(), checks: {}, state_fingerprint: "historical",
      created_at: "2000-01-01T00:00:00Z", now: Date.now() });
    const attempt = await create(); assert.equal(attempt.body.request_id, made.task.request_id); assert.equal(posts(), 0);
    assert.equal((await readback(made.task.request_id)).status, 409);
  });
  await group("native submit does not require or reuse the old GitHub recheck credential", async () => {
    await reset({ extra: { RUNTIME_SETTINGS_DISPATCH_TOKEN: "" } }); await seed(); const made = await create();
    assert.equal(made.status, 202); complete(taskFor(made.body.request_id));
    const read = await readback(made.body.request_id); assert.equal(read.body.task.status, "succeeded");
    assert.equal(read.body.recheck_status, "unknown"); assert.equal(rechecks.length, 0);
  });
  await group("queued and running native obligations survive24h and changed fingerprints", async () => {
    for (const active of ["queued", "running"]) {
      await reset(); await seed(); const made = await create(), id = made.body.request_id;
      if (active === "running") { running(taskFor(id)); await readback(id); }
      const stored = await command({ action: "diagnosis_read", request_id: id });
      await command({ action: "diagnosis_native_save", request_id: id, native: stored.task.native,
        status: active, summary: "", reason_code: "", updated_at: "2000-01-01T00:00:00Z" });
      await seed({ guard: "attention" }); assert.equal((await create()).body.request_id, id); assert.equal(posts(), 1);
    }
  });
  await group("cancel intent survives unavailable lookup and late completion never adopts", async () => {
    await reset(); await seed(); loseSubmit = true; const made = await create(), id = made.body.request_id;
    loseLookup = true; assert.equal((await readback(id, "cancel")).status, 502);
    const held = await command({ action: "diagnosis_read", request_id: id });
    assert.equal(held.task.native.cancel_requested, true); assert.equal(held.task.native.cancel_sent, false);
    loseLookup = false; loseSubmit = false; complete(taskFor(id));
    assert.equal((await readback(id)).body.task.status, "unknown"); assert.equal(rechecks.length, 0);
    assert.equal(nativeCalls.filter(item => item.path.endsWith("/cancel")).length, 1);
    complete(taskFor(id)); assert.equal((await readback(id)).body.task.status, "unknown"); assert.equal(rechecks.length, 0);
    taskFor(id).status = "cancelled"; assert.equal((await readback(id)).body.task.status, "failed");
    assert.equal(nativeCalls.filter(item => item.path.endsWith("/cancel")).length, 1); assert.equal(posts(), 1);
  });
  await group("first durable terminal or cancel wins against stale saves and cancels", async () => {
    await reset(); await seed(); const made = await create(), id = made.body.request_id;
    const stale = (await command({ action: "diagnosis_read", request_id: id })).task;
    await readback(id, "cancel");
    const namespace = await mf.getDurableObjectNamespace("STRATEGY_SWITCH_RUNTIME_INSTANCES");
    const denied = await namespace.get(namespace.idFromName("runtime-instances")).fetch("https://fixture.invalid/", {
      method: "POST", body: JSON.stringify({ actor: "synthetic-state-fixture", action: "diagnosis_native_save", request_id: id,
        native: { ...stale.native, phase: "terminal", receipt: "stale-terminal" }, status: "succeeded", summary: "stale", reason_code: "diagnosis_ready", updated_at: new Date().toISOString() }) });
    assert.equal(denied.status, 409); assert.equal(rechecks.length, 0);
    await reset(); await seed(); const accepted = await create(), acceptedId = accepted.body.request_id;
    complete(taskFor(acceptedId)); await readback(acceptedId);
    const receipt = (await command({ action: "diagnosis_read", request_id: acceptedId })).task.native.receipt;
    const cancelled = await command({ action: "diagnosis_native_cancel", request_id: acceptedId, updated_at: new Date().toISOString() });
    assert.equal(cancelled.task.status, "succeeded"); assert.equal(cancelled.task.native.receipt, receipt);
    assert.equal(cancelled.send_cancel, false); assert.equal(rechecks.length, 1);
  });
  await group("redirect malformed and oversized acknowledgements hold without replay", async () => {
    for (const fault of [() => new Response(null, { status: 302, headers: { Location: "https://other.invalid" } }),
      () => new Response("{malformed"), () => new Response("x".repeat(65537))]) {
      await reset(); await seed(); replyFault = fault;
      const made = await create(); assert.equal(made.status, 502); assert.equal(posts(), 1);
      assert.equal((await create()).body.request_id, made.body.request_id); assert.equal(posts(), 1); assert.equal(rechecks.length, 0);
    }
  });
  await group("durable intent crossing deadline cannot perform its first POST", async () => {
    // Focused function boundary: stub only the durable command and clock, no network.
    const realNow = Date.now; let now = realNow(), frozen, transportCalls = 0;
    const actions = [];
    const fixtureTask = { request_id: "intent-deadline", platform: "binance", key: "default", target_id: targetId,
      trigger: "manual_check", observed_at: new Date(now).toISOString(), checks: {}, status: "queued" };
    const env = { ACCOUNT_DIAGNOSIS_NATIVE_BINDING_JSON: JSON.stringify(nativeBinding),
      ACCOUNT_DIAGNOSIS_NATIVE_TRANSPORT: { fetch() { transportCalls++; throw Error("must not call"); } },
      STRATEGY_SWITCH_RUNTIME_INSTANCES: { idFromName: name => name, get: () => ({ async fetch(_url, options) {
        const cmd = JSON.parse(options.body); actions.push(cmd.action);
        if (cmd.action === "diagnosis_read") return Response.json({ ok: true, task: fixtureTask });
        if (cmd.action === "diagnosis_native_intent") {
          frozen = cmd.native; now += 601000;
          return Response.json({ ok: true, created: true, task: { ...fixtureTask, native: frozen } });
        }
        assert.equal(cmd.action, "diagnosis_native_cancel");
        return Response.json({ ok: true, send_cancel: false, task: { ...fixtureTask, status: "unknown", native: { ...frozen, cancel_requested: true, phase: "hold" } } });
      } }) } };
    try {
      Date.now = () => now;
      assert.equal((await __test.dispatchAccountDiagnosis(env, fixtureTask.request_id)).task.status, "unknown");
      assert.equal(transportCalls, 0); assert.deepEqual(actions, ["diagnosis_read", "diagnosis_native_intent", "diagnosis_native_cancel"]);
    } finally { Date.now = realNow; }
  });
  const state = await call("/api/admin/runtime-instances"); assert.equal(state.body.revision, 0); assert.equal(state.body.initialized, false);
  console.log(JSON.stringify({ groups, result: "PASS", real_native_or_business_calls: 0, old_cli_dispatches: 0 }));
} finally {
  if (mf) await mf.dispose();
  if (persist) await rm(persist, { recursive: true, force: true });
}
