import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=resolve(import.meta.dirname,'..');
const dir=mkdtempSync(join(tmpdir(),'profiles-consumer-freeze-'));
const outside=mkdtempSync(`${dir}-outside-`);
const sentinel=join(outside,'keep.txt'), rmLog=join(dir,'rm-calls.jsonl');
const marker=join(dir,'io'), preload=join(dir,'no-network.mjs');
const transport=join(root,'web/strategy-switch-console/ibkr_daily_setup_transport.mjs');
const frozen=['multi-preflight','multi-execute','execution-preflight','execution-execute'];
const reason='strategy_profiles_consumer_frozen';
// No inherited credentials; every external command/HTTP attempt is synthetic.
const env={PATH:`${dir}:/usr/bin:/bin`,HOME:dir,RUNNER_TEMP:dir,GITHUB_RUN_ATTEMPT:'1',
  CLOUDFLARE_API_TOKEN:'synthetic-token',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),
  STRATEGY_SWITCH_CONFIG_KV_NAMESPACE_ID:'b'.repeat(32),
  RUNTIME_SETTINGS_GH_TOKEN:'synthetic-token',GITHUB_TOKEN:'synthetic-token',GITHUB_RUN_ID:'123',
  DAILY_COMPARISON_NONCE:'c'.repeat(64),DAILY_COMPARISON_DIGEST:'d'.repeat(64)};
writeFileSync(preload,`import {appendFileSync} from 'node:fs';
globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(marker)},'fetch\\n');throw Error('synthetic_network_block');};`);
for(const command of ['gh','npx']) writeFileSync(join(dir,command),
  `#!/bin/sh\nprintf '%s\\n' '${command}' >> '${marker}'\nexit 73\n`,{mode:0o700});
// Never delegate to a real rm. Only existing, canonical paths inside this
// harness's mktemp root are accepted as no-ops; everything else aborts.
// Pin the root/log in the shim instead of trusting child environment variables.
writeFileSync(join(dir,'rm'),`#!${process.execPath}
import {appendFileSync,realpathSync} from 'node:fs';
import {resolve,sep} from 'node:path';
const root=realpathSync(${JSON.stringify(dir)}), args=process.argv.slice(2);
let operands=false, targets=[], allowed=true;
for(const arg of args) {
  if(!operands && arg==='--') {operands=true;continue;}
  if(!operands && /^-/.test(arg)) {
    if(!/^-[dfirRvI]+$/.test(arg) && !/^--(force|recursive|dir|verbose|interactive(?:=(never|once|always))?|one-file-system|(?:no-)?preserve-root(?:=all)?)$/.test(arg)) allowed=false;
    continue;
  }
  targets.push(arg);
  try {
    const path=realpathSync(resolve(arg));
    if(path!==root && !path.startsWith(root+sep)) allowed=false;
  } catch {allowed=false;}
}
allowed=allowed && targets.length>0;
appendFileSync(${JSON.stringify(rmLog)},JSON.stringify({args,allowed})+'\\n');
if(!allowed) console.error('synthetic_rm_refused');
process.exit(allowed?0:74);
`,{mode:0o700});
function run(command,args,extra={}) {
  return spawnSync(command,args,{env:{...env,...extra},encoding:'utf8',timeout:15000,
    cwd:join(root,'web/strategy-switch-console')});
}
function script(name,step) {
  const text=readFileSync(join(root,'.github/workflows',name),'utf8');
  const tail=text.split(`- name: ${step}\n`)[1];
  assert.ok(tail,`Missing workflow step: ${step}`);
  const match=/^        run: \|\n((?:          .*\n|\n)+)/m.exec(tail);
  assert.ok(match,`Missing shell body: ${step}`);
  return match[1].replace(/^          /gm,'');
}
function noIo(result) {
  assert.equal(result.status,1,result.stderr);
  assert.ok(result.stdout.includes(reason),result.stdout);
  assert.equal(existsSync(marker),false,'Frozen consumer attempted external I/O');
  assert.ok(!result.stdout.includes('synthetic-token'));
  assert.equal(result.stderr,'');
}
try {
  writeFileSync(sentinel,'keep');
  symlinkSync(outside,join(dir,'outside-link'));
  const owned=join(dir,'owned.txt');
  writeFileSync(owned,'keep');
  const refused=[
    [sentinel],['-rf','--',outside],['--force','--recursive',outside],
    ['--',sentinel],['-f',owned,sentinel],
    ['-f',join(dir,'..',outside.split('/').at(-1),'keep.txt')],
    ['-f',join(dir,'outside-link','keep.txt')],['--unknown-option',sentinel],[],
  ];
  for(const args of refused) {
    const result=run('rm',args);
    assert.equal(result.status,74,result.stderr);
    assert.equal(result.stderr,'synthetic_rm_refused\n');
    assert.equal(readFileSync(sentinel,'utf8'),'keep','Outside path was modified');
    assert.equal(readFileSync(owned,'utf8'),'keep','Mixed invocation modified owned path');
  }
  assert.equal(run('rm',['-rf','--',owned]).status,0);
  assert.equal(readFileSync(owned,'utf8'),'keep','Owned cleanup must also be a no-op');
  const selfTestLog=readFileSync(rmLog,'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(selfTestLog.map(row=>row.args),[...refused,['-rf','--',owned]]);
  assert.deepEqual(selfTestLog.map(row=>row.allowed),[...refused.map(()=>false),true]);
  console.log('rm shim: 9 refusals preserved outside fixture; owned cleanup was a logged no-op');
  for(const mode of frozen) for(const platform of ['ibkr','longbridge','firstrade','binance']) {
    const result=run(process.execPath,['--import',preload,transport],
      {DAILY_SETUP_MODE:mode,DAILY_EXECUTION_PLATFORM:platform});
    noIo(result);
    const receipt=JSON.parse(result.stdout);
    assert.equal(receipt.business_writes,0);
    assert.equal(receipt.retry,false);
  }
  const primary=script('configure-ibkr-primary-daily-once.yml','Freeze unqualified daily setup modes');
  for(const mode of [...frozen,'execute','', 'unknown']) noIo(run('bash',['-c',primary],{DAILY_SETUP_MODE:mode}));
  assert.equal(run('bash',['-c',primary],{DAILY_SETUP_MODE:'preflight'}).status,0);

  const period=script('configure-ibkr-period-return.yml','Read bindings and configure period-return secrets');
  for(const platform of ['ibkr','longbridge','firstrade','', 'unknown']) {
    noIo(run('bash',['-c',period],{CONFIGURE_MODE:'match-daily-binding',DAILY_COMPARISON_PLATFORM:platform}));
  }
  // The Binance exemption and unrelated modes still reach their existing
  // account-options reader, intercepted here before any network request.
  for(const [mode,platform] of [['match-daily-binding','binance'],['list','ibkr'],
    ['match-additional-1','ibkr'],['apply-additional-1','ibkr'],['apply','ibkr']]) {
    const result=run('bash',['-c',period],{CONFIGURE_MODE:mode,DAILY_COMPARISON_PLATFORM:platform,
      GH_TOKEN:'synthetic-token',TARGET_ID:'synthetic-target'});
    assert.equal(result.status,1,result.stderr);
    assert.ok(result.stdout.includes('account_options_read_failed'),result.stdout);
    assert.equal(readFileSync(marker,'utf8'),'npx\n');
    rmSync(marker);
  }
  const calls=readFileSync(rmLog,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length,selfTestLog.length+5,'Every workflow cleanup must be intercepted');
  assert.ok(calls.slice(selfTestLog.length).every(row=>row.allowed));
  assert.equal(readFileSync(sentinel,'utf8'),'keep');
  console.log('Strategy profile consumer freezes: transport/workflow fail-closed and unaffected modes passed; 5 workflow cleanups intercepted');
} finally {
  // Both directories were created above by this harness. No shell cleanup.
  rmSync(dir,{recursive:true,force:true});
  rmSync(outside,{recursive:true,force:true});
}
