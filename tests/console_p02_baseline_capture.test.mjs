import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {capture} from '../scripts/console_p02_baseline_capture.mjs';
const candidate=Buffer.from('var V2_BUILD_ID = "a";\nvar V2_PAGE_HTML = "html";\nvar V2_ASSETS = Object.freeze({"/x": {contentType: "text/javascript", base64: "YWJj"}});');
const reference=createHash('sha256').update(candidate).digest('hex');
const version='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',dep='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function fixture(options={}){
 const calls=[];let saved,ds=0;
 const api={async deployments(){calls.push('deployment');return {deployments:[{id:options.drift&&++ds===2?'cccccccc-cccc-4ccc-8ccc-cccccccccccc':dep,strategy:'percentage',versions:[{version_id:version,percentage:100}]}]};},
 async betaVersion(){calls.push('module');return {id:version,modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:(options.active||candidate).toString('base64')}]};},
 async scriptVersion(){calls.push('config');return {id:version,resources:{bindings:[{name:'STRATEGY_SWITCH_CONFIG',type:'kv_namespace',namespace_id:'1'.repeat(32)},{name:'STRATEGY_SWITCH_RUNTIME_INSTANCES',type:'durable_object_namespace',namespace_id:'2'.repeat(32),class_name:'RuntimeInstances'}],script_runtime:{compatibility_date:'2026-06-08',usage_model:'standard',migration_tag:'private'},script:{handlers:['fetch']}}};}};
 const store={async reserve(){calls.push('reserve');if(options.reserveFail)throw Error('private');},async create(b){calls.push('create');saved=b;if(options.createFail)throw Error('private');return '123';},async read(g){calls.push('read');assert.equal(g,'123');return saved;}};
 return {api,store,calls,get record(){return JSON.parse(saved)}};
}
async function run(opt={}){const f=fixture(opt);return {f,result:await capture({api:f.api,store:f.store,candidate,reference,alternate:opt.alternate,alternateReference:opt.alternateReference,expectedActive:opt.expectedActive,controlSha:"a".repeat(40),now:()=>new Date("2026-11-09T00:00:00.000Z")})};}
test('match writes one record after four fixed reads and verifies exact readback',async()=>{const {f,result}=await run();assert.equal(result.ok,true);assert.deepEqual(f.calls,['reserve','deployment','module','config','deployment','create','read']);assert.equal(f.record.asset_declarations,undefined);assert.equal(f.record.control_sha,'a'.repeat(40));assert.equal(f.record.captured_at,'2026-11-09T00:00:00.000Z');assert.equal(JSON.stringify(f.record).includes('private'),false);});
test('mismatch retains only statically literal declarations',async()=>{const active=Buffer.from(candidate.toString().replace('"html"','"other"'));const {f,result}=await run({active});assert.equal(result.ok,true);assert.equal(result.asset_declarations_equal,false);assert.match(f.record.asset_declarations.V2_PAGE_HTML,/other/);assert.match(f.record.rebuilt_module_sha256,/^[a-f0-9]{64}$/);assert.equal(f.record.release_state,'hold_review_required');});
test('unsupported declaration, drift, and storage failures stop without retries',async()=>{
 for(const [opt,stage,expected] of [[{active:Buffer.from(candidate.toString().replace('"YWJj"','secret()'))},'assets',['reserve','deployment','module','config','deployment']], [{drift:true},'active_after',['reserve','deployment','module','config','deployment']], [{reserveFail:true},'storage_preflight',['reserve']], [{createFail:true},'save',['reserve','deployment','module','config','deployment','create']]]){
  const {f,result}=await run(opt);assert.equal(result.ok,false);assert.equal(result.stage,stage);assert.equal(result.retry,false);assert.deepEqual(f.calls,expected);
 }
});
test('bad candidate causes no storage or Worker reads',async()=>{const f=fixture();const r=await capture({api:f.api,store:f.store,candidate:Buffer.from('bad'),reference,controlSha:'a'.repeat(40)});assert.equal(r.ok,false);assert.deepEqual(f.calls,[]);});
test('rebind records only the pinned module with equal asset declarations',async()=>{
 const active=Buffer.concat([candidate,Buffer.from('\nexport {};')]);
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const matched=await run({active,expectedActive:hash(active)});
 assert.equal(matched.result.ok,true);assert.equal(matched.f.record.release_state,'hold');
 assert.equal(matched.f.record.active_module_sha256,hash(active));assert.equal(matched.f.record.asset_declarations,undefined);
 assert.deepEqual(matched.f.calls,['reserve','deployment','module','config','deployment','create','read']);
 const drift=await run({active,expectedActive:reference});
 assert.equal(drift.result.stage,'module');assert.deepEqual(drift.f.calls,['reserve','deployment','module']);
 const different=Buffer.from(candidate.toString().replace('"html"','"other"'));
 const mismatch=await run({active:different,expectedActive:hash(different)});
 assert.equal(mismatch.result.stage,'assets');
 assert.deepEqual(mismatch.f.calls,['reserve','deployment','module','config','deployment']);
});
test('mismatch removes comments and rejects ambiguous or modified literal declarations',async()=>{
 const annotated=Buffer.from(candidate.toString().replace('"html"','/* private-marker */ "other"'));
 const good=await run({active:annotated});assert.equal(good.result.ok,true);assert.doesNotMatch(JSON.stringify(good.f.record),/private-marker/);
 for(const text of [candidate.toString().replace('"YWJj"','secret()'),candidate.toString().replace('base64: "YWJj"','base64: "YWJj", base64: "ZGVm"'),candidate.toString().replace('base64: "YWJj"','__proto__: "x"'),candidate.toString().replace('var V2_PAGE_HTML','export var V2_PAGE_HTML')]){
   const {f,result}=await run({active:Buffer.from(text)});assert.equal(result.ok,false);assert.ok(!f.calls.includes('create'));
 }
});

test('mismatch checks the pinned historical artifact before deriving declarations',async()=>{
 const active=Buffer.from(candidate.toString().replace('"html"','"historical"'));
 const hash=b=>createHash('sha256').update(b).digest('hex');
 const matched=await run({active,alternate:active,alternateReference:hash(active)});
 assert.equal(matched.result.ok,true);assert.equal(matched.f.record.historical_comparison.status,'match');
 assert.match(matched.f.record.asset_declarations.V2_PAGE_HTML,/historical/);
 const different=Buffer.from(candidate.toString().replace('"html"','"alternate"'));
 const other=await run({active,alternate:different,alternateReference:hash(different)});
 assert.equal(other.f.record.historical_comparison.status,'different');assert.match(other.f.record.asset_declarations.V2_PAGE_HTML,/historical/);
 const absent=await run({active});assert.equal(absent.f.record.historical_comparison.reason,'build_or_read_unavailable');
 const invalid=await run({active,alternate:different,alternateReference:'f'.repeat(64)});assert.equal(invalid.f.record.historical_comparison.reason,'digest_mismatch');
});
