// Synthetic process harness for the real read-only entrypoint. No network,
// production code, token or Cloudflare data is used in these tests.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('both exact modes run the same validated candidate; unrelated bytes never run it',async()=>{
  const root=await mkdtemp(join(tmpdir(),'qrs946-readonly-flow-'));
  try{
    for(const dir of ['scripts','web/strategy-switch-console/node_modules/@jridgewell/trace-mapping',
      'web/strategy-switch-console/frontend/node_modules/typescript','runner/qrs54e-baseline'])
      await mkdir(join(root,dir),{recursive:true});
    for(const name of ['console_946_active_dry_run.mjs','console_946_readonly_state.mjs'])
      await writeFile(join(root,'scripts',name),await readFile(new URL('../scripts/'+name,import.meta.url)));
    await writeFile(join(root,'web/strategy-switch-console/package.json'),'{}');
    await writeFile(join(root,'web/strategy-switch-console/frontend/package.json'),'{}');
    await writeFile(join(root,'web/strategy-switch-console/node_modules/@jridgewell/trace-mapping/index.js'),'module.exports={};');
    await writeFile(join(root,'web/strategy-switch-console/frontend/node_modules/typescript/index.js'),'module.exports={};');
    await writeFile(join(root,'runner/qrs54e-baseline/worker.js'),'synthetic-reference');
    await writeFile(join(root,'scripts/console_active_module_probe.mjs'),
      "export function createReadOnlyRequest(){return {}};export async function probe(_req,callback){await callback(Buffer.from(process.env.TEST_ACTIVE));}\n");
    await writeFile(join(root,'scripts/console_946_54e_patch.mjs'),
      "export async function verify946OnFixed54e(_ts,_trace,reference){if(reference.toString()!=='synthetic-reference')throw Error('untrusted_reference');return Buffer.from('synthetic-candidate');}\n");
    await writeFile(join(root,'scripts/console_946_runtime_test.mjs'),
      "import {writeFile} from 'node:fs/promises';export async function testCandidate946(candidate){if(process.env.CLOUDFLARE_API_TOKEN||process.env.CLOUDFLARE_ACCOUNT_ID)throw Error('credential_inherited');if(candidate.toString()!=='synthetic-candidate')throw Error('wrong_candidate');await writeFile(process.env.TEST_MARKER,'runtime-ran');}\n");
    const marker=join(root,'runtime-marker');
    const before={...process.env},oldLog=console.log,oldError=console.error,oldExit=process.exitCode;
    let run=0;
    async function execute(active){
      await rm(marker,{force:true});
      Object.assign(process.env,{RUNNER_TEMP:join(root,'runner'),TEST_ACTIVE:active,TEST_MARKER:marker,
        CLOUDFLARE_API_TOKEN:'synthetic-token',CLOUDFLARE_ACCOUNT_ID:'synthetic-account'});
      const out=[],err=[];console.log=x=>out.push(x);console.error=x=>err.push(x);process.exitCode=0;
      try{await import(pathToFileURL(join(root,'scripts/console_946_active_dry_run.mjs')).href+'?run='+(run++));
        return {status:process.exitCode,stdout:out.join('\n'),stderr:err.join('\n')};
      }finally{console.log=oldLog;console.error=oldError;process.exitCode=oldExit;}
    }
    try{
      for(const [active,ready,applied] of [['synthetic-reference',true,false],['synthetic-candidate',false,true]]){
        const result=await execute(active);
        assert.equal(result.status,0,result.stderr);const output=JSON.parse(result.stdout);
        assert.equal(output.patch_ready,ready);assert.equal(output.already_applied,applied);
        assert.equal(output.candidate_runtime_passed,true);assert.equal(output.upload_attempted,false);
        assert.equal(await readFile(marker,'utf8'),'runtime-ran');
      }
      const rejected=await execute('private-synthetic-other');
      assert.equal(rejected.status,1);const output=JSON.parse(rejected.stderr);
      assert.equal(output.reason,'active_54e_bytes_mismatch');assert.equal(output.get_verified,true);
      assert.equal(output.patch_ready,false);assert.equal(output.already_applied,null);
      assert.doesNotMatch(rejected.stdout+rejected.stderr,/private-synthetic-other|synthetic-token|synthetic-account/);
      await assert.rejects(readFile(marker),'unmatched live bytes must not be executed');
    }finally{
      for(const key of ['RUNNER_TEMP','TEST_ACTIVE','TEST_MARKER','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID']){
        if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];
      }
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
