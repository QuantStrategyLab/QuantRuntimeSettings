// Fixed-version, read-only, synthetic business checks. Never output code or data.
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {probe,createReadOnlyRequest} from './console_active_module_probe.mjs';
import {inspectSelector,verifyFixedActive} from './console_958_candidate.mjs';
import {testCandidate958} from './console_958_candidate_runtime.mjs';
const expectedActive='bed839bd226613cca4fa9508b8a75b4a3b54c9ab5f8326f28dfedb59bcf8d213';
const expectedCandidate='207d258c7c09c36b3d20eeba61b947e282c92b0cf36f6881f67c8beedfde2510';
try {
 const req=createRequire(new URL('../web/strategy-switch-console/frontend/package.json',import.meta.url));
 const ts=req('typescript'), baseline=await readFile(join(process.env.RUNNER_TEMP,'qrs54e-baseline/worker.js'));
 const request=createReadOnlyRequest();let result;
 await probe(async(path,beta)=>{const value=await request(path,beta);if(!beta)verifyFixedActive(value);return value},async bytes=>{
   const built=inspectSelector(ts,baseline,bytes,true);
   if(built.report.active_code_sha256!==expectedActive||built.report.candidate_code_sha256!==expectedCandidate)throw Error('identity');
   delete process.env.CLOUDFLARE_API_TOKEN; delete process.env.CLOUDFLARE_ACCOUNT_ID;
   result=await testCandidate958(built.candidate);
 });
 console.log(JSON.stringify({read_only:true,active_fixed:true,synthetic_results:result,upload_attempted:false,deploy_attempted:false}));
 if(Object.values(result).some(value=>value!==true))process.exitCode=1;
} catch {
 console.error(JSON.stringify({ok:false,read_only:true,reason:'business_probe_unverified',upload_attempted:false,deploy_attempted:false}));process.exitCode=1;
}
