import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {compareAssetDeclarations} from '../scripts/console_m09_asset_compare.mjs';

import {inspectActiveAssets} from '../scripts/console_m09_release.mjs';

const assetText='var V2_BUILD_ID = "build";\nvar V2_PAGE_HTML = "<html>";\nvar V2_ASSETS = Object.freeze({});\n';
const fixed=Buffer.from(assetText);
const compare=text=>compareAssetDeclarations(fixed,Buffer.from(text));

test('compares just the three compiled asset statements',()=>{
  assert.deepEqual(compare(assetText+'function unrelated() {}'),{
    ok:true,
    equal:{V2_BUILD_ID:true,V2_PAGE_HTML:true,V2_ASSETS:true},
    reason:'asset_declarations_equal',
  });
  const mismatch=compare(assetText.replace('<html>','private fixture'));
  assert.deepEqual(mismatch.equal,{V2_BUILD_ID:true,V2_PAGE_HTML:false,V2_ASSETS:true});
  assert.equal(mismatch.reason,'asset_declarations_differ');
  assert.equal(JSON.stringify(mismatch).includes('private fixture'),false);
});

test('rejects missing, duplicate, unsupported or invalid declarations',()=>{
  assert.equal(compare(assetText.split('\n').slice(1).join('\n')).reason,'missing_declaration');
  assert.equal(compare(assetText+'var V2_BUILD_ID = "duplicate";').reason,'ambiguous_declaration');
  assert.equal(compare(assetText.replace('Object.freeze({})','makeAssets()')).reason,'unsupported_declaration');
  assert.equal(compare(assetText+'var =').reason,'invalid_module');
});

test('binds module comparison to three GET calls and stops on drift',async()=>{
  const version='a'.repeat(8)+'-aaaa-4aaa-8aaa-'+'a'.repeat(12);
  const deployment='b'.repeat(8)+'-bbbb-4bbb-8bbb-'+'b'.repeat(12);
  const expected=createHash('sha256').update(fixed).digest('hex');
  const calls=[];
  let drift=false;
  const api={
    async deployments() {
      calls.push('deployments');
      return {deployments:[{id:drift&&calls.length===3?version:deployment,strategy:'percentage',
        versions:[{version_id:version,percentage:100}]}]};
    },
    async betaVersion(id) {
      calls.push('module');
      assert.equal(id,version);
      return {id,modules:[{name:'worker.js',content_type:'application/javascript+module',
        content_base64:fixed.toString('base64')}]};
    },
  };
  assert.equal((await inspectActiveAssets(api,fixed,'mismatch')).reason,'candidate_mismatch');
  assert.deepEqual(calls,[]);
  const result=await inspectActiveAssets(api,fixed,expected);
  assert.equal(result.ok,true);
  assert.equal(result.active_identity_unchanged,true);
  assert.deepEqual(calls,['deployments','module','deployments']);
  assert.doesNotMatch(JSON.stringify(result),/aaaaaaaa|bbbbbbbb/);
  calls.length=0;
  drift=true;
  assert.deepEqual(await inspectActiveAssets(api,fixed,expected),{ok:false,reason:'active_drift'});
  assert.deepEqual(calls,['deployments','module','deployments']);
});
