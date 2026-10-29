import { consoleApiFixture } from './console-api-synthetic.mjs';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { performanceFixture } from './performance-synthetic.mjs';

const root = new URL('../', import.meta.url).pathname;
const port = Number(process.env.QSL_SYNTHETIC_PORT || 4173);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid synthetic dev port');
// This dev-only server imports no Worker, private config, credentials or providers.
// Every API path is handled locally; only the in-memory synthetic risk setting can be written.
const requests = [];
let scenario = 'ready';
const syntheticControls = new Map();
const syntheticRisks = new Map();
const syntheticDeclarations = new Map();
const syntheticPendingRead = new Set();
const syntheticSettings = key => {
  const identity = { platform:'longbridge', key, target_name:key, broker_environment:'paper', account_selector:key, deployment_selector:key, account_scope:key, service_name:'synthetic' };
  return { ok:true, adopted:false, platform:'longbridge', key, identity, draft:{status:'current',revision:2,identity,current_identity:identity,overrides:{}},
    declaration:syntheticDeclarations.get(key) || {status:"empty",revision:0,environment:null,account_type:null,source:"user_declared"},
    risk:syntheticRisks.get(key) || {revision:4,preference:'BALANCED_COMPOUNDING',scope_id:`longbridge--${key}`}, operations:{save_risk_preference:true,save_declaration:true}, no_order:true,execution_authority_granted:false };
};
const account = { key: 'demo-paper', label: 'Synthetic paper account', target_name: 'demo-target', broker_environment: 'paper', supported_domains: ['us_equity'], default_strategy_profile: 'demo-profile-1' };
const ticket = index => ({ ticket_id: `synthetic-proposal-${index}`, state: 'awaiting_human', strategy_profile: `demo-profile-${index}`, domain: 'us_equity', proposed_params: {}, shadow_passed: true, shadow_evidence_kind: 'synthetic', research_summary: { comparison: { status: 'comparable' }, limitations: ['Synthetic UI fixture; no investment evidence.'] }, live_authority_granted: false, no_order: true });
const config = { accountOptions: { longbridge: [account] }, platformMeta: { longbridge: { label: 'LongBridge', console_visible: true } }, currentStrategies: { longbridge: { 'demo-paper': { strategy_profile: 'demo-profile-1', runtime_target_enabled: false } } }, strategyProfiles: Array.from({ length: 12 }, (_, i) => ({ profile: `demo-profile-${i + 1}`, label_zh: `合成方案 ${i + 1}`, label_en: `Synthetic proposal ${i + 1}`, domain: 'us_equity' })) };
const vite = await createServer({ root, envDir: false, server: { host: '127.0.0.1', port, strictPort: true, cors: false }, plugins: [{ name: 'synthetic-only-audit', configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url, 'http://127.0.0.1:4173');
    if (url.searchParams.has('qa')) scenario = url.searchParams.get('qa');
    if (url.pathname === '/__qa/requests') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(requests)); return; }
    if (url.pathname === '/v2/assets/qsl-brand-icon.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end(await readFile(root + 'public/qsl-brand-icon.svg')); return; }
    if (url.pathname === '/login') { res.statusCode = 503; res.end('Synthetic demo: sign-in is unavailable.'); return; }
    if (url.pathname.startsWith('/api/')) {
      requests.push({ path: url.pathname, method: req.method, scenario });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      if (scenario.startsWith('control-demo') && url.pathname === '/api/accounts/run-controls') {
        const key = url.searchParams.get('account') || 'synthetic-alpha';
        const syntheticControl = syntheticControls.get(key) || null;
        const pending = syntheticControl && ['accepted', 'unknown', 'partial'].includes(syntheticControl.phase);
        const actions = Object.fromEntries(['enable','stop','resume','approve_application'].map(name => [name, {
          enabled: ['enable','stop'].includes(name) && !pending, reason: pending ? 'runtime_control_pending' : 'available', requires_confirmation: true }]));
        res.end(JSON.stringify({status:'ok',account_alias:key,platform:'ibkr',as_of:new Date().toISOString(),actions,
          runtime_control:syntheticControl,no_order:true,execution_authority_granted:false})); return;
      }
      if (scenario.startsWith('control-demo') && url.pathname === '/api/runtime-stop' && req.method === 'POST') {
        let text=''; for await (const chunk of req) text+=chunk; const body=JSON.parse(text);
        const key = body.target_name; let current = syntheticControls.get(key);
        if (body.operation === 'inspect') { if (current) current = {...current,phase:'applied',platform_applied:true}; }
        else current = {request_id:body.request_id,action:body.operation,phase:scenario === 'control-demo-reject' ? 'rejected' : 'unknown',unavailable_reason:scenario === 'control-demo-reject' ? 'runtime_control_workflow_permission_denied' : 'platform_result_unavailable',platform_applied:false};
        syntheticControls.set(key,current); res.end(JSON.stringify({ok:true,...current})); return;
      }
      if (url.pathname === '/api/account-settings' && ['api-ready','risk-late','risk-readback-failed','declaration-demo'].includes(scenario)) {
        if (req.method === 'GET') { if (scenario === 'risk-readback-failed' && syntheticPendingRead.has(url.searchParams.get('key'))) { res.statusCode=503; res.end(JSON.stringify({error:'synthetic_unavailable'})); return; } res.end(JSON.stringify(syntheticSettings(url.searchParams.get('key')))); return; }
        if (req.method === 'POST') {
          let text=''; for await (const chunk of req) text+=chunk;
          const body=JSON.parse(text); const current=syntheticSettings(body.key);
          if (body.declaration) {
            if (body.expected_declaration_revision !== current.declaration.revision || JSON.stringify(body.identity) !== JSON.stringify(current.identity)) { res.statusCode=409; res.end(JSON.stringify({error:'synthetic_conflict'})); return; }
            syntheticDeclarations.set(body.key,{status:'current',revision:current.declaration.revision+1,...body.declaration,source:'user_declared'});
            res.end(JSON.stringify(syntheticSettings(body.key))); return;
          }
          if (scenario === 'risk-late') { await new Promise(resolve => setTimeout(resolve, 8000)); res.statusCode=503; res.end(JSON.stringify({error:'synthetic_unavailable'})); return; }
          if (body.expected_risk_revision !== current.risk.revision || JSON.stringify(body.identity) !== JSON.stringify(current.identity)) { res.statusCode=409; res.end(JSON.stringify({error:'risk_profile_revision_conflict'})); return; }
          syntheticRisks.set(body.key,{...current.risk,revision:current.risk.revision+1,preference:body.risk_preference});
          if (scenario === 'risk-readback-failed') syntheticPendingRead.add(body.key);
          res.end(JSON.stringify(syntheticSettings(body.key))); return;
        }
      }
      const apiFixture = consoleApiFixture(url.pathname, url.searchParams, scenario.startsWith('control-demo') ? 'api-ready' : scenario, req.method);
      if (apiFixture !== undefined) { res.statusCode = apiFixture.status || 200; let fixture=apiFixture.body; if (scenario.startsWith('control-demo') && url.pathname === '/api/accounts' && fixture.accounts?.length) fixture={...fixture,accounts:[...fixture.accounts,{...fixture.accounts[0],account_alias:'synthetic-beta'}]}; const body=JSON.stringify(fixture); res.end(scenario.startsWith('control-demo') ? body.replaceAll('longbridge','ibkr') : body); return; }
      if (req.method !== 'GET') { res.statusCode = 405; res.end(JSON.stringify({ error: 'synthetic_audit_read_only' })); return; }
      const performance = performanceFixture(url.pathname, url.searchParams, scenario);
      if (performance !== undefined) {
        res.statusCode = performance.status || 200;
        res.end(JSON.stringify(performance.body || performance)); return;
      }
      const fail = scenario === 'source-error' && url.pathname === '/api/owner-decisions'
        || scenario === 'config-error' && url.pathname === '/api/config'
        || scenario === 'session-error' && url.pathname === '/api/session';
      if (fail) { res.statusCode = 503; res.end(JSON.stringify({ error: 'synthetic_unavailable' })); return; }
      const data = {
        '/api/session': { authenticated: scenario !== 'anonymous', allowed: scenario !== 'anonymous', admin: scenario !== 'reader', login: 'synthetic-qa', synthetic: true },
        '/api/config': scenario.startsWith('control-demo') ? { ...config, accountOptions:{ibkr:[{...account,key:'synthetic-alpha',target_name:'synthetic-alpha'},{...account,key:'synthetic-beta',target_name:'synthetic-beta'}]}, platformMeta:{ibkr:{label:'IBKR',console_visible:true}}, currentStrategies:{} } : scenario === 'declaration-demo' ? { ...config, accountOptions:{longbridge:[{key:'synthetic-alpha',label:'Synthetic alpha'}]}, currentStrategies:{} } : scenario === 'no-accounts' ? { ...config, accountOptions: {} } : config,
        '/api/runtime-target-lifecycle': { data_status: 'unavailable', targets: [] },
        '/api/control-plane': { data_status: 'ready', candidates: [] },
        '/api/ux1/draft': { revision: 0, draft: {} },
        '/api/owner-decisions': { data_status: scenario === 'source-stale' ? 'stale' : 'ready', candidates: [] },
        '/api/reconciliation-recovery': { data_status: 'ready', recoveries: [] },
        '/api/research-promotion-tickets': { data_status: 'ready', tickets: scenario === 'many-decisions' ? Array.from({length: 12}, (_, i) => ticket(i + 1)) : [], applications: [] },
        '/api/account-diagnosis': { task: null },
        '/api/account-facts': (() => {
          const observed = scenario !== 'api-not-connected';
          const status = scenario === 'api-stale' ? 'stale' : 'fresh';
          const at = new Date().toISOString();
          // Real producer LongBridge wire shape: balances carry
          // currency/net_assets/total_cash, cash rows carry
          // available/frozen/settling (never cash_balance), and the channel
          // identity never proves a physical account, so the row is
          // aggregation_status "unverified" and totals stay unavailable.
          return { ok: true, no_order: true, execution_authority_granted: false,
            accounts: [{ platform: 'longbridge', account_key: 'synthetic-alpha', binding_status: 'bound', identity_status: 'partial_identity', identity_mismatch: false,
              data_status: observed ? status : 'unavailable', broker_environment: scenario === 'declaration-demo' ? null : 'paper', account_scope: scenario === 'declaration-demo' ? null : 'PAPER',
              user_declaration: syntheticDeclarations.get('synthetic-alpha') || undefined,
              observation_date: observed ? at.slice(0, 10) : null, observed_started_at: observed ? at : null, observed_finished_at: observed ? at : null,
              aggregation_status: scenario === 'declaration-demo' ? 'included' : 'unverified',
              balances: observed ? [{ currency: 'USD', net_assets: '1234.56', total_cash: '100.25' }, { currency: 'HKD', net_assets: '0', total_cash: '0' }] : [],
              cash: observed ? [{ currency: 'USD', available_cash: '100.25', frozen_cash: '0', settling_cash: '0' }] : [] }],
            totals: { status: 'unavailable', reason: 'physical_identity_unverified', by_currency: [] },
            account_options_revision: 1, enabled: true, configured: true };
        })(),
        '/api/market-benchmark': { ok: true, points: [] },
        '/api/account-facts/history': { data_status: 'unavailable', series: { points: [] } },
        '/api/binance-account-facts': { data_status: 'unavailable', report: null },
        '/api/credential-maintenance': { id: 'ibkr_flex', metadata_source: 'operator_provided', metadata_revision: 0, expires_at: '2030-01-01T00:00:00.000Z', phase: 'not_due', delivery: 'not_reserved', requires_action: false },
        '/api/admin/config': { revision: 0 },
        '/api/admin/runtime-instances': { revision: 0, instances: [] },
        '/api/risk-profiles': { profiles: [] },
        '/api/binance-private-scope': { data_status: 'unavailable', report: null },
      };
      if (!(url.pathname in data)) { res.statusCode = 503; res.end(JSON.stringify({ error: 'synthetic_endpoint_unavailable' })); return; }
      res.end(scenario.startsWith('control-demo') ? JSON.stringify(data[url.pathname]).replaceAll('longbridge','ibkr') : JSON.stringify(data[url.pathname])); return;
    }
    next();
  });
} }] });
await vite.listen();
console.log(`Synthetic-only audit: http://127.0.0.1:${port}/v2/?qa=ready`);
