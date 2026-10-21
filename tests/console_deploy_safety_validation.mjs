import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/deploy-strategy-switch-console.yml", import.meta.url), "utf8");
const triggers = workflow.slice(workflow.indexOf("\non:\n"), workflow.indexOf("\npermissions:"));
assert.deepEqual([...triggers.matchAll(/^  (\w+):/gm)].map(match => match[1]), ["workflow_dispatch"], "merges must not deploy");
for (const input of ["sync_secrets", "sync_strategy_profiles", "read_only_preflight", "skip_binance_receiver_checks"]) {
  const block = triggers.match(new RegExp(`      ${input}:\\n([\\s\\S]*?)(?=\\n      \\w+:|$)`))?.[1];
  assert.ok(block, input);
  assert.match(block, /type: boolean/);
  assert.match(block, /default: false/);
}
const steps = workflow.split(/\n      - name: /).slice(1);
const writers = steps.filter(step => /\bsecret put\b|\/api\/internal\/sync-strategy-profiles/.test(step));
assert.equal(writers.length, 16, "inspect every secret and profile writer");
for (const step of writers) {
  const name = step.split("\n")[0];
  const gate = step.match(/^        if: (.+)$/m)?.[1];
  assert.ok(gate, `${name} requires a gate`);
  assert.match(gate, /github\.event_name == 'workflow_dispatch'/, name);
  const input = step.includes("secret put") ? "sync_secrets" : "sync_strategy_profiles";
  assert.match(gate, new RegExp(`inputs\\.${input}\\b`), name);
  for (const event of ["push", "workflow_dispatch"]) {
    for (const optedIn of [false, true]) {
      const expression = gate.replaceAll("github.event_name", JSON.stringify(event))
        .replaceAll(`inputs.${input}`, String(optedIn))
        .replace(/env\.[A-Z0-9_]+/g, "'github_actions'");
      assert.match(expression, /^[\w\s'"=!&|().-]+$/, "only the known gate grammar is evaluated");
      assert.equal(Function(`return (${expression})`)(), event === "workflow_dispatch" && optedIn, `${name}: ${event}, ${input}=${optedIn}`);
    }
  }
}
assert.doesNotMatch(workflow, /catalog-change|steps\.catalog/);

const preflight = workflow.match(/^  preflight:\n([\s\S]*?)(?=^  deploy:)/m)?.[1];
const deploy = workflow.match(/^  deploy:\n([\s\S]*)$/m)?.[1];
assert.ok(preflight && deploy, "reader and deployment have separate jobs");
function evaluate(gate, inputs = {}, token = "configured", event = "workflow_dispatch") {
  const expression = gate.replaceAll("github.event_name", JSON.stringify(event))
    .replace(/inputs\.(\w+)/g, (_, key) => String(inputs[key] ?? false))
    .replaceAll("env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN", JSON.stringify(token));
  assert.match(expression, /^[\w\s'"=!&|().-]+$/);
  return Function(`return (${expression})`)();
}
const preflightGate = preflight.match(/^    if: (.+)$/m)?.[1];
const deployGate = deploy.match(/^    if: (.+)$/m)?.[1];
for (const event of ["push", "workflow_dispatch"]) {
  for (const read_only_preflight of [false, true]) {
    assert.equal(evaluate(preflightGate, { read_only_preflight }, "", event), event === "workflow_dispatch" && read_only_preflight);
    assert.equal(evaluate(deployGate, { read_only_preflight }, "", event), event === "workflow_dispatch" && !read_only_preflight);
  }
}
const binanceChecks = [
  "Wait for optional Binance account-facts readiness stability",
  "Verify optional Binance account-facts receiver credentials",
];
const skipGates = steps.filter(step => /inputs\.skip_binance_receiver_checks/.test(step));
assert.deepEqual(skipGates.map(step => step.split("\n")[0]), binanceChecks, "only these two network checks may be skipped");
for (const step of skipGates) {
  const gate = step.match(/^        if: (.+)$/m)?.[1];
  for (const skip_binance_receiver_checks of [false, true]) {
    for (const token of ["", "configured"]) {
      assert.equal(evaluate(gate, { skip_binance_receiver_checks }, token), !skip_binance_receiver_checks && token !== "");
    }
  }
}
assert.match(deploy, /- name: Validate optional Binance account-facts binding\n        if: env\.BINANCE_ACCOUNT_FACTS_BINDING_JSON != ''/);
assert.match(deploy, /node tests\/binance_receiver_deploy_acceptance_validation\.mjs/);
assert.match(deploy, /name: Build new console and embedded assets/);
assert.match(deploy, /npx wrangler@4\.106\.0 deploy --config wrangler\.toml/);
assert.match(preflight, /environment: runtime-strategy-switch/);
assert.doesNotMatch(preflight, /secret put|sync-strategy-profiles|wrangler.*deploy|npm|npx|uses: actions\/checkout|SYNC_TOKEN|WRANGLER_CONFIG/);
assert.deepEqual([...preflight.matchAll(/^      ([A-Z_]+):/gm)].map(match => match[1]), ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);

// Execute the exact workflow body with fake HTTP, not a rewritten projection.
const script = preflight.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n          JS/)?.[1]
  ?.split("\n").map(line => line.slice(10)).join("\n");
assert.ok(script);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction("process", "fetch", "console", script);
const versionId = "c88234c2-292a-40d4-b624-500f145e3f7d";
const deploymentId = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-10-17T04:58:15.5561237Z";
const sentinel = "PRIVATE_SENTINEL_DO_NOT_OUTPUT";
const deployment = { id: deploymentId, created_on: timestamp, strategy: "percentage",
  versions: [{ version_id: versionId, percentage: 100 }], author_email: sentinel,
  annotations: { "workers/message": sentinel }, unknown: { secret: sentinel } };
const version = { id: versionId, metadata: { created_on: timestamp, author_email: sentinel }, resources: { bindings: [sentinel] } };
const normal = [{ success: true, result: { deployments: [deployment] } }, { success: true, result: { items: [version] } }];
let cases = 0;
async function execute(responses = normal, envDelta = {}) {
  const calls = [], stdout = [], stderr = [];
  const process = { env: { CLOUDFLARE_API_TOKEN: sentinel, CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), ...envDelta }, exitCode: 0 };
  await run(process, async (url, options) => {
    calls.push({ url, method: options.method });
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Bearer ${sentinel}`);
    assert.ok(options.signal instanceof AbortSignal);
    const response = responses[calls.length - 1];
    if (response instanceof Error) throw response;
    if (response instanceof Response) return response;
    assert.ok(calls.length <= responses.length, "no retry or page expansion");
    return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
  }, { log: value => stdout.push(value), error: value => stderr.push(value) });
  cases++;
  assert.ok(!JSON.stringify({ stdout, stderr }).includes(sentinel), "neither response nor auth/error text may escape");
  return { process, calls, stdout, stderr };
}
const success = await execute();
assert.equal(success.process.exitCode, 0);
assert.deepEqual(success.calls, [
  { url: `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/workers/scripts/qsl-strategy-switch-console/deployments?page=1&per_page=10`, method: "GET" },
  { url: `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/workers/scripts/qsl-strategy-switch-console/versions?page=1&per_page=10`, method: "GET" },
]);
assert.deepEqual(JSON.parse(success.stdout[0]), {
  ok: true, worker: "qsl-strategy-switch-console", read_only: true,
  active: { id: deploymentId, created_on: timestamp, versions: [{ version_id: versionId, percentage: 100 }] },
  recent_deployments: [{ id: deploymentId, created_on: timestamp, versions: [{ version_id: versionId, percentage: 100 }] }],
  recent_versions: [{ id: versionId, created_on: timestamp }],
  active_versions_in_first_version_page: true, rollback_compatibility: "NOT_VERIFIED", next_pages_read: false,
});
async function failure(responses, envDelta, expectedCalls = 1) {
  const result = await execute(responses, envDelta);
  assert.equal(result.process.exitCode, 1);
  assert.equal(result.stdout.length, 0, "no partial success output");
  assert.equal(result.stderr.length, 1, "one bounded diagnostic only");
  const last = responses[expectedCalls - 1];
  const error = JSON.parse(result.stderr[0]);
  assert.deepEqual({ ok: error.ok, error: error.error, stage: error.stage, http_status: error.http_status }, { ok: false, error: "worker_preflight_failed",
    stage: ["configuration", "deployments", "versions"][expectedCalls],
    http_status: expectedCalls === 0 || last instanceof Error ? null : last instanceof Response ? last.status : 200,
  });
  assert.match(error.checkpoint, /^[a-z0-9_]{1,40}$/, "a fixed checkpoint identifies the failing contract without exception text");
  assert.ok(error.response_shape && typeof error.response_shape === "object");
  assert.equal(result.calls.length, expectedCalls);
  return error;
}
await failure(normal, { CLOUDFLARE_API_TOKEN: "" }, 0);
await failure(normal, { CLOUDFLARE_ACCOUNT_ID: "../" + sentinel }, 0);
await failure([new Error(sentinel)]);
await failure([new Response(sentinel, { status: 403 })]);
await failure([new Response(sentinel, { status: 302, headers: { location: "https://example.invalid/" } })]);
await failure([new Response(sentinel, { headers: { "content-type": "text/html" } })]);
await failure([new Response("{", { headers: { "content-type": "application/json" } })]);
await failure([{ success: false, errors: [{ message: sentinel }] }]);
await failure([{ success: true, result: { deployments: [] } }]);
await failure([{ success: true, result: { deployments: Array(11).fill(deployment) } }]);
await failure([{ success: true, result: { deployments: [{ ...deployment, id: sentinel }] } }]);
await failure([{ success: true, result: { deployments: [{ ...deployment, created_on: sentinel }] } }]);
await failure([{ success: true, result: { deployments: [{ ...deployment, versions: [{ version_id: versionId, percentage: 99 }] }] } }]);
await failure([{ success: true, result: { deployments: [{ ...deployment, versions: [deployment.versions[0], deployment.versions[0]] }] } }]);
await failure([new Response(" ".repeat(65537), { headers: { "content-type": "application/json" } })]);
await failure([new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } })]);
await failure([new Response(new ReadableStream({ start(controller) { controller.error(new Error(sentinel)); } }), { headers: { "content-type": "application/json" } })]);
await failure([normal[0], new Error(sentinel)], {}, 2);
await failure([normal[0], { success: true, result: { items: [{ ...version, id: sentinel }] } }], {}, 2);
const noRecentVersion = await execute([normal[0], { success: true, result: { items: [] } }]);
assert.equal(JSON.parse(noRecentVersion.stdout[0]).active_versions_in_first_version_page, false, "a missing page witness must not be invented or trigger pagination");
const gradual = await execute([{ success: true, result: { deployments: [{ ...deployment, versions: [
  { version_id: versionId, percentage: 60 }, { version_id: deploymentId, percentage: 40 },
] }] } }, normal[1]]);
assert.equal(JSON.parse(gradual.stdout[0]).active.versions.length, 2, "preserve split traffic, never infer a single rollback");

// Minimal projections of the provider's published 200 examples, not a live response.
// https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/
// https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/list/
const officialExamples = await execute([
  { success: true, result: { deployments: [{ id: "182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e", created_on: "2019-12-27T18:11:19.117Z",
    versions: [{ version_id: "023e105f-2a42-4f8b-a1c1-73f6a2a30c0f", percentage: 100 }] }] } },
  { success: true, result: { items: [{ id: "18f97339-c287-4872-9bdd-e2135c07ec12", metadata: { created_on: "2022-11-08T17:19:29.176266Z" } }] } },
]);
assert.equal(officialExamples.process.exitCode, 0);
// The documented date-time format includes numeric offsets (RFC 3339 section 5.6).
for (const dateTime of ["2026-10-17T12:58:15.5561237+08:00", "2026-10-16t23:28:15.5561237-05:30", "2026-10-17t04:58:15z"]) {
  const result = await execute([{ success: true, result: { deployments: [{ ...deployment, created_on: dateTime }] } }, normal[1]]);
  assert.equal(result.process.exitCode, 0, "valid explicit offsets must not fail a UTC-only regex");
  assert.equal(JSON.parse(result.stdout[0]).active.created_on, dateTime, "retain original precision and offset");
}
for (const bad of [null, {}, "2026-02-30T00:00:00Z", "2025-02-29T00:00:00+01:00", "2026-10-17T24:00:00Z", "2026-10-17T04:58:15+24:00", "2026-10-17T04:58:15+08:60", "2026-10-17T04:58:15Z\n"]) {
  const error = await failure([{ success: true, result: { deployments: [{ ...deployment, created_on: bad }] } }]);
  assert.equal(error.checkpoint, "deployment_time");
}
const hiddenKey = await failure([{ success: true, result: { [sentinel]: [sentinel] }, [sentinel]: sentinel }]);
assert.equal(hiddenKey.checkpoint, "deployments_list");
assert.deepEqual(hiddenKey.response_shape, {
  envelope: { type: "object", fields: { success: { type: "boolean" }, result: { type: "object", fields: {}, other_key_count: 1 } }, other_key_count: 1 },
  result: { type: "object", fields: {}, other_key_count: 1 },
});
const wrongEnvelope = await failure([null]);
assert.equal(wrongEnvelope.checkpoint, "envelope_success");
assert.deepEqual(wrongEnvelope.response_shape, { envelope: { type: "null" } });
const streamFailure = await failure([new Response(new ReadableStream({ start(controller) { controller.error(new Error(sentinel)); } }), { headers: { "content-type": "application/json" } })]);
assert.equal(streamFailure.checkpoint, "response_body");
console.log(`console_deploy_safety_validation: PASS (manual-only; 16 original write gates; exclusive preflight; 2 exact Binance gates; ${cases} offline reader cases)`);
