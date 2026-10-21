import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(new URL("../.github/workflows/deploy-strategy-switch-console.yml", import.meta.url), "utf8");
const triggers = workflow.slice(workflow.indexOf("\non:\n"), workflow.indexOf("\npermissions:"));
assert.deepEqual([...triggers.matchAll(/^  (\w+):/gm)].map(match => match[1]), ["workflow_dispatch"], "merges must not deploy");
for (const input of ["sync_secrets", "sync_strategy_profiles", "read_only_preflight", "skip_binance_receiver_checks", "rollback_to_pre_release"]) {
  const block = triggers.match(new RegExp(`      ${input}:\\n([\\s\\S]*?)(?=\\n      \\w+:|$)`))?.[1];
  assert.ok(block, input);
  assert.match(block, /type: boolean/);
  assert.match(block, /default: false/);
}
assert.match(triggers, /      source_sha:\n[\s\S]*?type: string\n        default: ""/);
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
const deploy = workflow.match(/^  deploy:\n([\s\S]*?)(?=^  rollback:|(?![\s\S]))/m)?.[1];
const rollback = workflow.match(/^  rollback:\n([\s\S]*)$/m)?.[1];
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
assert.ok(rollback, "normal fixed-baseline recovery is available without a new source or rule exception");
const rollbackGate = rollback.match(/^    if: (.+)$/m)?.[1];
for (const event of ["push", "workflow_dispatch"]) {
  for (const read_only_preflight of [false, true]) {
    for (const rollback_to_pre_release of [false, true]) {
    assert.equal(evaluate(preflightGate, { read_only_preflight }, "", event), event === "workflow_dispatch" && read_only_preflight);
    assert.equal(evaluate(deployGate, { read_only_preflight, rollback_to_pre_release }, "", event), event === "workflow_dispatch" && !read_only_preflight && !rollback_to_pre_release);
    assert.equal(evaluate(rollbackGate, { read_only_preflight, rollback_to_pre_release }, "", event), event === "workflow_dispatch" && !read_only_preflight && rollback_to_pre_release);
    }
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

// Execute the exact selection shell with a fake Git boundary, never checkout the
// test repository or evaluate any selected Worker. Real object identities are
// separately frozen by the release evidence and the required ancestry check.
const approved = "e2aab576d6874feeaf87df3411411ad04ee02d4f";
const approvedTree = "968b323ca75ee48d0c92bfe0b7f4110c3d27df72";
const control = "0041b6beb2c4c319b4605eb34f5a721d46bec799";
const selectionStep = steps.find(step => step.startsWith("Select reviewed historical main source\n"));
assert.ok(selectionStep);
assert.ok(deploy.indexOf("Select reviewed historical main source") < deploy.indexOf("Setup Python"), "reject unapproved source before running project code");
assert.match(deploy, /fetch-depth: 0/);
const shellBody = step => step.match(/        run: \|\n([\s\S]*)/)[1].split("\n").map(line => line.slice(10)).join("\n");
const selectShell = shellBody(selectionStep);
const fakeGit = `git() {
  printf '%s\\n' "$*" >> "$TRACE"
  case "$*" in
    'rev-parse HEAD') if [ -f "$SELECTED" ]; then printf '%s' "$FAKE_SELECTED_HEAD"; else printf '%s' "$FAKE_CONTROL_HEAD"; fi ;;
    'cat-file -e ${approved}^{commit}') return "$FAKE_OBJECT_EXIT" ;;
    'merge-base --is-ancestor ${approved} ${control}') return "$FAKE_ANCESTRY_EXIT" ;;
    'rev-parse ${approved}^{tree}'|'rev-parse HEAD^{tree}') printf '%s' "$FAKE_TREE" ;;
    '-c advice.detachedHead=false checkout --detach ${approved}') touch "$SELECTED" ;;
    *) return 91 ;;
  esac
};\n`;
let sourceCases = 0;
function sourceCase(delta, expected) {
  const temp = mkdtempSync(join(tmpdir(), "console-source-guard-"));
  try {
    const trace = join(temp, "trace"), selected = join(temp, "selected");
    const env = { PATH: process.env.PATH, GITHUB_REF: "refs/heads/main", GITHUB_SHA: control,
      RELEASE_SOURCE_SHA: approved, TRACE: trace, SELECTED: selected, FAKE_CONTROL_HEAD: control,
      FAKE_SELECTED_HEAD: approved, FAKE_TREE: approvedTree, FAKE_OBJECT_EXIT: "0", FAKE_ANCESTRY_EXIT: "0", ...delta };
    const result = spawnSync("bash", ["-c", fakeGit + selectShell], { env, encoding: "utf8" });
    assert.equal(result.status === 0, expected, result.stderr);
    assert.ok(!result.stdout.includes("PRIVATE_SOURCE_SENTINEL") && !result.stderr.includes("PRIVATE_SOURCE_SENTINEL"));
    const calls = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n") : [];
    sourceCases++;
    return { calls, selected: existsSync(selected) };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
const validSource = sourceCase({}, true);
assert.equal(validSource.selected, true);
assert.ok(validSource.calls.indexOf(`merge-base --is-ancestor ${approved} ${control}`) < validSource.calls.findIndex(line => line.includes("checkout --detach")));
assert.deepEqual(sourceCase({ RELEASE_SOURCE_SHA: "" }, true).calls, [], "default keeps the original checkout");
for (const source of ["main", "refs/heads/main", "2e63c3173c04b7b48871e7d75077492e172448cf", "a".repeat(40), approved.toUpperCase(), "$(printf PRIVATE_SOURCE_SENTINEL)", approved + "\n"]) {
  const rejected = sourceCase({ RELEASE_SOURCE_SHA: source }, false);
  assert.deepEqual(rejected.calls, [], "unapproved source must not reach Git");
}
for (const delta of [{ GITHUB_REF: "refs/heads/unapproved" }, { GITHUB_REF: "refs/tags/main" }]) assert.deepEqual(sourceCase(delta, false).calls, []);
for (const delta of [{ FAKE_CONTROL_HEAD: "b".repeat(40) }, { FAKE_OBJECT_EXIT: "1" }, { FAKE_ANCESTRY_EXIT: "1" }, { FAKE_TREE: "c".repeat(40) }]) {
  assert.equal(sourceCase(delta, false).selected, false, "object/control/ancestry/tree rejection precedes selection");
}
assert.equal(sourceCase({ FAKE_SELECTED_HEAD: "b".repeat(40) }, false).selected, true, "verify the actual selected checkout too");

assert.match(rollback, /environment: runtime-strategy-switch/);
assert.doesNotMatch(rollback, /actions\/checkout|npm ci|worker\.js|secret put|sync-strategy-profiles/);
const restoreStep = steps.find(step => step.startsWith("Restore fixed pre-release Worker version\n"));
const restoreShell = shellBody(restoreStep);
let restoreCases = 0;
function restoreCase(delta, expected, expectedNpx = false) {
  const temp = mkdtempSync(join(tmpdir(), "console-restore-guard-"));
  try {
    const trace = join(temp, "npx-argv");
    const env = { PATH: process.env.PATH, RUNNER_TEMP: temp, TRACE: trace, GITHUB_REF: "refs/heads/main",
      RELEASE_SOURCE_SHA: "", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_TOKEN: "PRIVATE_AUTH_SENTINEL", FAKE_NPX_EXIT: "0", ...delta };
    const fakeNpx = `npx() { printf '%s\\0' "$@" > "$TRACE"; return "$FAKE_NPX_EXIT"; };\n`;
    const result = spawnSync("bash", ["-c", fakeNpx + restoreShell], { env, encoding: "utf8" });
    assert.equal(result.status === 0, expected, result.stderr);
    assert.equal(existsSync(trace), expectedNpx);
    assert.ok(!(result.stdout + result.stderr).includes("PRIVATE_AUTH_SENTINEL"));
    if (expectedNpx) assert.deepEqual(readFileSync(trace, "utf8").split("\0").slice(0, -1), ["wrangler@4.106.0", "rollback", "c88234c2-292a-40d4-b624-500f145e3f7d", "--name", "qsl-strategy-switch-console", "--config", "wrangler.toml", "--message", "Restore verified pre-release c88234c2 baseline"]);
    restoreCases++;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
restoreCase({}, true, true);
for (const delta of [{ GITHUB_REF: "refs/heads/unapproved" }, { RELEASE_SOURCE_SHA: approved }, { CLOUDFLARE_API_TOKEN: "" }, { CLOUDFLARE_ACCOUNT_ID: "bad" }]) restoreCase(delta, false);
restoreCase({ FAKE_NPX_EXIT: "1" }, false, true);

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
// The pinned Wrangler accepts 0..100, including an explicitly idle version.
// https://github.com/cloudflare/workers-sdk/blob/wrangler%404.106.0/packages/wrangler/src/versions/deploy.ts#L570
// This fixture is not the value from the earlier safe live diagnostic.
for (const percentages of [[0, 100], [100, 0]]) {
  const result = await execute([{ success: true, result: { deployments: [{ ...deployment, versions: [
    { version_id: versionId, percentage: percentages[0] }, { version_id: deploymentId, percentage: percentages[1] },
  ] }] } }, normal[1]]);
  assert.equal(result.process.exitCode, 0, "an idle version must not invalidate a complete deployment");
  assert.deepEqual(JSON.parse(result.stdout[0]).active.versions.map(v => v.percentage), percentages, "preserve the zero weight without calling it positive traffic");
}
for (const percentage of [-0.01, 100.01, "0", null, false]) {
  const error = await failure([{ success: true, result: { deployments: [{ ...deployment, versions: [
    { version_id: versionId, percentage }, { version_id: deploymentId, percentage: 100 },
  ] }] } }]);
  assert.equal(error.checkpoint, "deployment_percentage");
}
const zeroTotal = await failure([{ success: true, result: { deployments: [{ ...deployment, versions: [
  { version_id: versionId, percentage: 0 }, { version_id: deploymentId, percentage: 0 },
] }] } }]);
assert.equal(zeroTotal.checkpoint, "deployment_percentage_total", "all-zero traffic is still invalid");
console.log(`console_deploy_safety_validation: PASS (manual-only; 16 original write gates; exclusive preflight/deploy/restore; 2 exact Binance gates; ${cases} offline reader cases; ${sourceCases} source cases; ${restoreCases} restore cases)`);
