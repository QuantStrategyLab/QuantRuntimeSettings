// Read-only diagnostic; never upload or print module, config, or exception text.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {probe, createReadOnlyRequest} from './console_active_module_probe.mjs';

const EXPECTED_DEPLOYMENT = '7bc41232-5b83-4e46-b220-8fe912f3234f';
const EXPECTED_VERSION = '2ee87f0f-d07f-436f-9d54-f311ba37923b';
const digest = b => createHash('sha256').update(b).digest('hex');
const fail = () => { throw new Error('selector_unverified'); };

export function verifyFixedActive(value) {
  const active=value?.deployments?.[0];
  if(active?.id!==EXPECTED_DEPLOYMENT || active?.versions?.length!==1 || active.versions[0]?.version_id!==EXPECTED_VERSION || active.versions[0]?.percentage!==100) fail();
}

// Only compares against the independently built fixed 54e bundle. A mismatch
// is an unavailable proof, not permission to relax the matching condition.
export function inspectSelector(ts, baseline, active, includeCandidate = false) {
  function parse(bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 10 * 1024 * 1024) fail();
    const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
    const sf = ts.createSourceFile('worker.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (sf.parseDiagnostics.length) fail();
    const declarations = new Map();
    for (const node of sf.statements) {
      let names = [];
      if (ts.isFunctionDeclaration(node) && node.name) names = [node.name.text];
      if (ts.isVariableStatement(node)) names = node.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text);
      for (const name of names) {
        if (!['accountDraftStrategyChoices','supportedExecutionModesForPlatform','PLATFORM_CONFIG'].includes(name)) continue;
        if (declarations.has(name)) fail();
        declarations.set(name,node);
      }
    }
    if (declarations.size !== 3) fail();
    return {text,sf,declarations};
  }
  const old = parse(baseline), live = parse(active);
  const code = (parsed,name) => { const n=parsed.declarations.get(name); return parsed.text.slice(n.getStart(parsed.sf),n.end); };
  for (const name of ['accountDraftStrategyChoices','supportedExecutionModesForPlatform','PLATFORM_CONFIG']) {
    if (code(old,name)!==code(live,name)) fail();
  }
  const target=live.declarations.get('accountDraftStrategyChoices');
  if (!ts.isFunctionDeclaration(target) || !target.body) fail();
  const choices = target.body.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.length===1
    && ts.isIdentifier(n.declarationList.declarations[0].name) && n.declarationList.declarations[0].name.text==='choices'
    && ts.isArrayLiteralExpression(n.declarationList.declarations[0].initializer) && !n.declarationList.declarations[0].initializer.elements.length);
  if (choices.length!==1 || /\ballowsDryRunOnly\b/.test(code(live,'accountDraftStrategyChoices'))) fail();
  const matches=[];
  function visit(n){
    if (ts.isArrowFunction(n) && n.parameters.length===1 && ts.isIdentifier(n.parameters[0].name)
      && n.parameters[0].name.text==='mode' && !ts.isBlock(n.body)
      && /^mode\s*===\s*["']paper["']\s*\|\|\s*mode\s*===\s*["']live["']$/.test(n.body.getText(live.sf))) {
      const parent=n.parent;
      if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)
          && parent.expression.expression.getText(live.sf)==='modes' && parent.expression.name.text==='some'
          && parent.arguments.length===1) matches.push(n.body);
    }
    ts.forEachChild(n,visit);
  }
  visit(target);
  if (matches.length!==1) fail();
  const body=matches[0], pos=choices[0].end, end=body.end;
  const insertion='\n  const allowsDryRunOnly = accountOption?.default_execution_mode === "dry_run" && supportedExecutionModesForPlatform(platform).includes("dry_run");';
  const suffix=' || (allowsDryRunOnly && mode === "dry_run")';
  const candidate=live.text.slice(0,pos)+insertion+live.text.slice(pos,end)+suffix+live.text.slice(end);
  const reversed=candidate.slice(0,pos)+candidate.slice(pos+insertion.length,end+insertion.length)+candidate.slice(end+insertion.length+suffix.length);
  if (reversed!==live.text) fail();
  const parsed=parse(Buffer.from(candidate));
  for(const name of ['supportedExecutionModesForPlatform','PLATFORM_CONFIG']) if(code(parsed,name)!==code(live,name)) fail();
  const result = {selector_matches_fixed_baseline:true, helper_matches_fixed_baseline:true, platform_config_matches_fixed_baseline:true,
    unique_selector:true, unique_helper:true, two_insertions_reversible:true,
    active_code_sha256:digest(active), candidate_code_sha256:digest(Buffer.from(candidate))};
  return includeCandidate ? {report: result, candidate: Buffer.from(candidate)} : result;
}

async function main(){
  const require=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url));
  const ts=require('typescript');
  const baseline=await readFile(join(process.env.RUNNER_TEMP,'qrs54e-baseline/worker.js'));
  let result;
  const request=createReadOnlyRequest();
  await probe(async (path,beta)=>{
    const value=await request(path,beta);
    if (!beta) {
      verifyFixedActive(value);
    }
    return value;
  },bytes=>{result=inspectSelector(ts,baseline,bytes)});
  console.log(JSON.stringify({ok:true,read_only:true,active_fixed:true,...result}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{console.error(JSON.stringify({ok:false,read_only:true,reason:'selector_unverified',upload_attempted:false,deploy_attempted:false}));process.exitCode=1;});
}
