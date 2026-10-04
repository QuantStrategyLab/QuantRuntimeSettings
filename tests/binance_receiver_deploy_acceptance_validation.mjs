import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { verifyBinanceAccountFactsReceiver } from "../scripts/verify_binance_account_facts_receiver.mjs";

const workflow = readFileSync(new URL("../.github/workflows/deploy-strategy-switch-console.yml", import.meta.url), "utf8");
const manualWorkflow = readFileSync(new URL("../.github/workflows/verify-binance-account-facts-receiver.yml", import.meta.url), "utf8");
const runtimeInstallIndex = workflow.indexOf("npm ci --prefix web/strategy-switch-console\n");
const walletHistoryTestIndex = workflow.indexOf("tests/binance_account_facts_validation.mjs");
assert.ok(runtimeInstallIndex >= 0 && walletHistoryTestIndex > runtimeInstallIndex,
  "deployment installs the locked Worker test runtime before running the wallet history test");
const syncIndex = workflow.indexOf("- name: Sync optional Binance account-facts credentials");
const verifyIndex = workflow.indexOf("- name: Verify optional Binance account-facts receiver credentials");
assert.ok(syncIndex >= 0 && verifyIndex > syncIndex);
assert.match(workflow, /BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON: \$\{\{ secrets\.BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON \|\| '\[\]' \}\}/);
assert.match(workflow.slice(syncIndex, syncIndex + 900), /secret put BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON/);
assert.match(workflow, /assertBinanceFactsHistoryBindings/);
assert.match(workflow.slice(verifyIndex, verifyIndex + 320), /if: env\.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN != ''/);
assert.match(workflow.slice(verifyIndex, verifyIndex + 320), /scripts\/verify_binance_account_facts_receiver\.mjs/);
assert.match(manualWorkflow, /workflow_dispatch:/);
assert.match(manualWorkflow, /verify_receiver:[\s\S]{0,180}default: false/);
assert.match(manualWorkflow, /diagnosis_only:[\s\S]{0,180}default: false/);
assert.match(manualWorkflow, /inputs\.verify_receiver == true \|\| inputs\.diagnosis_only == true/);
assert.match(manualWorkflow, /BINANCE_ACCOUNT_FACTS_READINESS_ONLY: \$\{\{ inputs\.diagnosis_only \}\}/);
assert.doesNotMatch(manualWorkflow, /^\s+(?:push|schedule):/m);
assert.match(manualWorkflow, /environment: runtime-strategy-switch/);
assert.match(manualWorkflow, /STRATEGY_SWITCH_CONSOLE_URL: \$\{\{ vars\.STRATEGY_SWITCH_CONSOLE_URL \}\}/);
assert.match(manualWorkflow, /BINANCE_ACCOUNT_FACTS_SYNC_TOKEN: \$\{\{ secrets\.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN \}\}/);
assert.match(manualWorkflow, /EXPECTED_MAIN_SHA: \$\{\{ inputs\.expected_main_sha \}\}/);
assert.match(manualWorkflow, /git fetch --quiet --no-tags origin main/);
assert.doesNotMatch(manualWorkflow, /wrangler|secret put|kv key put|wrangler deploy/i);
assert.match(manualWorkflow, /group: strategy-switch-console-deploy/);

let calls = [];
const skipped = await verifyBinanceAccountFactsReceiver({
  consoleUrl: "https://console.example",
  token: "",
  fetchImpl: async (...args) => { calls.push(args); throw new Error("must not call"); },
});
assert.deepEqual(skipped, { status: "skipped" });
assert.equal(calls.length, 0);

const token = "synthetic-token-never-print";
const verified = await verifyBinanceAccountFactsReceiver({
  consoleUrl: "https://console.example/",
  token,
  fetchImpl: async (...args) => {
    calls.push(args);
  return new Response(JSON.stringify({ ok: false, error: "invalid_binance_account_facts" }), { status: 400 });
  },
});
assert.deepEqual(verified, { status: "verified", httpStatus: 400 });
assert.equal(calls.length, 1);
assert.equal(calls[0][0], "https://console.example/api/internal/binance-account-facts");
assert.equal(calls[0][1].method, "POST");
assert.equal(calls[0][1].body, "{}");
assert.equal(calls[0][1].redirect, "manual");
assert.equal(calls[0][1].headers.Authorization, `Bearer ${token}`);
assert.equal(calls[0][1].signal.aborted, false);

calls = [];
const readinessBody = { ok: true, ready: true, binding_valid: true, account_options_readable: true, unique_match: true };
const diagnosis = await verifyBinanceAccountFactsReceiver({
  consoleUrl: "https://console.example", token, readinessOnly: true,
  fetchImpl: async (...args) => {
    calls.push(args);
    return new Response(JSON.stringify(readinessBody), { status: 200 });
  },
});
assert.deepEqual(diagnosis, {
  status: "ready", bindingValid: true, accountOptionsReadable: true, uniqueMatch: true,
});
assert.equal(calls.length, 1, "readiness diagnosis makes exactly one request");
assert.equal(calls[0][1].method, "GET");
assert.equal(calls[0][1].body, undefined);
assert.equal(calls[0][1].redirect, "manual");
assert.equal(calls[0][1].headers.Authorization, `Bearer ${token}`);

calls = [];
await assert.rejects(verifyBinanceAccountFactsReceiver({
  consoleUrl: "https://console.example", token, readinessOnly: true,
  fetchImpl: async (...args) => {
    calls.push(args);
    return new Response(JSON.stringify({ ok: false, ready: false, binding_valid: true,
      account_options_readable: false, unique_match: false,
      error: "binance_account_facts_account_options_unavailable" }), { status: 503 });
  },
}), error => error.category === "account_options_unavailable" && error.httpStatus === 503);
assert.equal(calls.length, 1, "failed readiness diagnosis is not retried");
assert.equal(calls[0][1].method, "GET", "failed readiness diagnosis never falls through to POST");

for (const [response, category, status] of [
  [new Response(JSON.stringify({ ok: false, error: "binance_account_facts_token_invalid" }), { status: 401 }), "token_invalid", 401],
  [new Response(JSON.stringify({ ok: false, error: "binance_account_facts_binding_unmatched" }), { status: 409 }), "binding_unmatched", 409],
  [new Response(JSON.stringify({ ok: false, error: "binance_account_facts_binding_missing" }), { status: 503 }), "config_or_binding", 503],
  [new Response(JSON.stringify({ ok: false, error: "binance_account_facts_account_options_unavailable" }), { status: 503 }), "account_options_unavailable", 503],
  [new Response(JSON.stringify({ ok: false, error: "binance_account_facts_storage_unavailable" }), { status: 503 }), "unknown", 503],
  [new Response(JSON.stringify({ ok: false, error: "proxy_upstream_unavailable" }), { status: 503 }), "unknown", 503],
  [new Response("synthetic private body", { status: 404 }), "route_not_found", 404],
  [new Response(JSON.stringify({ ok: false, error: "invalid_binance_account_facts" }), { status: 302 }), "redirect", 302],
  [new Response(JSON.stringify({ ok: false, error: "invalid_account_facts" }), { status: 400 }), "unknown", 400],
  [new Response("synthetic private body", { status: 400 }), "unknown", 400],
]) {
  const failedCalls = [];
  await assert.rejects(
    verifyBinanceAccountFactsReceiver({ consoleUrl: "https://console.example", token,
      fetchImpl: async (...args) => { failedCalls.push(args); return response; } }),
    error => error.category === category && error.httpStatus === status
      && error.message === category
      && !error.message.includes(token) && !error.message.includes("synthetic private body"),
  );
  assert.equal(failedCalls.length, 1);
  assert.equal(failedCalls[0][1].method, "POST");
  assert.equal(failedCalls[0][1].body, "{}");
}

calls = [];
await assert.rejects(
  verifyBinanceAccountFactsReceiver({ consoleUrl: "https://console.example", token,
    fetchImpl: async (...args) => { calls.push(args); throw new Error("sensitive transport details"); } }),
  error => error.category === "transport" && error.httpStatus === null
    && !error.message.includes(token),
);
assert.equal(calls.length, 1, "transport failure is not retried");

calls = [];
await assert.rejects(
  verifyBinanceAccountFactsReceiver({ consoleUrl: "https://console.example", token, timeoutMs: 1,
    fetchImpl: async (...args) => {
      calls.push(args);
      assert.ok(args[1].signal instanceof AbortSignal);
      throw new DOMException("timeout", "TimeoutError");
    } }),
  error => error.category === "transport" && error.httpStatus === null
    && !error.message.includes(token),
);
assert.equal(calls.length, 1, "timeout is not retried");

for (const consoleUrl of ["http://console.example", "https://user:pass@console.example", "not a URL"]) {
  await assert.rejects(
    verifyBinanceAccountFactsReceiver({ consoleUrl, token, fetchImpl: async () => { throw new Error("must not call"); } }),
    error => error.category === "configuration_invalid",
  );
}

// An injected monotonic clock and cancellable scheduler keep these probes local,
// deterministic and fast. No real request, credential or wall-clock sleep is used.
class FakeClock {
  time = 0;
  nextId = 0;
  timers = new Map();
  listeners = 0;
  now = () => this.time;
  setTimeout = (callback, ms) => {
    const id = ++this.nextId;
    this.timers.set(id, { callback, at: this.time + ms });
    return id;
  };
  clearTimeout = id => this.timers.delete(id);
  consume(ms) { this.time += ms; }
  delay = (ms, { signal }) => new Promise((resolve, reject) => {
    const cleanup = () => {
      this.clearTimeout(id);
      signal.removeEventListener("abort", abort);
      this.listeners -= 1;
    };
    const abort = () => { cleanup(); reject(signal.reason); };
    const id = this.setTimeout(() => { cleanup(); resolve(); }, ms);
    this.listeners += 1;
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  runNext() {
    const [id, timer] = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
    this.timers.delete(id);
    this.time = Math.max(this.time, timer.at);
    timer.callback();
  }
}
const transientBody = { ok: false, ready: false, binding_valid: true,
  account_options_readable: false, unique_match: false,
  error: "binance_account_facts_account_options_unavailable" };
const readyProbe = () => ({ status: 200, body: readinessBody });
const transientProbe = () => ({ status: 503, body: transientBody });
const never = () => new Promise(() => {});

async function runGate(probes, overrides = {}) {
  const clock = new FakeClock();
  const requests = [];
  const logs = [];
  const sleeps = [];
  let settled = false;
  let result;
  let error;
  const promise = verifyBinanceAccountFactsReceiver({
    consoleUrl: "https://console.example/", token, deploymentReadiness: true,
    nowImpl: clock.now, setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout,
    delayImpl: (ms, options) => { sleeps.push(ms); return clock.delay(ms, options); },
    logImpl: entry => { logs.push(entry); overrides.onLog?.(entry, clock); },
    fetchImpl: async (...args) => {
      const request = { args, at: clock.time, bodyReads: 0, abortSeen: false };
      requests.push(request);
      args[1].signal.addEventListener("abort", () => { request.abortSeen = true; }, { once: true });
      const probe = probes[requests.length - 1];
      assert.ok(probe, "the gate must not make an unplanned request");
      assert.equal(args[1].method, "GET");
      if (probe.fetchError) throw probe.fetchError;
      if (probe.ignoreFetchAbort) return await never();
      clock.consume(probe.fetchMs || 0);
      return {
        status: probe.status,
        headers: new Headers(probe.headers),
        text: async () => {
          request.bodyReads += 1;
          if (probe.ignoreBodyAbort) return await never();
          clock.consume(probe.bodyMs || 0);
          return probe.text ?? JSON.stringify(probe.body);
        },
      };
    },
    ...overrides.options,
  });
  promise.then(value => { result = value; settled = true; }, failure => { error = failure; settled = true; });
  for (let turn = 0; turn < 100 && !settled; turn += 1) {
    // Drain promise continuations before advancing the fake timer queue.
    for (let tick = 0; tick < 30; tick += 1) await Promise.resolve();
    if (!settled && clock.timers.size) clock.runNext();
  }
  assert.ok(settled, "an abort-ignoring dependency must not hang the gate");
  assert.equal(clock.timers.size, 0, "every terminal path clears its watchdog and delay timers");
  assert.equal(clock.listeners, 0, "every terminal path cleans up delay abort listeners");
  for (const { args, abortSeen } of requests) {
    assert.equal(args[0], "https://console.example/api/internal/binance-account-facts");
    assert.equal(args[1].method, "GET");
    assert.equal(args[1].body, undefined);
    assert.equal(args[1].redirect, "manual");
    assert.deepEqual(args[1].headers, { Authorization: `Bearer ${token}` });
    assert.ok(args[1].signal instanceof AbortSignal);
    assert.equal(args[1].signal.aborted, true, "completed/failed requests release their response stream");
    assert.equal(abortSeen, true, "fetch/body cancellation listeners are notified on every outcome");
    assert.doesNotMatch(String(args[1].signal.reason), /private-exception|private-body|synthetic-token-never-print/);
  }
  for (const entry of logs) {
    assert.deepEqual(Object.keys(entry).sort(), ["attempt", "category", "consecutiveReady", "elapsedMs", "httpStatus"].sort());
    assert.ok(Number.isInteger(entry.attempt) && entry.attempt >= 1 && entry.attempt <= 4);
    assert.ok(Number.isInteger(entry.elapsedMs) && entry.elapsedMs >= 0);
    assert.ok(Number.isInteger(entry.consecutiveReady) && entry.consecutiveReady >= 0 && entry.consecutiveReady <= 2);
    assert.ok(["ready", "token_invalid", "binding_unmatched", "config_or_binding", "route_not_found",
      "account_options_unavailable", "redirect", "unknown", "transport", "configuration_invalid",
      "forbidden", "challenge", "request_timeout", "budget_exhausted", "attempts_exhausted"].includes(entry.category));
    assert.ok(entry.httpStatus === null || (Number.isInteger(entry.httpStatus) && entry.httpStatus >= 100 && entry.httpStatus <= 599));
    assert.doesNotMatch(JSON.stringify(entry), /synthetic-token-never-print|console\.example|private-body|private-exception/);
  }
  if (error) {
    assert.equal(error.message, error.category);
    assert.doesNotMatch(error.message, /synthetic-token-never-print|console\.example|private-body|private-exception/);
  }
  return { result, error, requests, logs, sleeps, clock };
}
function fatal(gate, category, status, count = 1) {
  assert.equal(gate.result, undefined);
  assert.equal(gate.error?.category, category);
  assert.equal(gate.error?.httpStatus, status);
  assert.equal(gate.requests.length, count, "fatal failures must not retry or fall through to POST");
}

for (const probes of [
  [readyProbe(), readyProbe()],
  [transientProbe(), readyProbe(), readyProbe()],
  [readyProbe(), transientProbe(), readyProbe(), readyProbe()],
]) {
  const gate = await runGate(probes);
  assert.equal(gate.error, undefined);
  assert.deepEqual(gate.result, { status: "stable", attempts: probes.length });
  assert.equal(gate.requests.length, probes.length);
  assert.deepEqual(gate.sleeps, Array(probes.length - 1).fill(5_000));
  for (let index = 1; index < gate.requests.length; index += 1) {
    assert.ok(gate.requests[index].at - gate.requests[index - 1].at >= 5_000);
  }
  assert.deepEqual(gate.logs.filter(entry => entry.category === "ready").map(entry => entry.consecutiveReady),
    probes.length === 4 ? [1, 1, 2] : [1, 2]);
}
fatal(await runGate(Array.from({ length: 4 }, transientProbe)), "attempts_exhausted", 503, 4);
fatal(await runGate([transientProbe(), transientProbe(), transientProbe(), readyProbe()]), "attempts_exhausted", 200, 4);

// Each exact field and its primitive type matters on both eligible shapes.
for (const key of Object.keys(readinessBody)) {
  for (const value of [false, "true", 1, null]) {
    fatal(await runGate([{ status: 200, body: { ...readinessBody, [key]: value } }]), "unknown", 200);
  }
  const missing = { ...readinessBody };
  delete missing[key];
  fatal(await runGate([{ status: 200, body: missing }]), "unknown", 200);
}
fatal(await runGate([{ status: 200, body: { ...readinessBody, extra: true } }]), "unknown", 200);
fatal(await runGate([{ status: 200, body: transientBody }]), "unknown", 200);
for (const key of Object.keys(transientBody)) {
  const variants = key === "error" ? ["other_error", null] : [!transientBody[key], String(transientBody[key]), 0, null];
  const missing = { ...transientBody };
  delete missing[key];
  for (const body of [...variants.map(value => ({ ...transientBody, [key]: value })), missing]) {
    const category = body.ok === false && body.error === transientBody.error ? "account_options_unavailable" : "unknown";
    fatal(await runGate([{ status: 503, body }]), category, 503);
  }
}
fatal(await runGate([{ status: 503, body: { ...transientBody, extra: false } }]), "account_options_unavailable", 503);
for (const [status, body, category] of [
  [401, { ok: false, error: "binance_account_facts_token_invalid" }, "token_invalid"],
  [403, readinessBody, "forbidden"],
  ...[301, 302, 307, 308].map(status => [status, readinessBody, "redirect"]),
  [404, readinessBody, "route_not_found"],
  [409, { ok: false, error: "binance_account_facts_binding_unmatched" }, "binding_unmatched"],
  ...["binance_account_facts_token_unavailable", "binance_account_facts_binding_missing", "binance_account_facts_binding_invalid"]
    .map(error => [503, { ok: false, error }, "config_or_binding"]),
  [503, { ok: false, error: "binance_account_facts_storage_unavailable" }, "unknown"],
  [503, { ok: false, error: "proxy_upstream_unavailable" }, "unknown"],
  [500, readinessBody, "unknown"],
]) fatal(await runGate([{ status, body }]), category, status);
for (const [status, category] of [[401, "token_invalid"], [403, "forbidden"], [302, "redirect"], [404, "route_not_found"]]) {
  const gate = await runGate([{ status, ignoreBodyAbort: true }]);
  fatal(gate, category, status);
  assert.equal(gate.requests[0].bodyReads, 0, "fatal headers cancel an unread body without waiting for its reader");
  assert.equal(gate.clock.time, 0);
}
for (const status of [200, 503]) {
  for (const text of ["private-body", "<html>private-body challenge</html>", "{}", "[]", "null", "x".repeat(2049)]) {
    fatal(await runGate([{ status, text }]), "unknown", status);
  }
  const challenged = await runGate([{ status, body: status === 200 ? readinessBody : transientBody,
    headers: { "cf-mitigated": " Challenge " }, ignoreBodyAbort: true }]);
  fatal(challenged, "challenge", status);
  assert.equal(challenged.requests[0].bodyReads, 0);
}
fatal(await runGate([{ fetchError: new Error("private-exception") }]), "transport", null);
fatal(await runGate([{ fetchError: new DOMException("private-exception", "TimeoutError") }]), "request_timeout", null);
for (const probe of [{ ignoreFetchAbort: true }, { ...readyProbe(), ignoreBodyAbort: true }]) {
  const gate = await runGate([probe]);
  fatal(gate, "request_timeout", probe.status ?? null);
  assert.equal(gate.clock.time, 15_000);
  assert.equal(gate.requests[0].args[1].signal.aborted, true);
}
for (const probe of [{ ...readyProbe(), fetchMs: 15_000 }, { ...readyProbe(), bodyMs: 15_000 },
  { ...readyProbe(), fetchMs: 8_000, bodyMs: 8_000 }]) {
  fatal(await runGate([probe]), "request_timeout", 200);
}
// Four slow (but individually valid) probes plus logging overhead reach the
// absolute deadline. A last ready, parsing overrun, sleep or stalled fetch
// must not create a stable result or a later request.
const slow = () => ({ ...transientProbe(), fetchMs: 14_000 });
let overhead = [1_000, 1_000, 1_000, 1_000];
let gate = await runGate([slow(), slow(), slow(), { ...readyProbe(), fetchMs: 14_000 }], {
  onLog: (entry, clock) => { if (["ready", "account_options_unavailable"].includes(entry.category)) clock.consume(overhead.shift() || 0); },
});
fatal(gate, "budget_exhausted", 200, 4);
assert.equal(gate.clock.time, 75_000);
gate = await runGate([{ ...readyProbe(), bodyMs: 75_000 }]);
fatal(gate, "budget_exhausted", 200);
overhead = [11_000, 11_000, 0];
gate = await runGate([slow(), slow(), slow()], {
  onLog: (entry, clock) => { if (entry.category === "account_options_unavailable") clock.consume(overhead.shift() || 0); },
});
fatal(gate, "budget_exhausted", 503, 3);
assert.equal(gate.clock.time, 75_000);
assert.deepEqual(gate.sleeps, [5_000, 5_000, 5_000]);
overhead = [8_000, 8_000, 1_000];
gate = await runGate([slow(), slow(), slow(), { ignoreFetchAbort: true }], {
  onLog: (entry, clock) => { if (entry.category === "account_options_unavailable") clock.consume(overhead.shift() || 0); },
});
fatal(gate, "budget_exhausted", null, 4);
assert.equal(gate.requests[3].at, 74_000);
assert.equal(gate.clock.time, 75_000, "last request uses the smaller remaining budget, not a fresh 15s cap");
overhead = [8_000, 8_000, 1_000];
gate = await runGate([slow(), slow(), slow(), { ...readyProbe(), ignoreBodyAbort: true }], {
  onLog: (entry, clock) => { if (entry.category === "account_options_unavailable") clock.consume(overhead.shift() || 0); },
});
fatal(gate, "budget_exhausted", 200, 4);
assert.equal(gate.clock.time, 75_000, "body readers share the remaining absolute budget");
gate = await runGate([readyProbe(), readyProbe()], {
  onLog: (entry, clock) => { if (entry.consecutiveReady === 2) clock.consume(70_000); },
});
fatal(gate, "budget_exhausted", 200, 2);
gate = await runGate([readyProbe()], { options: { delayImpl: never },
  onLog: (entry, clock) => { if (entry.category === "ready") clock.consume(69_000); },
});
fatal(gate, "budget_exhausted", 200);
assert.equal(gate.clock.time, 75_000, "even an abort-ignoring delay cannot outlive the overall deadline");
gate = await runGate([readyProbe()], { onLog: (entry, clock) => { if (entry.category === "ready") clock.consume(75_000); } });
fatal(gate, "budget_exhausted", 200);
assert.deepEqual(gate.sleeps, [], "no sleep or new request starts after the deadline");

gate = await runGate([readyProbe()], { options: { delayImpl: async () => {} } });
fatal(gate, "configuration_invalid", 200);
assert.equal(gate.clock.time, 0, "an early delay completion never permits another GET");
gate = await runGate([readyProbe()], { onLog: (entry, clock) => { if (entry.category === "ready") clock.consume(-1); } });
fatal(gate, "configuration_invalid", 200);
fatal(await runGate([], { options: { readinessOnly: true } }), "configuration_invalid", null, 0);
for (const timeoutMs of [0, -1, NaN, Infinity]) {
  fatal(await runGate([], { options: { timeoutMs } }), "configuration_invalid", null, 0);
}
for (const timeoutMs of [1, 30_000]) {
  gate = await runGate([{ ignoreFetchAbort: true }], { options: { timeoutMs } });
  fatal(gate, "request_timeout", null);
  assert.equal(gate.clock.time, Math.min(15_000, timeoutMs), "request caps cannot be raised above 15s");
}

for (const consoleUrl of ["http://console.example", "https://user:pass@console.example", "not a URL",
  "https://console.example?private-body", "https://console.example#private-body"]) {
  fatal(await runGate([], { options: { consoleUrl } }), "configuration_invalid", null, 0);
}
for (const missingToken of ["", undefined, null]) {
  gate = await runGate([], { options: { token: missingToken } });
  assert.deepEqual(gate.result, { status: "skipped" });
  assert.equal(gate.requests.length, 0);
  assert.deepEqual(gate.sleeps, []);
}

const gateIndex = workflow.indexOf("- name: Wait for optional Binance account-facts readiness stability");
const m0Index = workflow.indexOf("- name: Sync M0 research-ledger ingress token");
const catalogIndex = workflow.indexOf("- name: Check whether this release changes the strategy catalog");
const publishIndex = workflow.indexOf("- name: Sync bundled strategy profiles to KV");
assert.ok(syncIndex < m0Index && m0Index < gateIndex && gateIndex < verifyIndex && verifyIndex < catalogIndex && catalogIndex < publishIndex,
  "all secret sync, including M0, precedes the gate, retained single POST, then catalog publication");
const gateStep = workflow.slice(gateIndex, verifyIndex);
assert.match(gateStep, /if: env\.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN != ''/);
assert.match(gateStep, /BINANCE_ACCOUNT_FACTS_DEPLOYMENT_READINESS: "true"/);
assert.match(gateStep, /run: node scripts\/verify_binance_account_facts_receiver\.mjs/);
assert.doesNotMatch(workflow.slice(gateIndex), /secret put|continue-on-error:|always\(\)/);
assert.doesNotMatch(workflow.slice(verifyIndex, catalogIndex), /BINANCE_ACCOUNT_FACTS_(?:DEPLOYMENT_READINESS|READINESS_ONLY)|for attempt|while |retry/);
assert.equal((workflow.match(/node tests\/binance_receiver_deploy_acceptance_validation\.mjs/g) || []).length, 1);
const validateWorkflow = readFileSync(new URL("../.github/workflows/validate.yml", import.meta.url), "utf8");
assert.equal((validateWorkflow.match(/node tests\/binance_receiver_deploy_acceptance_validation\.mjs/g) || []).length, 1);
// Local Miniflare tests use its built-in synthetic Request.cf fallback. The
// supported switch must remain test-step-scoped, never a production job env.
for (const [text, name] of [[workflow, "Build new console and embedded assets"],
  [validateWorkflow, "Validate strategy switch web assets"]]) {
  const start = text.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0);
  const next = text.indexOf("\n      - name:", start + 1);
  const step = text.slice(start, next < 0 ? text.length : next);
  assert.match(step, /\n        env:\n          CLOUDFLARE_CF_FETCH_ENABLED: "false"\n/);
  assert.match(step, /\n          npm_config_update_notifier: "false"\n/);
  for (const flag of ["CLOUDFLARE_CF_FETCH_ENABLED", "npm_config_update_notifier"]) {
    assert.equal(text.split(flag).length - 1, 1,
      "synthetic cf metadata and npm configuration are confined to the named build/test step");
  }
}
let miniflareTestFiles = 0;
for (const name of readdirSync(new URL(".", import.meta.url)).filter(name => name.endsWith(".mjs"))) {
  const text = readFileSync(new URL(name, import.meta.url), "utf8");
  if (!/new\s+\w*Miniflare\s*\(/.test(text)) continue;
  miniflareTestFiles += 1;
  assert.doesNotMatch(text, /(?:\bcf|["']cf["'])\s*:|\.cf\s*=|\[\s*["']cf["']\s*\]\s*=/,
    `${name} must not explicitly override the offline synthetic cf option`);
}
assert.ok(miniflareTestFiles > 0, "the offline contract covers the existing Miniflare suites");
assert.equal(createHash("sha256").update(manualWorkflow).digest("hex"),
  "53831dd8b58be667a244f046aeba7a758961ed812d31494e4ad4468e11045981",
  "manual diagnostic workflow stays byte-for-byte unchanged");
console.log("Binance receiver deployment acceptance: retained single POST/manual GET, exact bounded stability and workflow gates PASS");
