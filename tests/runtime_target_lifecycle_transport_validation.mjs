import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { canonicalCycleJson, normalizeCycleHealth } from "../web/strategy-switch-console/runtime_cycle_health.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(readFileSync(new URL("./fixtures/runtime_cycle_health.v1.synthetic.json", import.meta.url), "utf8"));
const health = structuredClone(fixture.cases.find(c => c.name === "microsecond_no_action").health);
health.coverage.from = "2026-10-01T00:00:00.000009Z";
health.coverage.through = "2026-10-07T16:00:00.123457Z";
const temp = mkdtempSync(join(tmpdir(), "qrs-lifecycle-transport-"));
const healthPath = join(temp, "health.json");
const outputPath = join(temp, "packet.json");
writeFileSync(healthPath, JSON.stringify(health));
const script = resolve(root, "python/scripts/runtime_target_lifecycle.py");
const baseArgs = [script, "--source-id", "synthetic.paper", "--target-id", "longbridge.paper", "--platform", "longbridge", "--configured-state", "enabled", "--execution-mode", "paper", "--runtime-guard", "pass", "--execution-heartbeat", "pass", "--output", outputPath];
function run(extra = []) { return spawnSync("python3", [...baseArgs, ...extra], { cwd: root, encoding: "utf8" }); }
try {
  const buildStartedAt = Date.now();
  let result = run(["--cycle-health-json", healthPath]);
  assert.equal(result.status, 0, result.stderr);
  let packet = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(packet.generated_at, packet.computed_at, "generated and computed times identify this source snapshot");
  assert.notEqual(packet.computed_at, health.coverage.through, "historical page cutoff is not presented as current observation time");
  assert.ok(Date.parse(packet.computed_at) >= buildStartedAt - 1000 && Date.parse(packet.computed_at) <= Date.now() + 1000,
    "builder emits a current source observation timestamp");
  assert.deepEqual(packet.targets[0].cycle_health, health);
  assert.equal(packet.targets[0].no_order, true);
  const normalizedByReceiver = await normalizeCycleHealth(packet.targets[0].cycle_health, {
    ...fixture.context,
    observed_at: packet.computed_at,
  });
  assert.equal(canonicalCycleJson(normalizedByReceiver), canonicalCycleJson(packet.targets[0].cycle_health),
    "Python builder package is accepted unchanged by the existing B1 receiver normalizer");

  result = run();
  assert.equal(result.status, 0, result.stderr);
  packet = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(packet.targets[0].cycle_health, undefined, "default lifecycle body remains cycle-health-free");

  for (const mutate of [
    h => { h.extra = true; },
    h => { h.coverage.through = "2026-10-05T15:00:00.000000Z"; },
    h => { h.coverage.listed_count = 42; },
    h => { h.cycles = Array(21).fill(h.cycles[0]); },
    h => { h.resolutions = [{ kind: "unsupported" }]; },
  ]) {
    const badPath = join(temp, "bad.json");
    const bad = structuredClone(health); mutate(bad); writeFileSync(badPath, JSON.stringify(bad));
    assert.notEqual(run(["--cycle-health-json", badPath]).status, 0, "invalid transport envelope is rejected");
  }
  const wrongPlatform = [...baseArgs]; wrongPlatform[6] = "schwab";
  assert.notEqual(spawnSync("python3", [...wrongPlatform, "--cycle-health-json", healthPath], { cwd: root }).status, 0,
    "cycle-health transport is restricted to LongBridge PAPER");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

const action = readFileSync(resolve(root, "actions/publish-runtime-target-lifecycle/action.yml"), "utf8");
assert.match(action, /publish-cycle-health:[\s\S]*?default: 'false'/);
assert.match(action, /\/api\/internal\/runtime-cycle-health-source/);
assert.match(action, /\/api\/internal\/sync-runtime-target-lifecycle-source/);
assert.match(action, /ACCOUNT_FACTS_SYNC_TOKEN/);
assert.match(action, /X-QSL-Source-Binding-ID/);
assert.match(action, /qsl_runtime_cycle_health_ack\.v1/);
assert.match(action, /qsl_runtime_cycle_health_checkpoint\.v2/);
assert.match(action, /cycle_health_readback_mismatch/);
assert.match(action, /--header "@\$headers_path"/);
const runStart = action.indexOf("      run: |\n");
assert.notEqual(runStart, -1);
const runBlock = action.slice(runStart + "      run: |\n".length)
  .split("\n").map(line => line.startsWith("        ") ? line.slice(8) : line).join("\n");
const bashCheck = spawnSync("bash", ["-n"], { input: runBlock, encoding: "utf8" });
assert.equal(bashCheck.status, 0, bashCheck.stderr);

const actionTemp = mkdtempSync(join(tmpdir(), "qrs-cycle-health-action-mock-"));
const mockBin = join(actionTemp, "bin");
const mockCurl = join(mockBin, "curl");
const actionHealthPath = join(actionTemp, "source.json");
const mockStatePath = join(actionTemp, "mock-state.json");
const requestLogPath = join(actionTemp, "requests.log");
const token = "synthetic-account-facts-token";
const bindingId = "a".repeat(64);
mkdirSync(mockBin, { recursive: true });
writeFileSync(actionHealthPath, JSON.stringify(health));
writeFileSync(mockCurl, `#!/usr/bin/env node
const fs=require("node:fs"), crypto=require("node:crypto");
const args=process.argv.slice(2);
if(args.some(a=>a.includes(process.env.QSL_TEST_TOKEN))) process.exit(41);
const get=(flag)=>args[args.indexOf(flag)+1];
const method=get("--request"), url=args.find(a=>a.startsWith("https://")), output=get("--output");
fs.appendFileSync(process.env.QSL_TEST_REQUEST_LOG, method+" "+url+"\\n");
const digest=(v)=>crypto.createHash("sha256").update((function canonical(x){if(Array.isArray(x))return "["+x.map(canonical).join(",")+"]";if(x&&typeof x==="object")return "{"+Object.keys(x).sort().map(k=>JSON.stringify(k)+":"+canonical(x[k])).join(",")+"}";return JSON.stringify(x)})(v)).digest("hex");
const headerPath=get("--header").slice(1), headers=fs.readFileSync(headerPath,"utf8");
if(!headers.includes("Bearer "+process.env.QSL_TEST_EXPECTED_TOKEN))process.exit(42);
if(process.env.INPUT_PUBLISH_CYCLE_HEALTH==="true"&&!headers.includes("X-QSL-Source-Binding-ID: "+process.env.INPUT_CYCLE_HEALTH_SOURCE_BINDING_ID))process.exit(42);
if(url.includes("/runtime-cycle-health-source") && (get("--connect-timeout")!=="10" || get("--max-time")!=="30" || get("--max-filesize")!=="1048576"))process.exit(44);
if(process.env.QSL_TEST_OVERSIZE_ACK==="true" && method==="POST") { process.stdout.write(" ".repeat(1048577),()=>process.exit(0)); }
if(url.includes("/sync-runtime-target-lifecycle-source")) { const packet=JSON.parse(fs.readFileSync(get("--data-binary").slice(1),"utf8")); if(packet.targets[0].cycle_health)process.exit(43); process.exit(0); }
let response;
if(method==="POST") { const packet=JSON.parse(fs.readFileSync(get("--data-binary").slice(1),"utf8")); const ack={ok:true,schema_version:"qsl_runtime_cycle_health_ack.v1",result:"stored",source_id:packet.source_id,target_id:packet.targets[0].target_id,configuration_sha256:packet.targets[0].cycle_health.configuration_sha256,source_binding_id:process.env.INPUT_CYCLE_HEALTH_SOURCE_BINDING_ID,authority_revision:1,checkpoint_revision:1,observed_at:packet.computed_at,observation_sha256:digest(packet),covered_through:packet.targets[0].cycle_health.coverage.through,coverage_complete:true,coverage_incomplete_reason:null,adopted:false,no_order:true,execution_authority_granted:false}; if(process.env.QSL_TEST_PARTIAL_COVERAGE==="true"){ack.covered_through=null;ack.coverage_complete=false;ack.coverage_incomplete_reason="scan_incomplete";} if(process.env.QSL_TEST_BAD_ACK==="true")ack.target_id="wrong.target"; if(process.env.QSL_TEST_BAD_BINDING==="true")ack.source_binding_id="0".repeat(64); if(process.env.QSL_TEST_BAD_CONFIG==="true")ack.configuration_sha256="0".repeat(64); if(process.env.QSL_TEST_BAD_COVERAGE==="true")ack.covered_through="2026-10-01T00:00:00Z"; fs.writeFileSync(process.env.QSL_TEST_MOCK_STATE,JSON.stringify(ack)); response=ack; }
else { const ack=JSON.parse(fs.readFileSync(process.env.QSL_TEST_MOCK_STATE,"utf8")); response={...ack,schema_version:"qsl_runtime_cycle_health_checkpoint.v2",status:"incomplete"}; if(process.env.QSL_TEST_BAD_READBACK==="true")response.observation_sha256="0".repeat(64); }
if(output==="-")process.stdout.write(JSON.stringify(response)); else fs.writeFileSync(output,JSON.stringify(response));
`);
chmodSync(mockCurl, 0o700);
const baseEnv = {
  ...process.env, PATH: `${mockBin}:${process.env.PATH}`, GITHUB_ACTION_PATH: resolve(root, "actions/publish-runtime-target-lifecycle"),
  INPUT_SOURCE_ID: "synthetic.paper", INPUT_TARGET_ID: "longbridge.paper", INPUT_PLATFORM: "longbridge",
  INPUT_CONFIGURED_STATE: "enabled", INPUT_EXECUTION_MODE: "paper", INPUT_RUNTIME_GUARD: "pass", INPUT_EXECUTION_HEARTBEAT: "pass",
  INPUT_SYNC_URL: "https://console.example", INPUT_OBSERVE_GCP: "false", INPUT_GCP_PROJECT: "", INPUT_CLOUD_RUN_REGION: "",
  INPUT_CLOUD_RUN_SERVICE: "", INPUT_SCHEDULER_LOCATION: "", INPUT_DEPLOYMENT_JSON: "", INPUT_PUBLISH_CYCLE_HEALTH: "true",
  INPUT_CYCLE_HEALTH_FILE: actionHealthPath, INPUT_CYCLE_HEALTH_SOURCE_BINDING_ID: bindingId,
  ACCOUNT_FACTS_SYNC_TOKEN: token, EXECUTION_EVIDENCE_SYNC_TOKEN: "synthetic-legacy-token",
  QSL_TEST_TOKEN: token, QSL_TEST_EXPECTED_TOKEN: token, QSL_TEST_MOCK_STATE: mockStatePath,
  QSL_TEST_REQUEST_LOG: requestLogPath,
};
try {
  writeFileSync(requestLogPath, "");
  let actionRun = spawnSync("bash", ["-c", runBlock], { cwd: root, env: baseEnv, encoding: "utf8" });
  assert.equal(actionRun.status, 0, `${actionRun.stdout}\n${actionRun.stderr}`);
  assert.equal(actionRun.stdout, "", "transport response bodies are not logged");
  writeFileSync(requestLogPath, "");
  actionRun = spawnSync("bash", ["-c", runBlock], { cwd: root, env: { ...baseEnv, QSL_TEST_PARTIAL_COVERAGE: "true" }, encoding: "utf8" });
  assert.equal(actionRun.status, 0, `${actionRun.stdout}\n${actionRun.stderr}`);
  assert.deepEqual(readFileSync(requestLogPath, "utf8").trim().split("\n").map(x => x.split(" ")[0]), ["POST", "GET"],
    "a committed incomplete scan is read back and is not treated as a transport failure");
  actionRun = spawnSync("bash", ["-c", runBlock], { cwd: root, env: { ...baseEnv, QSL_TEST_BAD_READBACK: "true" }, encoding: "utf8" });
  assert.notEqual(actionRun.status, 0, `mismatched GET readback fails the opted-in action: ${JSON.stringify({ status: actionRun.status, stdout: actionRun.stdout, stderr: actionRun.stderr })}`);
  assert.match(actionRun.stderr, /cycle_health_readback_mismatch/);
  assert.doesNotMatch(actionRun.stderr, new RegExp(token));
  writeFileSync(requestLogPath, "");
  actionRun = spawnSync("bash", ["-c", runBlock], { cwd: root, env: { ...baseEnv, QSL_TEST_BAD_ACK: "true" }, encoding: "utf8" });
  assert.notEqual(actionRun.status, 0, "non-matching POST ACK fails closed");
  assert.match(actionRun.stderr, /cycle_health_ack_invalid/);
  assert.deepEqual(readFileSync(requestLogPath, "utf8").trim().split("\n").map(x => x.split(" ")[0]), ["POST"], "an ACK failure does not fall back to lifecycle POST or continue to GET");
  writeFileSync(requestLogPath, "");
  actionRun = spawnSync("bash", ["-c", runBlock], { cwd: root, env: { ...baseEnv, QSL_TEST_BAD_COVERAGE: "true" }, encoding: "utf8" });
  assert.notEqual(actionRun.status, 0, "ACK cannot claim coverage beyond the submitted packet");
  assert.match(actionRun.stderr, /cycle_health_ack_invalid/);
  assert.deepEqual(readFileSync(requestLogPath, "utf8").trim().split("\n").map(x => x.split(" ")[0]), ["POST"], "coverage ACK mismatch fails before GET without fallback");
  writeFileSync(requestLogPath, "");
  actionRun = spawnSync("bash", ["-c", runBlock], { cwd: root, env: { ...baseEnv, QSL_TEST_BAD_BINDING: "true" }, encoding: "utf8" });
  assert.notEqual(actionRun.status, 0, "ACK binding identity must match protected configuration");
  assert.match(actionRun.stderr, /cycle_health_ack_invalid/);
  assert.deepEqual(readFileSync(requestLogPath, "utf8").trim().split("\n").map(x => x.split(" ")[0]), ["POST"]);
  writeFileSync(requestLogPath, "");
  actionRun = spawnSync("bash", ["-c", runBlock], { cwd: root, env: { ...baseEnv, QSL_TEST_BAD_CONFIG: "true" }, encoding: "utf8" });
  assert.notEqual(actionRun.status, 0, "ACK configuration digest must match the submitted package");
  assert.match(actionRun.stderr, /cycle_health_ack_invalid/);
  assert.deepEqual(readFileSync(requestLogPath, "utf8").trim().split("\n").map(x => x.split(" ")[0]), ["POST"]);
  writeFileSync(requestLogPath, "");
  actionRun = spawnSync("bash", ["-c", runBlock], { cwd: root, env: { ...baseEnv, QSL_TEST_OVERSIZE_ACK: "true" }, encoding: "utf8" });
  assert.notEqual(actionRun.status, 0, "oversized POST ACK is rejected within the response cap");
  assert.match(actionRun.stderr, /cycle_health_post_failed/);
  assert.deepEqual(readFileSync(requestLogPath, "utf8").trim().split("\n").map(x => x.split(" ")[0]), ["POST"], "oversized response is not retried or sent to legacy transport");
  writeFileSync(requestLogPath, "");
  actionRun = spawnSync("bash", ["-c", runBlock], { cwd: root, env: {
    ...baseEnv, INPUT_PUBLISH_CYCLE_HEALTH: "false", INPUT_CYCLE_HEALTH_FILE: "", INPUT_CYCLE_HEALTH_SOURCE_BINDING_ID: "",
    ACCOUNT_FACTS_SYNC_TOKEN: "", QSL_TEST_EXPECTED_TOKEN: "synthetic-legacy-token",
  }, encoding: "utf8" });
  assert.equal(actionRun.status, 0, `${actionRun.stdout}\n${actionRun.stderr}`);
  assert.deepEqual(readFileSync(requestLogPath, "utf8").trim().split("\n"), ["POST https://console.example/api/internal/sync-runtime-target-lifecycle-source"],
    "default action remains on the legacy lifecycle transport");
} finally {
  rmSync(actionTemp, { recursive: true, force: true });
}
