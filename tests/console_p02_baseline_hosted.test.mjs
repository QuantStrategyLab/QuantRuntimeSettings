import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyCapability,storage,KEY,readOnlyWorkerApi} from '../scripts/console_p02_baseline_hosted.mjs';
const now=Date.parse('2026-11-09T00:00:00Z');
const receipt={schema:'qrs-p02-storage-capability-v1',bucket:'synthetic-bucket',object:KEY,wif_provider:'synthetic-provider',service_account:'synthetic-account',control_sha:'a'.repeat(40),owner_project:'synthetic-owner',policy_readback_reviewed:true,create_permitted:true,get_permitted:true,target_absent:true,issued_at:'2026-11-08T23:00:00Z',expires_at:'2026-11-09T01:00:00Z'};
const env={DIGEST_CANDIDATES_GCS_URI:'gs://synthetic-bucket/digest-candidates/',DIGEST_CANDIDATES_READER_WIF_PROVIDER:'synthetic-provider',DIGEST_CANDIDATES_READER_SERVICE_ACCOUNT:'synthetic-account',GITHUB_SHA:'a'.repeat(40),QRS_P02_STORAGE_CAPABILITY_RECEIPT:JSON.stringify(receipt)};
test('requires protected proof bound to exact identity, object, control and short validity',()=>{
 assert.deepEqual(verifyCapability(env,now),{bucket:'synthetic-bucket'});
 for(const delta of [{bucket:'wrong-bucket'},{object:'other'},{wif_provider:'other'},{service_account:'other'},{control_sha:'b'.repeat(40)},{policy_readback_reviewed:false},{create_permitted:false},{get_permitted:false},{target_absent:false},{expires_at:'2026-11-08T23:59:59Z'},{expires_at:'2026-11-11T00:00:00Z'},{owner_project:''}])
   assert.throws(()=>verifyCapability({...env,QRS_P02_STORAGE_CAPABILITY_RECEIPT:JSON.stringify({...receipt,...delta})},now));
 assert.throws(()=>verifyCapability({...env,QRS_P02_STORAGE_CAPABILITY_RECEIPT:''},now));
 assert.throws(()=>verifyCapability({...env,QRS_P02_STORAGE_CAPABILITY_RECEIPT:JSON.stringify({...receipt,object:KEY.replace('-r2/','-r1/')})},now));
});
test('storage addresses exact object, creates once conditionally, reads exact generation',async()=>{
 const calls=[];
 const fetcher=async(url,opt)=>{calls.push({url,opt});if(calls.length===1)return new Response('',{status:404});if(calls.length===2)return Response.json({bucket:'synthetic-bucket',name:KEY,generation:'42'});return new Response('record');};
 const s=storage({bucket:'synthetic-bucket',token:'synthetic-token',fetcher});
 await s.reserve();const gen=await s.create(Buffer.from('record'));assert.equal(gen,'42');assert.equal((await s.read(gen)).toString(),'record');
 assert.equal(calls.length,3);assert.equal(calls[0].opt.method,undefined);assert.ok(calls[0].url.includes(encodeURIComponent(KEY)));
 assert.equal(calls[1].opt.method,'POST');assert.match(calls[1].url,/ifGenerationMatch=0/);assert.ok(calls[1].url.includes(encodeURIComponent(KEY)));
 assert.match(calls[2].url,/alt=media&generation=42$/);assert.ok(calls.every(c=>!c.url.includes('synthetic-token')));
});
test('existing or unreadable target and uncertain writes stop without retry',async()=>{
 for(const status of [200,403,500]){let count=0;const s=storage({bucket:'synthetic-bucket',token:'x',fetcher:async()=>{count++;return new Response('',{status});}});await assert.rejects(s.reserve());assert.equal(count,1);}
 let count=0;const s=storage({bucket:'synthetic-bucket',token:'x',fetcher:async()=>{count++;throw Error('private');}});await assert.rejects(s.create(Buffer.from('x')));assert.equal(count,1);
});

test('Worker interface exposes only the three fixed GET methods',()=>{const f=()=>{};const result=readOnlyWorkerApi({deployments:f,betaVersion:f,scriptVersion:f,upload:f,activate:f,versions:f});assert.deepEqual(Object.keys(result),['deployments','betaVersion','scriptVersion']);assert.ok(Object.isFrozen(result));});
