// Fixed, read-only candidate proof. Never print module bytes or provider payloads.
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {probe,createReadOnlyRequest} from './console_active_module_probe.mjs';
import {verifyFixedActive} from './console_958_candidate.mjs';
import {buildFreezeCandidate} from './console_958_freeze_candidate.mjs';
import {testCandidate958Freeze} from './console_958_freeze_runtime.mjs';
const original='bed839bd226613cca4fa9508b8a75b4a3b54c9ab5f8326f28dfedb59bcf8d213';
const intermediate='207d258c7c09c36b3d20eeba61b947e282c92b0cf36f6881f67c8beedfde2510';
try {
 const req=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url));
 const ts=req('typescript'), baseline=await readFile(join(process.env.RUNNER_TEMP,'qrs54e-baseline/worker.js'));
 const request=createReadOnlyRequest();let result,report;
 await probe(async(path,beta)=>{const value=await request(path,beta);if(!beta)verifyFixedActive(value);return value},async bytes=>{
   const built=buildFreezeCandidate(ts,baseline,bytes);report=built.report;
   if(report.active_code_sha256!==original||report.two_insertions_sha256!==intermediate)throw Error('identity');
   delete process.env.CLOUDFLARE_API_TOKEN;delete process.env.CLOUDFLARE_ACCOUNT_ID;
   result=await testCandidate958Freeze(built.candidate);
 });
 console.log(JSON.stringify({read_only:true,active_fixed:true,candidate_code_sha256:report.candidate_code_sha256,synthetic_results:result,upload_attempted:false,deploy_attempted:false}));
 if(Object.values(result).some(value=>value!==true))process.exitCode=1;
} catch {console.error(JSON.stringify({ok:false,read_only:true,reason:'freeze_probe_unverified',upload_attempted:false,deploy_attempted:false}));process.exitCode=1;}
