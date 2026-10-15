import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import vm from 'node:vm';
import { createOfflineConsole, validateObservation, observationAt } from '../scripts/offline_reconciliation_console.mjs';

const read = name => readFile(new URL(`./fixtures/reconciliation_observation/${name}.json`, import.meta.url), 'utf8').then(JSON.parse);
const observation = await read('matched');
const historical = await read('historical-recovery');
const now = Date.parse('2000-01-01T00:02:00Z');
validateObservation(observation);
assert.equal(observationAt(observation, now).data_status, 'ready');
assert.equal(observationAt(observation, now + 1801_000).data_status, 'stale');
assert.equal(observation.data_status, 'ready', 'read-time freshness must not rewrite the input');

for (const change of [
  value => { value.account_id = 'synthetic-not-allowed-in-summary'; },
  value => { value.source_id = 'binance.reconciliation_recovery'; },
  value => { value.policy.no_order = false; },
  value => { value.policy.execution_authority_granted = true; },
  value => { value.observations[0].environment = 'live'; },
  value => { value.observations.push(value.observations[0]); },
  value => { value.observations[0].reason_codes = ['raw-provider-error']; },
  value => { value.observations[0].report_id = null; },
  value => { value.observations[0].first_observed_at = null; },
  value => { value.observations[0].first_observed_at = '2000-02-30T00:01:00Z'; },
  value => { value.observations[0].evidence_sample_count = 0; },
]) {
  const value = structuredClone(observation);
  change(value);
  assert.throws(() => validateObservation(value), /observation_invalid/);
}
const future = structuredClone(observation);
future.observations[0].last_observed_at = '2000-01-01T00:10:00Z';
assert.equal(observationAt(future, now).data_status, 'unavailable');
const staleEarlierSurface = structuredClone(observation);
staleEarlierSurface.observations[0].first_observed_at = '1999-12-31T23:30:00Z';
assert.equal(observationAt(staleEarlierSurface, now).data_status, 'stale', 'fresh last read cannot hide old first input');
for (const name of ['mismatched', 'missing-ledger', 'missing-reference', 'busy']) {
  const value = await read(name);
  validateObservation(value);
  assert.equal(observationAt(value, now).observations[0].comparison_status, name === 'mismatched' ? 'mismatched' : 'incomparable');
}

const server = createOfflineConsole({ observation, historical, now: () => now });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const split = await fetch(base + '/api/reconciliation-overview').then(r => r.json());
  assert.equal(split.current_observation.observations[0].comparison_status, 'matched');
  assert.deepEqual(split.historical_recovery_approval_materials, historical);
  assert.equal(split.historical_recovery_approval_materials.data_status, 'stale');
  assert.equal(split.historical_recovery_approval_materials.recoveries[0].status, 'decided');
  assert.deepEqual(await fetch(base + '/api/reconciliation-recovery').then(r => r.json()), historical);
  assert.equal((await fetch(base + '/api/reconciliation-observations').then(r => r.json())).data_status, 'ready');
  const html = await fetch(base).then(r => r.text());
  assert.match(html, /当前观察/);
  assert.match(html, /历史恢复审批材料/);
  const script = await fetch(base + '/offline-reconciliation.js').then(r => r.text());
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { textContent: '', append() {} });
      return elements.get(id);
    },
    createElement() { return { textContent: '' }; },
  };
  await vm.runInNewContext(`(async () => {${script}\n})()`, { document, fetch: path => fetch(base + path) });
  assert.match(elements.get('current-status').textContent, /资料可用 · 一致/);
  assert.match(elements.get('historical-status').textContent, /stale/);
  assert.deepEqual(JSON.parse(elements.get('historical-json').textContent), historical);
  for (const path of ['/api/reconciliation-observations', '/api/internal/sync-reconciliation-observation-source', '/api/reconciliation-recovery-confirmations', '/api/switch', '/api/runtime-stop']) {
    assert.equal((await fetch(base + path, { method: 'POST', body: '{}' })).status, 405);
  }
  assert.equal((await fetch(base + '/unknown')).status, 404);
  assert.equal((await fetch(base, { headers: { Origin: 'https://example.invalid' } })).status, 403);
  const externalHost = await new Promise((resolve, reject) => {
    const req = request(base, { headers: { Host: 'example.invalid' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    req.on('error', reject); req.end();
  });
  assert.equal(externalHost, 403);
} finally {
  await new Promise(resolve => server.close(resolve));
}
for (const [current, recovery, available] of [[observation, null, 'current_observation'], [null, historical, 'historical_recovery_approval_materials']]) {
  const isolated = createOfflineConsole({ observation: current, historical: recovery, now: () => now });
  await new Promise(resolve => isolated.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${isolated.address().port}`;
    const split = await fetch(base + '/api/reconciliation-overview').then(r => r.json());
    assert.equal(split[available].data_status, available === 'current_observation' ? 'ready' : 'stale');
    const missing = available === 'current_observation' ? '/api/reconciliation-recovery' : '/api/reconciliation-observations';
    assert.equal((await fetch(base + missing)).status, 503);
    const script = await fetch(base + '/offline-reconciliation.js').then(r => r.text());
    const elements = new Map();
    const document = {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { textContent: '', append() {} });
        return elements.get(id);
      },
      createElement() { return { textContent: '' }; },
    };
    await vm.runInNewContext(`(async () => {${script}\n})()`, { document, fetch: path => fetch(base + path) });
    assert.match(elements.get(available === 'current_observation' ? 'current-status' : 'historical-status').textContent,
      available === 'current_observation' ? /资料可用/ : /stale/);
  } finally {
    await new Promise(resolve => isolated.close(resolve));
  }
}
console.log('offline_reconciliation_console_validation: PASS (synthetic contract, split, independent freshness, read-only loopback)');
