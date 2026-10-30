import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SNAPSHOT,verifyEvidence} from '../scripts/console_frontend_candidate_preflight.mjs';
const bundle = Buffer.from(`var V2_BUILD_ID = "${SNAPSHOT.buildId}";\n`);
const entries = () => ['worker.js','worker.js.map','README.md'].map(name=>({name,isFile:true}));
const good=()=>({commit:SNAPSHOT.commit,tree:SNAPSHOT.tree,assetBlob:SNAPSHOT.assetBlob,
  asset:`export const V2_BUILD_ID = "${SNAPSHOT.buildId}";\n`, firstBundle:bundle,secondBundle:bundle,firstEntries:entries(),secondEntries:entries()});
test('evidence identifies fixed draft and deterministic bundle, without claiming approval or production read',()=>{
  const out=verifyEvidence(good()); assert.equal(out.snapshot_verified,true); assert.equal(out.bundle_reproduced,true);
  assert.match(out.bundle_sha256,/^[a-f0-9]{64}$/); assert.equal(out.production_read,false); assert.equal(out.release_approved,false);
});
test('rejects identity, generated asset and bundle differences',()=>{
  for(const [key,value] of Object.entries({commit:'bad',tree:'bad',assetBlob:'bad',asset:'',firstBundle:Buffer.alloc(0),secondBundle:Buffer.from('different')})) assert.throws(()=>verifyEvidence({...good(),[key]:value}));
  assert.throws(()=>verifyEvidence({...good(),asset:good().asset+good().asset}));
});

test('bundled build ID must be present exactly once and equal the reviewed snapshot',()=>{
  for(const code of ['', 'var V2_BUILD_ID = "";', 'var V2_BUILD_ID = "wrong";', `var V2_BUILD_ID = "${SNAPSHOT.buildId}";\nvar V2_BUILD_ID = "${SNAPSHOT.buildId}";`]) {
    const bytes=Buffer.from(code || 'void 0;');
    assert.throws(()=>verifyEvidence({...good(),firstBundle:bytes,secondBundle:bytes}),/bundle_build_id_mismatch/);
  }
});
test('rejects unexpected or missing bundle output, including directories',()=>{
  for(const altered of [[...entries(),{name:'extra.js',isFile:true}],entries().filter(x=>x.name!=='worker.js.map'),[...entries(),{name:'assets',isFile:false}]]) {
    assert.throws(()=>verifyEvidence({...good(),firstEntries:altered}),/bundle_output_unexpected/);
  }
});
