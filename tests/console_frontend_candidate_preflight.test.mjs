import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SNAPSHOT,RECOVERY_SNAPSHOT,verifyEvidence,verifyRecoveryEvidence} from '../scripts/console_frontend_candidate_preflight.mjs';
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

test('recovery evidence rejects snapshot substitution and bytes outside the independently pinned complete bundle',()=>{
  const recoveryBundle = Buffer.from(`var V2_BUILD_ID = "${RECOVERY_SNAPSHOT.buildId}";\n`);
  const recovery = {...good(), commit:RECOVERY_SNAPSHOT.commit, tree:RECOVERY_SNAPSHOT.tree,
    assetBlob:RECOVERY_SNAPSHOT.assetBlob, asset:`export const V2_BUILD_ID = "${RECOVERY_SNAPSHOT.buildId}";\n`,
    firstBundle:recoveryBundle, secondBundle:recoveryBundle};
  // A matching build marker and repeatable bytes do not prove this is the
  // complete independently observed module. The actual build is checked in CI.
  assert.throws(()=>verifyRecoveryEvidence(recovery),/recovery_bundle_identity_mismatch/);
  assert.throws(()=>verifyEvidence(recovery),/snapshot_identity_mismatch/);
  assert.throws(()=>verifyRecoveryEvidence(good()),/snapshot_identity_mismatch/);
  for(const key of ['commit','tree','assetBlob'])
    assert.throws(()=>verifyRecoveryEvidence({...recovery,[key]:'bad'}),/snapshot_identity_mismatch/);
  // Metadata-only releases can share an asset build ID. Use a genuinely
  // different marker to exercise each negative check.
  assert.throws(()=>verifyRecoveryEvidence({...recovery,asset:'export const V2_BUILD_ID = "'+ '0'.repeat(64) +'";\n'}),/asset_build_id_mismatch/);
  const wrongBundle = Buffer.from('var V2_BUILD_ID = "'+ '0'.repeat(64) +'";\n');
  assert.throws(()=>verifyRecoveryEvidence({...recovery,firstBundle:wrongBundle,secondBundle:wrongBundle}),/bundle_build_id_mismatch/);
});
