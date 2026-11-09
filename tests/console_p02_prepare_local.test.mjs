import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareLocal} from '../scripts/console_p02_prepare_local.mjs';
import {rebuildWithAssets} from '../scripts/console_p02_baseline_capture.mjs';
import {POLICY} from '../scripts/console_m09_release.mjs';
import {config} from '../scripts/console_946_backend_release.mjs';
import {uploadOnly,activateOnly} from '../scripts/console_m09_split_release.mjs';

const require=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url)),ts=require('typescript');
const sha=x=>createHash('sha256').update(x).digest('hex');
const reference=Buffer.from('var V2_BUILD_ID = "a";\nvar V2_PAGE_HTML = "html";\nvar V2_ASSETS = Object.freeze({"/x": {base64: "YWJj"}});');
const historical=Buffer.from(reference.toString().replace('"html"','"old html"'));
const rebuilt=rebuildWithAssets(reference,historical,ts);
const pins={control:'a'.repeat(40),reference:sha(reference),referenceFrontendBlob:'b'.repeat(40),historical:'c'.repeat(40),historicalBundle:sha(historical)};
const record={schema:'qrs-worker-p02-baseline-v1',control_sha:pins.control,reference_module_sha256:pins.reference,
 version:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',deployment:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 active_module_sha256:'c'.repeat(64),configuration_sha256:'d'.repeat(64),migration_tag_sha256:'e'.repeat(64),
 asset_comparison:{V2_BUILD_ID:true,V2_PAGE_HTML:false,V2_ASSETS:true},historical_comparison:{source:pins.historical,status:'match'},
 asset_declarations:rebuilt.declarations,rebuilt_module_sha256:rebuilt.sha256,release_state:'hold_review_required'};
const git=(_command,object)=>object.endsWith('^{tree}')?POLICY.tree:object.includes(':')?pins.referenceFrontendBlob:
  object.startsWith(POLICY.source)?POLICY.source:pins.historical;

test('local consumer materializes only protected review files and rejects mismatches',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'p02-local-'));
 try {
  const paths={recordPath:join(dir,'record'),referencePath:join(dir,'reference'),historicalPath:join(dir,'historical'),outputPath:join(dir,'out')};
  await writeFile(paths.recordPath,JSON.stringify(record),{mode:0o600});await writeFile(paths.referencePath,reference);await writeFile(paths.historicalPath,historical);
  const deps={root:join(dir,'repo'),git,pins,ts};
  assert.deepEqual(await prepareLocal(paths,deps),{ok:true,hold:true});
  assert.deepEqual(await readFile(join(paths.outputPath,'candidate.js')),rebuilt.bytes);
  const review=JSON.parse(await readFile(join(paths.outputPath,'review.json'),'utf8'));
  assert.equal(review.hold,true);assert.equal(review.policy.rollback,record.version);
  assert.equal((await stat(paths.outputPath)).mode&0o777,0o700);
  assert.equal((await stat(join(paths.outputPath,'review.json'))).mode&0o777,0o600);
  await assert.rejects(prepareLocal(paths,deps));
  for(const [bad,depsOverride] of [[{historicalPath:paths.referencePath},{}],[{}, {git:(...args)=>args[1]?.endsWith('^{tree}')?'0'.repeat(40):git(...args)}]]){
    const out=join(dir,'bad-'+Object.keys(bad).join('')+Object.keys(depsOverride).join(''));
    await assert.rejects(prepareLocal({...paths,...bad,outputPath:out},{...deps,...depsOverride}));
    await assert.rejects(stat(out),{code:'ENOENT'});
  }
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('actual CLI rejects invalid input without revealing it or creating output',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'p02-cli-'));
 try {
  const r=join(dir,'record'),ref=join(dir,'reference'),hist=join(dir,'historical'),out=join(dir,'out');
  await writeFile(r,'private-marker',{mode:0o600});await writeFile(ref,reference);await writeFile(hist,historical);
  const script=fileURLToPath(new URL('../scripts/console_p02_prepare_local.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,r,ref,'a'.repeat(40),out],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.doesNotMatch(result.stdout+result.stderr,/private-marker/);
  assert.match(result.stderr,/"hold":true/);await assert.rejects(stat(out),{code:'ENOENT'});
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('current batch binds the approved control and active module without historical input',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'p02-current-'));
 try {
  const currentPins={...pins,active:'f'.repeat(64)};
  const current={...record,active_module_sha256:currentPins.active,
   asset_comparison:{V2_BUILD_ID:true,V2_PAGE_HTML:true,V2_ASSETS:true},release_state:'hold'};
  delete current.asset_declarations;delete current.rebuilt_module_sha256;delete current.historical_comparison;
  const paths={recordPath:join(dir,'record'),referencePath:join(dir,'reference'),outputPath:join(dir,'out')};
  await writeFile(paths.recordPath,JSON.stringify(current),{mode:0o600});await writeFile(paths.referencePath,reference);
  const deps={root:join(dir,'repo'),git,pins:currentPins,ts};
  assert.deepEqual(await prepareLocal(paths,deps),{ok:true,hold:true});
  assert.deepEqual(await readFile(join(paths.outputPath,'candidate.js')),reference);
  for(const [label,bad] of [['control',{...current,control_sha:'0'.repeat(40)}],['active',{...current,active_module_sha256:'0'.repeat(64)}]]){
   await writeFile(paths.recordPath,JSON.stringify(bad));
   const out=join(dir,label);await assert.rejects(prepareLocal({...paths,outputPath:out},deps));
   await assert.rejects(stat(out),{code:'ENOENT'});
  }
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('prepared files pass through separate staged upload and activation with configuration checks',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'p02-handoff-'));
 try {
  const staged='cccccccc-cccc-4ccc-8ccc-cccccccccccc',successor='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const active=record.version,deployment=record.deployment;
  const resources={bindings:[{name:'STRATEGY_SWITCH_CONFIG',type:'kv_namespace',namespace_id:'1'.repeat(32)},
   {name:'STRATEGY_SWITCH_RUNTIME_INSTANCES',type:'durable_object_namespace',namespace_id:'2'.repeat(32),class_name:'RuntimeInstances'},
   {name:'SECRET',type:'secret_text'}],script_runtime:{compatibility_date:'2026-06-08',usage_model:'standard',migration_tag:'v1'},script:{handlers:['fetch']}};
  const fullRecord={...record,active_module_sha256:sha(reference),configuration_sha256:sha(config(resources)),migration_tag_sha256:sha('v1')};
  const paths={recordPath:join(dir,'record'),referencePath:join(dir,'reference'),historicalPath:join(dir,'historical'),outputPath:join(dir,'out')};
  await writeFile(paths.recordPath,JSON.stringify(fullRecord),{mode:0o600});
  await writeFile(paths.referencePath,reference);await writeFile(paths.historicalPath,historical);
  await prepareLocal(paths,{root:join(dir,'repo'),git,pins,ts});
  const candidate=await readFile(join(paths.outputPath,'candidate.js'));
  const {hold,policy}=JSON.parse(await readFile(join(paths.outputPath,'review.json'),'utf8'));
  assert.equal(hold,true);
  const evidence={source:policy.source,tree:policy.tree,frontendBlob:policy.frontendBlob};
  function fixture(){
   let uploaded=false,activated=false,uploads=0,activations=0,drift=null;
   const api={deployments:async()=>({deployments:[{id:activated?successor:deployment,strategy:'percentage',versions:[{version_id:activated?staged:active,percentage:100}]}]}),
    versions:async()=>({items:(uploaded?[staged,active]:[active]).map(id=>({id}))}),
    betaVersion:async id=>({id,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:(id===staged?candidate:reference).toString('base64')}]}),
    scriptVersion:async id=>{const r=structuredClone(resources);if(id===staged&&drift==='configuration')r.script_runtime.usage_model='unbound';
     if(id===staged&&drift==='staged_migration')r.script_runtime.migration_tag='v2';
     if(id===active&&drift==='migration')r.script_runtime.migration_tag='v2';return {id,resources:r};},
    upload:async()=>{uploads++;uploaded=true;return {id:staged};},activate:async()=>{activations++;activated=true;return {id:successor};}};
   return {api,counts:()=>({uploads,activations}),setDrift:value=>{drift=value;}};
  }
  const args={policy,evidence,candidate},f=fixture();
  const stage=await uploadOnly({...args,api:f.api});
  assert.equal(stage.result.ok,true);assert.deepEqual(f.counts(),{uploads:1,activations:0});
  assert.equal(stage.receipt.configuration_sha256,fullRecord.configuration_sha256);
  assert.equal(stage.receipt.migration_tag_sha256,fullRecord.migration_tag_sha256);
  const activated=await activateOnly({...args,api:f.api,receipt:stage.receipt});
  assert.equal(activated.result.ok,true);assert.deepEqual(f.counts(),{uploads:1,activations:1});
  assert.equal(activated.receipt.successorVersion,staged);assert.equal(activated.receipt.successorDeployment,successor);
  for(const drift of ['configuration','migration','staged_migration']){
   const bad=fixture(),first=await uploadOnly({...args,api:bad.api});assert.equal(first.result.ok,true);
   bad.setDrift(drift);
   const second=await activateOnly({...args,api:bad.api,receipt:first.receipt});
   assert.equal(second.result.ok,false,drift);assert.deepEqual(bad.counts(),{uploads:1,activations:0});
  }
 } finally {await rm(dir,{recursive:true,force:true});}
});
