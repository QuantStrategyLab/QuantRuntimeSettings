import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { performanceFixture } from './performance-synthetic.mjs';

const root = new URL('../', import.meta.url).pathname;
const port = Number(process.env.QSL_SYNTHETIC_PORT || 4173);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid synthetic dev port');
// This dev-only server imports no Worker, private config, credentials or providers.
// Every API path is handled locally; writes and unknown paths are rejected.
const requests = [];
let scenario = 'ready';
const account = { key: 'demo-paper', label: 'Synthetic paper account', target_name: 'demo-target', broker_environment: 'paper', supported_domains: ['us_equity'], default_strategy_profile: 'demo-profile-1' };
const ticket = index => ({ ticket_id: `synthetic-proposal-${index}`, state: 'awaiting_human', strategy_profile: `demo-profile-${index}`, domain: 'us_equity', proposed_params: {}, shadow_passed: true, shadow_evidence_kind: 'synthetic', research_summary: { comparison: { status: 'comparable' }, limitations: ['Synthetic UI fixture; no investment evidence.'] }, live_authority_granted: false, no_order: true });
const config = { accountOptions: { longbridge: [account] }, platformMeta: { longbridge: { label: 'LongBridge', console_visible: true } }, currentStrategies: { longbridge: { 'demo-paper': { strategy_profile: 'demo-profile-1', runtime_target_enabled: false } } }, strategyProfiles: Array.from({ length: 12 }, (_, i) => ({ profile: `demo-profile-${i + 1}`, label_zh: `合成方案 ${i + 1}`, label_en: `Synthetic proposal ${i + 1}`, domain: 'us_equity' })) };
const vite = await createServer({ root, envDir: false, server: { host: '127.0.0.1', port, strictPort: true, cors: false }, plugins: [{ name: 'synthetic-only-audit', configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url, 'http://127.0.0.1:4173');
    if (url.searchParams.has('qa')) scenario = url.searchParams.get('qa');
    if (url.pathname === '/__qa/requests') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(requests)); return; }
    if (url.pathname === '/v2/assets/qsl-brand-icon.png') { res.setHeader('Content-Type', 'image/png'); res.end(await readFile(root + 'public/qsl-brand-icon.png')); return; }
    if (url.pathname === '/login') { res.statusCode = 503; res.end('Synthetic demo: sign-in is unavailable.'); return; }
    if (url.pathname.startsWith('/api/')) {
      requests.push({ path: url.pathname, method: req.method, scenario });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
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
        '/api/config': scenario === 'no-accounts' ? { ...config, accountOptions: {} } : config,
        '/api/runtime-target-lifecycle': { data_status: 'unavailable', targets: [] },
        '/api/control-plane': { data_status: 'ready', candidates: [] },
        '/api/ux1/draft': { revision: 0, draft: {} },
        '/api/owner-decisions': { data_status: scenario === 'source-stale' ? 'stale' : 'ready', candidates: [] },
        '/api/reconciliation-recovery': { data_status: 'ready', recoveries: [] },
        '/api/research-promotion-tickets': { data_status: 'ready', tickets: scenario === 'many-decisions' ? Array.from({length: 12}, (_, i) => ticket(i + 1)) : [], applications: [] },
        '/api/account-diagnosis': { task: null },
        '/api/account-facts': { data_status: 'unavailable', accounts: [], summary: {} },
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
      res.end(JSON.stringify(data[url.pathname])); return;
    }
    next();
  });
} }] });
await vite.listen();
console.log(`Synthetic-only audit: http://127.0.0.1:${port}/v2/?qa=ready`);
