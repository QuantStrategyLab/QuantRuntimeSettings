import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const workflow=readFileSync(new URL('../.github/workflows/deploy-strategy-switch-console.yml',import.meta.url),'utf8');
const job=workflow.match(/^  backend_only_release:\n([\s\S]*?)(?=^  preflight_active_module:)/m)?.[1];
const deploy=workflow.match(/^  deploy:\n([\s\S]*?)(?=^  rollback:)/m)?.[1];
const rollback=workflow.match(/^  rollback:\n([\s\S]*)$/m)?.[1];
const jobExpr=job?.match(/^    if: >-\n([\s\S]*?)(?=^    runs-on:)/m)?.[1].trim().replace(/^\$\{\{\s*/,'').replace(/\s*\}\}$/,'');
const deployExpr=deploy?.match(/^    if: (.+)$/m)?.[1],rollbackExpr=rollback?.match(/^    if: (.+)$/m)?.[1];
function evaluate(expr,inputs,event='workflow_dispatch',ref='refs/heads/main'){
  const source=expr.replaceAll('github.event_name',JSON.stringify(event)).replaceAll('github.ref',JSON.stringify(ref))
    .replace(/inputs\.(\w+)/g,(_m,key)=>JSON.stringify(inputs[key]??false));
  assert.match(source,/^[\w\s'"=!&|().\-/]+$/);
  return Function(`return (${source})`)();
}
const defaults={backend_only_release:false,read_only_preflight:false,private_release_check:'off',external_flow_enable:false,
  check_explicit_version_inherit:false,diagnose_restore_target:false,rollback_to_pre_release:false,release_frontend_assets:false,
  sync_secrets:false,sync_strategy_profiles:false,skip_binance_receiver_checks:false,ibkr_candidate_resume:'off',source_sha:''};
test('backend mode is explicit and every incompatible switch closes the write job',()=>{
  assert.match(workflow,/backend_only_release:\n(?:[^\n]*\n){0,4}\s+type: boolean\n\s+default: false/);
  assert.equal(evaluate(jobExpr,defaults),false);
  const selected={...defaults,backend_only_release:true};assert.equal(evaluate(jobExpr,selected),true);
  for(const name of ['read_only_preflight','external_flow_enable','check_explicit_version_inherit','diagnose_restore_target','rollback_to_pre_release','release_frontend_assets','sync_secrets','sync_strategy_profiles','skip_binance_receiver_checks'])
    assert.equal(evaluate(jobExpr,{...selected,[name]:true}),false,name);
  for(const [name,value] of [['private_release_check','baseline'],['ibkr_candidate_resume','verify'],['source_sha','any']])
    assert.equal(evaluate(jobExpr,{...selected,[name]:value}),false,name);
  assert.equal(evaluate(jobExpr,selected,'push'),false);assert.equal(evaluate(jobExpr,selected,'workflow_dispatch','refs/heads/feature'),false);
});
test('legacy deploy and rollback retain defaults and cannot run with backend mode selected',()=>{
  for(const read of [false,true])for(const rollbackOpt of [false,true])for(const explicit of [false,true]){
    const input={...defaults,read_only_preflight:read,rollback_to_pre_release:rollbackOpt,check_explicit_version_inherit:explicit};
    assert.equal(evaluate(deployExpr,input),!read&&!explicit&&!rollbackOpt);
    assert.equal(evaluate(rollbackExpr,input),!read&&!explicit&&rollbackOpt);
    assert.equal(evaluate(deployExpr,{...input,backend_only_release:true}),false);
    assert.equal(evaluate(rollbackExpr,{...input,backend_only_release:true}),false);
  }
});
test('the fixed release job isolates credentials and never syncs secrets or profiles',()=>{
  assert.ok(job);const build=job.slice(job.indexOf('      - name: Build fixed backend release baseline'),job.indexOf('      - name: Publish fixed backend repair'));
  const publish=job.slice(job.indexOf('      - name: Publish fixed backend repair'));
  assert.doesNotMatch(build,/CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID|API_KEY|EMAIL)|secrets\./);
  assert.match(build,/QRS946_QUIET: "true"/);assert.match(build,/console_946_54e_candidate_validation\.mjs/);
  assert.match(publish,/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(publish,/CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \|\| vars\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.equal((publish.match(/secrets\./g)||[]).length,2);
  assert.doesNotMatch(job.replace(publish,''),/CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID|API_KEY|EMAIL)|secrets\.|vars\.CLOUDFLARE/);
  assert.match(publish,/node scripts\/console_946_backend_release\.mjs/);
  assert.doesNotMatch(job,/secret put|sync-strategy-profiles|wrangler\s+deploy(?!\s+--dry-run)/);
  assert.equal((job.match(/git ls-remote origin refs\/heads\/main/g)||[]).length,3);
});
