import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {prepareRecord} from '../scripts/console_p02_prepare.mjs';
import {rebuildWithAssets} from '../scripts/console_p02_baseline_capture.mjs';
import {POLICY} from '../scripts/console_m09_release.mjs';

const require=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url)),ts=require('typescript');
const hash=x=>createHash('sha256').update(x).digest('hex');
const reference=Buffer.from('var V2_BUILD_ID = "a";\nvar V2_PAGE_HTML = "html";\nvar V2_ASSETS = Object.freeze({"/x": {base64: "YWJj"}});');
const historical=Buffer.from(reference.toString().replace('"html"','"old html"'));
const rebuilt=rebuildWithAssets(reference,historical,ts);
const pins={control:'a'.repeat(40),reference:hash(reference),referenceFrontendBlob:'a'.repeat(40),
  historical:'b'.repeat(40),historicalBundle:hash(historical)};
const evidence={source:POLICY.source,tree:POLICY.tree,frontendBlob:pins.referenceFrontendBlob,
  historicalSource:pins.historical,historicalBundle:pins.historicalBundle};
const baseline={schema:'qrs-worker-p02-baseline-v1',control_sha:pins.control,reference_module_sha256:pins.reference,
 version:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',deployment:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 active_module_sha256:'c'.repeat(64),configuration_sha256:'d'.repeat(64),migration_tag_sha256:'e'.repeat(64),
 asset_comparison:{V2_BUILD_ID:true,V2_PAGE_HTML:false,V2_ASSETS:true},historical_comparison:{source:pins.historical,status:'match'},
 asset_declarations:rebuilt.declarations,rebuilt_module_sha256:rebuilt.sha256,release_state:'hold_review_required'};
const prepare=r=>prepareRecord(r,reference,evidence,ts,pins);

test('reconstructs the captured declarations and retains rollback identity on hold',()=>{
 const out=prepare(baseline);
 assert.deepEqual(out.candidate,rebuilt.bytes);assert.equal(out.hold,true);
 assert.equal(out.policy.rollback,baseline.version);assert.equal(out.policy.before,baseline.active_module_sha256);
 assert.equal(out.policy.configuration_sha256,baseline.configuration_sha256);assert.equal(out.policy.migration_tag_sha256,baseline.migration_tag_sha256);
});
test('rejects missing historical proof, tampering, or identity drift',()=>{
 for(const r of [{...baseline,historical_comparison:{status:'unavailable'}},{...baseline,rebuilt_module_sha256:'0'.repeat(64)},
  {...baseline,control_sha:'0'.repeat(40)},{...baseline,version:null},
  {...baseline,asset_declarations:{...baseline.asset_declarations,V2_PAGE_HTML:'var V2_PAGE_HTML = unsafe();'}}])
  assert.throws(()=>prepare(r));
 for(const changes of [{tree:'0'.repeat(40)},{frontendBlob:POLICY.frontendBlob},{historicalBundle:'0'.repeat(64)}]){
  assert.throws(()=>prepareRecord(baseline,reference,{...evidence,...changes},ts,pins));
 }
});
test('matching assets retain the reference bundle on hold',()=>{
 const r={...baseline,asset_comparison:{V2_BUILD_ID:true,V2_PAGE_HTML:true,V2_ASSETS:true},release_state:'hold'};
 delete r.asset_declarations;delete r.rebuilt_module_sha256;delete r.historical_comparison;
 assert.deepEqual(prepare(r).candidate,reference);
});
