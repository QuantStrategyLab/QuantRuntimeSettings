import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import worker, { __test } from '../web/strategy-switch-console/worker.js';
import { normalizeIbkrPeriodReturn } from '../web/strategy-switch-console/account_facts.js';
const require = createRequire(new URL('../web/strategy-switch-console/package.json', import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || 'miniflare');
const option = { key: 'synthetic-ibkr', label: 'Synthetic IBKR', account_scope: 'synthetic-live', target_name: 'synthetic-target', service_name: 'synthetic-service', deployment_selector: 'synthetic-deploy', account_selector: 'U100001' };
const binding = { platform: 'ibkr', account_key: option.key, account_scope: option.account_scope, target_name: option.target_name, service_name: option.service_name, deployment_selector: option.deployment_selector, account_selector: option.account_selector, target_id: 'synthetic-target', source_binding: { kind: 'deployment_runtime_account', id: 'a'.repeat(64) } };
const now = Date.now();
const payload = { schema_version: 'ibkr_account_period_return.v1', target_id: binding.target_id, source_binding_id: binding.source_binding.id, account_scope: option.account_scope, account_ids: [option.account_selector], observed_at: new Date(now-1000).toISOString(), currency: 'USD', period: { from: '2026-09-01', to: '2026-09-30' }, method: 'native_ibkr_twr', source: 'ChangeInNAV.twr', source_unit: 'percent', source_value: '2.5', unit: 'ratio', value: '0.025' };
assert.deepEqual(normalizeIbkrPeriodReturn(payload, { binding, now }), payload);
for (const bad of [{value:'2.5'}, {value:'-1.1',source_value:'-110'}, {source_unit:'ratio'}, {currency:'USDT'}, {account_ids:['U100002']}, {period:{from:'2026-09-31',to:'2026-09-30'}}, {observed_at:new Date(now-48*3600000).toISOString()}, {account_key:option.key}]) {
  assert.throws(() => normalizeIbkrPeriodReturn({...payload,...bad}, {binding,now}));
}
assert.equal(normalizeIbkrPeriodReturn({...payload,value:'-0.00000000000001',source_value:'-0.000000000001'}, {binding,now}).value, '-0.00000000000001');
const nav = { method:'ibkr_nav_reconciliation', source:'ChangeInNAV', amount:'0.25', components:{
  startingValue:'100.123456789', endingValue:'1100.373456789', depositsWithdrawals:'1000',
  internalCashTransfers:'0', assetTransfers:'-0.000', linkingAdjustments:'0.0' } };
assert.deepEqual(normalizeIbkrPeriodReturn({...payload,nav_change:nav},{binding,now}).nav_change,nav);
for (const change of [null, {...nav,amount:'0.250000001'}, {...nav,method:'mtm'}, {...nav,private_field:'unexpected'},
  {...nav,amount:'2.5e-1'}, {...nav,components:{...nav.components,assetTransfers:'1'}},
  {...nav,components:{...nav.components,internalCashTransfers:'-1'}},
  {...nav,components:{...nav.components,linkingAdjustments:'0.000000001'}},
  {...nav,components:{...nav.components,startingValue:null}}])
  assert.throws(()=>normalizeIbkrPeriodReturn({...payload,nav_change:change},{binding,now}));
const envBase = { SESSION_SECRET: 'synthetic-session-only', ALLOWED_GITHUB_LOGINS:'synthetic-reader', ACCOUNT_FACTS_READ_MODEL_ENABLED:'true', IBKR_ACCOUNT_FACTS_SYNC_TOKEN:'synthetic-ibkr-sync', SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN:'synthetic-other-sync' };
const mf = new Miniflare({ modules:true, modulesRules:[{type:'ESModule',include:['**/*.js']}], scriptPath:fileURLToPath(new URL('../web/strategy-switch-console/worker.js',import.meta.url)), compatibilityDate:'2026-06-08', bindings:envBase, durableObjects:{STRATEGY_SWITCH_RUNTIME_INSTANCES:{className:'RuntimeInstances',useSQLite:true}}, kvNamespaces:['STRATEGY_SWITCH_CONFIG'], outboundService:()=>new Response('offline',{status:503}) });
try {
  const kv = await mf.getKVNamespace('STRATEGY_SWITCH_CONFIG');
  const namespace = await mf.getDurableObjectNamespace('STRATEGY_SWITCH_RUNTIME_INSTANCES');
  const env = {...envBase,STRATEGY_SWITCH_CONFIG:kv,STRATEGY_SWITCH_RUNTIME_INSTANCES:namespace};
  const setBinding = async b => kv.put('account_facts_bindings',JSON.stringify({schema_version:'qsl_account_facts_bindings.v1',bindings:[b]}));
  await kv.put('account_options',JSON.stringify({ibkr:[option]})); await setBinding(binding);
  const post = (p=payload,token=envBase.IBKR_ACCOUNT_FACTS_SYNC_TOKEN,historical=false) => worker.fetch(new Request('https://switch.example/api/account-facts/period-return/sync'+(historical?'?historical=true':''),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(p)}),env);
  const cookie = await __test.makeSession('synthetic-reader',[],envBase);
  const get = (loggedIn=true) => worker.fetch(new Request('https://switch.example/api/account-facts',{headers:loggedIn?{Cookie:`qsl_switch_session=${cookie}`}:{}}),env);
  assert.equal((await post(payload,'')).status,401);
  assert.equal((await post(payload,envBase.SCHWAB_ACCOUNT_FACTS_SYNC_TOKEN)).status,403);
  assert.equal((await post({...payload,account_ids:['U100002']})).status,409);
  assert.equal((await post({...payload,value:'2.5'})).status,400);
  assert.equal((await (await get()).json()).accounts[0].return.status,'unavailable','an account without a native interval stays readable');
  const first = await post(); assert.equal(first.status,200); assert.equal((await first.json()).stored,true);
  const again = await post(); assert.equal((await again.json()).unchanged,true);
  assert.equal((await post({...payload,source_value:'3',value:'0.03'})).status,409);
  assert.equal((await post({...payload,observed_at:payload.observed_at.replace('Z','+00:00'),source_value:'3',value:'0.03'})).status,409,'equal instant text cannot bypass conflict');
  assert.equal((await post({...payload,observed_at:new Date(now-2000).toISOString()})).status,409);
  assert.equal((await get(false)).status,401);
  let response = await (await get()).json();
  assert.equal(response.accounts[0].return.value,'0.025');
  assert.equal(response.accounts[0].data_status,'unavailable','native return does not require a fresh balance snapshot');
  assert.equal(response.return.status,'unavailable','never fabricate a combined portfolio return');
  assert.ok(!JSON.stringify(response).includes(option.account_selector),'native identity remains private');
  const day = {...payload, period:{from:'2026-09-28',to:'2026-09-28'}, observed_at:new Date(now).toISOString(),nav_change:nav};
  assert.equal((await post(day)).status,409,'normal sync still rejects backdated writes');
  assert.equal((await post(day,envBase.IBKR_ACCOUNT_FACTS_SYNC_TOKEN,true)).status,200);
  response = await (await get()).json();
  assert.equal(response.accounts[0].return.period.from,'2026-09-01','backfill cannot replace the latest interval');
  assert.equal(response.accounts[0].return.daily.length,1);
  assert.equal(response.accounts[0].return.daily[0].period.to,'2026-09-28');
  assert.deepEqual(response.accounts[0].return.daily[0].nav_change,nav,'optional monetary evidence survives real SQLite and public readback');
  const otherNav={...nav,amount:'0.26',components:{...nav.components,endingValue:'1100.383456789'}};
  assert.equal((await post({...day,nav_change:otherNav},envBase.IBKR_ACCOUNT_FACTS_SYNC_TOKEN,true)).status,409,'same-instant monetary evidence cannot be silently rewritten');
  assert.equal((await post({...day,value:'0.03',source_value:'3'},envBase.IBKR_ACCOUNT_FACTS_SYNC_TOKEN,true)).status,409,'an existing native daily value is not silently rewritten');
  assert.equal((await post(payload,envBase.IBKR_ACCOUNT_FACTS_SYNC_TOKEN,true)).status,400,'only daily intervals permit backfill');
  await setBinding({...binding,source_binding:{...binding.source_binding,id:'b'.repeat(64)}});
  response = await (await get()).json(); assert.equal(response.accounts[0].return.status,'unavailable','binding changes invalidate prior intervals');
  const nextBinding = {...binding,source_binding:{...binding.source_binding,id:'b'.repeat(64)},
    history_source_binding_ids:[binding.source_binding.id]};
  await setBinding(nextBinding);
  response = await (await get()).json();
  assert.equal(response.accounts[0].return.value,payload.value,'qualified prior interval remains visible after rotation');
  assert.equal(response.accounts[0].return.daily.length,1,'qualified old native days survive source rotation');
  assert.equal((await post(day,envBase.IBKR_ACCOUNT_FACTS_SYNC_TOKEN,true)).status,409,'old source remains forbidden for new ingress');
  const newDay = {...day,source_binding_id:nextBinding.source_binding.id,observed_at:new Date(now).toISOString()};
  assert.equal((await post(newDay,envBase.IBKR_ACCOUNT_FACTS_SYNC_TOKEN,true)).status,200);
  response = await (await get()).json();
  assert.equal(response.accounts[0].return.period.from,payload.period.from,'new-source backfill cannot replace a qualified newer interval');
  assert.equal(response.accounts[0].return.daily.length,1,'the same verified day is not compounded twice across sources');
  assert.equal((await post({...newDay,nav_change:otherNav,observed_at:new Date(now+1).toISOString()},envBase.IBKR_ACCOUNT_FACTS_SYNC_TOKEN,true)).status,200);
  response=await (await get()).json();
  assert.equal(response.accounts[0].return.daily[0].value,day.value,'monetary conflicts do not erase qualified TWR');
  assert.equal(response.accounts[0].return.daily[0].nav_change,undefined,'conflicting source money is not arbitrarily chosen');
  await setBinding({...binding,source_binding:{...binding.source_binding,id:'c'.repeat(64)},
    history_source_binding_ids:[binding.source_binding.id,nextBinding.source_binding.id]});
  assert.equal((await post({...newDay,source_binding_id:'c'.repeat(64),value:'0.03',source_value:'3'},
    envBase.IBKR_ACCOUNT_FACTS_SYNC_TOKEN,true)).status,200);
  response = await (await get()).json();
  assert.equal(response.accounts[0].return.status,'unavailable','conflicting qualified daily values are never silently compounded or chosen');
  assert.equal(response.accounts[0].return.reason,'native_return_history_conflict','an actual source conflict is distinct from missing cash flows');
  await setBinding(binding);
  assert.equal((await post({...payload,currency:'EUR',observed_at:new Date(now).toISOString(),source_value:'-3',value:'-0.03'})).status,200);
  response = await (await get()).json(); assert.equal(response.accounts[0].return.currency,'EUR','base currency is kept without a USD relabel');
  assert.equal(response.accounts[0].return.value,'-0.03');
  const threeSourceDay={...payload,period:{from:'2026-10-01',to:'2026-10-01'}};
  for (const [index,letter] of ['d','e','f'].entries()) {
    const current={...binding,source_binding:{...binding.source_binding,id:letter.repeat(64)},
      history_source_binding_ids:['d','e','f'].filter(x=>x!==letter).map(x=>x.repeat(64))};
    await setBinding(current);
    assert.equal((await post({...threeSourceDay,source_binding_id:current.source_binding.id,
      observed_at:new Date(now+2+index).toISOString(),...(index===1?{}:{nav_change:index===0?nav:otherNav})})).status,200);
  }
  response=await (await get()).json();
  assert.equal(response.accounts[0].return.daily.length,1);
  assert.equal(response.accounts[0].return.value,payload.value);
  assert.equal(response.accounts[0].return.daily[0].nav_change,undefined,'an intervening no-money source cannot erase a prior money conflict');
  assert.equal(response.accounts[0].return.nav_change,undefined,'the top-level daily interval obeys the same money conflict');
  console.log('IBKR native period return: offline receiver, persistence, identity, units and privacy PASS');
} finally { await mf.dispose(); }
