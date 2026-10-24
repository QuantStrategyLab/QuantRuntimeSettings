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

// The schema diagnostic is read-only, fixed to the same historical version,
// and is gated inside the existing preflight job. Its projection never emits values.
const schemaStep = steps.find(s => s.startsWith("Read fixed frontend baseline schema categories\n"));
assert.ok(schemaStep && preflight.includes("Read fixed frontend baseline schema categories"));
assert.match(schemaStep, /^        if: inputs\.release_frontend_assets$/m);
const schemaScript = schemaStep.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n          JS/)[1].split("\n").map(l=>l.slice(10)).join("\n");
const runSchema = new (Object.getPrototypeOf(async function(){}).constructor)("process","fetch","console",schemaScript);
let schemaCases = 0;
async function schemaCase(payload, expected=true, status=200, env={}) {
 const stdout=[],stderr=[],calls=[]; const secret="PRIVATE_SCHEMA_SENTINEL";
 const process={env:{GITHUB_REF:"refs/heads/main",CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),CLOUDFLARE_API_TOKEN:secret,...env},exitCode:0};
 await runSchema(process,async(url,options)=>{calls.push({url,options});return new Response(typeof payload==="string"?payload:JSON.stringify(payload),{status,headers:{"content-type":"application/json"}});},{log:x=>stdout.push(x),error:x=>stderr.push(x)});
 assert.equal(process.exitCode===0,expected);assert.equal(calls.length,env.GITHUB_REF?0:1);
 if(calls.length){assert.equal(calls[0].options.method,"GET");assert.equal(calls[0].options.redirect,"error");assert.equal(calls[0].url,`https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/workers/scripts/qsl-strategy-switch-console/versions/2beea000-cce5-43a5-9255-9724f7318e83`);}
 assert.ok(!JSON.stringify({stdout,stderr}).includes(secret));assert.ok(!JSON.stringify({stdout,stderr}).includes("a".repeat(32)));schemaCases++;
 return stdout.length?JSON.parse(stdout[0]):JSON.parse(stderr[0]);
}
const schemaFixture={success:true,result:{id:"2beea000-cce5-43a5-9255-9724f7318e83",resources:{bindings:[{name:"PRIVATE_SCHEMA_SENTINEL",type:"kv_namespace",namespace_id:"PRIVATE_SCHEMA_SENTINEL"},{name:"OTHER",type:"secret_text",text:"PRIVATE_SCHEMA_SENTINEL"}],script:{etag:"PRIVATE_SCHEMA_SENTINEL",handlers:["fetch"],named_handlers:[{name:"PRIVATE_SCHEMA_SENTINEL",handlers:[]}]},script_runtime:{compatibility_date:"2026-06-08",usage_model:"standard"}}}};
const projected=await schemaCase(schemaFixture);assert.equal(projected.script.fields.named_handlers,"array");assert.equal(projected.binding_count,2);assert.equal(projected.binding_categories[0].shape.fields.namespace_id,"string");
const wrongId=structuredClone(schemaFixture);wrongId.result.id="PRIVATE_SCHEMA_SENTINEL";assert.equal((await schemaCase(wrongId)).result_id_matches,false);
const unknownSchema=structuredClone(schemaFixture);unknownSchema.result.resources.PRIVATE_SCHEMA_SENTINEL="PRIVATE_SCHEMA_SENTINEL";unknownSchema.result.resources.bindings[0].type="PRIVATE_SCHEMA_SENTINEL";
assert.equal((await schemaCase(unknownSchema)).resources.unknown_fields,1);
await schemaCase({...schemaFixture,success:false},false);await schemaCase("{",false);await schemaCase("x".repeat(524289),false);
await schemaCase("PRIVATE_SCHEMA_SENTINEL",false,403);await schemaCase(schemaFixture,false,200,{GITHUB_REF:"refs/heads/other"});

// These fixed predicates diagnose an actual rejecting constraint; they do not
// authorize a different date, resource identity or usage model for publication.
const validSchema=structuredClone(schemaFixture);
validSchema.result.resources.bindings=[
 {name:"STRATEGY_SWITCH_CONFIG",type:"kv_namespace",namespace_id:"1".repeat(32)},
 {name:"STRATEGY_SWITCH_RUNTIME_INSTANCES",type:"durable_object_namespace",namespace_id:"2".repeat(32),class_name:"RuntimeInstance"},
 {name:"PRIVATE_SCHEMA_SENTINEL",type:"secret_text"},
 {name:"TEXT",type:"plain_text",text:"PRIVATE_SCHEMA_SENTINEL"},
 {name:"JSON",type:"json",json:{private:"PRIVATE_SCHEMA_SENTINEL"}},
];
const validContracts=(await schemaCase(validSchema)).contracts;
assert.ok(Object.values(validContracts).every(x=>typeof x==="boolean"));
assert.deepEqual(Object.entries(validContracts).filter(([key,value])=>!value).map(([key])=>key),["date_midnight_utc"]);
const diagnosticCases=[
 [x=>x.script_runtime.compatibility_date="2026-06-08T00:00:00Z","date_ymd"],
 [x=>x.script_runtime.usage_model="PRIVATE_SCHEMA_SENTINEL","usage_model"],
 [x=>x.bindings[0].namespace_id="PRIVATE_SCHEMA_SENTINEL","kv_namespace_hex"],
 [x=>x.bindings[1].namespace_id="11111111-1111-4111-8111-111111111111","do_namespace_hex"],
 [x=>x.bindings[1].class_name="PRIVATE/SCHEMA/SENTINEL","do_class_name"],
 [x=>x.bindings.push(structuredClone(x.bindings[0])),"binding_names_unique"],
 [x=>x.script.named_handlers=[{name:"PRIVATE/SCHEMA/SENTINEL",handlers:[]}],"named_handlers"],
 [x=>x.bindings[2].text="PRIVATE_SCHEMA_SENTINEL","secret_shape"],
 [x=>x.script.PRIVATE_SCHEMA_SENTINEL="PRIVATE_SCHEMA_SENTINEL","script_keys"],
 [x=>x.bindings[0].name="PRIVATE_SCHEMA_SENTINEL","required_kv"],
];
for(const [mutate,flag]of diagnosticCases){
 const changed=structuredClone(validSchema);mutate(changed.result.resources);
 const result=await schemaCase(changed);assert.equal(result.contracts[flag],false,flag);
 assert.ok(Object.values(result.contracts).every(x=>typeof x==="boolean"));
 if(flag==="date_ymd")assert.equal(result.contracts.date_midnight_utc,true);
}
for(const [item,flag,fieldType]of [
 [{name:"PRIVATE_SCHEMA_SENTINEL",handlers:null},"named_handler_list_bounds","null"],
 [{name:"PRIVATE_SCHEMA_SENTINEL",handlers:[123]},"named_handler_identifiers","array"],
 [{name:null,handlers:[]},"named_name_format","array"],
 [{name:"PRIVATE_SCHEMA_SENTINEL",handlers:[],PRIVATE_SCHEMA_SENTINEL:"PRIVATE_SCHEMA_SENTINEL"},"named_item_keys","array"],
]){
 const changed=structuredClone(validSchema);changed.result.resources.script.named_handlers=[item];
 const result=await schemaCase(changed);assert.equal(result.contracts[flag],false,flag);
 assert.equal(result.named_handler_categories[0].shape.fields.handlers,fieldType);
 assert.equal(result.named_handler_categories[0].count,1);
 assert.ok(!JSON.stringify(result).includes("PRIVATE_SCHEMA_SENTINEL"));
}
const largerSchema=structuredClone(validSchema);
largerSchema.result.resources.script.named_handlers[0].handlers=Array.from({length:33},(_,i)=>`handler${i}`);
const largerProjection=await schemaCase(largerSchema);
assert.equal(largerProjection.contracts.named_handlers,true);
assert.equal(largerProjection.contracts.named_handler_list_bounds,true);
assert.equal(largerProjection.named_handler_max_entries,33);

// Execute the exact selection shell with a fake Git boundary, never checkout the
// test repository or evaluate any selected Worker. Real object identities are
// separately frozen by the release evidence and the required ancestry check.
const pr764Source = "20dad166be317dd0d57e492ed06e56dfb82b7aef";
const pr764Tree = "7db7dbd1b1749b42187dbc1c9658669fa426ffa6";
const pr764Blob = "de87e1c1c6b62fa94bd514c8936a4ec32e14c0e4";
const pr764Build = "96ff34b994fefc6198da4714a4a7bf44034e05210f9ba1844c545c8cbe542ad6";
const approved = "008da1a936ec4cd4bbe8e4f5bdfce0e19901fe25";
const approvedTree = "7ff88b9cf95dbba3f1c1f0f359b1be1dfde3d71a";
const frontend = "44cf083d52ee5d4cc7cb7fd4ed69facb11070bad";
const frontendTree = "e61e26aeb52ba96b51e9bd0c60f24d40999277fc";
const frontendBlob = "8db5286f88ae31414be98bb84163cb7d6c86f4d9";
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
    'cat-file -e ${approved}^{commit}'|'cat-file -e ${pr764Source}^{commit}') return "$FAKE_OBJECT_EXIT" ;;
    'cat-file -e ${frontend}^{commit}') return "$FAKE_FRONTEND_OBJECT_EXIT" ;;
    'merge-base --is-ancestor ${approved} ${control}'|'merge-base --is-ancestor ${pr764Source} ${control}') return "$FAKE_ANCESTRY_EXIT" ;;
    'merge-base --is-ancestor ${frontend} ${control}') return "$FAKE_FRONTEND_ANCESTRY_EXIT" ;;
    'rev-parse ${approved}^{tree}'|'rev-parse ${pr764Source}^{tree}'|'rev-parse HEAD^{tree}') printf '%s' "$FAKE_TREE" ;;
    'rev-parse ${frontend}^{tree}') printf '%s' "$FAKE_FRONTEND_TREE" ;;
    'rev-parse ${pr764Source}:${assetPath}') printf '%s' "$FAKE_PR764_BLOB" ;;
    'rev-parse ${frontend}:${assetPath}') printf '%s' "$FAKE_FRONTEND_BLOB" ;;
    '-c advice.detachedHead=false checkout --detach ${approved}'|'-c advice.detachedHead=false checkout --detach ${pr764Source}') touch "$SELECTED" ;;
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

// #764 uses the entire pinned source, never the old frontend overlay.
const pr764Env = { RELEASE_SOURCE_SHA: pr764Source, RELEASE_FRONTEND_ASSETS: "true",
  FAKE_TREE: pr764Tree, FAKE_SELECTED_HEAD: pr764Source, FAKE_PR764_BLOB: pr764Blob };
assert.equal(sourceCase(pr764Env, true).selected, true);
for (const delta of [{RELEASE_FRONTEND_ASSETS:"false"}, {SYNC_SECRETS:"true"}, {SYNC_STRATEGY_PROFILES:"true"},
  {SKIP_BINANCE_RECEIVER_CHECKS:"false"}, {GITHUB_REF:"refs/heads/other"}]) {
  assert.deepEqual(sourceCase({...pr764Env,...delta}, false).calls, []);
}
for (const delta of [{FAKE_TREE:"a".repeat(40)}, {FAKE_PR764_BLOB:"a".repeat(40)}, {FAKE_OBJECT_EXIT:"1"},
  {FAKE_ANCESTRY_EXIT:"1"}, {FAKE_CONTROL_HEAD:"a".repeat(40)}]) {
  assert.equal(sourceCase({...pr764Env,...delta}, false).selected, false);
}
assert.equal(sourceCase({...pr764Env,FAKE_SELECTED_HEAD:approved}, false).selected, true);

// The superseded frontend baseline is no longer an admissible release source.
for (const delta of [
  { FAKE_FRONTEND_TREE: "a98498a60753cadc7b010f2e9d9c5a5e34f812f4" },
  { FAKE_FRONTEND_BLOB: "e5c9239bd1da99f0272464a23118c2784926d923" },
]) {
  assert.equal(sourceCase({ RELEASE_FRONTEND_ASSETS: "true", ...delta }, false).selected, false,
    "old frontend baseline must reject before selecting the backend");
}

// Execute the actual overlay shell. Only Git metadata/working-diff boundaries
// are synthetic; hash-object validates the real reviewed map bytes.
const overlayStep = steps.find(step => step.startsWith("Overlay fixed reviewed frontend assets\n"));
assert.ok(overlayStep);
assert.match(overlayStep, /^        if: inputs\.release_frontend_assets && inputs\.source_sha != '20dad166be317dd0d57e492ed06e56dfb82b7aef'$/m);
assert.ok(deploy.indexOf("Build config & assets") < deploy.indexOf("Overlay fixed reviewed frontend assets"));
assert.ok(deploy.indexOf("Overlay fixed reviewed frontend assets") < deploy.indexOf("Validate fixed backend with reviewed frontend"));
assert.match(deploy, /Validate fixed backend with reviewed frontend[\s\S]*?node tests\/console_v2_assets_validation\.mjs\n          node tests\/console_v2_worker_validation\.mjs/);
const overlayShell = shellBody(overlayStep);
const frozenMap = spawnSync("git", ["show", `${frontend}:${assetPath}`], { cwd: new URL("..", import.meta.url) });
assert.equal(frozenMap.status, 0, "the approved historical frontend fixture must be available");
const reviewedMap = frozenMap.stdout;
const frozenHash = spawnSync("git", ["hash-object", "--stdin"], { input: reviewedMap, encoding: "utf8" });
assert.equal(frozenHash.status, 0);
assert.equal(frozenHash.stdout.trim(), frontendBlob, "verify the fixture against the unchanged approved blob");
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
  { FAKE_FRONTEND_TREE: approvedTree },
  { FAKE_FRONTEND_TREE: "a98498a60753cadc7b010f2e9d9c5a5e34f812f4" },
  { FAKE_DIFF: assetPath + "\nweb/strategy-switch-console/worker.js" },
  { FAKE_DIFF: assetPath + "\nplatform-config.json" },
  { FAKE_DIFF: assetPath + "\nweb/strategy-switch-console/wrangler.toml" },
  { FAKE_DIFF: "" }, { FAKE_UNTRACKED: "unreviewed-runtime.js" }]) overlayCase(delta, false);
overlayCase({}, false, Buffer.concat([reviewedMap, Buffer.from("\n// corrupt synthetic input")]));
const currentMap = readFileSync(new URL("../" + assetPath, import.meta.url));
if (!currentMap.equals(reviewedMap)) overlayCase({}, false, currentMap);

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
const publishStep = steps.find(s => s.startsWith("Publish fixed reviewed website Worker version\n"));
const bundleStep = steps.find(s => s.startsWith("Build reviewed website Worker bundle without publishing\n"));
const normalDeploy = steps.find(s => s.startsWith("Deploy Worker\n"));
assert.match(normalDeploy, /if: \$\{\{ !inputs\.release_frontend_assets \}\}/);
assert.match(normalDeploy, /npx wrangler@4\.106\.0 deploy --config wrangler\.toml\n/);
assert.match(bundleStep, /WRANGLER_SEND_METRICS: "false"/);
assert.match(bundleStep, /deploy --dry-run --config wrangler\.toml --outdir/);
for (const s of [bundleStep,publishStep]) assert.match(s, /^        if: inputs\.release_frontend_assets$/m);
assert.doesNotMatch(publishStep, /npx|triggers deploy|secret put|script-settings|\/schedules|\/routes/);
assert.match(workflow, /group: strategy-switch-console-deploy\n  cancel-in-progress: false/);
const releaseScript = publishStep.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n          JS/)[1].split("\n").map(l=>l.slice(10)).filter(l=>!l.startsWith("import ")).join("\n");
const runRelease = new (Object.getPrototypeOf(async function(){}).constructor)("process","fetch","console","readFile","createHash","readdir",releaseScript);
assert.doesNotMatch(publishStep, /2beea000|6107ffd9|pre_upload_latest|latest\(prior\)/);
assert.match(publishStep, /stage = 'pre_upload_active'; await active\(priorDeployment, prior\)/);
assert.match(publishStep, /stage = 'pre_deploy_latest'; await latest\(uploaded\)/);
assert.match(publishStep, /stage = 'activate'; deployAttempted = true/);
const priorVersion="00000000-0000-4000-8000-000000000010", priorDeployment="00000000-0000-4000-8000-000000000011";
const syntheticBuildId = createHash("sha256").update("synthetic frontend").digest("hex");
const syntheticAssetMap = `export const V2_BUILD_ID = "${syntheticBuildId}";`;
const syntheticBundle=Buffer.from(`var V2_BUILD_ID = "${syntheticBuildId}";\nexport default { fetch(){} }; // synthetic bundle`);
const bundleFiles = ["README.md", "worker.js", "worker.js.map"];
const dirent = (name, regular=true) => ({name,isFile:()=>regular});
const scriptResponse=(body,headers={})=>new Response(body,{headers:{"content-type":"application/javascript",...headers}});
function multipartScript(body=syntheticBundle, mutate=()=>{}) {
 const form=new FormData();form.append("worker.js",new File([body],"worker.js",{type:"application/javascript+module"}));mutate(form);
 return new Response(form,{headers:{"cf-entrypoint":"worker.js"}});
}
const newVersion="00000000-0000-4000-8000-000000000002", newDeployment="00000000-0000-4000-8000-000000000003", privateRelease="PRIVATE_RELEASE_SENTINEL";
const remoteBindings=[{name:"STRATEGY_SWITCH_CONFIG",type:"kv_namespace",namespace_id:"b".repeat(32)},
 {name:"STRATEGY_SWITCH_RUNTIME_INSTANCES",type:"durable_object_namespace",namespace_id:"c".repeat(32),class_name:"RuntimeInstances"},
 {name:"FLAG",type:"plain_text",text:privateRelease},{name:"DATA",type:"json",json:{private:privateRelease}},{name:"SECRET",type:"secret_text"}];
const runtime={compatibility_date:"2026-06-08",compatibility_flags:[],usage_model:"standard",limits:{},migration_tag:"runtime-instances-v1",exports:{RuntimeInstances:{type:"durable-object",storage:"sqlite"}}};
const resource=etag=>({bindings:structuredClone(remoteBindings),script_runtime:structuredClone(runtime),script:{etag,handlers:["fetch","scheduled"],named_handlers:[{name:"RuntimeInstances",handlers:[]}],last_deployed_from:"api"}});
const wrap=result=>({success:true,errors:[],result}), dep=(id,v)=>({id,strategy:"percentage",versions:[{version_id:v,percentage:100}]});
const responseSequence=(alreadyActive)=>[wrap({deployments:[dep(priorDeployment,priorVersion)]}),wrap({id:priorVersion,resources:resource("old-code")}),
 scriptResponse(alreadyActive ? syntheticBundle : "export default {}; // " + privateRelease),
 wrap({deployments:[dep(priorDeployment,priorVersion)]}),wrap({id:newVersion}),wrap({id:newVersion,resources:resource("new-code")}),
 wrap({deployments:[dep(priorDeployment,priorVersion)]}),wrap({id:newVersion,resources:resource("new-code")}),wrap(dep(newDeployment,newVersion)),wrap({deployments:[dep(newDeployment,newVersion)]})];
const apiSequence=[["/deployments?page=1&per_page=10","GET"],[`/versions/${priorVersion}`,"GET"],["/content/v2","GET"],["/deployments?page=1&per_page=10","GET"],["/versions?bindings_inherit=strict","POST"],
 [`/versions/${newVersion}`,"GET"],["/deployments?page=1&per_page=10","GET"],[`/versions/${newVersion}`,"GET"],["/deployments?force=false","POST"],["/deployments?page=1&per_page=10","GET"]];
let releaseCases=0;
async function releaseCase({pr764=false,inheritVersion=priorVersion,inheritedPredecessor=priorVersion,mutate=()=>{},env={},failAt=-1,responseAt=-1,response,readError=false,alreadyActive=false,bundle=syntheticBundle,assetMap=syntheticAssetMap,files=bundleFiles.map(name=>dirent(name))}={}, expected=true,count=10){
 if(pr764){
  bundle=Buffer.from(bundle.toString().replace(syntheticBuildId,pr764Build));
  assetMap=assetMap.replace(syntheticBuildId,pr764Build);
  env={RELEASE_SOURCE_SHA:pr764Source,...env};
 }
 const responses=responseSequence(alreadyActive);
 if(pr764)responses.push(wrap({id:newVersion,resources:resource("new-code")}));
 mutate(responses);
 if(pr764){
  responses.splice(3,0,wrap({items:[{id:inheritVersion}]}));
  responses.splice(7,0,wrap({items:[{id:newVersion},{id:inheritedPredecessor}]}));
 }
 const calls=[],stdout=[],stderr=[];
 const process={env:{GITHUB_REF:"refs/heads/main",CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),CLOUDFLARE_API_TOKEN:privateRelease,RUNNER_TEMP:"/synthetic",WORKER_DIR:"web/strategy-switch-console",STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID:"d".repeat(32),...env},exitCode:0};
 await runRelease(process,async(url,options)=>{const i=calls.length;calls.push({url,options});if(i===failAt)throw Error(privateRelease);if(i===responseAt)return response;
  assert.ok(i<responses.length,"no retry/page expansion");return responses[i] instanceof Response ? responses[i] : new Response(JSON.stringify(responses[i]),{headers:{"content-type":"application/json"}});
 },{log:x=>stdout.push(x),error:x=>stderr.push(x)},async path=>{if(readError)throw Error(privateRelease);
  if(path==="web/strategy-switch-console/v2_asset_map.js")return assetMap;
  assert.equal(path,"/synthetic/console-frontend-bundle/worker.js");return bundle;},createHash,
  async(path,options)=>{assert.equal(path,"/synthetic/console-frontend-bundle");assert.deepEqual(options,{withFileTypes:true});return files;});
 assert.equal(process.exitCode===0,expected,stderr.join("\n"));assert.equal(calls.length,count);
 assert.ok(!JSON.stringify({stdout,stderr}).includes(privateRelease));assert.ok(!JSON.stringify({stdout,stderr}).includes("a".repeat(32)));
 for(const [actual,{url,options}] of calls.entries()){
  if(pr764 && actual===3){assert.ok(url.endsWith("/versions?page=1&per_page=10"));assert.equal(options.method,"GET");continue;}
  if(pr764 && actual===7){assert.ok(url.endsWith("/versions?page=1&per_page=10"));assert.equal(options.method,"GET");continue;}
  const i=actual-(pr764 && actual>3?1:0)-(pr764 && actual>7?1:0);
  assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/workers/scripts/qsl-strategy-switch-console`+(i===10?`/versions/${newVersion}`:apiSequence[i][0]));
  assert.equal(options.headers["Accept-Encoding"],"identity");assert.equal(options.method,i===10?"GET":apiSequence[i][1]);assert.equal(options.redirect,"error");assert.ok(options.signal instanceof AbortSignal);assert.equal(options.headers.Authorization,`Bearer ${privateRelease}`);
  if(options.method==="GET")assert.equal(options.body,undefined);
  if(i===4){assert.deepEqual(Buffer.from(await options.body.get("worker.js").arrayBuffer()),bundle);assert.ok(options.body instanceof FormData);assert.deepEqual([...options.body.keys()],["metadata","worker.js"]);const m=JSON.parse(options.body.get("metadata"));
   assert.deepEqual(m.bindings,remoteBindings.map(b=>({type:"inherit",name:b.name})));
   assert.deepEqual(Object.keys(m).sort(),["main_module","bindings","compatibility_date","compatibility_flags","usage_model","limits","annotations"].sort());
   assert.ok(!JSON.stringify(m).includes(privateRelease));assert.ok(!JSON.stringify(m).includes("d".repeat(32)),"Environment namespace must not rebind existing KV");assert.equal(options.headers["Content-Type"],undefined);}
  if(i===8)assert.deepEqual(JSON.parse(options.body),{strategy:"percentage",versions:[{version_id:newVersion,percentage:100}],annotations:{"workers/message":pr764?"Reviewed PR764 full source; retained configuration":"Reviewed website backend 008da1a9 and frontend 44cf083; retained configuration"}});
 }
 if(expected){
  if(pr764){const h=JSON.parse(stdout[0]);assert.equal(h.status,"pr764_configuration_verified");
   assert.match(h.config_before_sha256,/^[a-f0-9]{64}$/);assert.equal(h.config_before_sha256,h.config_uploaded_sha256);
   assert.equal(h.config_before_sha256,h.config_after_sha256);assert.equal(h.secret_values_read,false);}
  const r=JSON.parse(stdout.at(-1));assert.equal(r.status,"frontend_release_verified");assert.equal(r.bundle_sha256,createHash("sha256").update(bundle).digest("hex"));assert.equal(r.version_id,newVersion);assert.equal(r.deployment_id,newDeployment);assert.equal(r.bindings_equal,true);assert.equal(r.runtime_equal,true);assert.equal(r.provider_cas,false);}
 else{assert.equal(stdout.length,0);const error=JSON.parse(stderr.at(-1));assert.equal(error.retry,false);
  assert.equal(error.upload_attempted,calls.length>=(pr764?6:5));
  assert.equal(error.deploy_attempted,calls.length>=(pr764?11:9));
 }
 releaseCases++;return {calls,stdout,stderr};
}
await releaseCase({pr764:true},true,13);
await releaseCase({pr764:true,inheritVersion:newVersion},false,4);
// Another uploader inserted a version with different opaque Secret values after
// the first baseline GET. Equal visible resource hashes must not allow activation.
await releaseCase({pr764:true,inheritedPredecessor:"00000000-0000-4000-8000-000000000099"},false,8);
await releaseCase({pr764:true,assetMap:syntheticAssetMap.replace(syntheticBuildId,"f".repeat(64)),
 bundle:Buffer.from(syntheticBundle.toString().replace(syntheticBuildId,"f".repeat(64)))},false,2);
for(const index of [5,10]){
 for(const mutate of [r=>r.bindings[2].text="changed",r=>r.script_runtime.compatibility_date="2026-06-09",
  r=>r.bindings[0].namespace_id="e".repeat(32),r=>r.script.placement_mode="smart",r=>r.script.named_handlers=[]]){
  const result=await releaseCase({pr764:true,mutate:r=>mutate(r[index].result.resources)},false,index+1+(index>=3?1:0)+(index>=6?1:0));
  assert.equal(JSON.parse(result.stderr.at(-1)).deploy_attempted,index===10);
 }
}
await releaseCase({pr764:true,failAt:12},false,13);
// Canonical ordering is immaterial; resource values and handler contracts are not.
await releaseCase({pr764:true,mutate:r=>{r[5].result.resources.bindings.reverse();r[10].result.resources.bindings.reverse();}},true,13);

await releaseCase();await releaseCase({env:{STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID:"e".repeat(32)}}); // H's namespace drift no longer affects inherited configuration
await releaseCase({mutate:r=>r[0].result.deployments.push(dep(newDeployment,newVersion))}); // Only the first deployment is active.
// FE-RELEASE-08: even identical entrypoint bytes must upload and activate.
// /content/v2 is script-scoped, so its bytes cannot prove the active version.
// This also covers frontend-only changes outside an unchanged entrypoint.
assert.doesNotMatch(publishStep, /frontend_release_already_active|activeSha256/);
await releaseCase({alreadyActive:true});
await releaseCase({alreadyActive:true,responseAt:2,response:multipartScript()});
await releaseCase({responseAt:2,response:multipartScript("export default {}; // different")});
await releaseCase({alreadyActive:true,responseAt:2,response:scriptResponse(syntheticBundle,{"content-type":"text/javascript; charset=utf-8","content-length":String(syntheticBundle.length)})});
for (const drift of [d=>{d.id=newDeployment;},d=>{d.versions[0].version_id=newVersion;},d=>{d.versions[0].percentage=99;}]) {
 await releaseCase({alreadyActive:true,mutate:r=>drift(r[3].result.deployments[0])},false,4);
}
await releaseCase({alreadyActive:true,failAt:3},false,4);
for (const change of [
 x=>{x.result.deployments=[];}, x=>{x.result.deployments=Array(11).fill(dep(priorDeployment,priorVersion));},
 x=>{x.result.deployments[0].strategy="other";}, x=>{x.result.deployments[0].versions=[];},
 x=>{x.result.deployments[0].versions.push({version_id:newVersion,percentage:0});},
 x=>{x.result.deployments[0].versions[0].version_id="not-a-uuid";},
 x=>{x.result.deployments[0].versions[0].percentage="100";}, x=>{x.result.deployments[0].versions[0].percentage=99;}
]) await releaseCase({mutate:r=>change(r[0])},false,1);
await releaseCase({mutate:r=>{for(const x of r)if(!(x instanceof Response))x.errors=null;}});
for (const body of [Buffer.alloc(0),Buffer.alloc(10485761)]) await releaseCase({bundle:body},false,2);
// Fail before upload for an incomplete/unknown dry-run structure or stale build.
for (const files of [[], bundleFiles.slice(1).map(name=>dirent(name)),
 [...bundleFiles,"v2_asset_map.js"].map(name=>dirent(name)),
 [dirent("README.md"),dirent("worker.js",false),dirent("worker.js.map")],
 [dirent("README.md"),dirent("worker.js"),dirent("worker.js")]]) {
 await releaseCase({files},false,2);
}
for (const assetMap of ["", syntheticAssetMap.replace(syntheticBuildId,"invalid"),
 syntheticAssetMap.replace(syntheticBuildId,"f".repeat(64)), `${syntheticAssetMap}\n${syntheticAssetMap}`]) {
 const rejected=await releaseCase({assetMap},false,2);
 assert.equal(JSON.parse(rejected.stderr.at(-1)).checkpoint,"bundle_build_id");
}
for (const bundle of [Buffer.from("export default {};"),
 Buffer.from(syntheticBundle.toString().replace(syntheticBuildId,"f".repeat(64)))]) {
 await releaseCase({bundle},false,2);
}
// Two frontend builds with the same source entrypoint still take both writes.
const nextBuildId=createHash("sha256").update("changed asset map and static asset").digest("hex");
const changedFrontend=await releaseCase({assetMap:syntheticAssetMap.replace(syntheticBuildId,nextBuildId),
 bundle:Buffer.from(syntheticBundle.toString().replace(syntheticBuildId,nextBuildId)), responseAt:2,response:scriptResponse(syntheticBundle)});
assert.equal(changedFrontend.calls.filter(call=>call.options.method==="POST").length,2);

for (const response of [
 scriptResponse("",{}), scriptResponse(privateRelease,{"content-type":"text/html"}),
 scriptResponse(privateRelease,{"content-type":"application/json"}), scriptResponse(privateRelease,{"content-encoding":"gzip"}),
 scriptResponse(privateRelease,{"content-length":"10485761"}), scriptResponse(privateRelease,{"content-length":"invalid"}),
 scriptResponse(privateRelease,{"content-length":"1"}), scriptResponse("x".repeat(10485761)),
 new Response(privateRelease,{status:403}),new Response(null,{status:204,headers:{"content-type":"application/javascript"}}),
 scriptResponse(new ReadableStream({pull(c){c.error(Error(privateRelease));}})),
 scriptResponse("malformed",{"content-type":"multipart/form-data; boundary=synthetic"}),
 scriptResponse("x".repeat(10551297),{"content-type":"multipart/form-data; boundary=synthetic"}),
 scriptResponse("x",{"content-type":"multipart/form-data; boundary=synthetic","content-length":"10551297"}),
 multipartScript(syntheticBundle,f=>f.delete("worker.js")),
 multipartScript(syntheticBundle,f=>f.append("extra.js",new File(["extra"],"extra.js",{type:"application/javascript+module"}))),
 multipartScript(syntheticBundle,f=>f.append("worker.js",new File([syntheticBundle],"worker.js",{type:"application/javascript+module"}))),
 multipartScript(syntheticBundle,f=>f.set("worker.js",new File([syntheticBundle],"other.js",{type:"application/javascript+module"}))),
 multipartScript(syntheticBundle,f=>f.set("worker.js",new File([syntheticBundle],"worker.js",{type:"text/html"}))),
 multipartScript(syntheticBundle,f=>f.set("worker.js","not-a-file")),
 multipartScript(Buffer.alloc(0)),multipartScript(Buffer.alloc(10485761)),
]) await releaseCase({responseAt:2,response},false,3);
const wrongEntrypoint=multipartScript();wrongEntrypoint.headers.set("cf-entrypoint","other.js");
await releaseCase({responseAt:2,response:wrongEntrypoint},false,3);
// Hash byte content, preserving even invalid UTF-8 rather than decoding/re-encoding.
const binaryBundle=Buffer.concat([Buffer.from([0xff,0xfe,0x00,0x0d,0x0a]),syntheticBundle]);
await releaseCase({alreadyActive:true,bundle:binaryBundle,responseAt:2,response:scriptResponse(binaryBundle)});
const handlerList = Array.from({length:33},(_,i)=>`handler${i}`);
const largerAbi = responses => {for(const i of [1,5])responses[i].result.resources.script.named_handlers[0].handlers=[...handlerList];};
await releaseCase({mutate:largerAbi});
for(const drift of [handlers=>handlers.pop(),handlers=>handlers.push("newHandler"),handlers=>{handlers[32]="changedHandler";}]){
 await releaseCase({mutate:r=>{largerAbi(r);drift(r[5].result.resources.script.named_handlers[0].handlers);}},false,6);
}
await releaseCase({mutate:r=>{largerAbi(r);r[1].result.resources.script.named_handlers[0].handlers[32]=null;}},false,2);
await releaseCase({mutate:r=>{largerAbi(r);r[5].result.resources.script.named_handlers[0].PRIVATE_RELEASE_SENTINEL=true;}},false,6);
const oversizedResource=resource("old-code");
oversizedResource.script.named_handlers[0].handlers=Array.from({length:50000},(_,i)=>`handler${i}`);
const oversizedResourceJson=JSON.stringify(wrap({id:priorVersion,resources:oversizedResource}));
assert.ok(Buffer.byteLength(oversizedResourceJson)>524288);
await releaseCase({responseAt:1,response:new Response(oversizedResourceJson,{headers:{"content-type":"application/json"}})},false,2);
for(const env of [{GITHUB_REF:"refs/heads/unapproved"},{CLOUDFLARE_API_TOKEN:""},{CLOUDFLARE_ACCOUNT_ID:"bad"}])await releaseCase({env},false,0);
await releaseCase({readError:true},false,2);
for(let i=0;i<10;i++)await releaseCase({failAt:i},false,i+1);
for(const [at,change] of [
 [0,x=>{x.result.deployments[0].id="invalid";}],[1,x=>{x.result.id=newVersion;}],[1,x=>{x.result.resources.bindings.push(x.result.resources.bindings[0]);}],
 [1,x=>{delete x.result.resources.bindings[0].namespace_id;}],[1,x=>{delete x.result.resources.bindings[1].class_name;}],
 [1,x=>{x.result.resources.bindings[0].namespace_id={private:privateRelease};}],
 [1,x=>{delete x.result.resources.bindings[2].text;}],[1,x=>{delete x.result.resources.bindings[3].json;}],
 [1,x=>{x.result.resources.bindings[4].text=privateRelease;}],
 [1,x=>{x.result.resources.script.named_handlers={};}],
 [1,x=>{delete x.result.resources.script.named_handlers[0].name;}],
 [1,x=>{x.result.resources.script.named_handlers[0].handlers="PRIVATE_RELEASE_SENTINEL";}],
 [1,x=>{x.result.resources.script.named_handlers.push(x.result.resources.script.named_handlers[0]);}],
 [1,x=>{x.result.resources.script_runtime.unknown=privateRelease;}],[1,x=>{x.result.resources.bindings[0].type="service";}],[1,x=>{x.result.resources.assets={};}],
 [3,x=>{x.result.deployments[0].id=newDeployment;}],[4,x=>{x.result.id="untrusted";}],
 [5,x=>{x.result.resources.bindings[0].namespace_id="e".repeat(32);}],[5,x=>{x.result.resources.bindings.pop();}],[5,x=>{x.result.resources.bindings[2].text="different";}],
 [5,x=>{x.result.resources.script_runtime.compatibility_date="2026-06-09";}],[5,x=>{x.result.resources.script_runtime.limits={cpu_ms:1};}],
 [5,x=>{x.result.resources.script_runtime.migration_tag="changed";}],[5,x=>{x.result.resources.script.named_handlers[0].name="ChangedExport";}],
 [5,x=>{x.result.resources.script.named_handlers[0].handlers=["alarm"];}],
 [5,x=>{x.result.resources.script.handlers=["fetch"];}],[5,x=>{x.result.resources.script.etag="old-code";}],
 [6,x=>{x.result.deployments[0].versions[0].version_id=newVersion;}],[7,x=>{x.result.id=priorVersion;}],[8,x=>{x.result.versions[0].percentage=99;}],[9,x=>{x.result.deployments[0].id=priorDeployment;}]
])await releaseCase({mutate:r=>change(r[at])},false,at+1);
for (const corrupt of [b=>{delete b.namespace_id;},b=>{b.namespace_id={private:privateRelease};}]) {
 await releaseCase({mutate:r=>{for(const i of [1,5])corrupt(r[i].result.resources.bindings[0]);}},false,2);
}
await releaseCase({mutate:r=>{for(const i of [1,5])delete r[i].result.resources.bindings[1].class_name;}},false,2);
for(const [at,response] of [
 [0,new Response(privateRelease,{status:403})],[4,new Response(privateRelease,{status:500})],[8,new Response(JSON.stringify({success:false,errors:[{code:10220,message:privateRelease}]}),{status:400})],
 [1,new Response("{",{headers:{"content-type":"application/json"}})],[1,new Response("x".repeat(524289),{headers:{"content-type":"application/json"}})],
 [1,new Response(privateRelease,{headers:{"content-type":"text/html"}})],[1,new Response("{}",{headers:{"content-type":"application/json","content-encoding":"gzip"}})],
 [1,new Response("{}",{headers:{"content-type":"application/json","content-length":"524289"}})],[1,new Response("{}",{headers:{"content-type":"application/json","content-length":"1"}})],
 [1,new Response(new ReadableStream({pull(c){c.error(Error(privateRelease));}}),{headers:{"content-type":"application/json"}})]
])await releaseCase({responseAt:at,response},false,at+1);

// FE-RELEASE-06: the final version confirmation reads the uploaded ID directly.
// List order and membership cannot affect it; only a matching result.id passes.
for (const result of [{}, null, {id:priorVersion}, {id:null}, {id:newVersion + "\n"},
 {items:[{id:newVersion}]}, {items:[{id:priorVersion},{id:newVersion}]}]) {
 const rejected = await releaseCase({mutate:r=>{r[7].result=result;}},false,8);
 const error = JSON.parse(rejected.stderr.at(-1));
 assert.equal(error.error,"frontend_release_stopped");
 assert.equal(error.stage,"pre_deploy_latest");assert.equal(error.checkpoint,"result_validation");
 assert.equal(error.uploaded_version,newVersion);assert.equal(error.deploy_attempted,false);
 assert.equal(rejected.calls.filter(c=>c.options.method==="POST" && c.url.includes("/deployments")).length,0);
}
for (const status of [403,404,500]) {
 const rejected = await releaseCase({responseAt:7,response:new Response(privateRelease,{status})},false,8);
 const error = JSON.parse(rejected.stderr.at(-1));
 assert.equal(error.error,"frontend_release_stopped");
 assert.equal(error.stage,"pre_deploy_latest");assert.equal(error.checkpoint,"http_status");
 assert.equal(error.http_status,status);assert.equal(error.uploaded_version,newVersion);
 assert.equal(rejected.calls.filter(c=>c.options.method==="POST" && c.url.includes("/deployments")).length,0);
}

// FE-RELEASE-03: execute the production parser, preserving all gates and the
// one-shot write sequence. Only allowlisted response metadata reaches stderr.
let activationCases = 0;
async function activationCase(options = {}, checkpoint = null) {
 const run = await releaseCase(options, checkpoint === null, checkpoint === null ? 10 : 9);
 const records = run.stderr.map(line => JSON.parse(line));
 const evidence = records[0];
 assert.equal(evidence.stage, "activate");
 assert.deepEqual(Object.keys(evidence).sort(), ["stage", "http_status", "content_type", "top_level_keys",
  "result_id_present", "result_id_uuid", "strategy", "versions_count", "percentages", "errors_keys", "errors_count"].sort());
 assert.ok(!JSON.stringify(records).includes(newDeployment), "evidence never emits the deployment id");
 if (checkpoint !== null) {
  const error = records.at(-1);
  assert.equal(error.checkpoint, checkpoint);
  assert.equal(error.stage, "activate");
  assert.equal(error.outcome, "UNKNOWN_REQUIRES_READBACK");
  assert.equal(error.retry, false);
  assert.equal(run.stdout.length, 0, "UNKNOWN must never produce a success receipt");
  assert.equal(run.calls.filter(call => call.options.method === "POST").length, 2, "no retry or compensating write");
 } else assert.equal(records.length, 1);
 activationCases++;
 return evidence;
}
const activationEvidence = await activationCase();
assert.deepEqual(activationEvidence, {stage:"activate",http_status:200,content_type:"application/json",
 top_level_keys:["success","errors","result"],result_id_present:true,result_id_uuid:true,strategy:"percentage",
 versions_count:1,percentages:[100],errors_keys:[],errors_count:0});
for (const [change, checkpoint] of [
 [x=>{delete x.result;},"missing_id"], [x=>{x.result=null;},"missing_id"],
 [x=>{delete x.result.id;},"missing_id"], [x=>{x.result.id=privateRelease;},"invalid_id"],
 [x=>{x.result.id={token:privateRelease};},"invalid_id"],
 [x=>{x.result.strategy=null;},"invalid_strategy"], [x=>{x.result.strategy=privateRelease;},"invalid_strategy"],
 [x=>{x.result.strategy={token:privateRelease};},"invalid_strategy"],
 [x=>{x.result.versions=null;},"invalid_versions"], [x=>{x.result.versions={token:privateRelease};},"invalid_versions"],
 [x=>{x.result.versions=[];},"invalid_versions"], [x=>{x.result.versions.push({percentage:0});},"invalid_versions"],
 [x=>{delete x.result.versions[0].version_id;},"version_mismatch"],
 [x=>{x.result.versions[0].version_id=priorVersion;},"version_mismatch"],
 [x=>{x.result.versions[0].version_id={token:privateRelease};},"version_mismatch"],
 [x=>{delete x.result.versions[0].percentage;},"percentage_mismatch"],
 [x=>{x.result.versions[0].percentage="100";},"percentage_mismatch"],
 [x=>{x.result.versions[0].percentage={token:privateRelease};},"percentage_mismatch"],
 [x=>{x.result.versions[0].percentage=99;},"percentage_mismatch"],
 [x=>{x.success=false;},"envelope_success"], [x=>{x.errors={token:privateRelease};},"envelope_errors"],
 [x=>{x.errors=[{code:123,message:privateRelease,[privateRelease]:privateRelease}];},"envelope_errors"],
]) await activationCase({mutate:r=>change(r[8])},checkpoint);
// FE-RELEASE-10: Wrangler 4.106.0 types createDeployment's result as { id }.
// Omitted echo fields require the same exact active id/version/100% readback.
let omittedActivationCases = 0;
for (const fields of [["strategy"], ["versions"], ["strategy", "versions"]]) {
 const omit = r => { for (const field of fields) delete r[8].result[field]; };
 await activationCase({mutate:omit}); omittedActivationCases++;
 for (const options of [
  {failAt:9},
  {change:x=>{x.success=false;}}, {change:x=>{x.errors=[{message:privateRelease}];}},
  {change:x=>{x.result.deployments=[];}},
  {change:x=>{x.result.deployments[0].id=priorDeployment;}},
  {change:x=>{x.result.deployments[0].versions[0].version_id=priorVersion;}},
  {change:x=>{x.result.deployments[0].versions[0].percentage=99;}},
  {change:x=>{x.result.deployments[0].versions[0].percentage="100";}},
  {change:x=>{x.result.deployments[0].strategy="other";}},
  {change:x=>{x.result.deployments[0].versions.push({version_id:priorVersion,percentage:0});}},
 ]) {
  const run=await releaseCase({failAt:options.failAt,mutate:r=>{omit(r);options.change?.(r[9]);}},false,10);
  const error=JSON.parse(run.stderr.at(-1));
  assert.equal(error.stage,"readback");assert.equal(error.outcome,"UNKNOWN_REQUIRES_READBACK");
  assert.equal(run.calls.filter(call=>call.options.method==="POST").length,2,"readback failure never retries writes");
  omittedActivationCases++;
 }
 // A missing echo field cannot hide a contradictory field or an invalid id/envelope.
 for (const [change,checkpoint] of [
  [x=>{x.id=privateRelease;},"invalid_id"],
  [x=>{x.strategy="other";},"invalid_strategy"],
  [x=>{x.versions=[];},"invalid_versions"],
  [x=>{x.versions=[{version_id:priorVersion,percentage:100}];},"version_mismatch"],
  [x=>{x.versions=[{version_id:newVersion,percentage:99}];},"percentage_mismatch"],
 ]) { await activationCase({mutate:r=>{omit(r);change(r[8].result);}},checkpoint); omittedActivationCases++; }
 await activationCase({mutate:r=>{omit(r);r[8].errors=[{message:privateRelease}];}},"envelope_errors");
 omittedActivationCases++;
}
console.log(`FE-RELEASE-10 omitted activation/readback: ${omittedActivationCases} cases passed`);
const redacted = await activationCase({mutate:r=>{
 const x=r[8]; x[privateRelease]={token:privateRelease,account:privateRelease,url:"https://invalid/?token="+privateRelease};
 x.result.annotations={token:privateRelease};x.result.versions[0].token=privateRelease;
}});
assert.ok(redacted.top_level_keys.includes("[redacted]"));
const redactedErrors = await activationCase({mutate:r=>{r[8].errors=[{code:123,message:privateRelease,[privateRelease]:privateRelease}];}},"envelope_errors");
assert.deepEqual(redactedErrors.errors_keys,["code","message","[redacted]"]);
assert.equal(redactedErrors.errors_count,1);
await activationCase({mutate:r=>{r[8].errors=null;}});
for (const [response, checkpoint] of [
 [new Response(privateRelease,{status:403,headers:{"content-type":"text/plain; token="+privateRelease}}),"http_status"],
 [new Response(new ReadableStream({start(c){c.error(Error(privateRelease));}}),
  {status:403,headers:{"content-type":"application/json"}}),"http_status"],
 [new Response(new ReadableStream({start(c){c.error(Error(privateRelease));}}),
  {headers:{"content-type":"text/html"}}),"response_content_type"],
 [new Response(privateRelease,{headers:{"content-type":"text/html; token="+privateRelease}}),"response_content_type"],
 [new Response("{}",{headers:{"content-type":"application/json","content-encoding":"gzip"}}),"response_content_encoding"],
 [new Response("{}",{headers:{"content-type":"application/json","content-length":"524289"}}),"response_content_length"],
 [new Response("{}",{headers:{"content-type":"application/json","content-length":"1"}}),"response_length_mismatch"],
 [new Response("x".repeat(524289),{headers:{"content-type":"application/json"}}),"response_size"],
 [new Response("{",{headers:{"content-type":"application/json"}}),"response_json"],
 [new Response(new Uint8Array([255]),{headers:{"content-type":"application/json"}}),"response_utf8"],
 [new Response(new ReadableStream({pull(c){c.error(Error(privateRelease));}}),{headers:{"content-type":"application/json"}}),"response_stream"],
 [new Response(null,{status:204,headers:{"content-type":"application/json"}}),"response_body"],
]) await activationCase({responseAt:8,response},checkpoint);
await activationCase({failAt:8},"request");
await activationCase({responseAt:8,response:new Response(JSON.stringify(wrap(dep(newDeployment,newVersion))), {
 headers:{"content-type":"application/json; token="+privateRelease}})});
console.log(`FE-RELEASE-03 activation evidence/checkpoints: ${activationCases} cases passed`);

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

// FE-RELEASE-11 restores an existing exact version, then verifies the active id/version/100%.
const fe11Target="c8dc4852-fa9d-4d14-bca3-7941587a494f";
let fe11Cases=0;
async function fe11Case({mutate=()=>{},env={},failAt=-1}={},expected=true,count=3){
 const replies=[wrap({id:fe11Target}),wrap({id:restoreId}),wrap({deployments:[dep(restoreId,fe11Target)]})];
 mutate(replies);const calls=[],stdout=[],stderr=[];
 const process={env:{GITHUB_REF:"refs/heads/main",CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),
  CLOUDFLARE_API_TOKEN:restoreSentinel,ROLLBACK_VERSION:fe11Target,...env},exitCode:0};
 await runRestore(process,async(url,options)=>{const i=calls.length;calls.push({url,options});
  if(i===failAt)throw Error(restoreSentinel);assert.ok(i<3,"never retry");
  return new Response(JSON.stringify(replies[i]),{headers:{"content-type":"application/json"}});
 },{log:x=>stdout.push(x),error:x=>stderr.push(x)});
 assert.equal(process.exitCode===0,expected,stderr.join("\n"));assert.equal(calls.length,count);
 assert.ok(!JSON.stringify({stdout,stderr}).includes(restoreSentinel));
 for(const [i,{url,options}]of calls.entries()){
  assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/workers/scripts/qsl-strategy-switch-console`+
   [`/versions/${fe11Target}`,"/deployments?force=false","/deployments?page=1&per_page=10"][i]);
  assert.equal(options.redirect,"error");assert.equal(options.method,i===1?"POST":"GET");
  if(i===1)assert.deepEqual(JSON.parse(options.body).versions,[{version_id:fe11Target,percentage:100}]);
  else assert.equal(options.body,undefined);
 }
 if(expected){assert.equal(JSON.parse(stdout[0]).version_id,fe11Target);assert.equal(JSON.parse(stdout[0]).percentage,100);}
 else{assert.equal(stdout.length,0);assert.equal(JSON.parse(stderr[0]).outcome,count>1?"UNKNOWN_REQUIRES_READBACK":"NOT_ATTEMPTED");}
 fe11Cases++;
}
await fe11Case();
for(const env of [{ROLLBACK_VERSION:"a".repeat(36)},{GITHUB_REF:"refs/heads/other"},{RELEASE_SOURCE_SHA:pr764Source},
 {RELEASE_FRONTEND_ASSETS:"true"}])await fe11Case({env},false,0);
await fe11Case({mutate:r=>r[0].result.id=priorVersion},false,1);
for(const mutate of [r=>r[2].result.deployments[0].versions[0].version_id=priorVersion,
 r=>r[2].result.deployments[0].versions[0].percentage=99,r=>r[2].result.deployments[0].id=priorDeployment,
 r=>r[2].result.deployments[0].versions.push({version_id:priorVersion,percentage:0}),
 r=>r[2].result.deployments=[]])await fe11Case({mutate},false,3);
for(let i=0;i<3;i++)await fe11Case({failAt:i},false,i+1);
console.log(`PR764 exact FE-RELEASE-11 restore: ${fe11Cases} cases passed`);

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
console.log(`console_deploy_safety_validation: PASS (manual-only; 16 original write gates; exclusive preflight/deploy/restore; 2 exact Binance gates; ${cases} offline reader cases; ${sourceCases} source cases; ${restoreCases} restore cases; ${overlayCases} overlay cases; ${configCases} config cases; ${releaseCases} isolated release cases; ${schemaCases} schema readback cases)`);
