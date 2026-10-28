import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import worker, { __test } from '../web/strategy-switch-console/worker.js';
const require = createRequire(new URL('../web/strategy-switch-console/package.json', import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || 'miniflare');
const path = fileURLToPath(new URL('../web/strategy-switch-console/worker.js', import.meta.url));
const source = await readFile(path, 'utf8');
const mf = new Miniflare({ modules: true, modulesRules: [{type:'ESModule',include:['**/*.js']}], scriptPath: path, script: source + `\nexport class FixtureResearchDO extends RuntimeInstances {
  async fetch(request) {
    const clone = request.clone(); const cmd = await clone.json();
    if (cmd.action === 'fixture_insert') {
      this.sql.exec('INSERT INTO account_daily_native_return (account_key, source_binding_id, currency, observation_date, payload_json) VALUES (?, ?, ?, ?, ?)', cmd.account_key, cmd.source_binding_id, cmd.currency, cmd.date, cmd.payload_json);
      return Response.json({ok:true});
    }
    if (cmd.action === 'fixture_drop') { this.sql.exec('DROP TABLE account_daily_native_return'); return Response.json({ok:true}); }
    return super.fetch(request);
  }
}`, compatibilityDate: '2026-06-08', durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: 'FixtureResearchDO', useSQLite: true } }, outboundService: () => { throw Error('unexpected network'); } });
try {
  const ns = await mf.getDurableObjectNamespace('STRATEGY_SWITCH_RUNTIME_INSTANCES');
  const stub = ns.get(ns.idFromName('runtime-instances'));
  const call = async cmd => { const r = await stub.fetch('https://fixture/', { method: 'POST', body: JSON.stringify(cmd) }); return { status: r.status, body: await r.json() }; };
  const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64);
  const request = { action:'account_daily_native_return_research_read', platform:'ibkr', account_key:'synthetic', account_scope:'synthetic', account_selector:'synthetic', target_id:'synthetic', source_binding_id:a, history_source_binding_ids:[b], currency:'USD', from:'2026-09-01', to:'2026-09-03' };
  const env = { SESSION_SECRET:'synthetic-session', ALLOWED_GITHUB_LOGINS:'admin', STRATEGY_SWITCH_ADMIN_LOGINS:'admin',
    IBKR_ACCOUNT_FACTS_SYNC_TOKEN:'synthetic-token', STRATEGY_SWITCH_RUNTIME_INSTANCES:ns };
  const cookie = await __test.makeSession('admin', [], env);
  const blocked = await worker.fetch(new Request('https://fixture/api/admin/runtime-instances', {method:'POST', headers:{Cookie:`qsl_switch_session=${cookie}`, Origin:'https://fixture', 'Content-Type':'application/json'}, body:JSON.stringify(request)}), env);
  assert.equal(blocked.status,400, 'an admin session cannot dispatch the research command');
  const tokenRequest = await worker.fetch(new Request('https://fixture/api/admin/runtime-instances', {method:'POST', headers:{Authorization:'Bearer synthetic-token', Origin:'https://fixture', 'Content-Type':'application/json'}, body:JSON.stringify(request)}), env);
  assert.equal(tokenRequest.status,401, 'a publisher token cannot dispatch the research command');
  const payload = (id, date, value='0.025', source_value='2.5') => ({ schema_version:'ibkr_account_period_return.v1', target_id:'synthetic', source_binding_id:id, account_scope:'synthetic', account_ids:['synthetic'], observed_at:'2026-10-01T00:00:00+00:00', currency:'USD', period:{from:date,to:date}, method:'native_ibkr_twr', source:'ChangeInNAV.twr', source_unit:'percent', source_value, unit:'ratio', value });
  const insert = async (id, date, row, currency='USD') => call({action:'fixture_insert',account_key:'synthetic',source_binding_id:id,currency,date,payload_json:typeof row==='string'?row:JSON.stringify(row)});
  let result = await call(request); assert.equal(result.status,200); assert.equal(result.body.status,'ok'); assert.deepEqual(result.body.rows,[]); assert.equal(result.body.calendar_qualification,'unknown');
  for (const bad of [{currency:'USDT'}, {from:'2026-09-31'}, {from:'2026-09-04'}, {from:'2025-01-01'}, {source_binding_id:'invalid'}]) assert.equal((await call({...request,...bad})).status,400);
  await insert(b,'2026-09-01',payload(b,'2026-09-01','0.0250','2.500'));
  await insert(a,'2026-09-01',payload(a,'2026-09-01'));
  await insert(a,'2026-09-02',payload(a,'2026-09-02'), 'EUR');
  result = await call(request); assert.equal(result.status,200); assert.equal(result.body.rows.length,1); assert.equal(result.body.source_row_count,2); assert.equal(result.body.duplicate_row_count,1); assert.equal(result.body.rows[0].source_binding_id,a); assert.equal(result.body.rows[0].observed_at,'2026-10-01T00:00:00+00:00'); assert.deepEqual(result.body.dates_without_records,['2026-09-02','2026-09-03']);
  await insert(a,'2026-09-03',payload(a,'2026-09-03','0.025000000000000001','2.5000000000000001'));
  await insert(b,'2026-09-03',payload(b,'2026-09-03','0.025000000000000002','2.5000000000000002'));
  result = await call(request); assert.equal(result.status,409); assert.equal(result.body.error,'native_return_history_conflict'); assert.equal(result.body.date,'2026-09-03'); assert.equal(result.body.rows,undefined);
  result = await call({...request,to:'2026-09-02'}); assert.equal(result.status,200);
  await insert(c,'2026-09-02',payload(c,'2026-09-02')); result=await call({...request,to:'2026-09-02'}); assert.equal(result.status,409); assert.equal(result.body.error,'native_return_source_unqualified');
  await insert(b,'2026-09-02','not-json'); result=await call({...request,to:'2026-09-02',history_source_binding_ids:[b,c]}); assert.equal(result.status,409); assert.equal(result.body.error,'native_return_record_invalid');
  const nav = {method:'ibkr_nav_reconciliation',source:'ChangeInNAV',amount:'1',components:{startingValue:'1',endingValue:'2',depositsWithdrawals:'0',internalCashTransfers:'0',assetTransfers:'0',linkingAdjustments:'0'}};
  const otherNav = {...nav,amount:'2',components:{...nav.components,endingValue:'3'}};
  const negativeNav = {...nav,amount:'-1',components:{startingValue:'-1',endingValue:'-2',depositsWithdrawals:'-0',internalCashTransfers:'-0.00',assetTransfers:'0',linkingAdjustments:'0.0'}};
  const equivalentNav = {...negativeNav,amount:'-1.000',components:{startingValue:'-1.0',endingValue:'-2.00',depositsWithdrawals:'0.00',internalCashTransfers:'0',assetTransfers:'-0.000',linkingAdjustments:'-0'}};
  const chosen = {...payload(a,'2026-09-01','-0.0250','-2.500'),currency:'GBP',nav_change:negativeNav};
  await insert(a,'2026-09-01',chosen,'GBP');
  await insert(b,'2026-09-01',{...payload(b,'2026-09-01','-0.025','-2.5'),currency:'GBP',nav_change:equivalentNav},'GBP');
  result=await call({...request,currency:'GBP'}); assert.equal(result.status,200); assert.deepEqual(result.body.rows,[chosen], 'original source and numeric strings are preserved');
  await insert(a,'2026-09-02',{...payload(a,'2026-09-02'),currency:'GBP',nav_change:nav},'GBP');
  await insert(b,'2026-09-02',{...payload(b,'2026-09-02'),currency:'GBP',nav_change:otherNav},'GBP');
  result=await call({...request,currency:'GBP'}); assert.equal(result.status,409); assert.equal(result.body.error,'native_return_nav_conflict');
  const noNav = {...payload(a,'2026-09-01'),currency:'CHF'};
  await insert(a,'2026-09-01',noNav,'CHF');
  await insert(b,'2026-09-01',{...payload(b,'2026-09-01'),currency:'CHF',nav_change:nav},'CHF');
  result=await call({...request,currency:'CHF'}); assert.equal(result.status,200); assert.deepEqual(result.body.rows,[noNav], 'historical NAV is never attached to the chosen source');
  await call({action:'fixture_drop'}); result=await call(request); assert.equal(result.status,503); assert.equal(result.body.error,'native_return_read_failed');
  console.log('native_return_research_read_validation: PASS');
} finally { await mf.dispose(); }
