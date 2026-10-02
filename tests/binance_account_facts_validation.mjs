import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker, { __test } from '../web/strategy-switch-console/worker.js';
import { normalizeBinanceFactsBinding, normalizeBinanceAccountFacts, projectBinanceAccountFacts,
  BINANCE_FACTS_KEY } from '../web/strategy-switch-console/binance_account_facts.js';

const now = Date.now();
const binding = {
  platform: 'binance', account_key: 'synthetic-wallet', account_scope: 'synthetic-scope',
  target_name: 'synthetic-target', service_name: '', deployment_selector: 'synthetic-runtime',
  account_selector: 'synthetic-selector', target_id: 'synthetic-target', account_scope_sha256: 'b'.repeat(64),
  reader_revision: 'c'.repeat(40), approved_application_revision: 'd'.repeat(40),
  source_binding: { kind: 'binance_readonly_scope_revision', id: 'e'.repeat(64) },
};
binding.source_binding.id = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({
  account_scope_sha256: binding.account_scope_sha256,
  approved_application_revision: binding.approved_application_revision,
  reader_public_revision: binding.reader_revision,
  scope: "spot+flexible_earn",
}))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const time = offset => new Date(now + offset).toISOString();
const report = {
  schema_version: 'binance_account_facts.v1', platform: 'binance', target_id: binding.target_id,
  account_scope_sha256: binding.account_scope_sha256, source_binding: binding.source_binding,
  source_revision: binding.reader_revision, approved_application_revision: binding.approved_application_revision,
  observed_started_at: time(-60_000), spot_observed_at: time(-50_000), earn_observed_at: time(-40_000),
  observed_finished_at: time(-30_000), snapshot_atomic: false, scope: 'spot+flexible_earn',
  completeness: 'complete_for_scope', assets: [
    { asset: 'USDT', quantity: '14.5', spot_free: '3.1', spot_locked: '0.2', flexible_earn: '11.2' },
    { asset: 'BTC', quantity: '0.000000000000000000000000000003', spot_free: '0.000000000000000000000000000001', spot_locked: '0', flexible_earn: '0.000000000000000000000000000002' },
  ], uncovered_scopes: ['funding', 'margin', 'futures', 'locked_earn'], no_order: true, execution_authority_granted: false,
};
assert.equal(normalizeBinanceFactsBinding(binding), binding);
assert.equal(normalizeBinanceAccountFacts(report, binding, { now, ingest: true }), report);
const projection = projectBinanceAccountFacts(report, binding, { now });
assert.equal(projection.assets[0].asset, 'USDT');
for (const text of [binding.account_selector, binding.account_scope_sha256, binding.source_binding.id, binding.reader_revision]) {
  assert.equal(JSON.stringify(projection).includes(text), false);
}
assert.equal(projectBinanceAccountFacts(report, binding, { now: now + 37 * 3_600_000 }), null);
const invalid = [
  { ...report, extra: true }, { ...report, platform: 'ibkr' }, { ...report, scope: 'all' },
  { ...report, snapshot_atomic: true }, { ...report, no_order: false }, { ...report, execution_authority_granted: true },
  { ...report, account_scope_sha256: 'a'.repeat(64) }, { ...report, source_revision: 'a'.repeat(40) },
  { ...report, approved_application_revision: 'a'.repeat(40) },
  { ...report, source_binding: { ...binding.source_binding, id: 'a'.repeat(64) } },
  { ...report, uncovered_scopes: ['funding'] }, { ...report, completeness: 'partial' },
  { ...report, observed_finished_at: time(61_000) }, { ...report, observed_started_at: time(-400_000) },
  { ...report, spot_observed_at: time(-20_000) }, { ...report, earn_observed_at: '2026-02-30T00:00:00Z' },
  { ...report, assets: [...report.assets, report.assets[0]] },
  { ...report, assets: [{ ...report.assets[0], quantity: '14.6' }] },
  { ...report, assets: [{ ...report.assets[0], spot_locked: '-0.2' }] },
  { ...report, assets: [{ asset: 'USDT', quantity: '0', spot_free: '0', spot_locked: '0', flexible_earn: '0' }] },
  { ...report, assets: [{ ...report.assets[0], native_uid: 'synthetic-private' }] },
];
for (const value of invalid) assert.throws(() => normalizeBinanceAccountFacts(value, binding, { now, ingest: true }));

const values = new Map(), puts = [];
const kv = {
  get: async key => values.get(key) || null,
  put: async (key, value, options) => { values.set(key, value); puts.push({ key, value, options }); },
};
const option = { key: binding.account_key, account_scope: binding.account_scope,
  target_name: binding.target_name, service_name: '', deployment_selector: binding.deployment_selector,
  account_selector: binding.account_selector, label: 'Synthetic wallet', default_strategy_profile: 'crypto_live_pool_rotation' };
const env = { SESSION_SECRET: 'synthetic-session-secret', ALLOWED_GITHUB_LOGINS: 'synthetic-reader',
  STRATEGY_SWITCH_ADMIN_LOGINS: 'different-admin', STRATEGY_SWITCH_CONFIG: kv,
  BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify(binding), BINANCE_ACCOUNT_FACTS_SYNC_TOKEN: 'synthetic-binance-facts',
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ binance: [option] }) };
const cookie = await __test.makeSession('synthetic-reader', [], env);
const post = (body, settings = env, token = env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN) => worker.fetch(
  new Request('https://console.example/api/internal/binance-account-facts', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), settings);
const get = (settings = env, authenticated = true) => worker.fetch(new Request('https://console.example/api/binance-account-facts', {
  headers: authenticated ? { Cookie: `qsl_switch_session=${cookie}` } : {},
}), settings);
assert.equal((await get(env, false)).status, 401);
assert.equal((await post(report, env, 'another-purpose-token')).status, 401);
assert.equal((await post(report, { ...env, ACCOUNT_FACTS_SYNC_TOKEN: env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN })).status, 503);
assert.equal((await post(report, { ...env, BINANCE_ACCOUNT_FACTS_BINDING_JSON: '' })).status, 503);
assert.equal((await post(report, { ...env, BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify({ ...binding,
  source_binding: { ...binding.source_binding, id: 'e'.repeat(64) } }) })).status, 503);
assert.equal((await post(report, { ...env, STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ binance: [{ ...option,
  account_scope: 'different-scope' }] }) })).status, 409);
const accepted = await post(report);
assert.equal(accepted.status, 200, JSON.stringify(await accepted.clone().json()));
assert.equal((await accepted.json()).status, 'published');
assert.equal(puts.length, 1);
assert.equal(puts[0].key, `${BINANCE_FACTS_KEY}:${binding.source_binding.id}`);
assert.equal((await (await post(report)).json()).status, 'unchanged');
assert.equal(puts.length, 1);
const read = await get();
assert.equal(read.status, 200);
assert.deepEqual((await read.json()).report, projection);
const conflicting = structuredClone(report); conflicting.assets[0].spot_free = '4.1'; conflicting.assets[0].quantity = '15.5';
assert.equal((await post(conflicting)).status, 409);
assert.equal(puts.length, 1);
for (const bad of invalid) assert.notEqual((await post(bad)).status, 200);
assert.equal(puts.length, 1);
assert.equal((await get({ ...env, BINANCE_ACCOUNT_FACTS_BINDING_JSON: '' })).status, 200);
assert.equal((await (await get({ ...env, BINANCE_ACCOUNT_FACTS_BINDING_JSON: '' })).json()).report, null);
// The same bytes are generated and checked by the Python producer tests.
const fixtureBytes = readFileSync(new URL('./fixtures/binance_account_facts.v1.synthetic.json', import.meta.url));
assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), '06231ffef64bbfdcad8b3f70f0c2264abcb69aed2854b3c62400869c308ef6e9');
const fixture = JSON.parse(fixtureBytes);
const fixtureBinding = { ...binding, target_id: fixture.target_id, account_scope_sha256: fixture.account_scope_sha256,
  reader_revision: fixture.source_revision, approved_application_revision: fixture.approved_application_revision,
  source_binding: fixture.source_binding };
assert.equal(normalizeBinanceAccountFacts(fixture, fixtureBinding, { now: Date.parse(fixture.observed_finished_at), ingest: true }), fixture);
const freshFixture = { ...fixture, observed_started_at: report.observed_started_at, spot_observed_at: report.spot_observed_at,
  earn_observed_at: report.earn_observed_at, observed_finished_at: report.observed_finished_at };
const fixtureEnv = { ...env, BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify(fixtureBinding) };
assert.equal((await post(freshFixture, fixtureEnv)).status, 200);
assert.deepEqual((await (await get(fixtureEnv)).json()).report.assets, fixture.assets);
console.log(`Binance account facts: native decimals, ${invalid.length} rejection cases, privacy, token isolation, binding and worker tests PASS`);
