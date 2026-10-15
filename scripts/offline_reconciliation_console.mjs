// Offline-only consumer. Built-in modules only; never imports the Worker or config.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const policy = { purpose: 'observation_only', no_order: true, execution_authority_granted: false };
const envelopeKeys = ['schema_version', 'source_id', 'generated_at', 'computed_at', 'data_status', 'observations', 'errors', 'policy'];
const rowKeys = ['observation_id', 'platform', 'strategy_profile', 'environment', 'scope_version', 'reference_version', 'first_observed_at', 'last_observed_at', 'evidence_sample_count', 'coverage', 'comparison_status', 'reason_codes', 'report_id'];
const reasons = new Set(['comparison_mismatch', 'reference_unavailable', 'ledger_unavailable', 'broker_snapshot_incomplete', 'ledger_changed', 'broker_changed', 'account_identity_mismatch', 'reference_binding_invalid', 'input_stale', 'input_future', 'acquisition_window_exceeded', 'acquisition_order_invalid', 'report_persistence_failed']);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const identifier = (value, prefix) => typeof value === 'string' && value.startsWith(prefix) && /^[a-zA-Z0-9_.-]{1,80}$/.test(value);
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return NaN;
  return Date.parse(value);
}
const codes = value => Array.isArray(value) && value.length <= reasons.size && new Set(value).size === value.length && value.every(code => reasons.has(code));

export function validateObservation(value) {
  const invalid = () => { throw new Error('observation_invalid'); };
  if (!exactKeys(value, envelopeKeys) || Buffer.byteLength(JSON.stringify(value)) > 131072 ||
      value.schema_version !== 'qsl_reconciliation_observation_source_snapshot.v1' ||
      value.source_id !== 'binance.reconciliation_observation.mock' ||
      !Number.isFinite(time(value.generated_at)) || !Number.isFinite(time(value.computed_at)) ||
      time(value.computed_at) > time(value.generated_at) ||
      !['ready', 'stale', 'unavailable'].includes(value.data_status) ||
      !exactKeys(value.policy, Object.keys(policy)) || Object.keys(policy).some(key => value.policy[key] !== policy[key]) ||
      !codes(value.errors) || !Array.isArray(value.observations) || value.observations.length !== 1) invalid();
  const row = value.observations[0];
  if (!exactKeys(row, rowKeys) || !identifier(row.observation_id, 'fixture-observation-') ||
      row.platform !== 'binance' || row.environment !== 'synthetic' ||
      !identifier(row.strategy_profile, 'synthetic_') || !identifier(row.scope_version, 'synthetic-') ||
      !(row.reference_version === null || identifier(row.reference_version, 'synthetic-')) ||
      !(row.report_id === null || identifier(row.report_id, 'fixture-report-')) ||
      !['complete', 'partial', 'none'].includes(row.coverage) ||
      !['matched', 'mismatched', 'incomparable'].includes(row.comparison_status) ||
      ![0, 1].includes(row.evidence_sample_count) || !codes(row.reason_codes)) invalid();
  const dates = [row.first_observed_at, row.last_observed_at];
  if (!dates.every(date => date === null || Number.isFinite(time(date))) ||
      (dates[0] === null) !== (dates[1] === null) || (dates[0] !== null && time(dates[0]) > time(dates[1]))) invalid();
  if (row.comparison_status === 'incomparable') {
    if (value.data_status === 'ready' || row.coverage === 'complete' || row.evidence_sample_count !== 0 || row.reason_codes.length === 0) invalid();
  } else if (value.data_status === 'unavailable' || row.coverage !== 'complete' || row.evidence_sample_count !== 1 ||
             dates[0] === null || row.reference_version === null || row.report_id === null ||
             value.errors.length ||
             (row.comparison_status === 'matched' ? row.reason_codes.length !== 0 : JSON.stringify(row.reason_codes) !== '["comparison_mismatch"]')) invalid();
  if (row.coverage === 'none' && dates[0] !== null) invalid();
  return value;
}

export function observationAt(value, now = Date.now()) {
  validateObservation(value);
  const result = structuredClone(value);
  const row = result.observations[0];
  const dates = [result.generated_at, result.computed_at, row.first_observed_at, row.last_observed_at].filter(date => date !== null).map(time);
  if (dates.some(date => date > now + 300_000)) {
    result.data_status = 'unavailable';
    result.errors = [...new Set([...result.errors, 'input_future'])];
    row.comparison_status = 'incomparable'; row.coverage = row.first_observed_at ? 'partial' : 'none'; row.evidence_sample_count = 0;
    row.reason_codes = [...new Set([...row.reason_codes, 'input_future'])];
  } else if (dates.some(date => now - date > 1800_000)) {
    result.data_status = 'stale';
  } else if (row.first_observed_at && time(row.last_observed_at) - time(row.first_observed_at) > 300_000) {
    result.data_status = 'unavailable';
    result.errors = [...new Set([...result.errors, 'acquisition_window_exceeded'])];
    row.comparison_status = 'incomparable'; row.coverage = 'partial'; row.evidence_sample_count = 0;
    row.reason_codes = [...new Set([...row.reason_codes, 'acquisition_window_exceeded'])];
  }
  return result;
}

const unavailable = code => ({ data_status: 'unavailable', errors: [code] });
export function createOfflineConsole({ observation = null, historical = null, now = Date.now } = {}) {
  if (observation !== null) validateObservation(observation);
  // Snapshot inputs once. Reads/freshness must never mutate historical materials.
  const current = structuredClone(observation), recovery = structuredClone(historical);
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
      res.writeHead(403).end(); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    const path = new URL(req.url, `http://${host}`).pathname;
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body)); };
    if (path === '/api/reconciliation-observations') { json(current ? 200 : 503, current ? observationAt(current, now()) : unavailable('mock_observation_unavailable')); return; }
    if (path === '/api/reconciliation-recovery') { json(recovery ? 200 : 503, recovery ?? unavailable('mock_recovery_unavailable')); return; }
    if (path === '/api/reconciliation-overview') {
      json(200, {
        mode: 'offline_mock',
        current_observation: current ? observationAt(current, now()) : unavailable('mock_observation_unavailable'),
        historical_recovery_approval_materials: recovery ?? unavailable('mock_recovery_unavailable'),
      }); return;
    }
    const assets = {
      '/': ['text/html', 'index.html'],
      '/offline-reconciliation.js': ['text/javascript', 'view.js'],
      '/offline-reconciliation.css': ['text/css', 'style.css'],
    };
    if (!assets[path]) { json(404, { error: 'offline_route_not_found' }); return; }
    try {
      const [type, file] = assets[path];
      const content = await readFile(new URL(`./offline_reconciliation/${file}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(content);
    } catch { json(500, { error: 'offline_asset_unavailable' }); }
  });
}

async function readJson(path) {
  const raw = await readFile(path);
  if (raw.length > 131072) throw new Error('offline_input_too_large');
  return JSON.parse(raw);
}
async function main() {
  const { values } = parseArgs({ options: {
    mode: { type: 'string', default: 'mock' }, observation: { type: 'string' },
    historical: { type: 'string' }, now: { type: 'string' }, port: { type: 'string', default: '4185' },
  } });
  const port = Number(values.port), clock = values.now ? time(values.now) : null;
  if (values.mode !== 'mock' || !Number.isSafeInteger(port) || port < 1024 || port > 65535 || (clock !== null && !Number.isFinite(clock))) throw new Error('offline_config_invalid');
  const server = createOfflineConsole({
    observation: values.observation ? await readJson(values.observation) : null,
    historical: values.historical ? await readJson(values.historical) : null,
    now: clock === null ? Date.now : () => clock,
  });
  server.on('error', () => { console.error('offline_listen_failed'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Offline synthetic reconciliation: http://127.0.0.1:${port}/`));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('offline_input_invalid'); process.exitCode = 2; });
}
