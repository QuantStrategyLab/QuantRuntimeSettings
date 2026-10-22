import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(new URL("../.github/workflows/deploy-strategy-switch-console.yml", import.meta.url), "utf8");
const triggers = workflow.slice(workflow.indexOf("\non:\n"), workflow.indexOf("\npermissions:"));
assert.deepEqual([...triggers.matchAll(/^  (\w+):/gm)].map(match => match[1]), ["workflow_dispatch"], "merges must not deploy");
for (const input of ["sync_secrets", "sync_strategy_profiles", "read_only_preflight", "skip_binance_receiver_checks", "release_frontend_assets", "rollback_to_pre_release"]) {
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
const skipGates = steps.filter(step => /^        if: .*inputs\.skip_binance_receiver_checks/m.test(step));
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
const frontend = "456853b6655e05bd18ede58cdab54bd0b02a4a34";
const frontendTree = "a98498a60753cadc7b010f2e9d9c5a5e34f812f4";
const frontendBlob = "e5c9239bd1da99f0272464a23118c2784926d923";
const assetPath = "web/strategy-switch-console/v2_asset_map.js";
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
    'cat-file -e ${frontend}^{commit}') return "$FAKE_FRONTEND_OBJECT_EXIT" ;;
    'merge-base --is-ancestor ${approved} ${control}') return "$FAKE_ANCESTRY_EXIT" ;;
    'merge-base --is-ancestor ${frontend} ${control}') return "$FAKE_FRONTEND_ANCESTRY_EXIT" ;;
    'rev-parse ${approved}^{tree}'|'rev-parse HEAD^{tree}') printf '%s' "$FAKE_TREE" ;;
    'rev-parse ${frontend}^{tree}') printf '%s' "$FAKE_FRONTEND_TREE" ;;
    'rev-parse ${frontend}:${assetPath}') printf '%s' "$FAKE_FRONTEND_BLOB" ;;
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
      FAKE_SELECTED_HEAD: approved, FAKE_TREE: approvedTree, FAKE_OBJECT_EXIT: "0", FAKE_ANCESTRY_EXIT: "0",
      RELEASE_FRONTEND_ASSETS: "false", SYNC_SECRETS: "false", SYNC_STRATEGY_PROFILES: "false", SKIP_BINANCE_RECEIVER_CHECKS: "true",
      FAKE_FRONTEND_OBJECT_EXIT: "0", FAKE_FRONTEND_ANCESTRY_EXIT: "0", FAKE_FRONTEND_TREE: frontendTree, FAKE_FRONTEND_BLOB: frontendBlob, ...delta };
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
assert.equal(sourceCase({ RELEASE_FRONTEND_ASSETS: "true" }, true).selected, true);
for (const delta of [{ RELEASE_SOURCE_SHA: "" }, { SYNC_SECRETS: "true" }, { SYNC_STRATEGY_PROFILES: "true" },
  { SKIP_BINANCE_RECEIVER_CHECKS: "false" }, { GITHUB_REF: "refs/heads/unapproved" }]) {
  assert.deepEqual(sourceCase({ RELEASE_FRONTEND_ASSETS: "true", ...delta }, false).calls, [], "invalid frontend modes reject before Git/project code");
}
assert.deepEqual(sourceCase({ RELEASE_FRONTEND_ASSETS: "true\n" }, false).calls, []);
for (const delta of [{ FAKE_FRONTEND_OBJECT_EXIT: "1" }, { FAKE_FRONTEND_ANCESTRY_EXIT: "1" },
  { FAKE_FRONTEND_TREE: "a".repeat(40) }, { FAKE_FRONTEND_BLOB: "a".repeat(40) }]) {
  assert.equal(sourceCase({ RELEASE_FRONTEND_ASSETS: "true", ...delta }, false).selected, false);
}

// Execute the actual overlay shell. Only Git metadata/working-diff boundaries
// are synthetic; hash-object validates the real reviewed map bytes.
const overlayStep = steps.find(step => step.startsWith("Overlay fixed reviewed frontend assets\n"));
assert.ok(overlayStep);
assert.match(overlayStep, /^        if: inputs\.release_frontend_assets$/m);
assert.ok(deploy.indexOf("Build config & assets") < deploy.indexOf("Overlay fixed reviewed frontend assets"));
assert.ok(deploy.indexOf("Overlay fixed reviewed frontend assets") < deploy.indexOf("Validate fixed backend with reviewed frontend"));
assert.match(deploy, /Validate fixed backend with reviewed frontend[\s\S]*?node tests\/console_v2_assets_validation\.mjs\n          node tests\/console_v2_worker_validation\.mjs/);
const overlayShell = shellBody(overlayStep), reviewedMap = readFileSync(new URL("../" + assetPath, import.meta.url));
const fakeOverlayGit = `git() {
  case "$*" in
    'rev-parse HEAD') printf '%s' "$FAKE_HEAD" ;;
    'rev-parse HEAD^{tree}') printf '%s' "$FAKE_TREE" ;;
    'rev-parse ${frontend}^{tree}') printf '%s' "$FAKE_FRONTEND_TREE" ;;
    'show ${frontend}:${assetPath}') cat "$FROZEN_MAP" ;;
    hash-object*) command git "$@" ;;
    'diff --name-only ${approved}') printf '%s' "$FAKE_DIFF" ;;
    'ls-files --others --exclude-standard') printf '%s' "$FAKE_UNTRACKED" ;;
    *) return 91 ;;
  esac
};\n`;
let overlayCases = 0;
function overlayCase(delta = {}, expected = true, bytes = reviewedMap) {
  const temp = mkdtempSync(join(tmpdir(), "console-frontend-overlay-"));
  try {
    const dest = join(temp, assetPath), frozen = join(temp, "frozen-map");
    mkdirSync(join(temp, "web/strategy-switch-console"), { recursive: true });
    writeFileSync(dest, "old synthetic map"); writeFileSync(frozen, bytes);
    const env = { PATH: process.env.PATH, GITHUB_REF: "refs/heads/main", FAKE_HEAD: approved, FAKE_TREE: approvedTree,
      FAKE_FRONTEND_TREE: frontendTree, FAKE_DIFF: assetPath, FAKE_UNTRACKED: "", FROZEN_MAP: frozen, ...delta };
    const result = spawnSync("bash", ["-c", fakeOverlayGit + overlayShell], { cwd: temp, env, encoding: "utf8" });
    assert.equal(result.status === 0, expected, result.stderr);
    if (expected) assert.deepEqual(readFileSync(dest), reviewedMap);
    overlayCases++;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
overlayCase();
for (const delta of [{ GITHUB_REF: "refs/heads/unapproved" }, { FAKE_HEAD: frontend }, { FAKE_TREE: frontendTree },
  { FAKE_FRONTEND_TREE: approvedTree }, { FAKE_DIFF: assetPath + "\nweb/strategy-switch-console/worker.js" },
  { FAKE_DIFF: "" }, { FAKE_UNTRACKED: "unreviewed-runtime.js" }]) overlayCase(delta, false);
overlayCase({}, false, Buffer.concat([reviewedMap, Buffer.from("\n// corrupt synthetic input")]));

// Run the actual config renderer with only synthetic configuration. In frontend
// mode no local vars may overwrite remote flags; all other TOML stays the same.
const prepareStep = steps.find(step => step.startsWith("Prepare Wrangler config\n"));
const preparePython = prepareStep.match(/python3 - <<'PY'\n([\s\S]*?)\n          PY/)[1].split("\n").map(line => line.slice(10)).join("\n");
const exampleConfig = readFileSync(new URL("../web/strategy-switch-console/wrangler.toml.example", import.meta.url), "utf8");
let configCases = 0;
const renderedConfigs = [];
for (const frontendMode of ["false", "true"]) {
  const temp = mkdtempSync(join(tmpdir(), "console-frontend-config-"));
  try {
    writeFileSync(join(temp, "wrangler.toml.example"), exampleConfig);
    const result = spawnSync("python3", ["-c", preparePython], { env: { PATH: process.env.PATH,
      WORKER_DIR: temp, RELEASE_FRONTEND_ASSETS: frontendMode, STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID: "a".repeat(32),
      ACCOUNT_FACTS_READ_MODEL_ENABLED: "true", ACCOUNT_FACTS_SYNC_TOKEN: "SYNTHETIC_CONFIG_SENTINEL", RUNTIME_DAILY_READ_MODEL_ENABLED: "false" }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const text = readFileSync(join(temp, "wrangler.toml"), "utf8");
    const parsed = spawnSync("python3", ["-c", "import json,sys,tomllib;print(json.dumps(tomllib.loads(sys.stdin.read())))"], { input: text, encoding: "utf8" });
    assert.equal(parsed.status, 0, parsed.stderr);
    renderedConfigs.push(JSON.parse(parsed.stdout));
    if (frontendMode === "true") {
      assert.match(text, /\[vars\]\n\n\[triggers\]/);
      assert.doesNotMatch(text, /ACCOUNT_FACTS_READ_MODEL_ENABLED =/);
    } else assert.match(text, /ACCOUNT_FACTS_READ_MODEL_ENABLED = "true"/);
    assert.ok(!result.stdout.includes("SYNTHETIC_CONFIG_SENTINEL") && !result.stderr.includes("SYNTHETIC_CONFIG_SENTINEL"));
    configCases++;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
assert.deepEqual(renderedConfigs[1].vars, {}, "no locally rendered flag may override a retained remote var");
const normalWithoutVars = { ...renderedConfigs[0] }, frontendWithoutVars = { ...renderedConfigs[1] };
delete normalWithoutVars.vars; delete frontendWithoutVars.vars;
assert.deepEqual(frontendWithoutVars, normalWithoutVars, "namespace, DO migration, trigger and all other configuration stay unchanged");
const publishStep = steps.find(s => s.startsWith("Publish fixed frontend-only Worker version\n"));
const bundleStep = steps.find(s => s.startsWith("Build frontend-only Worker bundle without publishing\n"));
const normalDeploy = steps.find(s => s.startsWith("Deploy Worker\n"));
assert.match(normalDeploy, /if: \$\{\{ !inputs\.release_frontend_assets \}\}/);
assert.match(normalDeploy, /npx wrangler@4\.106\.0 deploy --config wrangler\.toml\n/);
assert.match(bundleStep, /WRANGLER_SEND_METRICS: "false"/);
assert.match(bundleStep, /deploy --dry-run --config wrangler\.toml --outdir/);
for (const s of [bundleStep,publishStep]) assert.match(s, /^        if: inputs\.release_frontend_assets$/m);
assert.doesNotMatch(publishStep, /npx|triggers deploy|secret put|script-settings|\/schedules|\/routes/);
assert.match(workflow, /group: strategy-switch-console-deploy\n  cancel-in-progress: false/);
const releaseScript = publishStep.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n          JS/)[1].split("\n").map(l=>l.slice(10)).filter(l=>!l.startsWith("import ")).join("\n");
const runRelease = new (Object.getPrototypeOf(async function(){}).constructor)("process","fetch","console","readFile","createHash",releaseScript);
const priorVersion="2beea000-cce5-43a5-9255-9724f7318e83", priorDeployment="6107ffd9-4c76-4bc5-be85-a12caf2af766";
const newVersion="00000000-0000-4000-8000-000000000002", newDeployment="00000000-0000-4000-8000-000000000003", privateRelease="PRIVATE_RELEASE_SENTINEL";
const remoteBindings=[{name:"STRATEGY_SWITCH_CONFIG",type:"kv_namespace",namespace_id:"b".repeat(32)},
 {name:"STRATEGY_SWITCH_RUNTIME_INSTANCES",type:"durable_object_namespace",namespace_id:"c".repeat(32),class_name:"RuntimeInstances"},
 {name:"FLAG",type:"plain_text",text:privateRelease},{name:"DATA",type:"json",json:{private:privateRelease}},{name:"SECRET",type:"secret_text"}];
const runtime={compatibility_date:"2026-06-08",compatibility_flags:[],usage_model:"standard",limits:{},migration_tag:"runtime-instances-v1",exports:{RuntimeInstances:{type:"durable-object",storage:"sqlite"}}};
const resource=etag=>({bindings:structuredClone(remoteBindings),script_runtime:structuredClone(runtime),script:{etag,handlers:["fetch","scheduled"],last_deployed_from:"api"}});
const wrap=result=>({success:true,errors:[],result}), dep=(id,v)=>({id,strategy:"percentage",versions:[{version_id:v,percentage:100}]});
const responseSequence=()=>[wrap({deployments:[dep(priorDeployment,priorVersion)]}),wrap({id:priorVersion,resources:resource("old-code")}),
 wrap({items:[{id:priorVersion}]}),wrap({id:newVersion}),wrap({id:newVersion,resources:resource("new-code")}),
 wrap({deployments:[dep(priorDeployment,priorVersion)]}),wrap({items:[{id:newVersion}]}),wrap(dep(newDeployment,newVersion)),wrap({deployments:[dep(newDeployment,newVersion)]})];
const apiSequence=[["/deployments?page=1&per_page=10","GET"],[`/versions/${priorVersion}`,"GET"],["/versions?page=1&per_page=10","GET"],["/versions?bindings_inherit=strict","POST"],
 [`/versions/${newVersion}`,"GET"],["/deployments?page=1&per_page=10","GET"],["/versions?page=1&per_page=10","GET"],["/deployments?force=false","POST"],["/deployments?page=1&per_page=10","GET"]];
let releaseCases=0;
async function releaseCase({mutate=()=>{},env={},failAt=-1,responseAt=-1,response,readError=false}={}, expected=true,count=9){
 const responses=responseSequence();mutate(responses);const calls=[],stdout=[],stderr=[];
 const process={env:{GITHUB_REF:"refs/heads/main",CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),CLOUDFLARE_API_TOKEN:privateRelease,RUNNER_TEMP:"/synthetic",STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID:"d".repeat(32),...env},exitCode:0};
 await runRelease(process,async(url,options)=>{const i=calls.length;calls.push({url,options});if(i===failAt)throw Error(privateRelease);if(i===responseAt)return response;
  assert.ok(i<responses.length,"no retry/page expansion");return new Response(JSON.stringify(responses[i]),{headers:{"content-type":"application/json"}});
 },{log:x=>stdout.push(x),error:x=>stderr.push(x)},async path=>{assert.equal(path,"/synthetic/console-frontend-bundle/worker.js");if(readError)throw Error(privateRelease);return Buffer.from("export default { fetch(){} }; // synthetic bundle");},createHash);
 assert.equal(process.exitCode===0,expected,stderr.join("\n"));assert.equal(calls.length,count);
 assert.ok(!JSON.stringify({stdout,stderr}).includes(privateRelease));assert.ok(!JSON.stringify({stdout,stderr}).includes("a".repeat(32)));
 for(const [i,{url,options}] of calls.entries()){
  assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/workers/scripts/qsl-strategy-switch-console`+apiSequence[i][0]);
  assert.equal(options.headers["Accept-Encoding"],"identity");assert.equal(options.method,apiSequence[i][1]);assert.equal(options.redirect,"error");assert.ok(options.signal instanceof AbortSignal);assert.equal(options.headers.Authorization,`Bearer ${privateRelease}`);
  if(i===3){assert.ok(options.body instanceof FormData);assert.deepEqual([...options.body.keys()],["metadata","worker.js"]);const m=JSON.parse(options.body.get("metadata"));
   assert.deepEqual(m.bindings,remoteBindings.map(b=>({type:"inherit",name:b.name})));
   assert.deepEqual(Object.keys(m).sort(),["main_module","bindings","compatibility_date","compatibility_flags","usage_model","limits","annotations"].sort());
   assert.ok(!JSON.stringify(m).includes(privateRelease));assert.ok(!JSON.stringify(m).includes("d".repeat(32)),"Environment namespace must not rebind existing KV");assert.equal(options.headers["Content-Type"],undefined);}
  if(i===7)assert.deepEqual(JSON.parse(options.body),{strategy:"percentage",versions:[{version_id:newVersion,percentage:100}],annotations:{"workers/message":"Reviewed frontend only; fixed e2a backend and retained configuration"}});
 }
 if(expected){const r=JSON.parse(stdout[0]);assert.equal(r.version_id,newVersion);assert.equal(r.deployment_id,newDeployment);assert.equal(r.bindings_equal,true);assert.equal(r.runtime_equal,true);assert.equal(r.provider_cas,false);}
 else{assert.equal(stdout.length,0);assert.equal(JSON.parse(stderr[0]).retry,false);}
 releaseCases++;return {calls,stdout,stderr};
}
await releaseCase();await releaseCase({env:{STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID:"e".repeat(32)}}); // H's namespace drift no longer affects inherited configuration
for(const env of [{GITHUB_REF:"refs/heads/unapproved"},{CLOUDFLARE_API_TOKEN:""},{CLOUDFLARE_ACCOUNT_ID:"bad"}])await releaseCase({env},false,0);
await releaseCase({readError:true},false,2);
for(let i=0;i<9;i++)await releaseCase({failAt:i},false,i+1);
for(const [at,change] of [
 [0,x=>{x.result.deployments[0].id=newDeployment;}],[1,x=>{x.result.id=newVersion;}],[1,x=>{x.result.resources.bindings.push(x.result.resources.bindings[0]);}],
 [1,x=>{delete x.result.resources.bindings[0].namespace_id;}],[1,x=>{delete x.result.resources.bindings[1].class_name;}],
 [1,x=>{x.result.resources.bindings[0].namespace_id={private:privateRelease};}],
 [1,x=>{delete x.result.resources.bindings[2].text;}],[1,x=>{delete x.result.resources.bindings[3].json;}],
 [1,x=>{x.result.resources.bindings[4].text=privateRelease;}],
 [1,x=>{x.result.resources.script_runtime.unknown=privateRelease;}],[1,x=>{x.result.resources.bindings[0].type="service";}],[1,x=>{x.result.resources.assets={};}],
 [2,x=>{x.result.items[0].id=newVersion;}],[3,x=>{x.result.id="untrusted";}],
 [4,x=>{x.result.resources.bindings[0].namespace_id="e".repeat(32);}],[4,x=>{x.result.resources.bindings.pop();}],[4,x=>{x.result.resources.bindings[2].text="different";}],
 [4,x=>{x.result.resources.script_runtime.compatibility_date="2026-06-09";}],[4,x=>{x.result.resources.script_runtime.limits={cpu_ms:1};}],
 [4,x=>{x.result.resources.script_runtime.migration_tag="changed";}],[4,x=>{x.result.resources.script.handlers=["fetch"];}],[4,x=>{x.result.resources.script.etag="old-code";}],
 [5,x=>{x.result.deployments[0].versions[0].version_id=newVersion;}],[6,x=>{x.result.items[0].id=priorVersion;}],[7,x=>{x.result.versions[0].percentage=99;}],[8,x=>{x.result.deployments[0].id=priorDeployment;}]
])await releaseCase({mutate:r=>change(r[at])},false,at+1);
for (const corrupt of [b=>{delete b.namespace_id;},b=>{b.namespace_id={private:privateRelease};}]) {
 await releaseCase({mutate:r=>{for(const i of [1,4])corrupt(r[i].result.resources.bindings[0]);}},false,2);
}
await releaseCase({mutate:r=>{for(const i of [1,4])delete r[i].result.resources.bindings[1].class_name;}},false,2);
for(const [at,response] of [
 [0,new Response(privateRelease,{status:403})],[3,new Response(privateRelease,{status:500})],[7,new Response(JSON.stringify({success:false,errors:[{code:10220,message:privateRelease}]}),{status:400})],
 [1,new Response("{",{headers:{"content-type":"application/json"}})],[1,new Response("x".repeat(524289),{headers:{"content-type":"application/json"}})],
 [1,new Response(privateRelease,{headers:{"content-type":"text/html"}})],[1,new Response("{}",{headers:{"content-type":"application/json","content-encoding":"gzip"}})],
 [1,new Response("{}",{headers:{"content-type":"application/json","content-length":"524289"}})],[1,new Response("{}",{headers:{"content-type":"application/json","content-length":"1"}})],
 [1,new Response(new ReadableStream({pull(c){c.error(Error(privateRelease));}}),{headers:{"content-type":"application/json"}})]
])await releaseCase({responseAt:at,response},false,at+1);

assert.match(rollback, /environment: runtime-strategy-switch/);
assert.doesNotMatch(rollback, /actions\/checkout|npm ci|worker\.js|secret put|sync-strategy-profiles/);
const restoreStep = steps.find(step => step.startsWith("Restore fixed pre-release Worker version\n"));
const restoreScript = restoreStep.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n          JS/)?.[1]
  ?.split("\n").map(line => line.slice(10)).join("\n");
assert.ok(restoreScript);
assert.doesNotMatch(rollback, /npx|wrangler.*rollback|force=true|RUNNER_TEMP/);
const RestoreFunction = Object.getPrototypeOf(async function () {}).constructor;
const runRestore = new RestoreFunction("process", "fetch", "console", restoreScript);
const restoreTarget = "2beea000-cce5-43a5-9255-9724f7318e83";
const restoreId = "00000000-0000-4000-8000-000000000001";
const restoreSentinel = "PRIVATE_RESTORE_SENTINEL_DO_NOT_OUTPUT";
const restoreBody = { success: true, errors: [], result: { id: restoreId, strategy: "percentage",
  versions: [{ version_id: restoreTarget, percentage: 100 }], author_email: restoreSentinel, unknown: { secret: restoreSentinel } } };
let restoreCases = 0;
async function restoreCase({ env = {}, status = 200, body = restoreBody, raw, headers = {}, fetchError = false, streamError = false } = {}, expected = true, expectedCalls = 1) {
  const calls = [], stdout = [], stderr = [];
  const process = { env: { GITHUB_REF: "refs/heads/main", RELEASE_SOURCE_SHA: "",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_TOKEN: restoreSentinel, ...env }, exitCode: 0 };
  await runRestore(process, async (url, options) => {
    calls.push({ url, options });
    if (fetchError) throw new Error(restoreSentinel);
    const payload = raw ?? JSON.stringify(body);
    const stream = streamError ? new ReadableStream({ pull(controller) { controller.error(new Error(restoreSentinel)); } }) : payload;
    return new Response(stream, { status, headers: { "content-type": "application/json", ...headers } });
  }, { log: value => stdout.push(value), error: value => stderr.push(value) });
  assert.equal(process.exitCode === 0, expected, stderr.join("\n"));
  assert.equal(calls.length, expectedCalls, "fixed single request; never retry an error or uncertain response");
  assert.ok(!(stdout.join("") + stderr.join("")).includes(restoreSentinel));
  assert.ok(!(stdout.join("") + stderr.join("")).includes("a".repeat(32)));
  if (calls.length) {
    const { url, options } = calls[0];
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/workers/scripts/qsl-strategy-switch-console/deployments?force=false`);
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(options.headers, { Authorization: `Bearer ${restoreSentinel}`, Accept: "application/json", "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(options.body), { strategy: "percentage", versions: [{ version_id: restoreTarget, percentage: 100 }],
      annotations: { "workers/message": "Restore verified pre-frontend 2beea000 baseline" } });
  }
  if (expected) assert.deepEqual(JSON.parse(stdout[0]), { status: "restore_response_verified", deployment_id: restoreId, version_id: restoreTarget, percentage: 100, force: false });
  else {
    assert.equal(stdout.length, 0);
    const error = JSON.parse(stderr[0]);
    assert.equal(error.retry, false);
    assert.equal(error.outcome, expectedCalls ? "UNKNOWN_REQUIRES_READBACK" : "NOT_ATTEMPTED");
  }
  restoreCases++;
}
await restoreCase();
for (const env of [{ GITHUB_REF: "refs/heads/unapproved" }, { GITHUB_REF: "refs/tags/main" },
  { RELEASE_SOURCE_SHA: approved }, { RELEASE_FRONTEND_ASSETS: "true" }, { CLOUDFLARE_API_TOKEN: "" }, { CLOUDFLARE_ACCOUNT_ID: "bad" }]) await restoreCase({ env }, false, 0);
// Provider's changed-secret rejection must stop, not trigger Wrangler's force fallback.
await restoreCase({ status: 400, body: { success: false, errors: [{ code: 10220, message: restoreSentinel }] } }, false);
for (const status of [302, 403, 429, 500]) await restoreCase({ status, raw: restoreSentinel }, false);
for (const delta of [{ fetchError: true }, { streamError: true }, { raw: restoreSentinel },
  { headers: { "content-type": "text/html" } }, { headers: { "content-encoding": "gzip" } },
  { headers: { "content-length": "65537" } }, { headers: { "content-length": "12x" } },
  { headers: { "content-length": "1" } }, { raw: "x".repeat(65537) }]) await restoreCase(delta, false);
for (const mutate of [body => { body.success = false; }, body => { body.errors = [{ message: restoreSentinel }]; },
  body => { body.result.id = restoreSentinel; }, body => { body.result.strategy = "other"; },
  body => { body.result.versions[0].version_id = "b".repeat(36); }, body => { body.result.versions[0].percentage = 99; },
  body => { body.result.versions.push(body.result.versions[0]); }]) {
  const body = structuredClone(restoreBody); mutate(body); await restoreCase({ body }, false);
}
await restoreCase({ headers: { "content-length": String(Buffer.byteLength(JSON.stringify(restoreBody))) } });

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
console.log(`console_deploy_safety_validation: PASS (manual-only; 16 original write gates; exclusive preflight/deploy/restore; 2 exact Binance gates; ${cases} offline reader cases; ${sourceCases} source cases; ${restoreCases} restore cases; ${overlayCases} overlay cases; ${configCases} config cases; ${releaseCases} isolated release cases)`);
